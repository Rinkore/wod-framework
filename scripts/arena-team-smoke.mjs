import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = 8805;
const base = `http://127.0.0.1:${port}/api`;
const tsxCli = path.join(root, "node_modules", "tsx", "dist", "cli.mjs");
if (!existsSync(tsxCli)) throw new Error(`找不到 tsx：${tsxCli}，请先 npm install`);

const tempDir = await mkdtemp(path.join(os.tmpdir(), "wod-arena-team-"));
const server = spawn(process.execPath, [tsxCli, path.join(root, "apps", "server", "src", "index.ts")], {
  cwd: root,
  env: {
    ...process.env,
    PORT: String(port),
    WOD_DATA_DIR: tempDir,
    WOD_ALLOW_SHARED_IP: "1",
    WOD_SEASON_DAYS: "1",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "";
server.stdout.on("data", (chunk) => (serverLog += chunk.toString()));
server.stderr.on("data", (chunk) => (serverLog += chunk.toString()));

const cookies = new Map();

async function waitForHealth() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      if ((await fetch(`${base}/health`)).ok) return;
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`服务端启动超时\n${serverLog}`);
}

async function request(who, method, route, body) {
  const response = await fetch(`${base}${route}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(cookies.get(who) ? { cookie: cookies.get(who) } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => null);
  return { response, data };
}

async function api(who, method, route, body) {
  const { response, data } = await request(who, method, route, body);
  if (!response.ok) {
    throw new Error(`${who} ${method} ${route} -> ${response.status}: ${data?.error?.message ?? "未知错误"}`);
  }
  return data;
}

async function expectError(who, method, route, body, status, code) {
  const { response, data } = await request(who, method, route, body);
  assert.equal(response.status, status, `${method} ${route} expected ${status}`);
  if (code) assert.equal(data?.error?.code, code);
  return data;
}

async function register(who, username) {
  const response = await fetch(`${base}/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password: "arena-team-pass-123" }),
  });
  assert.equal(response.status, 201, `注册 ${username}`);
  cookies.set(who, response.headers.getSetCookie()[0].split(";")[0]);
}

async function heroDraft(who) {
  return (await api(who, "GET", "/heroes/draft")).draft;
}

async function createHeroes(who, prefix) {
  const heroes = [];
  for (let index = 0; index < 4; index += 1) {
    const draft = await heroDraft(who);
    heroes.push(
      (
        await api(who, "POST", "/heroes", {
          name: `${prefix}${index + 1}`,
          raceId: draft.raceIds[0],
          weaponType: draft.weaponTypes[0],
          draftId: draft.draftId,
        })
      ).hero,
    );
  }
  return heroes;
}

function teamInput(heroes, positions = ["front", "flank", "back", "front"]) {
  return { members: heroes.map((hero, index) => ({ heroId: hero.id, position: positions[index] })) };
}

function insertMatch(db, {
  attackerTeamId,
  defenderTeamId,
  attackerUserId,
  defenderUserId,
  createdAt = Date.now(),
  attackerWon = 1,
}) {
  db.prepare(
    `INSERT INTO arena_matches
      (id, attacker_team_id, defender_team_id, attacker_user_id, defender_user_id, seed,
       result_json, attacker_snapshot_json, defender_snapshot_json,
       theoretical_attacker_delta, theoretical_defender_delta,
       actual_attacker_delta, actual_defender_delta, defender_multiplier, attacker_won, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, 1, ?, ?)`,
  ).run(
    randomUUID(),
    attackerTeamId,
    defenderTeamId,
    attackerUserId,
    defenderUserId,
    1,
    "{}",
    "{}",
    "{}",
    attackerWon,
    createdAt,
  );
}

