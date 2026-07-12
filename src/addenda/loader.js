import fs from "node:fs";
import path from "node:path";
import { AppError } from "../utils/errors.js";
import { readTextFileBounded, resolveInside } from "../utils/files.js";

const ADDENDUM_EXTENSIONS = new Set([".html", ".htm", ".txt", ".md"]);

export function listAddenda(config) {
  if (!fs.existsSync(config.addendaDir)) return [];
  return fs
    .readdirSync(config.addendaDir)
    .filter((file) => ADDENDUM_EXTENSIONS.has(path.extname(file).toLowerCase()))
    .sort()
    .map((file) => {
      const filePath = resolveInside(config.addendaDir, file);
      const stat = fs.statSync(filePath);
      return { name: file, path: file, bytes: stat.size, mediaType: mediaTypeFor(file) };
    });
}

export function mediaTypeFor(file) {
  const extension = path.extname(file).toLowerCase();
  if (extension === ".html" || extension === ".htm") return "text/html";
  if (extension === ".md") return "text/markdown";
  return "text/plain";
}

export function loadAddendum(config, name) {
  if (!name) return null;
  if (name.includes("/") || name.includes("\\")) {
    throw new AppError("INVALID_ADDENDUM_NAME", "Addendum name is invalid.", 400);
  }
  const addendum = listAddenda(config).find((item) => item.name === name);
  if (!addendum) throw new AppError("ADDENDUM_NOT_FOUND", "Addendum was not found.", 404);
  const filePath = resolveInside(config.addendaDir, addendum.path);
  return { ...addendum, content: readTextFileBounded(filePath, config.limits.addendumBytes) };
}
