import { AppError } from "../utils/errors.js";
import { normalizeResearchUrl, resolvePublicAddresses } from "./networkPolicy.js";
import { fetchDocument } from "./secureDocumentFetcher.js";

function mapFetchError(error) {
  if (error instanceof AppError) return error;

  const code = String(error?.code ?? "").toUpperCase();
  const message = error?.message || "Website research request failed.";
  if (error?.name === "AbortError" || error?.name === "TimeoutError" || /timeout|aborted/i.test(message)) {
    return new AppError("RESEARCH_TIMEOUT", "Website research timed out.", 408);
  }
  if (
    code.includes("CERT") ||
    code.includes("SSL") ||
    code.includes("TLS") ||
    /certificate|ssl|tls/i.test(message)
  ) {
    return new AppError("TLS_VALIDATION_FAILURE", "Website research failed TLS validation.", 502);
  }
  if (["ENOTFOUND", "EAI_AGAIN", "DNS_RESOLUTION_FAILURE"].includes(code)) {
    return new AppError("DNS_RESOLUTION_FAILURE", "Website DNS resolution failed.", 502);
  }
  if (code === "FORBIDDEN_DESTINATION") {
    return new AppError(
      "FORBIDDEN_DESTINATION",
      "Private, loopback, link-local, multicast, and reserved IP ranges are blocked.",
      400
    );
  }
  return new AppError("RESEARCH_FETCH_FAILED", "Website research request failed.", 502);
}

export async function assertPublicHttpUrl(url, { resolver, maxUrlLength } = {}) {
  const normalized = normalizeResearchUrl(url, { maxUrlLength });
  const parsed = new URL(normalized);
  await resolvePublicAddresses(parsed.hostname, { resolver });
  return normalized;
}

export async function fetchWebsite(
  url,
  { config, resolver, requestFactory, logger, signal, maxRedirects = config.research.maxRedirects } = {}
) {
  const current = await assertPublicHttpUrl(url, {
    resolver,
    maxUrlLength: config.research.maxUrlLength
  });

  try {
    const fetched = await fetchDocument(current, {
      resolver,
      requestFactory,
      signal,
      timeoutMs: config.research.timeoutMs,
      maxHeaderBytes: config.research.maxHeaderBytes,
      maxResponseBytes: config.research.responseBytes,
      maxPageBytes: config.research.maxPageBytes,
      maxRedirects,
      logger
    });
    return {
      url: fetched.url,
      contentType: fetched.contentType,
      body: fetched.body,
      transferredBytes: fetched.transferredBytes,
      redirects: fetched.redirects,
      headers: fetched.headers,
      approvedAddress: fetched.approvedAddress ?? null,
      connectedAddress: fetched.connectedAddress ?? null
    };
  } catch (error) {
    throw mapFetchError(error);
  }
}
