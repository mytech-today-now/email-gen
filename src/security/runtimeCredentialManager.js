import { AppError } from "../utils/errors.js";
import {
  credentialDefinitionById,
  credentialDefinitionBySecretName,
  runtimeCredentialDefinitions
} from "./credentialCatalog.js";

function now(clock) {
  return new clock(Date.now()).toISOString();
}

function trimCredential(value) {
  return String(value ?? "")
    .trim()
    .slice(0, 4096);
}

function resolveDefinition(identifier) {
  return credentialDefinitionById(identifier) ?? credentialDefinitionBySecretName(identifier);
}

function publicState(definition, state) {
  return {
    id: definition.id,
    label: definition.label,
    category: definition.category,
    configured: Boolean(state?.configured),
    status: state?.status ?? "not-configured",
    updatedAt: state?.updatedAt ?? null,
    lastValidatedAt: state?.lastValidatedAt ?? null,
    validationCode: state?.validationCode ?? null
  };
}

export function createRuntimeCredentialManager({ clock = Date } = {}) {
  const secrets = new Map();
  const states = new Map(
    runtimeCredentialDefinitions.map((definition) => [
      definition.id,
      {
        configured: false,
        status: "not-configured",
        updatedAt: null,
        lastValidatedAt: null,
        validationCode: null
      }
    ])
  );

  function stateFor(definition) {
    return states.get(definition.id);
  }

  function setState(definition, next) {
    states.set(definition.id, { ...stateFor(definition), ...next });
  }

  return {
    definitions() {
      return runtimeCredentialDefinitions;
    },

    has(identifier) {
      const definition = resolveDefinition(identifier);
      return definition?.secretName ? secrets.has(definition.secretName) : false;
    },

    get(identifier, { required = false } = {}) {
      const definition = resolveDefinition(identifier);
      if (!definition?.secretName) {
        if (required) {
          throw new AppError("CREDENTIAL_NOT_SUPPORTED", "This credential is not supported.", 400);
        }
        return "";
      }
      const value = secrets.get(definition.secretName) ?? "";
      if (!value && required) {
        const message =
          definition.category === "provider"
            ? `Configure ${definition.label} in Configuration before continuing.`
            : `Configure ${definition.label} in Configuration before continuing.`;
        throw new AppError("PROVIDER_CREDENTIAL_MISSING", message, 400, {
          providerId: definition.id
        });
      }
      return value;
    },

    set(identifier, value) {
      const definition = resolveDefinition(identifier);
      if (!definition?.secretName)
        throw new AppError("CREDENTIAL_NOT_SUPPORTED", "This credential is not supported.", 400);
      const credential = trimCredential(value);
      if (!credential) {
        throw new AppError(
          "CREDENTIAL_REQUIRED",
          `${definition.label} requires a non-empty credential.`,
          400
        );
      }
      secrets.set(definition.secretName, credential);
      setState(definition, {
        configured: true,
        status: "configured",
        updatedAt: now(clock),
        validationCode: null
      });
      return publicState(definition, stateFor(definition));
    },

    clear(identifier) {
      const definition = resolveDefinition(identifier);
      if (!definition?.secretName)
        throw new AppError("CREDENTIAL_NOT_SUPPORTED", "This credential is not supported.", 400);
      secrets.delete(definition.secretName);
      setState(definition, {
        configured: false,
        status: "not-configured",
        updatedAt: now(clock),
        lastValidatedAt: null,
        validationCode: null
      });
      return publicState(definition, stateFor(definition));
    },

    clearAll() {
      secrets.clear();
      for (const definition of runtimeCredentialDefinitions) {
        if (!definition.secretName) continue;
        setState(definition, {
          configured: false,
          status: "not-configured",
          updatedAt: now(clock),
          lastValidatedAt: null,
          validationCode: null
        });
      }
    },

    markValidation(identifier, { ok, code = null } = {}) {
      const definition = resolveDefinition(identifier);
      if (!definition) return null;
      const configured = this.has(definition.id);
      setState(definition, {
        configured,
        status: configured ? (ok ? "valid" : "validation-failed") : "not-configured",
        lastValidatedAt: now(clock),
        validationCode: code
      });
      return publicState(definition, stateFor(definition));
    },

    publicState(identifier) {
      const definition = resolveDefinition(identifier);
      return definition ? publicState(definition, stateFor(definition)) : null;
    },

    publicStates({ category = null } = {}) {
      return runtimeCredentialDefinitions
        .filter((definition) => !category || definition.category === category)
        .map((definition) => publicState(definition, stateFor(definition)));
    }
  };
}
