import { randomUUID } from "node:crypto";
import type { ClanSummary, ClanTreasuryItemView, ClanView, ItemRoll, ItemView } from "@wod/shared";
import { db } from "../db.js";
import { badRequest, conflict, forbidden, notFound } from "../errors.js";
import type { ItemRow, UserRow } from "../types.js";
import { parseJson } from "../views.js";
import { addInventoryItem, takeInventoryUnit } from "./inventory.js";

interface ClanRow {
  id: string;
  name: string;
  tag: string;
  leader_user_id: string;
  gold: number;
  created_at: number;
}

function getClanRow(clanId: string): ClanRow {
  const row = db.prepare("SELECT * FROM clans WHERE id = ?").get(clanId) as unknown as
    | ClanRow
    | undefined;
  if (!row) throw notFound("公会不存在");
  return row;
}

export function currentClanRow(userId: string): ClanRow | null {
  const row = db
    .prepare(
      `SELECT c.* FROM clans c
         JOIN clan_members m ON m.clan_id = c.id
        WHERE m.user_id = ?
        LIMIT 1`,
    )
    .get(userId) as unknown as ClanRow | undefined;
  return row ?? null;
}

export function clanView(clanId: string): ClanView {
  const clan = getClanRow(clanId);
  const members = db
    .prepare(
      `SELECT m.user_id, m.role, m.joined_at, u.username
         FROM clan_members m JOIN users u ON u.id = m.user_id
        WHERE m.clan_id = ?
        ORDER BY CASE m.role WHEN 'leader' THEN 0 ELSE 1 END, m.joined_at ASC`,
    )
    .all(clanId) as unknown as Array<{
    user_id: string;
    role: "leader" | "member";
    joined_at: number;
    username: string;
  }>;

  return {
    id: clan.id,
    name: clan.name,
    tag: clan.tag,
    leaderUserId: clan.leader_user_id,
    gold: clan.gold,
    members: members.map((row) => ({
      userId: row.user_id,
      username: row.username,
      role: row.role,
      joinedAt: row.joined_at,
    })),
    createdAt: clan.created_at,
  };
}

export function getMyClan(userId: string): ClanView | null {
  const clan = currentClanRow(userId);
  return clan ? clanView(clan.id) : null;
}

export function createClan(userId: string, name: string, tag: string): ClanView {
  if (currentClanRow(userId)) throw conflict("你已经加入了一个公会");
  const id = randomUUID();
  const now = Date.now();
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(
      "INSERT INTO clans (id, name, tag, leader_user_id, created_at) VALUES (?, ?, ?, ?, ?)",
    ).run(id, name, tag.toUpperCase(), userId, now);
    db.prepare(
      "INSERT INTO clan_members (clan_id, user_id, role, joined_at) VALUES (?, ?, 'leader', ?)",
    ).run(id, userId, now);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    if (String((error as Error).message).includes("UNIQUE")) {
      throw conflict("公会名或标签已被使用");
    }
    throw error;
  }
  return clanView(id);
}

export function joinClan(userId: string, tag: string): ClanView {
  if (currentClanRow(userId)) throw conflict("你已经加入了一个公会");
  const clan = db
    .prepare("SELECT * FROM clans WHERE tag = ?")
    .get(tag.trim().toUpperCase()) as unknown as ClanRow | undefined;
  if (!clan) throw notFound("公会标签不存在");
  try {
    db.prepare(
      "INSERT INTO clan_members (clan_id, user_id, role, joined_at) VALUES (?, ?, 'member', ?)",
    ).run(clan.id, userId, Date.now());
  } catch (error) {
    if (String((error as Error).message).includes("UNIQUE")) {
      throw conflict("你已经在公会中");
    }
    throw error;
  }
  return clanView(clan.id);
}

