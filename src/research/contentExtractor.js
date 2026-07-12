import sanitizeHtml from "sanitize-html";
import { normalizeWhitespace, truncateBytes } from "../utils/helpers.js";

export function extractWebsiteText({ body, url }, { maxBytes = 12000 } = {}) {
  const title = normalizeWhitespace(
    (body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").replace(/<[^>]+>/g, "")
  );
  const withoutScripts = sanitizeHtml(body, { allowedTags: [], allowedAttributes: {} });
  const content = truncateBytes(normalizeWhitespace(withoutScripts), maxBytes);
  return {
    url,
    title,
    content,
    excerpt: truncateBytes(content, 2000)
  };
}
