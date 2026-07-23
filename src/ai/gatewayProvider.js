import { AppError, createShutdownError } from "../utils/errors.js";
import { OPENROUTER_BASE_URL, validateOllamaOrigin } from "./modelCatalog/runtimeDiscovery.js";
import { credentialDefinitionById } from "../security/credentialCatalog.js";
import { parseStructuredEmailContent, structuredEmailJsonSchema } from "./structuredEmail.js";
import { readBoundedResponseText } from "../utils/responseBodies.js";

const COMPATIBLE_BASES = {
  openai: "https://api.openai.com/v1",
  xai: "https://api.x.ai/v1",
  venice: "https://api.venice.ai/api/v1"
};

const JSON_CONTENT_TYPES = ["application/json", "application/*+json", "text/json"];

function envString(...names) {
  for (const name of names) {
    const value = process.env[name];
    if (value !== undefined && value !== "") return value;
  }
  return "";
}

function resolvedCredential(provider, runtimeCredentials) {
  const definition = credentialDefinitionById(provider);
  if (!definition?.secretName) return "";
  return runtimeCredentials?.get(definition.secretName) || "";
}

function customHeadersFromEnv() {
  const raw = envString("AI_CUSTOM_HEADERS", "CUSTOM_PROVIDER_HEADERS");
  if (!raw) return {};
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new AppError("CUSTOM_PROVIDER_HEADERS_INVALID", "Custom provider headers must be valid JSON.", 500);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new AppError(
      "CUSTOM_PROVIDER_HEADERS_INVALID",
      "Custom provider headers must be a JSON object.",
      500
    );
  }
  return Object.fromEntries(Object.entries(parsed).map(([key, value]) => [key, String(value)]));
}

function openAiTokenLimitField(provider, maxTokens) {
  return provider === "openai" ? { max_completion_tokens: maxTokens } : { max_tokens: maxTokens };
}

function composeRequestSignal(signal, timeoutMs) {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  if (!signal) return timeoutSignal;
  if (typeof AbortSignal.any === "function") return AbortSignal.any([signal, timeoutSignal]);
  const controller = new AbortController();
  const abort = (reason) => {
    if (controller.signal.aborted) return;
    controller.abort(reason);
  };
  if (signal.aborted) {
    abort(signal.reason);
    return controller.signal;
  }
  signal.addEventListener("abort", () => abort(signal.reason), { once: true });
  timeoutSignal.addEventListener("abort", () => abort(timeoutSignal.reason), { once: true });
  return controller.signal;
}

async function requestJson(
  url,
  {
    headers = {},
    body,
    timeoutMs = 60_000,
    responseDeadlineMs = timeoutMs,
    responseIdleTimeoutMs = 15_000,
    fetchImpl = fetch,
    maxResponseBytes = 500000,
    signal = null
  } = {}
) {
  let response;
  try {
    const requestSignal = composeRequestSignal(signal, timeoutMs);
    response = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: requestSignal
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    const timedOut = error?.name === "AbortError" || error?.name === "TimeoutError";
    if (signal?.aborted) {
      throw signal.reason instanceof Error ? signal.reason : createShutdownError();
    }
    throw new AppError(
      timedOut ? "PROVIDER_TIMEOUT" : "PROVIDER_REQUEST_FAILED",
      timedOut
        ? "Provider request timed out."
        : error?.message || "Provider request failed before a response was received.",
      502
    );
  }
  const { text } = await readBoundedResponseText(
    response,
    response.ok
      ? {
          maxBytes: maxResponseBytes,
          expectedContentTypes: JSON_CONTENT_TYPES,
          deadlineMs: responseDeadlineMs,
          idleTimeoutMs: responseIdleTimeoutMs,
          code: "PROVIDER_RESPONSE_TOO_LARGE",
          message: "Provider response exceeded the configured size limit.",
          status: response.status
        }
      : {
          maxBytes: maxResponseBytes,
          deadlineMs: responseDeadlineMs,
          idleTimeoutMs: responseIdleTimeoutMs,
          code: "PROVIDER_RESPONSE_TOO_LARGE",
          message: "Provider response exceeded the configured size limit.",
          status: response.status
        }
  );
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    if (!response.ok) {
      payload = {};
    } else {
      throw new AppError("PROVIDER_RESPONSE_INVALID", "Provider response returned malformed JSON.", 502);
    }
  }
  if (!response.ok) {
    const error = new AppError(
      response.status === 429 ? "PROVIDER_RATE_LIMITED" : "PROVIDER_REQUEST_FAILED",
      payload.error?.message || `Provider request returned HTTP ${response.status}.`,
      response.status === 429 ? 429 : 502
    );
    error.retryAfter = response.headers.get("retry-after");
    throw error;
  }
  return { payload, headers: response.headers };
}

