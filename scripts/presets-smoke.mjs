import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = 8789;
const base = `http://127.0.0.1:${port}/api`;
const tsxCli = path.join(root, "node_modules", "tsx", "dist", "cli.mjs");
if (!existsSync(tsxCli)) throw new Error("tsx missing");
const tempDir = await mkdtemp(path.join(os.tmpdir(), "wod-presets-"));
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
  const register = await fetch(`${base}/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      username: `preset_${Date.now().toString(36)}`,
      password: "preset-pass-123",
    }),
  });
  assert.equal(register.status, 201);
  cookie = register.headers.getSetCookie()[0].split(";")[0];
  const hero = (
    await (async () => {
      const draft = await heroDraft();
      return api("POST", "/heroes", {
        name: "预设测试者",
        raceId: draft.raceIds[0],
        weaponType: draft.weaponTypes[0],
        draftId: draft.draftId,
      });
    })()
  ).hero;
  console.log("✓ 注册并创建英雄");

  let presets = (await api("GET", `/heroes/${hero.id}/presets`)).presets;
  assert.equal(presets.length, 1);
  assert.equal(presets[0].name, "默认");
  assert.equal(presets[0].position, "front");
  assert.equal(presets[0].isDefault, true);
  console.log("✓ 新英雄自动获得默认预设");

  const second = (
    await api("POST", `/heroes/${hero.id}/presets`, {
      name: "后排",
      position: "back",
    })
  ).preset;
  assert.equal(second.position, "back");
  await api("POST", `/heroes/${hero.id}/presets/${second.id}/default`);
  presets = (await api("GET", `/heroes/${hero.id}/presets`)).presets;
  assert.equal(presets[0].id, second.id);
  assert.equal(presets[0].isDefault, true);
  console.log("✓ 新建预设并切换默认");

  const updated = (
    await api("PATCH", `/heroes/${hero.id}/presets/${second.id}`, {
      name: "游走",
      position: "flank",
    })
  ).preset;
  assert.equal(updated.name, "游走");
  assert.equal(updated.position, "flank");
  console.log("✓ 编辑预设名称与站位");

  for (let i = 0; i < 3; i += 1) {
    await api("POST", `/heroes/${hero.id}/presets`, {
      name: `额外 ${i + 1}`,
      position: "front",
    });
  }
  await expectStatus(
    "POST",
    `/heroes/${hero.id}/presets`,
    { name: "第六套", position: "front" },
    409,
    "preset_limit",
  );
  console.log("✓ 每个英雄最多 5 套预设");

  await api("DELETE", `/heroes/${hero.id}/presets/${second.id}`);
  presets = (await api("GET", `/heroes/${hero.id}/presets`)).presets;
  assert.equal(presets.some((row) => row.id === second.id), false);
  assert.equal(presets.filter((row) => row.isDefault).length, 1);
  console.log("✓ 删除默认预设后自动补默认");

  for (const preset of presets.slice(1)) {
    await api("DELETE", `/heroes/${hero.id}/presets/${preset.id}`);
  }
  await expectStatus(
    "DELETE",
    `/heroes/${hero.id}/presets/${presets[0].id}`,
    undefined,
    400,
    "preset_minimum",
  );
  console.log("✓ 至少保留一套预设");

  const all = (await api("GET", "/heroes/presets")).presets;
  assert.ok(all.every((row) => row.heroId === hero.id));
  console.log("✓ 全量预设列表按英雄返回");

  console.log("\n战斗预设冒烟测试全部通过。");
} catch (error) {
  console.error(`\n战斗预设冒烟测试失败：${error.message}`);
  if (serverLog) console.error(serverLog);
  process.exitCode = 1;
} finally {
  server.kill();
  await new Promise((resolve) => setTimeout(resolve, 300));
  await rm(tempDir, { recursive: true, force: true });
}
