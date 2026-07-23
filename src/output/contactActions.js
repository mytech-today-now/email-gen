import { escapeHtml } from "../utils/helpers.js";
import { safeUrl } from "./sanitizer.js";

const EMAIL_FIELDS = [
  "email",
  "emailAddress",
  "recipientEmail",
  "contactEmail",
  "workEmail",
  "businessEmail",
  "ownerEmail"
];
const PHONE_FIELDS = ["phone", "phoneNumber", "telephone", "tel", "mobile", "cell", "contactPhone"];
const WEBSITE_FIELDS = ["website", "websiteUrl", "url", "homepage", "site"];

function validEmail(value) {
  const email = String(value ?? "").replace(/[\r\n]/g, "").trim().toLowerCase();
  return /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(email) ? email : "";
}

function validPhoneDisplay(value) {
  const display = String(value ?? "").replace(/[\r\n]/g, " ").trim();
  const digits = display.replace(/[^\d]/g, "");
  return digits.length >= 7 ? display : "";
}

function validPhoneHref(value) {
  const display = String(value ?? "").replace(/[\r\n]/g, " ").trim();
  const digits = display.replace(/[^\d]/g, "");
  if (digits.length < 7) return "";
  return `tel:${display.startsWith("+") ? `+${digits}` : digits}`;
}

function validWebsite(value) {
  const url = safeUrl(value);
  return url.startsWith("http://") || url.startsWith("https://") ? url : "";
}

function dedupeCandidates(candidates) {
  return [...new Map(candidates.map((candidate) => [`${candidate.type}:${candidate.value}`, candidate])).values()].sort(
    (left, right) => right.confidence - left.confidence
  );
}

export function contactCandidatesForResult(result, record) {
  const candidates = [...(result?.research?.contact?.candidates ?? result?.research?.metadata?.contact?.candidates ?? [])];
  const normalized = record?.normalized ?? {};
  for (const field of EMAIL_FIELDS) {
    const email = validEmail(normalized[field]);
    if (email) {
      candidates.unshift({
        id: `email:${email}`,
        type: "email",
        value: email,
        sourceUrl: record.sourceName || "imported record",
        sourceCategory: "imported-record",
        method: "record-field",
        confidence: 0.98,
        confidenceLabel: "high",
        reason: `Imported ${field} field.`
      });
      break;
    }
  }

  for (const field of PHONE_FIELDS) {
    const phone = validPhoneDisplay(normalized[field]);
    if (!phone) continue;
    candidates.push({
      id: `phone:${phone}`,
      type: "phone",
      value: phone,
      sourceUrl: record.sourceName || "imported record",
      sourceCategory: "imported-record",
      method: "record-field",
      confidence: 0.97,
      confidenceLabel: "high",
      reason: `Imported ${field} field.`
    });
    break;
  }

  for (const field of WEBSITE_FIELDS) {
    const website = validWebsite(normalized[field]);
    if (!website) continue;
    candidates.push({
      id: `website:${website}`,
      type: "website",
      value: website,
      sourceUrl: website,
      sourceCategory: "imported-record",
      method: "record-field",
      confidence: 0.96,
      confidenceLabel: "high",
      reason: `Imported ${field} field.`
    });
    break;
  }

  return dedupeCandidates(candidates);
}

function hrefForCandidate(candidate) {
  if (candidate.type === "email") {
    const email = validEmail(candidate.value);
    return email ? `mailto:${email}` : "";
  }
  if (candidate.type === "phone") return validPhoneHref(candidate.value);
  return safeUrl(candidate.value);
}

function labelForCandidate(candidate) {
  if (candidate.type === "website") return candidate.value;
  if (candidate.type === "form") return "Open public contact form";
  if (candidate.type === "phone") return candidate.value;
  return candidate.value;
}

export function renderContactActions(candidates = []) {
  const links = candidates
    .map((candidate, index) => {
      const href = hrefForCandidate(candidate);
      if (!href) return "";
      const label = labelForCandidate(candidate);
      return `<li><a href="${escapeHtml(href)}" rel="noopener noreferrer">${escapeHtml(label)}</a>${index === 0 ? " <strong>(preferred)</strong>" : ""}<span> — ${escapeHtml(candidate.sourceCategory || "unknown source")}, ${escapeHtml(candidate.confidenceLabel || "unrated")} confidence</span><small>${escapeHtml(candidate.reason || "")}${candidate.sourceUrl ? ` Source: ${escapeHtml(candidate.sourceUrl)}` : ""}</small></li>`;
    })
    .filter(Boolean);
  return `<aside class="contact-actions" aria-labelledby="contact-actions-heading"><h2 id="contact-actions-heading">Contact actions</h2>${links.length ? `<ul>${links.join("")}</ul>` : "<p>No contact method found.</p>"}</aside>`;
}
