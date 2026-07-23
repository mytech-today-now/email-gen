const AI_POWERED_PROVIDER_IDS = ["openai", "anthropic", "xai", "venice", "lumaai", "custom", "mock"];

function listFromEnv(name, fallback) {
  const raw = process.env[name];
  if (!raw) return [...fallback];
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function envString(...names) {
  for (const name of names) {
    const value = process.env[name];
    if (value !== undefined && value !== "") return value;
  }
  return "";
}

function model(id, label = id, capabilities = ["text", "structured"], extra = {}) {
  return { id, label, capabilities, ...extra };
}

function modelsFromEnv(name, fallback, defaultCapabilities = ["text", "structured"]) {
  const overrideIds = listFromEnv(
    name,
    fallback.map((item) => item.id)
  );
  const fallbackById = new Map(fallback.map((item) => [item.id, item]));
  return overrideIds.map((id) => fallbackById.get(id) ?? model(id, id, defaultCapabilities));
}

const OPENAI_MODELS = [
  model("gpt-5.6-sol", "GPT-5.6 Sol", ["text", "structured"], { current: true }),
  model("gpt-5.6", "GPT-5.6", ["text", "structured"], { current: true, aliasFor: "gpt-5.6-sol" }),
  model("gpt-5.6-terra", "GPT-5.6 Terra", ["text", "structured"], { current: true }),
  model("gpt-5.6-luna", "GPT-5.6 Luna", ["text", "structured"], { current: true }),
  model("gpt-5.5", "GPT-5.5", ["text", "structured"], { current: true }),
  model("gpt-5.5-pro", "GPT-5.5 Pro", ["text", "structured"], { current: true }),
  model("gpt-5.4", "GPT-5.4", ["text", "structured"], { current: true }),
  model("gpt-5.4-pro", "GPT-5.4 Pro", ["text", "structured"], { current: true }),
  model("gpt-5.4-mini", "GPT-5.4 Mini", ["text", "structured"], { current: true }),
  model("gpt-5.4-nano", "GPT-5.4 Nano", ["text", "structured"], { current: true }),
  model("gpt-5.3-codex", "GPT-5.3 Codex", ["text", "structured"], { current: true }),
  model("gpt-5.2", "GPT-5.2", ["text", "structured"], { current: true }),
  model("gpt-5.2-pro", "GPT-5.2 Pro", ["text", "structured"], { current: true }),
  model("gpt-5.1", "GPT-5.1", ["text", "structured"], { current: true }),
  model("gpt-5", "GPT-5", ["text", "structured"], { current: true }),
  model("gpt-5-mini", "GPT-5 Mini", ["text", "structured"], { current: true }),
  model("gpt-5-nano", "GPT-5 Nano", ["text", "structured"], { current: true }),
  model("gpt-5-pro", "GPT-5 Pro", ["text", "structured"], { current: true }),
  model("o3-pro", "o3-pro", ["text", "structured"], { current: true }),
  model("o3", "o3", ["text", "structured"], { current: true }),
  model("gpt-4.1", "GPT-4.1", ["text", "structured"], { current: true }),
  model("gpt-4.1-mini", "GPT-4.1 Mini", ["text", "structured"], { current: true }),
  model("gpt-4o-mini", "GPT-4o Mini", ["text", "structured"], { current: true }),
  model("gpt-4o", "GPT-4o", ["text", "structured"], { legacy: true }),
  model("o1", "o1", ["text"], { legacy: true }),
  model("o1-mini", "o1 Mini", ["text"], { legacy: true }),
  model("gpt-4-turbo", "GPT-4 Turbo", ["text", "structured"], { legacy: true }),
  model("gpt-3.5-turbo", "GPT-3.5 Turbo", ["text", "structured"], { legacy: true }),
  model("gpt-image-2", "GPT Image 2", ["image"], { current: true }),
  model("dall-e-3", "DALL-E 3", ["image"], { legacy: true }),
  model("dall-e-2", "DALL-E 2", ["image"], { legacy: true }),
  model("gpt-realtime-2.1", "GPT Realtime 2.1", ["audio", "text"], { current: true }),
  model("gpt-realtime-2.1-mini", "GPT Realtime 2.1 Mini", ["audio", "text"], { current: true }),
  model("gpt-realtime-2", "GPT Realtime 2", ["audio", "text"], { current: true }),
  model("gpt-realtime-translate", "GPT Realtime Translate", ["audio", "text"], { current: true }),
  model("gpt-realtime-whisper", "GPT Realtime Whisper", ["audio"], { current: true }),
  model("gpt-realtime-1.5", "GPT Realtime 1.5", ["audio", "text"], { current: true }),
  model("gpt-realtime", "GPT Realtime", ["audio", "text"], { current: true }),
  model("gpt-realtime-mini", "GPT Realtime Mini", ["audio", "text"], { current: true }),
  model("gpt-audio-1.5", "GPT Audio 1.5", ["audio", "text"], { current: true }),
  model("gpt-audio", "GPT Audio", ["audio", "text"], { current: true }),
  model("gpt-4o-transcribe", "GPT-4o Transcribe", ["audio"], { current: true }),
  model("gpt-4o-mini-transcribe", "GPT-4o Mini Transcribe", ["audio"], { current: true }),
  model("gpt-4o-transcribe-diarize", "GPT-4o Transcribe Diarize", ["audio"], { current: true }),
  model("whisper-1", "Whisper", ["audio"], { current: true }),
  model("tts-1", "TTS-1", ["audio"], { current: true }),
  model("tts-1-hd", "TTS-1 HD", ["audio"], { current: true })
];

const ANTHROPIC_MODELS = [
  model("claude-fable-5", "Claude Fable 5", ["text", "structured"], { current: true }),
  model("claude-opus-4-8", "Claude Opus 4.8", ["text", "structured"], { current: true }),
  model("claude-sonnet-5", "Claude Sonnet 5", ["text", "structured"], { current: true }),
  model("claude-haiku-4-5-20251001", "Claude Haiku 4.5", ["text", "structured"], {
    current: true
  }),
  model("claude-haiku-4-5", "Claude Haiku 4.5", ["text", "structured"], {
    current: true,
    aliasFor: "claude-haiku-4-5-20251001"
  }),
  model("claude-mythos-5", "Claude Mythos 5", ["text", "structured"], {
    current: true,
    limitedAvailability: true
  }),
  model("claude-mythos-preview", "Claude Mythos Preview", ["text", "structured"], {
    current: true,
    limitedAvailability: true
  }),
  model("claude-3-5-sonnet-20241022", "Claude 3.5 Sonnet", ["text", "structured"], {
    legacy: true
  }),
  model("claude-3-5-haiku-20241022", "Claude 3.5 Haiku", ["text", "structured"], {
    legacy: true
  }),
  model("claude-3-opus-20240229", "Claude 3 Opus", ["text", "structured"], { legacy: true }),
  model("claude-3-sonnet-20240229", "Claude 3 Sonnet", ["text", "structured"], {
    legacy: true
  }),
  model("claude-3-haiku-20240307", "Claude 3 Haiku", ["text", "structured"], { legacy: true })
];

const XAI_MODELS = [
  model("grok-4.5", "Grok 4.5", ["text", "structured"], { current: true }),
  model("grok-4.5-latest", "Grok 4.5 Latest", ["text", "structured"], { current: true }),
  model("grok-build-latest", "Grok Build Latest", ["text", "structured"], { current: true }),
  model("grok-build-0.1", "Grok Build 0.1", ["text", "structured"], { current: true }),
  model("grok-4.3", "Grok 4.3", ["text", "structured"], { current: true }),
  model("grok-4.3-latest", "Grok 4.3 Latest", ["text", "structured"], { current: true }),
  model("grok-latest", "Grok Latest", ["text", "structured"], { current: true }),
  model("grok-4.20-0309-reasoning", "Grok 4.20 Reasoning", ["text", "structured"], {
    current: true
  }),
  model("grok-4.20-0309-non-reasoning", "Grok 4.20 Non-Reasoning", ["text", "structured"], {
    current: true
  }),
  model("grok-2", "Grok 2", ["text", "structured"], { legacy: true }),
  model("grok-2-latest", "Grok 2 Latest", ["text", "structured"], { legacy: true }),
  model("grok-2-mini", "Grok 2 Mini", ["text", "structured"], { legacy: true }),
  model("grok-beta", "Grok Beta", ["text", "structured"], { legacy: true }),
  model("grok-vision-beta", "Grok Vision Beta", ["text", "structured"], { legacy: true })
];

const VENICE_MODELS = [
  model("llama-3.3-70b", "Llama 3.3 70B", ["text", "structured"], { dynamicFallback: true }),
  model("mistral-31-24b", "Mistral 3.1 24B", ["text", "structured"], {
    dynamicFallback: true
  }),
  model("qwen-2.5-vl", "Qwen 2.5 VL", ["text", "structured"], { dynamicFallback: true }),
  model("venice-uncensored", "venice-uncensored", ["text", "structured"], { dynamicFallback: true }),
  model("llama-3.2-3b", "Llama 3.2 3b", ["text", "structured"], { dynamicFallback: true }),
  model("venice-sd-3.5", "Venice SD 3.5", ["image"], { dynamicFallback: true }),
  model("fluently-xl", "Fluently XL", ["image"], { dynamicFallback: true })
];

const LUMAAI_MODELS = [
  model("ray-3.2", "Ray 3.2", ["video"], { current: true }),
  model("ray-2", "Ray 2", ["video"], { current: true }),
  model("ray-2-720p", "Ray 2 720p", ["video"], { current: true }),
  model("ray-flash-2", "Ray Flash 2", ["video"], { current: true }),
  model("ray-flash-2-720p", "Ray Flash 2 720p", ["video"], { current: true })
];

const MOCK_MODELS = [
  model("mock-text-v1", "Mock Text v1", ["text", "structured"]),
  model("mock-structured-v1", "Mock Structured v1", ["structured"]),
  model("mock-image-v1", "Mock Image v1", ["image"]),
  model("mock-whisper-v1", "Mock Whisper v1", ["audio"]),
  model("mock-tts-v1", "Mock TTS v1", ["audio"]),
  model("mock-video-v1", "Mock Video v1", ["video"])
];

function loadCustomModels() {
  const configuredModels = listFromEnv("ENABLED_CUSTOM_MODELS", []);
  const fallbackModel = envString("AI_CUSTOM_MODEL", "CUSTOM_PROVIDER_MODEL") || "custom-model";
  const ids = configuredModels.length ? configuredModels : [fallbackModel];
  const customType = envString("AI_CUSTOM_PROVIDER_TYPE", "CUSTOM_PROVIDER_TYPE") || "openai-compatible";
  const capabilities = customType === "other" ? ["text"] : ["text", "structured"];
  return ids.map((id) => model(id, id, capabilities));
}

function enabledProviderIds() {
  return listFromEnv("ENABLED_AI_PROVIDERS", AI_POWERED_PROVIDER_IDS);
}

export function loadProviderConfig(appConfig) {
  const enabledProviders = enabledProviderIds();
  const customBaseUrl = envString("AI_CUSTOM_BASE_URL", "CUSTOM_PROVIDER_BASE_URL");
  const customProviderType =
    envString("AI_CUSTOM_PROVIDER_TYPE", "CUSTOM_PROVIDER_TYPE") || "openai-compatible";

  const providers = {
    openai: {
      id: "openai",
      label: "OpenAI",
      enabled: enabledProviders.includes("openai"),
      credentialId: "openai",
      models: modelsFromEnv("ENABLED_OPENAI_MODELS", OPENAI_MODELS)
    },
    anthropic: {
      id: "anthropic",
      label: "Anthropic Claude",
      enabled: enabledProviders.includes("anthropic"),
      credentialId: "anthropic",
      models: modelsFromEnv("ENABLED_ANTHROPIC_MODELS", ANTHROPIC_MODELS)
    },
    xai: {
      id: "xai",
      label: "xAI Grok",
      enabled: enabledProviders.includes("xai"),
      credentialId: "xai",
      models: modelsFromEnv("ENABLED_XAI_MODELS", XAI_MODELS)
    },
    venice: {
      id: "venice",
      label: "Venice.ai",
      enabled: enabledProviders.includes("venice"),
      credentialId: "venice",
      supportsDynamicModels: true,
      models: modelsFromEnv("ENABLED_VENICE_MODELS", VENICE_MODELS)
    },
    lumaai: {
      id: "lumaai",
      label: "Luma AI",
      enabled: enabledProviders.includes("lumaai"),
      credentialId: "lumaai",
      models: modelsFromEnv("ENABLED_LUMAAI_MODELS", LUMAAI_MODELS, ["video"])
    },
    custom: {
      id: "custom",
      label: customProviderType === "ollama" ? "Custom/Ollama" : "Custom provider",
      enabled: enabledProviders.includes("custom"),
      credentialId: "custom",
      requiresBaseUrl: customProviderType !== "ollama",
      baseUrlConfigured: Boolean(customBaseUrl),
      customProviderType,
      supportsDynamicModels: true,
      models: loadCustomModels()
    },
    mock: {
      id: "mock",
      label: "Mock provider",
      enabled: enabledProviders.includes("mock") || process.env.NODE_ENV === "test",
      credentialId: "mock",
      models: modelsFromEnv("ENABLED_MOCK_MODELS", MOCK_MODELS)
    }
  };

  if (!providers[appConfig.ai.defaultProvider]?.enabled) {
    throw new Error(`Default provider '${appConfig.ai.defaultProvider}' is not enabled.`);
  }

  return Object.freeze({
    defaultProvider: appConfig.ai.defaultProvider,
    defaultModel: appConfig.ai.defaultModel,
    providers
  });
}

export function publicProviderConfig(providerConfig, runtimeCredentials = null) {
  return {
    defaultProvider: providerConfig.defaultProvider,
    defaultModel: providerConfig.defaultModel,
    providers: Object.values(providerConfig.providers)
      .filter((provider) => provider.enabled)
      .map((provider) => ({
        id: provider.id,
        label: provider.label,
        credentialStatus:
          runtimeCredentials?.publicState(provider.credentialId)?.status ??
          (provider.id === "mock" ? "valid" : "not-configured"),
        hasCredential:
          provider.id === "mock"
            ? true
            : Boolean(runtimeCredentials?.publicState(provider.credentialId)?.configured),
        requiresBaseUrl: Boolean(provider.requiresBaseUrl),
        baseUrlConfigured: Boolean(provider.baseUrlConfigured),
        customProviderType: provider.customProviderType,
        supportsDynamicModels: Boolean(provider.supportsDynamicModels),
        models: provider.models
      }))
  };
}
