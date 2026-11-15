import { randomUUID, randomInt } from "node:crypto";
import {
  LOTTERY_CONSOLATION_GOLD, LOTTERY_DRAW_COUNT, LOTTERY_NUMBER_MAX,
  LOTTERY_NUMBER_MIN, lotteryPrizeFor, lotteryShardPrizeFor,
  type LotteryStateView, type LotteryPeriodView,
} from "@wod/shared";
import { db } from "../db.js";
import { badRequest, conflict } from "../errors.js";
import { grantToken, tokenCount } from "./death.js";
import { busyExpeditionId } from "../views.js";

interface PeriodRow {
  number: number; start_at: number; end_at: number;
  status: "active" | "drawn"; numbers_json: string | null;
}
interface TicketRow {
  id: string; user_id: string; period_number: number | null; digits_json: string;
  status: "stock" | "entered" | "drawn" | "redeemed";
  matched_json: string | null; matched_count: number; redeemed_at: number | null;
  created_at: number; prize_shards: number; legacy: number;
}

function drawNumbers(): number[] {
  const pool = Array.from({ length: LOTTERY_NUMBER_MAX - LOTTERY_NUMBER_MIN + 1 }, (_, i) => i + LOTTERY_NUMBER_MIN);
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  return pool.slice(0, LOTTERY_DRAW_COUNT).sort((a, b) => a - b);
}
function dayBounds(now: number): [number, number] {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return [start.getTime(), end.getTime()];
}
function periodView(row: PeriodRow): LotteryPeriodView {
  return { number: row.number, startAt: row.start_at, endAt: row.end_at, status: row.status,
    numbers: row.numbers_json ? JSON.parse(row.numbers_json) as number[] : null };
}
function addShards(userId: string, amount: number): void {
  db.prepare(`INSERT INTO legacy_rewards (user_id, shards) VALUES (?, ?)
    ON CONFLICT(user_id) DO UPDATE SET shards = shards + excluded.shards`).run(userId, amount);
}
function settlePool(pool: PeriodRow, now: number, numbers: number[]): void {
  const tickets = db.prepare("SELECT * FROM lottery_tickets WHERE period_number=? AND status='entered' AND legacy=0 ORDER BY id")
    .all(pool.number) as unknown as TicketRow[];
  for (const ticket of tickets) {
    const matched = (JSON.parse(ticket.digits_json) as number[]).filter((n) => numbers.includes(n));
    const shards = lotteryShardPrizeFor(matched.length);
    const updated = db.prepare(`UPDATE lottery_tickets SET status='drawn',matched_json=?,matched_count=?,prize_shards=?,redeemed_at=?
      WHERE id=? AND status='entered'`).run(JSON.stringify(matched), matched.length, shards, now, ticket.id);
    if (updated.changes !== 1) continue;
    addShards(ticket.user_id, shards);
    if (matched.length >= 4) {
      db.prepare("UPDATE legacy_rewards SET manuals=manuals+? WHERE user_id=?")
        .run(matched.length >= 5 ? 3 : 1, ticket.user_id);
    }
    if (matched.length >= 5) {
      const cosmetic = matched.length === 6 ? "雨幕见证者" : "拾光者";
      const added = db.prepare("INSERT OR IGNORE INTO legacy_cosmetics(user_id,cosmetic_id,acquired_at) VALUES(?,?,?)")
        .run(ticket.user_id, cosmetic, now);
      if (added.changes === 0) addShards(ticket.user_id, matched.length === 6 ? 200 : 40);
    }
  }
  db.prepare("UPDATE daily_lottery_pools SET status='drawn',numbers_json=? WHERE number=? AND status='active'")
    .run(JSON.stringify(numbers), pool.number);
}

/** Rolls over local-calendar daily pools and atomically credits every entered ticket. */
export function ensureLotteryPeriods(now = Date.now(), draw: () => number[] = drawNumbers): void {
  db.exec("SAVEPOINT lottery_rollover");
  try {
    const overdue = db.prepare("SELECT * FROM daily_lottery_pools WHERE status='active' AND end_at<=? ORDER BY number")
      .all(now) as unknown as PeriodRow[];
    for (const pool of overdue) {
      const numbers = draw();
      if (numbers.length !== 6 || new Set(numbers).size !== 6 || numbers.some((n) => !Number.isInteger(n) || n < 0 || n > 30)) {
        throw new Error("无效的开奖号码");
      }
      settlePool(pool, now, [...numbers].sort((a, b) => a - b));
    }
    const active = db.prepare("SELECT * FROM daily_lottery_pools WHERE status='active' AND start_at<=? AND end_at>? LIMIT 1")
      .get(now, now) as unknown as PeriodRow | undefined;
    if (!active) {
      const latest = db.prepare("SELECT COALESCE(MAX(number),0) AS n FROM daily_lottery_pools").get() as unknown as { n: number };
      const [start, end] = dayBounds(now);
      db.prepare("INSERT INTO daily_lottery_pools(number,start_at,end_at,status) VALUES(?,?,?,'active')")
        .run(latest.n + 1, start, end);
    }
    db.exec("RELEASE lottery_rollover");
  } catch (error) { db.exec("ROLLBACK TO lottery_rollover; RELEASE lottery_rollover"); throw error; }
}

