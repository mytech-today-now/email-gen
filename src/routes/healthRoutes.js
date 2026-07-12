import express from "express";
import { logFilePath } from "../utils/logger.js";

export function healthRoutes(context) {
  const router = express.Router();
  router.get("/health", (_req, res) => {
    res.json({ status: "ok", uptimeSeconds: Math.round(process.uptime()) });
  });
  router.get("/ready", (_req, res) => {
    res.json({
      status: "ready",
      database: context.db.open,
      logFile: logFilePath(context.config),
      modelSync: context.modelSynchronizer?.status?.() ?? null
    });
  });
  return router;
}
