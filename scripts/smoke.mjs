import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = 8799;
const base = `http://127.0.0.1:${port}/api`;
const tsxCli = path.join(root, "node_modules", "tsx", "dist", "cli.mjs");
if (!existsSync(tsxCli)) {
  console.error(`找不到 tsx：${tsxCli}，请先 npm install`);
  process.exit(1);
}

const tempDir = await mkdtemp(path.join(os.tmpdir(), "wod-smoke-"));
const env = {
  ...process.env,
  PORT: String(port),
  WOD_DATA_DIR: tempDir,
  WOD_TIME_SCALE: "0.02",
  WOD_SECURE_COOKIES: "0",
  WOD_ALLOW_SHARED_IP: "0",
};

const server = spawn(process.execPath, [tsxCli, path.join(root, "apps", "server", "src", "index.ts")], {
  cwd: root,
  env,
  stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "";
server.stdout.on("data", (chunk) => {
  serverLog += chunk.toString();
});
server.stderr.on("data", (chunk) => {
  serverLog += chunk.toString();
});

let cookie = "";

async function heroDraft(needWeapons = []) {
  for (let i = 0; i < 100; i += 1) {
    const draft = (await api("GET", "/heroes/draft")).draft;
    if (needWeapons.every((w) => draft.weaponTypes.includes(w))) return draft;
  }
  throw new Error("抽选 100 次仍未包含所需武器组合");
}

async function waitForHealth() {
  for (let i = 0; i < 120; i += 1) {
    try {
      const res = await fetch(`${base}/health`);
      if (res.ok) return;
    } catch {
      // server not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`服务端启动超时\n${serverLog}`);
}

async function api(method, route, body) {
  const res = await fetch(`${base}${route}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(`${method} ${route} -> ${res.status}: ${data?.error?.message ?? "未知错误"}`);
  }
  return data;
}

try {
  await waitForHealth();
  console.log("✓ 健康检查");

  const content = (await api("GET", "/content")).content;
  assert.ok(content.weapons.length >= 8, "内容包武器数量不足");
  console.log(`✓ 内容包：${content.name}，${content.weapons.length} 武器 / ${content.dungeons.length} 地牢`);

  const username = `smoke_${Date.now().toString(36)}`;
  const registerRes = await fetch(`${base}/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password: "smoke-pass-123" }),
  });
  assert.equal(registerRes.status, 201, "注册失败");
  const cookies = registerRes.headers.getSetCookie();
  assert.ok(cookies.length > 0, "注册后没有设置会话 Cookie");
  cookie = cookies[0].split(";")[0];
  console.log("✓ 注册与会话");

  const secondRegister = await fetch(`${base}/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: `${username}_2`, password: "smoke-pass-123" }),
  });
  assert.equal(secondRegister.status, 409, "同一网络下仍然可以注册第二个账号");
  const secondRegisterBody = await secondRegister.json();
  assert.equal(secondRegisterBody.error?.code, "account_exists_for_network");
  console.log("✓ 同一网络第二个账号被拒绝");

  const me = await api("GET", "/auth/me");
  assert.equal(me.user.username, username);
  assert.equal(me.user.gold, 100);

  const created = [];
  for (let index = 0; index < 5; index += 1) {
    const draft = await heroDraft();
    const path = content.weapons.find((row) => row.id === draft.weaponTypes[0]);
    const data = await api("POST", "/heroes", {
      name: `测试${path.name}${index + 1}`,
      raceId: draft.raceIds[0],
      weaponType: draft.weaponTypes[0],
      draftId: draft.draftId,
    });
    created.push(data.hero);
  }
  assert.equal(created.length, 5);
  assert.ok(created[0].equipment.weapon, "初始武器没有自动装备");

  const overflow = await fetch(`${base}/heroes`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({
      name: "测试第六人",
      raceId: "dinturan",
      weaponType: "book",
      draftId: (await heroDraft()).draftId,
    }),
  });
  assert.equal(overflow.status, 409, "单账号仍然可以创建第 6 名英雄");
  const overflowBody = await overflow.json();
  assert.equal(overflowBody.error?.code, "roster_full");
  console.log("✓ 创建 5 名英雄（满席位），第 6 名被拒绝");

  // 永久死亡后战败代价过高：把测试英雄提到 7 级，保证能通关废弃矿坑。
  const boostDb = new DatabaseSync(tempDir + "/wod.db");
  boostDb.exec("PRAGMA busy_timeout = 5000");
  boostDb.prepare("UPDATE heroes SET ep_earned = 36000, xp = 36000").run();
  boostDb.prepare("UPDATE users SET gold = 20000").run();
  boostDb.close();
  console.log("✓ 测试英雄已提升到 7 级");

  const skillToTrain = created[0].skills.find(
    (skill) => skill.source === "basic" && skill.unlocked,
  );
  const trainedSkill = await api("POST", `/heroes/${created[0].id}/train`, {
    target: "skill",
    key: skillToTrain.id,
  });
  assert.equal(
    trainedSkill.hero.skills.find((skill) => skill.id === skillToTrain.id).level,
    2,
    "技能训练没有生效",
  );
  assert.ok(trainedSkill.cost.gold > 0, "技能训练没有扣除金币");
  console.log("✓ 基础技能训练扣除 EP/金币并提升等级");

  const combatants = created.slice(0, 4);
  const dispatch = await api("POST", "/expeditions", {
    dungeonId: "pm-abandoned-mine-d0",
    heroIds: combatants.map((hero) => hero.id),
    positions: Object.fromEntries(
      combatants.map((hero, index) => [hero.id, ["front", "flank", "back"][index % 3]]),
    ),
  });
  assert.equal(dispatch.expedition.status, "running");
  console.log(`✓ 派出远征队（${dispatch.expedition.dungeonName}）`);

  let expedition = null;
  for (let i = 0; i < 100; i += 1) {
    const data = await api("GET", `/expeditions/${dispatch.expedition.id}`);
    if (data.expedition.status === "completed" && data.expedition.result) {
      expedition = data.expedition;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  assert.ok(expedition, "远征没有在预期时间内完成");
  assert.ok(expedition.result.encounters.length > 0, "远征结果没有战斗日志");
  console.log(
    `✓ 远征结算：${expedition.result.outcome === "victory" ? "胜利" : "失败"}，${expedition.result.summary.rounds} 回合，${expedition.result.rewards.gold} 金币 / ${expedition.result.rewards.ep} EP`,
  );

  const npcDispatch = await api("POST", "/expeditions", {
    dungeonId: "pm-abandoned-mine-d0",
    heroIds: created.slice(0, 3).map((hero) => hero.id),
    npcIds: ["npc-warrior", "npc-priest"],
  });
  assert.equal(npcDispatch.expedition.npcs?.length, 2, "NPC 支援没有进入远征");
  let npcExpedition = null;
  for (let i = 0; i < 100; i += 1) {
    const data = await api("GET", `/expeditions/${npcDispatch.expedition.id}`);
    if (data.expedition.status === "completed" && data.expedition.result) {
      npcExpedition = data.expedition;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  assert.ok(npcExpedition, "带 NPC 的远征没有在预期时间内完成");
  assert.equal(npcExpedition.result.npcs?.length, 2, "战报缺少 NPC 支援");
  assert.equal(npcExpedition.result.perHero.length, 3, "NPC 被错误计入英雄结算");
  await api("POST", `/expeditions/${npcExpedition.id}/read`);
  console.log("✓ 3 名英雄 + 2 名 NPC 支援完成远征");

  const overCap = await fetch(`${base}/expeditions`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({
      dungeonId: "pm-abandoned-mine-d0",
      heroIds: created.map((hero) => hero.id),
    }),
  });
  assert.equal(overCap.status, 400, "5 名英雄应被 4 人上限拒绝");
  const overCapBody = await overCap.json();
  assert.match(overCapBody.error?.message ?? "", /最多 4 名英雄/);
  console.log("✓ 派遣超过 4 名英雄被拒绝");

  const inlineHero = created[0];
  const inlineDispatch = await api("POST", "/expeditions", {
    dungeonId: "pm-abandoned-mine-d0",
    heroIds: created.slice(0, 3).map((hero) => hero.id),
    settingsByHero: {
      [inlineHero.id]: { targetPriority: "lowest-hp" },
    },
  });
  assert.equal(inlineDispatch.expedition.status, "running");
  let inlineExpedition = null;
  for (let i = 0; i < 100; i += 1) {
    const data = await api("GET", `/expeditions/${inlineDispatch.expedition.id}`);
    if (data.expedition.status === "completed" && data.expedition.result) {
      inlineExpedition = data.expedition;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  assert.ok(inlineExpedition, "带临时配置的远征没有在预期时间内完成");
  await api("POST", `/expeditions/${inlineExpedition.id}/read`);
  const presetsAfter = await api("GET", `/heroes/${inlineHero.id}/presets`);
  assert.ok(
    presetsAfter.presets.every(
      (preset) => preset.settings?.targetPriority !== "lowest-hp",
    ),
    "临时战前配置被写回了预设",
  );
  console.log("✓ 临时战前配置生效且未写回预设");

  const invalidInline = await fetch(`${base}/expeditions`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({
      dungeonId: "pm-abandoned-mine-d0",
      heroIds: created.slice(0, 3).map((hero) => hero.id),
      settingsByHero: {
        [created[4].id]: { targetPriority: "strongest" },
      },
    }),
  });
  assert.equal(invalidInline.status, 400, "未参战英雄的临时配置应被拒绝");
  console.log("✓ 临时配置包含未参战英雄被拒绝");

  const heroes = (await api("GET", "/heroes")).heroes;
  assert.ok(heroes.some((hero) => hero.epEarned > 500 || hero.level > 1), "没有英雄获得 EP");
  assert.ok(heroes.every((hero) => hero.busyExpeditionId === null), "结算后英雄仍被标记为忙碌");
  console.log("✓ 英雄 EP 与忙碌状态已更新");

  const unreadBefore = await api("GET", "/expeditions/unread");
  assert.equal(unreadBefore.count, 1, "完成的战报没有进入未读列表");
  await api("POST", `/expeditions/${expedition.id}/read`);
  const unreadAfter = await api("GET", "/expeditions/unread");
  assert.equal(unreadAfter.count, 0, "战报标记已读后仍在未读列表");
  console.log("✓ 未读战报列表与标记已读");

  const items = (await api("GET", "/inventory")).items;
  assert.ok(items.length >= 12, "初始物品数量不对");
  console.log(`✓ 背包共 ${items.length} 件物品`);

  const leaderboard = (await api("GET", "/leaderboard")).entries;
  assert.ok(leaderboard.length >= 5, "排行榜没有数据");
  console.log(`✓ 排行榜 ${leaderboard.length} 条`);

  const sellable = items.find((item) => !item.equippedBy);
  if (sellable) {
    const beforeSell = (await api("GET", "/auth/me")).user.gold;
    const sold = await api("POST", `/inventory/${sellable.id}/sell`);
    assert.ok(sold.gold > beforeSell, "出售后金币没有增加");
    console.log(`✓ 出售「${sold.item.name}」获得 ${sold.price} 金币`);
  }

  const logout = await fetch(`${base}/auth/logout`, {
    method: "POST",
    headers: { cookie },
  });
  assert.ok(logout.ok);
  const unauthorizedRes = await fetch(`${base}/auth/me`, { headers: { cookie } });
  assert.equal(unauthorizedRes.status, 401, "登出后会话仍然有效");
  console.log("✓ 登出后会话失效");

  console.log("\n冒烟测试全部通过。");
} catch (error) {
  console.error(`\n冒烟测试失败：${error.message}`);
  if (serverLog) console.error(`\n服务端日志：\n${serverLog}`);
  process.exitCode = 1;
} finally {
  server.kill();
  await new Promise((resolve) => setTimeout(resolve, 300));
  await rm(tempDir, { recursive: true, force: true });
}
