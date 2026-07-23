import { STORE_DEFINITIONS, VERSIONS } from "./constants.js";
import { LIMIT_DEFAULTS, utf8ByteLength } from "./limits.js";

const z = typeof window !== "undefined" ? (await import("/vendor/zod/index.js")).z : (await import("zod")).z;

const BACKUP_FORMAT = "ai-batch-personalizer-backup";
const MAX_BACKUP_DEPTH = LIMIT_DEFAULTS.nestingDepth;
const MAX_BACKUP_PROPERTIES = LIMIT_DEFAULTS.properties;

const DEFAULT_DUPLICATE_STORE_NAMES = Object.freeze([
  "projects",
  "records",
  "templates",
  "templateVersions",
  "addenda",
  "results",
  "resultVersions",
  "jobs",
  "contacts",
  "deliveryHistory",
  "artifacts",
  "logs"
]);

export const RESTORE_POLICY_DEFAULTS = Object.freeze({
  conflict: "merge",
  allowUnknownStores: false,
  duplicateStores: DEFAULT_DUPLICATE_STORE_NAMES
});

function backupError(code, message, details = {}) {
  return Object.assign(new Error(message), { code, details });
}

function describeZodError(error) {
  const issue = error?.issues?.[0];
  if (!issue) return "The archive contains invalid data.";
  const path = issue.path?.length ? `${issue.path.join(".")}: ` : "";
  return `${path}${issue.message}`;
}

function keySchemaFor(keyPath) {
  switch (keyPath) {
    case "email":
      return z.string().min(1).max(320);
    case "url":
      return z.string().min(1).max(4000);
    case "providerId":
      return z.string().min(1).max(120);
    case "providerModelId":
      return z.string().min(1).max(300);
    case "key":
      return z.string().min(1).max(120);
    case "scopeKey":
      return z.string().min(1).max(180);
    default:
      return z.string().min(1).max(500);
  }
}

function entitySchema(keyPath, extraShape = {}) {
  return z
    .object({
      [keyPath]: keySchemaFor(keyPath),
      ...extraShape
    })
    .passthrough();
}

function optionalIdSchema() {
  return z.union([keySchemaFor("id"), z.null()]).optional();
}

function safeClone(value) {
  return structuredClone(value);
}

function normalizeStoreNames(value, fallback) {
  if (value == null || value === true) return new Set(fallback);
  if (value === false) return new Set();
  if (value instanceof Set) return new Set([...value].map((item) => String(item)));
  if (Array.isArray(value)) return new Set(value.map((item) => String(item)));
  return new Set(fallback);
}

function relationTargetSet(storeKeysByStore, targetStore) {
  return storeKeysByStore.get(targetStore) ?? new Set();
}

function hasKey(keySet, value) {
  return keySet.has(String(value));
}

function ensureRelationExists({ store, index, field, value, targetStore, keySets, optional = false }) {
  if (value == null || value === "") {
    if (optional) return;
    throw backupError(
      "BACKUP_RELATION_MISSING",
      `Backup record ${store}[${index}] is missing required field ${field}.`,
      { store, index, field, targetStore }
    );
  }
  if (!hasKey(relationTargetSet(keySets, targetStore), value)) {
    throw backupError(
      "BACKUP_RELATION_MISSING",
      `Backup record ${store}[${index}].${field} references missing ${targetStore} record ${String(value)}.`,
      { store, index, field, value: String(value), targetStore }
    );
  }
}

function ensurePluralRelationExists({ store, index, field, value, targetStore, keySets, optional = false }) {
  if (value == null) {
    if (optional) return;
    throw backupError(
      "BACKUP_RELATION_MISSING",
      `Backup record ${store}[${index}] is missing required field ${field}.`,
      { store, index, field, targetStore }
    );
  }
  if (!Array.isArray(value)) {
    throw backupError(
      "BACKUP_CATEGORY_INVALID",
      `Backup record ${store}[${index}].${field} must be an array.`,
      { store, index, field, targetStore }
    );
  }
  const targetKeys = relationTargetSet(keySets, targetStore);
  for (const [valueIndex, item] of value.entries()) {
    if (item == null || item === "") {
      throw backupError(
        "BACKUP_RELATION_MISSING",
        `Backup record ${store}[${index}].${field}[${valueIndex}] is empty.`,
        { store, index, field, valueIndex, targetStore }
      );
    }
    if (!hasKey(targetKeys, item)) {
      throw backupError(
        "BACKUP_RELATION_MISSING",
        `Backup record ${store}[${index}].${field}[${valueIndex}] references missing ${targetStore} record ${String(item)}.`,
        { store, index, field, valueIndex, value: String(item), targetStore }
      );
    }
  }
}

