import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = 8792;
const base = `http://127.0.0.1:${port}/api`;
const tsxCli = path.join(root, "node_modules", "tsx", "dist", "cli.mjs");
if (!existsSync(tsxCli)) throw new Error("tsx missing");
const tempDir = await mkdtemp(path.join(os.tmpdir(), "wod-equipment-"));
const server = spawn(process.execPath, [tsxCli, path.join(root, "apps", "server", "src", "index.ts")], {
  cwd: root,
  env: {
    ...process.env,
    PORT: String(port),
    WOD_DATA_DIR: tempDir,
    WOD_TIME_SCALE: "0.01",
    WOD_ALLOW_SHARED_IP: "0",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "";
server.stdout.on("data", (chunk) => (serverLog += chunk.toString()));
server.stderr.on("data", (chunk) => (serverLog += chunk.toString()));

let cookie = "";

async function heroDraft(needWeapons = []) {
  for (let i = 0; i < 100; i += 1) {
    const draft = (await api("GET", "/heroes/draft")).draft;
    if (needWeapons.every((w) => draft.weaponTypes.includes(w))) return draft;
  }
  throw new Error("抽选 100 次仍未包含所需武器组合");
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

async function expectStatus(method, route, body, status, code) {
  const response = await fetch(`${base}${route}`, {
    method,
    headers: { "content-type": "application/json", cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => null);
  assert.equal(response.status, status, `${method} ${route} expected ${status}`);
  if (code) assert.equal(data?.error?.code, code);
  return data;
}

try {
  await waitForHealth();
  const username = `eq_${Date.now().toString(36)}`;
  const register = await fetch(`${base}/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password: "equipment-pass-123" }),
  });
  assert.equal(register.status, 201);
  cookie = register.headers.getSetCookie()[0].split(";")[0];
  const me = await api("GET", "/auth/me");
  console.log("✓ 注册账号");

  const a = (
    await (async () => {
      const draft = await heroDraft(["sword"]);
      return api("POST", "/heroes", {
        name: "装备甲",
        raceId: draft.raceIds[0],
        weaponType: "sword",
        draftId: draft.draftId,
      });
    })()
  ).hero;
  const b = (
    await (async () => {
      const draft = await heroDraft(["bow"]);
      return api("POST", "/heroes", {
        name: "装备乙",
        raceId: draft.raceIds[0],
        weaponType: "bow",
        draftId: draft.draftId,
      });
    })()
  ).hero;
  const c = (
    await (async () => {
      const draft = await heroDraft(["sword"]);
      return api("POST", "/heroes", {
        name: "装备丙",
        raceId: draft.raceIds[0],
        weaponType: "sword",
        draftId: draft.draftId,
      });
    })()
  ).hero;
  assert.ok(a.equipment.weapon && b.equipment.weapon && c.equipment.weapon);
  console.log("✓ 三名英雄各自装备初始武器");

  const classError = await expectStatus(
    "POST",
    `/heroes/${a.id}/equip`,
    { itemId: b.equipment.weapon.id },
    400,
    "weapon_requirement",
  );
  assert.match(classError.error.message, /尚未掌握弓/);
  console.log("✓ 战士被禁止装备弓");

  const aOldWeapon = a.equipment.weapon;
  const cWeapon = c.equipment.weapon;
  const transferred = await api("POST", `/heroes/${a.id}/equip`, {
    itemId: cWeapon.id,
  });
  assert.equal(transferred.fromHero?.id, c.id);
  assert.equal(transferred.fromHero?.name, c.name);
  assert.equal(transferred.replacedItem?.id, aOldWeapon.id);
  assert.equal(transferred.hero.equipment.weapon?.id, cWeapon.id);
  const cAfter = (await api("GET", `/heroes/${c.id}`)).hero;
  assert.equal(cAfter.equipment.weapon, null);
  const inventoryAfterTransfer = (await api("GET", "/inventory")).items;
  const oldWeaponRow = inventoryAfterTransfer.find((item) => item.id === aOldWeapon.id);
  assert.ok(oldWeaponRow);
  assert.equal(oldWeaponRow.equippedBy, null);
  console.log("✓ 跨英雄直接转移同类型武器，旧武器回到背包");

  const highLevelItemId = `test-high-level-${Date.now().toString(36)}`;
  const highLevelRoll = {
    templateId: "iron-sword",
    name: "测试高等级剑",
    description: "仅用于验证装备等级门槛",
    slot: "weapon",
    rarity: "common",
    level: 5,
    stats: { str: 1 },
    weaponDamage: 6,
    damageType: "cutting",
    weaponType: "sword",
    affixes: [],
    value: 18,
  };
  const db = new DatabaseSync(path.join(tempDir, "wod.db"));
  db.exec("PRAGMA busy_timeout = 5000");
  db.prepare(
    `INSERT INTO inventory_items
       (id, user_id, template_id, data_json, acquired_at, equipped_by, equipped_slot)
     VALUES (?, ?, ?, ?, ?, NULL, NULL)`,
  ).run(
    highLevelItemId,
    me.user.id,
    highLevelRoll.templateId,
    JSON.stringify(highLevelRoll),
    Date.now(),
  );
  db.close();

  const levelError = await expectStatus(
    "POST",
    `/heroes/${a.id}/equip`,
    { itemId: highLevelItemId },
    400,
    "level_requirement",
  );
  assert.match(levelError.error.message, /等级不足/);
  const afterLevelError = (await api("GET", "/inventory")).items.find(
    (item) => item.id === highLevelItemId,
  );
  assert.equal(afterLevelError.equippedBy, null);
  console.log("✓ 高等级装备被英雄等级门槛拒绝");

  const unequipped = await api("POST", `/heroes/${a.id}/unequip`, { slot: "armor" });
  assert.ok(unequipped.item?.id);
  const inventoryAfterUnequip = (await api("GET", "/inventory")).items;
  const armorRow = inventoryAfterUnequip.find((item) => item.id === unequipped.item.id);
  assert.ok(armorRow);
  assert.equal(armorRow.equippedBy, null);
  console.log("✓ 卸下装备返回物品并回到背包");

  console.log("\n装备接口冒烟测试全部通过。");
} catch (error) {
  console.error(`\n装备接口冒烟测试失败：${error.message}`);
  if (serverLog) console.error(serverLog);
  process.exitCode = 1;
} finally {
  server.kill();
  await new Promise((resolve) => setTimeout(resolve, 300));
  await rm(tempDir, { recursive: true, force: true });
}
