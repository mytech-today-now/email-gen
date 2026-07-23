import juice from "juice";
import { sanitizeEmailHtml } from "./sanitizer.js";

function bodyFragment(html) {
  return String(html).match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? String(html);
}

function emailSafeTransforms(html) {
  return String(html)
    .replace(/display\s*:\s*(?:grid|flex|inline-flex)\s*;?/gi, "display:block;")
    .replace(/grid-[^:;"']+\s*:[^;"']+;?/gi, "")
    .replace(/gap\s*:[^;"']+;?/gi, "")
    .replace(
      /<span([^>]*)>\s*\$1\s*<\/span>\s*<span[^>]*>\s*[–—_-]\s*<\/span>\s*<span[^>]*>\s*\$1\.50\s*<\/span>/gi,
      (_match, attributes) => `<span${attributes}>$1&ndash;$1.50</span>`
    )
    .replace(/\$1\s*[–—]\s*\$1\.50/g, () => "$1&ndash;$1.50")
    .replace(/©\s*2026\b/g, `© ${new Date().getFullYear()}`)
    .replaceAll("{{CURRENT_YEAR}}", String(new Date().getFullYear()));
}

export function prepareAddendumHtml(html) {
  const source = String(html ?? "");
  const completeDocument = /<!doctype|<html\b|<head\b|<body\b/i.test(source);
  const inlined = completeDocument
    ? juice(source, {
        applyStyleTags: true,
        removeStyleTags: true,
        preserveMediaQueries: false,
        applyWidthAttributes: true,
        applyTableAttributes: true,
        xmlMode: false
      })
    : source;
  return sanitizeEmailHtml(emailSafeTransforms(bodyFragment(inlined)));
}
