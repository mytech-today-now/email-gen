import express from "express";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { AppError } from "../utils/errors.js";
import { validateBody } from "../middleware/validation.js";
import { renderEmailFragment, renderPlainText } from "../output/emailRenderer.js";
import { writeResultHtml, writeResultsZip } from "../output/exporter.js";
import { deliveryExportProfiles, writeDeliveryExport } from "../output/deliveryExporter.js";
import { renderHtmlDocument } from "../output/documentRenderer.js";
import { contactCandidatesForResult } from "../output/contactActions.js";
import { processRecord } from "../ai/processor.js";
import { loadTemplate } from "../templates/loader.js";
import { resolveInside } from "../utils/files.js";

const EditSchema = z.object({
  subject: z.string().trim().min(1).max(160),
  bodyHtml: z.string().trim().min(1)
});

const DeliveryExportSchema = z.object({
  profile: z.string().trim().default("all"),
  projectId: z.string().optional(),
  resultIds: z.array(z.string().trim().min(1)).default([])
});

const DeleteResultsSchema = z.object({
  projectId: z.string().optional(),
  resultIds: z.array(z.string().trim().min(1)).min(1)
});
const deliveryProfileIds = new Set(deliveryExportProfiles.map((profile) => profile.id));

export function resultRoutes(context) {
  const router = express.Router();

  router.get("/results", (req, res) => {
    const project = context.repositories.projects.resolve(req.query.projectId);
    res.json({
      project,
      results: context.repositories.results.list({
        status: req.query.status,
        recordId: req.query.recordId,
        projectId: project?.id
      })
    });
  });

  router.get("/results/delivery-profiles", (_req, res) => {
    res.json({ profiles: deliveryExportProfiles });
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

  router.delete("/results/:id", (req, res, next) => {
    try {
      const project = context.repositories.projects.resolve(req.query.projectId);
      const deleted = context.repositories.results.delete(req.params.id, { projectId: project?.id });
      if (!deleted) throw new AppError("RESULT_NOT_FOUND", "Result was not found.", 404);
      context.logger.info({ resultId: deleted.id, projectId: deleted.projectId }, "Result deleted");
      res.json({ deleted: { id: deleted.id }, project });
    } catch (error) {
      next(error);
    }
  });

  router.post("/results/delete", validateBody(DeleteResultsSchema), (req, res, next) => {
    try {
      const project = context.repositories.projects.resolve(req.body.projectId);
      const deleted = context.repositories.results.deleteMany(req.body.resultIds, { projectId: project?.id });
      if (!deleted.length) {
        throw new AppError("NO_RESULTS_DELETED", "No matching results were found to delete.", 404);
      }
      context.logger.info(
        {
          projectId: project?.id,
          requestedCount: req.body.resultIds.length,
          deletedCount: deleted.length,
          deletedIds: deleted.map((result) => result.id)
        },
        "Results deleted in bulk"
      );
      res.json({
        deleted: deleted.map((result) => ({ id: result.id })),
        deletedCount: deleted.length,
        project
      });
    } catch (error) {
      next(error);
    }
  });

  router.patch("/results/:id", validateBody(EditSchema), (req, res, next) => {
    try {
      const result = context.repositories.results.get(req.params.id);
      if (!result) throw new AppError("RESULT_NOT_FOUND", "Result was not found.", 404);
      const record = context.repositories.records.get(result.recordId, { projectId: result.projectId });
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
      context.logger.info({ resultId: result.id, projectId: result.projectId }, "Result manually edited");
    } catch (error) {
      next(error);
    }
  });

  router.post("/results/:id/regenerate", async (req, res, next) => {
    try {
      const existing = context.repositories.results.get(req.params.id);
      if (!existing) throw new AppError("RESULT_NOT_FOUND", "Result was not found.", 404);
      const record = context.repositories.records.get(existing.recordId, { projectId: existing.projectId });
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
        runtimeCredentials: context.runtimeCredentials,
        cacheRepository: context.cacheRepository,
        browserLauncher: context.browserLauncher,
        logger: context.logger,
        signal: context.shutdownController?.signal ?? null
      });
      const processing = context.repositories.results.createProcessing({
        projectId: existing.projectId,
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
      const record = context.repositories.records.get(result.recordId, { projectId: result.projectId });
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
      const record = context.repositories.records.get(result.recordId, { projectId: result.projectId });
      res.type("html").send(
        renderHtmlDocument({
          subject: result.subject,
          emailHtml: result.emailHtml,
          config: context.config,
          contactCandidates: record ? contactCandidatesForResult(result, record) : []
        })
      );
    } catch (error) {
      next(error);
    }
  });

  router.post("/results/export", async (req, res, next) => {
    try {
      const ids = Array.isArray(req.body.resultIds) ? req.body.resultIds : [];
      const project = context.repositories.projects.resolve(req.body.projectId);
      const results = ids.length
        ? context.repositories.results.listByIds(ids, { projectId: project?.id })
        : context.repositories.results.list({ status: "completed", projectId: project?.id });
      const items = results
        .map((result) => ({
          result,
          record: context.repositories.records.get(result.recordId, { projectId: result.projectId })
        }))
        .filter((item) => item.record);
      if (!items.length) {
        throw new AppError("NO_COMPLETED_RESULTS", "No completed email results are ready to export.", 400);
      }
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

  router.post("/results/delivery-export", validateBody(DeliveryExportSchema), async (req, res, next) => {
    try {
      if (!deliveryProfileIds.has(req.body.profile)) {
        throw new AppError("UNSUPPORTED_DELIVERY_PROFILE", "Delivery export profile is not supported.", 400);
      }
      const project = context.repositories.projects.resolve(req.body.projectId);
      const results = req.body.resultIds.length
        ? context.repositories.results.listByIds(req.body.resultIds, { projectId: project?.id })
        : context.repositories.results.list({ status: "completed", projectId: project?.id });
      const items = results
        .filter((result) => result.status === "completed")
        .map((result) => ({
          result,
          record: context.repositories.records.get(result.recordId, { projectId: result.projectId })
        }))
        .filter((item) => item.record);
      if (!items.length) {
        context.logger.warn(
          { profile: req.body.profile, projectId: project?.id, requestedCount: req.body.resultIds.length },
          "Delivery export requested without completed results"
        );
        throw new AppError("NO_COMPLETED_RESULTS", "No completed email results are ready to export.", 400);
      }
      const written = await writeDeliveryExport(items, context.config, { profile: req.body.profile });
      context.logger.info(
        {
          profile: req.body.profile,
          projectId: project?.id,
          itemCount: items.length,
          filename: written.filename,
          fileCount: written.files.length
        },
        "Delivery export created"
      );
      res.json({ export: written });
    } catch (error) {
      next(error);
    }
  });

  router.get("/results/export-file/:filename", (req, res, next) => {
    try {
      const requested = path.basename(req.params.filename);
      const filePath = resolveInside(context.config.outputDir, requested);
      if (!fs.existsSync(filePath)) {
        throw new AppError("EXPORT_NOT_FOUND", "Export file was not found.", 404);
      }
      res.download(filePath, requested);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
