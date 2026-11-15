import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = 8796;
const base = `http://127.0.0.1:${port}/api`;
const tsxCli = path.join(root, "node_modules", "tsx", "dist", "cli.mjs");
if (!existsSync(tsxCli)) throw new Error("tsx missing");
const tempDir = await mkdtemp(path.join(os.tmpdir(), "wod-phase5-"));
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
async function expectStatus(who, method, route, body, status) {
  const response = await fetch(`${base}${route}`, {
    method,
    headers: { "content-type": "application/json", cookie: cookies.get(who) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  assert.equal(response.status, status, `${route} expected ${status}`);
}
async function register(key, username) {
  const response = await fetch(`${base}/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password: "phase5-pass-123" }),
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
  await Promise.all([register("a", `p5a_${suffix}`), register("b", `p5b_${suffix}`)]);

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

  // Arena: duel and rating.
  const duel = await api("a", "POST", "/colosseum/duel", {
    heroId: heroesA[0].id,
    opponentHeroId: heroesB[0].id,
  });
  assert.ok(duel.duel.ratingChanges);
  const arena = (await api("a", "GET", "/colosseum/leaderboard")).entries;
  assert.ok(arena.length >= 1);
  assert.ok(arena.some((entry) => entry.rating !== 1000), "竞技场评分没有变化");
  console.log("✓ 竞技场评分与排名榜");

  // Clan treasury.
  const clan = await api("a", "POST", "/clans", { name: "金库测试会", tag: "TRE" });
  const clanId = clan.clan.id;
  await api("a", "POST", `/clans/${clanId}/gold/deposit`, { amount: 50 });
  let treasury = await api("a", "GET", `/clans/${clanId}/treasury`);
  assert.equal(treasury.gold, 50);
  await api("b", "POST", "/clans/join", { tag: "TRE" });

  await api("b", "POST", `/heroes/${heroesB[0].id}/unequip`, { slot: "weapon" });
  const item = (await api("b", "GET", "/inventory")).items.find((row) => !row.equippedBy);
  assert.ok(item);
  await api("b", "POST", `/clans/${clanId}/items/deposit`, { itemId: item.id });
  treasury = await api("a", "GET", `/clans/${clanId}/treasury`);
  assert.equal(treasury.gold, 50);
  assert.equal(treasury.items.length, 1);
  await expectStatus(
    "b",
    "POST",
    `/clans/${clanId}/items/${treasury.items[0].id}/withdraw`,
    undefined,
    403,
  );
  await api("a", "POST", `/clans/${clanId}/items/${treasury.items[0].id}/withdraw`);
  await api("a", "POST", `/clans/${clanId}/gold/withdraw`, { amount: 20 });
  const meA = await api("a", "GET", "/auth/me");
  assert.equal(meA.user.gold, 70);

  await api("a", "POST", `/clans/${clanId}/gold/deposit`, { amount: 10 });
  await api("b", "POST", `/heroes/${heroesB[1].id}/unequip`, { slot: "weapon" });
  const secondItem = (await api("b", "GET", "/inventory")).items.find(
    (row) => !row.equippedBy,
  );
  assert.ok(secondItem);
  await api("b", "POST", `/clans/${clanId}/items/deposit`, { itemId: secondItem.id });
  await api("a", "POST", `/clans/${clanId}/disband`);
  const afterDisband = await api("a", "GET", "/auth/me");
  assert.equal(afterDisband.user.gold, 100);
  const inventoryAfter = (await api("a", "GET", "/inventory")).items;
  assert.ok(inventoryAfter.some((row) => row.name === secondItem.name), "解散后物品没有归还");
  console.log("✓ 公会金库存入/取出/权限/解散归还");

  // Chat.
  await api("a", "POST", "/clans", { name: "聊天会", tag: "CHT" });
  await api("b", "POST", "/clans/join", { tag: "CHT" });
  await api("a", "POST", "/chat", { channel: "global", message: "边境有人吗？" });
  const globalMessages = (await api("b", "GET", "/chat?channel=global")).messages;
  assert.ok(globalMessages.some((row) => row.message === "边境有人吗？"));
  await api("b", "POST", "/chat", { channel: "clan", message: "公会频道测试" });
  const clanMessages = (await api("a", "GET", "/chat?channel=clan")).messages;
  assert.ok(clanMessages.some((row) => row.message === "公会频道测试"));
  console.log("✓ 世界频道/公会频道消息");

  console.log("\nPhase 5 冒烟测试全部通过。");
} catch (error) {
  console.error(`\nPhase 5 冒烟测试失败：${error.message}`);
  if (serverLog) console.error(serverLog);
  process.exitCode = 1;
} finally {
  server.kill();
  await new Promise((resolve) => setTimeout(resolve, 300));
  await rm(tempDir, { recursive: true, force: true });
}
