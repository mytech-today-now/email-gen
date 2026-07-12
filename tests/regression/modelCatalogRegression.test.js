import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestHarness } from "../helpers/appTestHarness.js";

const envKeys = ["AI_MOCK", "ENABLED_AI_PROVIDERS", "DEFAULT_AI_PROVIDER", "DEFAULT_AI_MODEL"];
let previousEnv;
let harness;

function adapter(models) {
  return {
    async discover() {
      return {
        status: "success",
        source: "regression-fake",
        fallbackReason: null,
        rawResponse: { data: models },
        models,
        validationFailures: []
      };
    }
  };
}

function model(providerId, providerModelId, extra = {}) {
  const normalized = {
    providerId,
    providerModelId,
    displayName: providerModelId,
    aliases: [],
    family: "stable",
    version: null,
    status: "available",
    availability: "available",
    createdAtProvider: null,
    deprecatedAt: null,
    retiredAt: null,
    inputModalities: ["text"],
    outputModalities: ["text"],
    supportedDataTypes: ["email"],
    capabilities: { text: true, structuredOutput: true },
    limits: {},
    pricing: null,
    regionalAvailability: null,
    requiredApiVersion: null,
    capabilityConfidence: "confirmed",
    discoverySource: "regression-fake",
    metadataSource: { providerMetadata: true },
    rawProviderMetadata: null,
    compatibility: { compatible: true, reasons: [] }
  };
  return { ...normalized, ...extra };
}

beforeEach(() => {
  previousEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  process.env.AI_MOCK = "true";
  process.env.ENABLED_AI_PROVIDERS = "mock";
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

describe("model catalog regressions", () => {
  it("preserves existing mock model selections after catalog seeding", async () => {
    harness = createTestHarness();
    const config = await harness.request.get("/api/config").expect(200);
    const mock = config.body.ai.providers.find((provider) => provider.id === "mock");
    expect(mock.models.find((item) => item.id === "mock-structured-v1").capabilities).toContain("structured");
  });

  it("does not create duplicate records after repeated synchronization", async () => {
    harness = createTestHarness({
      modelDiscoveryAdapters: {
        mock: adapter([model("mock", "mock-structured-v1"), model("mock", "mock-extra-v1")])
      }
    });
    await harness.request.post("/api/models/sync").send({}).expect(200);
    await harness.request.post("/api/models/sync").send({}).expect(200);

    const catalog = await harness.request.get("/api/models/catalog").expect(200);
    const ids = catalog.body.models
      .filter((item) => item.providerId === "mock")
      .map((item) => item.providerModelId);
    expect(ids.filter((id) => id === "mock-extra-v1")).toHaveLength(1);
  });

  it("blocks a retired selected model and reports a compatible fallback", async () => {
    harness = createTestHarness({
      modelDiscoveryAdapters: {
        mock: adapter([
          model("mock", "mock-structured-v1", { availability: "retired", status: "retired" }),
          model("mock", "mock-replacement-v1")
        ])
      }
    });
    await harness.request.post("/api/models/sync").send({}).expect(200);
    const sample = await harness.request.post("/api/records/load-sample").send({}).expect(200);
    const response = await harness.request
      .post("/api/jobs")
      .send({
        mode: "current",
        recordId: sample.body.records[0].id,
        templateName: "restaurant-ai-sms.txt",
        provider: "mock",
        model: "mock-structured-v1",
        researchEnabled: false,
        concurrency: 1,
        delayMs: 0
      })
      .expect(400);

    expect(response.body.error.code).toBe("MODEL_UNAVAILABLE");
    expect(response.body.error.details.fallback).toMatchObject({
      providerId: "mock",
      modelId: "mock-replacement-v1"
    });
  });
});
