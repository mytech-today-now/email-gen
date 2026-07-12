import express from "express";
import multer from "multer";
import { allRestaurants } from "../../data/restaurants.js";
import { parseGoogleSheetsCsvUrl, parseImportBuffer } from "../data/importer.js";
import { AppError } from "../utils/errors.js";

export function dataRoutes(context) {
  const router = express.Router();
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: context.config.limits.uploadBytes, files: 1 }
  });

  router.get("/records", (_req, res) => {
    res.json({ records: context.repositories.records.list() });
  });

  router.post("/records/load-sample", (_req, res) => {
    const normalized = context.normalizeRecords(allRestaurants, {
      sourceName: "data/restaurants.js",
      limits: context.config.limits
    });
    const saved = context.repositories.records.replaceAll({
      records: normalized.records,
      sourceName: "data/restaurants.js"
    });
    res.json({ ...saved, errors: normalized.errors, records: context.repositories.records.list() });
  });

  router.post("/records/import", upload.single("file"), (req, res, next) => {
    try {
      if (!req.file) throw new AppError("IMPORT_FILE_REQUIRED", "Upload a supported data file.", 400);
      const parsed = parseImportBuffer({
        buffer: req.file.buffer,
        filename: req.file.originalname,
        limits: context.config.limits
      });
      const saved = context.repositories.records.replaceAll({
        records: parsed.records,
        sourceName: req.file.originalname
      });
      res.json({ ...saved, errors: parsed.errors, records: context.repositories.records.list() });
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
      const saved = context.repositories.records.replaceAll({
        records: parsed.records,
        sourceName: "google-sheet.csv"
      });
      res.json({ ...saved, errors: parsed.errors, records: context.repositories.records.list() });
    } catch (error) {
      next(error);
    }
  });

  router.delete("/records", (_req, res) => {
    context.repositories.records.clear();
    res.json({ ok: true });
  });

  return router;
}
