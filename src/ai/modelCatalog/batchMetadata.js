const VERIFIED_AT = "2026-07-21";
const OPENAI_BATCH_SOURCE_URL = "https://developers.openai.com/api/docs/guides/batch";
const OPENAI_PRICING_SOURCE_URL = "https://developers.openai.com/api/docs/pricing";
const ANTHROPIC_BATCH_SOURCE_URL = "https://platform.claude.com/docs/en/build-with-claude/batch-processing";
const ANTHROPIC_PRICING_SOURCE_URL = "https://platform.claude.com/docs/en/about-claude/pricing";
const XAI_BATCH_SOURCE_URL = "https://docs.x.ai/developers/advanced-api-usage/batch-api";
const XAI_PRICING_SOURCE_URL = "https://docs.x.ai/developers/pricing";
const OPENROUTER_SOURCE_URL = "https://openrouter.ai/docs/quickstart";
const VENICE_SOURCE_URL = "https://docs.venice.ai/getting-started/quick-start";
const LUMAAI_SOURCE_URL = "https://docs.lumalabs.ai/docs/api";
const OLLAMA_SOURCE_URL = "https://docs.ollama.com/api/openai-compatibility";

const XAI_DISCOUNTED_MODELS = new Map([
  ["grok-4.3", 20],
  ["grok-4.3-latest", 20],
  ["grok-4.20-0309-reasoning", 20],
  ["grok-4.20-0309-non-reasoning", 20]
]);

const XAI_UNSUPPORTED_MODELS = new Set(["grok-4.5", "grok-4.5-latest", "grok-latest"]);

const VERIFIED_ANTHROPIC_BATCH_MODELS = new Set([
  "claude-fable-5",
  "claude-opus-4-8",
  "claude-sonnet-5",
  "claude-haiku-4-5",
  "claude-haiku-4-5-20251001",
  "claude-mythos-5"
]);

function displayUsd(value) {
  if (!Number.isFinite(value)) return null;
  return `$${value.toFixed(value < 1 ? 4 : 2)}`;
}

function discounted(value, percent) {
  if (!Number.isFinite(value)) return null;
  return Number((value * (1 - percent / 100)).toFixed(6));
}

function batchEnvelope({
  pricing,
  classification,
  supported,
  discountedPricing,
  sourceUrl,
  reason,
  limitations = [],
  discountPercent = null,
  limits = {}
}) {
  const batchInput = discountedPricing?.inputPerMillionTokens ?? null;
  const batchOutput = discountedPricing?.outputPerMillionTokens ?? null;
  const batchCachedInputRead = discountedPricing?.cachedInputReadPerMillionTokens ?? null;
  const batchCachedInputWrite = discountedPricing?.cachedInputWritePerMillionTokens ?? null;
  return {
    ...(pricing ?? {}),
    batch: {
      classification,
      supported,
      discounted:
        classification === "native_discounted_batch"
          ? true
          : classification === "native_batch_no_verified_discount"
            ? false
            : null,
      inputPerMillionTokens: batchInput,
      outputPerMillionTokens: batchOutput,
      cachedInputReadPerMillionTokens: batchCachedInputRead,
      cachedInputWritePerMillionTokens: batchCachedInputWrite,
      inputDisplay: displayUsd(batchInput),
      outputDisplay: displayUsd(batchOutput),
      cachedInputReadDisplay: displayUsd(batchCachedInputRead),
      cachedInputWriteDisplay: displayUsd(batchCachedInputWrite),
      discountPercent,
      currency: pricing?.currency ?? "USD",
      sourceUrl,
      verifiedAt: VERIFIED_AT,
      reason,
      limitations,
      limits
    }
  };
}

