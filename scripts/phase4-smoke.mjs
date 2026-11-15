import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = 8797;
const base = `http://127.0.0.1:${port}/api`;
const tsxCli = path.join(root, "node_modules", "tsx", "dist", "cli.mjs");
if (!existsSync(tsxCli)) throw new Error("tsx missing");
const tempDir = await mkdtemp(path.join(os.tmpdir(), "wod-phase4-"));
const server = spawn(process.execPath, [tsxCli, path.join(root, "apps", "server", "src", "index.ts")], {
  cwd: root,
  env: {
    ...process.env,
    PORT: String(port),
    WOD_DATA_DIR: tempDir,
    WOD_TIME_SCALE: "0.01",
    WOD_ALLOW_SHARED_IP: "1",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "";
server.stdout.on("data", (chunk) => (serverLog += chunk.toString()));
server.stderr.on("data", (chunk) => (serverLog += chunk.toString()));

const cookies = new Map();
async function waitForHealth() {
  for (let i = 0; i < 100; i += 1) {
    
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
  throw new Error("server timeout");
}
async function api(who, method, route, body) {
  const response = await fetch(`${base}${route}`, {
    method,
    headers: { "content-type": "application/json", cookie: cookies.get(who) },
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
    body: JSON.stringify({ username, password: "phase4-pass-123" }),
  });
  assert.equal(response.status, 201);
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
  await Promise.all([register("a", `p4a_${suffix}`), register("b", `p4b_${suffix}`)]);

  const heroesA = [];
  const heroesB = [];
  for (const [key, list, prefix] of [
    ["a", heroesA, "甲"],
    ["b", heroesB, "乙"],
  ]) {
    for (let i = 0; i < 2; i += 1) {
      const draft = await heroDraft(key);
      const data = await api(key, "POST", "/heroes", {
        name: `${prefix}${i + 1}`,
        raceId: draft.raceIds[0],
        weaponType: draft.weaponTypes[0],
        draftId: draft.draftId,
      });
      list.push(data.hero);
    }
  }
  console.log("✓ 两个模拟玩家各创建 2 名英雄");

  // Market: unequip A's weapon, list it, B buys.
  await api("a", "POST", `/heroes/${heroesA[0].id}/unequip`, { slot: "weapon" });
  const inventoryA = (await api("a", "GET", "/inventory")).items;
  const sellable = inventoryA.find((item) => !item.equippedBy);
  assert.ok(sellable, "没有可上架物品");
  const listing = await api("a", "POST", "/market/list", {
    itemId: sellable.id,
    price: 50,
  });
  assert.equal(listing.listing.price, 50);
  const bought = await api("b", "POST", `/market/${listing.listing.id}/buy`);
  assert.equal(bought.price, 50);
  assert.equal((await api("a", "GET", "/auth/me")).user.gold, 148); // 50 金成交扣 5% 手续费（floor=2）实收 48
  assert.equal((await api("b", "GET", "/auth/me")).user.gold, 50);
  const inventoryB = (await api("b", "GET", "/inventory")).items;
  assert.ok(inventoryB.some((item) => item.name === sellable.name), "买家没有收到物品");
  console.log("✓ 市场上架/购买/金币转移/物品转移");

  // Clan: A creates, B joins by tag.
  const clan = await api("a", "POST", "/clans", { name: "灰烬议会", tag: "ASH" });
  await api("b", "POST", "/clans/join", { tag: "ASH" });
  const clanView = (await api("a", "GET", "/clans/mine")).clan;
  assert.equal(clanView.members.length, 2);
  await api("b", "POST", "/clans/leave");
  assert.equal((await api("a", "GET", "/clans/mine")).clan.members.length, 1);
  console.log("✓ 公会创建/按标签加入/成员/离开");

  // Duel: A hero vs B hero.
  const duel = await api("a", "POST", "/colosseum/duel", {
    heroId: heroesA[0].id,
    opponentHeroId: heroesB[0].id,
  });
  assert.ok(duel.duel.log.length > 0);
  assert.ok(duel.duel.ratingChanges, "决斗应返回积分变化");
  const aHeroes = (await api("a", "GET", "/heroes")).heroes;
  const bHeroes = (await api("b", "GET", "/heroes")).heroes;
  assert.equal(aHeroes[0].epEarned, 500, "决斗不应产生 EP");
  assert.equal(bHeroes[0].epEarned, 500, "决斗不应产生 EP");
  const history = (await api("a", "GET", "/colosseum/history")).duels;
  assert.equal(history.length, 1);
  console.log("✓ 竞技场决斗、积分变化、历史记录");

  console.log("\nPhase 4 冒烟测试全部通过。");
} catch (error) {
  console.error(`\nPhase 4 冒烟测试失败：${error.message}`);
  if (serverLog) console.error(serverLog);
  process.exitCode = 1;
} finally {
  server.kill();
  await new Promise((resolve) => setTimeout(resolve, 300));
  await rm(tempDir, { recursive: true, force: true });
}
