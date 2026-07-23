import { z } from "zod";
import { AppError } from "../utils/errors.js";
import { normalizeAiResponse } from "./responseParser.js";

export const StructuredEmailSchema = z.object({
  subject: z.string().min(1).max(160),
  bodyHtml: z.string().min(1)
});

export const structuredEmailJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: { subject: { type: "string" }, bodyHtml: { type: "string" } },
  required: ["subject", "bodyHtml"]
};

export function parseStructuredEmailContent(value) {
  if ((typeof value === "object" && value) || Array.isArray(value)) {
    return StructuredEmailSchema.parse(normalizeAiResponse(value));
  }
  const text = String(value ?? "")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  try {
    return StructuredEmailSchema.parse(normalizeAiResponse(JSON.parse(text)));
  } catch {
    try {
      return StructuredEmailSchema.parse(normalizeAiResponse(text));
    } catch {
      throw new AppError(
        "PROVIDER_RESPONSE_INVALID",
        "The provider did not return a usable email subject and body.",
        502
      );
    }
  }
}
