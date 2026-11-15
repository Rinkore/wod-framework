import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = 8801;
const base = `http://127.0.0.1:${port}/api`;
const tsxCli = path.join(root, "node_modules", "tsx", "dist", "cli.mjs");

const tempDir = await mkdtemp(path.join(os.tmpdir(), "wod-quest-smoke-"));
const env = {
  ...process.env,
  PORT: String(port),
  WOD_DATA_DIR: tempDir,
  WOD_TIME_SCALE: "0.02",
  WOD_SECURE_COOKIES: "0",
  WOD_ALLOW_SHARED_IP: "0",
};

const server = spawn(
  process.execPath,
  [tsxCli, path.join(root, "apps", "server", "src", "index.ts")],
  { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] },
);
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
      // not ready
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

async function waitForExpedition(id) {
  for (let i = 0; i < 150; i += 1) {
    const data = await api("GET", `/expeditions/${id}`);
    if (data.expedition.status === "completed" && data.expedition.result) {
      return data.expedition;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("远征没有在预期时间内完成");
}

async function dispatchMine(heroes) {
  const data = await api("POST", "/expeditions", {
    dungeonId: "pm-abandoned-mine-d0",
    heroIds: heroes.slice(0, 4).map((hero) => hero.id),
    positions: Object.fromEntries(
      heroes.map((hero) => [
        hero.id,
        hero.pathWeaponType === "sword" || hero.pathWeaponType === "dagger"
          ? "front"
          : "back",
      ]),
    ),
  });
  return waitForExpedition(data.expedition.id);
}

async function healInjured() {
  const heroesNow = (await api("GET", "/heroes")).heroes;
  for (const hero of heroesNow) {
    if (hero.injuredUntil) {
      await api("POST", `/heroes/${hero.id}/heal`);
    }
  }
}

try {
  await waitForHealth();

  const username = `quest_${Date.now().toString(36)}`;
  const registerRes = await fetch(`${base}/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password: "quest-pass-123" }),
  });
  assert.equal(registerRes.status, 201, "注册失败");
  const cookies = registerRes.headers.getSetCookie();
  cookie = cookies[0].split(";")[0];

  const content = (await api("GET", "/content")).content;
  assert.ok(content.quests.length >= 10, "任务内容未加载");
  assert.ok(content.titles.length >= 10, "称号内容未加载");

  const heroes = [];
  for (let index = 0; index < 5; index += 1) {
    const draft = await heroDraft();
    const data = await api("POST", "/heroes", {
      name: `任务测试${index + 1}`,
      raceId: draft.raceIds[0],
      weaponType: draft.weaponTypes[0],
      draftId: draft.draftId,
    });
    heroes.push(data.hero);
  }
  console.log("✓ 注册并创建 5 名英雄");

  // 永久死亡后战败代价过高：直接把测试英雄提到 7 级，保证能通关废弃矿坑。
  const db = new DatabaseSync(tempDir + "/wod.db");
  db.exec("PRAGMA busy_timeout = 5000");
  const meRow = (await api("GET", "/auth/me")).user;
  db.prepare("UPDATE heroes SET ep_earned = 36000, xp = 36000 WHERE user_id = ?").run(meRow.id);
  db.close();
  console.log("✓ 测试英雄已提升到 7 级");

  const first = await dispatchMine(heroes);
  assert.equal(first.result.outcome, "victory", "首次矿坑没有通关");

  let quests = (await api("GET", "/quests")).quests;
  const firstQuest = quests.find((quest) => quest.id === "first-light");
  assert.equal(firstQuest?.status, "completed", "首个任务没有完成");
  const cryptQuest = quests.find((quest) => quest.id === "crypt-whispers");
  assert.equal(cryptQuest?.status, "locked", "未领取前置时后续任务不应解锁");
  const cryptWatch = quests.find((quest) => quest.id === "crypt-watch");
  assert.equal(cryptWatch?.status, "locked", "未满足前置的任务不应解锁");
  console.log("✓ 任务进度与解锁链正确");

  const claim = await api("POST", `/quests/first-light/claim`, {
    heroId: heroes[0].id,
  });
  assert.equal(claim.quest.status, "claimed", "任务没有标记为已领取");
  assert.ok(claim.hero.fame >= 2, "任务声望没有发放");
  assert.ok(claim.user.gold >= 160, "任务金币没有发放");
  quests = (await api("GET", "/quests")).quests;
  assert.equal(
    quests.find((quest) => quest.id === "crypt-whispers")?.status,
    "active",
    "领取前置后后续任务没有解锁",
  );
  console.log("✓ 领取任务奖励：金币、EP、声望；后续任务解锁");

  const again = await fetch(`${base}/quests/first-light/claim`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ heroId: heroes[0].id }),
  });
  assert.equal(again.status, 400, "重复领取没有被拒绝");
  console.log("✓ 重复领取被拒绝");

  // first-light 领取后，再清三次矿坑，完成 mine-echoes 并触发声望称号。
  for (let i = 0; i < 3; i += 1) {
    await healInjured();
    const result = await dispatchMine(heroes);
    assert.equal(result.result.outcome, "victory", "后续矿坑没有通关");
  }
  quests = (await api("GET", "/quests")).quests;
  const echoes = quests.find((quest) => quest.id === "mine-echoes");
  assert.equal(echoes?.status, "completed", "三次矿坑任务没有完成");
  const echoesClaim = await api("POST", `/quests/mine-echoes/claim`, {
    heroId: heroes[0].id,
  });
  assert.ok(echoesClaim.hero.fame >= 6, "累计声望不足");

  const titles = await api("GET", `/heroes/${heroes[0].id}/titles`);
  assert.ok(
    titles.titles.some((title) => title.id === "fame-5"),
    "声望称号没有自动解锁",
  );
  assert.ok(titles.activeTitleId, "解锁后没有自动展示称号");
  console.log("✓ 声望累积并自动解锁/展示称号");

  const hero = (await api("GET", `/heroes/${heroes[0].id}`)).hero;
  assert.ok(hero.fame >= 6, "英雄视图缺少声望");
  assert.ok(hero.activeTitle, "英雄视图缺少当前称号");
  console.log("✓ 英雄视图返回声望与当前称号");

  console.log("\n任务冒烟测试全部通过。");
} catch (error) {
  console.error(`\n任务冒烟测试失败：${error.message}`);
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
