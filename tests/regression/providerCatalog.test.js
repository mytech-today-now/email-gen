import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadAppConfig } from "../../config/app.config.js";
import { loadProviderConfig, publicProviderConfig } from "../../config/providers.config.js";
import { createProviderRegistry } from "../../src/ai/providerRegistry.js";

const envKeys = [
  "AI_MOCK",
  "ENABLED_AI_PROVIDERS",
  "ENABLED_OPENAI_MODELS",
  "ENABLED_ANTHROPIC_MODELS",
  "ENABLED_XAI_MODELS",
  "ENABLED_VENICE_MODELS",
  "ENABLED_LUMAAI_MODELS",
  "ENABLED_CUSTOM_MODELS",
  "ENABLED_MOCK_MODELS",
  "CUSTOM_PROVIDER_BASE_URL",
  "AI_CUSTOM_PROVIDER_TYPE",
  "OPENAI_API_KEY"
];
const allProviders = "openai,anthropic,xai,venice,lumaai,custom,mock";
let previousEnv;

function providerConfig() {
  const base = loadAppConfig();
  const config = loadAppConfig({
    ai: {
      ...base.ai,
      defaultProvider: "mock",
      defaultModel: "mock-structured-v1"
    }
  });
  return loadProviderConfig(config);
}

function modelIds(provider) {
  return provider.models.map((item) => item.id);
}

beforeEach(() => {
  previousEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  process.env.AI_MOCK = "true";
  process.env.ENABLED_AI_PROVIDERS = allProviders;
  process.env.CUSTOM_PROVIDER_BASE_URL = "http://127.0.0.1:9999/v1";
  process.env.OPENAI_API_KEY = "sk-regression-secret";
  for (const key of envKeys.filter(
    (item) => item.startsWith("ENABLED_") && item !== "ENABLED_AI_PROVIDERS"
  )) {
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of envKeys) {
    if (previousEnv[key] === undefined) delete process.env[key];
    else process.env[key] = previousEnv[key];
  }
});

describe("provider catalog regressions", () => {
  it("enables every provider registered by ai-powered", () => {
    const config = providerConfig();
    expect(
      Object.values(config.providers)
        .filter((provider) => provider.enabled)
        .map((provider) => provider.id)
    ).toEqual(["openai", "anthropic", "xai", "venice", "lumaai", "custom", "mock"]);
  });

  it("includes current and ai-powered fallback models for every provider", () => {
    const { providers } = providerConfig();

    expect(modelIds(providers.openai)).toEqual(
      expect.arrayContaining(["gpt-5.6-sol", "gpt-5.6-terra", "gpt-image-2", "gpt-realtime-2.1"])
    );
    expect(modelIds(providers.anthropic)).toEqual(
      expect.arrayContaining(["claude-fable-5", "claude-opus-4-8", "claude-sonnet-5"])
    );
    expect(modelIds(providers.xai)).toEqual(
      expect.arrayContaining(["grok-4.5", "grok-build-0.1", "grok-2-latest"])
    );
    expect(modelIds(providers.venice)).toEqual(expect.arrayContaining(["llama-3.3-70b", "fluently-xl"]));
    expect(modelIds(providers.lumaai)).toEqual(
      expect.arrayContaining(["ray-3.2", "ray-2", "ray-2-720p", "ray-flash-2", "ray-flash-2-720p"])
    );
    expect(modelIds(providers.custom)).toEqual(["custom-model"]);
    expect(modelIds(providers.mock)).toEqual(
      expect.arrayContaining(["mock-structured-v1", "mock-image-v1", "mock-video-v1"])
    );
  });

  it("does not leak API key values through public provider config", () => {
    const publicConfig = publicProviderConfig(providerConfig());
    expect(JSON.stringify(publicConfig)).not.toContain("sk-regression-secret");
    expect(publicConfig.providers.find((provider) => provider.id === "openai")).toMatchObject({
      apiKeyEnv: "OPENAI_API_KEY",
      hasCredential: true
    });
  });

  it("rejects models that cannot return structured email output", () => {
    const registry = createProviderRegistry(providerConfig());
    expect(() => registry.validate("lumaai", "ray-2")).toThrow(/structured email generation/);
    expect(() => registry.validate("openai", "gpt-image-2")).toThrow(/structured email generation/);
    expect(registry.validate("anthropic", "claude-fable-5").model.id).toBe("claude-fable-5");
    expect(registry.validate("xai", "grok-4.5").model.id).toBe("grok-4.5");
  });

  it("honors provider and model allowlists without losing fallback metadata", () => {
    process.env.ENABLED_AI_PROVIDERS = "openai,mock";
    process.env.ENABLED_OPENAI_MODELS = "gpt-5.6-sol,my-openai-compatible-model";
    const config = providerConfig();
    expect(
      Object.values(config.providers)
        .filter((provider) => provider.enabled)
        .map((provider) => provider.id)
    ).toEqual(["openai", "mock"]);
    expect(config.providers.openai.models).toEqual([
      expect.objectContaining({ id: "gpt-5.6-sol", capabilities: ["text", "structured"] }),
      expect.objectContaining({ id: "my-openai-compatible-model", capabilities: ["text", "structured"] })
    ]);
  });
});
