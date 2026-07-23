import { AppError } from "../../utils/errors.js";
import { readBoundedResponseText } from "../../utils/responseBodies.js";

const JSON_CONTENT_TYPES = ["application/json", "application/*+json", "text/json"];

export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
export const OPENROUTER_MODELS_URL = `${OPENROUTER_BASE_URL}/models`;
export const DEFAULT_OLLAMA_ORIGIN = "http://127.0.0.1:11434";
export const TRUSTED_OLLAMA_ORIGINS = new Set([
  DEFAULT_OLLAMA_ORIGIN,
  "http://localhost:11434",
  "http://[::1]:11434"
]);

function numericPrice(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function priceEntry(raw, unit = "token") {
  const number = numericPrice(raw);
  if (number === null) return { raw: raw ?? null, value: null, status: "unavailable" };
  if (number < 0) return { raw: String(raw), value: null, status: "variable" };
  return {
    raw: String(raw),
    value: unit === "token" ? number * 1_000_000 : number,
    status: "available"
  };
}

export function normalizeOpenRouterPricing(pricing = {}, verifiedAt = new Date().toISOString()) {
  const input = priceEntry(pricing.prompt);
  const output = priceEntry(pricing.completion);
  const cachedRead = priceEntry(pricing.input_cache_read);
  const cachedWrite = priceEntry(pricing.input_cache_write);
  const request = priceEntry(pricing.request, "request");
  const image = priceEntry(pricing.image, "image");
  const webSearch = priceEntry(pricing.web_search, "request");
  const entries = [input, output, cachedRead, cachedWrite, request, image, webSearch];
  const status = entries.some((entry) => entry.status === "variable")
    ? "variable"
    : entries.some((entry) => entry.status === "available")
      ? "fresh"
      : "unavailable";
  return {
    currency: "USD",
    inputPerMillionTokens: input.value,
    outputPerMillionTokens: output.value,
    cachedInputReadPerMillionTokens: cachedRead.value,
    cachedInputWritePerMillionTokens: cachedWrite.value,
    perRequest: request.value,
    perImage: image.value,
    perWebSearch: webSearch.value,
    status,
    raw: { ...pricing },
    sourceUrl: OPENROUTER_MODELS_URL,
    verifiedAt
  };
}

export function normalizeOpenRouterModel(model, verifiedAt = new Date().toISOString()) {
  const supported = Array.isArray(model.supported_parameters) ? model.supported_parameters : [];
  const inputModalities = model.architecture?.input_modalities ?? [];
  const outputModalities = model.architecture?.output_modalities ?? [];
  const structured = supported.includes("structured_outputs") || supported.includes("response_format");
  const textOutput = outputModalities.includes("text") || model.architecture?.modality?.endsWith("->text");
  return {
    id: `openrouter:${model.id}`,
    providerId: "openrouter",
    providerModelId: model.id,
    displayName: model.name || model.id,
    description: model.description || "",
    contextLength: Number(model.context_length) || null,
    inputModalities,
    outputModalities,
    supportedParameters: supported,
    availability: model.expiration_date ? "expiring" : "available",
    expirationDate: model.expiration_date ?? null,
    compatibility: {
      compatible: Boolean(structured && textOutput),
      status: structured && textOutput ? "compatible" : "incompatible",
      reasons: [
        ...(!textOutput ? ["No text output modality is advertised."] : []),
        ...(!structured ? ["Structured output support is not advertised."] : [])
      ]
    },
    pricing: normalizeOpenRouterPricing(model.pricing, verifiedAt),
    metadataSource: { url: OPENROUTER_MODELS_URL, verifiedAt },
    rawProviderMetadata: model
  };
}

export function normalizeOllamaModel(model, verifiedAt = new Date().toISOString()) {
  const id = model.model || model.name;
  return {
    id: `ollama:${id}`,
    providerId: "ollama",
    providerModelId: id,
    displayName: id,
    family: model.details?.family ?? null,
    parameterSize: model.details?.parameter_size ?? null,
    quantization: model.details?.quantization_level ?? null,
    sizeBytes: Number(model.size) || null,
    modifiedAt: model.modified_at ?? null,
    inputModalities: ["text"],
    outputModalities: ["text"],
    supportedParameters: ["response_format"],
    availability: "available",
    compatibility: {
      compatible: true,
      status: "ready",
      reasons: []
    },
    pricing: {
      currency: "USD",
      status: "local-compute",
      label: "Local compute; no hosted API token fee",
      sourceUrl: "https://docs.ollama.com/api/tags",
      verifiedAt
    },
    metadataSource: { url: "https://docs.ollama.com/api/tags", verifiedAt },
    rawProviderMetadata: model
  };
}

export function validateOllamaOrigin(value = DEFAULT_OLLAMA_ORIGIN, { confirmedCustomHost = false } = {}) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new AppError("OLLAMA_HOST_INVALID", "Ollama host must be a valid loopback URL.", 400);
  }
  const allowedHosts = new Set(["127.0.0.1", "localhost", "[::1]"]);
  if (url.protocol !== "http:" || !allowedHosts.has(url.hostname) || url.username || url.password) {
    throw new AppError(
      "OLLAMA_HOST_BLOCKED",
      "Ollama discovery is restricted to an approved HTTP loopback host.",
      400
    );
  }
  if (!TRUSTED_OLLAMA_ORIGINS.has(url.origin) && !confirmedCustomHost) {
    throw new AppError(
      "OLLAMA_HOST_CONFIRMATION_REQUIRED",
      "Confirm the custom loopback Ollama host before connecting.",
      400
    );
  }
  return url.origin;
}

