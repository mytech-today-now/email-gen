import { escapeHtml } from "../utils/helpers.js";
import { sanitizeEmailHtml, textToSafeHtml, htmlToPlainText } from "./sanitizer.js";

function signatureHtml(signature) {
  return escapeHtml(signature).replace(/\n/g, "<br>");
}

export function normalizeAiBody(bodyHtml) {
  const looksLikeHtml = /<\/?[a-z][\s\S]*>/i.test(bodyHtml);
  return sanitizeEmailHtml(looksLikeHtml ? bodyHtml : textToSafeHtml(bodyHtml));
}

export function renderEmailFragment({ subject, bodyHtml, addendumHtml = "", record, config }) {
  const safeSubject = escapeHtml(subject);
  const safeBody = normalizeAiBody(bodyHtml);
  const safeAddendum = addendumHtml ? sanitizeEmailHtml(addendumHtml) : "";
  const displayName = escapeHtml(record.displayName ?? record.normalized?.name ?? "there");
  const aiSmsUrl = escapeHtml(config.business.aiSmsUrl);
  const signature = signatureHtml(config.business.signature);
  const footer = `${escapeHtml(config.business.name)} · ${escapeHtml(config.business.city)}, ${escapeHtml(config.business.region)}`;

  return `<!-- Subject: ${safeSubject} -->
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;background:#ffffff;">
  <tr>
    <td style="font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.52;color:#1d252c;padding:0;">
      <p style="margin:0 0 14px 0;"><a href="${aiSmsUrl}" style="color:#0b6b6f;text-decoration:underline;">AI SMS examples</a></p>
      ${safeBody}
      ${safeAddendum ? `<div style="margin-top:18px;border-top:1px solid #d8dedc;padding-top:14px;">${safeAddendum}</div>` : ""}
      <p style="margin:18px 0 0 0;">${signature}</p>
      <p style="margin:18px 0 0 0;"><a href="${aiSmsUrl}" style="color:#0b6b6f;text-decoration:underline;">AI SMS examples</a></p>
      <p style="margin:18px 0 0 0;font-size:12px;line-height:1.4;color:#66736f;">${footer}</p>
      <p style="display:none;">Personalized for ${displayName}</p>
    </td>
  </tr>
</table>`;
}

export function renderPlainText({ subject, bodyHtml, addendumHtml = "", config }) {
  const body = htmlToPlainText(bodyHtml);
  const addendum = addendumHtml ? `\n\n${htmlToPlainText(addendumHtml)}` : "";
  return `Subject: ${subject}\n\nAI SMS examples: ${config.business.aiSmsUrl}\n\n${body}${addendum}\n\n${config.business.signature}\n\nAI SMS examples: ${config.business.aiSmsUrl}\n\n${config.business.name} · ${config.business.city}, ${config.business.region}`;
}
