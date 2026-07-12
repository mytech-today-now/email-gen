import express from "express";
import { z } from "zod";
import { loadTemplate } from "../templates/loader.js";
import { AppError } from "../utils/errors.js";
import { clampNumber } from "../utils/helpers.js";
import { validateBody } from "../middleware/validation.js";

const JobRequestSchema = z.object({
  mode: z.enum(["current", "selected", "range", "all"]),
  recordId: z.number().int().positive().optional(),
  recordIds: z.array(z.number().int().positive()).optional(),
  startId: z.number().int().positive().optional(),
  endId: z.number().int().positive().optional(),
  templateName: z.string().min(1),
  addendumName: z.string().optional().nullable(),
  addendumEnabled: z.boolean().default(false),
  provider: z.string().min(1),
  model: z.string().min(1),
  researchEnabled: z.boolean().default(false),
  concurrency: z.number().int().positive().optional(),
  delayMs: z.number().int().min(0).optional(),
  continueOnWarnings: z.boolean().default(false)
});

function selectRecords(repositories, body) {
  const all = repositories.records.list().filter((record) => record.status === "ready");
  if (body.mode === "all") return all;
  if (body.mode === "current") return repositories.records.findMany([body.recordId]);
  if (body.mode === "selected") return repositories.records.findMany(body.recordIds ?? []);
  if (body.mode === "range") {
    const start = Math.min(body.startId ?? 0, body.endId ?? Number.MAX_SAFE_INTEGER);
    const end = Math.max(body.startId ?? 0, body.endId ?? Number.MAX_SAFE_INTEGER);
    return all.filter((record) => {
      const candidate = Number(record.normalized.id ?? record.recordKey ?? record.id);
      return Number.isFinite(candidate) && candidate >= start && candidate <= end;
    });
  }
  return [];
}

export function processingRoutes(context) {
  const router = express.Router();

  router.get("/config", (_req, res) => {
    res.json({
      app: {
        host: context.config.host,
        port: context.config.port,
        limits: context.config.limits,
        ai: {
          defaultConcurrency: context.config.ai.defaultConcurrency,
          maxConcurrency: context.config.ai.maxConcurrency,
          defaultDelayMs: context.config.ai.defaultDelayMs,
          maxDelayMs: context.config.ai.maxDelayMs
        },
        research: context.config.research,
        modelSync: {
          enabled: context.config.modelSync.enabled,
          startup: context.config.modelSync.startup,
          intervalSeconds: context.config.modelSync.intervalSeconds,
          cacheTtlSeconds: context.config.modelSync.cacheTtlSeconds,
          staleCatalogSeconds: context.config.modelSync.staleCatalogSeconds,
          missingGraceSeconds: context.config.modelSync.missingGraceSeconds,
          allowInferredCapabilities: context.config.modelSync.allowInferredCapabilities
        }
      },
      ai: context.providerRegistry.publicConfig()
    });
  });

  router.post("/jobs", validateBody(JobRequestSchema), (req, res, next) => {
    try {
      const body = req.body;
      const records = selectRecords(context.repositories, body);
      if (!records.length)
        throw new AppError("NO_RECORDS_SELECTED", "No ready records matched the selection.", 400);
      const template = loadTemplate(context.config, body.templateName);
      const job = context.batchManager.createJob({
        records,
        template,
        options: {
          templateName: body.templateName,
          addendumName: body.addendumEnabled ? body.addendumName : null,
          provider: body.provider,
          model: body.model,
          researchEnabled: body.researchEnabled,
          concurrency: clampNumber(
            body.concurrency,
            1,
            context.config.ai.maxConcurrency,
            context.config.ai.defaultConcurrency
          ),
          delayMs: clampNumber(
            body.delayMs,
            0,
            context.config.ai.maxDelayMs,
            context.config.ai.defaultDelayMs
          ),
          continueOnWarnings: body.continueOnWarnings
        }
      });
      res.status(202).json({ job });
    } catch (error) {
      next(error);
    }
  });

  router.get("/jobs", (_req, res) => {
    res.json({ jobs: context.repositories.jobs.list() });
  });

  router.get("/jobs/:id", (req, res, next) => {
    try {
      const job = context.repositories.jobs.get(req.params.id);
      if (!job) throw new AppError("JOB_NOT_FOUND", "Job was not found.", 404);
      res.json({ job });
    } catch (error) {
      next(error);
    }
  });

  router.post("/jobs/:id/stop", (req, res, next) => {
    try {
      res.json({ job: context.batchManager.stop(req.params.id) });
    } catch (error) {
      next(error);
    }
  });

  router.post("/jobs/:id/retry", (req, res, next) => {
    try {
      res.status(202).json({ job: context.batchManager.retryFailed(req.params.id) });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
