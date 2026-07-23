import { z } from "zod";
import { AppError } from "../utils/errors.js";
import { normalizeWhitespace } from "../utils/helpers.js";
import { htmlToPlainText, sanitizeEmailHtml, textToSafeHtml } from "../output/sanitizer.js";

export const EmailResponseSchema = z.object({
  subject: z.string().trim().min(1).max(160),
  body: z.string().trim().min(1)
});

export function stripMarkdownFence(text) {
  return String(text ?? "")
    .trim()
    .replace(/^```(?:[\w-]+)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function collectTextContent(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map((item) => collectTextContent(item)).filter(Boolean).join("");
  if (value && typeof value === "object") {
    const candidates = [
      value.text,
      value.content,
      value.delta,
      value.message,
      value.choices,
      value.parts,
      value.items,
      value.output,
      value.output_text
    ];
    for (const candidate of candidates) {
      const text = Array.isArray(candidate)
        ? collectTextContent(candidate)
        : typeof candidate === "string"
          ? candidate
          : candidate && typeof candidate === "object"
            ? collectTextContent(candidate)
            : "";
      if (text) return text;
    }
  }
  return "";
}

function looksLikeHtml(text) {
  return /<(?:!doctype|html|head|body|title|table|section|div|p|h[1-6]|ul|ol|li|a|span|br|tr|td|th|!--)/i.test(
    String(text ?? "")
  );
}

function inferHtmlSubject(html) {
  const clean = String(html ?? "").trim();
  if (!clean) return "";
  const commentMatch = clean.match(/<!--\s*Subject:\s*([\s\S]*?)\s*-->/i);
  if (commentMatch) return normalizeWhitespace(htmlToPlainText(commentMatch[1]));
  const titleMatch = clean.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch) return normalizeWhitespace(htmlToPlainText(titleMatch[1]));
  const headingMatch = clean.match(/<(?:h1|h2)[^>]*>([\s\S]*?)<\/(?:h1|h2)>/i);
  if (headingMatch) return normalizeWhitespace(htmlToPlainText(headingMatch[1]));
  const plainText = htmlToPlainText(clean);
  const firstLine = plainText.split(/\n+/).find((line) => line.trim()) ?? "";
  return normalizeWhitespace(firstLine);
}

function extractHtmlSubjectAndBody(text) {
  const clean = stripMarkdownFence(text);
  if (!looksLikeHtml(clean)) return null;
  const subject = inferHtmlSubject(clean);
  if (!subject) return null;
  return { subject, body: clean };
}

function normalizeStructuredCandidate(candidate) {
  if (!candidate || typeof candidate !== "object") {
    throw new AppError("AI_RESPONSE_INVALID", "AI response did not contain a usable subject and body.", 502);
  }

  const subject = candidate.subject ?? candidate.Subject ?? candidate.title ?? "";
  const body =
    candidate.bodyHtml ??
    candidate.body ??
    candidate.html ??
    collectTextContent(candidate.content) ??
    collectTextContent(candidate.message) ??
    collectTextContent(candidate.choices) ??
    collectTextContent(candidate.parts) ??
    collectTextContent(candidate.output) ??
    collectTextContent(candidate.delta);

  const cleanBody = String(body ?? "").trim();
  if (!cleanBody) {
    throw new AppError("AI_RESPONSE_INVALID", "AI response did not contain a usable subject and body.", 502);
  }

  const normalizedSubject = normalizeWhitespace(subject);
  if (normalizedSubject) {
    return EmailResponseSchema.parse({
      subject: normalizedSubject,
      body: cleanBody
    });
  }

  try {
    return parseAiTextResponse(cleanBody);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("AI_RESPONSE_INVALID", "AI response did not contain a usable subject and body.", 502);
  }
}

function extractLegacySubjectAndBody(text) {
  const clean = stripMarkdownFence(text);
  const lines = clean.split(/\r?\n/);
  const subjectIndex = lines.findIndex((line) => /^\s*\*{0,2}\s*subject\s*:\s*\*{0,2}\s*/i.test(line));
  if (subjectIndex < 0) return null;

  const subject = normalizeWhitespace(
    lines[subjectIndex].replace(/^\s*\*{0,2}\s*subject\s*:\s*\*{0,2}\s*/i, "").replace(/\s*\*{1,2}\s*$/, "")
  );
  const body = lines
    .filter((_line, index) => index !== subjectIndex)
    .join("\n")
    .replace(/^\s*[-*_]{3,}\s*$/gm, "")
    .trim();

  if (!subject || !body) {
    throw new AppError("AI_RESPONSE_INVALID", "AI response did not contain a usable subject and body.", 502);
  }
  return { subject, body };
}

export function parseAiTextResponse(text) {
  const clean = stripMarkdownFence(text);
  try {
    return normalizeStructuredCandidate(JSON.parse(clean));
  } catch (error) {
    const legacy = extractLegacySubjectAndBody(clean);
    if (legacy) return EmailResponseSchema.parse(legacy);
    const html = extractHtmlSubjectAndBody(clean);
    if (html) return EmailResponseSchema.parse(html);
    if (error instanceof AppError) throw error;
    throw new AppError("AI_RESPONSE_INVALID", "AI response did not contain a usable subject and body.", 502);
  }
}

export function normalizeAiResponse(response) {
  const parsed = Array.isArray(response)
    ? parseAiTextResponse(collectTextContent(response))
    : response && typeof response === "object"
      ? normalizeStructuredCandidate(response)
      : parseAiTextResponse(String(response ?? ""));

  return {
    subject: normalizeWhitespace(parsed.subject),
    bodyHtml: sanitizeEmailHtml(
      /<\/?[a-z][\s\S]*>/i.test(parsed.body) ? parsed.body : textToSafeHtml(parsed.body)
    )
  };
}
