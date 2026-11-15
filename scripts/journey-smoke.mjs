import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = 8795;
const base = `http://127.0.0.1:${port}/api`;
const tsxCli = path.join(root, "node_modules", "tsx", "dist", "cli.mjs");
if (!existsSync(tsxCli)) throw new Error("tsx missing");
const tempDir = await mkdtemp(path.join(os.tmpdir(), "wod-journey-"));
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
    body: JSON.stringify({ username, password: "journey-pass-123" }),
  });
  assert.equal(response.status, 201);
  cookies.set(key, response.headers.getSetCookie()[0].split(";")[0]);
}
async function createHero(who, name) {
  const draft = (await api(who, "GET", "/heroes/draft")).draft;
  const body = {
    name,
    raceId: draft.raceIds[0],
    weaponType: draft.weaponTypes[0],
    draftId: draft.draftId,
  };
  return (await api(who, "POST", "/heroes", body)).hero;
}

try {
  await waitForHealth();
  const suffix = Date.now().toString(36);
  await Promise.all([
    register("a", `jr_a_${suffix}`),
    register("b", `jr_b_${suffix}`),
    register("c", `jr_c_${suffix}`),
  ]);
  console.log("1. 三个模拟玩家注册完成（共享网络测试模式，每个玩家一个账号）");

  const a1 = await createHero("a", "战士甲", "borderlander", "sword");
  const a2 = await createHero("a", "猎人甲", "woodlander", "bow");
  const b1 = await createHero("b", "牧师乙", "dinturan", "book");
  const b2 = await createHero("b", "战士乙", "borderlander", "hammer");
  const c1 = await createHero("c", "法师丙", "partan", "staff");
  const c2 = await createHero("c", "诗人丙", "halfling", "instrument");
  console.log("2. 六名英雄创建完成（3 名模拟玩家各 2 名）");

  const trainedSkill = await api("a", "POST", `/heroes/${a1.id}/train`, {
    target: "skill",
    key: a1.skills.find((skill) => skill.source === "basic" && skill.unlocked).id,
  });
  assert.equal(
    trainedSkill.hero.skills.find((skill) => skill.source === "basic" && skill.unlocked).level,
    2,
  );
  console.log("3. 基础技能训练成功（消耗经验点/金币）");

  const duel = await api("a", "POST", "/colosseum/duel", {
    heroId: a1.id,
    opponentHeroId: b1.id,
  });
  assert.ok(duel.duel.log.length > 0);
  assert.ok(duel.duel.ratingChanges);
  const arena = (await api("a", "GET", "/colosseum/leaderboard")).entries;
  assert.ok(arena.some((entry) => entry.heroId === a1.id || entry.heroId === b1.id));
  console.log("4. 竞技场决斗完成，获得经验点/积分并进入排名");

  const group = (await api("a", "POST", "/groups", { name: "流程验证队" })).group;
  await api("b", "POST", "/groups/join", { code: group.joinCode });
  await api("c", "POST", `/groups/${group.id}/join`);
  for (const [who, hero, position] of [
    ["a", a1, "front"],
    ["b", b1, "flank"],
    ["c", c1, "back"],
  ]) {
    await api(who, "POST", `/groups/${group.id}/heroes`, { heroId: hero.id, position });
    // 撤离条件：推进 1 个房间后全员撤离，保证测试无人永久死亡。
    await api(who, "POST", `/groups/${group.id}/hero-settings`, {
      heroId: hero.id,
      settings: { evacuation: { type: "rooms", value: 1 } },
    });
  }
  console.log("5. 组队大厅创建/加入/三人站位（带撤离条件）完成");

  // 组队出发需要队长通知 + 全员准备（group ready flow）。
  await api("a", "POST", `/groups/${group.id}/queue`, { dungeonId: "pm-abandoned-mine-d0" });
  for (const who of ["b", "c"]) {
    await api(who, "POST", `/groups/${group.id}/ready`);
  }
  const started = await api("a", "POST", `/groups/${group.id}/start`);
  let expedition = null;
  for (let i = 0; i < 100; i += 1) {
    const data = await api("c", "GET", `/expeditions/${started.expeditionId}`);
    if (data.expedition.status === "completed" && data.expedition.result) {
      expedition = data.expedition;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.ok(expedition, "组队远征没有结算");
  assert.equal(expedition.result.groupShares.length, 3);
  assert.ok(expedition.result.rewards.items.every((item) => item.ownerName));
  console.log(
    `6. 组队地牢完成：${expedition.result.outcome === "victory" ? "胜利" : "失败"}，金币按 3 人分配，物品带归属`,
  );

  const inventoryA = (await api("a", "GET", "/inventory")).items;
  let sellable = inventoryA.find((item) => !item.equippedBy);
  if (!sellable) {
    await api("a", "POST", `/heroes/${a1.id}/unequip`, { slot: "weapon" });
    sellable = (await api("a", "GET", "/inventory")).items.find(
      (item) => !item.equippedBy,
    );
  }
  assert.ok(sellable);
  const goldABefore = (await api("a", "GET", "/auth/me")).user.gold;
  const listing = await api("a", "POST", "/market/list", {
    itemId: sellable.id,
    price: 40,
  });
  const bought = await api("b", "POST", `/market/${listing.listing.id}/buy`);
  const goldAAfter = (await api("a", "GET", "/auth/me")).user.gold;
  assert.equal(goldAAfter, goldABefore + 38); // 成交 40 金，扣除 5% 手续费实收 38
  assert.ok((await api("b", "GET", "/inventory")).items.some((item) => item.name === bought.item.name));
  console.log("7. 市场完成：上架 → 购买 → 金币与物品转移");

  const clan = (await api("a", "POST", "/clans", { name: "流程验证会", tag: "JRN" })).clan;
  await api("b", "POST", "/clans/join", { tag: "JRN" });
  await api("c", "POST", "/clans/join", { tag: "JRN" });
  await api("a", "POST", `/clans/${clan.id}/gold/deposit`, { amount: 10 });
  const treasuryItem = (await api("b", "GET", "/inventory")).items.find(
    (item) => !item.equippedBy,
  );
  assert.ok(treasuryItem);
  await api("b", "POST", `/clans/${clan.id}/items/deposit`, { itemId: treasuryItem.id });
  let treasury = await api("a", "GET", `/clans/${clan.id}/treasury`);
  assert.equal(treasury.gold, 10);
  assert.equal(treasury.items.length, 1);
  await api("a", "POST", `/clans/${clan.id}/items/${treasury.items[0].id}/withdraw`);
  treasury = await api("a", "GET", `/clans/${clan.id}/treasury`);
  assert.equal(treasury.items.length, 0);
  console.log("8. 公会完成：创建/三人加入/金币存入/物品存入/会长取出");

  await api("a", "POST", "/chat", { channel: "global", message: "流程验证：世界频道正常。" });
  await api("b", "POST", "/chat", { channel: "clan", message: "流程验证：公会频道正常。" });
  const globalChat = (await api("c", "GET", "/chat?channel=global")).messages;
  const clanChat = (await api("a", "GET", "/chat?channel=clan")).messages;
  assert.ok(globalChat.some((row) => row.message.includes("世界频道正常")));
  assert.ok(clanChat.some((row) => row.message.includes("公会频道正常")));
  console.log("9. 聊天完成：世界频道与公会频道均可用");

  const heroesA = (await api("a", "GET", "/heroes")).heroes;
  assert.ok(heroesA.every((hero) => hero.epEarned >= 500));
  const leaderboard = (await api("a", "GET", "/leaderboard")).entries;
  assert.ok(leaderboard.length >= 6);
  // 结算后队伍保留（回到 recruiting 待命状态）。
  assert.ok((await api("a", "GET", "/groups/mine")).group.status === "recruiting");
  console.log("10. 结算/排行榜/队伍状态检查通过");

  console.log("\n全流程走通：注册 → 建英雄 → 训练 → 竞技场 → 组队地牢 → 市场 → 公会金库 → 聊天 → 排行。");
} catch (error) {
  console.error(`\n全流程验证失败：${error.message}`);
  if (serverLog) console.error(serverLog);
  process.exitCode = 1;
} finally {
  server.kill();
  await new Promise((resolve) => setTimeout(resolve, 300));
  await rm(tempDir, { recursive: true, force: true });
}
