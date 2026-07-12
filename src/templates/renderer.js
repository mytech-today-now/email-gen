import { AppError } from "../utils/errors.js";
import { escapeHtml } from "../utils/helpers.js";
import { analyzeRecord, formatValueForPrompt, parseVariableExpression, resolvePath } from "./variables.js";

const PLACEHOLDER_REGEX = /{{{?\s*([^{}]+?)\s*}?}}/g;

export function renderTemplate(template, recordData, { escape = false, blockOnMissing = true } = {}) {
  const analysis = analyzeRecord(template, recordData);
  if (blockOnMissing && !analysis.canProcess) {
    throw new AppError(
      "TEMPLATE_VARIABLE_MISSING",
      "Required template variables are missing or malformed.",
      400,
      analysis
    );
  }

  const rendered = template.replace(PLACEHOLDER_REGEX, (raw, expression) => {
    const variable = parseVariableExpression(expression.trim());
    const value = resolvePath(recordData, variable.path);
    const finalValue =
      value === undefined || value === null || String(value).trim() === ""
        ? (variable.defaultValue ?? "")
        : formatValueForPrompt(value);
    return escape && !raw.startsWith("{{{") ? escapeHtml(finalValue) : finalValue;
  });

  return { rendered, analysis };
}
