import { AppError } from "../utils/errors.js";
import { credentialDefinitionById } from "./credentialCatalog.js";
import { createOsTestCredentialStore } from "./testCredentialStore.js";

export async function resolveTestCredential(
  providerId,
  { env = process.env, store = createOsTestCredentialStore() } = {}
) {
  const definition = credentialDefinitionById(providerId);
  if (!definition?.testCredentialId) {
    throw new AppError("TEST_CREDENTIAL_NOT_SUPPORTED", "This test credential is not supported.", 400);
  }

  const envValue = String(env[definition.testEnvVar] ?? "").trim();
  if (envValue) {
    return {
      available: true,
      source: "env",
      credentialId: definition.testCredentialId,
      providerId,
      value: envValue
    };
  }

  const stored = String((await store.get(providerId)) ?? "").trim();
  if (stored) {
    return {
      available: true,
      source: "os-credential-store",
      credentialId: definition.testCredentialId,
      providerId,
      value: stored
    };
  }

  return {
    available: false,
    source: "unavailable",
    credentialId: definition.testCredentialId,
    providerId,
    value: ""
  };
}
