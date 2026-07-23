import sanitizeHtml from "sanitize-html";
import { escapeHtml } from "../utils/helpers.js";

export function safeUrl(url) {
  const candidate = String(url ?? "")
    .replace(/[\r\n\0]/g, "")
    .trim();
  try {
    const parsed = new URL(candidate, "https://example.invalid");
    if (parsed.protocol === "http:" || parsed.protocol === "https:" || parsed.protocol === "mailto:" || parsed.protocol === "tel:") {
      return candidate;
    }
  } catch {
    return "";
  }
  return "";
}

export function sanitizeEmailHtml(html) {
  return sanitizeHtml(String(html ?? ""), {
    // Deliberately constrained to markup that is both safe and broadly usable in
    // email clients.  In particular, retaining headings lets imported addenda
    // keep their document structure instead of turning into unstyled text.
    allowedTags: [
      "p", "br", "strong", "b", "em", "i", "u", "ul", "ol", "li", "a", "span", "div", "section",
      "h1", "h2", "h3", "h4", "table", "tbody", "tr", "td"
    ],
    allowedAttributes: {
      a: ["href", "title", "style", "rel"],
      span: ["style"],
      div: ["style"],
      p: ["style"],
      h1: ["style"],
      h2: ["style"],
      h3: ["style"],
      h4: ["style"],
      table: ["role", "cellpadding", "cellspacing", "border", "width", "style"],
      td: ["style", "align", "valign", "width"]
    },
    allowedSchemes: ["http", "https", "mailto", "tel"],
    allowedStyles: {
      "*": {
        color: [/^#[0-9a-f]{3,8}$/i, /^rgba?\([\d.,\s%]+\)$/i, /^[a-z]+$/i],
        "background-color": [/^#[0-9a-f]{3,8}$/i, /^rgba?\([\d.,\s%]+\)$/i, /^[a-z]+$/i],
        "font-family": [/^[\w\s,'"-]+$/],
        "font-size": [/^\d+(?:\.\d+)?(?:px|em|rem|%)$/],
        "font-weight": [/^(?:normal|bold|[1-9]00)$/],
        "line-height": [/^\d+(?:\.\d+)?(?:px|em|rem|%)?$/],
        "text-align": [/^(?:left|right|center|start|end)$/],
        "text-decoration": [/^(?:none|underline)$/],
        margin: [/^(?:0|\d+(?:\.\d+)?(?:px|em|rem|%))(?:\s+(?:0|\d+(?:\.\d+)?(?:px|em|rem|%))){0,3}$/],
        "margin-top": [/^(?:0|\d+(?:\.\d+)?(?:px|em|rem|%))$/],
        "margin-right": [/^(?:0|\d+(?:\.\d+)?(?:px|em|rem|%))$/],
        "margin-bottom": [/^(?:0|\d+(?:\.\d+)?(?:px|em|rem|%))$/],
        "margin-left": [/^(?:0|\d+(?:\.\d+)?(?:px|em|rem|%))$/],
        padding: [/^(?:0|\d+(?:\.\d+)?(?:px|em|rem|%))(?:\s+(?:0|\d+(?:\.\d+)?(?:px|em|rem|%))){0,3}$/],
        width: [/^(?:auto|100%|\d+(?:\.\d+)?(?:px|em|rem|%))$/],
        "max-width": [/^\d+(?:\.\d+)?(?:px|em|rem|%)$/],
        border: [/^[\d.]+px\s+(?:solid|dashed)\s+#[0-9a-f]{3,8}$/i],
        "border-top": [/^[\d.]+px\s+(?:solid|dashed)\s+#[0-9a-f]{3,8}$/i],
        "border-radius": [/^\d+(?:\.\d+)?(?:px|%)$/],
        display: [/^(?:block|inline|inline-block|table|table-row|table-cell|none)$/],
        "border-collapse": [/^collapse$/],
        "vertical-align": [/^(?:top|middle|bottom|baseline)$/]
      }
    },
    transformTags: {
      a: (_tagName, attribs) => ({
        tagName: "a",
        attribs: {
          href: safeUrl(attribs.href),
          title: attribs.title || "",
          style: attribs.style || "",
          rel: "noopener noreferrer"
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
