import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function findRoot(): string {
  const starts = [
    process.cwd(),
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../.."),
  ];
  for (const start of starts) {
    let dir = start;
    for (let i = 0; i < 8; i += 1) {
      if (existsSync(path.join(dir, "content", "pack.json"))) return dir;
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  throw new Error("找不到 content/pack.json，请从仓库根目录启动服务端");
}

export const ROOT = findRoot();
export const CONTENT_DIR = process.env.WOD_CONTENT_DIR
  ? path.resolve(process.env.WOD_CONTENT_DIR)
  : path.join(ROOT, "content");
export const DATA_DIR = process.env.WOD_DATA_DIR
  ? path.resolve(process.env.WOD_DATA_DIR)
  : path.join(ROOT, "data");
export const DB_PATH = process.env.WOD_DB ?? path.join(DATA_DIR, "wod.db");
export const PORT = Number(process.env.PORT ?? 8787);
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const INJURY_MS = 10 * 60 * 1000;
export const STARTING_GOLD = 100;
export const STARTING_EP = 500;
/** 决斗胜者获得的声望。 */
export const FAME_DUEL_WIN = 1;
/** 竞技场赛季时长；测试可用 WOD_SEASON_DAYS 调整。 */
export const SEASON_DURATION_MS = Math.max(
  60_000,
  Number(process.env.WOD_SEASON_DAYS ?? 14) * 24 * 60 * 60 * 1000,
);
/** 开发环境可把所有新账号标记为进阶；当前不影响组队人数。 */
export const PREMIUM_DEFAULT = process.env.WOD_PREMIUM === "1";
/**
 * 默认同一网络只能注册一个账号。
 * 学校、公司、家庭等多人共用出口 IP 时，设为 1 放开注册限制。
 */
export const ALLOW_SHARED_IP = process.env.WOD_ALLOW_SHARED_IP === "1";
/**
 * 反向代理后面部署时开启，让 req.ip 读取可信代理传来的客户端 IP。
 * 仅在服务端不直接暴露公网、且代理会覆盖 X-Forwarded-For 时使用。
 */
export const TRUST_PROXY = process.env.WOD_TRUST_PROXY === "1";
/** 便于测试：把所有迷宫时长按比例缩短。生产环境保持 1。 */
export const TIME_SCALE = Math.max(0.001, Number(process.env.WOD_TIME_SCALE ?? 1));
export const SECURE_COOKIES = process.env.WOD_SECURE_COOKIES === "1";
export const WEB_DIST = process.env.WOD_WEB_DIST
  ? path.resolve(process.env.WOD_WEB_DIST)
  : path.join(ROOT, "apps", "web", "dist");

mkdirSync(DATA_DIR, { recursive: true });
