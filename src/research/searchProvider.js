import { AppError, createShutdownError } from "../utils/errors.js";
import { discoverContactCandidates } from "./contactDiscovery.js";
import { readBoundedResponseJson } from "../utils/responseBodies.js";

const JSON_CONTENT_TYPES = ["application/json", "application/*+json", "text/json"];

export async function searchPublicContacts(
  record,
  { apiKey, fetchImpl = fetch, depth = 5, timeoutMs = 8000, maxResponseBytes = 500000, signal = null } = {}
) {
  if (signal?.aborted) {
    throw signal.reason instanceof Error ? signal.reason : createShutdownError();
  }
  if (!apiKey) return { status: "not-configured", candidates: [], reason: "Search provider not configured." };
  const normalized = record.normalized ?? record;
  const website = normalized.website || normalized.url || "";
  const domain = (() => {
    try {
      return new URL(website).hostname;
    } catch {
      return "";
    }
  })();
  const query = [normalized.name || record.displayName, domain, normalized.city, "contact email"]
    .filter(Boolean)
    .join(" ")
    .slice(0, 400);
  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(Math.max(1, Math.min(20, depth))));
  url.searchParams.set("safesearch", "strict");
  const requestSignal =
    signal && typeof AbortSignal.any === "function"
      ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
      : AbortSignal.timeout(timeoutMs);
  const response = await fetchImpl(url, {
    headers: { accept: "application/json", "x-subscription-token": apiKey, "Api-Version": "2023-01-01" },
    signal: requestSignal
  });
  if (!response.ok)
    throw new AppError("SEARCH_PROVIDER_FAILED", `Search provider returned HTTP ${response.status}.`, 502);
  const { payload } = await readBoundedResponseJson(response, {
    maxBytes: maxResponseBytes,
    expectedContentTypes: JSON_CONTENT_TYPES,
    deadlineMs: timeoutMs,
    idleTimeoutMs: timeoutMs,
    code: "SEARCH_PROVIDER_TOO_LARGE",
    message: "Search provider response exceeded the configured size limit.",
    jsonCode: "SEARCH_PROVIDER_MALFORMED",
    jsonMessage: "Search provider returned malformed JSON.",
    jsonStatus: 502
  });
  const candidates = [];
  for (const result of payload.web?.results ?? []) {
    if (!result.url) continue;
    candidates.push(
      ...discoverContactCandidates({
        body: `${result.title ?? ""} ${result.description ?? ""} ${(result.extra_snippets ?? []).join(" ")}`,
        url: result.url,
        record,
        sourceCategory: "external-search"
      }).map((candidate) => ({
        ...candidate,
        method: "search-result",
        confidence: Math.min(candidate.confidence, 0.62),
        confidenceLabel: "medium",
        reason: "Candidate appeared in a source-attributed Brave Search API result and requires review."
      }))
    );
  }
  const deduped = [...new Map(candidates.map((item) => [`${item.type}:${item.value}`, item])).values()];
  return { status: "ok", provider: "brave", query, candidates: deduped };
}