function assertSafeValue(
  value,
  {
    maxDepth = MAX_BACKUP_DEPTH,
    maxProperties = MAX_BACKUP_PROPERTIES,
    maxFieldBytes = LIMIT_DEFAULTS.fieldBytes
  } = {}
) {
  const stack = [{ value, depth: 0 }];
  let properties = 0;
  while (stack.length) {
    const { value: current, depth } = stack.pop();
    if (depth > maxDepth) {
      throw backupError("BACKUP_NESTING_TOO_DEEP", "Backup data is nested too deeply.");
    }
    if (typeof current === "string" && utf8ByteLength(current) > maxFieldBytes) {
      throw backupError(
        "BACKUP_FIELD_TOO_LARGE",
        "Backup data contains a field that exceeds the configured size limit.",
        {
          maxFieldBytes,
          actualBytes: utf8ByteLength(current)
        }
      );
    }
    if (!current || typeof current !== "object") continue;
    for (const [key, child] of Object.entries(current)) {
      properties += 1;
      if (properties > maxProperties) {
        throw backupError("BACKUP_TOO_MANY_PROPERTIES", "Backup data contains too many properties.");
      }
      if (["__proto__", "prototype", "constructor"].includes(key)) {
        throw backupError("BACKUP_PROTOTYPE_KEY", "Backup contains a prohibited object key.");
      }
      stack.push({ value: child, depth: depth + 1 });
    }
  }
}

function duplicateKey(value, store) {
  const prefix =
    String(value ?? store)
      .normalize("NFKC")
      .replace(/[^a-zA-Z0-9._-]+/g, "_")
      .slice(0, 48) || store;
  return `${prefix}-copy-${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`;
}

const CONTACT_SCHEMA = entitySchema("id", {
  projectId: keySchemaFor("id"),
  type: z.string().optional(),
  value: z.any().optional(),
  sourceUrl: z.string().optional(),
  sourceCategory: z.string().optional(),
  method: z.string().optional(),
  sameDomain: z.boolean().optional(),
  confidence: z.number().optional(),
  confidenceLabel: z.string().optional(),
  reason: z.string().optional(),
  discoveredAt: z.string().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional()
});

const PROJECT_SCHEMA = entitySchema("id", {
  name: z.string().optional(),
  sourceName: z.string().optional(),
  templateId: optionalIdSchema(),
  recordCount: z.number().int().nonnegative().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  revision: z.number().int().nonnegative().optional()
});

const RECORD_SCHEMA = entitySchema("id", {
  projectId: keySchemaFor("id"),
  sourceName: z.string().optional(),
  recordKey: z.string().optional(),
  displayName: z.string().optional(),
  sourceRow: z.any().optional(),
  raw: z.any().optional(),
  normalized: z.any().optional(),
  validation: z.any().optional(),
  status: z.string().optional(),
  contactLookup: z.string().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  revision: z.number().int().nonnegative().optional()
});

const TEMPLATE_SCHEMA = entitySchema("id", {
  name: z.string().optional(),
  content: z.string().optional(),
  tags: z.array(z.string()).optional(),
  folder: z.string().optional(),
  source: z.string().optional(),
  immutable: z.boolean().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  revision: z.number().int().nonnegative().optional()
});

const TEMPLATE_VERSION_SCHEMA = entitySchema("id", {
  templateId: keySchemaFor("id"),
  name: z.string().optional(),
  content: z.string().optional(),
  tags: z.array(z.string()).optional(),
  createdAt: z.string().optional()
});

const ADDENDA_SCHEMA = entitySchema("id", {
  name: z.string().optional(),
  content: z.string().optional(),
  sourceContent: z.string().optional(),
  source: z.string().optional(),
  immutable: z.boolean().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  revision: z.number().int().nonnegative().optional()
});

const PROVIDER_BATCH_REQUEST_SCHEMA = z
  .object({
    customId: z.string().min(1).max(200),
    recordId: keySchemaFor("id"),
    displayName: z.string().optional(),
    prompt: z.string().optional(),
    research: z.any().optional()
  })
  .passthrough();

const PROVIDER_BATCH_CHUNK_SCHEMA = z
  .object({
    chunkId: z.string().min(1).max(200),
    index: z.number().int().nonnegative().optional(),
    requestIds: z.array(z.string().min(1).max(200)).optional(),
    recordIds: z.array(keySchemaFor("id")).optional(),
    submissionState: z.string().optional(),
    providerBatchId: z.string().optional(),
    providerStatus: z.string().optional()
  })
  .passthrough();

const PROVIDER_BATCH_SCHEMA = z
  .object({
    operationId: keySchemaFor("id"),
    clientRequestKey: z.string().optional(),
    provider: z.string().optional(),
    model: z.string().optional(),
    requests: z.array(PROVIDER_BATCH_REQUEST_SCHEMA),
    chunks: z.array(PROVIDER_BATCH_CHUNK_SCHEMA),
    estimate: z.any().optional(),
    submissionState: z.string().optional(),
    monitoringState: z.string().optional(),
    createdAt: z.string().optional(),
    updatedAt: z.string().optional(),
    recoveredAt: z.string().optional()
  })
  .passthrough();

const JOB_SCHEMA = entitySchema("id", {
  projectId: keySchemaFor("id"),
  operationId: keySchemaFor("id").optional(),
  scopeKey: z.string().optional(),
  ownerTabId: z.string().optional(),
  status: z.string().optional(),
  executionMode: z.string().optional(),
  requestedExecutionMode: z.string().optional(),
  clientRequestKey: z.string().optional(),
  counts: z.any().optional(),
  error: z.any().optional(),
  options: z.any().optional(),
  providerBatch: PROVIDER_BATCH_SCHEMA.optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  revision: z.number().int().nonnegative().optional()
});

