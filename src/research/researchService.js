import { AppError, createShutdownError } from "../utils/errors.js";
import { normalizeResearchUrl } from "./networkPolicy.js";
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
  const candidates = [
    ...new Map(
      [...(primary.candidates ?? []), ...(fallback.candidates ?? [])].map((candidate) => [
        `${candidate.type}:${candidate.value}`,
        candidate
      ])
    ).values()
  ].sort((left, right) => right.confidence - left.confidence);
  return {
    emails,
    primaryEmail: primary.primaryEmail || fallback.primaryEmail || emails[0] || "",
    contactPages,
    contactPage: primary.contactPage || fallback.contactPage || contactPages[0] || "",
    candidates,
    primaryEmailCandidate: candidates.find((candidate) => candidate.type === "email") ?? null,
    primaryFormCandidate: candidates.find((candidate) => candidate.type === "contact-form") ?? null
  };
}

function safeResearchError(
  error,
  fallbackCode = "RESEARCH_FAILED",
  fallbackMessage = "Website research failed."
) {
  if (error instanceof AppError) {
    return { code: error.code, message: error.message };
  }
  return { code: fallbackCode, message: fallbackMessage };
}

function contactPageStatusForError(error) {
  const code = String(error?.code ?? "").toUpperCase();
  if (
    [
      "FORBIDDEN_DESTINATION",
      "DNS_RESOLUTION_FAILURE",
      "TLS_VALIDATION_FAILURE",
      "RESEARCH_RESPONSE_TOO_LARGE",
      "RESEARCH_PAGE_SIZE_LIMIT_EXCEEDED",
      "RESEARCH_UNSUPPORTED_CONTENT",
      "RESEARCH_DOWNLOAD_BLOCKED",
      "REDIRECT_POLICY_VIOLATION",
      "RESEARCH_TIMEOUT",
      "RESEARCH_CONNECTED_ADDRESS_INVALID",
      "RESEARCH_CONNECTED_ADDRESS_MISMATCH"
    ].includes(code)
  ) {
    return "blocked";
  }
  return error instanceof AppError ? "failed" : "failed";
}

function createResearchBudget(config) {
  const startedAt = Date.now();
  return {
    startedAt,
    transferredBytes: 0,
    pages: 0,
    maxJobBytes: config.research.maxJobBytes,
    maxJobMs: config.research.maxJobMs,
    maxPages: 1 + config.research.maxContactPages,
    assertAlive() {
      if (Date.now() - startedAt > config.research.maxJobMs) {
        throw new AppError(
          "RESEARCH_JOB_TIMEOUT",
          "Website research exceeded the configured job time limit.",
          408,
          { maxJobMs: config.research.maxJobMs },
          { publicDetails: true }
        );
      }
    },
    reservePage() {
      this.assertAlive();
      this.pages += 1;
      if (this.pages > this.maxPages) {
        throw new AppError(
          "RESEARCH_CONTACT_LIMIT_EXCEEDED",
          "Website research exceeded the configured contact-page limit.",
          413,
          { maxPages: this.maxPages },
          { publicDetails: true }
        );
      }
    },
    addTransferredBytes(bytes) {
      this.transferredBytes += bytes;
      if (this.transferredBytes > this.maxJobBytes) {
        throw new AppError(
          "RESEARCH_JOB_LIMIT_EXCEEDED",
          "Website research exceeded the configured job size limit.",
          413,
          { transferredBytes: this.transferredBytes, maxJobBytes: this.maxJobBytes },
          { publicDetails: true }
        );
      }
    }
  };
}

function composeResearchSignal(signal, timeoutMs) {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  if (!signal) return timeoutSignal;
  if (typeof AbortSignal.any === "function") {
    return AbortSignal.any([signal, timeoutSignal]);
  }
  const controller = new AbortController();
  const abort = (reason) => {
    if (controller.signal.aborted) return;
    controller.abort(reason);
  };
  if (signal.aborted) {
    abort(signal.reason);
    return controller.signal;
  }
  signal.addEventListener("abort", () => abort(signal.reason), { once: true });
  timeoutSignal.addEventListener("abort", () => abort(timeoutSignal.reason), { once: true });
  return controller.signal;
}

async function fetchContactPage(
  contactPage,
  { config, logger, record, resolver, requestFactory, budget, signal }
) {
  try {
    logger?.info({ url: contactPage }, "Contact page research scrape started");
    budget.reservePage();
    const fetched = await fetchWebsite(contactPage, {
      config,
      resolver,
      requestFactory,
      logger,
      signal
    });
    budget.addTransferredBytes(fetched.transferredBytes ?? 0);
    const extracted = extractWebsiteText({ ...fetched, record });
    logger?.info(
      {
        url: contactPage,
        finalUrl: extracted.url,
        approvedAddress: fetched.approvedAddress,
        connectedAddress: fetched.connectedAddress,
        emailFound: Boolean(extracted.contact?.primaryEmail)
      },
      "Contact page research scrape completed"
    );
    return { status: "ok", ...extracted };
  } catch (error) {
    const safeError = safeResearchError(error);
    const failure = {
      status: contactPageStatusForError(error),
      url: contactPage,
      error: safeError
    };
    logger?.warn(
      { err: error, url: contactPage, code: safeError.code, status: failure.status },
      "Contact page research scrape failed"
    );
    return failure;
  }
}

