import { describe, expect, it } from "vitest";
import { normalizeProviderError } from "../../src/ai/providerErrors.js";

describe("provider error normalization", () => {
  it("turns provider auth failures into actionable app errors", () => {
    const error = new Error('[xai] 400 "Incorrect API key provided."');
    error.code = "PROVIDER_ERROR";

    const normalized = normalizeProviderError(error, {
      id: "xai",
      label: "xAI Grok"
    });

    expect(normalized).toMatchObject({
      code: "PROVIDER_AUTH_FAILED",
      status: 502
    });
    expect(normalized.message).toContain("Configuration");
  });

  it("leaves non-auth provider failures untouched", () => {
    const error = new Error("Provider timed out.");
    expect(normalizeProviderError(error, { id: "xai" })).toBe(error);
  });
});
