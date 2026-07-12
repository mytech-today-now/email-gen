import express from "express";
import multer from "multer";
import { allRestaurants } from "../../data/restaurants.js";
import { parseGoogleSheetsCsvUrl, parseImportBuffer } from "../data/importer.js";
import { AppError } from "../utils/errors.js";

function resolveProject(context, projectId) {
  if (projectId) {
    const project = context.repositories.projects.get(projectId);
    if (!project) throw new AppError("PROJECT_NOT_FOUND", "Project was not found.", 404);
    return project;
  }
  return context.repositories.projects.resolve();
}

export function dataRoutes(context) {
  const router = express.Router();
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: context.config.limits.uploadBytes, files: 1 }
  });

  router.get("/records", (req, res, next) => {
    try {
      const project = resolveProject(context, req.query.projectId);
      res.json({ project, records: context.repositories.records.list({ projectId: project?.id }) });
    } catch (error) {
      next(error);
    }
  });

  router.post("/records/load-sample", (req, res, next) => {
    try {
      const normalized = context.normalizeRecords(allRestaurants, {
        sourceName: "data/restaurants.js",
        limits: context.config.limits
      });
      const project = context.repositories.projects.createForImport({
        records: normalized.records,
        sourceName: "data/restaurants.js",
        templateName: req.body?.templateName || "restaurant-ai-sms.txt"
      });
      const saved = context.repositories.records.replaceAll({
        records: normalized.records,
        projectId: project.id,
        sourceName: "data/restaurants.js"
      });
      const updatedProject = context.repositories.projects.touchRecordCount(project.id);
      context.logger.info(
        { projectId: project.id, count: saved.count, sourceName: "data/restaurants.js" },
        "Sample records loaded into project"
      );
      res.json({
        ...saved,
        project: updatedProject,
        errors: normalized.errors,
        records: context.repositories.records.list({ projectId: project.id })
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/records/import", upload.single("file"), (req, res, next) => {
    try {
      if (!req.file) throw new AppError("IMPORT_FILE_REQUIRED", "Upload a supported data file.", 400);
      const parsed = parseImportBuffer({
        buffer: req.file.buffer,
        filename: req.file.originalname,
        limits: context.config.limits
      });
      const project = context.repositories.projects.createForImport({
        records: parsed.records,
        sourceName: req.file.originalname,
        templateName: req.body?.templateName || "restaurant-ai-sms.txt"
      });
      const saved = context.repositories.records.replaceAll({
        records: parsed.records,
        projectId: project.id,
        sourceName: req.file.originalname
      });
      const updatedProject = context.repositories.projects.touchRecordCount(project.id);
      context.logger.info(
        { projectId: project.id, count: saved.count, sourceName: req.file.originalname },
        "Records imported into project"
      );
      res.json({
        ...saved,
        project: updatedProject,
        errors: parsed.errors,
        records: context.repositories.records.list({ projectId: project.id })
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/records/import-url", async (req, res, next) => {
    try {
      if (!context.config.research.allowGoogleSheetsCsv) {
        throw new AppError(
          "GOOGLE_SHEETS_DISABLED",
          "Google Sheets CSV import is disabled by configuration.",
          403
        );
      }
      const parsed = await parseGoogleSheetsCsvUrl(req.body.url, {
        limits: context.config.limits,
        fetchImpl: context.fetchImpl
      });
      const project = context.repositories.projects.createForImport({
        records: parsed.records,
        sourceName: "google-sheet.csv",
        templateName: req.body?.templateName || "restaurant-ai-sms.txt"
      });
      const saved = context.repositories.records.replaceAll({
        records: parsed.records,
        projectId: project.id,
        sourceName: "google-sheet.csv"
      });
      const updatedProject = context.repositories.projects.touchRecordCount(project.id);
      context.logger.info(
        { projectId: project.id, count: saved.count, sourceName: "google-sheet.csv" },
        "Google Sheets records imported into project"
      );
      res.json({
        ...saved,
        project: updatedProject,
        errors: parsed.errors,
        records: context.repositories.records.list({ projectId: project.id })
      });
    } catch (error) {
      next(error);
    }
  });

  router.delete("/records", (req, res, next) => {
    try {
      const project = resolveProject(context, req.query.projectId);
      context.repositories.records.clear({ projectId: project?.id });
      if (project) context.repositories.projects.touchRecordCount(project.id);
      context.logger.warn({ projectId: project?.id }, "Project records cleared");
      res.json({ ok: true, projectId: project?.id });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