function openAiBatchPricing(pricing) {
  const batch = pricing?.batch ?? null;
  if (!batch) {
    return batchEnvelope({
      pricing,
      classification: "standard_api_only",
      supported: false,
      sourceUrl: OPENAI_PRICING_SOURCE_URL,
      reason: "No verified OpenAI Batch pricing was found for this model.",
      limitations: [
        "OpenAI Batch is only enabled for models with explicit Batch pricing on the official pricing page."
      ],
      limits: {
        completionWindow: "24h",
        maxRequestsPerBatch: 50_000,
        maxBytesPerBatch: 200 * 1024 * 1024,
        batchCreationPerHour: 2_000
      }
    });
  }
  return batchEnvelope({
    pricing,
    classification: "native_discounted_batch",
    supported: true,
    discountedPricing: batch,
    sourceUrl: OPENAI_BATCH_SOURCE_URL,
    reason: "OpenAI Batch is officially documented and priced for this model.",
    limitations: [
      "Each batch file must target a single model.",
      "Results may be returned out of order and must be reconciled by custom_id."
    ],
    discountPercent:
      Number.isFinite(pricing?.inputPerMillionTokens) && Number.isFinite(batch.inputPerMillionTokens)
        ? Number(
            (
              ((pricing.inputPerMillionTokens - batch.inputPerMillionTokens) /
                pricing.inputPerMillionTokens) *
              100
            ).toFixed(2)
          )
        : 50,
    limits: {
      completionWindow: "24h",
      maxRequestsPerBatch: 50_000,
      maxBytesPerBatch: 200 * 1024 * 1024,
      batchCreationPerHour: 2_000
    }
  });
}

function anthropicBatchPricing(model, pricing) {
  if (!VERIFIED_ANTHROPIC_BATCH_MODELS.has(model.providerModelId)) {
    return batchEnvelope({
      pricing,
      classification: "unavailable_or_unverified",
      supported: false,
      sourceUrl: ANTHROPIC_BATCH_SOURCE_URL,
      reason:
        "Anthropic documents batch support for active models, but this specific model could not be verified.",
      limitations: [
        "Native Anthropic batch submission remains disabled until this model is verified in the official docs."
      ],
      limits: {
        completionWindow: "24h",
        maxRequestsPerBatch: 100_000,
        maxBytesPerBatch: 256 * 1024 * 1024
      }
    });
  }
  const discountedPricing = {
    inputPerMillionTokens: discounted(pricing?.inputPerMillionTokens, 50),
    outputPerMillionTokens: discounted(pricing?.outputPerMillionTokens, 50),
    cachedInputReadPerMillionTokens: discounted(pricing?.cachedInputReadPerMillionTokens, 50),
    cachedInputWritePerMillionTokens: discounted(pricing?.cachedInputWritePerMillionTokens, 50)
  };
  return batchEnvelope({
    pricing,
    classification: "native_discounted_batch",
    supported: true,
    discountedPricing,
    sourceUrl: ANTHROPIC_PRICING_SOURCE_URL,
    reason: "Anthropic Message Batches are documented for active models at 50% of standard rates.",
    limitations: [
      "Batch requests must use custom_id values that match ^[a-zA-Z0-9_-]{1,64}$.",
      "Results are available for 29 days after batch creation."
    ],
    discountPercent: 50,
    limits: {
      completionWindow: "24h",
      maxRequestsPerBatch: 100_000,
      maxBytesPerBatch: 256 * 1024 * 1024,
      customIdPattern: "^[a-zA-Z0-9_-]{1,64}$"
    }
  });
}

