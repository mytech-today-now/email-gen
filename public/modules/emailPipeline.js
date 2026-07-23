const ALLOWED_TAGS = new Set([
  "P",
  "BR",
  "STRONG",
  "B",
  "EM",
  "I",
  "U",
  "UL",
  "OL",
  "LI",
  "A",
  "SPAN",
  "DIV",
  "SECTION",
  "H1",
  "H2",
  "H3",
  "H4",
  "TABLE",
  "TBODY",
  "THEAD",
  "TFOOT",
  "TR",
  "TD",
  "TH"
]);
const GLOBAL_ATTRIBUTES = new Set(["style"]);
const TAG_ATTRIBUTES = {
  A: new Set(["href", "title", "rel"]),
  TABLE: new Set(["role", "cellpadding", "cellspacing", "border", "width"]),
  TD: new Set(["align", "valign", "width"]),
  TH: new Set(["align", "valign", "width", "scope"])
};
const STYLE_PROPERTIES = new Set([
  "color",
  "background-color",
  "font-family",
  "font-size",
  "font-weight",
  "line-height",
  "text-align",
  "text-decoration",
  "margin",
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "padding",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "width",
  "max-width",
  "border",
  "border-top",
  "border-radius",
  "display",
  "border-collapse",
  "vertical-align"
]);

export function safeUrl(value) {
  const candidate = String(value ?? "")
    .replace(/[\r\n\0]/g, "")
    .trim();
  try {
    const url = new URL(candidate, globalThis.location?.origin || "https://example.invalid");
    return ["http:", "https:", "mailto:", "tel:"].includes(url.protocol) ? candidate : "";
  } catch {
    return "";
  }
}

function validEmail(value) {
  const candidate = String(value ?? "")
    .replace(/[\r\n\0]/g, "")
    .trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate) ? candidate : "";
}

function encodeMailtoValue(value, { preserveLines = false } = {}) {
  const normalized = preserveLines
    ? String(value ?? "")
        .replace(/\r?\n/g, "\r\n")
        .trim()
    : String(value ?? "")
        .replace(/[\r\n]+/g, " ")
        .trim();
  return normalized ? encodeURIComponent(normalized) : "";
}

export function composeMailtoHref({ email, subject = "", body = "" } = {}) {
  const recipient = validEmail(email);
  if (!recipient) return "";
  const subjectValue = encodeMailtoValue(subject);
  const bodyValue = encodeMailtoValue(body, { preserveLines: true });
  const query = [subjectValue ? `subject=${subjectValue}` : "", bodyValue ? `body=${bodyValue}` : ""].filter(
    Boolean
  );
  return `mailto:${recipient}${query.length ? `?${query.join("&")}` : ""}`;
}

