import { normalizeWhitespace } from "../utils/helpers.js";

const PLACEHOLDER_REGEX = /{{{?\s*([^{}]+?)\s*}?}}/g;

export function resolvePath(data, pathExpression) {
  const parts = String(pathExpression)
    .split(".")
    .map((part) => part.trim())
    .filter(Boolean);
  let current = data;
  for (const part of parts) {
    if (current === undefined || current === null || typeof current !== "object") return undefined;
    current = current[part];
  }
  return current;
}

export function parseVariableExpression(expression) {
  const pieces = expression.split("|").map((piece) => piece.trim());
  const rawPath = pieces.shift() ?? "";
  const optionalBySuffix = rawPath.endsWith("?");
  const path = optionalBySuffix ? rawPath.slice(0, -1) : rawPath;
  const options = { required: !optionalBySuffix, defaultValue: undefined };

  for (const piece of pieces) {
    if (piece === "required") options.required = true;
    if (piece === "optional") options.required = false;
    const defaultMatch = piece.match(/^default:(?:"([^"]*)"|'([^']*)'|(.+))$/);
    if (defaultMatch) {
      options.defaultValue = defaultMatch[1] ?? defaultMatch[2] ?? defaultMatch[3] ?? "";
      options.required = false;
    }
  }

  return { path: path.trim(), ...options };
}

export function discoverVariables(template) {
  const variables = [];
  const malformed = [];
  const seen = new Set();
  let match;
  while ((match = PLACEHOLDER_REGEX.exec(template)) !== null) {
    const raw = match[0];
    const expression = match[1].trim();
    const variable = parseVariableExpression(expression);
    const key = `${variable.path}:${variable.required}:${variable.defaultValue ?? ""}`;
    if (!seen.has(key)) {
      variables.push({ ...variable, raw, expression, rawOutput: raw.startsWith("{{{") });
      seen.add(key);
    }
  }

  const openCount = (template.match(/{{/g) ?? []).length;
  const closeCount = (template.match(/}}/g) ?? []).length;
  if (openCount !== closeCount) {
    malformed.push({
      code: "UNBALANCED_PLACEHOLDERS",
      message: "Template contains unbalanced placeholder braces."
    });
  }
  if (/{{\s*}}/.test(template)) {
    malformed.push({ code: "EMPTY_PLACEHOLDER", message: "Template contains an empty placeholder." });
  }

  return { variables, malformed };
}

export function analyzeRecord(template, recordData) {
  const { variables, malformed } = discoverVariables(template);
  const missing = [];
  const blank = [];
  for (const variable of variables) {
    const value = resolvePath(recordData, variable.path);
    if (value === undefined || value === null) {
      if (variable.required) missing.push(variable.path);
      continue;
    }
    if (String(value).trim() === "") {
      if (variable.required) blank.push(variable.path);
    }
  }
  return {
    variables,
    malformed,
    missing,
    blank,
    canProcess: malformed.length === 0 && missing.length === 0 && blank.length === 0
  };
}

export function analyzeRecords(template, records) {
  const rows = records.map((record) => ({
    recordId: record.id,
    displayName: record.displayName,
    ...analyzeRecord(template, record.normalized)
  }));
  return {
    variables: discoverVariables(template).variables,
    malformed: discoverVariables(template).malformed,
    rows,
    canProcess: rows.every((row) => row.canProcess)
  };
}

export function formatValueForPrompt(value) {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return normalizeWhitespace(JSON.stringify(value));
}
