import sanitizeHtml from "sanitize-html";
import { escapeHtml } from "../utils/helpers.js";

export function safeUrl(url) {
  try {
    const parsed = new URL(url, "https://example.invalid");
    if (parsed.protocol === "http:" || parsed.protocol === "https:" || parsed.protocol === "mailto:" || parsed.protocol === "tel:") {
      return url;
    }
  } catch {
    return "";
  }
  return "";
}

export function sanitizeEmailHtml(html) {
  return sanitizeHtml(String(html ?? ""), {
    allowedTags: ["p", "br", "strong", "b", "em", "i", "u", "ul", "ol", "li", "a", "span", "div", "section", "table", "tbody", "tr", "td"],
    allowedAttributes: {
      a: ["href", "title"],
      span: ["style"],
      div: ["style"],
      p: ["style"],
      table: ["role", "cellpadding", "cellspacing", "border", "width", "style"],
      td: ["style", "align", "valign", "width"]
    },
    allowedSchemes: ["http", "https", "mailto", "tel"],
    transformTags: {
      a: (_tagName, attribs) => ({
        tagName: "a",
        attribs: {
          href: safeUrl(attribs.href),
          title: attribs.title || ""
        }
      }),
      b: "strong",
      i: "em"
    },
    disallowedTagsMode: "discard"
  });
}

export function textToSafeHtml(text) {
  const paragraphs = String(text ?? "")
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`)
    .join("\n");
  return paragraphs || "<p></p>";
}

export function htmlToPlainText(html) {
  return sanitizeHtml(
    String(html ?? "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n\n")
      .replace(/<\/div>/gi, "\n\n")
      .replace(/<\/li>/gi, "\n")
      .replace(/<\/ul>/gi, "\n")
      .replace(/<\/ol>/gi, "\n"),
    {
      allowedTags: [],
      allowedAttributes: {}
    }
  )
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