function safeStyle(value) {
  return String(value ?? "")
    .split(";")
    .map((declaration) => declaration.trim())
    .filter(Boolean)
    .map((declaration) => {
      const separator = declaration.indexOf(":");
      if (separator < 1) return "";
      const property = declaration.slice(0, separator).trim().toLowerCase();
      const styleValue = declaration.slice(separator + 1).trim();
      if (!STYLE_PROPERTIES.has(property)) return "";
      if (/url\s*\(|expression\s*\(|javascript:|@import|behavior\s*:/i.test(styleValue)) return "";
      return `${property}:${styleValue}`;
    })
    .filter(Boolean)
    .join(";");
}

export function sanitizeEmailHtml(html) {
  const documentNode = new DOMParser().parseFromString(`<body>${String(html ?? "")}</body>`, "text/html");
  const warnings = [];
  const walk = (node) => {
    for (const child of [...node.children]) {
      if (!ALLOWED_TAGS.has(child.tagName)) {
        warnings.push(`Removed unsupported <${child.tagName.toLowerCase()}> element.`);
        child.replaceWith(...child.childNodes);
        continue;
      }
      for (const attribute of [...child.attributes]) {
        const name = attribute.name.toLowerCase();
        const allowed = GLOBAL_ATTRIBUTES.has(name) || TAG_ATTRIBUTES[child.tagName]?.has(name);
        if (!allowed || name.startsWith("on")) {
          warnings.push(`Removed unsafe ${name} attribute.`);
          child.removeAttribute(attribute.name);
        }
      }
      if (child.hasAttribute("style")) {
        const style = safeStyle(child.getAttribute("style"));
        if (style) child.setAttribute("style", style);
        else child.removeAttribute("style");
      }
      if (child.tagName === "A") {
        const href = safeUrl(child.getAttribute("href"));
        if (href) child.setAttribute("href", href);
        else child.removeAttribute("href");
        child.setAttribute("rel", "noopener noreferrer");
      }
      walk(child);
    }
  };
  walk(documentNode.body);
  return { html: documentNode.body.innerHTML, warnings: [...new Set(warnings)] };
}

export function htmlToText(html) {
  const source = String(html ?? "");
  if (typeof DOMParser === "function") {
    const documentNode = new DOMParser().parseFromString(source, "text/html");
    documentNode.querySelectorAll("br").forEach((node) => node.replaceWith("\n"));
    documentNode.querySelectorAll("p,div,li,h1,h2,h3,h4,tr").forEach((node) => node.append("\n\n"));
    return (documentNode.body.textContent || "")
      .replace(/\r/g, "")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }
  return source
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, "\n\n")
    .replace(/<(?:ul|ol)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function escapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]
  );
}

function signatureHtml(value) {
  return escapeHtml(value).replace(/\n/g, "<br>");
}

export function composeCanonicalEmail({
  subject,
  aiBodyHtml,
  addendumHtml = "",
  signature = "",
  finalUrl = "",
  footerHtml = ""
}) {
  const body = sanitizeEmailHtml(aiBodyHtml);
  const addendum = sanitizeEmailHtml(addendumHtml);
  const footer = sanitizeEmailHtml(footerHtml);
  const url = safeUrl(finalUrl);
  const composed = `<!-- Subject: ${escapeHtml(subject)} --><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;background-color:#ffffff"><tbody><tr><td style="font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.52;color:#1d252c;padding:0">${body.html}<p style="margin:18px 0 0 0">${signatureHtml(signature)}</p>${url ? `<p style="margin:18px 0 0 0"><a href="${escapeHtml(url)}" style="color:#0b6b6f;text-decoration:underline">${escapeHtml(url)}</a></p>` : ""}${addendum.html ? `<div style="margin-top:18px;border-top:1px solid #d8dedc;padding-top:14px">${addendum.html}</div>` : ""}${footer.html}</td></tr></tbody></table>`;
  const final = sanitizeEmailHtml(composed);
  return {
    subject: String(subject ?? "")
      .replace(/[\r\n]/g, " ")
      .trim()
      .slice(0, 160),
    html: final.html,
    text: htmlToText(final.html),
    warnings: [...new Set([...body.warnings, ...addendum.warnings, ...footer.warnings, ...final.warnings])]
  };
}

export function sanitizeEditedEmail(html) {
  const sanitized = sanitizeEmailHtml(html);
  return { ...sanitized, text: htmlToText(sanitized.html) };
}

function telHref(value) {
  const display = String(value ?? "")
    .replace(/[\r\n]/g, " ")
    .trim();
  const digits = display.replace(/[^\d]/g, "");
  if (digits.length < 7) return "";
  return `tel:${display.startsWith("+") ? `+${digits}` : digits}`;
}

function cleanHeader(value, limit = 160) {
  return String(value ?? "")
    .replace(/[\r\n]/g, " ")
    .trim()
    .slice(0, limit);
}

