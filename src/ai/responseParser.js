import { z } from "zod";
import { AppError } from "../utils/errors.js";
import { normalizeWhitespace } from "../utils/helpers.js";
import { sanitizeEmailHtml, textToSafeHtml } from "../output/sanitizer.js";

export const EmailResponseSchema = z.object({
  subject: z.string().trim().min(1).max(160),
  bodyHtml: z.string().trim().min(1)
});

export function stripMarkdownFence(text) {
  return String(text ?? "")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

export function parseAiTextResponse(text) {
  const clean = stripMarkdownFence(text);
  try {
    return EmailResponseSchema.parse(JSON.parse(clean));
  } catch {
    const subjectMatch = clean.match(/^subject:\s*(.+)$/im);
    const subject = normalizeWhitespace(subjectMatch?.[1] ?? "Quick idea for your team");
    const body = clean.replace(/^subject:\s*.+$/im, "").trim();
    const parsed = EmailResponseSchema.safeParse({ subject, bodyHtml: body || clean });
    if (parsed.success) return parsed.data;
    throw new AppError(
      "AI_RESPONSE_INVALID",
      "AI response did not contain a usable subject and body.",
      502,
      parsed.error.issues
    );
  }
}

export function normalizeAiResponse(response) {
  const parsed =
    response && typeof response === "object" && "subject" in response && "bodyHtml" in response
      ? EmailResponseSchema.parse(response)
      : parseAiTextResponse(String(response ?? ""));

  return {
    subject: normalizeWhitespace(parsed.subject),
    bodyHtml: sanitizeEmailHtml(
      /<\/?[a-z][\s\S]*>/i.test(parsed.bodyHtml) ? parsed.bodyHtml : textToSafeHtml(parsed.bodyHtml)
    )
  };
}
