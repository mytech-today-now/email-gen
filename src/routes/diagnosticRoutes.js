import express from "express";
import { redactSecrets } from "../utils/logger.js";

const ALLOWED_LEVELS = new Set(["debug", "info", "warn", "error"]);

function safeMetadata(value) {
  const serialized = redactSecrets(value ?? {});
  if (serialized.length > 12_000) return { truncated: true, preview: serialized.slice(0, 12_000) };
  return JSON.parse(serialized);
}

export function diagnosticRoutes(context) {
  const router = express.Router();
  router.post("/client-logs", (req, res, next) => {
    try {
      context.requireGatewayRequest(req);
      const entries = Array.isArray(req.body?.entries) ? req.body.entries.slice(0, 100) : [];
      for (const entry of entries) {
        const level = ALLOWED_LEVELS.has(entry.level) ? entry.level : "info";
        context.logger[level](
          {
            event: String(entry.event || "browser_event").slice(0, 120),
            correlationId: String(entry.correlationId || "").slice(0, 120),
            browserSeverity: entry.severity || entry.level || level,
            browserTimestamp: entry.timestamp,
            metadata: safeMetadata(entry.metadata)
          },
          "Browser diagnostic event"
        );
      }
      res.status(202).json({ accepted: entries.length });
    } catch (error) {
      next(error);
    }
  });
  return router;
}
