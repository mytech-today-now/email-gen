import { AiClient, createProvider, createPromptShieldPlugin } from "ai-powered";

const API_KEY_ENV_BY_PROVIDER = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  xai: "XAI_API_KEY",
  venice: "VENICE_API_KEY",
  lumaai: "LUMAAI_API_KEY",
  custom: "AI_CUSTOM_API_KEY"
};

function envString(...names) {
  for (const name of names) {
    const value = process.env[name];
    if (value !== undefined && value !== "") return value;
  }
  return undefined;
}

function customHeadersFromEnv() {
  const raw = envString("AI_CUSTOM_HEADERS", "CUSTOM_PROVIDER_HEADERS");
  if (!raw) return undefined;
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Custom provider headers must be a JSON object.");
  }
  return Object.fromEntries(Object.entries(parsed).map(([key, value]) => [key, String(value)]));
}

export async function createAiPoweredClient({ provider, model, config }) {
  const mock = provider === "mock" || process.env.AI_MOCK === "true";
  const apiKeyEnv = API_KEY_ENV_BY_PROVIDER[provider];
  const apiKey = apiKeyEnv ? process.env[apiKeyEnv] : undefined;
  const customProviderType =
    envString("AI_CUSTOM_PROVIDER_TYPE", "CUSTOM_PROVIDER_TYPE") || "openai-compatible";
  const aiConfig = {
    modality: "structured",
    provider: mock ? "mock" : provider,
    model,
    apiKey,
    baseUrl: provider === "custom" ? envString("AI_CUSTOM_BASE_URL", "CUSTOM_PROVIDER_BASE_URL") : undefined,
    customProviderType,
    customHeaders: provider === "custom" ? customHeadersFromEnv() : undefined,
    mock,
    temperature: config.ai.temperature,
    maxTokens: config.ai.maxTokens,
    stream: false,
    profile: "default",
    fallbackProviders: [],
    fallback: false,
    budgetSession: undefined,
    warnBudget: 0.8,
    plugins: [],
    templateDirs: [],
    circuitBreakerThreshold: 3,
    circuitBreakerResetMs: 60_000,
    debug: config.logLevel === "debug" || config.logLevel === "trace"
  };
  return new AiClient(aiConfig, createProvider(aiConfig), [createPromptShieldPlugin()]);
}
