import { escapeHtml } from "../utils/helpers.js";
import { sanitizeEmailHtml, textToSafeHtml, htmlToPlainText } from "./sanitizer.js";

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

export function renderEmailFragment({ subject, bodyHtml, addendumHtml = "", config }) {
  const safeSubject = escapeHtml(subject);
  const cleanedBody = stripAppendedEmailArtifacts(bodyHtml, config);
  const safeBody = applyEmailSpacing(normalizeAiBody(cleanedBody));
  const safeAddendum = addendumHtml ? sanitizeEmailHtml(addendumHtml) : "";
  const aiSmsUrl = escapeHtml(config.business.aiSmsUrl);
  const signature = signatureHtml(config.business.signature);
  const finalLinkLabel = escapeHtml(config.business.aiSmsUrl);

  return `<!-- Subject: ${safeSubject} -->
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;background:#ffffff;">
  <tr>
    <td style="font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.52;color:#1d252c;padding:0;">
      ${safeBody}
      ${safeAddendum ? `<div style="margin-top:18px;border-top:1px solid #d8dedc;padding-top:14px;">${safeAddendum}</div>` : ""}
      <p style="margin:18px 0 0 0;">${signature}</p>
      <p style="margin:18px 0 0 0;"><a href="${aiSmsUrl}" style="color:#0b6b6f;text-decoration:underline;">${finalLinkLabel}</a></p>
    </td>
  </tr>
</table>`;
}

export function renderPlainText({ subject, bodyHtml, addendumHtml = "", config }) {
  const cleanedBody = stripAppendedEmailArtifacts(bodyHtml, config);
  const body = htmlToPlainText(cleanedBody);
  const addendum = addendumHtml ? `\n\n${htmlToPlainText(addendumHtml)}` : "";
  return `Subject: ${subject}\n\n${body}${addendum}\n\n${config.business.signature}\n\n${config.business.aiSmsUrl}`;
}
