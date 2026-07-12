import express from "express";
import { AppError } from "../utils/errors.js";

function publicCatalogModel(model) {
  const { rawProviderMetadata: _rawProviderMetadata, ...safe } = model;
  return safe;
}

function requireManualSyncPermission(req, config) {
  const token = config.modelSync.manualSyncToken;
  if (!token) return;
  const supplied = req.get("x-model-sync-token") || req.body?.token;
  if (supplied !== token) {
    throw new AppError("MODEL_SYNC_FORBIDDEN", "Manual model synchronization is not permitted.", 403);
  }
}

export function modelCatalogRoutes(context) {
  const router = express.Router();

  router.get("/models/catalog", (_req, res) => {
    res.json({
      models: context.modelCatalogRepository.listModels().map(publicCatalogModel),
      status: context.modelSynchronizer.status()
    });
  });

  router.get("/models/status", (_req, res) => {
    res.json(context.modelSynchronizer.status());
  });

  router.post("/models/sync", async (req, res, next) => {
    try {
      requireManualSyncPermission(req, context.config);
      const result = await context.modelSynchronizer.synchronize("manual");
      res.status(result.status === "skipped" ? 202 : 200).json({ result });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
