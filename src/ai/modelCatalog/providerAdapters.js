import { nowIso } from "../../utils/helpers.js";
import {
  configuredCapabilities,
  evaluateModelCompatibility,
  mergeCapabilities,
  normalizeDataTypes,
  normalizeModalities
} from "./capabilities.js";
import { fetchJsonWithRetry, ProviderDiscoveryError } from "./providerHttp.js";
import { providerCredentialDefinition } from "../../security/credentialCatalog.js";

function envString(...names) {
  for (const name of names) {
    const value = process.env[name];
    if (value !== undefined && value !== "") return value;
  }
  return undefined;
}

function configuredMap(provider) {
  return new Map((provider.models ?? []).map((model) => [model.id, model]));
}

function dedupe(values) {
  return [...new Set((values ?? []).map((value) => String(value ?? "").trim()).filter(Boolean))];
}

function asArray(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.models)) return payload.models;
  if (Array.isArray(payload?.items)) return payload.items;
  return null;
}

function nextCursor(providerId, payload) {
  if (providerId === "anthropic" && payload?.has_more && payload?.last_id) {
    return { param: "after_id", value: payload.last_id };
  }
  if (payload?.next_page) return { param: "page", value: payload.next_page };
  if (payload?.nextPage) return { param: "page", value: payload.nextPage };
  if (payload?.next) return { param: "cursor", value: payload.next };
  return null;
}

function parseCreatedAt(raw) {
  const created = raw.created_at ?? raw.createdAt ?? raw.created ?? raw.release_date ?? raw.releaseDate;
  if (typeof created === "number") {
    const millis = created > 10_000_000_000 ? created : created * 1000;
    return new Date(millis).toISOString();
  }
  if (typeof created === "string" && Number.isFinite(Date.parse(created)))
    return new Date(created).toISOString();
  return null;
}

function familyFromRaw(raw) {
  return raw.family ?? raw.model_family ?? raw.modelFamily ?? raw.group ?? null;
}

function versionFromRaw(raw) {
  return raw.version ?? raw.model_version ?? raw.modelVersion ?? null;
}

function arrayCapability(raw, names) {
  const list = raw.capabilities ?? raw.supported_features ?? raw.features ?? raw.traits ?? [];
  const values = Array.isArray(list) ? list.map((value) => String(value).toLowerCase()) : [];
  return names.some((name) => values.includes(name));
}

function objectCapability(raw, names) {
  const caps =
    raw.capabilities && typeof raw.capabilities === "object" && !Array.isArray(raw.capabilities)
      ? raw.capabilities
      : {};
  return names.some((name) => caps[name] === true);
}

function metadataCapabilities(raw) {
  const type = String(raw.type ?? raw.model_type ?? raw.modality ?? raw.mode ?? "").toLowerCase();
  const inputModalities = normalizeModalities([
    ...(Array.isArray(raw.input_modalities) ? raw.input_modalities : []),
    ...(Array.isArray(raw.inputModalities) ? raw.inputModalities : []),
    ...(type === "text" || type === "chat" || type === "llm" ? ["text"] : []),
    ...(type === "image" ? ["text", "image"] : []),
    ...(type === "audio" ? ["audio"] : []),
    ...(type === "video" ? ["text", "image", "video"] : [])
  ]);
  const outputModalities = normalizeModalities([
    ...(Array.isArray(raw.output_modalities) ? raw.output_modalities : []),
    ...(Array.isArray(raw.outputModalities) ? raw.outputModalities : []),
    ...(type === "text" || type === "chat" || type === "llm" ? ["text"] : []),
    ...(type === "image" ? ["image"] : []),
    ...(type === "audio" ? ["audio"] : []),
    ...(type === "video" ? ["video"] : [])
  ]);
  const structured =
    objectCapability(raw, ["structured_output", "structuredOutput", "json_schema", "jsonSchema"]) ||
    arrayCapability(raw, ["structured", "structured_output", "json_schema"]);
  const toolCalling =
    objectCapability(raw, ["tool_calling", "toolCalling", "function_calling", "functionCalling"]) ||
    arrayCapability(raw, ["tools", "tool_calling", "function_calling"]);
  const embedding = type === "embedding" || arrayCapability(raw, ["embedding", "embeddings"]);
  const imageGeneration = type === "image" || arrayCapability(raw, ["image", "image_generation"]);
  const audioInput =
    inputModalities.includes("audio") || arrayCapability(raw, ["audio_input", "speech_to_text"]);
  const audioOutput =
    outputModalities.includes("audio") || arrayCapability(raw, ["audio_output", "text_to_speech"]);
  const video = type === "video" || outputModalities.includes("video") || arrayCapability(raw, ["video"]);

  return {
    inputModalities,
    outputModalities,
    capabilities: {
      text: inputModalities.includes("text") || outputModalities.includes("text") ? true : null,
      toolCalling: toolCalling ? true : null,
      structuredOutput: structured ? true : null,
      streaming: objectCapability(raw, ["streaming"]) || arrayCapability(raw, ["streaming"]) ? true : null,
      embedding: embedding ? true : null,
      imageGeneration: imageGeneration ? true : null,
      audioInput: audioInput ? true : null,
      audioOutput: audioOutput ? true : null,
      video: video ? true : null,
      reasoning: objectCapability(raw, ["reasoning"]) || arrayCapability(raw, ["reasoning"]) ? true : null
    }
  };
}