const RESULTS_CONTACT_SCHEMA = z
  .object({
    id: z.string().optional(),
    type: z.string().optional(),
    value: z.any().optional()
  })
  .passthrough();

const RESULT_SCHEMA = entitySchema("id", {
  jobId: keySchemaFor("id"),
  projectId: keySchemaFor("id"),
  recordId: keySchemaFor("id"),
  templateId: keySchemaFor("id"),
  provider: z.string().optional(),
  model: z.string().optional(),
  status: z.string().optional(),
  subject: z.string().optional(),
  originalAiBodyHtml: z.string().optional(),
  finalEmailHtml: z.string().optional(),
  finalText: z.string().optional(),
  addendumSnapshot: z.string().optional(),
  signatureSnapshot: z.string().optional(),
  contacts: z.array(RESULTS_CONTACT_SCHEMA).optional(),
  primaryContactId: optionalIdSchema(),
  consentStatus: z.string().optional(),
  consentSource: z.string().optional(),
  consentTimestamp: z.string().optional(),
  version: z.number().int().nonnegative().optional(),
  trashed: z.boolean().optional(),
  addendumId: optionalIdSchema(),
  research: z.any().optional(),
  renderedPrompt: z.string().optional(),
  usage: z.any().optional(),
  error: z.any().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  revision: z.number().int().nonnegative().optional()
});

const RESULT_VERSION_SCHEMA = entitySchema("id", {
  resultId: keySchemaFor("id"),
  version: z.number().int().nonnegative().optional(),
  subject: z.string().optional(),
  finalEmailHtml: z.string().optional(),
  finalText: z.string().optional(),
  originalAiBodyHtml: z.string().optional(),
  addendumSnapshot: z.string().optional(),
  createdAt: z.string().optional()
});

const RESEARCH_CACHE_SCHEMA = entitySchema("url", {
  status: z.string().optional(),
  title: z.string().optional(),
  content: z.string().optional(),
  error: z.any().optional(),
  metadata: z.any().optional(),
  fetchedAt: z.string().optional(),
  expiresAt: z.string().optional(),
  updatedAt: z.string().optional()
});

const MODEL_CATALOG_SCHEMA = entitySchema("id", {
  providerId: z.string().optional(),
  providerModelId: z.string().optional(),
  displayName: z.string().optional(),
  aliases: z.array(z.string()).optional(),
  family: z.string().nullable().optional(),
  version: z.string().nullable().optional(),
  status: z.string().optional(),
  availability: z.string().optional(),
  pricing: z.any().optional(),
  compatibility: z.any().optional(),
  metadataSource: z.any().optional(),
  rawProviderMetadata: z.any().optional(),
  updatedAt: z.string().optional(),
  revision: z.number().int().nonnegative().optional()
});

const PROVIDER_STATUS_SCHEMA = entitySchema("providerId", {
  status: z.string().optional(),
  modelCount: z.number().int().nonnegative().optional(),
  error: z.any().optional(),
  verifiedAt: z.string().optional(),
  updatedAt: z.string().optional()
});

const SETTINGS_SCHEMA = z
  .object({
    key: z.literal("application"),
    activeProjectId: optionalIdSchema(),
    selectedModel: optionalIdSchema(),
    executionMode: z.enum(["auto", "provider-batch", "standard"]).optional(),
    businessName: z.string().optional(),
    businessSignature: z.string().optional(),
    businessUrl: z.string().optional(),
    companyAddress: z.string().optional(),
    modelCacheTtlHours: z.number().int().nonnegative().optional(),
    openrouterReferer: z.string().optional(),
    ollamaHost: z.string().optional(),
    confirmedCustomOllamaHost: z.boolean().optional(),
    customBaseUrl: z.string().optional(),
    confirmedCustomProviderHost: z.boolean().optional(),
    resendFromName: z.string().optional(),
    resendFromAddress: z.string().optional(),
    resendReplyTo: z.string().optional(),
    resendTestRecipient: z.string().optional(),
    resendBatchSize: z.number().int().positive().optional(),
    resendUnsubscribeUrl: z.string().optional(),
    logLevel: z.enum(["info", "debug", "warn", "error"]).optional(),
    reducedMotion: z.boolean().optional(),
    highContrast: z.boolean().optional(),
    walkthroughVersion: z.number().int().nonnegative().optional(),
    editorHeight: z.number().int().nonnegative().optional(),
    editorPanels: z.object({}).passthrough().optional(),
    recordColumns: z.object({}).passthrough().optional(),
    resultColumns: z.object({}).passthrough().optional(),
    updatedAt: z.string().nullable().optional(),
    revision: z.number().int().nonnegative().optional()
  })
  .passthrough();

