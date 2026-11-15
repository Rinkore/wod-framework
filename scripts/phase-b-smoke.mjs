import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = 8797;
const base = `http://127.0.0.1:${port}/api`;
const tsxCli = path.join(root, "node_modules", "tsx", "dist", "cli.mjs");
if (!existsSync(tsxCli)) throw new Error("tsx missing");
const tempDir = await mkdtemp(path.join(os.tmpdir(), "wod-phase-b-"));
const dbPath = path.join(tempDir, "wod.db");
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
  for (let i = 0; i < 100; i += 1) {
    const draft = (await api("GET", "/heroes/draft")).draft;
    if (needWeapons.every((w) => draft.weaponTypes.includes(w))) return draft;
  }
  throw new Error("抽选 100 次仍未包含所需武器组合");
}

async function waitForHealth() {
  for (let i = 0; i < 120; i += 1) {
    try {
      if ((await fetch(`${base}/health`)).ok) return;
    } catch {
      // wait
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`server start timeout\n${serverLog}`);
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
  assert.equal(response.status, status, `${route} expected ${status}, got ${response.status}`);
  return response.json().catch(() => null);
}

function setLevel(level) {
  const ep = 1000 * (level - 1) ** 2;
  const db = new DatabaseSync(dbPath);
  db.prepare("UPDATE heroes SET level = ?, ep_earned = ?, xp = ?").run(level, ep, ep);
  db.close();
}

function heroSkills(hero) {
  return new Map(hero.skills.map((skill) => [skill.id, skill]));
}

try {
  await waitForHealth();
  const register = await fetch(`${base}/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "phaseb_smoke", password: "phaseb-pass-123" }),
  });
  assert.equal(register.status, 201, "register");
  cookie = register.headers.getSetCookie()[0].split(";")[0];

  const draft = await heroDraft(["sword"]);
  const created = await api("POST", "/heroes", {
    name: "音叉测试",
    raceId: draft.raceIds[0],
    weaponType: "sword",
    draftId: draft.draftId,
  });
  const heroId = created.hero.id;
  assert.deepEqual(
    created.hero.skills.map((skill) => skill.id).slice(0, 3),
    ["basic-attack", "power-attack", "heavy-strike"],
    "初始技能只有普攻/强力/武器根",
  );
  assert.equal(created.hero.skillPoints.total, 0);

  setLevel(8);
  const level8 = await api("POST", `/heroes/${heroId}/train/batch`, {
    unlocks: ["sword-stem-1", "block-stance", "sword-passive-a"],
  });
  assert.equal(level8.hero.skillPoints.spent, 4, "根免费；两柄+第一被动=4 点");
  assert.equal(level8.hero.skillPoints.available, 3);
  assert.equal(level8.hero.maxHp > 120, true, "第一被动已提供生命加成");
  assert.ok(level8.hero.weaponProficiencies.includes("axe"), "前哨训练授予斧熟练");

  const blocked = await expectStatus(
    "POST",
    `/heroes/${heroId}/train/batch`,
    { unlocks: ["sword-passive-b"] },
    400,
  );
  assert.match(blocked.error.message, /12/);

  setLevel(12);
  const level12 = await api("POST", `/heroes/${heroId}/train/batch`, {
    unlocks: ["sword-passive-b"],
  });
  assert.equal(level12.hero.skillPoints.available, 5);

  setLevel(40);
  const fullSword = await api("POST", `/heroes/${heroId}/train/batch`, {
    unlocks: [
      "provoke",
      "shield-bash",
      "sword-link-left",
      "sword-mechanic-b",
      "sword-terminal-b",
      "sword-link-right",
    ],
  });
  assert.equal(fullSword.hero.skillPoints.spent, 22, "完整剑树 22 点");
  assert.equal(fullSword.hero.skillPoints.available, 17);

  let skills = heroSkills(fullSword.hero);
  assert.equal(skills.get("requiem").canUnlock, true, "连接点应打开乐器末端");
  assert.equal(skills.get("axe-terminal-a").canUnlock, true, "连接点应打开斧末端");
  assert.equal(skills.get("hypnotize").canUnlock, false, "末端未解锁时不能向内走");

  const enterNeighbor = await api("POST", `/heroes/${heroId}/train/batch`, {
    unlocks: ["requiem"],
  });
  skills = heroSkills(enterNeighbor.hero);
  assert.equal(skills.get("requiem").unlocked, true);
  assert.equal(skills.get("hypnotize").canUnlock, true, "进入末端后可向内解锁机制");
  assert.equal(skills.get("discordant-note").canUnlock, false, "不能跳跃解锁邻树根");

  const inward = await api("POST", `/heroes/${heroId}/train/batch`, {
    unlocks: [
      "hypnotize",
      "instrument-passive-b",
      "inspiring-note",
      "instrument-stem-1",
      "discordant-note",
    ],
  });
  skills = heroSkills(inward.hero);
  for (const id of [
    "requiem",
    "hypnotize",
    "instrument-passive-b",
    "inspiring-note",
    "instrument-stem-1",
    "discordant-note",
  ]) {
    assert.equal(skills.get(id).unlocked, true, `${id} 应已解锁`);
  }
  assert.ok(inward.hero.weaponProficiencies.includes("instrument"), "邻树根授予乐器熟练");
  assert.equal(inward.hero.skillPoints.spent, 33, "剑树 22 + 邻树向内 11");
  assert.equal(inward.hero.skillPoints.available, 6);
  assert.ok(
    inward.hero.skills.some((skill) => skill.id === "requiem" && skill.unlocked),
    "跨树技能进入英雄技能列表",
  );

  console.log("Phase B smoke 通过：音叉结构 / 8/12 级被动 / 跨树连接 / 向内解锁。");
} finally {
  server.kill();
  await new Promise((resolve) => {
    if (server.exitCode !== null) resolve(undefined);
    else server.once("exit", resolve);
  });
  await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
}