function mockResponse(record) {
  const name = record.displayName || record.normalized?.name || "your business";
  return {
    subject: `A practical AI SMS idea for ${name}`,
    bodyHtml: `<p>Dear ${name} Owner and the General Manager,</p><p>A simple AI SMS workflow could answer routine guest questions, capture missed opportunities, and reduce interruptions during service.</p><p>Would a quick demo be useful?</p>`,
    usage: { inputTokens: 0, outputTokens: 0, costUsd: 0, estimated: false }
  };
}

function customProviderBase(value, confirmed) {
  if (!confirmed)
    throw new AppError(
      "CUSTOM_PROVIDER_CONFIRMATION_REQUIRED",
      "Explicitly confirm the custom provider endpoint before use.",
      400
    );
  let url;
  try {
    url = new URL(String(value || ""));
  } catch {
    throw new AppError("CUSTOM_PROVIDER_URL_INVALID", "Custom provider base URL is invalid.", 400);
  }
  if (url.username || url.password || url.search || url.hash || !["http:", "https:"].includes(url.protocol)) {
    throw new AppError(
      "CUSTOM_PROVIDER_URL_INVALID",
      "Custom provider URL must be a clean HTTP(S) origin and path.",
      400
    );
  }
  const loopback = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !loopback)
    throw new AppError("CUSTOM_PROVIDER_HTTPS_REQUIRED", "Remote custom providers must use HTTPS.", 400);
  return url.toString().replace(/\/$/, "");
}