const DELIVERY_HISTORY_SCHEMA = entitySchema("id", {
  resultId: keySchemaFor("id"),
  operationId: keySchemaFor("id").optional(),
  messageDigest: z.string().optional(),
  chunkIndex: z.number().int().nonnegative().optional(),
  resendId: z.string().optional(),
  providerMessageId: z.string().optional(),
  email: z.string().optional(),
  status: z.string().optional(),
  idempotencyKey: z.string().optional(),
  reviewedAt: z.string().optional(),
  reviewId: z.string().optional(),
  updatedAt: z.string().optional(),
  revision: z.number().int().nonnegative().optional()
});

const SUPPRESSION_SCHEMA = entitySchema("email", {
  reason: z.string().optional(),
  source: z.string().optional(),
  updatedAt: z.string().optional()
});

const ARTIFACT_SCHEMA = entitySchema("id", {
  projectId: keySchemaFor("id"),
  name: z.string().optional(),
  path: z.string().optional(),
  type: z.string().optional(),
  contentType: z.string().optional(),
  size: z.number().int().nonnegative().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  revision: z.number().int().nonnegative().optional()
});

const LOG_SCHEMA = entitySchema("id", {
  timestamp: z.string().optional(),
  level: z.string().optional(),
  event: z.string().optional(),
  correlationId: z.string().optional(),
  metadata: z.any().optional()
});

const VERSION_1_STORE_SCHEMAS = Object.freeze({
  projects: z.array(PROJECT_SCHEMA),
  records: z.array(RECORD_SCHEMA),
  templates: z.array(TEMPLATE_SCHEMA),
  templateVersions: z.array(TEMPLATE_VERSION_SCHEMA),
  addenda: z.array(ADDENDA_SCHEMA),
  results: z.array(RESULT_SCHEMA),
  resultVersions: z.array(RESULT_VERSION_SCHEMA),
  jobs: z.array(JOB_SCHEMA),
  researchCache: z.array(RESEARCH_CACHE_SCHEMA),
  contacts: z.array(CONTACT_SCHEMA),
  modelCatalog: z.array(MODEL_CATALOG_SCHEMA),
  providerStatus: z.array(PROVIDER_STATUS_SCHEMA),
  settings: z.array(SETTINGS_SCHEMA),
  deliveryHistory: z.array(DELIVERY_HISTORY_SCHEMA),
  suppressions: z.array(SUPPRESSION_SCHEMA),
  artifacts: z.array(ARTIFACT_SCHEMA),
  logs: z.array(LOG_SCHEMA)
});

const VERSION_1_RELATED_FIELDS = Object.freeze({
  projects: [{ field: "templateId", targetStore: "templates", optional: true }],
  records: [{ field: "projectId", targetStore: "projects" }],
  templateVersions: [{ field: "templateId", targetStore: "templates" }],
  results: [
    { field: "jobId", targetStore: "jobs" },
    { field: "projectId", targetStore: "projects" },
    { field: "recordId", targetStore: "records" },
    { field: "templateId", targetStore: "templates" },
    { field: "addendumId", targetStore: "addenda", optional: true }
  ],
  resultVersions: [{ field: "resultId", targetStore: "results" }],
  jobs: [
    { field: "operationId", targetStore: "jobs" },
    { field: "projectId", targetStore: "projects" }
  ],
  contacts: [{ field: "projectId", targetStore: "projects" }],
  settings: [
    { field: "activeProjectId", targetStore: "projects", optional: true },
    { field: "selectedModel", targetStore: "modelCatalog", optional: true }
  ],
  deliveryHistory: [{ field: "resultId", targetStore: "results" }],
  artifacts: [{ field: "projectId", targetStore: "projects" }]
});

const VERSION_1_NESTED_RELATIONS = Object.freeze({
  jobs: [
    { path: ["providerBatch", "operationId"], targetStore: "jobs", optional: false },
    { path: ["providerBatch", "requests"], childField: "recordId", targetStore: "records", plural: false },
    { path: ["providerBatch", "chunks"], childField: "recordIds", targetStore: "records", plural: true }
  ]
});

export const BACKUP_VERSION_SCHEMAS = Object.freeze({
  1: Object.freeze({
    manifest: z
      .object({
        format: z.literal(BACKUP_FORMAT),
        archiveVersion: z.number().int().nonnegative(),
        applicationVersion: z.string().min(1).max(80),
        browserSchemaVersion: z.number().int().nonnegative(),
        exportedAt: z.string().min(1).max(80),
        includedCategories: z.array(z.string().min(1).max(80)),
        counts: z.record(z.number().int().nonnegative()),
        checksums: z.record(z.string().regex(/^[a-f0-9]{64}$/i)),
        migration: z.object({ version: z.number().int().nonnegative() }).passthrough()
      })
      .strict(),
    stores: VERSION_1_STORE_SCHEMAS,
    relatedFields: VERSION_1_RELATED_FIELDS,
    nestedRelations: VERSION_1_NESTED_RELATIONS,
    duplicateStores: DEFAULT_DUPLICATE_STORE_NAMES
  })
});

export function getBackupVersionSchema(version) {
  return BACKUP_VERSION_SCHEMAS[version] ?? null;
}

