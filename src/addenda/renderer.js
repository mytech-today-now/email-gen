import { sanitizeEmailHtml } from "../output/sanitizer.js";
import { markdownToHtml, textToHtml } from "./fallbacks.js";
import { prepareAddendumHtml } from "../output/addendumPreparer.js";

export function renderAddendum(addendum) {
  if (!addendum) {
    return { enabled: false, html: "", fallbackHtml: "", warning: null };
  }
  let html;
  if (addendum.mediaType === "text/html") html = addendum.content;
  else if (addendum.mediaType === "text/markdown") html = markdownToHtml(addendum.content);
  else if (addendum.mediaType === "text/plain") html = textToHtml(addendum.content);
  else return { enabled: true, html: "", fallbackHtml: "", warning: "Unsupported addendum media type." };

  const safe = addendum.mediaType === "text/html" ? prepareAddendumHtml(html) : sanitizeEmailHtml(html);
  return { enabled: true, html: safe, fallbackHtml: safe, warning: null };
}
