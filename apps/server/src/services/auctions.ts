import { randomUUID } from "node:crypto";
import type {
  AuctionBidView,
  AuctionDetailView,
  AuctionListingView,
  ItemRoll,
  ItemView,
} from "@wod/shared";
import { db } from "../db.js";
import { badRequest, conflict, forbidden, notFound } from "../errors.js";
import type { ItemRow, UserRow } from "../types.js";
import { parseJson } from "../views.js";
import { insertInventoryItem } from "./market.js";
import { takeInventoryUnit } from "./inventory.js";

const MAX_PRICE = 1_000_000;
const FEE_PCT = 0.05;
const MAX_DURATION_HOURS = 72;

interface AuctionRow {
  id: string;
  seller_user_id: string;
  template_id: string;
  item_json: string;
  start_price: number;
  buyout_price: number | null;
  current_bid: number | null;
  current_bidder_user_id: string | null;
  bid_count: number;
  status: "active" | "sold" | "cancelled" | "expired";
  created_at: number;
  closes_at: number;
  sold_at: number | null;
  final_price: number | null;
  fee: number;
  seller_payout: number | null;
  buyer_user_id: string | null;
}

interface BidRow {
  id: string;
  auction_id: string;
  bidder_user_id: string;
  amount: number;
  created_at: number;
}

function usernameOf(userId: string | null): string | null {
  if (!userId) return null;
  const row = db
    .prepare("SELECT username FROM users WHERE id = ?")
    .get(userId) as unknown as { username: string } | undefined;
  return row?.username ?? "未知商人";
}

function auctionToView(row: AuctionRow, viewerId: string): AuctionListingView {
  const roll = parseJson<ItemRoll>(row.item_json);
  return {
    id: row.id,
    sellerId: row.seller_user_id,
    sellerName: usernameOf(row.seller_user_id) ?? "未知商人",
    item: {
      ...roll,
      id: row.id,
      equippedBy: null,
      equippedSlot: null,
      acquiredAt: row.created_at,
    },
    startPrice: row.start_price,
    currentBid: row.current_bid,
    minNextBid:
      row.current_bid === null ? row.start_price : row.current_bid + 1,
    buyoutPrice: row.buyout_price,
    bidCount: row.bid_count,
    currentBidderId: row.current_bidder_user_id,
    currentBidderName: usernameOf(row.current_bidder_user_id),
    status: row.status,
    createdAt: row.created_at,
    closesAt: row.closes_at,
    mine: row.seller_user_id === viewerId,
  };
}

function bidToView(row: BidRow): AuctionBidView {
  return {
    id: row.id,
    bidderId: row.bidder_user_id,
    bidderName: usernameOf(row.bidder_user_id) ?? "未知冒险者",
    amount: row.amount,
    createdAt: row.created_at,
  };
}