export function normalizeRestorePolicy(policy = {}) {
  const input = typeof policy === "string" ? { conflict: policy } : { ...(policy ?? {}) };
  const conflict = ["merge", "replace", "duplicate", "skip"].includes(input.conflict)
    ? input.conflict
    : RESTORE_POLICY_DEFAULTS.conflict;
  return {
    ...RESTORE_POLICY_DEFAULTS,
    ...input,
    conflict,
    duplicateStores: normalizeStoreNames(input.duplicateStores, RESTORE_POLICY_DEFAULTS.duplicateStores)
  };
}

export function validateBackupManifest(rawManifest) {
  const parsed = BACKUP_VERSION_SCHEMAS[1].manifest.safeParse(rawManifest);
  if (!parsed.success) {
    throw backupError(
      "BACKUP_MANIFEST_INVALID",
      `Backup manifest is malformed: ${describeZodError(parsed.error)}`,
      { issues: parsed.error.issues }
    );
  }
  const manifest = parsed.data;
  if (manifest.format !== BACKUP_FORMAT) {
    throw backupError(
      "BACKUP_FORMAT_UNSUPPORTED",
      "Backup format is not supported by this application version."
    );
  }
  const versionSchema = BACKUP_VERSION_SCHEMAS[manifest.archiveVersion];
  if (!versionSchema) {
    throw backupError(
      "BACKUP_VERSION_UNSUPPORTED",
      "Backup format version is not supported by this application version.",
      { archiveVersion: manifest.archiveVersion }
    );
  }
  if (manifest.browserSchemaVersion > VERSIONS.browserSchema) {
    throw backupError(
      "BACKUP_BROWSER_SCHEMA_NEWER",
      "Backup was created with a newer browser schema than this application supports.",
      {
        browserSchemaVersion: manifest.browserSchemaVersion,
        currentBrowserSchemaVersion: VERSIONS.browserSchema
      }
    );
  }
  if (manifest.migration?.version > VERSIONS.migration) {
    throw backupError(
      "BACKUP_MIGRATION_NEWER",
      "Backup was created with a newer migration version than this application supports.",
      {
        migrationVersion: manifest.migration?.version,
        currentMigrationVersion: VERSIONS.migration
      }
    );
  }
  const includedCategories = [...manifest.includedCategories];
  if (!includedCategories.length) {
    throw backupError("BACKUP_MANIFEST_INVALID", "Backup manifest does not list any data categories.");
  }
  if (new Set(includedCategories).size !== includedCategories.length) {
    throw backupError("BACKUP_MANIFEST_INVALID", "Backup manifest contains duplicate categories.");
  }
  const allowedStores = new Set(Object.keys(versionSchema.stores));
  const unexpectedStores = includedCategories.filter((store) => !allowedStores.has(store));
  if (unexpectedStores.length) {
    throw backupError(
      "BACKUP_CATEGORY_UNSUPPORTED",
      `Backup contains unsupported categories: ${unexpectedStores.join(", ")}.`,
      { unexpectedStores }
    );
  }
  const missingCounts = includedCategories.filter((store) => !(store in manifest.counts));
  const extraCounts = Object.keys(manifest.counts).filter((store) => !includedCategories.includes(store));
  if (missingCounts.length || extraCounts.length) {
    throw backupError(
      "BACKUP_MANIFEST_INVALID",
      "Backup manifest counts do not match the included categories.",
      { missingCounts, extraCounts }
    );
  }
  const missingChecksums = includedCategories
    .map((store) => `data/${store}.json`)
    .filter((path) => !(path in manifest.checksums));
  const extraChecksums = Object.keys(manifest.checksums).filter(
    (path) => !includedCategories.includes(path.replace(/^data\/|\.json$/g, ""))
  );
  if (missingChecksums.length || extraChecksums.length) {
    throw backupError(
      "BACKUP_MANIFEST_INVALID",
      "Backup manifest checksums do not match the included categories.",
      { missingChecksums, extraChecksums }
    );
  }
  return { manifest: { ...manifest, includedCategories }, versionSchema };
}

function validateStoreArray(store, records, versionSchema, limits) {
  const storeSchema = versionSchema.stores[store];
  if (!storeSchema) {
    throw backupError("BACKUP_CATEGORY_UNSUPPORTED", `Backup category ${store} is not supported.`);
  }
  const maxRecords = limits.records ?? LIMIT_DEFAULTS.records;
  const maxFields = limits.fields ?? LIMIT_DEFAULTS.fields;
  const maxDepth = limits.nestingDepth ?? LIMIT_DEFAULTS.nestingDepth;
  const maxProperties = limits.properties ?? LIMIT_DEFAULTS.properties;
  const maxFieldBytes = limits.fieldBytes ?? LIMIT_DEFAULTS.fieldBytes;
  const parsed = storeSchema.safeParse(records);
  if (!parsed.success) {
    throw backupError(
      "BACKUP_CATEGORY_INVALID",
      `Backup category ${store} is malformed: ${describeZodError(parsed.error)}`,
      { store, issues: parsed.error.issues }
    );
  }
  if (parsed.data.length > maxRecords) {
    throw backupError(
      "BACKUP_RECORD_LIMIT_EXCEEDED",
      `Backup category ${store} contains ${parsed.data.length} record(s), which exceeds the configured limit.`,
      { store, recordCount: parsed.data.length, maxRecords }
    );
  }
  for (const [index, record] of parsed.data.entries()) {
    const fieldCount = Object.keys(record ?? {}).length;
    if (fieldCount > maxFields) {
      throw backupError(
        "BACKUP_TOO_MANY_FIELDS",
        `Backup category ${store}[${index}] contains too many fields.`,
        { store, index, fieldCount, maxFields }
      );
    }
  }
  assertSafeValue(parsed.data, { maxDepth, maxProperties, maxFieldBytes });
  return parsed.data;
}

