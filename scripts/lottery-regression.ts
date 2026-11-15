import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

// Never open the live database. Start from the old schema to exercise upgrade code.
const directory = mkdtempSync(path.join(tmpdir(), "wod-lottery-regression-"));
process.env.WOD_DATA_DIR = directory;
process.env.WOD_DB = path.join(directory, "legacy.db");
const old = new DatabaseSync(process.env.WOD_DB);
old.exec(`CREATE TABLE users(id TEXT PRIMARY KEY,username TEXT UNIQUE,password_hash TEXT,
  gold INTEGER DEFAULT 0,premium INTEGER DEFAULT 0,registration_ip_hash TEXT,created_at INTEGER);
  INSERT INTO users VALUES('user-a','lottery-regression','unused',0,0,NULL,1);
  INSERT INTO users VALUES('user-b','lottery-other','unused',0,0,NULL,1);
  CREATE TABLE lottery_tickets(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,period_number INTEGER NOT NULL,
    digits_json TEXT NOT NULL,status TEXT DEFAULT 'pending',matched_json TEXT,matched_count INTEGER DEFAULT 0,
    redeemed_at INTEGER,created_at INTEGER NOT NULL);
  INSERT INTO lottery_tickets VALUES('pending-old','user-a',1,'[1,2,3,4,5]','pending',NULL,0,NULL,1);
  INSERT INTO lottery_tickets VALUES('drawn-old','user-a',1,'[1,2,3,4,5]','drawn','[]',0,NULL,1);
  INSERT INTO lottery_tickets VALUES('redeemed-old','user-a',1,'[1,2,3,4,5]','redeemed','[]',0,1,1);`);