function xaiBatchPricing(model, pricing) {
  if (XAI_UNSUPPORTED_MODELS.has(model.providerModelId)) {
    return batchEnvelope({
      pricing,
      classification: "standard_api_only",
      supported: false,
      sourceUrl: XAI_BATCH_SOURCE_URL,
      reason: "xAI documents this model as unsupported on the Batch API.",
      limitations: ["grok-4.5 requests are rejected by xAI's Batch API."],
      limits: {
        completionWindow: "24h",
        maxBytesPerRequest: 25 * 1024 * 1024,
        addRequestsCallsPerThirtySeconds: 1_000
      }
    });
  }

  const discountPercent = XAI_DISCOUNTED_MODELS.get(model.providerModelId);
  if (!discountPercent) {
    return batchEnvelope({
      pricing,
      classification: "unavailable_or_unverified",
      supported: false,
      sourceUrl: XAI_PRICING_SOURCE_URL,
      reason: "No verified xAI batch discount or model eligibility was found for this model.",
      limitations: ["Batch submission is restricted to models with explicit verified xAI batch pricing."],
      limits: {
        completionWindow: "24h",
        maxBytesPerRequest: 25 * 1024 * 1024,
        addRequestsCallsPerThirtySeconds: 1_000
      }
    });
  }

  const discountedPricing = {
    inputPerMillionTokens: discounted(pricing?.inputPerMillionTokens, discountPercent),
    outputPerMillionTokens: discounted(pricing?.outputPerMillionTokens, discountPercent),
    cachedInputReadPerMillionTokens: discounted(pricing?.cachedInputReadPerMillionTokens, discountPercent),
    cachedInputWritePerMillionTokens: discounted(pricing?.cachedInputWritePerMillionTokens, discountPercent)
  };
  return batchEnvelope({
    pricing,
    classification: "native_discounted_batch",
    supported: true,
    discountedPricing,
    sourceUrl: XAI_PRICING_SOURCE_URL,
    reason: "xAI lists a verified Batch API discount for this model.",
    limitations: [
      "xAI results are paginated and must be reconciled by batch_request_id.",
      "Batches are unavailable under xAI zero-data-retention mode."
    ],
    discountPercent,
    limits: {
      completionWindow: "24h",
      maxBytesPerRequest: 25 * 1024 * 1024,
      addRequestsCallsPerThirtySeconds: 1_000
    }
  });
}

function standardOnly(pricing, sourceUrl, reason) {
  return batchEnvelope({
    pricing,
    classification: "standard_api_only",
    supported: false,
    sourceUrl,
    reason,
    limitations: ["Use the standard API path; no verified discounted provider-side batch service was found."]
  });
}

function unverified(pricing, sourceUrl, reason) {
  return batchEnvelope({
    pricing,
    classification: "unavailable_or_unverified",
    supported: false,
    sourceUrl,
    reason,
    limitations: [
      "Provider-batch mode remains disabled until an official supported batch service is verified."
    ]
  });
}

export function applyBatchMetadata(model) {
  const pricing = model.pricing ?? {
    currency: "USD",
    status: "unavailable",
    sourceUrl: null,
    verifiedAt: null
  };

  switch (model.providerId) {
    case "openai":
      return { ...model, pricing: openAiBatchPricing(pricing) };
    case "anthropic":
      return { ...model, pricing: anthropicBatchPricing(model, pricing) };
    case "xai":
      return { ...model, pricing: xaiBatchPricing(model, pricing) };
    case "venice":
      return {
        ...model,
        pricing: standardOnly(
          pricing,
          VENICE_SOURCE_URL,
          "Venice documents an OpenAI-compatible synchronous API, but no verified discounted inference batch service."
        )
      };
    case "lumaai":
      return {
        ...model,
        pricing: standardOnly(
          pricing,
          LUMAAI_SOURCE_URL,
          "Luma documents asynchronous generations, but not a discounted provider-side batch API for this workflow."
        )
      };
    case "openrouter":
      return {
        ...model,
        pricing: standardOnly(
          pricing,
          OPENROUTER_SOURCE_URL,
          "OpenRouter documents a unified synchronous API and prompt caching, but no verified native discounted batch endpoint."
        )
      };
    case "ollama":
      return {
        ...model,
        pricing: standardOnly(
          pricing,
          OLLAMA_SOURCE_URL,
          "Ollama is a local loopback runtime; no provider-side discounted batch program applies."
        )
      };
    case "custom":
      return {
        ...model,
        pricing: unverified(
          pricing,
          model.metadataSource?.url ?? null,
          "Custom endpoints cannot be assumed to support native discounted batch processing."
        )
      };
    case "mock":
      return {
        ...model,
        pricing: standardOnly(pricing, null, "The mock provider is a local test path only.")
      };
    default:
      return {
        ...model,
        pricing: unverified(
          pricing,
          model.metadataSource?.url ?? null,
          "Batch support for this provider is unverified."
        )
      };
  }
}

export function batchMetadataForModel(model) {
  return applyBatchMetadata(model).pricing?.batch ?? null;
}
