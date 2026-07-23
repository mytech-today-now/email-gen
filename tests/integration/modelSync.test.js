import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestHarness } from "../helpers/appTestHarness.js";

const envKeys = ["AI_MOCK", "ENABLED_AI_PROVIDERS", "DEFAULT_AI_PROVIDER", "DEFAULT_AI_MODEL"];
let previousEnv;
let harness;

function fakeAdapter(models, extra = {}) {
  return {
    async discover() {
      if (extra.error) {
        return {
          status: extra.error.code,
          source: "error",
          fallbackReason: extra.error.code,
          error: extra.error,
          rawResponse: null,
          models: [],
          validationFailures: []
        };
      }
      return {
        status: "success",
        source: "fake",
        fallbackReason: null,
        rawResponse: { data: models },
        models,
        validationFailures: extra.validationFailures ?? []
      };
    }
  };
}

function catalogModel(id, overrides = {}) {
  const base = {
    providerId: "xai",
    providerModelId: id,
    displayName: id,
    aliases: [],
    family: "grok",
    version: null,
    status: "available",
    availability: "available",
    createdAtProvider: null,
    deprecatedAt: null,
    retiredAt: null,
    inputModalities: ["text"],
    outputModalities: ["text"],
    supportedDataTypes: ["email", "text", "structured-json"],
    capabilities: { text: true, structuredOutput: true },
    limits: {},
    pricing: null,
    regionalAvailability: null,
    requiredApiVersion: null,
    capabilityConfidence: "confirmed",
    discoverySource: "fake",
    metadataSource: { providerMetadata: true },
    rawProviderMetadata: { id }
  };
  return {
    ...base,
    ...overrides,
    compatibility: overrides.compatibility ?? { compatible: true, reasons: [] }
  };
}

beforeEach(() => {
  previousEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  process.env.AI_MOCK = "true";
  process.env.ENABLED_AI_PROVIDERS = "xai,mock";
  process.env.DEFAULT_AI_PROVIDER = "mock";
  process.env.DEFAULT_AI_MODEL = "mock-structured-v1";
});

afterEach(() => {
  harness?.cleanup();
  harness = null;
  for (const key of envKeys) {
    if (previousEnv[key] === undefined) delete process.env[key];
    else process.env[key] = previousEnv[key];
  }
});

describe("model synchronization integration", () => {
  it("adds compatible models, excludes incompatible models, and marks missing models unavailable", async () => {
    const compatible = catalogModel("grok-new-structured");
    const incompatible = catalogModel("grok-image-only", {
      inputModalities: ["text"],
      outputModalities: ["image"],
      supportedDataTypes: ["image"],
      capabilities: { imageGeneration: true, structuredOutput: false },
      compatibility: { compatible: false, reasons: ["missing_output_text", "missing_structured_output"] }
    });
    harness = createTestHarness({
      modelDiscoveryAdapters: {
        xai: fakeAdapter([catalogModel("grok-4.5"), compatible, incompatible]),
        mock: fakeAdapter([catalogModel("mock-structured-v1", { providerId: "mock" })])
      }
    });

    const response = await harness.request.post("/api/models/sync").send({}).expect(200);
    expect(response.body.result.status).toBe("success");

    const catalog = await harness.request.get("/api/models/catalog").expect(200);
    const xaiModels = catalog.body.models.filter((model) => model.providerId === "xai");
    expect(
      xaiModels.find((model) => model.providerModelId === "grok-new-structured").compatibility.compatible
    ).toBe(true);
    expect(
      xaiModels.find((model) => model.providerModelId === "grok-image-only").compatibility.compatible
    ).toBe(false);
    expect(xaiModels.find((model) => model.providerModelId === "grok-4.5-latest").availability).toBe(
      "unavailable"
    );
  });

  it("uses the last known good catalog when a provider later fails", async () => {
    let fail = false;
    harness = createTestHarness({
      modelDiscoveryAdapters: {
        xai: {
          async discover() {
            if (fail) {
              return {
                status: "temporary_provider_failure",
                source: "error",
                fallbackReason: "temporary_provider_failure",
                error: { code: "temporary_provider_failure", message: "network down", retryable: true },
                rawResponse: null,
                models: [],
                validationFailures: []
              };
            }
            return fakeAdapter([catalogModel("grok-live")]).discover();
          }
        },
        mock: fakeAdapter([catalogModel("mock-structured-v1", { providerId: "mock" })])
      }
    });

    await harness.request.post("/api/models/sync").send({}).expect(200);
    fail = true;
    const response = await harness.request.post("/api/models/sync").send({}).expect(200);
    const xai = response.body.result.providers.find((provider) => provider.providerId === "xai");
    expect(xai.fallbackState).toMatch(/cache|last_known_good/);

    const config = await harness.request.get("/api/config").expect(200);
    const xaiProvider = config.body.ai.providers.find((provider) => provider.id === "xai");
    expect(xaiProvider.models.map((model) => model.id)).toContain("grok-live");

    fail = false;
    const recovered = await harness.request.post("/api/models/sync").send({}).expect(200);
    const recoveredXai = recovered.body.result.providers.find((provider) => provider.providerId === "xai");
    expect(recoveredXai.source).toBe("fake");
    expect(recoveredXai.fallbackState).toBe("none");
  });
});
