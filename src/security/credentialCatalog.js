const RUNTIME_CREDENTIAL_DEFINITIONS = [
  {
    id: "openai",
    label: "OpenAI",
    secretName: "OPENAI_API_KEY",
    category: "provider",
    testCredentialId: "email-gen-e2e-openai",
    testEnvVar: "EMAIL_GEN_E2E_OPENAI_API_KEY"
  },
  {
    id: "anthropic",
    label: "Anthropic",
    secretName: "ANTHROPIC_API_KEY",
    category: "provider",
    testCredentialId: "email-gen-e2e-anthropic",
    testEnvVar: "EMAIL_GEN_E2E_ANTHROPIC_API_KEY"
  },
  {
    id: "xai",
    label: "xAI",
    secretName: "XAI_API_KEY",
    category: "provider",
    testCredentialId: "email-gen-e2e-xai",
    testEnvVar: "EMAIL_GEN_E2E_XAI_API_KEY"
  },
  {
    id: "venice",
    label: "Venice",
    secretName: "VENICE_API_KEY",
    category: "provider",
    testCredentialId: "email-gen-e2e-venice",
    testEnvVar: "EMAIL_GEN_E2E_VENICE_API_KEY"
  },
  {
    id: "lumaai",
    label: "Luma AI",
    secretName: "LUMAAI_API_KEY",
    category: "provider",
    testCredentialId: "email-gen-e2e-lumaai",
    testEnvVar: "EMAIL_GEN_E2E_LUMAAI_API_KEY"
  },
  {
    id: "custom",
    label: "Custom OpenAI-compatible",
    secretName: "AI_CUSTOM_API_KEY",
    category: "provider",
    optional: true,
    testCredentialId: "email-gen-e2e-custom",
    testEnvVar: "EMAIL_GEN_E2E_CUSTOM_API_KEY"
  },
  {
    id: "mock",
    label: "Mock provider",
    secretName: null,
    category: "provider",
    optional: true
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    secretName: "OPENROUTER_API_KEY",
    category: "integration",
    optional: true
  },
  {
    id: "brave-search",
    label: "Brave Search",
    secretName: "BRAVE_SEARCH_API_KEY",
    category: "integration",
    optional: true
  },
  {
    id: "resend",
    label: "Resend",
    secretName: "RESEND_API_KEY",
    category: "integration",
    optional: true
  },
  {
    id: "resend-webhook",
    label: "Resend Webhook Secret",
    secretName: "RESEND_WEBHOOK_SECRET",
    category: "integration",
    optional: true
  }
];

const BY_ID = new Map(RUNTIME_CREDENTIAL_DEFINITIONS.map((definition) => [definition.id, definition]));
const BY_SECRET_NAME = new Map(
  RUNTIME_CREDENTIAL_DEFINITIONS.filter((definition) => definition.secretName).map((definition) => [
    definition.secretName,
    definition
  ])
);

export const runtimeCredentialDefinitions = Object.freeze(
  RUNTIME_CREDENTIAL_DEFINITIONS.map((definition) => Object.freeze({ ...definition }))
);

export function credentialDefinitionById(id) {
  return BY_ID.get(String(id ?? "").trim()) ?? null;
}

export function credentialDefinitionBySecretName(secretName) {
  return BY_SECRET_NAME.get(String(secretName ?? "").trim()) ?? null;
}

export function providerCredentialDefinition(providerId) {
  const definition = credentialDefinitionById(providerId);
  return definition?.category === "provider" ? definition : null;
}

export function requiredProviderCredentialDefinition(providerId) {
  const definition = providerCredentialDefinition(providerId);
  return definition && !definition.optional ? definition : null;
}

export function testCredentialDefinitions() {
  return runtimeCredentialDefinitions.filter((definition) => definition.testCredentialId);
}

export function supportedTestCredentialProviderIds() {
  return testCredentialDefinitions().map((definition) => definition.id);
}
