const STORAGE_HEALTH_VERSION = 1;
const CONTINUITY_MARKER_KEY = "ai-batch-personalizer:storage-continuity";
const CHECKPOINT_PROMPT_MS = 5 * 60_000;
const CHECKPOINT_PROMPT_MUTATIONS = 10;

export const STORAGE_MODES = Object.freeze({
  INITIALIZING: "initializing",
  DURABLE: "durable",
  TEMPORARY: "temporary",
  RECOVERING: "recovering",
  RECOVERY_REQUIRED: "recovery-required"
});

export const PERSISTENCE_STATES = Object.freeze({
  GRANTED: "granted",
  BEST_EFFORT: "best-effort",
  DENIED: "denied",
  UNSUPPORTED: "unsupported",
  UNKNOWN: "unknown"
});

function safeLocalStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function safeNavigatorStorage() {
  try {
    return globalThis.navigator?.storage ?? null;
  } catch {
    return null;
  }
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function safeNowIso() {
  return new Date().toISOString();
}

export function createStorageHealthState(overrides = {}) {
  return {
    version: STORAGE_HEALTH_VERSION,
    mode: STORAGE_MODES.INITIALIZING,
    persistenceState: PERSISTENCE_STATES.UNKNOWN,
    reasonCode: null,
    message: "",
    degradedAt: null,
    temporaryDirty: false,
    lastDurableSaveAt: null,
    acknowledged: false,
    backupOfferedAt: null,
    backupPromptedAt: null,
    recoveryRequired: false,
    markerSeen: false,
    markerKnown: false,
    markerDetectedAt: null,
    recoveryStartedAt: null,
    recoveryFinishedAt: null,
    checkpointMutations: 0,
    checkpointPromptAt: null,
    lastCheckpointPromptAt: null,
    checkpointPromptCount: 0,
    recoveryDisposition: null,
    ...overrides
  };
}

export function readContinuityMarker(storage = safeLocalStorage()) {
  if (!storage?.getItem) return null;
  const raw = storage.getItem(CONTINUITY_MARKER_KEY);
  if (!raw) return null;
  const parsed = safeJsonParse(raw);
  if (!parsed || parsed.version !== STORAGE_HEALTH_VERSION) return null;
  return parsed;
}

export function writeContinuityMarker(marker, storage = safeLocalStorage()) {
  if (!storage?.setItem) return false;
  const next = {
    version: STORAGE_HEALTH_VERSION,
    mode: marker.mode ?? STORAGE_MODES.TEMPORARY,
    reasonCode: marker.reasonCode ?? null,
    message: marker.message ?? "",
    degradedAt: marker.degradedAt ?? safeNowIso(),
    temporaryDirty: Boolean(marker.temporaryDirty),
    lastDurableSaveAt: marker.lastDurableSaveAt ?? null,
    acknowledged: Boolean(marker.acknowledged),
    backupOfferedAt: marker.backupOfferedAt ?? null,
    recoveryRequired: Boolean(marker.recoveryRequired),
    markerSeen: Boolean(marker.markerSeen),
    markerKnown: true,
    markerDetectedAt: marker.markerDetectedAt ?? null,
    recoveryStartedAt: marker.recoveryStartedAt ?? null,
    recoveryFinishedAt: marker.recoveryFinishedAt ?? null
  };
  storage.setItem(CONTINUITY_MARKER_KEY, JSON.stringify(next));
  return true;
}

export function clearContinuityMarker(storage = safeLocalStorage()) {
  if (!storage?.removeItem) return false;
  storage.removeItem(CONTINUITY_MARKER_KEY);
  return true;
}

export async function readPersistenceStatus(storage = safeNavigatorStorage()) {
  if (!storage) return { status: PERSISTENCE_STATES.UNSUPPORTED, granted: false, persisted: false };
  if (typeof storage.persisted !== "function") {
    return { status: PERSISTENCE_STATES.UNSUPPORTED, granted: false, persisted: false };
  }
  try {
    const persisted = Boolean(await storage.persisted());
    return {
      status: persisted ? PERSISTENCE_STATES.GRANTED : PERSISTENCE_STATES.BEST_EFFORT,
      granted: persisted,
      persisted
    };
  } catch (error) {
    return {
      status: PERSISTENCE_STATES.UNKNOWN,
      granted: false,
      persisted: false,
      error
    };
  }
}

export async function requestPersistenceStatus(storage = safeNavigatorStorage()) {
  if (!storage || typeof storage.persist !== "function") {
    return { status: PERSISTENCE_STATES.UNSUPPORTED, granted: false, persisted: false };
  }
  try {
    const granted = Boolean(await storage.persist());
    return {
      status: granted ? PERSISTENCE_STATES.GRANTED : PERSISTENCE_STATES.DENIED,
      granted,
      persisted: granted
    };
  } catch (error) {
    return {
      status: PERSISTENCE_STATES.UNKNOWN,
      granted: false,
      persisted: false,
      error
    };
  }
}

export function markStorageWrite(health, { durable = false, now = safeNowIso(), temporary = false } = {}) {
  const next = { ...health };
  if (durable) {
    next.mode = STORAGE_MODES.DURABLE;
    next.temporaryDirty = false;
    next.checkpointMutations = 0;
    next.checkpointPromptAt = null;
    next.lastDurableSaveAt = now;
    next.recoveryRequired = false;
  } else if (temporary || next.mode !== STORAGE_MODES.DURABLE) {
    next.temporaryDirty = true;
    next.checkpointMutations += 1;
    if (!next.backupOfferedAt) next.backupOfferedAt = now;
    if (!next.checkpointPromptAt)
      next.checkpointPromptAt = new Date(Date.parse(now) + CHECKPOINT_PROMPT_MS).toISOString();
  }
  return next;
}

export function markCheckpointPrompt(health, now = safeNowIso()) {
  return {
    ...health,
    lastCheckpointPromptAt: now,
    checkpointPromptCount: (health.checkpointPromptCount ?? 0) + 1,
    backupPromptedAt: now,
    checkpointPromptAt: new Date(Date.parse(now) + CHECKPOINT_PROMPT_MS).toISOString()
  };
}

export function shouldPromptCheckpoint(health, now = Date.now()) {
  if (health.mode !== STORAGE_MODES.TEMPORARY || !health.temporaryDirty) return false;
  if (health.recoveryRequired) return false;
  const thresholdReached = (health.checkpointMutations ?? 0) >= CHECKPOINT_PROMPT_MUTATIONS;
  const due = health.checkpointPromptAt ? Date.parse(health.checkpointPromptAt) <= now : false;
  return Boolean(health.acknowledged) && (thresholdReached || due);
}

export function startTemporaryEpisode(
  health,
  { reasonCode, message, degradedAt = safeNowIso(), marker = null } = {}
) {
  const recoveryRequired = Boolean(marker?.temporaryDirty || marker?.recoveryRequired);
  return {
    ...health,
    mode: recoveryRequired ? STORAGE_MODES.RECOVERY_REQUIRED : STORAGE_MODES.TEMPORARY,
    reasonCode: reasonCode ?? health.reasonCode ?? null,
    message: message ?? health.message ?? "",
    degradedAt,
    temporaryDirty: Boolean(marker?.temporaryDirty),
    lastDurableSaveAt: marker?.lastDurableSaveAt ?? health.lastDurableSaveAt ?? null,
    acknowledged: false,
    backupOfferedAt: marker?.backupOfferedAt ?? null,
    backupPromptedAt: null,
    recoveryRequired,
    markerSeen: Boolean(marker),
    markerKnown: true,
    markerDetectedAt: marker ? degradedAt : (health.markerDetectedAt ?? null),
    recoveryDisposition: null,
    recoveryStartedAt: null,
    recoveryFinishedAt: null,
    checkpointMutations: 0,
    checkpointPromptAt: null,
    lastCheckpointPromptAt: null,
    checkpointPromptCount: 0
  };
}

export function startRecovering(health, now = safeNowIso()) {
  return {
    ...health,
    mode: STORAGE_MODES.RECOVERING,
    recoveryStartedAt: now
  };
}

export function finishRecovery(health, { now = safeNowIso(), durable = true } = {}) {
  return {
    ...health,
    mode: durable ? STORAGE_MODES.DURABLE : health.mode,
    recoveryFinishedAt: now,
    recoveryRequired: false,
    temporaryDirty: durable ? false : health.temporaryDirty,
    checkpointMutations: durable ? 0 : health.checkpointMutations,
    checkpointPromptAt: durable ? null : health.checkpointPromptAt,
    lastCheckpointPromptAt: durable ? null : health.lastCheckpointPromptAt,
    checkpointPromptCount: durable ? 0 : health.checkpointPromptCount
  };
}

export function acknowledgeStorageRisk(health, now = safeNowIso()) {
  return {
    ...health,
    acknowledged: true,
    recoveryDisposition: health.recoveryDisposition ?? null,
    backupPromptedAt: health.backupPromptedAt ?? now
  };
}

export function clearTemporaryDirty(health) {
  return {
    ...health,
    temporaryDirty: false,
    checkpointMutations: 0,
    checkpointPromptAt: null
  };
}
