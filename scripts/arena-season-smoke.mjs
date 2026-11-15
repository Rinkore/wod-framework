import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = 8804;
const base = `http://127.0.0.1:${port}/api`;
const tsxCli = path.join(root, "node_modules", "tsx", "dist", "cli.mjs");
const tempDir = await mkdtemp(path.join(os.tmpdir(), "wod-season-"));
const server = spawn(
  process.execPath,
  [tsxCli, path.join(root, "apps", "server", "src", "index.ts")],
  {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      WOD_DATA_DIR: tempDir,
      WOD_ALLOW_SHARED_IP: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let serverLog = "";
server.stdout.on("data", (chunk) => (serverLog += chunk.toString()));
server.stderr.on("data", (chunk) => (serverLog += chunk.toString()));

const cookies = new Map();

async function waitForHealth() {
  for (let i = 0; i < 120; i += 1) {
    
async function heroDraft(who, needWeapons = []) {
  for (let i = 0; i < 100; i += 1) {
    const draft = (await api(who, "GET", "/heroes/draft")).draft;
    if (needWeapons.every((w) => draft.weaponTypes.includes(w))) return draft;
  }
  throw new Error("抽选 100 次仍未包含所需武器组合");
}
try {
      if ((await fetch(`${base}/health`)).ok) return;
    } catch {
      // wait
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("server start timeout");
}

async function api(who, method, route, body) {
  const response = await fetch(`${base}${route}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(cookies.get(who) ? { cookie: cookies.get(who) } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`${who} ${method} ${route} -> ${response.status}: ${data?.error?.message}`);
  }
  return data;
}

async function register(key, username) {
  const response = await fetch(`${base}/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password: "season-pass-123" }),
  });
  assert.equal(response.status, 201, `register ${username}`);
  cookies.set(key, response.headers.getSetCookie()[0].split(";")[0]);
}


async function heroDraft(who, needWeapons = []) {
  for (let i = 0; i < 100; i += 1) {
    const draft = (await api(who, "GET", "/heroes/draft")).draft;
    if (needWeapons.every((w) => draft.weaponTypes.includes(w))) return draft;
  }
  throw new Error("抽选 100 次仍未包含所需武器组合");
}
try {
  await waitForHealth();
  const suffix = Date.now().toString(36);
  await Promise.all([
    register("a", `season_a_${suffix}`),
    register("b", `season_b_${suffix}`),
  ]);

  const aDraft = await heroDraft("a");
  const aHero = (await api("a", "POST", "/heroes", {
    name: "赛季甲",
    raceId: aDraft.raceIds[0],
    weaponType: aDraft.weaponTypes[0],
    draftId: aDraft.draftId,
  })).hero;
  const bDraft = await heroDraft("b");
  const bHero = (await api("b", "POST", "/heroes", {
    name: "赛季乙",
    raceId: bDraft.raceIds[0],
    weaponType: bDraft.weaponTypes[0],
    draftId: bDraft.draftId,
  })).hero;

  const initial = await api("a", "GET", "/colosseum/season");
  assert.equal(initial.season.status, "active");
  assert.equal(initial.season.number, 1);
  assert.equal(initial.leaderboard.length, 0);
  assert.equal(initial.myBest, null);
  console.log(`✓ 自动创建赛季：${initial.season.name}`);

  const duel = (await api("a", "POST", "/colosseum/duel", {
    heroId: aHero.id,
    opponentHeroId: bHero.id,
  })).duel;
  assert.ok(duel.outcome === "victory" || duel.outcome === "defeat");

  const afterDuel = await api("a", "GET", "/colosseum/season");
  assert.equal(afterDuel.leaderboard.length, 2, "决斗双方都应进入赛季榜");
  assert.ok(afterDuel.myBest, "参赛账号应返回自己的赛季排名");
  assert.ok(afterDuel.myBest.wins + afterDuel.myBest.losses >= 1);
  console.log("✓ 决斗计入赛季积分与排名");

  const db = new DatabaseSync(path.join(tempDir, "wod.db"));
  db.exec("PRAGMA busy_timeout = 5000");
  db.prepare(
    "UPDATE arena_seasons SET end_at = ? WHERE id = ? AND status = 'active'",
  ).run(Date.now() - 1000, initial.season.id);
  db.close();

  const next = await api("a", "GET", "/colosseum/season");
  assert.equal(next.season.number, 2, "到期后没有创建新赛季");
  assert.equal(next.season.status, "active");
  assert.ok(next.rewards.length >= 1, "赛季结束后没有生成待领取奖励");
  const reward = next.rewards.find((row) => row.heroId === aHero.id);
  assert.ok(reward, "参赛英雄没有赛季奖励");
  assert.ok(reward.gold > 0 && reward.ep > 0, "赛季奖励数值不对");
  console.log(`✓ 赛季结束生成奖励：第 ${reward.placement} 名`);

  const beforeGold = (await api("a", "GET", "/auth/me")).user.gold;
  const claimed = await api("a", "POST", "/colosseum/season/claim");
  assert.ok(claimed.claimed.some((row) => row.heroId === aHero.id), "奖励没有领取");
  assert.equal(
    claimed.user.gold,
    beforeGold + claimed.claimed.reduce((sum, row) => sum + row.gold, 0),
    "赛季金币没有到账",
  );
  const heroes = (await api("a", "GET", "/heroes")).heroes;
  const heroAfter = heroes.find((hero) => hero.id === aHero.id);
  assert.ok(heroAfter && heroAfter.epEarned > aHero.epEarned, "赛季 EP 没有到账");
  assert.ok(heroAfter.fame > 0, "赛季声望没有到账");

  const secondClaim = await api("a", "POST", "/colosseum/season/claim");
  assert.equal(secondClaim.claimed.length, 0, "赛季奖励被重复领取");
  console.log("✓ 赛季奖励领取、到账与防重复正确");

  console.log("\n竞技场赛季冒烟测试全部通过。");
} catch (error) {
  console.error(`\n竞技场赛季冒烟测试失败：${error.message}`);
  console.error(`\n服务端日志：\n${serverLog}`);
  process.exitCode = 1;
} finally {
  server.kill();
  await new Promise((resolve) => {
    if (server.exitCode !== null) resolve(undefined);
    else server.once("exit", () => resolve(undefined));
  });
  await rm(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
