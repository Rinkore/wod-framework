import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = 8798;
const base = `http://127.0.0.1:${port}/api`;
const tsxCli = path.join(root, "node_modules", "tsx", "dist", "cli.mjs");
if (!existsSync(tsxCli)) throw new Error(`找不到 tsx: ${tsxCli}`);
const tempDir = await mkdtemp(path.join(os.tmpdir(), "wod-group-"));
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
  for (let i = 0; i < 120; i += 1) {
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
  const cookie = cookies.get(who);
  const response = await fetch(`${base}${route}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`${who} ${method} ${route} -> ${response.status}: ${data?.error?.message}`);
  }
  return data;
}

async function expectStatus(who, method, route, body, status) {
  const cookie = cookies.get(who);
  const response = await fetch(`${base}${route}`, {
    method,
    headers: { "content-type": "application/json", cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  assert.equal(response.status, status, `${route} expected ${status}`);
}

async function register(key, username) {
  const response = await fetch(`${base}/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password: "group-pass-123" }),
  });
  assert.equal(response.status, 201, `register ${username}`);
  cookies.set(key, response.headers.getSetCookie()[0].split(";")[0]);
}

const HERO_PLAN = {
  a: [
    ["战士甲", "borderlander", "sword"],
    ["猎人甲", "woodlander", "bow"],
    ["法师甲", "partan", "staff"],
    ["牧师甲", "dinturan", "book"],
    ["角斗甲", "targeshian", "dagger"],
  ],
  b: [["牧师乙", "dinturan", "book"]],
  c: [["诗人丙", "halfling", "instrument"]],
};

try {
  await waitForHealth();
  const suffix = Date.now().toString(36);
  await Promise.all(
    ["a", "b", "c"].map((who) => register(who, `grp_${who}_${suffix}`)),
  );
  console.log("✓ 注册 3 个模拟玩家（共享网络测试模式）");

  const heroIds = {};
  for (const [who, plan] of Object.entries(HERO_PLAN)) {
    heroIds[who] = [];
    for (const [name] of plan) {
      const draft = (await api(who, "GET", "/heroes/draft")).draft;
      const data = await api(who, "POST", "/heroes", {
        name,
        raceId: draft.raceIds[0],
        weaponType: draft.weaponTypes[0],
        draftId: draft.draftId,
      });
      heroIds[who].push(data.hero.id);
    }
  }
  console.log("✓ 创建 9 名英雄（A 5 名 = 名册上限，用于测试队伍容量）");

  const created = await api("a", "POST", "/groups", { name: "边境联合队" });
  const group = created.group;
  assert.equal(group.status, "recruiting");
  assert.equal(group.members.length, 1);
  console.log(`✓ 创建队伍，邀请码 ${group.joinCode}`);

  await api("b", "POST", "/groups/join", { code: group.joinCode });
  await api("c", "POST", `/groups/${group.id}/join`);
  console.log("✓ B 用邀请码、C 用公开列表加入");

  for (const [index, heroId] of heroIds.a.slice(0, 4).entries()) {
    await api("a", "POST", `/groups/${group.id}/heroes`, {
      heroId,
      position: ["front", "flank", "back"][index % 3],
    });
    // 撤离条件：推进 1 房后撤离，确保无人死亡、EP 全额。
    await api("a", "POST", `/groups/${group.id}/hero-settings`, {
      heroId,
      settings: { evacuation: { type: "rooms", value: 1 } },
    });
  }
  await expectStatus(
    "a",
    "POST",
    `/groups/${group.id}/heroes`,
    { heroId: heroIds.a[4], position: "front" },
    409,
  );
  assert.equal(
    (await fetch(`${base}/groups/mine`, { headers: { cookie: cookies.get("a") } })).status,
    200,
  );
  const filled = (await api("a", "GET", "/groups/mine")).group;
  assert.equal(filled.heroes.length, 4);
  assert.ok(filled.heroes.every((hero) => hero.userId === filled.leaderUserId));
  console.log("✓ 单账号 4 名英雄填满队伍，第 5 名被队伍容量拒绝");

  // 组队出发需要队长通知 + 全员准备（group ready flow）。
  await api("a", "POST", `/groups/${group.id}/queue`, { dungeonId: "pm-abandoned-mine-d0" });
  for (const who of ["b", "c"]) {
    await api(who, "POST", `/groups/${group.id}/ready`);
  }
  const started = await api("a", "POST", `/groups/${group.id}/start`);
  assert.ok(started.expeditionId);
  console.log("✓ 队长通知、全员准备后开始组队远征");

  const memberView = await api("b", "GET", `/expeditions/${started.expeditionId}`);
  assert.ok(memberView.expedition);
  console.log("✓ 队员可以查看组队远征");

  let expedition = null;
  for (let i = 0; i < 80; i += 1) {
    const data = await api("b", "GET", `/expeditions/${started.expeditionId}`);
    if (data.expedition.status === "completed" && data.expedition.result) {
      expedition = data.expedition;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  assert.ok(expedition, "组队远征没有结算");
  console.log(
    `✓ 组队远征结算：${expedition.result.outcome === "victory" ? "胜利" : "失败"}，${expedition.result.rewards.ep} EP`,
  );

  assert.equal(expedition.result.groupShares?.length, 1);
  assert.ok(expedition.result.groupShares.every((share) => share.gold > 0));
  assert.ok(expedition.result.rewards.items.every((item) => item.ownerName));
  const completedGroup = (await api("a", "GET", "/groups/mine")).group;
  // 结算后队伍保留（回到待命状态），清空通知与响应状态。
  assert.equal(completedGroup.status, "recruiting");
  assert.equal(completedGroup.expeditionId, null);
  assert.equal(completedGroup.queue, null);
  const participating = new Set(filled.heroes.map((hero) => hero.heroId));
  const heroesA = (await api("a", "GET", "/heroes")).heroes;
  const participants = heroesA.filter((hero) => participating.has(hero.id));
  assert.equal(participants.length, 4);
  assert.ok(participants.every((hero) => hero.epEarned > 500), "A 的参战英雄没有获得 EP");
  assert.ok((await api("a", "GET", "/auth/me")).user.gold > 100, "A 没有收到组队金币分配");
  for (const who of ["b", "c"]) {
    const me = await api(who, "GET", "/auth/me");
    assert.equal(me.user.gold, 100, `${who} 没有派英雄，不应分到金币`);
  }
  console.log("✓ 组队结算后参战英雄获得 EP，参战账号获得金币，队伍状态为已完成");

  for (const who of ["a", "b", "c"]) {
    const unread = await api(who, "GET", "/expeditions/unread");
    assert.equal(unread.count, 1, `${who} 看不到组队未读战报`);
  }
  await api("b", "POST", `/expeditions/${expedition.id}/read`);
  assert.equal((await api("b", "GET", "/expeditions/unread")).count, 0);
  assert.equal((await api("a", "GET", "/expeditions/unread")).count, 1);
  console.log("✓ 未读战报按玩家独立标记");

  await api("b", "POST", `/groups/${group.id}/leave`);
  const afterLeave = (await api("a", "GET", "/groups/mine")).group;
  assert.equal(afterLeave.members.length, 2);
  console.log("✓ 队员离队后队伍仍保留");

  console.log("\n组队冒烟测试全部通过。");
} catch (error) {
  console.error(`\n组队冒烟测试失败：${error.message}`);
  if (serverLog) console.error(serverLog);
  process.exitCode = 1;
} finally {
  server.kill();
  await new Promise((resolve) => setTimeout(resolve, 300));
  await rm(tempDir, { recursive: true, force: true });
}