function inferCapabilitiesFromName(raw) {
  const id = String(raw.id ?? raw.name ?? "").toLowerCase();
  if (!id) return {};
  if (/embedding/.test(id)) {
    return {
      inputModalities: ["text"],
      outputModalities: ["embedding"],
      capabilities: { embedding: true, structuredOutput: false, text: false }
    };
  }
  if (/image|dall-e|sd-|flux|photon/.test(id)) {
    return {
      inputModalities: ["text", "image"],
      outputModalities: ["image"],
      capabilities: { imageGeneration: true, structuredOutput: false, text: false }
    };
  }
  if (/whisper|transcribe|tts|audio|speech/.test(id)) {
    return {
      inputModalities: ["audio", "text"],
      outputModalities: ["audio", "text"],
      capabilities: { audioInput: true, audioOutput: true, structuredOutput: false }
    };
  }
  if (/video|ray/.test(id)) {
    return {
      inputModalities: ["text", "image"],
      outputModalities: ["video"],
      capabilities: { video: true, structuredOutput: false, text: false }
    };
  }
  return {
    inputModalities: ["text"],
    outputModalities: ["text"],
    supportedDataTypes: ["email", "text", "structured-json"],
    capabilities: { text: true, structuredOutput: true }
  };
}

function limitsFromRaw(raw) {
  return {
    contextWindow:
      raw.context_window ?? raw.contextWindow ?? raw.max_input_tokens ?? raw.maxInputTokens ?? null,
    maxOutputTokens: raw.max_output_tokens ?? raw.maxOutputTokens ?? raw.max_tokens ?? raw.maxTokens ?? null
  };
}

