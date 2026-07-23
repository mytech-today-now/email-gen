import { LIMIT_PROFILE_VERSION } from "./limits.js";

export const VERSIONS = Object.freeze({
  application: "2.0.0",
  browserSchema: 5,
  backupFormat: 1,
  migration: 1,
  walkthrough: 2,
  limitProfile: LIMIT_PROFILE_VERSION
});

export const STORE_DEFINITIONS = Object.freeze({
  meta: { keyPath: "key" },
  projects: { keyPath: "id", indexes: { updatedAt: "updatedAt" } },
  records: {
    keyPath: "id",
    indexes: {
      projectId: "projectId",
      status: "status",
      updatedAt: "updatedAt",
      contactLookup: "contactLookup"
    }
  },
  templates: { keyPath: "id", indexes: { name: "name", source: "source", updatedAt: "updatedAt" } },
  templateVersions: { keyPath: "id", indexes: { templateId: "templateId", createdAt: "createdAt" } },
  addenda: { keyPath: "id", indexes: { name: "name", source: "source", updatedAt: "updatedAt" } },
  results: {
    keyPath: "id",
    indexes: {
      projectId: "projectId",
      recordId: "recordId",
      status: "status",
      updatedAt: "updatedAt",
      trashed: "trashed"
    }
  },
  resultVersions: { keyPath: "id", indexes: { resultId: "resultId", createdAt: "createdAt" } },
  jobs: { keyPath: "id", indexes: { projectId: "projectId", status: "status", updatedAt: "updatedAt" } },
  operations: {
    keyPath: "scopeKey",
    indexes: {
      kind: "kind",
      status: "status",
      operationId: "operationId",
      updatedAt: "updatedAt",
      leaseExpiresAt: "leaseExpiresAt"
    }
  },
  researchCache: { keyPath: "url", indexes: { expiresAt: "expiresAt" } },
  contacts: { keyPath: "id", indexes: { projectId: "projectId", value: "value" } },
  modelCatalog: {
    keyPath: "id",
    indexes: { providerId: "providerId", availability: "availability", favorite: "favorite" }
  },
  providerStatus: { keyPath: "providerId", indexes: { updatedAt: "updatedAt" } },
  settings: { keyPath: "key" },
  deliveryHistory: {
    keyPath: "id",
    indexes: { resultId: "resultId", status: "status", updatedAt: "updatedAt" }
  },
  suppressions: { keyPath: "email", indexes: { updatedAt: "updatedAt" } },
  artifacts: { keyPath: "id", indexes: { projectId: "projectId", updatedAt: "updatedAt" } },
  logs: { keyPath: "id", indexes: { timestamp: "timestamp", event: "event" } }
});

export function makeId(prefix = "id") {
  return `${prefix}_${crypto.randomUUID()}`;
}

export function nowIso() {
  return new Date().toISOString();
}
