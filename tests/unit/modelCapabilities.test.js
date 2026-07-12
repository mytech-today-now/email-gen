import { describe, expect, it } from "vitest";
import {
  evaluateModelCompatibility,
  modelCapabilitiesForLegacyUi
} from "../../src/ai/modelCatalog/capabilities.js";
import {
  backoffWithJitter,
  classifyHttpStatus,
  retryAfterMs
} from "../../src/ai/modelCatalog/providerHttp.js";

const requirements = {
  dataTypes: ["email"],
  inputModalities: ["text"],
  outputModalities: ["text"],
  structuredOutput: true,
  minContextWindow: 0
};

describe("model capability matching", () => {
  it("accepts a model only when required modalities and structured output are confirmed", () => {
    const result = evaluateModelCompatibility(
      {
        availability: "available",
        status: "available",
        inputModalities: ["text"],
        outputModalities: ["text"],
        supportedDataTypes: ["email"],
        capabilities: { structuredOutput: true },
        limits: {}
      },
      requirements
    );

    expect(result).toMatchObject({ compatible: true, reasons: [] });
  });

  it("treats unknown structured-output support conservatively", () => {
    const result = evaluateModelCompatibility(
      {
        availability: "available",
        inputModalities: ["text"],
        outputModalities: ["text"],
        supportedDataTypes: ["email"],
        capabilities: { structuredOutput: null },
        limits: {}
      },
      requirements
    );

    expect(result.compatible).toBe(false);
    expect(result.reasons).toContain("unknown_structured_output");
  });

  it("maps normalized capabilities back to the existing browser contract", () => {
    expect(
      modelCapabilitiesForLegacyUi({
        inputModalities: ["text"],
        capabilities: { text: true, structuredOutput: true, imageGeneration: false }
      })
    ).toEqual(["text", "structured"]);
  });
});

describe("provider HTTP retry helpers", () => {
  it("classifies retryable and permanent status codes", () => {
    expect(classifyHttpStatus(429)).toEqual({ code: "rate_limited", retryable: true });
    expect(classifyHttpStatus(503)).toEqual({ code: "temporary_provider_failure", retryable: true });
    expect(classifyHttpStatus(401)).toEqual({ code: "authentication_failure", retryable: false });
    expect(classifyHttpStatus(404)).toEqual({
      code: "unsupported_discovery_endpoint",
      retryable: false
    });
  });

  it("honors retry-after seconds and deterministic jitter", () => {
    const headers = new Headers({ "retry-after": "2" });
    expect(retryAfterMs(headers)).toBe(2000);
    expect(backoffWithJitter(2, { backoffMinMs: 100, backoffMaxMs: 1000 }, () => 0)).toBe(200);
  });
});
