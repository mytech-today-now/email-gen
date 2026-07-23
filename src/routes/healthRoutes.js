import express from "express";
import { logFilePath } from "../utils/logger.js";

export function healthRoutes(context) {
  const router = express.Router();
  router.get("/health", (_req, res) => {
    res.json({
      status: context.lifecycle?.phase === "RUNNING" ? "ok" : "draining",
      lifecycle: context.lifecycle?.phase ?? "RUNNING",
      uptimeSeconds: Math.round(process.uptime())
    });
  });
  router.get("/ready", (_req, res) => {
    const ready = context.lifecycle?.phase === "RUNNING" && Boolean(context.db?.open);
    res.status(ready ? 200 : 503).json({
      status: ready ? "ready" : "unavailable",
      ready,
      lifecycle: context.lifecycle?.phase ?? "RUNNING",
      database: Boolean(context.db?.open),
      logFile: logFilePath(context.config),
      modelSync: context.modelSynchronizer?.status?.() ?? null
    });
  });
  return router;
}
