import assert from "node:assert/strict";

const base = process.env.WOD_BASE ?? "http://127.0.0.1:8787/api";
const username = process.argv[2] ?? "demo";
const password = process.argv[3] ?? "demo123456";
const shouldDispatch = process.argv.includes("--dispatch");
const shouldWait = process.argv.includes("--wait");

let cookie = "";

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
  if (!res.ok) throw new Error(`${method} ${route} -> ${res.status}: ${data?.error?.message}`);
  return data;
}

async function loginOrRegister() {
  let res = await fetch(`${base}/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (res.status === 409) {
    res = await fetch(`${base}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
  }
  assert.ok(res.ok, `无法登录或注册 demo 账号（${res.status}）`);
  cookie = res.headers.getSetCookie()[0]?.split(";")[0] ?? "";
  assert.ok(cookie, "没有拿到会话 Cookie");
}

const PLAN = [
  { name: "铁砧" },
  { name: "苔痕" },
  { name: "烬语" },
  { name: "晚钟" },
  { name: "影缝" },
];

// 建号抽选：从服务端抽 2 过往 + 3 武器，取第一个组合。
async function heroDraft() {
  return (await api("GET", "/heroes/draft")).draft;
}

try {
  await loginOrRegister();
  const me = await api("GET", "/auth/me");
  const heroes = (await api("GET", "/heroes")).heroes;
  console.log(`账号 ${me.user.username}，金币 ${me.user.gold}，现有英雄 ${heroes.length} 名`);

  if (heroes.length === 0) {
    for (const plan of PLAN) {
      const draft = await heroDraft();
      const data = await api("POST", "/heroes", {
        name: plan.name,
        raceId: draft.raceIds[0],
        weaponType: draft.weaponTypes[0],
        draftId: draft.draftId,
      });
      console.log(`  创建 ${data.hero.name}（${data.hero.raceName} ${data.hero.weaponName}，Lv.${data.hero.level}）`);
    }
  }

  if (shouldDispatch) {
    const roster = (await api("GET", "/heroes")).heroes;
      const ready = roster
        .filter((hero) => !hero.busyExpeditionId && !hero.diedAt)
        .slice(0, 4);
      if (ready.length < 3) {
        console.log("可用英雄不足 3 名，跳过派遣。");
      } else {
        const data = await api("POST", "/expeditions", {
          dungeonId: "pm-abandoned-mine-d0",
          heroIds: ready.map((hero) => hero.id),
        });
      console.log(`已派遣 ${ready.length} 人前往 ${data.expedition.dungeonName}，结束于 ${new Date(data.expedition.endAt).toLocaleTimeString("zh-CN")}`);
      if (shouldWait) {
        for (let i = 0; i < 120; i += 1) {
          const current = (await api("GET", `/expeditions/${data.expedition.id}`)).expedition;
          if (current.status === "completed" && current.result) {
            console.log(
              `结算完成：${current.result.outcome === "victory" ? "胜利" : "失败"}，${current.result.rewards.gold} 金币，${current.result.rewards.items.length} 件战利品`,
            );
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }
    }
  }
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
