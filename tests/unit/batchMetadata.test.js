import { describe, expect, it } from "vitest";
import { applyBatchMetadata, batchMetadataForModel } from "../../src/ai/modelCatalog/batchMetadata.js";

function model(providerId, providerModelId, pricing = {}) {
  return {
    id: `${providerId}:${providerModelId}`,
    providerId,
    providerModelId,
    displayName: providerModelId,
    compatibility: { compatible: true, reasons: [] },
    pricing: {
      currency: "USD",
      status: "fresh",
      inputPerMillionTokens: 5,
      outputPerMillionTokens: 15,
      ...pricing
    }
  };
}

describe("batch metadata", () => {
  it("marks OpenAI models with batch pricing as native discounted batch", () => {
    const enriched = applyBatchMetadata(
      model("openai", "gpt-5.6-sol", {
        batch: {
          inputPerMillionTokens: 2.5,
          outputPerMillionTokens: 7.5
        }
      })
    );

    expect(enriched.pricing.batch).toMatchObject({
      classification: "native_discounted_batch",
      supported: true,
      discountPercent: 50,
      inputPerMillionTokens: 2.5,
      outputPerMillionTokens: 7.5
    });
  });

  it("computes Anthropic batch discounts from verified standard pricing", () => {
    const batch = batchMetadataForModel(
      model("anthropic", "claude-sonnet-5", {
        inputPerMillionTokens: 3,
        outputPerMillionTokens: 15,
        cachedInputReadPerMillionTokens: 0.3
      })
    );

    expect(batch).toMatchObject({
      classification: "native_discounted_batch",
      discountPercent: 50,
      inputPerMillionTokens: 1.5,
      outputPerMillionTokens: 7.5,
      cachedInputReadPerMillionTokens: 0.15
    });
  });

  it("marks xAI grok-4.5 as standard-api only for provider batch", () => {
    const batch = batchMetadataForModel(model("xai", "grok-4.5"));

    expect(batch).toMatchObject({
      classification: "standard_api_only",
      supported: false
    });
    expect(batch.reason).toContain("unsupported");
  });

  it("marks custom endpoints as unavailable or unverified", () => {
    const batch = batchMetadataForModel(model("custom", "tenant-model"));

    expect(batch).toMatchObject({
      classification: "unavailable_or_unverified",
      supported: false
    });
  });
});