try {
  await waitForHealth();
  const suffix = Date.now().toString(36);
  await Promise.all([
    register("a", `arena_a_${suffix}`),
    register("b", `arena_b_${suffix}`),
  ]);

  const heroesA = await createHeroes("a", "甲");
  const heroesB = await createHeroes("b", "乙");
  const initialPositions = ["front", "flank", "back", "front"];
  const changedPositions = ["back", "front", "flank", "back"];

  const savedA = (await api("a", "PUT", "/colosseum/team", teamInput(heroesA, initialPositions))).team;
  const savedB = (await api("b", "PUT", "/colosseum/team", teamInput(heroesB))).team;
  assert.equal(savedA.members.length, 4, "队伍不是固定 4 人");
  assert.equal(new Set(savedA.members.map((member) => member.heroId)).size, 4, "队伍成员重复");
  assert.equal(savedA.rating, 1000);
  const phantomAtCreate = savedA.phantomUpdatedAt;
  console.log("✓ 两个账号创建独立 4v4 队伍，初始积分 1000");

  const editedA = (await api("a", "PUT", "/colosseum/team", teamInput(heroesA, changedPositions))).team;
  assert.equal(editedA.phantomUpdatedAt, phantomAtCreate, "编辑阵容不应刷新幻影");
  assert.deepEqual(
    editedA.members.map((member) => member.position),
    changedPositions,
    "当前队伍站位没有更新",
  );
  const opponentList = (await api("b", "GET", "/colosseum/team/opponents")).opponents;
  const opponentA = opponentList.find((team) => team.id === savedA.id);
  assert.ok(opponentA, "对手列表缺少队伍 A");
  assert.deepEqual(
    opponentA.members.map((member) => member.position),
    initialPositions,
    "对手列表没有使用不可变幻影",
  );
  assert.equal(opponentA.challenge.dailyUsed, 0);
  assert.equal(opponentA.challenge.dailyLimit, 5);
  console.log("✓ 阵容编辑不刷新幻影，对手读取初始防守快照");

  // The service only permits challenges against a higher-rated team. Lift B by one
  // point so this first real match exercises the normal challenge path.
  const setupDb = new DatabaseSync(path.join(tempDir, "wod.db"));
  setupDb.prepare("UPDATE arena_teams SET rating = 1001 WHERE id = ?").run(savedB.id);
  setupDb.close();

  const battle = (await api("a", "POST", "/colosseum/team/challenge", {
    opponentTeamId: savedB.id,
  })).battle;
  assert.ok(["victory", "defeat"].includes(battle.outcome));
  assert.equal(battle.attacker.members.length, 4);
  assert.equal(battle.defender.members.length, 4);
  assert.equal(battle.ratingChanges.attacker, -battle.ratingChanges.defender, "积分变化必须零和");
  assert.equal(battle.theoreticalRatingChanges.attacker, -battle.theoreticalRatingChanges.defender);
  assert.ok(typeof battle.defenderMultiplier === "number");
  assert.equal((await api("a", "GET", "/colosseum/team/history")).battles.length, 1);
  console.log(`✓ 4v4 挑战即时结算并保存战报（${battle.outcome}）`);

  const db = new DatabaseSync(path.join(tempDir, "wod.db"));
  db.exec("PRAGMA busy_timeout = 5000");
  const teams = db.prepare("SELECT id, user_id FROM arena_teams ORDER BY created_at").all();
  const teamA = teams.find((team) => team.user_id === db.prepare("SELECT id FROM users WHERE username = ?").get(`arena_a_${suffix}`).id);
  const teamB = teams.find((team) => team.user_id === db.prepare("SELECT id FROM users WHERE username = ?").get(`arena_b_${suffix}`).id);
  assert.ok(teamA && teamB);

  // Ensure there is exactly one current-day win against B. The real battle may
  // have been either outcome, so add one synthetic win only when it was a defeat.
  if (battle.outcome !== "victory") {
    insertMatch(db, {
      attackerTeamId: teamA.id,
      defenderTeamId: teamB.id,
      attackerUserId: teamA.user_id,
      defenderUserId: teamB.user_id,
      attackerWon: 1,
      createdAt: Date.now(),
    });
  }
  const afterSeed = (await api("a", "GET", "/colosseum/team/opponents")).opponents.find((team) => team.id === teamB.id);
  assert.equal(afterSeed.challenge.defenderMultiplier, 0.25, "第二次击败同一防守队伍应为 25% 收益");
  assert.ok(afterSeed.challenge.cooldownUntil > Date.now(), "同一攻防方向应进入 48 小时冷却");
  assert.equal(afterSeed.challenge.allowed, false);
  console.log("✓ 对手元数据暴露冷却与防守收益递减倍率");

  // Fill the remaining same-day attacker slots with non-winning rows so the
  // multiplier stays at 25% while the daily gate reaches exactly five.
  const currentCount = db
    .prepare("SELECT COUNT(*) AS value FROM arena_matches WHERE attacker_user_id = ? AND created_at >= ?")
    .get(teamA.user_id, new Date().setHours(0, 0, 0, 0)).value;
  for (let index = currentCount; index < 5; index += 1) {
    insertMatch(db, {
      attackerTeamId: teamA.id,
      defenderTeamId: teamB.id,
      attackerUserId: teamA.user_id,
      defenderUserId: teamB.user_id,
      attackerWon: 0,
      createdAt: Date.now(),
    });
  }
  const limited = (await api("a", "GET", "/colosseum/team/opponents")).opponents.find((team) => team.id === teamB.id);
  assert.equal(limited.challenge.dailyUsed, 5);
  assert.equal(limited.challenge.allowed, false);
  assert.match(limited.challenge.reason, /次数已用尽/);
  await expectError(
    "a",
    "POST",
    "/colosseum/team/challenge",
    { opponentTeamId: teamB.id },
    409,
    "arena_challenge_blocked",
  );
  console.log("✓ 每日 5 次主动挑战上限生效");

  const teamBeforeSeason = (await api("a", "GET", "/colosseum/team")).team;
  const seasonBefore = (await api("a", "GET", "/colosseum/team/season")).season;
  db.prepare("UPDATE arena_seasons SET end_at = ? WHERE id = ? AND status = 'active'").run(Date.now() - 1, seasonBefore.id);
  db.close();

  const seasonAfter = await api("a", "GET", "/colosseum/team/season");
  assert.equal(seasonAfter.season.number, seasonBefore.number + 1, "过期赛季没有创建新赛季");
  assert.equal(seasonAfter.season.status, "active");
  const teamAfterSeason = (await api("a", "GET", "/colosseum/team")).team;
  assert.equal(teamAfterSeason.rating, teamBeforeSeason.rating, "赛季滚动不应重置长期积分");
  assert.ok(seasonAfter.rewards.length >= 1, "上一赛季没有生成队伍奖励");
  const beforeClaim = (await api("a", "GET", "/auth/me")).user.gold;
  const claim = await api("a", "POST", "/colosseum/team/season/claim");
  assert.ok(claim.claimed.length >= 1);
  assert.ok(claim.user.gold > beforeClaim);
  const secondClaim = await api("a", "POST", "/colosseum/team/season/claim");
  assert.equal(secondClaim.claimed.length, 0, "队伍赛季奖励被重复领取");
  console.log("✓ 赛季滚动保留长期积分，奖励生成、领取与幂等生效");

  console.log("\n竞技场 4v4 队伍冒烟测试全部通过。");
} catch (error) {
  console.error(`\n竞技场 4v4 队伍冒烟测试失败：${error.message}`);
  console.error(`\n服务端日志：\n${serverLog}`);
  process.exitCode = 1;
} finally {
  server.kill();
  await new Promise((resolve) => {
    if (server.exitCode !== null) resolve();
    else server.once("exit", () => resolve());
  });
  await rm(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