old.close();
const { db } = await import("../apps/server/src/db.js");
const { enterLottery, ensureLotteryPeriods, lotteryState, redeemTicket, exchangeLegacyManual, useLegacyManual, dropLotteryTickets } = await import("../apps/server/src/services/lottery.js");
const { lotteryShardPrizeFor } = await import("../packages/shared/src/index.js");
try {
  const stock = db.prepare("SELECT * FROM lottery_tickets WHERE id='pending-old'").get()!;
  assert.equal(stock.status, "stock");
  assert.equal(stock.period_number, null);
  assert.equal(stock.digits_json, "[]");
  assert.equal(db.prepare("SELECT legacy FROM lottery_tickets WHERE id='drawn-old'").get()!.legacy, 1);
  assert.equal(redeemTicket("user-a", "drawn-old").gold, 50);
  assert.throws(() => redeemTicket("user-a", "drawn-old"));
  assert.equal(db.prepare("SELECT gold FROM users WHERE id='user-a'").get()!.gold, 50);
  assert.deepEqual([0,1,2,3,4,5,6].map(lotteryShardPrizeFor), [1,1,3,10,40,200,1000]);

  const now = Date.now();
  for (let i = 0; i < 70; i++) db.prepare("INSERT INTO lottery_tickets(id,user_id,status,created_at) VALUES(?,?,'stock',?)").run(`stock-${i}`, "user-a", now);
  const initial = lotteryState("user-a", 1, now);
  assert.equal(initial.stockCount, 71);
  assert.equal(initial.tickets.length, 30);
  assert.equal(lotteryState("user-a", 2, now).tickets.length, 30);
  assert.equal(initial.enteredCount, 0);
  assert.throws(() => enterLottery("user-a", 72, now));
  assert.throws(() => enterLottery("user-a", -1, now));
  assert.throws(() => enterLottery("user-a", NaN, now));
  assert.equal(lotteryState("user-a", 1, now).stockCount, 71);
  assert.throws(() => enterLottery("user-b", 1, now));
  const joined = enterLottery("user-a", 41, now);
  assert.equal(joined.entered, 41);
  const entered = db.prepare("SELECT * FROM lottery_tickets WHERE status='entered'").all();
  assert.equal(entered.length, 41);
  for (const entry of entered) {
    const numbers = JSON.parse(String(entry.digits_json)) as number[];
    assert.equal(numbers.length, 6);
    assert.equal(new Set(numbers).size, 6);
    assert.ok(numbers.every((n) => n >= 0 && n <= 30));
    assert.deepEqual(numbers, [...numbers].sort((a,b) => a-b));
    assert.equal(entry.period_number, initial.currentPeriod.number);
  }
  const cutoff = initial.currentPeriod.endAt;
  assert.equal(lotteryState("user-a", 1, cutoff-1).enteredCount, 41);
  const next = lotteryState("user-a", 1, cutoff);
  assert.equal(next.currentPeriod.number, initial.currentPeriod.number+1);
  assert.equal(next.enteredCount, 0);
  assert.equal(next.stockCount, 30);
  assert.ok(next.lastDrawn?.numbers);
  const drawn = db.prepare("SELECT * FROM lottery_tickets WHERE legacy=0 AND status='drawn'").all();
  assert.equal(drawn.length, 41);
  let expectedShards = 0;
  let expectedManuals = 0;
  for (const ticket of drawn) {
    const hits = (JSON.parse(String(ticket.digits_json)) as number[]).filter((n) => next.lastDrawn!.numbers!.includes(n)).length;
    assert.equal(ticket.matched_count, hits);
    assert.equal(ticket.prize_shards, lotteryShardPrizeFor(hits));
    expectedShards += lotteryShardPrizeFor(hits);
    if (hits>=4) expectedManuals += hits>=5 ? 3 : 1;
  }
  const balance = db.prepare("SELECT * FROM legacy_rewards WHERE user_id='user-a'").get()!;
  // Cosmetic duplicates add shards separately; these rare outcomes may occur naturally.
  assert.ok(Number(balance.shards)>=expectedShards);
  assert.equal(balance.manuals, expectedManuals);
  const before = JSON.stringify(balance);
  ensureLotteryPeriods(cutoff);
  ensureLotteryPeriods(cutoff+1);
  assert.equal(JSON.stringify(db.prepare("SELECT * FROM legacy_rewards WHERE user_id='user-a'").get()), before);
  const late = enterLottery("user-a", 1, cutoff);
  assert.equal(late.periodNumber, next.currentPeriod.number);
  assert.throws(() => redeemTicket("user-a", String(drawn[0]!.id)));
  // Rollover can be nested under expedition settlement without BEGIN conflicts.
  db.exec("BEGIN IMMEDIATE");
  ensureLotteryPeriods(cutoff+86400000);
  db.exec("ROLLBACK");
  assert.equal(db.prepare("SELECT status FROM daily_lottery_pools WHERE number=?").get(late.periodNumber)!.status, "active");

  // Force each exact match tier and repeated cosmetic rewards in a separate account.
  const tierPool = db.prepare("SELECT * FROM daily_lottery_pools WHERE status='active' ORDER BY number DESC LIMIT 1").get()!;
  for (let hits=0;hits<=6;hits++) {
    const digits = [...Array.from({length:hits},(_,i)=>i), ...Array.from({length:6-hits},(_,i)=>10+i)];
    db.prepare("INSERT INTO lottery_tickets(id,user_id,period_number,digits_json,status,created_at) VALUES(?,?,?,?, 'entered',?)")
      .run(`tier-${hits}`,'user-b',tierPool.number,JSON.stringify(digits),now);
  }
  for (const hits of [5,6]) {
    const digits=[...Array.from({length:hits},(_,i)=>i), ...Array.from({length:6-hits},(_,i)=>10+i)];
    db.prepare("INSERT INTO lottery_tickets(id,user_id,period_number,digits_json,status,created_at) VALUES(?,?,?,?, 'entered',?)")
      .run(`tier-${hits}-repeat`,'user-b',tierPool.number,JSON.stringify(digits),now);
  }
  const tierCutoff=Number(tierPool.end_at);
  ensureLotteryPeriods(tierCutoff,()=>[0,1,2,3,4,5]);
  const tierBalance=db.prepare("SELECT shards,manuals FROM legacy_rewards WHERE user_id='user-b'").get()!;
  assert.equal(tierBalance.shards, 1+1+3+10+40+200+1000+200+1000+40+200);
  assert.equal(tierBalance.manuals,13);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM legacy_cosmetics WHERE user_id='user-b'").get()!.n,2);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM death_tokens WHERE user_id='user-b'").get()!.n,0);
  const tierSnapshot=JSON.stringify(tierBalance);
  ensureLotteryPeriods(tierCutoff,()=>[0,1,2,3,4,5]);
  assert.equal(JSON.stringify(db.prepare("SELECT shards,manuals FROM legacy_rewards WHERE user_id='user-b'").get()),tierSnapshot);

  db.prepare("INSERT INTO heroes(id,user_id,name,race_id,weapon_type,created_at) VALUES('hero-a','user-a','继承者','borderlander','sword',?)").run(now);
  db.prepare("UPDATE legacy_rewards SET shards=100,manuals=0 WHERE user_id='user-a'").run();
  exchangeLegacyManual("user-a");
  assert.deepEqual({ ...db.prepare("SELECT shards,manuals FROM legacy_rewards WHERE user_id='user-a'").get() }, { shards:90, manuals:1 });
  useLegacyManual("user-a", "hero-a");
  let hero = db.prepare("SELECT xp,ep_earned FROM heroes WHERE id='hero-a'").get()!;
  assert.equal(hero.xp,750);
  assert.equal(hero.ep_earned,500);
  for (let i=0;i<2;i++) { exchangeLegacyManual("user-a"); useLegacyManual("user-a","hero-a"); }
  exchangeLegacyManual("user-a");
  const manualsBefore = db.prepare("SELECT manuals FROM legacy_rewards WHERE user_id='user-a'").get()!.manuals;
  assert.throws(() => useLegacyManual("user-a","hero-a"));
  assert.equal(db.prepare("SELECT manuals FROM legacy_rewards WHERE user_id='user-a'").get()!.manuals,manualsBefore);
  assert.throws(() => useLegacyManual("user-b","hero-a"));
  const originalRandom = Math.random;
  try {
    Math.random = () => 0;
    const dropped = dropLotteryTickets("user-b",20,now)!;
    assert.ok(dropped.ticketId);
    const ticket = db.prepare("SELECT * FROM lottery_tickets WHERE id=?").get(dropped.ticketId)!;
    assert.equal(ticket.status,"stock"); assert.equal(ticket.period_number,null); assert.equal(ticket.digits_json,"[]");
  } finally { Math.random = originalRandom; }
  console.log("PASS: old-schema migration, legacy claims, daily stock/entry/cutoff, pagination, account isolation, auto-credit/idempotency, nested rollback, legacy manual use and caps");
} finally {
  db.close();
  rmSync(directory, { recursive:true,force:true });
}
