import crypto from "node:crypto";

export function nowIso(clock = Date) {
  return new clock().toISOString();
}

export function makeId(prefix = "id") {
  return `${prefix}_${crypto.randomUUID()}`;
}

export function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function normalizeWhitespace(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

export function truncateBytes(value, maxBytes) {
  const text = String(value ?? "");
  const buffer = Buffer.from(text, "utf8");
  if (buffer.byteLength <= maxBytes) return text;
  return buffer.subarray(0, maxBytes).toString("utf8");
}

export function parseJson(value, fallback = null) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function isPlainObject(value) {
  return Object.prototype.toString.call(value) === "[object Object]";
}
