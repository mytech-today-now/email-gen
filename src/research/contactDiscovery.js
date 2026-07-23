import { safeUrl } from "../output/sanitizer.js";

const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const ROLE_PREFIXES = new Set(["contact", "info", "hello", "sales", "office", "support", "reservations"]);

function uniqueBy(items, key) {
  const seen = new Set();
  return items.filter((item) => {
    const value = key(item);
    if (!value || seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

function confidenceForEmail(email, sameDomain, method) {
  const local = email.split("@")[0].toLowerCase();
  let score = sameDomain ? 0.82 : 0.52;
  if (ROLE_PREFIXES.has(local)) score += 0.08;
  if (method === "record-field" || method === "mailto") score += 0.06;
  if (/no-?reply|donotreply/.test(local)) score -= 0.6;
  return Math.max(0, Math.min(0.99, score));
}

function label(score) {
  return score >= 0.8 ? "high" : score >= 0.55 ? "medium" : "low";
}

export function makeContactCandidate({
  type,
  value,
  sourceUrl,
  sourceCategory = "business-website",
  method,
  businessHost,
  reason
}) {
  let normalized = String(value ?? "")
    .trim()
    .replace(/[\r\n]/g, "");
  if (type === "email") normalized = normalized.toLowerCase();
  if (type === "contact-form") normalized = safeUrl(normalized);
  if (!normalized) return null;
  const candidateHost = type === "email" ? normalized.split("@")[1] : new URL(normalized).hostname;
  const sameDomain = Boolean(
    businessHost &&
    candidateHost &&
    (candidateHost === businessHost || candidateHost.endsWith(`.${businessHost}`))
  );
  const confidence =
    type === "email" ? confidenceForEmail(normalized, sameDomain, method) : sameDomain ? 0.78 : 0.42;
  return {
    id: `${type}:${normalized}`,
    type,
    value: normalized,
    sourceUrl,
    sourceCategory,
    method,
    sameDomain,
    confidence,
    confidenceLabel: label(confidence),
    reason: reason || `${sameDomain ? "Same-domain" : "External"} ${method.replaceAll("-", " ")} candidate.`,
    discoveredAt: new Date().toISOString()
  };
}

export function discoverContactCandidates({
  body = "",
  url,
  record = {},
  sourceCategory = "business-website"
}) {
  const decoded = String(body)
    .replace(/&commat;|&#64;|&#x40;/gi, "@")
    .replace(/\s*(?:\[at\]|\(at\))\s*/gi, "@")
    .replace(/\s*(?:\[dot\]|\(dot\))\s*/gi, ".");
  const businessHost = (() => {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return "";
    }
  })();
  const candidates = [];
  const push = (candidate) => candidate && candidates.push(candidate);
  for (const [key, value] of Object.entries(record.normalized ?? record)) {
    if (/email/i.test(key) && typeof value === "string") {
      for (const email of value.match(EMAIL_PATTERN) ?? []) {
        push(
          makeContactCandidate({
            type: "email",
            value: email,
            sourceUrl: url,
            method: "record-field",
            businessHost,
            sourceCategory
          })
        );
      }
    }
  }
  for (const match of decoded.matchAll(/mailto:([^"'?#\s>]+)/gi)) {
    push(
      makeContactCandidate({
        type: "email",
        value: decodeURIComponent(match[1]),
        sourceUrl: url,
        method: "mailto",
        businessHost,
        sourceCategory
      })
    );
  }
  for (const email of decoded.match(EMAIL_PATTERN) ?? []) {
    push(
      makeContactCandidate({
        type: "email",
        value: email,
        sourceUrl: url,
        method: "visible-text",
        businessHost,
        sourceCategory
      })
    );
  }
  for (const match of decoded.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)) {
    const form = `${match[1]} ${match[2]}`;
    if (/search|login|sign.?up|newsletter|reservation|checkout|career|job application/i.test(form)) continue;
    if (!/contact|message|inquir|question|support|textarea/i.test(form)) continue;
    const action = match[1].match(/action=["']([^"']+)["']/i)?.[1] || url;
    try {
      push(
        makeContactCandidate({
          type: "contact-form",
          value: new URL(action, url).toString(),
          sourceUrl: url,
          method: "form-analysis",
          businessHost,
          sourceCategory,
          reason: "Page contains a public inquiry form with message/contact fields."
        })
      );
    } catch {
      // Ignore malformed form actions.
    }
  }
  for (const match of decoded.matchAll(
    /<a\b[^>]*href=["']([^"']*(?:contact|connect|inquir|support|about)[^"']*)["'][^>]*>/gi
  )) {
    try {
      push(
        makeContactCandidate({
          type: "contact-form",
          value: new URL(match[1], url).toString(),
          sourceUrl: url,
          method: "rendered-dom",
          businessHost,
          sourceCategory
        })
      );
    } catch {
      // Ignore malformed links.
    }
  }
  return uniqueBy(candidates, (candidate) => `${candidate.type}:${candidate.value.toLowerCase()}`).sort(
    (left, right) => right.confidence - left.confidence || left.value.localeCompare(right.value)
  );
}

export function selectPrimaryContacts(candidates, overrides = {}) {
  const emailCandidates = candidates.filter((item) => item.type === "email");
  const formCandidates = candidates.filter((item) => item.type === "contact-form");
  const primaryEmail =
    emailCandidates.find((item) => item.id === overrides.primaryEmailId) ?? emailCandidates[0] ?? null;
  const primaryForm =
    formCandidates.find((item) => item.id === overrides.primaryFormId) ?? formCandidates[0] ?? null;
  return { candidates, primaryEmail, primaryForm };
}
