function isPlainObject(value) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

export function canonicalize(value) {
  if (Array.isArray(value)) return value.map((item) => canonicalize(item));
  if (!value || typeof value !== "object" || value instanceof Date || value instanceof RegExp) return value;
  if (!isPlainObject(value)) return value;
  return Object.keys(value)
    .sort()
    .reduce((accumulator, key) => {
      const next = value[key];
      if (next === undefined) return accumulator;
      accumulator[key] = canonicalize(next);
      return accumulator;
    }, {});
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(String(value));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function digestCanonical(value, prefix = "op") {
  return `${prefix}_${(await sha256Hex(canonicalJson(value))).slice(0, 32)}`;
}

export function stableTabId(storageKey = "email-gen-tab-id") {
  const storage = globalThis.sessionStorage;
  if (storage) {
    try {
      const existing = storage.getItem(storageKey);
      if (existing) return existing;
      const generated = globalThis.crypto.randomUUID();
      storage.setItem(storageKey, generated);
      return generated;
    } catch {
      // Fall through to a process-local fallback when session storage is unavailable.
    }
  }
  return globalThis.crypto.randomUUID();
}

function normalizeIdList(items) {
  return [...new Set(items.filter(Boolean))]
    .map((value) => String(value))
    .sort((left, right) => left.localeCompare(right));
}

export async function processScopeIdentity({
  projectId = null,
  recordIds = [],
  template = null,
  provider = null,
  model = null,
  researchEnabled = false,
  researchDepth = null,
  options = {},
  addendum = null,
  scope = "all"
} = {}) {
  const fingerprint = {
    kind: "process",
    scope,
    projectId,
    recordIds: normalizeIdList(recordIds),
    template: template
      ? {
          id: template.id ?? null,
          name: template.name ?? null,
          content: template.content ?? ""
        }
      : null,
    addendum: addendum
      ? {
          id: addendum.id ?? null,
          content: addendum.content ?? ""
        }
      : null,
    provider,
    model,
    researchEnabled: Boolean(researchEnabled),
    researchDepth: Number.isFinite(Number(researchDepth)) ? Number(researchDepth) : null,
    options: {
      ollamaHost: options.ollamaHost ?? null,
      confirmedCustomOllamaHost: Boolean(options.confirmedCustomOllamaHost),
      customBaseUrl: options.customBaseUrl ?? null,
      confirmedCustomProviderHost: Boolean(options.confirmedCustomProviderHost),
      httpReferer: options.httpReferer ?? null
    }
  };
  return {
    scopeKey: await digestCanonical(fingerprint, "process"),
    fingerprint
  };
}

export async function gatewayRequestIdentity({
  record = null,
  template = null,
  provider = null,
  model = null,
  researchEnabled = false,
  researchDepth = null,
  options = {}
} = {}) {
  const fingerprint = {
    kind: "generate",
    record: record
      ? {
          id: record.id ?? null,
          displayName: record.displayName ?? null,
          normalized: record.normalized ?? null,
          validation: record.validation ?? null
        }
      : null,
    template: template
      ? {
          name: template.name ?? null,
          content: template.content ?? null
        }
      : null,
    provider,
    model,
    researchEnabled: Boolean(researchEnabled),
    researchDepth: Number.isFinite(Number(researchDepth)) ? Number(researchDepth) : null,
    options: {
      ollamaHost: options.ollamaHost ?? null,
      confirmedCustomOllamaHost: Boolean(options.confirmedCustomOllamaHost),
      customBaseUrl: options.customBaseUrl ?? null,
      confirmedCustomProviderHost: Boolean(options.confirmedCustomProviderHost),
      httpReferer: options.httpReferer ?? null
    }
  };
  return {
    scopeKey: await digestCanonical(fingerprint, "gw"),
    fingerprint
  };
}

export async function resendScopeIdentity({
  projectId = null,
  reviewId = null,
  reviewedAt = null,
  expiresAt = null,
  payloadDigest = null,
  resultIds = [],
  messageDigests = [],
  sender = {},
  suppressionDigest = null,
  batchSize = null,
  testRecipient = null
} = {}) {
  const fingerprint = {
    kind: "resend",
    projectId,
    reviewId,
    reviewedAt,
    expiresAt,
    payloadDigest,
    resultIds: normalizeIdList(resultIds),
    messageDigests: normalizeIdList(messageDigests),
    suppressionDigest,
    testRecipient: testRecipient ? String(testRecipient) : null,
    batchSize: Number.isFinite(Number(batchSize)) ? Number(batchSize) : null,
    sender: {
      fromName: sender.fromName ?? null,
      fromAddress: sender.fromAddress ?? null,
      replyTo: sender.replyTo ?? null,
      unsubscribeUrl: sender.unsubscribeUrl ?? null,
      companyAddress: sender.companyAddress ?? null
    }
  };
  return {
    scopeKey: await digestCanonical(fingerprint, "resend"),
    fingerprint
  };
}

export async function restoreScopeIdentity({ manifest = null, conflict = "merge" } = {}) {
  const fingerprint = {
    kind: "restore",
    conflict,
    archiveVersion: manifest?.archiveVersion ?? null,
    applicationVersion: manifest?.applicationVersion ?? null,
    includedCategories: manifest?.includedCategories ?? []
  };
  return {
    scopeKey: await digestCanonical(fingerprint, "restore"),
    fingerprint
  };
}
