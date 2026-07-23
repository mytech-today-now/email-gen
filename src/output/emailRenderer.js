import { escapeHtml } from "../utils/helpers.js";
import { sanitizeEmailHtml, textToSafeHtml, htmlToPlainText } from "./sanitizer.js";
import { prepareAddendumHtml } from "./addendumPreparer.js";

function signatureHtml(signature) {
  return escapeHtml(signature).replace(/\n/g, "<br>");
}

function escapeForRegex(value) {
  return String(value ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripAppendedEmailArtifacts(bodyHtml, config) {
  const aiSmsUrl = escapeForRegex(config.business.aiSmsUrl);
  const businessName = escapeForRegex(config.business.name);
  const city = escapeForRegex(config.business.city);
  const region = escapeForRegex(config.business.region);

  return String(bodyHtml ?? "")
    .replace(new RegExp(`<a[^>]*href=["']${aiSmsUrl}["'][^>]*>.*?<\\/a>`, "gis"), "")
    .replace(new RegExp(escapeForRegex(config.business.aiSmsUrl), "gi"), "")
    .replace(
      /<p[^>]*>\s*Best Regards,\s*(?:<br\s*\/?>|\s)+\s*Kyle Rode\s*(?:<br\s*\/?>|\s)+\s*kyle@mytech\.today\s*(?:<br\s*\/?>|\s)+\s*\(847\)\s*767-4914\s*(?:<br\s*\/?>|\s)+\s*Hospitality Technology Solutions\s*<\/p>/gis,
      ""
    )
    .replace(
      /Best Regards,\s*(?:<br\s*\/?>|\s)+\s*Kyle Rode\s*(?:<br\s*\/?>|\s)+\s*kyle@mytech\.today\s*(?:<br\s*\/?>|\s)+\s*\(847\)\s*767-4914\s*(?:<br\s*\/?>|\s)+\s*Hospitality Technology Solutions/gi,
      ""
    )
    .replace(new RegExp(`${businessName}\\s*[·\\-]\\s*${city},\\s*${region}`, "gi"), "")
    .replace(/Personalized for [^<\n\r]+/gi, "")
    .replace(/<p[^>]*>\s*(?:&nbsp;|\s|<br\s*\/?>)*<\/p>/gi, "")
    .replace(/<div[^>]*>\s*(?:&nbsp;|\s|<br\s*\/?>)*<\/div>/gi, "")
    .trim();
}

function applyEmailSpacing(html) {
  return String(html ?? "")
    .replace(/<p(?![^>]*style=)([^>]*)>/gi, '<p$1 style="margin:0 0 16px 0;">')
    .replace(
      /<p([^>]*style=")([^"]*)("([^>]*)>)/gi,
      (_match, start, style, end) => `<p${start}${style.includes("margin:") ? style : `${style};margin:0 0 16px 0;`}${end}`
    )
    .replace(/<ul(?![^>]*style=)([^>]*)>/gi, '<ul$1 style="margin:0 0 16px 22px;padding:0;">')
    .replace(/<ol(?![^>]*style=)([^>]*)>/gi, '<ol$1 style="margin:0 0 16px 22px;padding:0;">')
    .replace(/<li(?![^>]*style=)([^>]*)>/gi, '<li$1 style="margin:0 0 8px 0;">');
}

export function normalizeAiBody(bodyHtml) {
  const looksLikeHtml = /<\/?[a-z][\s\S]*>/i.test(bodyHtml);
  return sanitizeEmailHtml(looksLikeHtml ? bodyHtml : textToSafeHtml(bodyHtml));
}

// The addendum is authored as a web page, but exports must work in clients
// which ignore flex/grid. These narrowly targeted transforms provide a stable
// table/inline-style fallback for its key calls to action before sanitization.
export function normalizeAddendumForEmail(addendumHtml) {
  let html = String(addendumHtml ?? "");
  const centeredTitles = ["How It Works", "Why Restaurants Love It", "Simple Pricing"];
  for (const title of centeredTitles) {
    const escaped = escapeForRegex(title);
    html = html.replace(
      new RegExp(`<h[1-4][^>]*>\\s*${escaped}\\s*<\\/h[1-4]>`, "gi"),
      `<h2 style="margin:0 0 16px;text-align:center;font-family:Arial,Helvetica,sans-serif;">${title}</h2>`
    );
  }
  html = html.replace(
    /<p([^>]*)>\s*per completed order\s*<\/p>/gi,
    '<div style="text-align:center;margin:0 0 24px;"><p$1>per completed order</p></div>'
  );
  html = html.replace(
    /<a([^>]*?)>\s*Call \(847\) 767-4914 to Start\s*<\/a>/gi,
    '<div style="text-align:center;margin:24px 0;"><a$1>Call (847) 767-4914 to Start</a></div>'
  );
  // A middle dash in a flex baseline can sit too low in Outlook. Non-breaking
  // spaces make the en dash an intentional inline price separator.
  return prepareAddendumHtml(
    html.replace(/>\s*–\s*<\/span>/g, ">&nbsp;&ndash;&nbsp;</span>")
  ).replace(/\u00a0–\u00a0/g, "&nbsp;&ndash;&nbsp;");
}

export function renderEmailFragment({ subject, bodyHtml, addendumHtml = "", config }) {
  const safeSubject = escapeHtml(subject);
  const cleanedBody = stripAppendedEmailArtifacts(bodyHtml, config);
  const safeBody = applyEmailSpacing(normalizeAiBody(cleanedBody));
  const safeAddendum = addendumHtml ? normalizeAddendumForEmail(addendumHtml) : "";
  const aiSmsUrl = escapeHtml(config.business.aiSmsUrl);
  const signature = signatureHtml(config.business.signature);
  const finalLinkLabel = escapeHtml(config.business.aiSmsUrl);

  return `<!-- Subject: ${safeSubject} -->
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;background:#ffffff;">
  <tr>
    <td style="font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.52;color:#1d252c;padding:0;">
      ${safeBody}
      <p style="margin:18px 0 0 0;">${signature}</p>
      <p style="margin:18px 0 0 0;"><a href="${aiSmsUrl}" style="color:#0b6b6f;text-decoration:underline;">${finalLinkLabel}</a></p>
      ${safeAddendum ? `<div style="margin-top:18px;border-top:1px solid #d8dedc;padding-top:14px;">${safeAddendum}</div>` : ""}
    </td>
  </tr>
</table>`;
}

export function renderPlainText({ subject, bodyHtml, addendumHtml = "", config }) {
  const cleanedBody = stripAppendedEmailArtifacts(bodyHtml, config);
  const body = htmlToPlainText(cleanedBody);
  const addendum = addendumHtml ? `\n\n${htmlToPlainText(addendumHtml)}` : "";
  return `Subject: ${subject}\n\n${body}\n\n${config.business.signature}\n\n${config.business.aiSmsUrl}${addendum}`;
}
