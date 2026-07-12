import { escapeHtml } from "../utils/helpers.js";

export function markdownToHtml(markdown) {
  return String(markdown ?? "")
    .split(/\n{2,}/)
    .map((paragraph) => {
      const linked = escapeHtml(paragraph).replace(
        /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
        '<a href="$2">$1</a>'
      );
      return `<p>${linked.replace(/\n/g, "<br>")}</p>`;
    })
    .join("\n");
}

export function textToHtml(text) {
  return String(text ?? "")
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`)
    .join("\n");
}
