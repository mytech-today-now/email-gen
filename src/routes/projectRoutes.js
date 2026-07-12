import express from "express";
import { AppError } from "../utils/errors.js";

export function projectRoutes(context) {
  const router = express.Router();

  router.get("/projects", (req, res, next) => {
    try {
      const projects = context.repositories.projects.list();
      const activeProject = context.repositories.projects.resolve(req.query.projectId);
      res.json({ projects, activeProject });
    } catch (error) {
      next(error);
    }
  });

  router.get("/projects/:id", (req, res, next) => {
    try {
      const project = context.repositories.projects.get(req.params.id);
      if (!project) throw new AppError("PROJECT_NOT_FOUND", "Project was not found.", 404);
      res.json({ project });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