export function resolveResultOutput(result = {}) {
  const subject = cleanHeader(result.subject);
  const finalEmailHtml = String(result.finalEmailHtml ?? result.emailHtml ?? result.bodyHtml ?? "").trim();
  const finalText = String(result.finalText ?? result.bodyText ?? "").trim() || htmlToText(finalEmailHtml);
  const originalAiBodyHtml = String(result.originalAiBodyHtml ?? result.bodyHtml ?? "").trim();
  return {
    subject,
    finalEmailHtml,
    finalText,
    originalAiBodyHtml
  };
}

function outputState(result = {}) {
  const { subject, finalEmailHtml, finalText, originalAiBodyHtml } = resolveResultOutput(result);
  const completed = result.status === "completed";
  const message = result.error?.message
    ? String(result.error.message)
    : completed
      ? "This result is missing either a subject or rendered HTML."
      : "This result has not completed successfully yet.";
  return {
    completed,
    subject,
    finalEmailHtml,
    finalText,
    originalAiBodyHtml,
    renderable: completed && Boolean(subject) && Boolean(finalEmailHtml),
    message
  };
}

export function hasRenderableResult(result) {
  return outputState(result).renderable;
}

export function renderStandaloneDocument({
  result,
  contacts = [],
  printFooter = "Generated locally by AI Batch Personalizer"
}) {
  const state = outputState(result);
  const contactItems = contacts
    .map((contact, index) => {
      const href =
        contact.type === "email"
          ? `mailto:${String(contact.value).replace(/[\r\n]/g, "")}`
          : contact.type === "phone"
            ? telHref(contact.value)
            : safeUrl(contact.value);
      if (!href) return "";
      const label = contact.type === "form" ? "Open public contact form" : String(contact.value ?? "");
      return `<li><a href="${escapeHtml(href)}" rel="noopener noreferrer">${escapeHtml(label)}</a>${index === 0 ? " <strong>(preferred)</strong>" : ""}<small>${escapeHtml(contact.sourceCategory || "unknown source")} · ${escapeHtml(contact.confidenceLabel || "unrated")} confidence · ${escapeHtml(contact.reason || "")}</small></li>`;
    })
    .filter(Boolean)
    .join("");
  const emailContent = state.renderable
    ? state.finalEmailHtml
    : `<section class="email-failure" role="alert"><h3>Output unavailable</h3><p>${escapeHtml(state.message)}</p></section>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(state.subject || "Email output unavailable")}</title><style>body{margin:0;background:#f3f5f4;color:#17201d;font-family:Arial,sans-serif}.shell{max-width:760px;margin:auto;padding:24px}.contacts,.email{background:#fff;border:1px solid #ccd5d2;padding:20px;margin-bottom:16px}.contacts{background:#eef7f5}.contacts h1{font-size:18px;margin-top:0}.contacts small{display:block;color:#52645f;margin-top:3px}.email-failure{border-left:4px solid #9b2c2c;padding-left:16px}@media print{.contacts{display:none}.shell{padding:0}.email{border:0}}</style></head><body><main class="shell"><aside class="contacts"><h1>Contact actions</h1>${contactItems ? `<ul>${contactItems}</ul>` : "<p>No contact method found.</p>"}</aside><h2>Subject: ${escapeHtml(state.subject || "Unavailable")}</h2><section class="email">${emailContent}</section><footer>${escapeHtml(printFooter)}</footer></main></body></html>`;
}

export function makeEml({ result, primaryEmail, fromName = "", fromAddress = "no-reply@example.invalid" }) {
  if (!primaryEmail) return null;
  const clean = (value) =>
    String(value ?? "")
      .replace(/[\r\n]/g, " ")
      .trim();
  const resolved = resolveResultOutput(result);
  const boundary = `email-gen-${result.id.replace(/[^a-z0-9]/gi, "")}`;
  return [
    `From: ${clean(fromName)} <${clean(fromAddress)}>`,
    `To: <${clean(primaryEmail)}>`,
    `Subject: ${clean(resolved.subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    resolved.finalText,
    "",
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    resolved.finalEmailHtml,
    "",
    `--${boundary}--`,
    ""
  ].join("\r\n");
}
