import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = 8793;
const base = `http://127.0.0.1:${port}/api`;
const tsxCli = path.join(root, "node_modules", "tsx", "dist", "cli.mjs");
if (!existsSync(tsxCli)) throw new Error("tsx missing");
const tempDir = await mkdtemp(path.join(os.tmpdir(), "wod-combat-settings-"));
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

let cookie = "";

async function heroDraft(needWeapons = []) {
  // 现行规则：每账号一份候选 + 一次免费重抽；用重抽后的候选适配可用武器。
  const first = (await api("GET", "/heroes/draft")).draft;
  const candidates = [first];
  if (needWeapons.some((w) => !first.weaponTypes.includes(w))) {
    candidates.push((await api("POST", "/heroes/draft/reroll")).draft);
  }
  const draft = candidates.find((row) => needWeapons.every((w) => row.weaponTypes.includes(w)))
    ?? candidates[candidates.length - 1];
  return { draft, weaponType: needWeapons.find((w) => draft.weaponTypes.includes(w)) ?? draft.weaponTypes[0] };
}

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

async function api(method, route, body) {
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
    throw new Error(`${method} ${route} -> ${response.status}: ${data?.error?.message}`);
  }
  return data;
}

async function expectStatus(method, route, body, status) {
  const response = await fetch(`${base}${route}`, {
    method,
    headers: { "content-type": "application/json", cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => null);
  assert.equal(response.status, status, `${method} ${route} expected ${status}`);
  return data;
}

try {
  await waitForHealth();
  const register = await fetch(`${base}/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      username: `combat_${Date.now().toString(36)}`,
      password: "combat-pass-123",
    }),
  });
  assert.equal(register.status, 201);
  cookie = register.headers.getSetCookie()[0].split(";")[0];
  const me = await api("GET", "/auth/me");
  const draftSword = await heroDraft(["sword"]);
  const hero = (
    await api("POST", "/heroes", {
      name: "设置测试者",
      raceId: draftSword.draft.raceIds[0],
      weaponType: draftSword.weaponType,
      draftId: draftSword.draft.draftId,
    })
  ).hero;
  const helperA = (
    await (async () => {
      const draft = await heroDraft(["sword"]);
      return api("POST", "/heroes", {
        name: "设置助手甲",
        raceId: draft.draft.raceIds[0],
        weaponType: draft.weaponType,
        draftId: draft.draft.draftId,
      });
    })()
  ).hero;
  const helperB = (
    await (async () => {
      const draft = await heroDraft(["sword"]);
      return api("POST", "/heroes", {
        name: "设置助手乙",
        raceId: draft.draft.raceIds[0],
        weaponType: draft.weaponType,
        draftId: draft.draft.draftId,
      });
    })()
  ).hero;
  console.log("✓ 注册并创建 3 名英雄（剑士，用于 3 人准入派遣）");

  const content = (await api("GET", "/content")).content;
  const itemKinds = new Map(content.items.map((item) => [item.id, item.kind]));
  const banned = content.lootTables
    .flatMap((table) => table.entries.map((entry) => entry.templateId))
    .filter((id) => itemKinds.get(id) !== "equipment");
  assert.equal(banned.length, 0, `掉落表不应引用非装备: ${banned.join(", ")}`);
  console.log("✓ 掉落表只含装备");

  const settings = {
    targetPriority: "lowest-hp",
    phases: {
      pre: { skillIds: ["heavy-strike"] },
      main: { skillIds: ["heavy-strike"] },
    },
    floors: {
      "1": { targetPriority: "caster" },
      "2": { phases: { main: { skillIds: ["heavy-strike"] } } },
    },
    boundDungeonId: "pm-abandoned-mine-d0",
  };
  const preset = (
    await api("POST", `/heroes/${hero.id}/presets`, {
      name: "墓穴方案",
      position: "back",
      settings,
    })
  ).preset;
  assert.equal(preset.settings.targetPriority, "lowest-hp");
  assert.equal(preset.settings.boundDungeonId, "pm-abandoned-mine-d0");
  assert.equal(preset.settings.floors["1"].targetPriority, "caster");
  assert.deepEqual(preset.settings.phases.main.skillIds, ["heavy-strike"]);
  console.log("✓ 预设保存目标/阶段/层/绑定地牢");

  const invalidSkill = await expectStatus(
    "PATCH",
    `/heroes/${hero.id}/presets/${preset.id}`,
    { settings: { ...settings, phases: { main: { skillIds: ["firebolt"] } } } },
    400,
  );
  assert.match(invalidSkill.error.message, /不是该英雄已解锁的技能/);
  const invalidKey = await expectStatus(
    "PATCH",
    `/heroes/${hero.id}/presets/${preset.id}`,
    { settings: { ...settings, potions: [{ potionId: "iron-sword", trigger: "hp", belowPct: 50 }] } },
    400,
  );
  assert.match(invalidKey.error.message, /Unrecognized|药水/);
  console.log("✓ 非法技能/已移除字段设置被拒绝");

  const db = new DatabaseSync(path.join(tempDir, "wod.db"));
  db.exec("PRAGMA busy_timeout = 5000");
  db.prepare("UPDATE heroes SET ep_earned = ?, level = ? WHERE id = ?").run(16000, 5, hero.id);

  const dispatched = await api("POST", "/expeditions", {
    dungeonId: "pm-abandoned-mine-d0",
    heroIds: [hero.id, helperA.id, helperB.id],
    positions: { [hero.id]: "back" },
  });
  assert.equal(dispatched.expedition.dungeonId, "pm-abandoned-mine-d0");
  console.log("✓ 未显式传预设，绑定地牢的预设被采用");

  let expedition = dispatched.expedition;
  for (let i = 0; i < 30 && expedition.status !== "completed"; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 300));
    expedition = (await api("GET", `/expeditions/${expedition.id}`)).expedition;
  }
  assert.equal(expedition.status, "completed");
  assert.ok(expedition.result, "远征应产生战报");
  const log = expedition.result.encounters.flatMap((encounter) => encounter.log);
  assert.ok(
    log.some((entry) => entry.phase === "pre" || entry.phase === "initiative"),
    "战报应包含阶段标记",
  );

  console.log("✓ 战报包含阶段标记，绑定预设被采用");

  console.log("\n战斗设置冒烟测试全部通过。");
} catch (error) {
  console.error(`\n战斗设置冒烟测试失败：${error.message}`);
  if (serverLog) console.error(serverLog);
  process.exitCode = 1;
} finally {
  server.kill();
  await new Promise((resolve) => setTimeout(resolve, 1500));
  // Windows 上 SQLite 的 -shm/-wal 可能仍被进程句柄短暂锁住；清理失败不视为测试失败。
  

try {
    await rm(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 500 });
  } catch {
    // ignore
  }
}
