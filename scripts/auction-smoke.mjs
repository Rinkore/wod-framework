import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = 8803;
const base = `http://127.0.0.1:${port}/api`;
const tsxCli = path.join(root, "node_modules", "tsx", "dist", "cli.mjs");
const tempDir = await mkdtemp(path.join(os.tmpdir(), "wod-auction-"));
const server = spawn(
  process.execPath,
  [tsxCli, path.join(root, "apps", "server", "src", "index.ts")],
  {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      WOD_DATA_DIR: tempDir,
      WOD_ALLOW_SHARED_IP: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let serverLog = "";
server.stdout.on("data", (chunk) => (serverLog += chunk.toString()));
server.stderr.on("data", (chunk) => (serverLog += chunk.toString()));

const cookies = new Map();

async function heroDraft(needWeapons = []) {
  for (let i = 0; i < 100; i += 1) {
    const draft = (await api("a", "GET", "/heroes/draft")).draft;
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
  throw new Error("server start timeout");
}

async function api(who, method, route, body) {
  const response = await fetch(`${base}${route}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(cookies.get(who) ? { cookie: cookies.get(who) } : {}),
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
    body: JSON.stringify({ username, password: "auction-pass-123" }),
  });
  assert.equal(response.status, 201, `register ${username}`);
  cookies.set(key, response.headers.getSetCookie()[0].split(";")[0]);
}

async function goldOf(who) {
  return (await api(who, "GET", "/auth/me")).user.gold;
}

try {
  await waitForHealth();
  const suffix = Date.now().toString(36);
  await Promise.all(
    ["a", "b", "c"].map((who) => register(who, `auc_${who}_${suffix}`)),
  );

  const draftA = await heroDraft();
  const hero = (await api("a", "POST", "/heroes", {
    name: "拍卖测试员",
    raceId: draftA.raceIds[0],
    weaponType: draftA.weaponTypes[0],
    draftId: draftA.draftId,
  })).hero;
  const unequippedWeapon = await api("a", "POST", `/heroes/${hero.id}/unequip`, {
    slot: "weapon",
  });
  assert.ok(unequippedWeapon.item.id, "武器没有卸下");
  const unequippedArmor = await api("a", "POST", `/heroes/${hero.id}/unequip`, {
    slot: "armor",
  });
  assert.ok(unequippedArmor.item.id, "护甲没有卸下");

  const auction = (await api("a", "POST", "/auctions/list", {
    itemId: unequippedWeapon.item.id,
    startPrice: 10,
    buyoutPrice: 50,
    durationHours: 1,
  })).auction;
  assert.equal(auction.startPrice, 10);
  assert.equal(auction.currentBid, null);
  assert.equal(auction.minNextBid, 10);
  console.log("✓ 物品上架拍卖，起拍价/一口价生效");

  await expectStatus("a", "POST", `/auctions/${auction.id}/bid`, { amount: 10 }, 409);
  await expectStatus("b", "POST", `/auctions/${auction.id}/bid`, { amount: 1 }, 400);
  await expectStatus("b", "POST", `/auctions/${auction.id}/bid`, { amount: 1000 }, 400);
  console.log("✓ 自 bid、低于起拍价、金币不足均被拒绝");

  const firstBid = await api("b", "POST", `/auctions/${auction.id}/bid`, { amount: 10 });
  assert.equal(firstBid.auction.currentBid, 10);
  assert.equal(firstBid.gold, 90, "出价没有冻结金币");
  await expectStatus("a", "POST", `/auctions/${auction.id}/cancel`, undefined, 409);
  await expectStatus("b", "POST", `/auctions/${auction.id}/cancel`, undefined, 403);
  console.log("✓ 首次出价冻结金币，卖家不能取消有出价的拍卖，非卖家不能取消");

  const secondBid = await api("c", "POST", `/auctions/${auction.id}/bid`, { amount: 20 });
  assert.equal(secondBid.auction.currentBid, 20);
  assert.equal(secondBid.auction.currentBidderName, `auc_c_${suffix}`);
  assert.equal(await goldOf("b"), 100, "被超价的金币没有退回");
  console.log("✓ 被超价后自动退款");

  const buyout = await api("c", "POST", `/auctions/${auction.id}/buyout`);
  assert.equal(buyout.price, 50);
  assert.equal(buyout.fee, 2, "手续费应为 5% 向下取整");
  assert.equal(await goldOf("a"), 148, "卖家到账金额不对");
  assert.equal(await goldOf("c"), 50, "买家金币扣减不对");
  const cInventory = (await api("c", "GET", "/inventory")).items;
  assert.ok(
    cInventory.some((item) => item.templateId === unequippedWeapon.item.templateId),
    "成交物品没有进入买家背包",
  );
  console.log("✓ 一口价成交，5% 手续费与物品交割正确");

  const detail = await api("c", "GET", `/auctions/${auction.id}`);
  assert.equal(detail.auction.status, "sold");
  assert.equal(detail.bids.length, 2, "出价记录数量不对");
  await expectStatus("b", "POST", `/auctions/${auction.id}/cancel`, undefined, 404);
  console.log("✓ 成交状态与出价记录正确，已成交拍卖不能取消");

  const expiring = (await api("a", "POST", "/auctions/list", {
    itemId: unequippedArmor.item.id,
    startPrice: 10,
    durationHours: 1,
  })).auction;
  const db = new DatabaseSync(path.join(tempDir, "wod.db"));
  db.exec("PRAGMA busy_timeout = 5000");
  db.prepare("UPDATE auction_listings SET closes_at = ? WHERE id = ?").run(
    Date.now() - 1000,
    expiring.id,
  );
  db.close();
  const afterExpiry = await api("a", "GET", "/auctions?mine=1");
  assert.equal(afterExpiry.auctions.length, 0, "到期拍卖仍在列表中");
  const aInventory = (await api("a", "GET", "/inventory")).items;
  assert.ok(
    aInventory.some((item) => item.templateId === unequippedArmor.item.templateId),
    "无出价到期后物品没有退回卖家",
  );
  console.log("✓ 无出价到期后物品退回卖家");

  const draftB = await heroDraft();
  const hero2 = (await api("a", "POST", "/heroes", {
    name: "拍卖测试员二",
    raceId: draftB.raceIds[0],
    weaponType: draftB.weaponTypes[0],
    draftId: draftB.draftId,
  })).hero;
  const thirdItem = await api("a", "POST", `/heroes/${hero2.id}/unequip`, {
    slot: "weapon",
  });
  const bidExpiry = (await api("a", "POST", "/auctions/list", {
    itemId: thirdItem.item.id,
    startPrice: 10,
    durationHours: 1,
  })).auction;
  await api("b", "POST", `/auctions/${bidExpiry.id}/bid`, { amount: 10 });
  const db2 = new DatabaseSync(path.join(tempDir, "wod.db"));
  db2.exec("PRAGMA busy_timeout = 5000");
  db2.prepare("UPDATE auction_listings SET closes_at = ? WHERE id = ?").run(
    Date.now() - 1000,
    bidExpiry.id,
  );
  db2.close();
  await api("a", "GET", "/auctions");
  assert.equal(await goldOf("a"), 158, "有出价到期后卖家没有收到成交款");
  assert.equal(await goldOf("b"), 90, "有出价到期后买家金币不应再变化");
  const bInventory = (await api("b", "GET", "/inventory")).items;
  assert.ok(
    bInventory.some((item) => item.templateId === thirdItem.item.templateId),
    "有出价到期后物品没有交割给最高出价者",
  );
  console.log("✓ 有出价到期后自动成交并交割");

  console.log("\n拍卖行冒烟测试全部通过。");
} catch (error) {
  console.error(`\n拍卖行冒烟测试失败：${error.message}`);
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
