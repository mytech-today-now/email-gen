import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadAppConfig } from "../../config/app.config.js";
import { fetchJsonWithRetry, ProviderDiscoveryError } from "../../src/ai/modelCatalog/providerHttp.js";

const envKeys = ["MODEL_SYNC_BACKOFF_MIN_MS", "MODEL_SYNC_BACKOFF_MAX_MS"];
let previousEnv;

beforeEach(() => {
  previousEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
});

afterEach(() => {
  for (const key of envKeys) {
    if (previousEnv[key] === undefined) delete process.env[key];
    else process.env[key] = previousEnv[key];
  }
});

function response(body, init = {}) {
  return new Response(body, {
    status: init.status ?? 200,
    headers: { "content-type": init.contentType ?? "application/json", ...(init.headers ?? {}) }
  });
}

describe("model discovery edge cases", () => {
  it("returns a typed validation error for malformed JSON", async () => {
    await expect(
      fetchJsonWithRetry({
        fetchImpl: async () => response("{bad"),
        url: "https://provider.test/models",
        timeoutMs: 1000,
        maxResponseBytes: 1000,
        retryOptions: { maxRetries: 0, backoffMinMs: 1, backoffMaxMs: 1 }
      })
    ).rejects.toMatchObject({ code: "malformed_json", retryable: false });
  });

  it("rejects unexpected content types and oversized responses", async () => {
    await expect(
      fetchJsonWithRetry({
        fetchImpl: async () => response("ok", { contentType: "text/html" }),
        url: "https://provider.test/models",
        timeoutMs: 1000,
        maxResponseBytes: 1000,
        retryOptions: { maxRetries: 0, backoffMinMs: 1, backoffMaxMs: 1 }
      })
    ).rejects.toMatchObject({ code: "unexpected_content_type" });

    await expect(
      fetchJsonWithRetry({
        fetchImpl: async () => response(JSON.stringify({ data: ["x".repeat(200)] })),
        url: "https://provider.test/models",
        timeoutMs: 1000,
        maxResponseBytes: 10,
        retryOptions: { maxRetries: 0, backoffMinMs: 1, backoffMaxMs: 1 }
      })
    ).rejects.toMatchObject({ code: "response_too_large" });
  });

  it("distinguishes authentication failures from retryable rate limits", async () => {
    await expect(
      fetchJsonWithRetry({
        fetchImpl: async () => response("{}", { status: 401 }),
        url: "https://provider.test/models",
        timeoutMs: 1000,
        maxResponseBytes: 1000,
        retryOptions: { maxRetries: 2, backoffMinMs: 1, backoffMaxMs: 1 }
      })
    ).rejects.toMatchObject({ code: "authentication_failure", retryable: false });

    let calls = 0;
    await expect(
      fetchJsonWithRetry({
        fetchImpl: async () => {
          calls += 1;
          return response("{}", { status: 429, headers: { "retry-after": "0" } });
        },
        url: "https://provider.test/models",
        timeoutMs: 1000,
        maxResponseBytes: 1000,
        retryOptions: { maxRetries: 1, backoffMinMs: 1, backoffMaxMs: 1 }
      })
    ).rejects.toMatchObject({ code: "rate_limited", retryable: true });
    expect(calls).toBe(2);
  });

  it("validates sync backoff configuration at startup", () => {
    process.env.MODEL_SYNC_BACKOFF_MIN_MS = "20";
    process.env.MODEL_SYNC_BACKOFF_MAX_MS = "10";
    expect(() => loadAppConfig()).toThrow(/MODEL_SYNC_BACKOFF_MIN_MS/);
  });

  it("uses typed errors for provider discovery failures", () => {
    const error = new ProviderDiscoveryError("pagination_loop", "Repeated token.", {
      retryable: false
    });
    expect(error).toMatchObject({ code: "pagination_loop", retryable: false });
  });
});