function buildKeySets(data) {
  const keySets = new Map();
  for (const [store, records] of Object.entries(data)) {
    const keyPath = STORE_DEFINITIONS[store]?.keyPath;
    if (!keyPath) continue;
    const keys = new Set();
    for (const [index, record] of records.entries()) {
      const key = record?.[keyPath];
      if (key == null || key === "") {
        throw backupError(
          "BACKUP_CATEGORY_INVALID",
          `Backup category ${store}[${index}] is missing its key field ${keyPath}.`,
          { store, index, keyPath }
        );
      }
      const normalizedKey = String(key);
      if (keys.has(normalizedKey)) {
        throw backupError(
          "BACKUP_DUPLICATE_KEY",
          `Backup category ${store} contains duplicate key ${normalizedKey}.`,
          { store, key: normalizedKey }
        );
      }
      keys.add(normalizedKey);
    }
    keySets.set(store, keys);
  }
  return keySets;
}

function validateRootRelations(store, records, versionSchema, keySets) {
  const relations = versionSchema.relatedFields[store] ?? [];
  for (const [index, record] of records.entries()) {
    for (const relation of relations) {
      ensureRelationExists({
        store,
        index,
        field: relation.field,
        value: record?.[relation.field],
        targetStore: relation.targetStore,
        keySets,
        optional: relation.optional
      });
    }
  }
}

function validateNestedRelations(store, records, versionSchema, keySets) {
  const nestedRelations = versionSchema.nestedRelations[store] ?? [];
  for (const [index, record] of records.entries()) {
    for (const relation of nestedRelations) {
      const parent = relation.path.reduce((current, segment) => current?.[segment], record);
      if (parent == null) continue;
      if (!relation.childField) {
        ensureRelationExists({
          store,
          index,
          field: relation.path.at(-1),
          value: parent,
          targetStore: relation.targetStore,
          keySets,
          optional: relation.optional
        });
        continue;
      }
      const parents = Array.isArray(parent) ? parent : [parent];
      for (const [parentIndex, item] of parents.entries()) {
        if (!item || typeof item !== "object") continue;
        if (relation.plural) {
          ensurePluralRelationExists({
            store,
            index: `${index}.${parentIndex}`,
            field: relation.childField,
            value: item?.[relation.childField],
            targetStore: relation.targetStore,
            keySets,
            optional: relation.optional
          });
          continue;
        }
        ensureRelationExists({
          store,
          index: `${index}.${parentIndex}`,
          field: relation.childField,
          value: item?.[relation.childField],
          targetStore: relation.targetStore,
          keySets,
          optional: relation.optional
        });
      }
    }
  }
}

export function validateInspectedBackup(inspected, { limits = {} } = {}) {
  const { manifest, versionSchema } = validateBackupManifest(inspected?.manifest);
  const data = {};
  for (const store of manifest.includedCategories) {
    const records = validateStoreArray(store, inspected?.data?.[store], versionSchema, limits);
    const expectedCount = manifest.counts[store];
    if (records.length !== expectedCount) {
      throw backupError(
        "BACKUP_COUNT_MISMATCH",
        `Backup category ${store} contains ${records.length} record(s), but the manifest expected ${expectedCount}.`,
        { store, expectedCount, actualCount: records.length }
      );
    }
    data[store] = records;
  }
  const storeKeysByStore = buildKeySets(data);
  for (const store of manifest.includedCategories) {
    validateRootRelations(store, data[store], versionSchema, storeKeysByStore);
    validateNestedRelations(store, data[store], versionSchema, storeKeysByStore);
  }
  return { manifest, data, versionSchema, storeKeysByStore };
}

function cloneStoreData(data) {
  return Object.fromEntries(
    Object.entries(data).map(([store, records]) => [store, records.map((record) => safeClone(record))])
  );
}

function updateFieldValue(record, field, nextValue, stats, store) {
  if (Array.isArray(nextValue)) {
    if (record[field] !== nextValue) {
      record[field] = nextValue;
      stats.count += 1;
      if (store) stats.byStore.set(store, (stats.byStore.get(store) ?? 0) + 1);
    }
    return;
  }
  if (record[field] !== nextValue) {
    record[field] = nextValue;
    stats.count += 1;
    if (store) stats.byStore.set(store, (stats.byStore.get(store) ?? 0) + 1);
  }
}