export async function collectResearch(
  record,
  { config, cacheRepository, logger, enabled = true, resolver, requestFactory, signal = null }
) {
  if (signal?.aborted) {
    throw signal.reason instanceof Error ? signal.reason : createShutdownError();
  }
  if (!enabled || !config.research.enabled) {
    return { status: "skipped", reason: "Research disabled." };
  }
  const website = findWebsite(record);
  if (!website) return { status: "skipped", reason: "No website field found." };

  let normalizedUrl;
  try {
    normalizedUrl = normalizeResearchUrl(website, { maxUrlLength: config.research.maxUrlLength });
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

  const budget = createResearchBudget(config);
  const jobSignal = composeResearchSignal(signal, config.research.maxJobMs);

  try {
    logger?.info({ url: normalizedUrl }, "Website research scrape started");
    budget.reservePage();
    const fetched = await fetchWebsite(normalizedUrl, {
      config,
      resolver,
      requestFactory,
      logger,
      signal: jobSignal
    });
    budget.addTransferredBytes(fetched.transferredBytes ?? 0);
    const extracted = extractWebsiteText({ ...fetched, record });
    let contact = extracted.contact;
    const likelyPaths = ["/contact", "/contact-us", "/about", "/team", "/locations"];
    const contactPages = [
      ...new Set([
        ...(contact?.contactPages ?? []),
        ...likelyPaths.map((path) => new URL(path, extracted.url).toString())
      ])
    ]
      .filter((candidate) => candidate !== extracted.url)
      .slice(0, config.research.maxContactPages);
    const contactPageResults = [];
    const contactPageFailures = [];
    for (const contactPage of contactPages) {
      const contactPageResearch = await fetchContactPage(contactPage, {
        config,
        logger,
        record,
        resolver,
        requestFactory,
        budget,
        signal: jobSignal
      });
      if (contactPageResearch?.status === "ok" && contactPageResearch.contact) {
        contact = mergeContact(contact, contactPageResearch.contact);
        contactPageResults.push(contactPageResearch);
      } else if (contactPageResearch?.status && contactPageResearch.status !== "ok") {
        contactPageFailures.push(contactPageResearch);
      }
    }
    const contactPageResearch = contactPageResults[0] ?? null;
    const hasPartialCoverage = contactPageFailures.length > 0;
    const degradedError = hasPartialCoverage
      ? {
          code: "RESEARCH_DEGRADED",
          message: "Website research completed with partial contact-page coverage.",
          stage: "contact-page",
          retryable: false,
          details: {
            failures: contactPageFailures.map((item) => ({
              url: item.url,
              status: item.status,
              error: item.error
            }))
          }
        }
      : null;
    const entry = {
      status: hasPartialCoverage ? "degraded" : "ok",
      ...extracted,
      error: degradedError,
      contact,
      contactPageResearch: contactPageResearch
        ? {
            url: contactPageResearch.url,
            title: contactPageResearch.title,
            excerpt: contactPageResearch.excerpt
          }
        : null,
      contactPageResearchPages: contactPageResults.map((item) => ({
        url: item.url,
        title: item.title,
        excerpt: item.excerpt
      })),
      contactPageResearchFailures: contactPageFailures.map((item) => ({
        url: item.url,
        status: item.status,
        error: item.error
      })),
      metadata: {
        contact,
        contactPageResearch: contactPageResearch
          ? {
              url: contactPageResearch.url,
              title: contactPageResearch.title,
              excerpt: contactPageResearch.excerpt
            }
          : null,
        contactPageResearchPages: contactPageResults.map((item) => ({
          url: item.url,
          title: item.title,
          excerpt: item.excerpt
        })),
        contactPageResearchFailures: contactPageFailures.map((item) => ({
          url: item.url,
          status: item.status,
          error: item.error
        }))
      }
    };
    cacheRepository?.save(normalizedUrl, entry, config.research.cacheSeconds);
    logger?.info(
      {
        url: normalizedUrl,
        finalUrl: extracted.url,
        approvedAddress: fetched.approvedAddress,
        connectedAddress: fetched.connectedAddress,
        title: extracted.title,
        contentBytes: Buffer.byteLength(extracted.content ?? "", "utf8"),
        emailFound: Boolean(contact?.primaryEmail),
        contactPage: contact?.contactPage || undefined,
        transferredBytes: budget.transferredBytes,
        status: entry.status,
        partialContactFailures: contactPageFailures.length
      },
      "Website research scrape completed"
    );
    return entry;
  } catch (error) {
    if (signal?.aborted) {
      throw signal.reason instanceof Error ? signal.reason : createShutdownError();
    }
    const safeError = safeResearchError(error);
    const entry = { status: "failed", url: normalizedUrl, error: safeError };
    cacheRepository?.save(normalizedUrl, entry, Math.min(3600, config.research.cacheSeconds));
    logger?.warn(
      { err: error, url: normalizedUrl, code: safeError.code, status: entry.status },
      "Website research scrape failed"
    );
    return entry;
  }
}
