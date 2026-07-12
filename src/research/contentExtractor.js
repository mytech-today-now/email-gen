import sanitizeHtml from "sanitize-html";
import { normalizeWhitespace, truncateBytes } from "../utils/helpers.js";

const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const CONTACT_LINK_PATTERN =
  /<a\b[^>]*href=["']([^"']*(?:contact|connect|inquir|support|hello|about)[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;

function decodeEntities(value) {
  return String(value ?? "")
    .replace(/&amp;/g, "&")
    .replace(/&commat;/g, "@")
    .replace(/&#64;/g, "@")
    .replace(/&#x40;/gi, "@");
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

export function extractContactInfo({ body, url }) {
  const decoded = decodeEntities(body);
  const mailtoEmails = [...decoded.matchAll(/mailto:([^"'?#\s>]+)/gi)].map((match) =>
    decodeURIComponent(match[1]).trim()
  );
  const visibleEmails = decoded.match(EMAIL_PATTERN) ?? [];
  const emails = unique([...mailtoEmails, ...visibleEmails].map((email) => email.toLowerCase()));
  const contactPages = [];
  for (const match of decoded.matchAll(CONTACT_LINK_PATTERN)) {
    try {
      const contactUrl = new URL(decodeEntities(match[1]), url);
      if (["http:", "https:"].includes(contactUrl.protocol)) {
        contactPages.push(contactUrl.toString());
      }
    } catch {
      // Ignore malformed contact-ish links and keep the rest of research usable.
    }
  }
  return {
    emails,
    primaryEmail: emails[0] ?? "",
    contactPages: unique(contactPages),
    contactPage: contactPages[0] ?? ""
  };
}

export function extractWebsiteText({ body, url }, { maxBytes = 12000 } = {}) {
  const title = normalizeWhitespace(
    (body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").replace(/<[^>]+>/g, "")
  );
  const withoutScripts = sanitizeHtml(body, { allowedTags: [], allowedAttributes: {} });
  const content = truncateBytes(normalizeWhitespace(withoutScripts), maxBytes);
  const contact = extractContactInfo({ body, url });
  return {
    url,
    title,
    content,
    excerpt: truncateBytes(content, 2000),
    contact
  };
}
