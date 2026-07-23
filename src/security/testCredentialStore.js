import { AppError } from "../utils/errors.js";
import { credentialDefinitionById, testCredentialDefinitions } from "./credentialCatalog.js";

const KEYTAR_SERVICE_NAME = "ai-batch-personalizer";

async function loadKeytar() {
  try {
    const module = await import("keytar");
    return module.default ?? module;
  } catch {
    throw new AppError(
      "TEST_CREDENTIAL_STORE_UNAVAILABLE",
      "The operating-system credential store is unavailable in this environment.",
      503
    );
  }
}

function testDefinition(providerId) {
  const definition = credentialDefinitionById(providerId);
  if (!definition?.testCredentialId) {
    throw new AppError("TEST_CREDENTIAL_NOT_SUPPORTED", "This test credential is not supported.", 400);
  }
  return definition;
}

export function createOsTestCredentialStore({ keytarLoader = loadKeytar } = {}) {
  return {
    async get(providerId) {
      const definition = testDefinition(providerId);
      const keytar = await keytarLoader();
      return (await keytar.getPassword(KEYTAR_SERVICE_NAME, definition.testCredentialId)) ?? "";
    },

    async set(providerId, value) {
      const definition = testDefinition(providerId);
      const credential = String(value ?? "").trim();
      if (!credential) {
        throw new AppError(
          "TEST_CREDENTIAL_REQUIRED",
          `${definition.label} requires a non-empty rotated test credential.`,
          400
        );
      }
      const keytar = await keytarLoader();
      await keytar.setPassword(KEYTAR_SERVICE_NAME, definition.testCredentialId, credential);
      return { providerId, credentialId: definition.testCredentialId };
    },

    async remove(providerId) {
      const definition = testDefinition(providerId);
      const keytar = await keytarLoader();
      await keytar.deletePassword(KEYTAR_SERVICE_NAME, definition.testCredentialId);
      return { providerId, credentialId: definition.testCredentialId };
    },

    async list() {
      const keytar = await keytarLoader();
      const items = [];
      for (const definition of testCredentialDefinitions()) {
        const configured = Boolean(
          await keytar.getPassword(KEYTAR_SERVICE_NAME, definition.testCredentialId)
        );
        items.push({
          providerId: definition.id,
          label: definition.label,
          credentialId: definition.testCredentialId,
          configured
        });
      }
      return items;
    },

    async removeAll() {
      for (const definition of testCredentialDefinitions()) {
        await this.remove(definition.id);
      }
    }
  };
}

export { KEYTAR_SERVICE_NAME };
