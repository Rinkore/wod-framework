import { DatabaseSync } from "node:sqlite";

const base = "http://127.0.0.1:8793/api";
const username = `phase2http${Date.now().toString().slice(-6)}`;
const password = "testpass123";
async function req(path, options = {}) {
  const response = await fetch(base + path, options);
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: response.status, data, headers: response.headers };
}
const json = { "content-type": "application/json" };
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
  method: "POST", headers: { cookie, ...json }, body: JSON.stringify(body),
});

const db = new DatabaseSync("C:/Users/Rinkore/AppData/Local/Temp/wod-phase2-e4Mylg/data/wod.db");
const user = db.prepare("SELECT id FROM users WHERE username=?").get(username);
const now = Date.now();
for (let i = 0; i < 7; i += 1) {
  db.prepare("INSERT INTO lottery_tickets(id,user_id,status,created_at) VALUES(?,?,?,?)")
    .run(`api-stock-${i}`, user.id, "stock", now);
}
let state = (await get("/lottery?page=1")).data;
if (state.stockCount !== 7) throw new Error(`stock ${JSON.stringify(state)}`);
const entered = await post("/lottery/enter", { count: 3 });
if (entered.status !== 200 || entered.data.entered !== 3) throw new Error(`enter ${JSON.stringify(entered)}`);
const active = db.prepare("SELECT number,end_at FROM daily_lottery_pools WHERE status=? ORDER BY number DESC LIMIT 1")
  .get("active");
db.prepare("UPDATE daily_lottery_pools SET end_at=? WHERE number=?").run(now - 1, active.number);
state = (await get("/lottery?page=1")).data;
const drawn = db.prepare("SELECT COUNT(*) n FROM lottery_tickets WHERE user_id=? AND status=? AND legacy=0")
  .get(user.id, "drawn").n;
const rewards = db.prepare("SELECT shards,manuals FROM legacy_rewards WHERE user_id=?").get(user.id);
if (state.currentPeriod.number !== active.number + 1 || drawn !== 3 || state.stockCount !== 4) {
  throw new Error(`rollover ${JSON.stringify({ state, drawn, rewards })}`);
}
console.log(JSON.stringify({
  username, register: register.status, login: login.status, initialStock: 7,
  entered: entered.data, rolledFrom: active.number, to: state.currentPeriod.number,
  drawn, remainingStock: state.stockCount, rewards,
}, null, 2));
db.close();
