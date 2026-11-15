import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const directory = mkdtempSync(path.join(tmpdir(), "wod-decay-"));
process.env.WOD_DATA_DIR = directory;
process.env.WOD_DB = path.join(directory, "decay.db");
process.env.WOD_ALLOW_SHARED_IP = "1";

const { db } = await import("../apps/server/src/db.js");
const { settleAllDue } = await import("../apps/server/src/settlement.js");
const { dropLotteryTickets, LOTTERY_DAILY_DROP_LIMIT } = await import("../apps/server/src/services/lottery.js");

const user = db
  .prepare(
    "INSERT INTO users (id, username, password_hash, created_at) VALUES ('u-decay', 'decay-user', 'x', 1) RETURNING id",
  )
  .get() as unknown as { id: string };

const heroId = "hero-decay";
db.prepare(
  `INSERT INTO heroes (id, user_id, name, race_id, weapon_type, level, xp, ep_earned, skills_json, created_at)
   VALUES (?, ?, '衰减者', 'borderlander', 'sword', 1, 500, 500, '{}', 1)`,
).run(heroId, user.id);

function makeExpedition(id: string, outcome: string, gold: number): any {
  const engine = {
    outcome,
    seed: 1,
    roomPath: ["start", "combat-1"],
    roomNames: ["入口", "战斗"],
    routeCleared: false,
    encounters: [],
    rewards: { gold, ep: 100, fame: 0, items: [] },
    perHero: [
      {
        heroId,
        name: "衰减者",
        downed: false,
        epGained: 100,
        fromLevel: 1,
        toLevel: 1,
        epEarnedAfter: 600,
      },
    ],
    summary: { rounds: 3, monstersSlain: 2, survivors: 1, floorsCleared: 1 },
  };
  const now = Date.now();
  db.prepare(
    `INSERT INTO expeditions (id, user_id, dungeon_id, room_path_json, hero_ids_json, seed, status, start_at, end_at, created_at, result_json)
     VALUES (?, ?, 'abandoned-mine', '["start","combat-1"]', ?, 1, 'running', ?, ?, ?, ?)`,
  ).run(id, user.id, JSON.stringify([heroId]), now - 2000, now - 1000, now - 2000, JSON.stringify(engine));
  return db.prepare("SELECT * FROM expeditions WHERE id = ?").get(id) as any;
}

const now = Date.now();
const factorFor = (n: number) =>
  Math.max(0.4, Math.pow(n === 0 ? 0.9 : 0.7, n));

// 第 1 次全通（victory 首次不衰减）
let row = makeExpedition("exp-1", "victory", 1000);
assert.equal(settleAllDue(), 1);
let paid = db.prepare("SELECT gold FROM users WHERE id = ?").get(user.id)!.gold;
assert.equal(paid, 1000, "首次全通不衰减");

// 第 2 次全通：repeats=1 → 0.9
row = makeExpedition("exp-2", "victory", 1000);
assert.equal(settleAllDue(), 1);
paid = db.prepare("SELECT gold FROM users WHERE id = ?").get(user.id)!.gold;
assert.equal(paid, 1000 + Math.round(1000 * 0.9), "第二次全通衰减 0.9");

// 第 3 次撤离：repeats=2 → 0.7^2 = 0.49
row = makeExpedition("exp-3", "evacuated", 1000);
assert.equal(settleAllDue(), 1);
paid = db.prepare("SELECT gold FROM users WHERE id = ?").get(user.id)!.gold;
assert.equal(paid, 1000 + 900 + Math.round(1000 * 0.49), "撤离按 0.7^2 衰减");

// 第 4 次撤离：0.7^3 = 0.343 → clamp 0.4
row = makeExpedition("exp-4", "evacuated", 1000);
assert.equal(settleAllDue(), 1);
paid = db.prepare("SELECT gold FROM users WHERE id = ?").get(user.id)!.gold;
assert.equal(paid, 1900 + 490 + Math.round(1000 * 0.4), "衰减不低于 0.4");

// 彩票每日上限：压 Math.random 让每次必掉。结算已随远征掉过券，按当天总量断言上限。
const originalRandom = Math.random;
try {
  Math.random = () => 0;
  const before = db.prepare("SELECT COUNT(*) AS n FROM lottery_tickets WHERE user_id = ?").get(user.id)!.n;
  let dropped = 0;
  for (let i = 0; i < LOTTERY_DAILY_DROP_LIMIT + 5; i += 1) {
    if (dropLotteryTickets(user.id, 40, now)) dropped += 1;
  }
  const after = db.prepare("SELECT COUNT(*) AS n FROM lottery_tickets WHERE user_id = ?").get(user.id)!.n;
  assert.equal(after, LOTTERY_DAILY_DROP_LIMIT, `每日掉券总量上限 ${LOTTERY_DAILY_DROP_LIMIT}`);
  assert.equal(dropped, LOTTERY_DAILY_DROP_LIMIT - Number(before), "循环内掉券数补足到上限");
} finally {
  Math.random = originalRandom;
}

console.log("PASS: repeat decay (victory 0.9 / evacuated 0.7, floor 0.4), daily lottery drop cap");
db.close();
rmSync(directory, { recursive: true, force: true });
