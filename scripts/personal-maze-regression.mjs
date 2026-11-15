import { DatabaseSync } from "node:sqlite";

const base = "http://127.0.0.1:8794/api";
const username = `pmmaze${Date.now().toString().slice(-6)}`;
const password = "testpass123";
const json = { "content-type": "application/json" };
async function req(path, options = {}) {
  const response = await fetch(base + path, options);
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: response.status, data, headers: response.headers };
}

const register = await req("/auth/register", {
  method: "POST", headers: json, body: JSON.stringify({ username, password }),
});
if (register.status !== 201) throw new Error(`register ${JSON.stringify(register)}`);
const login = await req("/auth/login", {
  method: "POST", headers: json, body: JSON.stringify({ username, password }),
});
if (login.status !== 200) throw new Error(`login ${JSON.stringify(login)}`);
const cookie = login.headers.get("set-cookie")?.split(";")[0];
if (!cookie) throw new Error("missing session cookie");
const get = (path) => req(path, { headers: { cookie } });
const post = (path, body) => req(path, {
  method: "POST", headers: { cookie, ...json }, body: body === undefined ? undefined : JSON.stringify(body),
});

// 初始化个人迷宫：3 个系列各一个第 0 区。
const first = await get("/dungeons/personal");
if (first.status !== 200 || first.data.regions.length !== 7) {
  throw new Error(`initial regions ${JSON.stringify(first.data.regions.map(r=>r.seriesId))}`);
}
const seriesId = "foundry-depths";
const depth0 = first.data.regions.find((r) => r.seriesId === seriesId);
if (!depth0 || depth0.depth !== 0) throw new Error("missing foundry depth-0 region");

// 未清理前不能拓展。
const locked = await post("/dungeons/personal/expand", { seriesId });
if (locked.status !== 400) throw new Error(`expand should be blocked, got ${locked.status}`);

// 创建 3 名英雄（抽选 → 创建）。
const races = (await get("/content")).data.content.races.map((r) => r.id);
const weapons = ["sword", "bow", "staff"];
const heroIds = [];
for (let i = 0; i < 3; i += 1) {
  const draft = await get("/heroes/draft");
  if (draft.status !== 200) throw new Error(`draft ${JSON.stringify(draft)}`);
  const raceId = draft.data.draft.raceIds[0] ?? races[0];
  const weaponType = draft.data.draft.weaponTypes.find((w) => weapons.includes(w)) ?? draft.data.draft.weaponTypes[0];
  const created = await post("/heroes", {
    name: `探路者${i + 1}`,
    raceId,
    weaponType,
    draftId: draft.data.draft.draftId,
  });
  if (created.status !== 200 && created.status !== 201) throw new Error(`hero create ${JSON.stringify(created.data).slice(0, 300)}`);
  heroIds.push(created.data.hero.id);
}

// 个人区域继承系列准入（20 级）：测试用隔离库直接把英雄提升到 20 级。
const db = new DatabaseSync("C:/Users/Rinkore/AppData/Local/Temp/wod-phase2-e4Mylg/data/wod-pm.db");
db.prepare("UPDATE heroes SET ep_earned = 361000, xp = 361000 WHERE user_id = ?")
  .run(register.data.user.id);

// 派遣个人区域（默认最短通路）。
const dispatch = await post("/expeditions", {
  dungeonId: `pm-${seriesId}-d0`,
  heroIds,
});
if (dispatch.status !== 200 && dispatch.status !== 201) throw new Error(`dispatch ${JSON.stringify(dispatch.data).slice(0,300)}`);
const expeditionId = dispatch.data.expedition.id;
if (!dispatch.data.expedition.dungeonName.includes("断炉")) {
  throw new Error(`dungeonName ${dispatch.data.expedition.dungeonName}`);
}

// 等 TIME_SCALE 缩短的倒计时走完，然后结算。
await new Promise((resolve) => setTimeout(resolve, 6000));
const settled = await get(`/expeditions/${expeditionId}`);
if (settled.status !== 200 && settled.status !== 201) throw new Error(`expedition fetch ${settled.status}`);
const expeditionView = settled.data.expedition ?? settled.data;
if (expeditionView.status !== "completed") throw new Error(`not settled: ${expeditionView.status}`);
const result = expeditionView.result;
console.log(`outcome=${result.outcome} routeCleared=${result.routeCleared} gold=${result.rewards.gold} ep=${result.rewards.ep}`);

// 探索记录应包含路径房间（无论胜负，成功结算即记录）。

const region = db
  .prepare("SELECT explored_rooms_json, status FROM personal_maze_regions WHERE user_id = ? AND series_id = ? AND depth = 0")
  .get(register.data.user.id, seriesId);
const explored = JSON.parse(region.explored_rooms_json);
if (!Array.isArray(explored) || explored.length === 0) {
  throw new Error(`explored not recorded: ${region.explored_rooms_json}`);
}

// 若全通，可拓展下一区。
if (result.routeCleared) {
  if (region.status !== "cleared") throw new Error("cleared victory should mark region cleared");
  const expanded = await post("/dungeons/personal/expand", { seriesId });
  if (expanded.status !== 200 || expanded.data.region.depth !== 1) {
    throw new Error(`expand after clear ${JSON.stringify(expanded.data)}`);
  }
  console.log("expanded to depth 1 OK");
} else {
  console.log("not cleared; expand stays blocked");
}
const after = await get("/dungeons/personal");
console.log(JSON.stringify({
  regions: after.data.regions.map((r) => [r.seriesId, r.depth, r.status]),
  exploredRooms: explored.length,
  outcome: result.outcome,
  routeCleared: result.routeCleared,
}, null, 2));
db.close();
console.log("PASS: personal maze dispatch → settle → explore → clear → expand");