function numericPrice(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeProviderPricing(rawPricing, sourceUrl = null) {
  if (!rawPricing || typeof rawPricing !== "object") return null;
  const input =
    numericPrice(rawPricing.inputPerMillionTokens) ??
    numericPrice(rawPricing.input?.usd) ??
    numericPrice(rawPricing.input) ??
    numericPrice(rawPricing.prompt);
  const output =
    numericPrice(rawPricing.outputPerMillionTokens) ??
    numericPrice(rawPricing.output?.usd) ??
    numericPrice(rawPricing.output) ??
    numericPrice(rawPricing.completion);
  const cachedInput =
    numericPrice(rawPricing.cachedInputReadPerMillionTokens) ??
    numericPrice(rawPricing.cached_input?.usd) ??
    numericPrice(rawPricing.cachedInput) ??
    numericPrice(rawPricing.input_cache_read);
  const cacheWrite =
    numericPrice(rawPricing.cachedInputWritePerMillionTokens) ??
    numericPrice(rawPricing.cache_write?.usd) ??
    numericPrice(rawPricing.cacheWrite) ??
    numericPrice(rawPricing.input_cache_write);
  const inputDisplay = rawPricing.inputDisplay ?? null;
  const outputDisplay = rawPricing.outputDisplay ?? null;
  if (
    input === null &&
    output === null &&
    cachedInput === null &&
    cacheWrite === null &&
    !inputDisplay &&
    !outputDisplay
  ) {
    return null;
  }
  return {
    currency: rawPricing.currency ?? "USD",
    inputPerMillionTokens: input,
    outputPerMillionTokens: output,
    cachedInputReadPerMillionTokens: cachedInput,
    cachedInputWritePerMillionTokens: cacheWrite,
    inputDisplay: inputDisplay ?? (input === null ? null : `$${input.toFixed(input < 1 ? 4 : 2)}`),
    outputDisplay: outputDisplay ?? (output === null ? null : `$${output.toFixed(output < 1 ? 4 : 2)}`),
    status:
      rawPricing.status ??
      (input !== null || output !== null || inputDisplay || outputDisplay ? "fresh" : "unavailable"),
    sourceUrl: rawPricing.sourceUrl ?? sourceUrl,
    verifiedAt: rawPricing.verifiedAt ?? nowIso(),
    raw: rawPricing.raw ?? rawPricing
  };
}

function resolvedPricing(raw, configured, pricingCatalog, sourceUrl = null) {
  const configuredPricing = normalizeProviderPricing(configured?.pricing, sourceUrl);
  if (configuredPricing) return configuredPricing;
  if (pricingCatalog?.has(raw.id ?? raw.name ?? raw.model))
    return pricingCatalog.get(raw.id ?? raw.name ?? raw.model);
  const alias = configured?.aliasFor ? pricingCatalog?.get(configured.aliasFor) : null;
  if (alias) return alias;
  return normalizeProviderPricing(raw.pricing ?? raw.price ?? null, sourceUrl);
}

function normalizeModel({
  providerId,
  raw,
  configured,
  config,
  source,
  pricingCatalog,
  pricingSourceUrl = null
}) {
  const providerModelId = String(raw.id ?? raw.name ?? raw.model ?? "").trim();
  if (!providerModelId) {
    return { error: { code: "missing_model_id", message: "Provider model record did not include an id." } };
  }
  if (providerModelId.length > 300) {
    return { error: { code: "model_id_too_long", message: "Provider model id exceeded 300 characters." } };
  }

  const metadata = metadataCapabilities(raw);
  const inferred =
    config.modelSync.allowInferredCapabilities && metadata.inputModalities.length === 0
      ? inferCapabilitiesFromName(raw)
      : {};
  const configuredCaps = configured ? configuredCapabilities(configured) : {};
  const configuredInputModalities =
    configured?.inputModalities ??
    (configured?.capabilities?.includes("text")
      ? ["text"]
      : configured?.capabilities?.includes("audio")
        ? ["audio", "text"]
        : configured?.capabilities?.includes("image")
          ? ["text", "image"]
          : configured?.capabilities?.includes("video")
            ? ["text", "image"]
            : undefined);
  const configuredOutputModalities =
    configured?.outputModalities ??
    (configured?.capabilities?.includes("image")
      ? ["image"]
      : configured?.capabilities?.includes("audio")
        ? ["audio", "text"]
        : configured?.capabilities?.includes("video")
          ? ["video"]
          : configured?.capabilities?.some((item) => item === "text" || item === "structured")
            ? ["text"]
            : undefined);
  const inputModalities = normalizeModalities(
    configuredInputModalities ?? inferred.inputModalities ?? metadata.inputModalities
  );
  const outputModalities = normalizeModalities(
    configuredOutputModalities ?? inferred.outputModalities ?? metadata.outputModalities
  );
  const supportedDataTypes = normalizeDataTypes(
    configured?.supportedDataTypes ??
      raw.supportedDataTypes ??
      raw.supported_data_types ??
      inferred.supportedDataTypes ??
      (inputModalities.includes("text") &&
      outputModalities.includes("text") &&
      (configuredCaps.structuredOutput || metadata.capabilities.structuredOutput)
        ? ["email", "text", "structured-json"]
        : [])
  );
  const capabilities = mergeCapabilities(
    mergeCapabilities(metadata.capabilities, inferred.capabilities),
    configuredCaps
  );
  const capabilityConfidence = configured
    ? "configured"
    : inferred.capabilities
      ? "inferred"
      : Object.values(metadata.capabilities).some((value) => value === true)
        ? "confirmed"
        : "unknown";
  const status =
    raw.status ??
    raw.lifecycle_status ??
    (configured?.legacy ? "legacy" : configured?.current ? "available" : "available");
  const availability =
    raw.availability ??
    (["retired", "unavailable"].includes(status)
      ? "unavailable"
      : configured?.limitedAvailability
        ? "limited"
        : "available");

  const model = {
    providerId,
    providerModelId,
    displayName: raw.display_name ?? raw.displayName ?? raw.name ?? configured?.label ?? providerModelId,
    aliases: dedupe([...(raw.aliases ?? []), ...(configured?.aliasFor ? [configured.aliasFor] : [])]),
    family: familyFromRaw(raw) ?? configured?.family ?? null,
    version: versionFromRaw(raw) ?? configured?.version ?? null,
    status,
    availability,
    createdAtProvider: parseCreatedAt(raw),
    deprecatedAt: raw.deprecated_at ?? raw.deprecatedAt ?? null,
    retiredAt: raw.retired_at ?? raw.retiredAt ?? null,
    inputModalities,
    outputModalities,
    supportedDataTypes,
    capabilities,
    limits: limitsFromRaw(raw),
    pricing: resolvedPricing(raw, configured, pricingCatalog, pricingSourceUrl),
    regionalAvailability: raw.regions ?? raw.regional_availability ?? null,
    requiredApiVersion: raw.required_api_version ?? raw.requiredApiVersion ?? null,
    capabilityConfidence,
    discoverySource: source,
    metadataSource: {
      providerMetadata: Object.values(metadata.capabilities).some((value) => value === true),
      configuredOverride: Boolean(configured),
      inferred: Boolean(inferred.capabilities)
    },
    rawProviderMetadata: raw
  };
  return {
    model: {
      ...model,
      compatibility: evaluateModelCompatibility(model, config.modelSync.requiredCapabilities, {
        allowInferredCapabilities: config.modelSync.allowInferredCapabilities
      }),
      exclusionReason: null
    }
  };
}

function normalizePayload({
  providerId,
  payloads,
  provider,
  config,
  source,
  pricingCatalog,
  pricingSourceUrl = null
}) {
  const configuredById = configuredMap(provider);
  const seen = new Set();
  const models = [];
  const validationFailures = [];
  for (const payload of payloads) {
    const records = asArray(payload);
    if (!records) {
      validationFailures.push({
        code: "invalid_response_shape",
        message: "Provider model response did not contain a model array."
      });
      continue;
    }
    for (const raw of records) {
      const normalized = normalizeModel({
        providerId,
        raw,
        configured: configuredById.get(String(raw?.id ?? raw?.name ?? "")),
        config,
        source,
        pricingCatalog,
        pricingSourceUrl
      });
      if (normalized.error) {
        validationFailures.push(normalized.error);
        continue;
      }
      const key = normalized.model.providerModelId;
      if (seen.has(key)) {
        validationFailures.push({
          code: "duplicate_model_id",
          message: `Provider returned duplicate model id '${key}'.`
        });
        continue;
      }
      seen.add(key);
      models.push(normalized.model);
    }
  }
  return { models, validationFailures };
}

function configuredFallbackModels(
  provider,
  config,
  source = "configured-fallback",
  pricingCatalog = new Map(),
  pricingSourceUrl = null
) {
  const models = [];
  const validationFailures = [];
  for (const configured of provider.models ?? []) {
    const raw = {
      id: configured.id,
      name: configured.label,
      aliases: configured.aliasFor ? [configured.aliasFor] : [],
      status: configured.legacy ? "legacy" : "available"
    };
    const normalized = normalizeModel({
      providerId: provider.id,
      raw,
      configured,
      config,
      source,
      pricingCatalog,
      pricingSourceUrl
    });
    if (normalized.error) validationFailures.push(normalized.error);
    else models.push(normalized.model);
  }
  return { models, validationFailures };
}

async function discoverPaged({
  providerId,
  baseUrl,
  headers,
  provider,
  config,
  fetchImpl,
  logger,
  runId,
  pricingCatalog,
  pricingSourceUrl
}) {
  const payloads = [];
  const seenPageTokens = new Set();
  let url = new URL(baseUrl);
  for (let page = 1; page <= config.modelSync.paginationLimit; page += 1) {
    const payload = await fetchJsonWithRetry({
      fetchImpl,
      url: url.toString(),
      headers,
      timeoutMs: config.modelSync.providerTimeoutMs,
      maxResponseBytes: config.modelSync.maxResponseBytes,
      retryOptions: {
        maxRetries: config.modelSync.maxRetries,
        backoffMinMs: config.modelSync.backoffMinMs,
        backoffMaxMs: config.modelSync.backoffMaxMs
      },
      logger,
      providerId,
      runId
    });
    payloads.push(payload);
    const cursor = nextCursor(providerId, payload);
    if (!cursor) break;
    const tokenKey = `${cursor.param}:${cursor.value}`;
    if (seenPageTokens.has(tokenKey)) {
      throw new ProviderDiscoveryError("pagination_loop", "Provider returned a repeated pagination token.", {
        retryable: false
      });
    }
    seenPageTokens.add(tokenKey);
    url.searchParams.set(cursor.param, cursor.value);
  }
  if (payloads.length >= config.modelSync.paginationLimit) {
    throw new ProviderDiscoveryError(
      "pagination_limit_exceeded",
      "Provider model pagination limit was exceeded.",
      {
        retryable: false
      }
    );
  }
  return {
    rawResponse: payloads.length === 1 ? payloads[0] : payloads,
    ...normalizePayload({
      providerId,
      payloads,
      provider,
      config,
      source: "live",
      pricingCatalog,
      pricingSourceUrl
    })
  };
}

function credential(providerId, runtimeCredentials) {
  const definition = providerCredentialDefinition(providerId);
  return definition?.secretName ? runtimeCredentials?.get(definition.secretName) || undefined : undefined;
}

function bearerHeaders(apiKey) {
  return apiKey ? { authorization: `Bearer ${apiKey}` } : {};
}

function adapter(
  providerId,
  { dynamic = true, url, headers = (apiKey) => bearerHeaders(apiKey), runtimeCredentials = null } = {}
) {
  return {
    providerId,
    dynamic,
    async discover({ provider, config, fetchImpl, logger, runId, pricingCatalog, pricingSourceUrl }) {
      if (!dynamic) {
        return {
          status: "skipped",
          source: "configured-fallback",
          fallbackReason: "dynamic_discovery_unsupported",
          rawResponse: null,
          ...configuredFallbackModels(
            provider,
            config,
            "configured-fallback",
            pricingCatalog,
            pricingSourceUrl
          )
        };
      }
      const apiKey = credential(providerId, runtimeCredentials);
      if (!apiKey && providerId !== "custom") {
        return {
          status: "skipped",
          source: "configured-fallback",
          fallbackReason: "missing_credentials",
          rawResponse: null,
          ...configuredFallbackModels(
            provider,
            config,
            "configured-fallback",
            pricingCatalog,
            pricingSourceUrl
          )
        };
      }
      try {
        const result = await discoverPaged({
          providerId,
          baseUrl: typeof url === "function" ? url(provider) : url,
          headers: headers(apiKey, provider),
          provider,
          config,
          fetchImpl,
          logger,
          runId,
          pricingCatalog,
          pricingSourceUrl
        });
        return {
          status: "success",
          source: "live",
          fallbackReason: null,
          ...result
        };
      } catch (error) {
        return {
          status: error.code ?? "temporary_provider_failure",
          source: "error",
          fallbackReason: error.code ?? "discovery_failed",
          error: {
            code: error.code ?? "discovery_failed",
            message: error.message,
            status: error.status ?? null,
            retryable: Boolean(error.retryable)
          },
          rawResponse: null,
          models: [],
          validationFailures: []
        };
      }
    }
  };
}

export function createProviderDiscoveryAdapters({ runtimeCredentials = null } = {}) {
  return {
    openai: adapter("openai", { url: "https://api.openai.com/v1/models", runtimeCredentials }),
    anthropic: adapter("anthropic", {
      url: "https://api.anthropic.com/v1/models",
      runtimeCredentials,
      headers: (apiKey) => ({
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      })
    }),
    xai: adapter("xai", { url: "https://api.x.ai/v1/models", runtimeCredentials }),
    venice: adapter("venice", { url: "https://api.venice.ai/api/v1/models", runtimeCredentials }),
    lumaai: adapter("lumaai", { dynamic: false, runtimeCredentials }),
    custom: adapter("custom", {
      runtimeCredentials,
      url() {
        const configured = envString("AI_CUSTOM_BASE_URL", "CUSTOM_PROVIDER_BASE_URL");
        if (!configured)
          throw new ProviderDiscoveryError("missing_base_url", "Custom provider base URL is not configured.");
        const base = configured.endsWith("/") ? configured.slice(0, -1) : configured;
        return base.endsWith("/v1") ? `${base}/models` : `${base}/v1/models`;
      },
      headers: (apiKey, provider) => {
        if (provider.customProviderType === "ollama") return {};
        return bearerHeaders(apiKey);
      }
    }),
    mock: {
      providerId: "mock",
      dynamic: true,
      async discover({ provider, config }) {
        const payload = {
          data: (provider.models ?? []).map((model) => ({ id: model.id, name: model.label }))
        };
        return {
          status: "success",
          source: "mock",
          fallbackReason: null,
          rawResponse: payload,
          ...configuredFallbackModels(provider, config, "mock")
        };
      }
    }
  };
}

export function cacheExpiry(config, clock = Date) {
  return new clock(Date.now() + config.modelSync.cacheTtlSeconds * 1000).toISOString();
}

export function staleCutoff(config, clock = Date) {
  return new clock(Date.now() - config.modelSync.staleCatalogSeconds * 1000).toISOString();
}

export function timestamp() {
  return nowIso();
}
