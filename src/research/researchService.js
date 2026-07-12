import { AppError } from "../utils/errors.js";
import { validateHttpUrl } from "../data/validators.js";
import { extractWebsiteText } from "./contentExtractor.js";
import { fetchWebsite } from "./websiteFetcher.js";

function findWebsite(record) {
  const normalized = record.normalized ?? record;
  const candidateKeys = ["website", "url", "homepage", "companyWebsite"];
  for (const key of candidateKeys) {
    if (normalized[key]) return normalized[key];
  }
  for (const [key, value] of Object.entries(normalized)) {
    if (/website|url|link/i.test(key) && value) return value;
  }
  return null;
}

function mergeContact(primary = {}, fallback = {}) {
  const emails = [...new Set([...(primary.emails ?? []), ...(fallback.emails ?? [])].filter(Boolean))];
  const contactPages = [
    ...new Set([...(primary.contactPages ?? []), ...(fallback.contactPages ?? [])].filter(Boolean))
  ];
  return {
    emails,
    primaryEmail: primary.primaryEmail || fallback.primaryEmail || emails[0] || "",
    contactPages,
    contactPage: primary.contactPage || fallback.contactPage || contactPages[0] || ""
  };
}

async function fetchContactPage(contactPage, { config, browserLauncher, logger }) {
  try {
    logger?.info({ url: contactPage }, "Contact page research scrape started");
    const fetched = await fetchWebsite(contactPage, { config, browserLauncher, logger });
    const extracted = extractWebsiteText(fetched);
    logger?.info(
      {
        url: contactPage,
        finalUrl: extracted.url,
        emailFound: Boolean(extracted.contact?.primaryEmail)
      },
      "Contact page research scrape completed"
    );
    return extracted;
  } catch (error) {
    logger?.warn({ err: error, url: contactPage }, "Contact page research scrape failed");
    return null;
  }
}

export async function collectResearch(
  record,
  { config, cacheRepository, browserLauncher, logger, enabled = true }
) {
  if (!enabled || !config.research.enabled) {
    return { status: "skipped", reason: "Research disabled." };
  }
  const website = findWebsite(record);
  if (!website) return { status: "skipped", reason: "No website field found." };

  let normalizedUrl;
  try {
    normalizedUrl = validateHttpUrl(website, { optional: false });
  } catch (error) {
    return { status: "failed", error: { code: error.code, message: error.message } };
  }

  const cached = cacheRepository?.getFresh(normalizedUrl);
  if (cached) {
    logger?.info({ url: normalizedUrl, status: cached.status }, "Website research cache hit");
    return {
      status: cached.status,
      url: normalizedUrl,
      title: cached.title,
      content: cached.content,
      cached: true,
      ...(cached.metadata ?? {}),
      error: cached.error
    };
  }

  try {
    logger?.info({ url: normalizedUrl }, "Website research scrape started");
    const fetched = await fetchWebsite(normalizedUrl, { config, browserLauncher, logger });
    const extracted = extractWebsiteText(fetched);
    let contact = extracted.contact;
    let contactPageResearch = null;
    if (!contact?.primaryEmail && contact?.contactPage) {
      contactPageResearch = await fetchContactPage(contact.contactPage, { config, browserLauncher, logger });
      if (contactPageResearch?.contact) {
        contact = mergeContact(contact, contactPageResearch.contact);
      }
    }
    const entry = {
      status: "ok",
      ...extracted,
      contact,
      contactPageResearch: contactPageResearch
        ? {
            url: contactPageResearch.url,
            title: contactPageResearch.title,
            excerpt: contactPageResearch.excerpt
          }
        : null,
      metadata: {
        contact,
        contactPageResearch: contactPageResearch
          ? {
              url: contactPageResearch.url,
              title: contactPageResearch.title,
              excerpt: contactPageResearch.excerpt
            }
          : null
      }
    };
    cacheRepository?.save(normalizedUrl, entry, config.research.cacheSeconds);
    logger?.info(
      {
        url: normalizedUrl,
        finalUrl: extracted.url,
        title: extracted.title,
        contentBytes: Buffer.byteLength(extracted.content ?? "", "utf8"),
        emailFound: Boolean(contact?.primaryEmail),
        contactPage: contact?.contactPage || undefined
      },
      "Website research scrape completed"
    );
    return entry;
  } catch (error) {
    const safeError =
      error instanceof AppError
        ? { code: error.code, message: error.message }
        : { code: "RESEARCH_FAILED", message: "Website research failed." };
    const entry = { status: "failed", url: normalizedUrl, error: safeError };
    cacheRepository?.save(normalizedUrl, entry, Math.min(3600, config.research.cacheSeconds));
    logger?.warn({ err: error, url: normalizedUrl, code: safeError.code }, "Website research scrape failed");
    return entry;
  }
}
