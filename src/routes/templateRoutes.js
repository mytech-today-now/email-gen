import express from "express";
import { loadTemplate, listTemplates } from "../templates/loader.js";
import { renderTemplate } from "../templates/renderer.js";
import { analyzeRecords } from "../templates/variables.js";
import { AppError } from "../utils/errors.js";

export function templateRoutes(context) {
  const router = express.Router();
  router.get("/templates", (_req, res) => {
    res.json({ templates: listTemplates(context.config) });
  });

  router.get("/templates/:name", (req, res, next) => {
    try {
      const template = loadTemplate(context.config, req.params.name);
      const records = context.repositories.records.list();
      res.json({ template, analysis: analyzeRecords(template.content, records) });
    } catch (error) {
      next(error);
    }
  });

  router.post("/templates/preview", (req, res, next) => {
    try {
      const template = req.body.templateContent
        ? { name: "inline", content: req.body.templateContent }
        : loadTemplate(context.config, req.body.templateName);
      const record = context.repositories.records.get(req.body.recordId);
      if (!record) throw new AppError("RECORD_NOT_FOUND", "Record was not found.", 404);
      const preview = renderTemplate(template.content, record.normalized, { blockOnMissing: false });
      res.json({
        original: template.content,
        rendered: preview.rendered,
        analysis: preview.analysis,
        record
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