function rewriteValue(value, targetStore, keyMaps, _stats) {
  if (value == null) return value;
  const targetKeys = keyMaps.get(targetStore);
  if (!targetKeys) return value;
  return targetKeys.has(String(value)) ? targetKeys.get(String(value)) : value;
}

function rewriteRootRecord(store, record, keyMaps, stats, relationMap, relationArrayMap) {
  for (const relation of relationMap) {
    if (!(relation.field in record)) continue;
    if (relation.plural) {
      const current = record[relation.field];
      if (!Array.isArray(current)) continue;
      const next = current.map((item) => rewriteValue(item, relation.targetStore, keyMaps, stats));
      updateFieldValue(record, relation.field, next, stats, store);
      continue;
    }
    const next = rewriteValue(record[relation.field], relation.targetStore, keyMaps, stats);
    updateFieldValue(record, relation.field, next, stats, store);
  }
  for (const [field, targetStore] of Object.entries(relationArrayMap)) {
    if (!(field in record)) continue;
    const current = record[field];
    if (!Array.isArray(current)) continue;
    const next = current.map((item) => rewriteValue(item, targetStore, keyMaps, stats));
    updateFieldValue(record, field, next, stats, store);
  }
}

function rewriteNestedJobRelations(job, keyMaps, stats) {
  const providerBatch = job?.providerBatch;
  if (!providerBatch || typeof providerBatch !== "object") return;
  if ("operationId" in providerBatch) {
    const next = rewriteValue(providerBatch.operationId, "jobs", keyMaps, stats);
    updateFieldValue(providerBatch, "operationId", next, stats, "jobs");
  }
  if (Array.isArray(providerBatch.requests)) {
    for (const request of providerBatch.requests) {
      if (!request || typeof request !== "object") continue;
      const next = rewriteValue(request.recordId, "records", keyMaps, stats);
      updateFieldValue(request, "recordId", next, stats, "jobs");
    }
  }
  if (Array.isArray(providerBatch.chunks)) {
    for (const chunk of providerBatch.chunks) {
      if (!chunk || typeof chunk !== "object") continue;
      if (Array.isArray(chunk.recordIds)) {
        const next = chunk.recordIds.map((item) => rewriteValue(item, "records", keyMaps, stats));
        updateFieldValue(chunk, "recordIds", next, stats, "jobs");
      }
    }
  }
}

function duplicateStoreData(data, duplicateStores) {
  const cloned = cloneStoreData(data);
  const keyMaps = new Map();
  const duplicateCounts = {};
  for (const [store, records] of Object.entries(cloned)) {
    const keyPath = STORE_DEFINITIONS[store]?.keyPath;
    if (!keyPath || !duplicateStores.has(store)) continue;
    const map = new Map();
    cloned[store] = records.map((record) => {
      const copy = safeClone(record);
      const oldKey = copy?.[keyPath];
      if (oldKey == null) return copy;
      const nextKey = duplicateKey(oldKey, store);
      map.set(String(oldKey), nextKey);
      copy[keyPath] = nextKey;
      if ("name" in copy && typeof copy.name === "string" && copy.name.trim()) {
        copy.name = `${copy.name} (imported copy)`;
      }
      return copy;
    });
    keyMaps.set(store, map);
    duplicateCounts[store] = cloned[store].length;
  }
  const rewriteStats = { count: 0, byStore: new Map() };
  const relationArrayMapByStore = {
    settings: {},
    projects: {},
    records: {},
    templates: {},
    templateVersions: {},
    addenda: {},
    results: {},
    resultVersions: {},
    jobs: {},
    contacts: {},
    providerStatus: {},
    modelCatalog: {},
    researchCache: {},
    deliveryHistory: {},
    suppressions: {},
    artifacts: {},
    logs: {}
  };
  const rootRelations = VERSION_1_RELATED_FIELDS;
  for (const [store, records] of Object.entries(cloned)) {
    const relationMap = rootRelations[store] ?? [];
    const relationArrayMap = relationArrayMapByStore[store] ?? {};
    for (const record of records) {
      rewriteRootRecord(store, record, keyMaps, rewriteStats, relationMap, relationArrayMap);
      if (store === "jobs") rewriteNestedJobRelations(record, keyMaps, rewriteStats);
    }
  }
  return {
    data: cloned,
    duplicateCounts,
    rewriteCount: rewriteStats.count,
    rewriteCountByStore: Object.fromEntries(rewriteStats.byStore),
    duplicateStores: [...duplicateStores]
  };
}

function summarizeStorePlan(storePlan) {
  const details = [];
  if (storePlan.action === "duplicate") {
    details.push(`copy ${storePlan.incomingCount}`);
    if (storePlan.rewrittenReferences > 0)
      details.push(
        `${storePlan.rewrittenReferences} ref${storePlan.rewrittenReferences === 1 ? "" : "s"} rewritten`
      );
  } else if (storePlan.action === "replace") {
    details.push(`replace ${storePlan.incomingCount}`);
    if (storePlan.existingCount > 0) details.push(`clear ${storePlan.existingCount} existing`);
  } else if (storePlan.action === "skip") {
    details.push(`skip`);
  } else {
    details.push(`merge ${storePlan.incomingCount}`);
    if (storePlan.existingCount > 0) details.push(`overwrites possible`);
  }
  return details.join(", ");
}