export function leaveClan(userId: string): void {
  const clan = currentClanRow(userId);
  if (!clan) throw notFound("你不在任何公会中");
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("DELETE FROM clan_members WHERE clan_id = ? AND user_id = ?").run(
      clan.id,
      userId,
    );
    if (clan.leader_user_id === userId) {
      const next = db
        .prepare(
          "SELECT user_id FROM clan_members WHERE clan_id = ? ORDER BY joined_at ASC LIMIT 1",
        )
        .get(clan.id) as unknown as { user_id: string } | undefined;
      if (next) {
        db.prepare("UPDATE clans SET leader_user_id = ? WHERE id = ?").run(
          next.user_id,
          clan.id,
        );
        db.prepare(
          "UPDATE clan_members SET role = 'leader' WHERE clan_id = ? AND user_id = ?",
        ).run(clan.id, next.user_id);
      } else {
        db.prepare("DELETE FROM clans WHERE id = ?").run(clan.id);
      }
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function insertClanItem(clanId: string, userId: string, roll: ItemRoll, now: number): string {
  const id = randomUUID();
  db.prepare(
    "INSERT INTO clan_items (id, clan_id, template_id, item_json, added_by, added_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(id, clanId, roll.templateId, JSON.stringify(roll), userId, now);
  return id;
}

function insertUserItem(userId: string, roll: ItemRoll, now: number): ItemView {
  return addInventoryItem(userId, roll, now);
}

function requireMember(userId: string, clanId: string): ClanRow {
  const clan = getClanRow(clanId);
  const member = db
    .prepare("SELECT 1 FROM clan_members WHERE clan_id = ? AND user_id = ?")
    .get(clanId, userId);
  if (!member) throw forbidden("你不在这个公会中");
  return clan;
}

export function getClanTreasury(userId: string, clanId: string) {
  const clan = requireMember(userId, clanId);
  const rows = db
    .prepare(
      `SELECT ci.*, u.username
         FROM clan_items ci
         LEFT JOIN users u ON u.id = ci.added_by
        WHERE ci.clan_id = ?
        ORDER BY ci.added_at DESC`,
    )
    .all(clanId) as unknown as Array<{
    id: string;
    template_id: string;
    item_json: string;
    added_by: string;
    added_at: number;
    username: string | null;
  }>;
  const items: ClanTreasuryItemView[] = rows.map((row) => {
    const roll = parseJson<ItemRoll>(row.item_json);
    return {
      id: row.id,
      item: {
        ...roll,
        id: row.id,
        equippedBy: null,
        equippedSlot: null,
        acquiredAt: row.added_at,
      },
      addedBy: row.added_by,
      addedByName: row.username ?? "已注销账号",
      addedAt: row.added_at,
    };
  });
  return { gold: clan.gold, items };
}

export function depositClanGold(userId: string, clanId: string, amount: number) {
  requireMember(userId, clanId);
  db.exec("BEGIN IMMEDIATE");
  try {
    // 余额条件更新：扣款必须命中一行（余额充足），防止并发下负余额。
    const charged = db
      .prepare("UPDATE users SET gold = gold - ? WHERE id = ? AND gold >= ?")
      .run(amount, userId, amount);
    if (charged.changes !== 1) throw badRequest("金币不足");
    db.prepare("UPDATE clans SET gold = gold + ? WHERE id = ?").run(amount, clanId);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return getClanTreasury(userId, clanId);
}

export function withdrawClanGold(userId: string, clanId: string, amount: number) {
  const clan = requireMember(userId, clanId);
  if (clan.leader_user_id !== userId) throw forbidden("只有会长可以取出公会金币");
  db.exec("BEGIN IMMEDIATE");
  try {
    // 公会余额条件更新：并发取款不会把金库扣成负数。
    const withdrawn = db
      .prepare("UPDATE clans SET gold = gold - ? WHERE id = ? AND gold >= ?")
      .run(amount, clanId, amount);
    if (withdrawn.changes !== 1) throw badRequest("公会资金不足");
    db.prepare("UPDATE users SET gold = gold + ? WHERE id = ?").run(amount, userId);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return getClanTreasury(userId, clanId);
}

export function depositClanItem(userId: string, clanId: string, itemId: string) {
  requireMember(userId, clanId);
  const now = Date.now();
  db.exec("BEGIN IMMEDIATE");
  try {
    // 所有权检查放进事务；带 owner 条件的删除校验行数，防止并发复制存入。
    const item = db
      .prepare("SELECT * FROM inventory_items WHERE id = ? AND user_id = ?")
      .get(itemId, userId) as unknown as ItemRow | undefined;
    if (!item) throw notFound("物品不存在");
    if (item.equipped_by) throw badRequest("请先卸下正在使用的装备");
    insertClanItem(clanId, userId, takeInventoryUnit(item, userId), now);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return getClanTreasury(userId, clanId);
}

export function withdrawClanItem(userId: string, clanId: string, clanItemId: string) {
  const clan = requireMember(userId, clanId);
  if (clan.leader_user_id !== userId) throw forbidden("只有会长可以取出公会物品");
  const now = Date.now();
  db.exec("BEGIN IMMEDIATE");
  try {
    // 事务内先读快照，再条件删除校验行数：并发取出只允许一次。
    const item = db
      .prepare("SELECT * FROM clan_items WHERE id = ? AND clan_id = ?")
      .get(clanItemId, clanId) as unknown as { id: string; item_json: string } | undefined;
    if (!item) throw notFound("公会物品不存在");
    const deleted = db
      .prepare("DELETE FROM clan_items WHERE id = ? AND clan_id = ?")
      .run(item.id, clanId);
    if (deleted.changes !== 1) throw conflict("公会物品已被取出，请刷新后重试");
    insertUserItem(userId, parseJson<ItemRoll>(item.item_json), now);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return getClanTreasury(userId, clanId);
}

export function disbandClan(userId: string, clanId: string): void {
  const clan = getClanRow(clanId);
  if (clan.leader_user_id !== userId) throw forbidden("只有会长可以解散公会");
  const items = db
    .prepare("SELECT item_json FROM clan_items WHERE clan_id = ?")
    .all(clanId) as unknown as Array<{ item_json: string }>;
  const now = Date.now();
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const row of items) insertUserItem(userId, parseJson<ItemRoll>(row.item_json), now);
    db.prepare("UPDATE users SET gold = gold + ? WHERE id = ?").run(clan.gold, userId);
    db.prepare("DELETE FROM clans WHERE id = ?").run(clanId);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function listClans(): ClanSummary[] {
  const rows = db
    .prepare(
      `SELECT c.id, c.name, c.tag, c.created_at, u.username AS leader_name,
              (SELECT COUNT(*) FROM clan_members m WHERE m.clan_id = c.id) AS member_count
         FROM clans c JOIN users u ON u.id = c.leader_user_id
        ORDER BY member_count DESC, c.created_at ASC
        LIMIT 50`,
    )
    .all() as unknown as Array<{
    id: string;
    name: string;
    tag: string;
    created_at: number;
    leader_name: string;
    member_count: number;
  }>;
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    tag: row.tag,
    leaderName: row.leader_name,
    memberCount: row.member_count,
    createdAt: row.created_at,
  }));
}

export function clanLeaderName(clanId: string): string {
  const row = db
    .prepare(
      "SELECT u.username FROM clans c JOIN users u ON u.id = c.leader_user_id WHERE c.id = ?",
    )
    .get(clanId) as unknown as { username: string } | undefined;
  return row?.username ?? "?";
}

export function isClanLeader(userId: string, clanId: string): boolean {
  return getClanRow(clanId).leader_user_id === userId;
}

export function requireUserRow(userId: string): UserRow {
  const row = db.prepare("SELECT * FROM users WHERE id = ?").get(userId) as unknown as
    | UserRow
    | undefined;
  if (!row) throw notFound("账号不存在");
  return row;
}
