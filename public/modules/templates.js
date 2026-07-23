const VARIABLE_PATTERN = /{{{?\s*([^{}]+?)\s*}?}}/g;

function valueAt(record, path) {
  return path.split(".").reduce((value, key) => (value == null ? undefined : value[key]), record);
}

function parseVariableExpression(expression) {
  const pieces = String(expression)
    .split("|")
    .map((piece) => piece.trim());
  const rawPath = pieces.shift() ?? "";
  const optionalBySuffix = rawPath.endsWith("?");
  const path = optionalBySuffix ? rawPath.slice(0, -1) : rawPath;
  const variable = { name: path.trim(), required: !optionalBySuffix, defaultValue: undefined };

  for (const piece of pieces) {
    if (piece === "required") variable.required = true;
    if (piece === "optional") variable.required = false;
    const defaultMatch = piece.match(/^default:(?:"([^"]*)"|'([^']*)'|(.+))$/);
    if (defaultMatch) {
      variable.defaultValue = defaultMatch[1] ?? defaultMatch[2] ?? defaultMatch[3] ?? "";
      variable.required = false;
    }
  }

  return variable;
}

export function parseTemplateVariables(source) {
  const variables = [];
  const malformed = [];
  const seen = new Set();
  for (const match of String(source ?? "").matchAll(VARIABLE_PATTERN)) {
    const variable = parseVariableExpression(match[1]);
    if (!variable.name || /[{}]/.test(variable.name)) {
      malformed.push({ raw: match[0], message: `Malformed variable: ${match[0]}` });
      continue;
    }
    const key = `${variable.name}:${variable.required}:${variable.defaultValue ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    variables.push({ raw: match[0], ...variable });
  }
  const unmatched = String(source ?? "").match(/{{[^}]*$|^[^{]*}}/gm) ?? [];
  unmatched.forEach((raw) => malformed.push({ raw, message: `Unclosed variable marker: ${raw}` }));
  return { variables, malformed };
}

export function analyzeTemplate(source, record = {}) {
  const parsed = parseTemplateVariables(source);
  const missing = [];
  const blank = [];
  for (const variable of parsed.variables) {
    const value = valueAt(record, variable.name);
    if (value === undefined || value === null) {
      if (variable.required && variable.defaultValue === undefined) missing.push(variable.name);
    } else if (String(value).trim() === "" && variable.required) blank.push(variable.name);
  }
  return {
    ...parsed,
    missing: [...new Set(missing)],
    blank: [...new Set(blank)],
    canProcess: !parsed.malformed.length && !missing.length && !blank.length
  };
}

export function renderTemplate(source, record = {}) {
  const analysis = analyzeTemplate(source, record);
  const rendered = String(source ?? "").replace(VARIABLE_PATTERN, (_raw, expression) => {
    const variable = parseVariableExpression(expression);
    if (!variable.name) return "";
    const value = valueAt(record, variable.name);
    return value === undefined || value === null || value === ""
      ? (variable.defaultValue ?? "")
      : String(value);
  });
  return { rendered, analysis };
}

export function safeTemplateName(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[^a-zA-Z0-9._ -]+/g, "-")
    .replace(/\.{2,}/g, ".")
    .replace(/^[-.\s]+|[-.\s]+$/g, "")
    .slice(0, 120);
}