function expireOne(row: AuctionRow, now: number): void {
  db.exec("BEGIN IMMEDIATE");
  try {
    const fresh = db
      .prepare("SELECT * FROM auction_listings WHERE id = ? AND status = 'active'")
      .get(row.id) as unknown as AuctionRow | undefined;
    if (!fresh || fresh.closes_at > now) {
      db.exec("COMMIT");
      return;
    }
    const roll = parseJson<ItemRoll>(fresh.item_json);
    if (fresh.current_bidder_user_id && fresh.current_bid !== null) {
      const finalPrice = fresh.current_bid;
      const fee = Math.floor(finalPrice * FEE_PCT);
      const payout = finalPrice - fee;
      insertInventoryItem(fresh.current_bidder_user_id, roll, now);
      db.prepare("UPDATE users SET gold = gold + ? WHERE id = ?").run(
        payout,
        fresh.seller_user_id,
      );
      db.prepare(
        `UPDATE auction_listings
            SET status = 'sold', sold_at = ?, final_price = ?, fee = ?,
                seller_payout = ?, buyer_user_id = ?
          WHERE id = ? AND status = 'active'`,
      ).run(
        now,
        finalPrice,
        fee,
        payout,
        fresh.current_bidder_user_id,
        fresh.id,
      );
    } else {
      insertInventoryItem(fresh.seller_user_id, roll, now);
      db.prepare(
        "UPDATE auction_listings SET status = 'expired' WHERE id = ? AND status = 'active'",
      ).run(fresh.id);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

/** 惰性结算到期拍卖；有出价则成交，无出价则退回卖家。 */
export function expireAuctions(now = Date.now()): number {
  const rows = db
    .prepare(
      "SELECT * FROM auction_listings WHERE status = 'active' AND closes_at <= ?",
    )
    .all(now) as unknown as AuctionRow[];
  for (const row of rows) expireOne(row, now);
  return rows.length;
}

export function listAuctions(userId: string, mine = false): AuctionListingView[] {
  const now = Date.now();
  expireAuctions(now);
  const rows = (
    mine
      ? db
          .prepare(
            `SELECT * FROM auction_listings
              WHERE seller_user_id = ? AND status = 'active'
              ORDER BY closes_at ASC LIMIT 100`,
          )
          .all(userId)
      : db
          .prepare(
            `SELECT * FROM auction_listings
              WHERE status = 'active'
              ORDER BY closes_at ASC LIMIT 100`,
          )
          .all()
  ) as unknown as AuctionRow[];
  return rows.map((row) => auctionToView(row, userId));
}

export function getAuction(userId: string, auctionId: string): AuctionDetailView {
  expireAuctions();
  const row = db
    .prepare("SELECT * FROM auction_listings WHERE id = ?")
    .get(auctionId) as unknown as AuctionRow | undefined;
  if (!row) throw notFound("拍卖不存在");
  const bids = db
    .prepare(
      "SELECT * FROM auction_bids WHERE auction_id = ? ORDER BY amount DESC, created_at ASC",
    )
    .all(auctionId) as unknown as BidRow[];
  return {
    auction: auctionToView(row, userId),
    bids: bids.map(bidToView),
  };
}

export function listAuctionItem(
  userId: string,
  input: {
    itemId: string;
    startPrice: number;
    buyoutPrice?: number;
    durationHours?: number;
  },
) {
  if (
    !Number.isInteger(input.startPrice) ||
    input.startPrice < 1 ||
    input.startPrice > MAX_PRICE
  ) {
    throw badRequest("起拍价必须是 1 到 1000000 之间的整数");
  }
  if (
    input.buyoutPrice !== undefined &&
    (!Number.isInteger(input.buyoutPrice) ||
      input.buyoutPrice <= input.startPrice ||
      input.buyoutPrice > MAX_PRICE)
  ) {
    throw badRequest("一口价必须高于起拍价且不超过 1000000");
  }
  const durationHours = Math.min(
    MAX_DURATION_HOURS,
    Math.max(1, Math.floor(input.durationHours ?? 24)),
  );
  const now = Date.now();
  const auctionId = randomUUID();
  db.exec("BEGIN IMMEDIATE");
  try {
    // 所有权检查放进事务；带 owner 条件的删除校验行数，防止并发复制上架。
    const item = db
      .prepare("SELECT * FROM inventory_items WHERE id = ? AND user_id = ?")
      .get(input.itemId, userId) as unknown as ItemRow | undefined;
    if (!item) throw notFound("物品不存在");
    if (item.equipped_by) throw badRequest("请先卸下正在使用的装备");
    const listingRoll = takeInventoryUnit(item, userId);
    db.prepare(
      `INSERT INTO auction_listings
         (id, seller_user_id, template_id, item_json, start_price, buyout_price,
          status, created_at, closes_at)
       VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
    ).run(
      auctionId,
      userId,
      item.template_id,
      JSON.stringify(listingRoll),
      input.startPrice,
      input.buyoutPrice ?? null,
      now,
      now + durationHours * 60 * 60 * 1000,
    );
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  const row = db
    .prepare("SELECT * FROM auction_listings WHERE id = ?")
    .get(auctionId) as unknown as AuctionRow;
  return auctionToView(row, userId);
}

export function placeBid(userId: string, auctionId: string, amount: number) {
  if (!Number.isInteger(amount) || amount < 1 || amount > MAX_PRICE) {
    throw badRequest("出价必须是 1 到 1000000 之间的整数");
  }
  const now = Date.now();
  db.exec("BEGIN IMMEDIATE");
  try {
    const row = db
      .prepare("SELECT * FROM auction_listings WHERE id = ? AND status = 'active'")
      .get(auctionId) as unknown as AuctionRow | undefined;
    if (!row) throw notFound("拍卖不存在或已经结束");
    if (row.closes_at <= now) throw conflict("拍卖已经结束");
    if (row.seller_user_id === userId) throw conflict("不能竞拍自己的物品");
    const minBid = row.current_bid === null ? row.start_price : row.current_bid + 1;
    if (amount < minBid) throw badRequest(`至少需要出价 ${minBid} 金币`);

    const buyer = db.prepare("SELECT * FROM users WHERE id = ?").get(userId) as unknown as
      | UserRow
      | undefined;
    if (!buyer) throw notFound("账号不存在");
    if (buyer.gold < amount) throw badRequest("金币不足");

    if (row.current_bidder_user_id && row.current_bid !== null) {
      db.prepare("UPDATE users SET gold = gold + ? WHERE id = ?").run(
        row.current_bid,
        row.current_bidder_user_id,
      );
    }
    db.prepare("UPDATE users SET gold = gold - ? WHERE id = ?").run(amount, userId);
    db.prepare(
      "INSERT INTO auction_bids (id, auction_id, bidder_user_id, amount, created_at) VALUES (?, ?, ?, ?, ?)",
    ).run(randomUUID(), auctionId, userId, amount, now);
    db.prepare(
      `UPDATE auction_listings
          SET current_bid = ?, current_bidder_user_id = ?, bid_count = bid_count + 1
        WHERE id = ? AND status = 'active'`,
    ).run(amount, userId, auctionId);
    db.exec("COMMIT");

    const fresh = db
      .prepare("SELECT * FROM auction_listings WHERE id = ?")
      .get(auctionId) as unknown as AuctionRow;
    const gold = (db.prepare("SELECT gold FROM users WHERE id = ?").get(userId) as unknown as {
      gold: number;
    }).gold;
    return { auction: auctionToView(fresh, userId), gold };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function buyoutAuction(userId: string, auctionId: string) {
  const now = Date.now();
  db.exec("BEGIN IMMEDIATE");
  try {
    const row = db
      .prepare("SELECT * FROM auction_listings WHERE id = ? AND status = 'active'")
      .get(auctionId) as unknown as AuctionRow | undefined;
    if (!row) throw notFound("拍卖不存在或已经结束");
    if (row.closes_at <= now) throw conflict("拍卖已经结束");
    if (row.buyout_price === null) throw badRequest("这场拍卖没有设置一口价");
    if (row.seller_user_id === userId) throw conflict("不能购买自己的物品");

    const buyer = db.prepare("SELECT * FROM users WHERE id = ?").get(userId) as unknown as
      | UserRow
      | undefined;
    if (!buyer) throw notFound("账号不存在");
    if (buyer.gold < row.buyout_price) throw badRequest("金币不足");

    if (row.current_bidder_user_id && row.current_bid !== null) {
      db.prepare("UPDATE users SET gold = gold + ? WHERE id = ?").run(
        row.current_bid,
        row.current_bidder_user_id,
      );
    }
    db.prepare("UPDATE users SET gold = gold - ? WHERE id = ?").run(
      row.buyout_price,
      userId,
    );
    const fee = Math.floor(row.buyout_price * FEE_PCT);
    const payout = row.buyout_price - fee;
    db.prepare("UPDATE users SET gold = gold + ? WHERE id = ?").run(
      payout,
      row.seller_user_id,
    );
    const item = insertInventoryItem(userId, parseJson<ItemRoll>(row.item_json), now);
    db.prepare(
      `UPDATE auction_listings
          SET status = 'sold', sold_at = ?, final_price = ?, fee = ?,
              seller_payout = ?, buyer_user_id = ?
        WHERE id = ? AND status = 'active'`,
    ).run(now, row.buyout_price, fee, payout, userId, auctionId);
    db.exec("COMMIT");

    const fresh = db
      .prepare("SELECT * FROM auction_listings WHERE id = ?")
      .get(auctionId) as unknown as AuctionRow;
    const gold = (db.prepare("SELECT gold FROM users WHERE id = ?").get(userId) as unknown as {
      gold: number;
    }).gold;
    return {
      auction: auctionToView(fresh, userId),
      item,
      gold,
      price: row.buyout_price,
      fee,
    };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function cancelAuction(userId: string, auctionId: string) {
  const now = Date.now();
  db.exec("BEGIN IMMEDIATE");
  try {
    const row = db
      .prepare("SELECT * FROM auction_listings WHERE id = ? AND status = 'active'")
      .get(auctionId) as unknown as AuctionRow | undefined;
    if (!row) throw notFound("拍卖不存在或已经结束");
    if (row.seller_user_id !== userId) throw forbidden("只能取消自己的拍卖");
    if (row.current_bidder_user_id) {
      throw conflict("已经有出价，不能取消拍卖");
    }
    const item = insertInventoryItem(userId, parseJson<ItemRoll>(row.item_json), now);
    db.prepare(
      "UPDATE auction_listings SET status = 'cancelled' WHERE id = ? AND status = 'active'",
    ).run(auctionId);
    db.exec("COMMIT");

    const fresh = db
      .prepare("SELECT * FROM auction_listings WHERE id = ?")
      .get(auctionId) as unknown as AuctionRow;
    return { auction: auctionToView(fresh, userId), item };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
