import fs from "node:fs";
import path from "node:path";
import { AppError } from "./errors.js";
import { LIMIT_DEFAULTS, utf8ByteLength } from "../../public/modules/limits.js";

const RESERVED_WINDOWS_NAMES = new Set([
  "con",
  "prn",
  "aux",
  "nul",
  "com1",
  "com2",
  "com3",
  "com4",
  "com5",
  "com6",
  "com7",
  "com8",
  "com9",
  "lpt1",
  "lpt2",
  "lpt3",
  "lpt4",
  "lpt5",
  "lpt6",
  "lpt7",
  "lpt8",
  "lpt9"
]);

export function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

export function resolveInside(baseDir, requestedPath) {
  const resolved = path.resolve(baseDir, requestedPath);
  const base = path.resolve(baseDir);
  const relative = path.relative(base, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new AppError("PATH_TRAVERSAL", "Requested path is outside the allowed directory.", 400);
  }
  return resolved;
}

export function slugify(value, fallback = "item") {
  const normalized = String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
  const slug = normalized || fallback;
  return RESERVED_WINDOWS_NAMES.has(slug) ? `${slug}-file` : slug;
}

export function safeExportFilename({
  id,
  name,
  suffix = "ai-sms",
  extension = ".html",
  maxLength = LIMIT_DEFAULTS.exportFilenameLength
}) {
  const byteLimit =
    Number.isInteger(maxLength) && maxLength > 0 ? maxLength : LIMIT_DEFAULTS.exportFilenameLength;
  const idPart = id !== undefined && id !== null && `${id}` !== "" ? `${String(id).padStart(4, "0")}-` : "";
  const base = `${idPart}${slugify(name, "prospect")}-${slugify(suffix, "email")}`.replace(/-+/g, "-");
  const ext = extension.startsWith(".") ? extension : `.${extension}`;
  const maxBaseBytes = Math.max(1, byteLimit - utf8ByteLength(ext));
  let trimmed = base.replace(/[-. ]+$/g, "");
  while (trimmed && utf8ByteLength(trimmed) > maxBaseBytes) {
    trimmed = trimmed.slice(0, -1);
  }
  return `${trimmed || "email"}${ext}`;
}

export function uniquePath(dirPath, filename) {
  const parsed = path.parse(filename);
  let candidate = path.join(dirPath, filename);
  let index = 1;
  while (fs.existsSync(candidate)) {
    candidate = path.join(dirPath, `${parsed.name}-${index}${parsed.ext}`);
    index += 1;
  }
  return candidate;
}

export function readTextFileBounded(filePath, maxBytes) {
  const stat = fs.statSync(filePath);
  if (stat.size > maxBytes) {
    throw new AppError("FILE_TOO_LARGE", "File exceeds the configured size limit.", 413);
  }
  return fs.readFileSync(filePath, "utf8");
}
