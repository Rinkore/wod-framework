import { existsSync } from "node:fs";
import path from "node:path";
import express from "express";
import { ZodError } from "zod";
import { PORT, TIME_SCALE, TRUST_PROXY, WEB_DIST } from "./config.js";
import { content } from "./content.js";
import { db } from "./db.js";
import { ApiError } from "./errors.js";
import { apiRouter } from "./routes.js";
import { settleAllDue } from "./settlement.js";
import { expireAuctions } from "./services/auctions.js";
import { ensureSeason } from "./services/seasons.js";
import { ensureLotteryPeriods } from "./services/lottery.js";

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", TRUST_PROXY);
app.use(express.json({ limit: "256kb" }));

app.use("/api", apiRouter);
app.use("/api", (_req, res) => {
  res.status(404).json({ error: { message: "接口不存在", code: "not_found" } });
});

const indexHtml = path.join(WEB_DIST, "index.html");
const assetsDir = path.join(WEB_DIST, "assets");
if (existsSync(indexHtml)) {
  // Vite 产物文件名带内容哈希，可以长期缓存。
  if (existsSync(assetsDir)) {
    app.use("/assets", express.static(assetsDir, { maxAge: "1y", immutable: true }));
  }
  // index.html 不缓存：每次普通刷新都会拿到最新构建，不需要强制刷新。
  app.use(
    express.static(WEB_DIST, {
      index: false,
      maxAge: 0,
      setHeaders(res, filePath) {
        if (filePath.endsWith(".html")) {
          res.setHeader("Cache-Control", "no-store");
        }
      },
    }),
  );
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api/")) {
      next();
      return;
    }
    res.setHeader("Cache-Control", "no-store");
    res.sendFile(indexHtml);
  });
} else {
  app.get("/", (_req, res) => {
    res.type("text/plain").send(
      [
        "World of Dungeons 风格框架服务端已启动。",
        "前端尚未构建：开发时请运行 npm run dev，生产构建请运行 npm run build。",
        `API: http://localhost:${PORT}/api/health`,
      ].join("\n"),
    );
  });
}

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (error instanceof ApiError) {
    res.status(error.status).json({ error: { message: error.message, code: error.code } });
    return;
  }
  if (error instanceof ZodError) {
    res.status(400).json({
      error: { message: error.issues[0]?.message ?? "请求参数有误", code: "bad_request" },
    });
    return;
  }
  if (error instanceof SyntaxError && "status" in error && (error as { status?: number }).status === 400) {
    res.status(400).json({ error: { message: "请求体不是合法 JSON", code: "bad_request" } });
    return;
  }
  console.error("[wod] 未处理的错误:", error);
  res.status(500).json({ error: { message: "服务器内部错误", code: "internal_error" } });
});

const server = app.listen(PORT, () => {
  console.log(`[wod] ${content.name} v${content.version} 已加载`);
  console.log(`[wod] 服务端运行在 http://localhost:${PORT}`);
  if (TIME_SCALE !== 1) {
    console.log(`[wod] 注意：迷宫时长按 ${TIME_SCALE}x 缩放（WOD_TIME_SCALE）`);
  }
});

const timer = setInterval(() => {
  try {
    const settled = settleAllDue();
    if (settled > 0) console.log(`[wod] 自动结算了 ${settled} 支远征队`);
    expireAuctions();
    ensureSeason();
    ensureLotteryPeriods();
  } catch (error) {
    console.error("[wod] 自动结算失败:", error);
  }
}, 10_000);
timer.unref();

function shutdown(signal: string) {
  console.log(`\n[wod] 收到 ${signal}，正在关闭…`);
  clearInterval(timer);
  server.close(() => {
    try {
      db.close();
    } catch {
      // ignore
    }
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
