import fs from "node:fs";
import path from "node:path";
import { AppError } from "../utils/errors.js";
import { readTextFileBounded, resolveInside } from "../utils/files.js";

const TEMPLATE_EXTENSIONS = new Set([".txt", ".md", ".prompt"]);

export function listTemplates(config) {
  if (!fs.existsSync(config.promptsDir)) return [];
  return fs
    .readdirSync(config.promptsDir)
    .filter((file) => TEMPLATE_EXTENSIONS.has(path.extname(file).toLowerCase()))
    .sort()
    .map((file) => {
      const filePath = resolveInside(config.promptsDir, file);
      const stat = fs.statSync(filePath);
      return { name: file, path: file, bytes: stat.size, mediaType: "text/plain" };
    });
}

export function loadTemplate(config, name) {
  if (!name || name.includes("/") || name.includes("\\")) {
    throw new AppError("INVALID_TEMPLATE_NAME", "Template name is invalid.", 400);
  }
  const template = listTemplates(config).find((item) => item.name === name);
  if (!template) {
    throw new AppError("TEMPLATE_NOT_FOUND", "Template was not found.", 404);
  }
  const filePath = resolveInside(config.promptsDir, template.path);
  return { ...template, content: readTextFileBounded(filePath, config.limits.promptBytes) };
}
