import express from "express";
import { listAddenda, loadAddendum } from "../addenda/loader.js";
import { renderAddendum } from "../addenda/renderer.js";

export function addendumRoutes(context) {
  const router = express.Router();
  router.get("/addenda", (_req, res) => {
    res.json({ addenda: listAddenda(context.config) });
  });

  router.get("/addenda/:name", (req, res, next) => {
    try {
      const addendum = loadAddendum(context.config, req.params.name);
      res.json({ addendum, rendered: renderAddendum(addendum) });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
