import express from "express";
import { createHash } from "node:crypto";
import { listTemplates, loadTemplate } from "../templates/loader.js";
import { listAddenda, loadAddendum } from "../addenda/loader.js";

function checksum(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function migrationRoutes(context) {
  const router = express.Router();

  router.get("/migration/legacy", (req, res, next) => {
    try {
      context.requireGatewayRequest(req, { readOnly: true });
      const projects = context.repositories.projects.list();
      const records = projects.flatMap((project) =>
        context.repositories.records.list({ projectId: project.id })
      );
      const results = projects.flatMap((project) =>
        context.repositories.results.list({ projectId: project.id })
      );
      const jobs = projects.flatMap((project) =>
        context.repositories.jobs.list(10_000, { projectId: project.id })
      );
      const templates = listTemplates(context.config).map((item) => loadTemplate(context.config, item.name));
      const addenda = listAddenda(context.config).map((item) => loadAddendum(context.config, item.name));
      const payload = {
        migrationVersion: 1,
        exportedAt: new Date().toISOString(),
        projects,
        records,
        results,
        jobs,
        templates,
        addenda,
        counts: {
          projects: projects.length,
          records: records.length,
          results: results.length,
          jobs: jobs.length,
          templates: templates.length,
          addenda: addenda.length
        }
      };
      res.json({ ...payload, checksum: checksum(payload) });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
