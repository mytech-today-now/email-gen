import crypto from "node:crypto";
import { isPlainObject } from "../utils/helpers.js";
import { looksLikeUrlField } from "./validators.js";

export function normalizeFieldName(name) {
  const cleaned = String(name ?? "")
    .trim()
    .replace(/^\uFEFF/, "");
  if (!cleaned) return "";
  const parts = cleaned.split(/[_\s-]+/).filter(Boolean);
  if (parts.length > 1) {
    return parts
      .map((part, index) => {
        const lower = /^[A-Z0-9]+$/.test(part)
          ? part.toLowerCase()
          : part.replace(/^[A-Z]/, (char) => char.toLowerCase());
        return index === 0 ? lower : lower.replace(/^[a-z]/, (char) => char.toUpperCase());
      })
      .join("");
  }
  if (/^[A-Z0-9]+$/.test(cleaned)) return cleaned.toLowerCase();
  return cleaned.replace(/^[A-Z]/, (char) => char.toLowerCase());
}

function isBlankRow(record) {
  return Object.values(record).every(
    (value) => value === undefined || value === null || String(value).trim() === ""
  );
}

function stableGeneratedId(sourceName, sourceRow, raw) {
  const hash = crypto
    .createHash("sha256")
    .update(`${sourceName}:${sourceRow}:${JSON.stringify(raw)}`)
    .digest("hex")
    .slice(0, 12);
  return `generated-${sourceRow}-${hash}`;
}

function displayNameFor(normalized) {
  return (
    normalized.name ??
    normalized.company ??
    normalized.contactName ??
    normalized.email ??
    normalized.website ??
    normalized.id ??
    "Unnamed prospect"
  ).toString();
}

export function normalizeRecords(inputRecords, { sourceName = "import", limits }) {
  const records = [];
  const errors = [];
  const idCounts = new Map();

  inputRecords.forEach((rawRecord, index) => {
    const sourceRow = index + 1;
    if (!isPlainObject(rawRecord)) {
      errors.push({ sourceRow, code: "NOT_OBJECT", message: "Record is not a plain object." });
      return;
    }
    if (isBlankRow(rawRecord)) return;

    const originalKeys = Object.keys(rawRecord);
    const validation = { warnings: [], errors: [] };
    if (originalKeys.length > limits.fields) {
      validation.errors.push({
        code: "TOO_MANY_FIELDS",
        message: `Record has more than ${limits.fields} fields.`
      });
    }

    const normalized = {};
    const originalFieldNames = {};
    for (const [key, value] of Object.entries(rawRecord)) {
      const normalizedKey = normalizeFieldName(key);
      if (!normalizedKey) continue;
      originalFieldNames[normalizedKey] = key;
      const stringValue = value === undefined || value === null ? value : String(value);
      if (
        stringValue !== undefined &&
        stringValue !== null &&
        Buffer.byteLength(stringValue, "utf8") > limits.fieldBytes
      ) {
        validation.errors.push({
          code: "FIELD_TOO_LARGE",
          field: key,
          message: `Field '${key}' exceeds ${limits.fieldBytes} bytes.`
        });
        normalized[normalizedKey] = stringValue.slice(0, limits.fieldBytes);
      } else {
        normalized[normalizedKey] = value;
      }

      if (looksLikeUrlField(normalizedKey) && value) {
        try {
          const url = new URL(String(value));
          if (!["http:", "https:"].includes(url.protocol)) {
            validation.warnings.push({
              code: "UNSUPPORTED_URL_PROTOCOL",
              field: key,
              message: "Only http and https URLs are supported."
            });
          }
        } catch {
          validation.warnings.push({
            code: "MALFORMED_URL",
            field: key,
            message: "URL-looking field is not a valid URL."
          });
        }
      }
    }

    normalized.__originalFieldNames = originalFieldNames;
    const candidateId = normalized.id ?? normalized.recordId ?? normalized.companyId;
    const internalId =
      candidateId !== undefined && candidateId !== null && String(candidateId).trim() !== ""
        ? String(candidateId).trim()
        : stableGeneratedId(sourceName, sourceRow, rawRecord);
    normalized.__internalId = internalId;
    normalized.__sourceRow = sourceRow;
    const currentCount = idCounts.get(internalId) ?? 0;
    idCounts.set(internalId, currentCount + 1);

    records.push({
      internalId,
      sourceRow,
      displayName: displayNameFor(normalized),
      raw: rawRecord,
      normalized,
      validation
    });
  });

  for (const record of records) {
    if ((idCounts.get(record.internalId) ?? 0) > 1) {
      record.validation.warnings.push({
        code: "DUPLICATE_ID",
        message: `Imported ID '${record.internalId}' appears more than once.`
      });
    }
  }

  if (records.length > limits.records) {
    errors.push({
      code: "TOO_MANY_RECORDS",
      message: `Import contains more than ${limits.records} records.`
    });
    return { records: records.slice(0, limits.records), errors };
  }

  return { records, errors };
}