export function buildRestorePreviewText(plan) {
  const duplicateCount = plan.storePlans.filter((item) => item.action === "duplicate").length;
  const mergeCount = plan.storePlans.filter((item) => item.action === "merge").length;
  const replaceCount = plan.storePlans.filter((item) => item.action === "replace").length;
  const skipCount = plan.storePlans.filter((item) => item.action === "skip").length;
  const lines = [
    `Restore preview: ${plan.storePlans.length} store(s), ${plan.summary.incomingTotal} incoming record(s).`,
    `Conflict policy: ${plan.requestedConflict} -> ${plan.effectiveConflict}.`,
    `Actions: ${duplicateCount} duplicate, ${mergeCount} merge, ${replaceCount} replace, ${skipCount} skip.`
  ];
  if (plan.destructiveEffects.length) {
    lines.push("");
    lines.push("Destructive effects:");
    for (const effect of plan.destructiveEffects) lines.push(`- ${effect}`);
  }
  if (plan.warnings.length) {
    lines.push("");
    lines.push("Warnings:");
    for (const warning of plan.warnings) lines.push(`- ${warning}`);
  }
  lines.push("");
  lines.push("Store details:");
  for (const storePlan of plan.storePlans) {
    lines.push(`- ${storePlan.store}: ${summarizeStorePlan(storePlan)}`);
  }
  return {
    summaryText: lines[0],
    detailText: lines.join("\n")
  };
}

export async function previewRestore(repository, inspected, { conflict = "merge" } = {}) {
  const policy = normalizeRestorePolicy({ conflict });
  const validated = validateInspectedBackup(inspected);
  const currentState = await repository
    .snapshot(validated.manifest.includedCategories)
    .catch(() => Object.fromEntries(validated.manifest.includedCategories.map((store) => [store, []])));
  const prepared =
    policy.conflict === "duplicate"
      ? duplicateStoreData(validated.data, policy.duplicateStores)
      : {
          data: cloneStoreData(validated.data),
          duplicateCounts: {},
          rewriteCount: 0,
          duplicateStores: []
        };
  const storePlans = validated.manifest.includedCategories.map((store) => {
    const incomingCount = validated.data[store]?.length ?? 0;
    const existingCount = currentState[store]?.length ?? 0;
    let action = policy.conflict;
    if (policy.conflict === "duplicate") {
      action = policy.duplicateStores.has(store) ? "duplicate" : "merge";
    } else if (policy.conflict === "skip" && existingCount === 0) {
      action = "merge";
    }
    const rewrittenReferences =
      policy.conflict === "duplicate" ? (prepared.rewriteCountByStore?.[store] ?? 0) : 0;
    return {
      store,
      incomingCount,
      existingCount,
      action,
      rewrittenReferences,
      duplicateCount: prepared.duplicateCounts?.[store] ?? 0,
      notes: []
    };
  });
  const warnings = [];
  const destructiveEffects = [];
  for (const plan of storePlans) {
    if (plan.action === "replace" && plan.existingCount > 0) {
      destructiveEffects.push(`Clears ${plan.existingCount} existing record(s) from ${plan.store}.`);
    }
    if (plan.action === "skip" && plan.existingCount > 0) {
      warnings.push(`${plan.store} already has ${plan.existingCount} record(s) and will be skipped.`);
    }
    if (plan.action === "merge" && plan.existingCount > 0) {
      warnings.push(
        `${plan.store} already has ${plan.existingCount} record(s); matching keys will be overwritten.`
      );
    }
    if (plan.rewrittenReferences > 0) {
      warnings.push(`Restore rewrote ${plan.rewrittenReferences} internal reference(s) in ${plan.store}.`);
    }
  }
  if (policy.conflict === "duplicate") {
    destructiveEffects.push(
      "Duplicate mode creates new keys for duplicated stores and rewrites their references."
    );
  }
  const summary = {
    incomingTotal: storePlans.reduce((sum, plan) => sum + plan.incomingCount, 0),
    existingTotal: storePlans.reduce((sum, plan) => sum + plan.existingCount, 0),
    storeCount: storePlans.length
  };
  const text = buildRestorePreviewText({
    requestedConflict: policy.conflict,
    effectiveConflict: policy.conflict === "duplicate" ? "merge" : policy.conflict,
    storePlans,
    destructiveEffects,
    warnings,
    summary
  });
  return {
    manifest: validated.manifest,
    data: validated.data,
    preparedData: prepared.data,
    duplicateStores: prepared.duplicateStores,
    rewriteCount: prepared.rewriteCount,
    storePlans,
    destructiveEffects,
    warnings,
    summary,
    requestedConflict: policy.conflict,
    effectiveConflict: policy.conflict === "duplicate" ? "merge" : policy.conflict,
    safeToCommit: true,
    summaryText: text.summaryText,
    detailText: text.detailText
  };
}