/** 每账号每日最多掉落的库存奖券数；超过后远征不再掉券。 */
export const LOTTERY_DAILY_DROP_LIMIT = 10;

/** Remote rewards grant unassigned stock only; no implicit participation or numbers. */
export function dropLotteryTickets(userId: string, maxMonsterLevel: number, now = Date.now()): { ticketId: string } | null {
  if (Math.random() >= Math.min(0.5, 0.06 + maxMonsterLevel * 0.01)) return null;
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  const droppedToday = (
    db
      .prepare(
        "SELECT COUNT(*) AS n FROM lottery_tickets WHERE user_id = ? AND created_at >= ?",
      )
      .get(userId, dayStart.getTime()) as unknown as { n: number }
  ).n;
  if (droppedToday >= LOTTERY_DAILY_DROP_LIMIT) return null;
  const ticketId = randomUUID();
  db.prepare("INSERT INTO lottery_tickets(id,user_id,status,created_at) VALUES(?,?,'stock',?)").run(ticketId, userId, now);
  return { ticketId };
}
export function enterLottery(userId: string, count: number, now = Date.now()): { entered: number; periodNumber: number } {
  if (!Number.isInteger(count) || count < 1 || count > 10000) throw badRequest("请选择有效的投入张数（每次最多 10000 张，可分批投入）");
  db.exec("BEGIN IMMEDIATE");
  try {
    ensureLotteryPeriods(now);
    const ticketIds = (db.prepare("SELECT id FROM lottery_tickets WHERE user_id=? AND status='stock' AND legacy=0 ORDER BY created_at,id LIMIT ?")
      .all(userId, count) as unknown as { id: string }[]).map((row) => row.id);
    if (ticketIds.length !== count) throw badRequest("库存奖券不足，本次投入未生效");
    const pool = db.prepare("SELECT * FROM daily_lottery_pools WHERE status='active' AND start_at<=? AND end_at>? LIMIT 1")
      .get(now, now) as unknown as PeriodRow;
    const update = db.prepare(`UPDATE lottery_tickets SET period_number=?,digits_json=?,status='entered'
      WHERE id=? AND user_id=? AND status='stock' AND legacy=0`);
    for (const id of ticketIds) {
      if (update.run(pool.number, JSON.stringify(drawNumbers()), id, userId).changes !== 1) {
        throw badRequest("奖券已投入、不可用或不属于你，本次投入未生效");
      }
    }
    db.exec("COMMIT");
    return { entered: ticketIds.length, periodNumber: pool.number };
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}

export function lotteryState(userId: string, page = 1, now = Date.now()): LotteryStateView {
  ensureLotteryPeriods(now);
  const current = db.prepare("SELECT * FROM daily_lottery_pools WHERE status='active' ORDER BY number DESC LIMIT 1").get() as unknown as PeriodRow;
  const last = db.prepare("SELECT * FROM daily_lottery_pools WHERE status='drawn' ORDER BY number DESC LIMIT 1").get() as unknown as PeriodRow | undefined;
  const count = (sql: string, ...args: (string | number)[]) => (db.prepare(sql).get(...args) as unknown as { n: number }).n;
  const stockCount = count("SELECT COUNT(*) n FROM lottery_tickets WHERE user_id=? AND status='stock'", userId);
  const enteredCount = count("SELECT COUNT(*) n FROM lottery_tickets WHERE user_id=? AND status='entered' AND period_number=? AND legacy=0", userId, current.number);
  const totalTickets = count("SELECT COUNT(*) n FROM lottery_tickets WHERE user_id=?", userId);
  const pageSize = 30;
  const requestedPage = Number.isInteger(page) && page >= 1 ? page : 1;
  const safePage = Math.max(1, Math.min(Math.ceil(totalTickets / pageSize) || 1, requestedPage));
  const rows = db.prepare(`SELECT * FROM lottery_tickets WHERE user_id=?
    ORDER BY CASE status WHEN 'stock' THEN 0 WHEN 'entered' THEN 1 ELSE 2 END,created_at DESC,id LIMIT ? OFFSET ?`)
    .all(userId, pageSize, (safePage - 1) * pageSize) as unknown as TicketRow[];
  const balance = db.prepare("SELECT shards,manuals FROM legacy_rewards WHERE user_id=?").get(userId) as unknown as { shards: number; manuals: number } | undefined;
  return {
    currentPeriod: periodView(current), lastDrawn: last ? periodView(last) : null,
    stockCount, enteredCount, totalTickets, page: safePage, pageSize,
    weeklyTickets: count("SELECT COUNT(*) n FROM lottery_tickets WHERE user_id=? AND created_at>=?", userId, now - 7 * 86400000),
    legacyShards: balance?.shards ?? 0, manuals: balance?.manuals ?? 0,
    cosmetics: (db.prepare("SELECT cosmetic_id FROM legacy_cosmetics WHERE user_id=? ORDER BY acquired_at").all(userId) as unknown as { cosmetic_id: string }[]).map((x) => x.cosmetic_id),
    tickets: rows.map((row) => {
      const old = row.legacy ? lotteryPrizeFor(row.matched_count) : null;
      return { id: row.id, periodNumber: row.period_number, digits: JSON.parse(row.digits_json) as number[],
        status: row.status, legacy: Boolean(row.legacy), prizeShards: row.prize_shards,
        matchedDigits: row.matched_json ? JSON.parse(row.matched_json) as number[] : null,
        matchedCount: row.matched_count, prizeTokens: old,
        consolationGold: row.legacy && !old ? LOTTERY_CONSOLATION_GOLD : 0,
        prize: row.legacy ? (old ? `赦免券 ×${old.pardon} / 赎回券 ×${old.redemption}` : null)
          : row.status === "drawn" ? `遗产碎片 ×${row.prize_shards}${row.matched_count >= 4 ? " · 训练手记" : ""}${row.matched_count >= 5 ? " · 纪念称号（重复折碎片）" : ""}` : null,
      };
    }),
    deathTokens: [{ type: "pardon", count: tokenCount(userId, "pardon") }, { type: "redemption", count: tokenCount(userId, "redemption") }],
  };
}

/** Only old already-drawn tickets retain manual claims and their original prize rules. */
export function redeemTicket(userId: string, ticketId: string): { gold: number; prize: string | null } {
  db.exec("BEGIN IMMEDIATE");
  try {
    const row = db.prepare("SELECT * FROM lottery_tickets WHERE id=? AND user_id=? AND legacy=1").get(ticketId, userId) as unknown as TicketRow | undefined;
    if (!row || row.status !== "drawn") throw badRequest("没有可领取的历史奖券奖励");
    const tokens = lotteryPrizeFor(row.matched_count);
    db.prepare("UPDATE lottery_tickets SET status='redeemed',redeemed_at=? WHERE id=? AND status='drawn'").run(Date.now(), ticketId);
    if (tokens) {
      for (let i = 0; i < tokens.pardon; i++) grantToken(userId, "pardon", Date.now());
      for (let i = 0; i < tokens.redemption; i++) grantToken(userId, "redemption", Date.now());
    } else db.prepare("UPDATE users SET gold=gold+? WHERE id=?").run(LOTTERY_CONSOLATION_GOLD, userId);
    db.exec("COMMIT");
    return { gold: tokens ? 0 : LOTTERY_CONSOLATION_GOLD, prize: tokens ? "历史复活券奖励" : null };
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}

export function exchangeLegacyManual(userId: string): void {
  db.exec("BEGIN IMMEDIATE");
  try {
    if (db.prepare("UPDATE legacy_rewards SET shards=shards-10,manuals=manuals+1 WHERE user_id=? AND shards>=10").run(userId).changes !== 1) {
      throw badRequest("需要 10 枚遗产碎片");
    }
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}
export function useLegacyManual(userId: string, heroId: string): void {
  db.exec("BEGIN IMMEDIATE");
  try {
    const hero = db.prepare("SELECT id FROM heroes WHERE id=? AND user_id=? AND died_at IS NULL AND ep_earned<=5000").get(heroId, userId);
    if (!hero) throw badRequest("手记只能用于累计 EP 不超过 5000 的存活新英雄");
    if (busyExpeditionId(heroId)) throw conflict("英雄正在远征");
    const used = db.prepare("SELECT uses FROM legacy_training WHERE hero_id=?").get(heroId) as unknown as { uses: number } | undefined;
    if ((used?.uses ?? 0) >= 3) throw badRequest("这名英雄已用完 3 次传承机会");
    if (db.prepare("UPDATE legacy_rewards SET manuals=manuals-1 WHERE user_id=? AND manuals>0").run(userId).changes !== 1) throw badRequest("没有训练手记");
    db.prepare("INSERT INTO legacy_training(hero_id,uses) VALUES(?,1) ON CONFLICT(hero_id) DO UPDATE SET uses=uses+1").run(heroId);
    // Spendable training EP only: no level gain, no skills refunded or duplicated.
    db.prepare("UPDATE heroes SET xp=xp+250 WHERE id=?").run(heroId);
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}