async function boundedJson(url, options = {}, { timeoutMs = 3500, fetchImpl = fetch } = {}) {
  const signal = AbortSignal.timeout(timeoutMs);
  const response = await fetchImpl(url, { ...options, signal });
  if (!response.ok) {
    throw new AppError("MODEL_DISCOVERY_FAILED", `Model discovery returned HTTP ${response.status}.`, 502);
  }
  const { text } = await readBoundedResponseText(response, {
    maxBytes: 2_000_000,
    expectedContentTypes: JSON_CONTENT_TYPES,
    deadlineMs: timeoutMs,
    idleTimeoutMs: timeoutMs,
    code: "MODEL_DISCOVERY_TOO_LARGE",
    message: "Model discovery response was too large.",
    status: 413
  });
  try {
    return JSON.parse(text);
  } catch {
    throw new AppError("MODEL_DISCOVERY_MALFORMED", "Model discovery returned malformed JSON.", 502);
  }
}

export async function discoverOpenRouter({ apiKey, fetchImpl = fetch, timeoutMs = 10_000 } = {}) {
  const verifiedAt = new Date().toISOString();
  const payload = await boundedJson(
    OPENROUTER_MODELS_URL,
    { headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {} },
    { fetchImpl, timeoutMs }
  );
  if (!Array.isArray(payload.data)) {
    throw new AppError("MODEL_DISCOVERY_MALFORMED", "OpenRouter did not return a model list.", 502);
  }
  return {
    providerId: "openrouter",
    status: "detected",
    verifiedAt,
    models: payload.data.map((item) => normalizeOpenRouterModel(item, verifiedAt))
  };
}

export async function discoverOllama({
  host,
  confirmedCustomHost,
  fetchImpl = fetch,
  timeoutMs = 2500
} = {}) {
  const origin = validateOllamaOrigin(host, { confirmedCustomHost });
  const verifiedAt = new Date().toISOString();
  try {
    const payload = await boundedJson(`${origin}/api/tags`, {}, { fetchImpl, timeoutMs });
    if (!Array.isArray(payload.models)) {
      throw new AppError("OLLAMA_RESPONSE_MALFORMED", "Ollama returned an invalid model list.", 502);
    }
    return {
      providerId: "ollama",
      status: "detected",
      origin,
      verifiedAt,
      models: payload.models.map((item) => normalizeOllamaModel(item, verifiedAt))
    };
  } catch (error) {
    if (error.name === "TimeoutError") {
      return {
        providerId: "ollama",
        status: "unavailable",
        origin,
        verifiedAt,
        models: [],
        error: { code: "OLLAMA_TIMEOUT", message: "Ollama did not respond before the timeout." }
      };
    }
    if (error.cause?.code === "ECONNREFUSED" || /fetch failed|ECONNREFUSED/i.test(error.message)) {
      return { providerId: "ollama", status: "not-detected", origin, verifiedAt, models: [] };
    }
    if (error instanceof AppError) throw error;
    return {
      providerId: "ollama",
      status: "error",
      origin,
      verifiedAt,
      models: [],
      error: { code: "OLLAMA_DISCOVERY_FAILED", message: "Ollama discovery failed." }
    };
  }
}
