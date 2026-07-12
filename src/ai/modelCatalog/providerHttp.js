import { setTimeout as sleep } from "node:timers/promises";
import { redactSecrets } from "../../utils/logger.js";

export class ProviderDiscoveryError extends Error {
  constructor(code, message, { status = null, retryable = false, retryAfterMs = null, cause = null } = {}) {
    super(message);
    this.name = "ProviderDiscoveryError";
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    this.retryAfterMs = retryAfterMs;
    this.cause = cause;
  }
}

export function classifyHttpStatus(status) {
  if (status === 401 || status === 403) return { code: "authentication_failure", retryable: false };
  if (status === 404) return { code: "unsupported_discovery_endpoint", retryable: false };
  if (status === 408 || status === 409 || status === 425)
    return { code: "temporary_provider_failure", retryable: true };
  if (status === 429) return { code: "rate_limited", retryable: true };
  if (status >= 500 && status < 600) return { code: "temporary_provider_failure", retryable: true };
  return { code: "provider_http_error", retryable: false };
}

export function retryAfterMs(headers) {
  const value = headers?.get?.("retry-after");
  if (!value) return null;
  const seconds = Number.parseInt(value, 10);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  return null;
}

export function backoffWithJitter(attempt, options, random = Math.random) {
  const min = options.backoffMinMs ?? 500;
  const max = options.backoffMaxMs ?? 6000;
  const exponential = Math.min(max, min * 2 ** Math.max(0, attempt - 1));
  const jitter = Math.floor(exponential * 0.2 * random());
  return Math.min(max, exponential + jitter);
}

async function readBoundedText(response, maxBytes) {
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > maxBytes) {
    throw new ProviderDiscoveryError(
      "response_too_large",
      "Provider response exceeded the configured size limit.",
      {
        status: response.status,
        retryable: false
      }
    );
  }
  return text;
}

export async function fetchJsonWithRetry({
  fetchImpl,
  url,
  headers = {},
  timeoutMs,
  maxResponseBytes,
  retryOptions,
  logger,
  providerId,
  runId
}) {
  let lastError;
  for (let attempt = 1; attempt <= retryOptions.maxRetries + 1; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        method: "GET",
        headers,
        signal: controller.signal
      });
      if (!response.ok) {
        const classification = classifyHttpStatus(response.status);
        const retryDelay = retryAfterMs(response.headers);
        throw new ProviderDiscoveryError(
          classification.code,
          `Provider model discovery returned HTTP ${response.status}.`,
          {
            status: response.status,
            retryable: classification.retryable,
            retryAfterMs: retryDelay
          }
        );
      }
      const contentType = response.headers.get("content-type") ?? "";
      if (contentType && !/json/i.test(contentType)) {
        throw new ProviderDiscoveryError(
          "unexpected_content_type",
          `Provider model discovery returned ${contentType}.`,
          { status: response.status, retryable: false }
        );
      }
      const text = await readBoundedText(response, maxResponseBytes);
      try {
        return JSON.parse(text);
      } catch (error) {
        throw new ProviderDiscoveryError(
          "malformed_json",
          "Provider model discovery returned malformed JSON.",
          {
            status: response.status,
            retryable: false,
            cause: error
          }
        );
      }
    } catch (error) {
      lastError =
        error instanceof ProviderDiscoveryError
          ? error
          : new ProviderDiscoveryError(
              error.name === "AbortError" ? "request_timeout" : "network_failure",
              error.name === "AbortError"
                ? "Provider model discovery timed out."
                : redactSecrets(error.message),
              { retryable: true, cause: error }
            );
      clearTimeout(timer);

      if (attempt > retryOptions.maxRetries || !lastError.retryable) throw lastError;
      const delay = lastError.retryAfterMs ?? backoffWithJitter(attempt, retryOptions);
      logger?.warn(
        {
          runId,
          providerId,
          attempt,
          delay,
          status: lastError.status,
          code: lastError.code
        },
        "Provider model discovery failed; retrying"
      );
      await sleep(delay);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}
