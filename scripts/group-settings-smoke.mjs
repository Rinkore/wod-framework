import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = 8802;
const base = `http://127.0.0.1:${port}/api`;
const tsxCli = path.join(root, "node_modules", "tsx", "dist", "cli.mjs");
const tempDir = await mkdtemp(path.join(os.tmpdir(), "wod-group-settings-"));
const server = spawn(
  process.execPath,
  [tsxCli, path.join(root, "apps", "server", "src", "index.ts")],
  {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      WOD_DATA_DIR: tempDir,
      WOD_TIME_SCALE: "0.01",
      WOD_ALLOW_SHARED_IP: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let serverLog = "";
server.stdout.on("data", (chunk) => (serverLog += chunk.toString()));
server.stderr.on("data", (chunk) => (serverLog += chunk.toString()));

const cookies = new Map();

async function waitForHealth() {
  for (let i = 0; i < 120; i += 1) {
    
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
  const response = await fetch(`${base}${route}`, {
    method,
    headers: { "content-type": "application/json", cookie: cookies.get(who) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  assert.equal(response.status, status, `${method} ${route} expected ${status}`);
}

async function register(key, username) {
  const response = await fetch(`${base}/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password: "group-settings-123" }),
  });
  assert.equal(response.status, 201, `register ${username}`);
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
  await Promise.all(
    ["a", "b", "c"].map((who) => register(who, `gsc_${who}_${suffix}`)),
  );

  const draftA1 = await heroDraft("a");
  const aHero = (await api("a", "POST", "/heroes", {
    name: "甲队前锋",
    raceId: draftA1.raceIds[0],
    weaponType: draftA1.weaponTypes[0],
    draftId: draftA1.draftId,
  })).hero;
  const draftA2 = await heroDraft("a");
  const aHealer = (await api("a", "POST", "/heroes", {
    name: "甲队牧师",
    raceId: draftA2.raceIds[0],
    weaponType: draftA2.weaponTypes[0],
    draftId: draftA2.draftId,
  })).hero;
  const draftB1 = await heroDraft("b");
  const bHero = (await api("b", "POST", "/heroes", {
    name: "乙队猎手",
    raceId: draftB1.raceIds[0],
    weaponType: draftB1.weaponTypes[0],
    draftId: draftB1.draftId,
  })).hero;

  const group = (await api("a", "POST", "/groups", { name: "配置测试队" })).group;
  await api("b", "POST", "/groups/join", { code: group.joinCode });
  await api("a", "POST", `/groups/${group.id}/heroes`, {
    heroId: aHero.id,
    position: "front",
  });
  await api("a", "POST", `/groups/${group.id}/heroes`, {
    heroId: aHealer.id,
    position: "back",
  });
  await api("b", "POST", `/groups/${group.id}/heroes`, {
    heroId: bHero.id,
    position: "back",
  });
  console.log("✓ 创建队伍并加入英雄");

  const withSettings = await api("a", "POST", `/groups/${group.id}/hero-settings`, {
    heroId: aHero.id,
    settings: { targetPriority: "strongest" },
  });
  const saved = withSettings.group.heroes.find((hero) => hero.heroId === aHero.id);
  assert.equal(saved.settings.targetPriority, "strongest", "组队临时配置没有保存");
  console.log("✓ 队长英雄的临时配置已保存");

  await expectStatus(
    "b",
    "POST",
    `/groups/${group.id}/hero-settings`,
    { heroId: aHero.id, settings: { targetPriority: "lowest-hp" } },
    403,
  );
  console.log("✓ 非英雄本人不能修改临时配置");

  const presetBefore = (await api("a", "GET", `/heroes/${aHero.id}/presets`)).presets;
  assert.ok(
    presetBefore.every((preset) => preset.settings?.targetPriority !== "strongest"),
    "临时配置不应写回预设",
  );

  // 组队出发需要队长通知 + 全员准备（group ready flow）。
  await api("a", "POST", `/groups/${group.id}/queue`, { dungeonId: "pm-abandoned-mine-d0" });
  for (const who of ["b", "c", "d"]) {
    
async function heroDraft(who, needWeapons = []) {
  for (let i = 0; i < 100; i += 1) {
    const draft = (await api(who, "GET", "/heroes/draft")).draft;
    if (needWeapons.every((w) => draft.weaponTypes.includes(w))) return draft;
  }
  throw new Error("抽选 100 次仍未包含所需武器组合");
}
try {
      await api(who, "POST", `/groups/${group.id}/ready`);
    } catch {
      // 未参队的成员直接忽略。
    }
  }
  const started = await api("a", "POST", `/groups/${group.id}/start`);
  assert.ok(started.expeditionId, "组队远征没有开始");
  let finished = null;
  for (let i = 0; i < 150; i += 1) {
    // 结算后队伍保留（recruiting），用远征历史判断完成。
    const data = await api("a", "GET", "/expeditions?limit=20");
    const row = (data.expeditions ?? []).find(
      (item) => item.id === started.expeditionId,
    );
    if (row?.status === "completed" && row.result) {
      finished = row;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  assert.ok(finished, "组队远征没有在预期时间内完成");

  const presetAfter = (await api("a", "GET", `/heroes/${aHero.id}/presets`)).presets;
  assert.ok(
    presetAfter.every((preset) => preset.settings?.targetPriority !== "strongest"),
    "出发后临时配置被写回了预设",
  );
  console.log("✓ 临时配置只作用于本次组队，不写回预设");

  await api("a", "POST", "/chat", {
    channel: "group",
    groupId: group.id,
    message: "甲队就位。",
  });
  await api("b", "POST", "/chat", {
    channel: "group",
    groupId: group.id,
    message: "乙队收到。",
  });
  const groupChat = await api("b", "GET", `/chat?channel=group&groupId=${group.id}`);
  assert.ok(
    groupChat.messages.some((entry) => entry.message === "甲队就位。"),
    "队员看不到队伍频道消息",
  );
  assert.ok(
    groupChat.messages.some((entry) => entry.message === "乙队收到。"),
    "队伍频道发送失败",
  );
  console.log("✓ 队伍频道收发正常");

  await expectStatus("c", "GET", `/chat?channel=group&groupId=${group.id}`, undefined, 403);
  await expectStatus(
    "c",
    "POST",
    "/chat",
    { channel: "group", groupId: group.id, message: "路过" },
    403,
  );
  console.log("✓ 非队员不能读取或发送队伍频道");

  const globalChat = await api("c", "GET", "/chat?channel=global");
  assert.ok(Array.isArray(globalChat.messages), "世界频道不应受影响");
  console.log("✓ 世界频道不受影响");

  console.log("\n组队配置与聊天冒烟测试全部通过。");
} catch (error) {
  console.error(`\n组队配置与聊天冒烟测试失败：${error.message}`);
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
