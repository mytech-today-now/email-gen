import express from "express";
import { z } from "zod";
import { AppError } from "../utils/errors.js";
import { validateBody } from "../middleware/validation.js";
import { renderEmailFragment, renderPlainText } from "../output/emailRenderer.js";
import { writeResultHtml, writeResultsZip } from "../output/exporter.js";
import { renderHtmlDocument } from "../output/documentRenderer.js";
import { processRecord } from "../ai/processor.js";
import { loadTemplate } from "../templates/loader.js";

const EditSchema = z.object({
  subject: z.string().trim().min(1).max(160),
  bodyHtml: z.string().trim().min(1)
});

export function resultRoutes(context) {
  const router = express.Router();

  router.get("/results", (req, res) => {
    res.json({
      results: context.repositories.results.list({ status: req.query.status, recordId: req.query.recordId })
    });
  });

  router.get("/results/:id", (req, res, next) => {
    try {
      const result = context.repositories.results.get(req.params.id);
      if (!result) throw new AppError("RESULT_NOT_FOUND", "Result was not found.", 404);
      res.json({ result, versions: context.repositories.results.versions(result.id) });
    } catch (error) {
      next(error);
    }
  });

  router.patch("/results/:id", validateBody(EditSchema), (req, res, next) => {
    try {
      const result = context.repositories.results.get(req.params.id);
      if (!result) throw new AppError("RESULT_NOT_FOUND", "Result was not found.", 404);
      const record = context.repositories.records.get(result.recordId);
      const emailHtml = renderEmailFragment({
        subject: req.body.subject,
        bodyHtml: req.body.bodyHtml,
        record,
        config: context.config
      });
      const bodyText = renderPlainText({
        subject: req.body.subject,
        bodyHtml: req.body.bodyHtml,
        config: context.config
      });
      res.json({
        result: context.repositories.results.updateManual(result.id, { ...req.body, bodyText, emailHtml })
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/results/:id/regenerate", async (req, res, next) => {
    try {
      const existing = context.repositories.results.get(req.params.id);
      if (!existing) throw new AppError("RESULT_NOT_FOUND", "Result was not found.", 404);
      const record = context.repositories.records.get(existing.recordId);
      const template = loadTemplate(context.config, existing.templateName);
      const payload = await processRecord({
        record,
        template,
        addendumName: req.body.addendumName ?? null,
        provider: req.body.provider ?? existing.provider,
        model: req.body.model ?? existing.model,
        researchEnabled: req.body.researchEnabled ?? false,
        config: context.config,
        providerRegistry: context.providerRegistry,
        cacheRepository: context.cacheRepository,
        browserLauncher: context.browserLauncher,
        logger: context.logger
      });
      const processing = context.repositories.results.createProcessing({
        jobId: existing.jobId,
        recordId: record.id,
        templateName: template.name,
        provider: req.body.provider ?? existing.provider,
        model: req.body.model ?? existing.model
      });
      res.status(202).json({ result: context.repositories.results.saveCompleted(processing.id, payload) });
    } catch (error) {
      next(error);
    }
  });

  router.get("/results/:id/export", (req, res, next) => {
    try {
      const result = context.repositories.results.get(req.params.id);
      if (!result) throw new AppError("RESULT_NOT_FOUND", "Result was not found.", 404);
      const record = context.repositories.records.get(result.recordId);
      const written = writeResultHtml(result, record, context.config);
      res.download(written.filePath, written.filename);
    } catch (error) {
      next(error);
    }
  });

  router.get("/results/:id/document", (req, res, next) => {
    try {
      const result = context.repositories.results.get(req.params.id);
      if (!result) throw new AppError("RESULT_NOT_FOUND", "Result was not found.", 404);
      res
        .type("html")
        .send(
          renderHtmlDocument({ subject: result.subject, emailHtml: result.emailHtml, config: context.config })
        );
    } catch (error) {
      next(error);
    }
  });

  router.post("/results/export", async (req, res, next) => {
    try {
      const ids = Array.isArray(req.body.resultIds) ? req.body.resultIds : [];
      const results = ids.length
        ? context.repositories.results.listByIds(ids)
        : context.repositories.results.list({ status: "completed" });
      const items = results.map((result) => ({
        result,
        record: context.repositories.records.get(result.recordId)
      }));
      if (items.length === 1) {
        const written = writeResultHtml(items[0].result, items[0].record, context.config);
        res.json({ export: written });
      } else {
        const written = await writeResultsZip(items, context.config);
        res.json({ export: written });
      }
    } catch (error) {
      next(error);
    }
  });

  return router;
}
