import { randomUUID } from "node:crypto";
import type { ItemRoll, ItemView, MarketListingView } from "@wod/shared";
import { db } from "../db.js";
import { badRequest, conflict, forbidden, notFound } from "../errors.js";
import type { ItemRow, UserRow } from "../types.js";
import { parseJson } from "../views.js";
import { addInventoryItem, takeInventoryUnit } from "./inventory.js";

const LISTING_DAYS = 7;
const MAX_PRICE = 1_000_000;
/** 成交手续费比例，与拍卖行一致。 */
const FEE_PCT = 0.05;

interface MarketRow {
  id: string;
  seller_user_id: string;
  template_id: string;
  item_json: string;
  price: number;
  status: "active" | "sold" | "cancelled" | "expired";
  buyer_user_id: string | null;
  created_at: number;
  sold_at: number | null;
  expires_at: number;
}

export function insertInventoryItem(userId: string, roll: ItemRoll, now: number): ItemView {
  return addInventoryItem(userId, roll, now);
}

function listingToView(row: MarketRow, viewerId: string): MarketListingView {
  const roll = parseJson<ItemRoll>(row.item_json);
  const seller = db
    .prepare("SELECT username FROM users WHERE id = ?")
    .get(row.seller_user_id) as unknown as { username: string } | undefined;
  return {
    id: row.id,
    sellerId: row.seller_user_id,
    sellerName: seller?.username ?? "未知商人",
    item: {
      ...roll,
      id: row.id,
      equippedBy: null,
      equippedSlot: null,
      acquiredAt: row.created_at,
    },
    price: row.price,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    mine: row.seller_user_id === viewerId,
  };
}

function expireListings(now: number): void {
  const rows = db
    .prepare(
      "SELECT * FROM market_listings WHERE status = 'active' AND expires_at <= ?",
    )
    .all(now) as unknown as MarketRow[];
  for (const row of rows) {
    db.exec("BEGIN IMMEDIATE");
    try {
      // 事务内条件更新：只有仍为 active 的挂单才退回物品，防止并发重复退回。
      const claimed = db
        .prepare(
          "UPDATE market_listings SET status = 'expired' WHERE id = ? AND status = 'active'",
        )
        .run(row.id);
      if (claimed.changes !== 1) {
        db.exec("ROLLBACK");
        continue;
      }
      insertInventoryItem(row.seller_user_id, parseJson<ItemRoll>(row.item_json), now);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
}

export function listMarket(userId: string, mine = false): MarketListingView[] {
  const now = Date.now();
  expireListings(now);
  const rows = db
    .prepare(
      mine
        ? "SELECT * FROM market_listings WHERE seller_user_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 100"
        : "SELECT * FROM market_listings WHERE status = 'active' ORDER BY created_at DESC LIMIT 100",
    )
    .all(...(mine ? [userId] : [])) as unknown as MarketRow[];
  return rows.map((row) => listingToView(row, userId));
}

export function listItem(userId: string, itemId: string, price: number) {
  if (!Number.isInteger(price) || price < 1 || price > MAX_PRICE) {
    throw badRequest("价格必须是 1 到 1000000 之间的整数");
  }
  const now = Date.now();
  const listingId = randomUUID();
  db.exec("BEGIN IMMEDIATE");
  try {
    // 所有权与未装备检查放进事务，并用带 owner 条件的删除校验行数。
    const fresh = db
      .prepare("SELECT * FROM inventory_items WHERE id = ? AND user_id = ?")
      .get(itemId, userId) as unknown as ItemRow | undefined;
    if (!fresh) throw notFound("物品不存在");
    if (fresh.equipped_by) throw badRequest("请先卸下正在使用的装备");
    const listingRoll = takeInventoryUnit(fresh, userId);
    db.prepare(
      `INSERT INTO market_listings
         (id, seller_user_id, template_id, item_json, price, status, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`,
    ).run(
      listingId,
      userId,
      fresh.template_id,
      JSON.stringify(listingRoll),
      price,
      now,
      now + LISTING_DAYS * 24 * 60 * 60 * 1000,
    );
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  const row = db
    .prepare("SELECT * FROM market_listings WHERE id = ?")
    .get(listingId) as unknown as MarketRow;
  return listingToView(row, userId);
}

export function buyListing(userId: string, listingId: string) {
  const now = Date.now();
  db.exec("BEGIN IMMEDIATE");
  try {
    const listing = db
      .prepare("SELECT * FROM market_listings WHERE id = ? AND status = 'active'")
      .get(listingId) as unknown as MarketRow | undefined;
    if (!listing) throw notFound("挂单不存在或已售出");
    if (listing.expires_at <= now) throw conflict("挂单已经过期");
    if (listing.seller_user_id === userId) throw conflict("不能购买自己的挂单");

    const buyer = db.prepare("SELECT * FROM users WHERE id = ?").get(userId) as unknown as
      | UserRow
      | undefined;
    if (!buyer) throw notFound("账号不存在");
    if (buyer.gold < listing.price) throw badRequest("金币不足");

    db.prepare("UPDATE users SET gold = gold - ? WHERE id = ?").run(listing.price, userId);
    const fee = Math.floor(listing.price * FEE_PCT);
    const payout = listing.price - fee;
    db.prepare("UPDATE users SET gold = gold + ? WHERE id = ?").run(
      payout,
      listing.seller_user_id,
    );
    const item = insertInventoryItem(userId, parseJson<ItemRoll>(listing.item_json), now);
    db.prepare(
      "UPDATE market_listings SET status = 'sold', buyer_user_id = ?, sold_at = ? WHERE id = ?",
    ).run(userId, now, listing.id);
    db.exec("COMMIT");

    const gold = (db.prepare("SELECT gold FROM users WHERE id = ?").get(userId) as unknown as {
      gold: number;
    }).gold;
    return { item, gold, price: listing.price, fee };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function cancelListing(userId: string, listingId: string) {
  const now = Date.now();
  db.exec("BEGIN IMMEDIATE");
  try {
    const listing = db
      .prepare("SELECT * FROM market_listings WHERE id = ? AND status = 'active'")
      .get(listingId) as unknown as MarketRow | undefined;
    if (!listing) throw notFound("挂单不存在或已售出");
    if (listing.seller_user_id !== userId) throw forbidden("只能下架自己的挂单");

    const item = insertInventoryItem(userId, parseJson<ItemRoll>(listing.item_json), now);
    db.prepare("UPDATE market_listings SET status = 'cancelled' WHERE id = ?").run(listing.id);
    db.exec("COMMIT");
    return { item };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