export async function generateGatewayEmail({
  provider,
  model,
  prompt,
  record,
  options = {},
  config,
  runtimeCredentials,
  fetchImpl = fetch,
  signal = null
}) {
  if (provider === "mock" || process.env.AI_MOCK === "true") return mockResponse(record);

  if (provider === "ollama") {
    const origin = validateOllamaOrigin(options.ollamaHost, {
      confirmedCustomHost: Boolean(options.confirmedCustomOllamaHost)
    });
    const { payload } = await requestJson(`${origin}/api/chat`, {
      fetchImpl,
      maxResponseBytes: config.limits.providerResponseBytes,
      timeoutMs: config.ai.timeoutMs,
      body: {
        model,
        stream: false,
        format: structuredEmailJsonSchema,
        options: { temperature: options.temperature ?? config.ai.temperature },
        messages: [
          {
            role: "user",
            content: `${prompt}\n\nReturn JSON matching this schema: ${JSON.stringify(structuredEmailJsonSchema)}`
          }
        ]
      }
    });
    const parsed = parseStructuredEmailContent(payload.message?.content);
    return {
      ...parsed,
      usage: {
        inputTokens: payload.prompt_eval_count ?? null,
        outputTokens: payload.eval_count ?? null,
        costUsd: null,
        estimated: false
      }
    };
  }

  if (provider === "openrouter") {
    const key = resolvedCredential("openrouter", runtimeCredentials);
    if (!key)
      throw new AppError(
        "PROVIDER_CREDENTIAL_MISSING",
        "OpenRouter is not configured. Open Configuration to save its credential.",
        401
      );
    const { payload } = await requestJson(`${OPENROUTER_BASE_URL}/chat/completions`, {
      fetchImpl,
      maxResponseBytes: config.limits.providerResponseBytes,
      timeoutMs: config.ai.timeoutMs,
      responseDeadlineMs: config.limits.responseDeadlineMs,
      responseIdleTimeoutMs: config.limits.responseIdleTimeoutMs,
      signal,
      headers: {
        authorization: `Bearer ${key}`,
        ...(options.httpReferer ? { "HTTP-Referer": options.httpReferer } : {}),
        "X-OpenRouter-Title": "AI Batch Personalizer"
      },
      body: {
        model,
        messages: [{ role: "user", content: prompt }],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "personalized_email",
            strict: true,
            schema: structuredEmailJsonSchema
          }
        },
        temperature: options.temperature ?? config.ai.temperature,
        max_tokens: config.ai.maxTokens,
        ...(options.routing ? { provider: options.routing } : {})
      }
    });
    const parsed = parseStructuredEmailContent(payload.choices?.[0]?.message?.content);
    return {
      ...parsed,
      providerRequestId: payload.id ?? null,
      usage: {
        inputTokens: payload.usage?.prompt_tokens ?? null,
        outputTokens: payload.usage?.completion_tokens ?? null,
        costUsd: payload.usage?.cost ?? null,
        estimated: false
      }
    };
  }

  const suppliedCredential = resolvedCredential(provider, runtimeCredentials);
  const configuredCustomBaseUrl =
    options.customBaseUrl || envString("AI_CUSTOM_BASE_URL", "CUSTOM_PROVIDER_BASE_URL");

  if (provider === "custom") {
    if (!configuredCustomBaseUrl) {
      throw new AppError(
        "CUSTOM_PROVIDER_BASE_URL_REQUIRED",
        "Custom provider requires a configured base URL.",
        400
      );
    }
    const base = customProviderBase(
      configuredCustomBaseUrl,
      options.customBaseUrl ? options.confirmedCustomProviderHost : true
    );
    const endpoint = `${base}/chat/completions`;
    const { payload } = await requestJson(endpoint, {
      fetchImpl,
      maxResponseBytes: config.limits.providerResponseBytes,
      timeoutMs: config.ai.timeoutMs,
      responseDeadlineMs: config.limits.responseDeadlineMs,
      responseIdleTimeoutMs: config.limits.responseIdleTimeoutMs,
      signal,
      headers: {
        ...customHeadersFromEnv(),
        ...(suppliedCredential ? { authorization: `Bearer ${suppliedCredential}` } : {})
      },
      body: {
        model,
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
        temperature: options.temperature ?? config.ai.temperature,
        max_tokens: config.ai.maxTokens
      }
    });
    return {
      ...parseStructuredEmailContent(payload.choices?.[0]?.message?.content),
      usage: payload.usage ?? null
    };
  }

  if (COMPATIBLE_BASES[provider]) {
    if (!suppliedCredential) {
      throw new AppError(
        "PROVIDER_CREDENTIAL_MISSING",
        "Selected provider is not configured. Open Configuration to save its credential.",
        401
      );
    }
    const { payload } = await requestJson(`${COMPATIBLE_BASES[provider]}/chat/completions`, {
      fetchImpl,
      maxResponseBytes: config.limits.providerResponseBytes,
      timeoutMs: config.ai.timeoutMs,
      responseDeadlineMs: config.limits.responseDeadlineMs,
      responseIdleTimeoutMs: config.limits.responseIdleTimeoutMs,
      signal,
      headers: { authorization: `Bearer ${suppliedCredential}` },
      body: {
        model,
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
        temperature: options.temperature ?? config.ai.temperature,
        ...openAiTokenLimitField(provider, config.ai.maxTokens)
      }
    });
    return {
      ...parseStructuredEmailContent(payload.choices?.[0]?.message?.content),
      usage: payload.usage ?? null
    };
  }

  if (provider === "anthropic") {
    if (!suppliedCredential) {
      throw new AppError(
        "PROVIDER_CREDENTIAL_MISSING",
        "Anthropic is not configured. Open Configuration to save its credential.",
        401
      );
    }
    const { payload } = await requestJson("https://api.anthropic.com/v1/messages", {
      fetchImpl,
      maxResponseBytes: config.limits.providerResponseBytes,
      timeoutMs: config.ai.timeoutMs,
      responseDeadlineMs: config.limits.responseDeadlineMs,
      responseIdleTimeoutMs: config.limits.responseIdleTimeoutMs,
      signal,
      headers: {
        "x-api-key": suppliedCredential,
        "anthropic-version": "2023-06-01"
      },
      body: {
        model,
        max_tokens: config.ai.maxTokens,
        temperature: options.temperature ?? config.ai.temperature,
        messages: [
          {
            role: "user",
            content: `${prompt}\n\nReturn only JSON matching this schema: ${JSON.stringify(structuredEmailJsonSchema)}`
          }
        ]
      }
    });
    const content = (payload.content ?? [])
      .filter((item) => item.type === "text")
      .map((item) => item.text)
      .join("\n");
    return {
      ...parseStructuredEmailContent(content),
      providerRequestId: payload.id ?? null,
      usage: {
        inputTokens: payload.usage?.input_tokens ?? null,
        outputTokens: payload.usage?.output_tokens ?? null,
        costUsd: null,
        estimated: false
      }
    };
  }

  throw new AppError(
    "BROWSER_CREDENTIAL_PROVIDER_UNSUPPORTED",
    "This provider is not available through the runtime credential manager.",
    400
  );
}
