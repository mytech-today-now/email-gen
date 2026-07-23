import { makeId, nowIso, STORE_DEFINITIONS, VERSIONS } from "./modules/constants.js";
import { createSplitPane } from "./modules/splitPane.js";
import { columnUnion, displayCell, flattenRecord, sortAndFilterRecords } from "./modules/records.js";
import {
  analyzeTemplate,
  parseTemplateVariables,
  renderTemplate,
  safeTemplateName
} from "./modules/templates.js";
import {
  composeCanonicalEmail,
  composeMailtoHref,
  hasRenderableResult,
  makeEml,
  resolveResultOutput,
  renderStandaloneDocument,
  sanitizeEditedEmail
} from "./modules/emailPipeline.js";
import {
  buildRestorePreviewText,
  createBackup,
  createEncryptedBackup,
  downloadBlob,
  inspectBackup,
  previewRestore,
  resolveBackupArchive,
  restoreBackup
} from "./modules/backup.js";
import { streamArchive } from "./modules/archive.js";
import { createBrowserLogger } from "./modules/logger.js";
import { TemporaryRepository, classifyStorageFailure, openBrowserRepository } from "./modules/storage.js";
import {
  PERSISTENCE_STATES,
  STORAGE_MODES,
  acknowledgeStorageRisk,
  clearContinuityMarker,
  clearTemporaryDirty,
  createStorageHealthState,
  finishRecovery,
  markCheckpointPrompt,
  markStorageWrite,
  readContinuityMarker,
  readPersistenceStatus,
  requestPersistenceStatus,
  shouldPromptCheckpoint,
  startRecovering,
  startTemporaryEpisode,
  writeContinuityMarker
} from "./modules/storageSafety.js";
import {
  RESEND_REVIEW_TTL_MS,
  buildResendPreflight,
  buildResendReviewFingerprint
} from "./modules/resendReview.js";
import {
  createOperationCoordinator,
  operationIsBlocking,
  operationOwnerLabel,
  operationStatusLabel,
  withBrowserExclusiveLock
} from "./modules/operationCoordinator.js";
import {
  gatewayRequestIdentity,
  processScopeIdentity,
  resendScopeIdentity,
  restoreScopeIdentity,
  stableTabId
} from "./modules/operationIdentity.js";
import {
  isTerminalProviderBatchOperation,
  providerBatchProcessButtonState,
  providerBatchOperationCanRetry,
  providerBatchOperationSummary,
  providerBatchOperationStatusLabel,
  providerBatchRequestKey,
  providerBatchResolvePayload,
  providerBatchSubmitPayload,
  shouldAttemptProviderBatchResolve
} from "./modules/providerBatchState.js";
import {
  EDITOR_PANEL_CONFIG,
  clampEditorPanelHeight,
  collapsedEditorPanelHeight,
  fitEditorPanelHeight,
  normalizeEditorPanelState,
  resizeStep,
  summarizeHtml,
  viewportHeightLimit
} from "./modules/editorPanels.js";

const $ = (id) => document.getElementById(id);
const debounce = (callback, delay = 120) => {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => callback(...args), delay);
  };
};
const DEFAULT_SETTINGS = Object.freeze({
  key: "application",
  activeProjectId: null,
  selectedModel: null,
  executionMode: "auto",
  businessName: "Local AI SMS",
  businessSignature: "Best,\nKyle",
  businessUrl: "https://example.com/ai-sms",
  companyAddress: "",
  modelCacheTtlHours: 24,
  openrouterReferer: "",
  ollamaHost: "http://127.0.0.1:11434",
  confirmedCustomOllamaHost: false,
  customBaseUrl: "",
  confirmedCustomProviderHost: false,
  resendFromName: "",
  resendFromAddress: "",
  resendReplyTo: "",
  resendTestRecipient: "",
  resendBatchSize: 100,
  resendUnsubscribeUrl: "",
  logLevel: "info",
  reducedMotion: false,
  highContrast: false,
  walkthroughVersion: 0,
  editorHeight: 480,
  editorPanels: { raw: 540, preview: 560 },
  recordColumns: {},
  resultColumns: {},
  updatedAt: null
});

const state = {
  repository: null,
  bootstrap: null,
  storageHealth: createStorageHealthState(),
  settings: { ...DEFAULT_SETTINGS },
  logger: null,
  credentialStatus: [],
  projects: [],
  records: [],
  templates: [],
  addenda: [],
  models: [],
  providerStatus: [],
  results: [],
  jobs: [],
  operations: [],
  activeProjectId: null,
  activeRecordId: null,
  activeTemplateId: null,
  activeResultId: null,
  selectedRecordIds: new Set(),
  selectedResultIds: new Set(),
  templateBaseline: "",
  templateDirty: false,
  resultDirty: false,
  recordPage: 1,
  recordSort: { key: "displayName", direction: "asc" },
  resultSort: { key: "updatedAt", direction: "desc" },
  editorPanelResize: null,
  visualRoot: null,
  visualEditor: null,
  resultPanelSyncing: false,
  visualEditorSyncing: false,
  processing: null,
  tabId: stableTabId(),
  operationCoordinator: null,
  providerBatchMonitors: new Map(),
  archiveTask: null,
  configurationDirty: false,
  configurationSnapshot: null,
  activeConfigurationSection: "settingsGeneral",
  walkthroughIndex: 0,
  storageBootstrapInProgress: false,
  storageRecoveryInFlight: null,
  storageCheckpointTimer: null
};

const PROVIDER_BATCH_POLL_INTERVAL_MS = 5000;
const OPERATION_OBSERVE_POLL_MS = 2000;

const RESULT_COLUMNS = Object.freeze([
  ["record", "Record"],
  ["contact", "Contact"],
  ["status", "Status"],
  ["subject", "Subject"],
  ["provider", "Provider / model"],
  ["updatedAt", "Updated"],
  ["delivery", "Delivery"]
]);

const RUNTIME_CREDENTIAL_FIELDS = Object.freeze([
  {
    id: "openai",
    inputId: "openaiKeySetting",
    statusId: "openaiCredentialStatus",
    toggleId: "toggleOpenaiKeyButton",
    testButtonId: "testOpenaiCredentialButton",
    clearButtonId: "clearOpenaiCredentialButton"
  },
  {
    id: "anthropic",
    inputId: "anthropicKeySetting",
    statusId: "anthropicCredentialStatus",
    toggleId: "toggleAnthropicKeyButton",
    testButtonId: "testAnthropicCredentialButton",
    clearButtonId: "clearAnthropicCredentialButton"
  },
  {
    id: "xai",
    inputId: "xaiKeySetting",
    statusId: "xaiCredentialStatus",
    toggleId: "toggleXaiKeyButton",
    testButtonId: "testXaiCredentialButton",
    clearButtonId: "clearXaiCredentialButton"
  },
  {
    id: "venice",
    inputId: "veniceKeySetting",
    statusId: "veniceCredentialStatus",
    toggleId: "toggleVeniceKeyButton",
    testButtonId: "testVeniceCredentialButton",
    clearButtonId: "clearVeniceCredentialButton"
  },
  {
    id: "lumaai",
    inputId: "lumaaiKeySetting",
    statusId: "lumaaiCredentialStatus",
    toggleId: "toggleLumaaiKeyButton",
    testButtonId: "testLumaaiCredentialButton",
    clearButtonId: "clearLumaaiCredentialButton"
  },
  {
    id: "custom",
    inputId: "customKeySetting",
    statusId: "customCredentialStatus",
    toggleId: "toggleCustomKeyButton",
    testButtonId: "testCustomCredentialButton",
    clearButtonId: "clearCustomCredentialButton"
  },
  {
    id: "openrouter",
    inputId: "openrouterKeySetting",
    statusId: "openrouterCredentialStatus",
    toggleId: "toggleOpenrouterKeyButton",
    testButtonId: "testOpenRouterButton",
    clearButtonId: "clearOpenrouterCredentialButton"
  },
  {
    id: "resend",
    inputId: "resendKeySetting",
    statusId: "resendCredentialStatus",
    toggleId: "toggleResendKeyButton",
    testButtonId: "testResendButton",
    clearButtonId: "clearResendCredentialButton"
  },
  {
    id: "brave-search",
    inputId: "braveKeySetting",
    statusId: "braveCredentialStatus",
    toggleId: "toggleBraveKeyButton",
    testButtonId: "testBraveCredentialButton",
    clearButtonId: "clearBraveCredentialButton"
  },
  {
    id: "resend-webhook",
    inputId: "resendWebhookSecretSetting",
    statusId: "resendWebhookCredentialStatus",
    toggleId: "toggleResendWebhookSecretButton",
    testButtonId: null,
    clearButtonId: "clearResendWebhookCredentialButton"
  }
]);

const RUNTIME_CREDENTIAL_FIELD_BY_ID = new Map(RUNTIME_CREDENTIAL_FIELDS.map((field) => [field.id, field]));

function announce(message) {
  $("ariaLive").textContent = "";
  requestAnimationFrame(() => {
    $("ariaLive").textContent = message;
  });
}

function setStatus(message, isError = false) {
  $("statusLine").textContent = message;
  $("statusLine").dataset.error = String(isError);
  if (isError) console.error(message);
  announce(message);
}

function storageModeLabel(mode = state.storageHealth.mode) {
  if (mode === STORAGE_MODES.DURABLE) return "durable";
  if (mode === STORAGE_MODES.TEMPORARY) return "temporary";
  if (mode === STORAGE_MODES.RECOVERING) return "recovering";
  if (mode === STORAGE_MODES.RECOVERY_REQUIRED) return "recovery required";
  return "initializing";
}

function storageModeStatusMessage(mode = state.storageHealth.mode) {
  if (mode === STORAGE_MODES.DURABLE) return "durable storage verified";
  if (mode === STORAGE_MODES.TEMPORARY) return "temporary in-memory storage active";
  if (mode === STORAGE_MODES.RECOVERY_REQUIRED) return "recovery required";
  return "Starting…";
}

function storageMainLocked() {
  return (
    state.storageHealth.mode === STORAGE_MODES.RECOVERING ||
    state.storageHealth.mode === STORAGE_MODES.RECOVERY_REQUIRED ||
    (state.storageHealth.mode === STORAGE_MODES.TEMPORARY && !state.storageHealth.acknowledged)
  );
}

function syncStorageMarker() {
  if (!state.storageHealth.temporaryDirty && !state.storageHealth.recoveryRequired) {
    clearContinuityMarker();
    return;
  }
  writeContinuityMarker(state.storageHealth);
}

function updateStorageGateUi() {
  const main = $("mainContent");
  if (main) main.toggleAttribute("inert", storageMainLocked());

  const banner = $("storageBanner");
  if (!banner) return;
  const health = state.storageHealth;
  const shouldShow = health.mode !== STORAGE_MODES.DURABLE || health.recoveryRequired || health.markerSeen;
  banner.hidden = !shouldShow;
  banner.dataset.mode = health.mode;
  banner.dataset.locked = String(storageMainLocked());
  if (!shouldShow) return;
  $("storageBannerHeading").textContent =
    health.mode === STORAGE_MODES.RECOVERY_REQUIRED
      ? "Recovery required"
      : health.mode === STORAGE_MODES.RECOVERING
        ? "Recovering durable storage"
        : "Stored temporarily - not saved to durable storage";
  $("storageBannerBody").textContent =
    health.mode === STORAGE_MODES.RECOVERY_REQUIRED
      ? `${health.message || "A previous temporary-storage episode or interrupted recovery was detected."} Review the available data before continuing.`
      : health.mode === STORAGE_MODES.RECOVERING
        ? `${health.message || "Durable storage is being restored."} Conflicting external actions are blocked until recovery finishes.`
        : health.message ||
          "Running in temporary mode; export before closing the page. Current work is stored only in memory and may be lost by closing, reloading, or browser eviction.";
  $("storageBannerReason").textContent = health.reasonCode
    ? `Reason: ${health.reasonCode}`
    : "Reason: unavailable";
  $("storageBannerDirty").textContent = health.temporaryDirty
    ? "Temporary data: dirty"
    : "Temporary data: clean";
  $("storageBannerDurable").textContent = health.lastDurableSaveAt
    ? `Last durable save: ${formatDate(health.lastDurableSaveAt)}`
    : "Last durable save: never";
  $("storageBannerPersistence").textContent = `Browser persistence: ${health.persistenceState}`;
  $("storageBannerAck").textContent = health.acknowledged
    ? "Acknowledged for this session."
    : "Acknowledgement required before local editing continues.";
  $("storageAcknowledgeButton").hidden = health.mode !== STORAGE_MODES.TEMPORARY || health.acknowledged;
  $("storageRetryButton").disabled = Boolean(state.storageRecoveryInFlight);
  $("storageRetryButton").textContent =
    health.mode === STORAGE_MODES.RECOVERY_REQUIRED ? "Review and retry" : "Retry durable storage";
  $("storageResolveButton").hidden = health.mode !== STORAGE_MODES.RECOVERY_REQUIRED;
  $("storageResolveButton").disabled = Boolean(state.storageRecoveryInFlight);
  $("storagePersistenceButton").hidden =
    health.persistenceState === PERSISTENCE_STATES.GRANTED ||
    health.persistenceState === PERSISTENCE_STATES.UNSUPPORTED;
  $("storageExportEncryptedButton").disabled = Boolean(state.storageRecoveryInFlight);
  $("storageBannerImportInput").disabled = Boolean(state.storageRecoveryInFlight);
  $("storageBannerExportInfo").textContent =
    health.backupOfferedAt || health.backupPromptedAt
      ? "An encrypted checkpoint backup has already been offered during this episode."
      : "Use an encrypted backup to preserve temporary work before closing.";
}

function updateStorageHealth(next, { persistMarker = true } = {}) {
  state.storageHealth = next;
  if (persistMarker) syncStorageMarker();
  updateStorageGateUi();
  renderStorageStatus();
}

function recordStorageMutation({ durable = false, meaningful = true, now = nowIso() } = {}) {
  if (state.resendPreflight && meaningful) {
    invalidateResendConfirmation("Browser data changed after resend preflight.");
  }
  if (durable) {
    state.storageHealth = markStorageWrite(state.storageHealth, { durable: true, now });
    state.storageHealth = clearTemporaryDirty(state.storageHealth);
    syncStorageMarker();
    updateStorageGateUi();
    renderStorageStatus();
    return;
  }
  if (state.storageHealth.mode === STORAGE_MODES.DURABLE) return;
  state.storageHealth = markStorageWrite(state.storageHealth, { temporary: true, now });
  if (!meaningful) {
    state.storageHealth.checkpointMutations = Math.max(0, state.storageHealth.checkpointMutations - 1);
  }
  syncStorageMarker();
  updateStorageGateUi();
  renderStorageStatus();
  if (shouldPromptCheckpoint(state.storageHealth)) {
    state.storageHealth = markCheckpointPrompt(state.storageHealth, now);
    syncStorageMarker();
    updateStorageGateUi();
    setStatus("Temporary work is dirty. Create an encrypted backup now.", true);
  }
}

function handleRepositoryWriteComplete(details = {}) {
  if (state.storageBootstrapInProgress) return;
  const durable = Boolean(state.repository && !state.repository.temporary);
  if (durable) {
    state.storageHealth = finishRecovery(state.storageHealth, { durable: true, now: nowIso() });
    syncStorageMarker();
    updateStorageGateUi();
    renderStorageStatus();
    return;
  }
  const store = Array.isArray(details.store) ? details.store.join(",") : String(details.store || "");
  if (!store || ["logs", "meta"].includes(store)) return;
  state.storageHealth = {
    ...state.storageHealth,
    temporaryDirty: true,
    backupOfferedAt: state.storageHealth.backupOfferedAt ?? nowIso()
  };
  syncStorageMarker();
  updateStorageGateUi();
  renderStorageStatus();
}

function currentStoragePersistenceState() {
  return state.storageHealth.persistenceState || PERSISTENCE_STATES.UNKNOWN;
}

function canRunExternalAction() {
  return state.storageHealth.mode === STORAGE_MODES.DURABLE;
}

function canRunLocalMutableAction() {
  return (
    state.storageHealth.mode === STORAGE_MODES.DURABLE ||
    (state.storageHealth.mode === STORAGE_MODES.TEMPORARY && state.storageHealth.acknowledged)
  );
}

function assertStorageGate(kind, _actionLabel) {
  const messageMap = {
    external:
      "Browser storage is not durable yet. Paid or external actions are blocked until durable storage is verified.",
    local:
      "Browser storage is temporarily unavailable. Acknowledge the warning before continuing local edits.",
    irreversible: "Irreversible actions are blocked until durable storage is restored.",
    recovery: "Recovery is in progress. Wait for durable storage to finish recovering before continuing."
  };
  const allowed =
    kind === "external"
      ? canRunExternalAction()
      : kind === "local"
        ? canRunLocalMutableAction()
        : kind === "recovery"
          ? state.storageHealth.mode !== STORAGE_MODES.RECOVERING
          : state.storageHealth.mode === STORAGE_MODES.DURABLE;
  if (allowed) return;
  throw appError(
    kind === "external"
      ? "STORAGE_EXTERNAL_ACTION_BLOCKED"
      : kind === "irreversible"
        ? "STORAGE_IRREVERSIBLE_ACTION_BLOCKED"
        : kind === "recovery"
          ? "STORAGE_RECOVERY_BLOCKED"
          : "STORAGE_LOCAL_ACTION_BLOCKED",
    messageMap[kind] || "This action is blocked until storage is safe to use.",
    {
      mode: state.storageHealth.mode,
      acknowledged: state.storageHealth.acknowledged,
      persistenceState: currentStoragePersistenceState()
    }
  );
}

async function snapshotRepositoryStores(repository = state.repository) {
  const stores = Object.keys(STORE_DEFINITIONS);
  try {
    return await repository.snapshot(stores);
  } catch {
    return null;
  }
}

function appStateSnapshot() {
  return {
    meta: [],
    projects: structuredClone(state.projects ?? []),
    records: structuredClone(state.records ?? []),
    templates: structuredClone(state.templates ?? []),
    templateVersions: structuredClone(
      state.templates.flatMap((template) => template.versions ?? []).filter(Boolean)
    ),
    addenda: structuredClone(state.addenda ?? []),
    results: structuredClone(state.results ?? []),
    resultVersions: [],
    jobs: structuredClone(state.jobs ?? []),
    operations: structuredClone(state.operations ?? []),
    researchCache: [],
    contacts: [],
    modelCatalog: structuredClone(state.models ?? []),
    providerStatus: structuredClone(state.providerStatus ?? []),
    settings: [structuredClone(state.settings ?? DEFAULT_SETTINGS)],
    deliveryHistory: [],
    suppressions: [],
    artifacts: [],
    logs: []
  };
}

async function bindRepository(repository) {
  repository.onWriteComplete = handleRepositoryWriteComplete;
  repository.onFatalFailure = (error) => {
    void transitionToTemporaryMode(error);
  };
  return repository;
}

async function activateRepository(repository) {
  await state.operationCoordinator?.close?.().catch(() => {});
  state.repository = await bindRepository(repository);
  state.operationCoordinator = createOperationCoordinator({
    repository: state.repository,
    tabId: state.tabId,
    pollMs: OPERATION_OBSERVE_POLL_MS
  });
  state.operationCoordinator.observe(() => refreshOperationSnapshot().catch(() => {}));
  state.logger = createBrowserLogger(state.repository, api);
  return state.repository;
}

async function transitionToTemporaryMode(error) {
  if (state.storageRecoveryInFlight) return state.storageRecoveryInFlight;
  state.storageRecoveryInFlight = (async () => {
    const classified = classifyStorageFailure(error, error?.stage || "runtime");
    const marker = readContinuityMarker();
    const nextHealth = startTemporaryEpisode(state.storageHealth, {
      reasonCode: classified.code || error?.code || "BROWSER_STORAGE_FAILED",
      message: classified.message || error?.message || "Browser storage is unavailable.",
      marker,
      degradedAt: nowIso()
    });
    nextHealth.temporaryDirty = true;
    nextHealth.backupOfferedAt = nextHealth.backupOfferedAt ?? nowIso();
    nextHealth.checkpointMutations = Math.max(nextHealth.checkpointMutations ?? 0, 1);
    updateStorageHealth(nextHealth, { persistMarker: false });
    writeContinuityMarker(state.storageHealth);
    setStatus(state.storageHealth.message || "Browser storage is unavailable.", true);

    const snapshot = (await snapshotRepositoryStores().catch(() => null)) || appStateSnapshot();
    await state.logger?.flush?.({ force: true }).catch(() => {});

    const fallback = new TemporaryRepository(classified);
    await fallback.atomicRestore(snapshot, "replace").catch(() => {});
    await activateRepository(fallback);
    const activatedHealth = startTemporaryEpisode(state.storageHealth, {
      reasonCode: classified.code || error?.code || "BROWSER_STORAGE_FAILED",
      message: classified.message || error?.message || "Browser storage is unavailable.",
      marker,
      degradedAt: nowIso()
    });
    activatedHealth.temporaryDirty = true;
    activatedHealth.backupOfferedAt = activatedHealth.backupOfferedAt ?? nowIso();
    activatedHealth.checkpointMutations = Math.max(activatedHealth.checkpointMutations ?? 0, 1);
    state.storageHealth = activatedHealth;
    writeContinuityMarker(state.storageHealth);
    updateStorageGateUi();
    renderAll();
  })();
  return state.storageRecoveryInFlight.finally(() => {
    state.storageRecoveryInFlight = null;
  });
}

function snapshotHasData(snapshot) {
  return Boolean(
    snapshot && Object.values(snapshot).some((value) => Array.isArray(value) && value.length > 0)
  );
}

function snapshotsEquivalent(left, right) {
  return JSON.stringify(left ?? {}) === JSON.stringify(right ?? {});
}

async function acknowledgeTemporaryStorage() {
  if (state.storageHealth.mode !== STORAGE_MODES.TEMPORARY) return;
  updateStorageHealth(acknowledgeStorageRisk(state.storageHealth, nowIso()));
  setStatus("Temporary storage risk acknowledged for this session.");
}

async function resolveRecoveryWarning() {
  if (state.repository?.temporary) {
    setStatus("Durable storage must be available before this recovery warning can be cleared.", true);
    return;
  }
  clearContinuityMarker();
  const recoveredAt = nowIso();
  state.storageHealth = finishRecovery(state.storageHealth, { durable: true, now: recoveredAt });
  state.storageHealth = {
    ...state.storageHealth,
    mode: STORAGE_MODES.DURABLE,
    recoveryRequired: false,
    markerSeen: false,
    acknowledged: false,
    reasonCode: null,
    message: "Recovery warning cleared after user confirmation.",
    lastDurableSaveAt: recoveredAt
  };
  updateStorageGateUi();
  renderStorageStatus();
  setStatus("Recovery warning cleared after user confirmation.");
}

async function retryDurableStorage() {
  if (state.storageRecoveryInFlight) return state.storageRecoveryInFlight;
  state.storageRecoveryInFlight = (async () => {
    const marker = readContinuityMarker();
    const priorDirty = Boolean(state.storageHealth.temporaryDirty || state.storageHealth.recoveryRequired);
    updateStorageHealth(startRecovering(state.storageHealth, nowIso()), { persistMarker: false });
    setStatus("Retrying durable storage…");
    const sourceSnapshot = (await snapshotRepositoryStores().catch(() => null)) || appStateSnapshot();
    const nextRepository = await openBrowserRepository();
    if (nextRepository.temporary) {
      const reason =
        nextRepository.reason || classifyStorageFailure(new Error("Browser storage unavailable."), "open");
      const fallback = new TemporaryRepository(reason);
      await fallback.atomicRestore(sourceSnapshot, "replace").catch(() => {});
      await activateRepository(fallback);
      const activatedHealth = startTemporaryEpisode(state.storageHealth, {
        reasonCode: reason.code || "STORAGE_UNAVAILABLE",
        message: reason.message || "Browser storage is unavailable.",
        marker,
        degradedAt: nowIso()
      });
      if (priorDirty) {
        activatedHealth.temporaryDirty = true;
        activatedHealth.backupOfferedAt = activatedHealth.backupOfferedAt ?? nowIso();
        activatedHealth.checkpointMutations = Math.max(activatedHealth.checkpointMutations ?? 0, 1);
      }
      state.storageHealth = activatedHealth;
      writeContinuityMarker(state.storageHealth);
      updateStorageGateUi();
      renderAll();
      setStatus(state.storageHealth.message || "Browser storage is unavailable.", true);
      return false;
    }

    const durableSnapshot = await nextRepository.snapshot(Object.keys(STORE_DEFINITIONS)).catch(() => ({}));
    const canMigrate =
      !snapshotHasData(sourceSnapshot) ||
      !snapshotHasData(durableSnapshot) ||
      snapshotsEquivalent(sourceSnapshot, durableSnapshot);
    if (!canMigrate) {
      nextRepository.close?.();
      const conflictHealth = startTemporaryEpisode(state.storageHealth, {
        reasonCode: "STORAGE_RECOVERY_CONFLICT",
        message:
          "Durable storage already contains different data. Export the temporary snapshot or import a backup before retrying.",
        marker,
        degradedAt: nowIso()
      });
      conflictHealth.mode = STORAGE_MODES.RECOVERY_REQUIRED;
      conflictHealth.recoveryRequired = true;
      conflictHealth.markerSeen = true;
      conflictHealth.temporaryDirty = true;
      conflictHealth.backupOfferedAt = conflictHealth.backupOfferedAt ?? nowIso();
      conflictHealth.checkpointMutations = Math.max(conflictHealth.checkpointMutations ?? 0, 1);
      updateStorageHealth(conflictHealth, { persistMarker: false });
      writeContinuityMarker(state.storageHealth);
      updateStorageGateUi();
      renderAll();
      throw appError(
        "STORAGE_RECOVERY_CONFLICT",
        "Durable storage already contains different data. Export the temporary snapshot or import a backup before retrying."
      );
    }
    if (snapshotHasData(sourceSnapshot)) {
      await nextRepository.atomicRestore(sourceSnapshot, "replace");
      const verified = await nextRepository.snapshot(Object.keys(STORE_DEFINITIONS));
      if (!snapshotsEquivalent(sourceSnapshot, verified)) {
        nextRepository.close?.();
        const verifyHealth = startTemporaryEpisode(state.storageHealth, {
          reasonCode: "STORAGE_RECOVERY_VERIFICATION_FAILED",
          message: "Temporary data could not be verified after migration.",
          marker,
          degradedAt: nowIso()
        });
        verifyHealth.mode = STORAGE_MODES.RECOVERY_REQUIRED;
        verifyHealth.recoveryRequired = true;
        verifyHealth.markerSeen = true;
        verifyHealth.temporaryDirty = true;
        verifyHealth.backupOfferedAt = verifyHealth.backupOfferedAt ?? nowIso();
        verifyHealth.checkpointMutations = Math.max(verifyHealth.checkpointMutations ?? 0, 1);
        updateStorageHealth(verifyHealth, { persistMarker: false });
        writeContinuityMarker(state.storageHealth);
        updateStorageGateUi();
        renderAll();
        throw appError(
          "STORAGE_RECOVERY_VERIFICATION_FAILED",
          "Temporary data could not be verified after migration."
        );
      }
    }
    await activateRepository(nextRepository);
    await loadAllState();
    const recoveredAt = nowIso();
    state.storageHealth = finishRecovery(state.storageHealth, { durable: true, now: recoveredAt });
    state.storageHealth = {
      ...state.storageHealth,
      mode: STORAGE_MODES.DURABLE,
      temporaryDirty: false,
      recoveryRequired: false,
      markerSeen: false,
      acknowledged: false,
      reasonCode: null,
      message: "Durable storage restored and verified.",
      lastDurableSaveAt: recoveredAt
    };
    clearContinuityMarker();
    updateStorageGateUi();
    renderAll();
    setStatus("Durable storage restored and verified.");
    return true;
  })();
  return state.storageRecoveryInFlight.finally(() => {
    state.storageRecoveryInFlight = null;
  });
}

function formatArchiveBytes(bytes) {
  if (!Number.isFinite(bytes)) return "";
  const units = ["B", "KiB", "MiB", "GiB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 || unit === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}

function setArchiveControls(active, label = "archive") {
  const button = $("cancelArchiveButton");
  if (!button) return;
  button.hidden = !active;
  button.disabled = !active;
  button.textContent = active ? `Cancel ${label}` : "Cancel";
}

function beginArchiveTask(label) {
  if (state.archiveTask) {
    throw new Error("Another archive operation is already running.");
  }
  const controller = new AbortController();
  state.archiveTask = { label, controller };
  setArchiveControls(true, label);
  return controller;
}

function endArchiveTask() {
  state.archiveTask = null;
  setArchiveControls(false);
}

function cancelArchiveTask() {
  state.archiveTask?.controller.abort(new DOMException("Archive cancelled.", "AbortError"));
}

function archiveStatusMessage(label, progress = {}) {
  const parts = [label];
  if (progress.phase) parts.push(progress.phase);
  if (Number.isFinite(progress.entriesCompleted) && Number.isFinite(progress.entriesTotal)) {
    parts.push(`${progress.entriesCompleted}/${progress.entriesTotal} entries`);
  }
  if (Number.isFinite(progress.bytesRead)) parts.push(`${formatArchiveBytes(progress.bytesRead)} read`);
  if (Number.isFinite(progress.bytesWritten))
    parts.push(`${formatArchiveBytes(progress.bytesWritten)} written`);
  return parts.join(" · ");
}

function isArchiveCancelled(error) {
  return String(error?.code || "").toUpperCase() === "ARCHIVE_CANCELLED";
}

function retryAfterMs(response) {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
    const retryAt = Date.parse(retryAfter);
    if (Number.isFinite(retryAt)) return Math.max(0, retryAt - Date.now());
  }
  const resetSeconds = Number(response.headers.get("ratelimit-reset"));
  return Number.isFinite(resetSeconds) && resetSeconds >= 0 ? resetSeconds * 1000 : null;
}

async function api(path, options = {}) {
  const { logErrors = true, ...requestOptions } = options;
  const headers = new Headers(options.headers || {});
  if (!(requestOptions.body instanceof FormData) && requestOptions.body !== undefined)
    headers.set("content-type", "application/json");
  if (state.bootstrap?.csrfToken) headers.set("x-email-gen-csrf", state.bootstrap.csrfToken);
  if (state.tabId) headers.set("x-email-gen-tab-id", state.tabId);
  const response = await fetch(path, { ...requestOptions, headers });
  const type = response.headers.get("content-type") || "";
  const payload = type.includes("application/json") ? await response.json().catch(() => null) : response;
  if (!response.ok) {
    const error = new Error(payload?.error?.message || `HTTP ${response.status}`);
    error.code = payload?.error?.code || "HTTP_ERROR";
    error.status = response.status;
    error.requestId = payload?.error?.requestId;
    error.details = payload?.error?.details;
    error.retryAfterMs = retryAfterMs(response);
    if (logErrors) {
      console.error("API request failed", {
        path,
        status: error.status,
        code: error.code,
        requestId: error.requestId,
        retryAfterMs: error.retryAfterMs,
        message: error.message
      });
      state.logger?.error("api_request_failed", {
        path,
        status: error.status,
        code: error.code,
        requestId: error.requestId,
        retryAfterMs: error.retryAfterMs,
        message: error.message
      });
    }
    throw error;
  }
  return payload;
}

function activeProject() {
  return state.projects.find((item) => item.id === state.activeProjectId) ?? null;
}

function projectRecords() {
  return state.records.filter((item) => item.projectId === state.activeProjectId);
}

function projectResults({ includeTrash = true } = {}) {
  return state.results.filter(
    (item) => item.projectId === state.activeProjectId && (includeTrash || !item.trashed)
  );
}

function activeRecord() {
  return projectRecords().find((item) => item.id === state.activeRecordId) ?? projectRecords()[0] ?? null;
}

function activeTemplate() {
  return state.templates.find((item) => item.id === state.activeTemplateId) ?? null;
}

function activeResult() {
  return projectResults().find((item) => item.id === state.activeResultId) ?? null;
}

function blockingOperations(kind = null) {
  return state.operations
    .filter((operation) => operationIsBlocking(operation) && (!kind || operation.kind === kind))
    .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)));
}

function latestBlockingOperation(kind = null) {
  return blockingOperations(kind)[0] ?? null;
}

function selectedModel() {
  const selection = state.settings.selectedModel;
  return selection ? (state.models.find((item) => item.id === selection) ?? null) : null;
}

function selectedAddendum() {
  return $("addendumEnabled")?.checked
    ? (state.addenda.find((item) => item.id === $("addendumSelect").value) ?? null)
    : null;
}

function normalizeExecutionSetting(value) {
  return ["auto", "provider-batch", "standard"].includes(value) ? value : "auto";
}

function modelBatchCapability(model = selectedModel()) {
  return model?.pricing?.batch ?? null;
}

function supportsNativeDiscountedBatch(model = selectedModel()) {
  const batch = modelBatchCapability(model);
  return batch?.classification === "native_discounted_batch" && batch.supported !== false;
}

function resolveExecutionPlan(model = selectedModel(), requested = state.settings.executionMode) {
  const normalized = normalizeExecutionSetting(requested);
  const batch = modelBatchCapability(model);
  if (normalized === "provider-batch") {
    if (!supportsNativeDiscountedBatch(model)) {
      throw appError(
        "BATCH_MODE_UNAVAILABLE",
        batch?.reason || "The selected model does not have verified discounted provider-batch support.",
        { provider: model?.providerId, model: model?.providerModelId, classification: batch?.classification },
        "batch-capability"
      );
    }
    return { requested: normalized, mode: "provider-batch", batch };
  }
  if (normalized === "auto" && supportsNativeDiscountedBatch(model)) {
    return { requested: normalized, mode: "provider-batch", batch };
  }
  return { requested: normalized, mode: "standard", batch };
}

function escapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]
  );
}

function renderRawSyntaxHtml(value) {
  const source = String(value ?? "");
  try {
    const highlighted = globalThis.hljs?.highlight?.(source, {
      language: "xml",
      ignoreIllegals: true
    });
    if (highlighted?.value) return { highlighted: true, html: highlighted.value };
  } catch {
    // Fall back to escaped HTML if the syntax highlighter fails.
  }
  return { highlighted: false, html: escapeHtml(source) };
}

function formatDate(value) {
  if (!value) return "Never";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "Unknown" : date.toLocaleString();
}

function appError(code, message, details = undefined, stage = undefined) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  error.stage = stage;
  return error;
}

function withRevision(record) {
  return record ? { ...record, revision: Number.isInteger(record.revision) ? record.revision : 0 } : record;
}

async function updateRevisionedRecord(
  store,
  key,
  updater,
  { conflictCode, conflictMessage, notFoundMessage } = {}
) {
  const current = await state.repository.get(store, key);
  if (!current) {
    throw appError(conflictCode || "RECORD_NOT_FOUND", notFoundMessage || `${store} record was not found.`, {
      store,
      key
    });
  }
  const latest = withRevision(current);
  const next = updater(latest);
  try {
    return await state.repository.compareAndSwap(store, key, latest.revision, next);
  } catch (error) {
    if (error?.code === "REVISION_CONFLICT") {
      throw appError(
        conflictCode || "REVISION_CONFLICT",
        conflictMessage ||
          `This ${store.slice(0, -1)} changed in another tab. Reload and review the latest version.`,
        {
          store,
          key,
          latest: error.latest ?? null
        }
      );
    }
    throw error;
  }
}

async function persistRevisionedRecord(store, record, { conflictCode, conflictMessage } = {}) {
  const keyPath = STORE_DEFINITIONS[store]?.keyPath || "id";
  const key = record?.[keyPath];
  if (key == null) {
    throw appError(conflictCode || "RECORD_NOT_FOUND", `Cannot save ${store} without a primary key.`, {
      store
    });
  }
  const next = withRevision(record);
  try {
    return await state.repository.compareAndSwap(store, key, next.revision, next);
  } catch (error) {
    if (error?.code === "REVISION_CONFLICT") {
      throw appError(
        conflictCode || "REVISION_CONFLICT",
        conflictMessage ||
          `This ${store.slice(0, -1)} changed in another tab. Reload and review the latest version.`,
        {
          store,
          key,
          latest: error.latest ?? null
        }
      );
    }
    throw error;
  }
}

function upsertLocalResult(saved) {
  const normalized = normalizeStoredResult(saved);
  const index = state.results.findIndex((item) => item.id === normalized.id);
  if (index >= 0) state.results[index] = normalized;
  else state.results.unshift(normalized);
  return normalized;
}

function normalizeStoredResult(result) {
  if (!result) return result;
  const resolved = resolveResultOutput(result);
  return {
    ...result,
    subject: resolved.subject,
    finalEmailHtml: resolved.finalEmailHtml,
    finalText: resolved.finalText,
    originalAiBodyHtml: result.originalAiBodyHtml ?? result.bodyHtml ?? resolved.finalEmailHtml
  };
}

function phoneDisplay(value) {
  const display = String(value ?? "")
    .replace(/[\r\n]/g, " ")
    .trim();
  return display.replace(/[^\d]/g, "").length >= 7 ? display : "";
}

function emailValue(value) {
  const email = String(value ?? "")
    .replace(/[\r\n]/g, "")
    .trim()
    .toLowerCase();
  return /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(email) ? email : "";
}

function phoneHref(value) {
  const display = phoneDisplay(value);
  if (!display) return "";
  const digits = display.replace(/[^\d]/g, "");
  return `tel:${display.startsWith("+") ? `+${digits}` : digits}`;
}

function websiteValue(value) {
  const candidate = String(value ?? "").trim();
  return /^https?:\/\//i.test(candidate) ? candidate : "";
}

function resultDraftContent(result) {
  if (!result) return { subject: "", body: "" };
  const resolved = normalizeStoredResult(result);
  if (activeResult()?.id !== result.id) {
    return { subject: resolved.subject || "", body: resolved.finalText || "" };
  }
  const subject = $("subjectInput")
    .value.replace(/[\r\n]/g, " ")
    .trim()
    .slice(0, 160);
  const source = $("bodyInput").value.trim();
  if (!source) return { subject, body: resolved.finalText || "" };
  try {
    return { subject, body: sanitizeEditedEmail(source).text };
  } catch {
    return { subject, body: resolved.finalText || "" };
  }
}

function hrefForContactCandidate(contact, result = null) {
  if (contact?.type === "email") {
    return composeMailtoHref({
      email: emailValue(contact.value),
      ...resultDraftContent(result)
    });
  }
  if (contact?.type === "phone") return phoneHref(contact.value);
  return websiteValue(contact?.value);
}

function contactClipboardLabel(contact) {
  if (contact?.type === "email") return "Email link";
  if (contact?.type === "phone") return "Phone link";
  return "Link";
}

function assertRenderableOutput(result, action = "used") {
  const resolved = normalizeStoredResult(result);
  if (!resolved)
    throw appError("RESULT_NOT_FOUND", "Select a result first.", undefined, "output-selection");
  if (resolved.status !== "completed") {
    throw appError(
      "RESULT_NOT_READY",
      `Only completed results with verified content can be ${action}.`,
      { resultId: resolved.id, status: resolved.status },
      "output-validation"
    );
  }
  if (!hasRenderableResult(resolved)) {
    throw appError(
      "RESULT_OUTPUT_INVALID",
      `This result cannot be ${action} because its subject or rendered HTML is missing.`,
      { resultId: resolved.id, status: resolved.status },
      "output-validation"
    );
  }
  return resolved;
}

function validateGatewayPayload(payload, record) {
  const generated = payload?.generated ?? {};
  const subject = String(generated.subject ?? "")
    .replace(/[\r\n]/g, " ")
    .trim();
  const bodyHtml = String(generated.bodyHtml ?? "").trim();
  if (!subject || !bodyHtml) {
    throw appError(
      "GATEWAY_RESPONSE_INVALID",
      `Generation for ${record.displayName || "this record"} returned an empty subject or body.`,
      { recordId: record.id, subjectPresent: Boolean(subject), bodyPresent: Boolean(bodyHtml) },
      "response-validation"
    );
  }
  return generated;
}

function formatBytes(value) {
  if (!Number.isFinite(value)) return "Unavailable";
  const units = ["B", "KB", "MB", "GB"];
  let number = value;
  let index = 0;
  while (number >= 1024 && index < units.length - 1) {
    number /= 1024;
    index += 1;
  }
  return `${number.toFixed(index ? 1 : 0)} ${units[index]}`;
}

const PROVIDER_PRICING_URLS = Object.freeze({
  openai: "https://developers.openai.com/api/docs/pricing",
  anthropic: "https://platform.claude.com/docs/en/about-claude/pricing",
  xai: "https://docs.x.ai/developers/pricing?utm_source=chatgpt.com",
  venice: "https://docs.venice.ai/overview/pricing",
  lumaai: "https://docs.lumalabs.ai/docs/modify-video",
  openrouter: "https://openrouter.ai/docs/api-reference/models/get-models",
  ollama: "https://docs.ollama.com/api/tags"
});

function formatPrice(value, pricing, field = "input") {
  if (pricing?.status === "local-compute") return "Local compute";
  if (pricing?.status === "variable") return "Variable";
  const display = field === "output" ? pricing?.outputDisplay : pricing?.inputDisplay;
  if (!Number.isFinite(value) && display) return display;
  return Number.isFinite(value) ? `$${value.toFixed(value < 1 ? 4 : 2)}` : "N/A";
}

function humanizeStatus(value, fallback = "Unavailable") {
  if (!value) return fallback;
  return String(value)
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function pluralize(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function formatPricingStatus(pricing) {
  return pricing?.status === "local-compute"
    ? "Local compute"
    : pricing?.status === "variable"
      ? "Variable"
      : humanizeStatus(pricing?.status, "N/A");
}

function formatUsd(value, digits = 4) {
  return Number.isFinite(value) ? `$${Number(value).toFixed(digits)}` : "N/A";
}

function formatCompatibility(model) {
  if (!model.compatibility?.compatible) {
    return model.compatibility?.reasons?.join(" ") || "Incompatible";
  }
  if (model.providerId === "ollama") return "Ready on localhost";
  if (!model.compatibility?.status || model.compatibility.status === "compatible") return "Compatible";
  return humanizeStatus(model.compatibility.status, "Compatible");
}

function modelPricingUrl(model) {
  return (
    model.pricing?.sourceUrl || PROVIDER_PRICING_URLS[model.providerId] || model.metadataSource?.url || null
  );
}

function unavailablePriceReference(value, pricing, field = "input") {
  if (pricing?.status === "local-compute" || pricing?.status === "variable") return false;
  const display = field === "output" ? pricing?.outputDisplay : pricing?.inputDisplay;
  return !Number.isFinite(value) && !display;
}

function wrapModelName(value) {
  const words = String(value ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length <= 2) return String(value ?? "");
  const lines = [];
  for (let index = 0; index < words.length; index += 2) {
    lines.push(words.slice(index, index + 2).join(" "));
  }
  return lines.join("\n");
}

function ollamaRuntimeState() {
  const status = state.providerStatus.find((item) => item.providerId === "ollama") ?? null;
  return {
    status: status?.status ?? "not-detected",
    models: state.models.filter(
      (model) => model.providerId === "ollama" && model.availability !== "unavailable"
    ),
    error: status?.error ?? null
  };
}

function formatOllamaStatus(result = ollamaRuntimeState()) {
  if (result?.error?.code === "OLLAMA_HOST_CONFIRMATION_REQUIRED") {
    return "Confirm the custom loopback host to connect.";
  }
  if (result?.error?.code === "OLLAMA_HOST_INVALID" || result?.error?.code === "OLLAMA_HOST_BLOCKED") {
    return result.error.message;
  }
  const modelCount = Array.isArray(result?.models) ? result.models.length : Number(result?.modelCount ?? 0);
  switch (result?.status) {
    case "detected":
      return modelCount
        ? `Ready on localhost · ${pluralize(modelCount, "model")} · No API key required`
        : "Connected to Ollama · No local models installed";
    case "unavailable":
      return result.error?.message || "Ollama is running but did not respond in time.";
    case "error":
      return result.error?.message || "Ollama detection failed.";
    case "not-detected":
    default:
      return "Not detected";
  }
}

function renderOllamaStatus(result = ollamaRuntimeState()) {
  $("ollamaStatusSetting").textContent = formatOllamaStatus(result);
}

function shouldAutoDetectOllama() {
  return (
    [DEFAULT_SETTINGS.ollamaHost, "http://localhost:11434", "http://[::1]:11434"].includes(
      String(state.settings.ollamaHost || "").trim()
    ) || state.settings.confirmedCustomOllamaHost === true
  );
}

function currentViewportHeight() {
  return globalThis.innerHeight || document.documentElement?.clientHeight || 0;
}

function editorPanelElement(panel) {
  return panel === "preview" ? $("visualEditorPane") : $("rawEditorPane");
}

function editorPanelHandle(panel) {
  return panel === "preview" ? $("visualResizeHandle") : $("rawResizeHandle");
}

function editorPanelStatus(panel) {
  return panel === "preview" ? $("visualPanelStatus") : $("rawPanelStatus");
}

function editorPanelHeight(panel) {
  const panels = state.settings.editorPanels ?? {};
  return clampEditorPanelHeight(panel, panels[panel], { viewportHeight: currentViewportHeight() });
}

function setEditorPanelMessage(message = "", level = "info") {
  const node = $("editorPanelMessage");
  node.textContent = message;
  node.hidden = !message;
  node.dataset.level = level;
}

function logEditor(level, event, metadata = {}) {
  state.logger?.[level]?.(event, { component: "result_editor", ...metadata }).catch(() => {});
}

function applyEditorPanelHeights() {
  for (const panel of ["raw", "preview"]) {
    const element = editorPanelElement(panel);
    if (!element) continue;
    const height = editorPanelHeight(panel);
    const limits = EDITOR_PANEL_CONFIG[panel];
    const maximum = viewportHeightLimit(panel, currentViewportHeight());
    element.style.setProperty("--editor-panel-height", `${height}px`);
    const handle = editorPanelHandle(panel);
    if (handle) {
      handle.setAttribute("aria-valuemin", String(limits.minHeight));
      handle.setAttribute("aria-valuemax", String(maximum));
      handle.setAttribute("aria-valuenow", String(height));
      handle.setAttribute("aria-valuetext", `${height} pixels`);
    }
    const status = editorPanelStatus(panel);
    if (status) status.textContent = `${EDITOR_PANEL_CONFIG[panel].label} height ${height}px`;
  }
}

function setEditorPanelAvailability(disabled) {
  ["raw", "preview"].forEach((panel) => {
    const element = editorPanelElement(panel);
    const handle = editorPanelHandle(panel);
    if (element) element.dataset.disabled = String(disabled);
    if (handle) {
      handle.tabIndex = disabled ? -1 : 0;
      handle.setAttribute("aria-disabled", String(disabled));
    }
    const controlMap = {
      raw: ["rawCollapseButton", "rawFitButton", "rawExpandButton"],
      preview: ["visualCollapseButton", "visualFitButton", "visualExpandButton"]
    };
    for (const id of controlMap[panel]) $(id).disabled = disabled;
  });
}

function recoverEditorPanelState(settings) {
  const normalized = normalizeEditorPanelState(settings?.editorPanels, {
    legacyHeight: settings?.editorHeight,
    viewportHeight: currentViewportHeight()
  });
  return {
    settings: {
      ...settings,
      editorPanels: normalized.panels
    },
    recovered: normalized.recovered
  };
}

function applyEditorPanelHeight(panel, height, { persist = false, announceSize = false } = {}) {
  const next = clampEditorPanelHeight(panel, height, { viewportHeight: currentViewportHeight() });
  const currentPanels = state.settings.editorPanels ?? {};
  const changed = currentPanels[panel] !== next;
  state.settings = {
    ...state.settings,
    editorPanels: { ...currentPanels, [panel]: next }
  };
  applyEditorPanelHeights();
  if (announceSize) announce(`${EDITOR_PANEL_CONFIG[panel].label} panel height ${next}px`);
  if (persist && changed) persistSettings({ editorPanels: state.settings.editorPanels }).catch(handleError);
  return next;
}

function measureEditorPanelContentHeight(panel) {
  try {
    if (panel === "raw") {
      const rawFindHeight = $("rawFindToolbar")?.offsetHeight ?? 0;
      const syntaxHeight = Math.min($("rawSyntaxPreview")?.scrollHeight ?? 0, 160);
      return ($("bodyInput")?.scrollHeight ?? 0) + rawFindHeight + syntaxHeight + 32;
    }
    return (state.visualEditor?.scrollHeight ?? $("visualEditorHost")?.scrollHeight ?? 0) + 32;
  } catch (error) {
    logEditor("warn", "editor_panel_measure_failed", {
      panel,
      message: error.message
    });
    return editorPanelHeight(panel);
  }
}

function adjustEditorPanel(panel, action) {
  const current = editorPanelHeight(panel);
  const options = { viewportHeight: currentViewportHeight() };
  const next =
    action === "collapse"
      ? collapsedEditorPanelHeight(panel, options)
      : action === "fit"
        ? fitEditorPanelHeight(panel, measureEditorPanelContentHeight(panel), options)
        : action === "expand"
          ? viewportHeightLimit(panel, currentViewportHeight())
          : resizeStep(panel, action === "shrink" ? -1 : 1, current, options);
  const applied = applyEditorPanelHeight(panel, next, {
    announceSize: true,
    persist: true,
    source: action
  });
  logEditor("info", "editor_panel_action", {
    action,
    panel,
    height: applied
  });
}

function endEditorPanelResize(reason = "pointerup") {
  const interaction = state.editorPanelResize;
  if (!interaction) return;
  state.editorPanelResize = null;
  const handle = editorPanelHandle(interaction.panel);
  handle?.classList.remove("is-active");
  if (interaction.capture && handle?.hasPointerCapture?.(interaction.pointerId)) {
    try {
      handle.releasePointerCapture(interaction.pointerId);
    } catch (error) {
      logEditor("debug", "editor_panel_pointer_release_failed", {
        panel: interaction.panel,
        message: error.message
      });
    }
  }
  persistSettings({ editorPanels: state.settings.editorPanels }).catch(handleError);
  logEditor("info", "editor_panel_resize_end", {
    panel: interaction.panel,
    reason,
    height: editorPanelHeight(interaction.panel)
  });
}

function updateEditorPanelResize(event, source = "pointermove") {
  const interaction = state.editorPanelResize;
  if (!interaction) return;
  const pointerY = Number(event?.clientY);
  if (!Number.isFinite(pointerY)) {
    logEditor("warn", "editor_panel_resize_invalid_move", { panel: interaction.panel, source });
    return;
  }
  const next = applyEditorPanelHeight(
    interaction.panel,
    interaction.startHeight + (pointerY - interaction.startY),
    {
      announceSize: false,
      persist: false,
      source
    }
  );
  const now = Date.now();
  if (now - interaction.lastLoggedAt > 160) {
    interaction.lastLoggedAt = now;
    logEditor("debug", "editor_panel_resize_move", {
      panel: interaction.panel,
      height: next,
      source
    });
  }
}

function beginEditorPanelResize(panel, event) {
  if (!activeResult()) return;
  const pointerY = Number(event?.clientY);
  if (!Number.isFinite(pointerY)) {
    logEditor("warn", "editor_panel_resize_invalid_start", { panel });
    setEditorPanelMessage("Resize could not start. Try again.", "warning");
    return;
  }
  event.preventDefault();
  const handle = editorPanelHandle(panel);
  handle?.classList.add("is-active");
  try {
    handle?.setPointerCapture?.(event.pointerId);
  } catch (error) {
    logEditor("debug", "editor_panel_pointer_capture_failed", {
      panel,
      message: error.message
    });
  }
  state.editorPanelResize = {
    panel,
    pointerId: event.pointerId,
    startY: pointerY,
    startHeight: editorPanelHeight(panel),
    capture: true,
    lastLoggedAt: 0
  };
  logEditor("info", "editor_panel_resize_start", {
    panel,
    pointerType: event.pointerType || "mouse",
    height: state.editorPanelResize.startHeight
  });
}

function handleEditorPanelResizeKey(panel, event) {
  if (!activeResult()) return;
  const key = event.key;
  if (!["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"].includes(key)) return;
  event.preventDefault();
  if (key === "Home") adjustEditorPanel(panel, "collapse");
  else if (key === "End") adjustEditorPanel(panel, "expand");
  else if (key === "PageUp") adjustEditorPanel(panel, "grow");
  else if (key === "PageDown") adjustEditorPanel(panel, "shrink");
  else adjustEditorPanel(panel, key === "ArrowDown" ? "grow" : "shrink");
}

function syncEditorPanelsToViewport(source = "window_resize") {
  const normalized = normalizeEditorPanelState(state.settings.editorPanels, {
    viewportHeight: currentViewportHeight()
  });
  const changed =
    normalized.panels.raw !== state.settings.editorPanels?.raw ||
    normalized.panels.preview !== state.settings.editorPanels?.preview;
  if (!changed) {
    applyEditorPanelHeights();
    return;
  }
  state.settings = { ...state.settings, editorPanels: normalized.panels };
  applyEditorPanelHeights();
  persistSettings({ editorPanels: normalized.panels }).catch(handleError);
  logEditor("info", "editor_panel_viewport_reclamped", {
    source,
    recovered: normalized.recovered
  });
}

function mountVisualEditor() {
  try {
    state.visualRoot = $("visualEditorHost").attachShadow({ mode: "open" });
  } catch (error) {
    logEditor("warn", "visual_editor_shadow_mount_failed", { message: error.message });
    state.visualRoot = $("visualEditorHost");
    setEditorPanelMessage("Rendered preview is using a compatibility fallback.", "warning");
  }
  const visualStyle = document.createElement("link");
  visualStyle.rel = "stylesheet";
  visualStyle.href = "/visual-editor.css";
  const visualCanvas = document.createElement("div");
  visualCanvas.className = "canvas";
  visualCanvas.contentEditable = "true";
  visualCanvas.setAttribute("role", "textbox");
  visualCanvas.setAttribute("aria-multiline", "true");
  visualCanvas.setAttribute("aria-label", "Editable rendered HTML preview");
  const root = state.visualRoot;
  if (root?.replaceChildren) root.replaceChildren(visualStyle, visualCanvas);
  else $("visualEditorHost").replaceChildren(visualStyle, visualCanvas);
  state.visualEditor = visualCanvas;
  state.visualEditor.addEventListener("input", () => {
    if (state.resultPanelSyncing || state.visualEditorSyncing) return;
    state.resultDirty = true;
    const sanitized = sanitizeEditedEmail(state.visualEditor?.innerHTML || "");
    $("bodyInput").value = sanitized.html;
    updateRawEditor();
    showSanitizationWarnings(sanitized.warnings);
    logEditor("debug", "visual_editor_input", {
      summary: summarizeHtml(sanitized.html)
    });
  });
  logEditor("info", "visual_editor_mounted", {
    fallback: root === $("visualEditorHost")
  });
}

function safeFilename(value, extension = "") {
  const base =
    String(value ?? "export")
      .normalize("NFKC")
      .replace(/[^a-zA-Z0-9._ -]+/g, "-")
      .replace(/\.{2,}/g, ".")
      .replace(/^[-.\s]+|[-.\s]+$/g, "")
      .slice(0, 120) || "export";
  return `${base.replace(new RegExp(`${extension.replace(".", "\\.")}$`, "i"), "")}${extension}`;
}

async function persistSettings(patch = {}, { bypassStorageGate = false } = {}) {
  if (!bypassStorageGate) assertStorageGate("local", "settings");
  const latest = await state.repository.get("settings", "application");
  const next = {
    ...(latest ?? state.settings ?? DEFAULT_SETTINGS),
    ...patch,
    key: "application",
    revision: Number.isInteger(latest?.revision)
      ? latest.revision
      : Number.isInteger(state.settings?.revision)
        ? state.settings.revision
        : 0,
    updatedAt: nowIso()
  };
  try {
    const saved = await state.repository.compareAndSwap(
      "settings",
      "application",
      Number.isInteger(latest?.revision)
        ? latest.revision
        : Number.isInteger(state.settings?.revision)
          ? state.settings.revision
          : 0,
      next
    );
    state.settings = { ...DEFAULT_SETTINGS, ...saved };
    state.activeProjectId = state.settings.activeProjectId;
    applyPreferences();
    return saved;
  } catch (error) {
    if (error?.code === "REVISION_CONFLICT") {
      const conflict = error.latest ? { ...DEFAULT_SETTINGS, ...error.latest } : null;
      if (conflict) {
        state.settings = conflict;
        state.activeProjectId = state.settings.activeProjectId;
        applyPreferences();
        await loadAllState().catch(() => {});
        renderAll();
      }
      throw appError(
        "SETTINGS_CONFLICT",
        "Settings changed in another tab. Review the latest values and save again.",
        { latest: conflict?.updatedAt ?? null }
      );
    }
    throw error;
  }
}

function applyPreferences() {
  document.body.classList.toggle("reduce-motion", Boolean(state.settings.reducedMotion));
  document.body.classList.toggle("high-contrast", Boolean(state.settings.highContrast));
  applyEditorPanelHeights();
}

async function loadAllState() {
  const [settings, projects, records, templates, addenda, models, providerStatus, results, jobs, operations] =
    await Promise.all([
      state.repository.get("settings", "application"),
      state.repository.all("projects"),
      state.repository.all("records"),
      state.repository.all("templates"),
      state.repository.all("addenda"),
      state.repository.all("modelCatalog"),
      state.repository.all("providerStatus"),
      state.repository.all("results"),
      state.repository.all("jobs"),
      state.repository.all("operations")
    ]);
  state.settings = { ...DEFAULT_SETTINGS, ...withRevision(settings ?? { key: "application", revision: 0 }) };
  const recoveredPanels = recoverEditorPanelState(state.settings);
  state.settings = { ...DEFAULT_SETTINGS, ...recoveredPanels.settings };
  state.projects = projects.sort((left, right) =>
    String(right.updatedAt).localeCompare(String(left.updatedAt))
  );
  state.records = records;
  state.templates = templates.map(withRevision);
  state.addenda = addenda.map(withRevision);
  state.models = models;
  state.providerStatus = providerStatus;
  state.results = results.map((result) => normalizeStoredResult(withRevision(result)));
  state.jobs = jobs;
  state.operations = operations.map(withRevision);
  state.settings.executionMode = normalizeExecutionSetting(state.settings.executionMode);
  state.activeProjectId = state.settings.activeProjectId || state.projects[0]?.id || null;
  state.activeRecordId = projectRecords()[0]?.id || null;
  state.activeTemplateId = activeProject()?.templateId || state.templates[0]?.id || null;
  state.activeResultId =
    projectResults({ includeTrash: false }).sort((left, right) =>
      String(right.updatedAt).localeCompare(String(left.updatedAt))
    )[0]?.id || null;
  const providerBatchResponse = await api("/api/gateway/batches", {
    logErrors: false
  }).catch(() => null);
  if (providerBatchResponse?.operations?.length) {
    const mergedJobs = new Map(state.jobs.map((job) => [job.id, job]));
    for (const operation of providerBatchResponse.operations) {
      const existingJob =
        mergedJobs.get(operation.id) ?? (await state.repository.get("jobs", operation.id).catch(() => null));
      const mergedJob = mergeProviderBatchJob(existingJob, operation);
      await state.repository.put("jobs", mergedJob);
      mergedJobs.set(mergedJob.id, mergedJob);
    }
    state.jobs = [...mergedJobs.values()].sort((left, right) =>
      String(right.updatedAt).localeCompare(String(left.updatedAt))
    );
  }
  for (const job of state.jobs.filter((item) => ["queued", "running", "stopping"].includes(item.status))) {
    if (job.executionMode === "provider-batch") {
      if (!job.providerBatch?.chunks?.length) {
        job.status = "submission_unknown";
        job.error = {
          code: "RECOVERED_AFTER_REFRESH",
          message: "Provider batch state will be reconciled after reload."
        };
        job.providerBatch = {
          ...(job.providerBatch ?? {}),
          submissionState: "submission_unknown",
          monitoringState: "reconciling",
          recoveredAt: nowIso()
        };
        job.updatedAt = nowIso();
        await state.repository.put("jobs", job);
      }
      continue;
    }
    job.status = "ambiguous";
    job.error = {
      code: "RECOVERED_AFTER_REFRESH",
      message: "Processing was interrupted by a browser refresh. Review before retrying."
    };
    job.updatedAt = nowIso();
    await state.repository.put("jobs", job);
  }
  if (recoveredPanels.recovered.length) {
    state.settings = await persistRevisionedRecord("settings", state.settings, {
      conflictCode: "SETTINGS_CONFLICT",
      conflictMessage: "Settings changed in another tab while restoring editor panel state."
    }).catch((error) => {
      if (error?.code !== "SETTINGS_CONFLICT") throw error;
      return state.settings;
    });
    logEditor("warn", "editor_panel_state_recovered", {
      recovered: recoveredPanels.recovered
    });
    setEditorPanelMessage("Saved panel heights were invalid and have been reset safely.", "warning");
  } else if (settings?.editorPanels) {
    logEditor("info", "editor_panel_state_restored", {
      panels: state.settings.editorPanels
    });
  }
  applyPreferences();
}

async function seedBundledContent() {
  const existingTemplates = new Map((await state.repository.all("templates")).map((item) => [item.id, item]));
  const templateList = await api("/api/templates");
  for (const descriptor of templateList.templates ?? []) {
    const id = `bundled:${descriptor.name}`;
    if (existingTemplates.has(id)) continue;
    const payload = await api(`/api/templates/${encodeURIComponent(descriptor.name)}`);
    await persistRevisionedRecord("templates", {
      id,
      name: descriptor.name,
      content: payload.template.content,
      tags: ["bundled"],
      folder: "Bundled",
      source: "bundled",
      immutable: true,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      revision: 0
    });
  }
  const existingAddenda = new Map((await state.repository.all("addenda")).map((item) => [item.id, item]));
  const addendumList = await api("/api/addenda");
  for (const descriptor of addendumList.addenda ?? []) {
    const id = `bundled:${descriptor.name}`;
    if (existingAddenda.has(id)) continue;
    const payload = await api(`/api/addenda/${encodeURIComponent(descriptor.name)}`);
    await persistRevisionedRecord("addenda", {
      id,
      name: descriptor.name,
      content: payload.rendered.html,
      sourceContent: payload.addendum.content,
      source: "bundled",
      immutable: true,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      revision: 0
    });
  }
  const existingModels = await state.repository.all("modelCatalog");
  if (!existingModels.length) {
    const configured = [];
    for (const provider of state.bootstrap.ai.providers ?? []) {
      for (const model of provider.models ?? []) {
        const compatible = model.compatible !== false && (model.capabilities ?? []).includes("structured");
        configured.push({
          id: `${provider.id}:${model.id}`,
          providerId: provider.id,
          providerModelId: model.id,
          displayName: model.label || model.id,
          availability: "available",
          compatibility: {
            compatible,
            status: compatible ? "compatible" : "incompatible",
            reasons: compatible ? [] : [model.exclusionReason || "Structured email output is not supported."]
          },
          pricing: {
            currency: "USD",
            status: "unavailable",
            sourceUrl: null,
            verifiedAt: null
          },
          favorite: false,
          discoverySource: "configured-fallback",
          updatedAt: nowIso()
        });
      }
      await state.repository.put("providerStatus", {
        providerId: provider.id,
        status: "configured",
        modelCount: provider.models?.length ?? 0,
        updatedAt: nowIso()
      });
    }
    await state.repository.bulkPut("modelCatalog", configured);
  }
}

function serverModelProviders() {
  return new Set((state.bootstrap?.ai?.providers ?? []).map((provider) => provider.id));
}

function browserStatusFromServer(status) {
  return {
    providerId: status.providerId,
    status: status.status,
    modelCount: status.modelsAccepted ?? status.modelsDiscovered ?? 0,
    error: status.error ?? null,
    verifiedAt: status.lastSuccessAt ?? status.lastAttemptAt ?? null,
    updatedAt: status.updatedAt ?? nowIso()
  };
}

async function syncServerModelCatalog({ runSync = false, silent = false } = {}) {
  assertStorageGate("external", "model catalog sync");
  if (!state.bootstrap?.app?.modelSync?.enabled) return null;
  if (runSync) {
    await api("/api/models/sync", { method: "POST", body: "{}", logErrors: !silent });
  }
  const payload = await api("/api/models/catalog", { logErrors: !silent });
  const managedProviders = serverModelProviders();
  const previousById = new Map(state.models.map((model) => [model.id, model]));
  const runtimeModels = state.models.filter((model) => !managedProviders.has(model.providerId));
  const syncedModels = (payload.models ?? []).map((model) => ({
    ...model,
    favorite: previousById.get(model.id)?.favorite ?? false,
    updatedAt: nowIso()
  }));
  const runtimeStatuses = state.providerStatus.filter((status) => !managedProviders.has(status.providerId));
  const syncedStatuses = (payload.status?.providers ?? []).map(browserStatusFromServer);
  await state.repository.replaceStore("modelCatalog", [...runtimeModels, ...syncedModels]);
  await state.repository.replaceStore("providerStatus", [...runtimeStatuses, ...syncedStatuses]);
  state.models = await state.repository.all("modelCatalog");
  state.providerStatus = await state.repository.all("providerStatus");
  renderModelCatalog();
  return payload.status ?? null;
}

function renderProjects() {
  $("projectSelect").replaceChildren(
    ...state.projects.map(
      (project) => new Option(`${project.name} (${project.recordCount ?? 0})`, project.id)
    )
  );
  $("projectSelect").value = state.activeProjectId || "";
  $("projectSelect").disabled = state.projects.length === 0;
}

function visibleRecordColumns(columns) {
  return columns.filter((column) => state.settings.recordColumns[column.name] !== false);
}

function currentRecordView() {
  return sortAndFilterRecords(projectRecords(), {
    search: $("recordSearch").value,
    filter: $("recordStatusFilter").value,
    sortKey: state.recordSort.key,
    direction: state.recordSort.direction
  });
}

function renderRecordColumnChooser(columns) {
  const fieldset = $("recordColumnChooser");
  const legend = fieldset.querySelector("legend");
  fieldset.replaceChildren(legend);
  for (const column of columns) {
    const label = document.createElement("label");
    label.className = "switch";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = state.settings.recordColumns[column.name] !== false;
    input.addEventListener("change", async () => {
      const recordColumns = { ...state.settings.recordColumns, [column.name]: input.checked };
      await persistSettings({ recordColumns });
      renderRecords();
    });
    label.append(input, document.createTextNode(column.name));
    fieldset.append(label);
  }
}

function renderRecords() {
  const templateVariables = parseTemplateVariables(
    $("templateEditor").value || activeTemplate()?.content || ""
  ).variables.map((item) => item.name);
  const columns = columnUnion(projectRecords(), templateVariables);
  const visibleColumns = visibleRecordColumns(columns);
  renderRecordColumnChooser(columns);
  const header = document.createElement("tr");
  const selectHeader = document.createElement("th");
  selectHeader.className = "sticky-col";
  selectHeader.innerHTML =
    '<input id="selectAllRecords" type="checkbox" aria-label="Select all records on this page">';
  header.append(selectHeader);
  for (const fixed of ["displayName", "status"]) {
    const cell = document.createElement("th");
    cell.scope = "col";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "sort-button";
    button.textContent = fixed === "displayName" ? "Record" : "Status";
    button.addEventListener("click", () => setRecordSort(fixed));
    cell.append(button);
    header.append(cell);
  }
  for (const column of visibleColumns) {
    const cell = document.createElement("th");
    cell.scope = "col";
    if (column.promptUsed) cell.className = "prompt-column";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "sort-button";
    button.textContent = column.name;
    button.addEventListener("click", () => setRecordSort(column.name));
    cell.append(button);
    header.append(cell);
  }
  $("recordHeaderRows").replaceChildren(header);
  const all = currentRecordView();
  const pageSize = Number($("recordPageSize").value || 50);
  const pages = Math.max(1, Math.ceil(all.length / pageSize));
  state.recordPage = Math.min(state.recordPage, pages);
  const rows = all.slice((state.recordPage - 1) * pageSize, state.recordPage * pageSize);
  const fragment = document.createDocumentFragment();
  for (const record of rows) {
    const tr = document.createElement("tr");
    if (record.id === state.activeRecordId) tr.classList.add("is-active");
    const select = document.createElement("td");
    select.className = "sticky-col";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "record-check";
    checkbox.checked = state.selectedRecordIds.has(record.id);
    checkbox.setAttribute("aria-label", `Select ${record.displayName}`);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) state.selectedRecordIds.add(record.id);
      else state.selectedRecordIds.delete(record.id);
      updateProcessingButton();
    });
    select.append(checkbox);
    tr.append(select);
    const nameCell = document.createElement("td");
    const nameButton = document.createElement("button");
    nameButton.type = "button";
    nameButton.className = "link-button";
    nameButton.textContent = record.displayName;
    nameButton.addEventListener("click", () => selectRecord(record.id));
    nameCell.append(nameButton);
    tr.append(nameCell);
    const statusCell = document.createElement("td");
    statusCell.textContent = record.status;
    tr.append(statusCell);
    const flat = flattenRecord(record.normalized);
    for (const column of visibleColumns) {
      const cell = document.createElement("td");
      cell.className = "cell-truncate";
      const display = displayCell(flat[column.name]);
      if (display.short !== display.full) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "cell-button";
        button.textContent = display.short;
        button.title = display.full;
        button.addEventListener("click", () => showCellDetail(column.name, display.full));
        cell.append(button);
      } else cell.textContent = display.full;
      tr.append(cell);
    }
    fragment.append(tr);
  }
  $("recordRows").replaceChildren(fragment);
  $("recordCount").textContent = `${all.length} of ${projectRecords().length} records`;
  $("recordPageStatus").textContent = `Page ${state.recordPage} of ${pages}`;
  $("recordPreviousPage").disabled = state.recordPage <= 1;
  $("recordNextPage").disabled = state.recordPage >= pages;
  const selectAll = $("selectAllRecords");
  if (selectAll) {
    selectAll.checked = rows.length > 0 && rows.every((record) => state.selectedRecordIds.has(record.id));
    selectAll.addEventListener("change", () => {
      rows.forEach((record) =>
        selectAll.checked ? state.selectedRecordIds.add(record.id) : state.selectedRecordIds.delete(record.id)
      );
      renderRecords();
      updateProcessingButton();
    });
  }
  renderRecordSelect();
  updateProcessingButton();
}

function setRecordSort(key) {
  state.recordSort =
    state.recordSort.key === key
      ? { key, direction: state.recordSort.direction === "asc" ? "desc" : "asc" }
      : { key, direction: "asc" };
  renderRecords();
}

function selectRecord(id) {
  state.activeRecordId = id;
  renderRecords();
  renderTemplateWarnings();
}

function renderRecordSelect() {
  $("recordSelect").replaceChildren(
    ...projectRecords().map((record) => new Option(record.displayName, record.id))
  );
  $("recordSelect").value = state.activeRecordId || "";
}

function showCellDetail(column, value) {
  $("cellDetailHeading").textContent = column;
  $("cellDetailValue").textContent = value;
  $("cellDetailDialog").showModal();
}

function filteredTemplates() {
  const query = $("templateSearch").value.trim().toLowerCase();
  const sort = $("templateSort").value;
  return state.templates
    .filter(
      (item) =>
        !query ||
        `${item.name} ${(item.tags ?? []).join(" ")} ${item.folder ?? ""}`.toLowerCase().includes(query)
    )
    .sort((left, right) =>
      sort === "name"
        ? left.name.localeCompare(right.name)
        : String(right[sort === "created" ? "createdAt" : "updatedAt"]).localeCompare(
            String(left[sort === "created" ? "createdAt" : "updatedAt"])
          )
    );
}

function renderTemplates({ preserveDraft = false } = {}) {
  const templates = filteredTemplates();
  $("templateSelect").replaceChildren(
    ...templates.map(
      (item) => new Option(`${item.source === "bundled" ? "Bundled / " : ""}${item.name}`, item.id)
    )
  );
  if (!state.activeTemplateId || !state.templates.some((item) => item.id === state.activeTemplateId))
    state.activeTemplateId = templates[0]?.id || null;
  $("templateSelect").value = state.activeTemplateId || "";
  const template = activeTemplate();
  if (!preserveDraft) {
    $("templateEditor").value = template?.content || "";
    $("templateTags").value = (template?.tags ?? []).join(", ");
    state.templateBaseline = template?.content || "";
    state.templateDirty = false;
  }
  $("templateMetadata").textContent = template
    ? `${template.source === "bundled" ? "Bundled, immutable" : "Browser-owned"} · updated ${formatDate(template.updatedAt)}`
    : "No template selected";
  $("saveTemplateButton").disabled = !template || template.immutable;
  $("renameTemplateButton").disabled = !template || template.immutable;
  $("deleteTemplateButton").disabled = !template || template.immutable;
  $("revertTemplateButton").disabled = !state.templateDirty;
  renderTemplateWarnings();
}

function renderTemplateWarnings() {
  const analysis = analyzeTemplate($("templateEditor").value, activeRecord()?.normalized ?? {});
  const messages = [
    ...analysis.malformed.map((item) => item.message),
    ...(analysis.missing.length ? [`Missing required: ${analysis.missing.join(", ")}`] : []),
    ...(analysis.blank.length ? [`Blank required: ${analysis.blank.join(", ")}`] : [])
  ];
  $("templateWarnings").textContent = messages.join(" ");
  renderRecords();
}

async function saveTemplate({ saveAs = false } = {}) {
  assertStorageGate("local", "template editing");
  let template = activeTemplate();
  if (!template || template.immutable || saveAs) {
    const proposed = template
      ? `${template.name.replace(/\.(txt|md|prompt)$/i, "")} copy`
      : "Untitled template";
    const name = safeTemplateName(prompt("Template name", proposed));
    if (!name) return;
    if (state.templates.some((item) => item.name.toLowerCase() === name.toLowerCase()))
      throw new Error("A template with that name already exists.");
    const now = nowIso();
    template = {
      id: makeId("template"),
      name,
      content: $("templateEditor").value,
      tags: parseTags(),
      folder: parseTags()[0] || "User",
      source: "user",
      immutable: false,
      createdAt: now,
      updatedAt: now,
      revision: 0
    };
    template = await persistRevisionedRecord("templates", template);
    state.templates.push(template);
    state.activeTemplateId = template.id;
  } else {
    await snapshotTemplate(template);
    const saved = await updateRevisionedRecord(
      "templates",
      template.id,
      (current) => ({
        ...current,
        content: $("templateEditor").value,
        tags: parseTags(),
        updatedAt: nowIso()
      }),
      {
        conflictCode: "TEMPLATE_CONFLICT",
        conflictMessage: "The template changed in another tab. Reload the latest version before saving."
      }
    );
    template = saved;
    state.templates[state.templates.findIndex((item) => item.id === template.id)] = template;
  }
  state.templateBaseline = template.content;
  state.templateDirty = false;
  const project = activeProject();
  if (project) {
    project.templateId = template.id;
    project.updatedAt = nowIso();
    await state.repository.put("projects", project);
  }
  await state.logger.info("template_saved", { templateId: template.id, source: template.source });
  renderTemplates();
  setStatus(
    state.storageHealth.mode === STORAGE_MODES.DURABLE
      ? `Saved template ${template.name}`
      : `Template ${template.name} stored in memory only. Export an encrypted backup before closing.`
  );
}

function parseTags() {
  return [
    ...new Set(
      $("templateTags")
        .value.split(",")
        .map((value) => value.trim())
        .filter(Boolean)
    )
  ].slice(0, 20);
}

async function snapshotTemplate(template) {
  await state.repository.put("templateVersions", {
    id: makeId("template-version"),
    templateId: template.id,
    name: template.name,
    content: template.content,
    tags: template.tags ?? [],
    createdAt: nowIso()
  });
}

async function renameTemplate() {
  assertStorageGate("local", "template editing");
  const template = activeTemplate();
  if (!template || template.immutable) return;
  const name = safeTemplateName(prompt("New template name", template.name));
  if (!name || name === template.name) return;
  if (
    state.templates.some((item) => item.id !== template.id && item.name.toLowerCase() === name.toLowerCase())
  )
    throw new Error("A template with that name already exists.");
  await snapshotTemplate(template);
  const saved = await updateRevisionedRecord(
    "templates",
    template.id,
    (current) => ({
      ...current,
      name,
      updatedAt: nowIso()
    }),
    {
      conflictCode: "TEMPLATE_CONFLICT",
      conflictMessage: "The template changed in another tab. Reload the latest version before renaming."
    }
  );
  template.name = saved.name;
  template.updatedAt = saved.updatedAt;
  template.revision = saved.revision;
  renderTemplates();
}

async function deleteTemplate() {
  assertStorageGate("irreversible", "template deletion");
  const template = activeTemplate();
  if (
    !template ||
    template.immutable ||
    !confirm(`Delete template “${template.name}”? Version history will also be removed.`)
  )
    return;
  await state.repository.delete("templates", template.id);
  const versions = await state.repository.byIndex("templateVersions", "templateId", template.id);
  await Promise.all(versions.map((item) => state.repository.delete("templateVersions", item.id)));
  state.templates = state.templates.filter((item) => item.id !== template.id);
  state.activeTemplateId = state.templates[0]?.id || null;
  renderTemplates();
}

function previewPrompt() {
  const preview = renderTemplate($("templateEditor").value, activeRecord()?.normalized ?? {});
  $("promptPreview").textContent = preview.rendered;
  $("promptPreviewDetails").open = true;
  renderTemplateWarnings();
}

async function showTemplateHistory() {
  const template = activeTemplate();
  const versions = template
    ? await state.repository.byIndex("templateVersions", "templateId", template.id)
    : [];
  $("historyList").replaceChildren(
    ...versions
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((version) => {
        const li = document.createElement("li");
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = `Restore ${formatDate(version.createdAt)}`;
        button.addEventListener("click", () => {
          $("templateEditor").value = version.content;
          state.templateDirty = true;
          $("historyDialog").close();
          renderTemplates({ preserveDraft: true });
        });
        li.append(button);
        return li;
      })
  );
  $("historyDialog").showModal();
}

function renderProviderFilter() {
  const providers = [...new Set(state.models.map((item) => item.providerId))].sort();
  const current = $("modelProviderFilter").value || "all";
  $("modelProviderFilter").replaceChildren(
    new Option("All", "all"),
    ...providers.map((value) => new Option(value, value))
  );
  $("modelProviderFilter").value = providers.includes(current) ? current : "all";
}

function renderModelCatalog() {
  renderProviderFilter();
  $("providerStatusRows").replaceChildren(
    ...state.providerStatus
      .sort((a, b) => a.providerId.localeCompare(b.providerId))
      .map((provider) => {
        const row = document.createElement("tr");
        [
          provider.providerId,
          provider.status,
          formatDate(provider.verifiedAt || provider.updatedAt),
          String(provider.modelCount ?? 0)
        ].forEach((value) => {
          const cell = document.createElement("td");
          cell.textContent = value;
          row.append(cell);
        });
        return row;
      })
  );
  const query = $("modelSearch").value.trim().toLowerCase();
  const providerFilter = $("modelProviderFilter").value;
  const compatibleOnly = $("compatibleModelsOnly").checked;
  const favoritesOnly = $("favoriteModelsOnly").checked;
  const models = state.models
    .filter(
      (model) =>
        !query ||
        `${model.providerId} ${model.providerModelId} ${model.displayName}`.toLowerCase().includes(query)
    )
    .filter((model) => providerFilter === "all" || model.providerId === providerFilter)
    .filter((model) => !compatibleOnly || model.compatibility?.compatible)
    .filter((model) => !favoritesOnly || model.favorite)
    .sort((a, b) => a.providerId.localeCompare(b.providerId) || a.displayName.localeCompare(b.displayName));
  $("modelCatalogRows").replaceChildren(
    ...models.map((model) => {
      const row = document.createElement("tr");
      if (model.id === state.settings.selectedModel) row.classList.add("is-active");
      const selection = document.createElement("td");
      const radio = document.createElement("input");
      radio.type = "radio";
      radio.name = "catalogModel";
      radio.value = model.id;
      radio.checked = model.id === state.settings.selectedModel;
      radio.disabled = !model.compatibility?.compatible || model.availability === "unavailable";
      radio.setAttribute("aria-label", `Select ${model.displayName} from ${model.providerId}`);
      radio.addEventListener("change", () => selectModel(model));
      selection.append(radio);
      row.append(selection);
      const favoriteCell = document.createElement("td");
      const favorite = document.createElement("button");
      favorite.type = "button";
      favorite.textContent = model.favorite ? "★" : "☆";
      favorite.setAttribute(
        "aria-label",
        `${model.favorite ? "Remove" : "Add"} ${model.displayName} ${model.favorite ? "from" : "to"} favorites`
      );
      favorite.addEventListener("click", async () => {
        assertStorageGate("local", "model favorites");
        model.favorite = !model.favorite;
        model.updatedAt = nowIso();
        await state.repository.put("modelCatalog", model);
        renderModelCatalog();
      });
      favoriteCell.append(favorite);
      row.append(favoriteCell);
      const cells = [
        { value: model.providerId },
        {
          value: wrapModelName(model.displayName),
          className: "model-name-cell",
          title: model.displayName
        },
        { value: formatCompatibility(model) },
        {
          value: formatPrice(model.pricing?.inputPerMillionTokens, model.pricing, "input"),
          link:
            unavailablePriceReference(model.pricing?.inputPerMillionTokens, model.pricing, "input") &&
            modelPricingUrl(model)
        },
        {
          value: formatPrice(model.pricing?.outputPerMillionTokens, model.pricing, "output"),
          link:
            unavailablePriceReference(model.pricing?.outputPerMillionTokens, model.pricing, "output") &&
            modelPricingUrl(model)
        },
        { value: formatPricingStatus(model.pricing) }
      ];
      cells.forEach(({ value, className, title, link }) => {
        const cell = document.createElement("td");
        if (className) cell.className = className;
        if (title) cell.title = title;
        if (link && value === "N/A") {
          const anchor = document.createElement("a");
          anchor.href = link;
          anchor.target = "_blank";
          anchor.rel = "noopener noreferrer";
          anchor.className = "model-pricing-link";
          anchor.textContent = value;
          anchor.setAttribute("aria-label", `Open ${model.providerId} pricing documentation in a new tab`);
          cell.append(anchor);
        } else {
          cell.textContent = value;
        }
        row.append(cell);
      });
      row.addEventListener("click", (event) => {
        if (event.target.closest("button,input")) return;
        if (!radio.disabled) radio.click();
      });
      return row;
    })
  );
  renderSelectedModelSummary();
}

async function selectModel(model) {
  if (!model.compatibility?.compatible) return;
  await persistSettings({ selectedModel: model.id });
  $("selectedModelAnnouncement").textContent = `Selected ${model.displayName} from ${model.providerId}`;
  renderModelCatalog();
  updateProcessingButton();
}

function renderSelectedModelSummary() {
  const model = selectedModel();
  const requestedMode = normalizeExecutionSetting(state.settings.executionMode);
  if ($("executionModeSelect")) $("executionModeSelect").value = requestedMode;
  let executionPlan = null;
  let executionSummary = `Execution mode: ${humanizeStatus(requestedMode, "Auto")}.`;
  if (model) {
    try {
      executionPlan = resolveExecutionPlan(model, requestedMode);
      const batch = executionPlan.batch;
      if (executionPlan.mode === "provider-batch") {
        const savings =
          Number.isFinite(batch?.discountPercent) && batch.discountPercent > 0
            ? ` at about ${batch.discountPercent}% lower token pricing`
            : "";
        executionSummary =
          requestedMode === "auto"
            ? `Execution mode: Auto is using native provider batch${savings}.`
            : `Execution mode: Provider Batch${savings}.`;
      } else if (batch?.classification === "native_discounted_batch") {
        executionSummary = `Execution mode: ${humanizeStatus(requestedMode, "Auto")}. Native provider batch is available for this model.`;
      } else if (requestedMode === "provider-batch") {
        executionSummary = `Execution mode: Provider Batch requested, but this model is not verified for discounted native batch.`;
      }
    } catch (error) {
      executionSummary = `Execution mode: Provider Batch requested, but ${error.message.toLowerCase()}`;
    }
  }
  const text = model
    ? `${model.providerId} / ${model.displayName} · input ${formatPrice(model.pricing?.inputPerMillionTokens, model.pricing, "input")} · output ${formatPrice(model.pricing?.outputPerMillionTokens, model.pricing, "output")} · ${formatCompatibility(model)}${
        executionPlan?.mode === "provider-batch"
          ? ` · provider batch ${executionPlan.batch?.discountPercent ? `${executionPlan.batch.discountPercent}% lower` : "eligible"}`
          : executionPlan?.batch?.classification === "standard_api_only"
            ? " · standard API only"
            : ""
      }`
    : "Select a compatible model in Model Catalog.";
  $("selectedModelSummary").textContent = text;
  $("selectedModelAnnouncement").textContent = model
    ? `Selected ${model.displayName} from ${model.providerId}`
    : "No model selected";
  $("executionModeSummary").textContent = executionSummary;
  updateCostEstimate(executionPlan);
}

async function refreshRuntimeModels(provider, { logErrors = true } = {}) {
  assertStorageGate("external", "model refresh");
  const body =
    provider === "ollama"
      ? { host: state.settings.ollamaHost, confirmedCustomHost: state.settings.confirmedCustomOllamaHost }
      : {};
  const payload = await api(`/api/gateway/models/${provider}`, {
    method: "POST",
    body: JSON.stringify(body),
    logErrors
  });
  const result = payload.result;
  const previous = state.models.filter((model) => model.providerId === provider);
  const availableIds = new Set(result.models.map((model) => model.id));
  for (const old of previous) {
    if (!availableIds.has(old.id)) {
      old.availability = "unavailable";
      old.updatedAt = nowIso();
      await state.repository.put("modelCatalog", old);
    }
  }
  await state.repository.bulkPut(
    "modelCatalog",
    result.models.map((model) => ({
      ...model,
      favorite: previous.find((item) => item.id === model.id)?.favorite ?? false,
      discoverySource: "live",
      updatedAt: nowIso()
    }))
  );
  await state.repository.put("providerStatus", {
    providerId: provider,
    status: result.status,
    verifiedAt: result.verifiedAt,
    modelCount: result.models.length,
    error: result.error ?? null,
    updatedAt: nowIso()
  });
  state.models = await state.repository.all("modelCatalog");
  state.providerStatus = await state.repository.all("providerStatus");
  if (provider === "ollama") renderOllamaStatus(result);
  if (
    state.settings.selectedModel?.startsWith(`${provider}:`) &&
    !state.models.find(
      (item) => item.id === state.settings.selectedModel && item.availability !== "unavailable"
    )
  ) {
    setStatus(
      "The selected model is no longer available. The selection was preserved; choose an alternative before processing.",
      true
    );
  }
  renderModelCatalog();
  return result;
}

async function detectOllama({ silent = false } = {}) {
  try {
    return await refreshRuntimeModels("ollama", { logErrors: !silent });
  } catch (error) {
    renderOllamaStatus({ status: "error", models: [], error });
    if (!silent) throw error;
    return null;
  }
}

function scopeRecords() {
  const records = projectRecords().filter((record) => record.status === "ready");
  switch ($("processingScope").value) {
    case "current":
      return activeRecord()?.status === "ready" ? [activeRecord()] : [];
    case "selected":
      return records.filter((record) => state.selectedRecordIds.has(record.id));
    case "range": {
      const start = Number($("rangeStart").value);
      const end = Number($("rangeEnd").value);
      if (
        !Number.isInteger(start) ||
        !Number.isInteger(end) ||
        start < 1 ||
        end < start ||
        end > records.length
      )
        return [];
      return records.slice(start - 1, end);
    }
    default:
      return records;
  }
}

function updateProcessingButton() {
  const scope = $("processingScope").value;
  $("rangeFields").hidden = scope !== "range";
  const count = scopeRecords().length;
  const label = { current: "current", selected: "selected", all: "all", range: "range" }[scope];
  const activeProviderBatchJob = currentProjectProviderBatchOperations().find(
    (job) => !isTerminalProviderBatchOperation(job)
  );
  const busyReason = state.processing
    ? state.processing.mode === "provider-batch"
      ? "Provider batch processing is already in progress."
      : "Processing is already in progress."
    : activeProviderBatchJob
      ? `Provider batch ${providerBatchOperationStatusLabel(activeProviderBatchJob.status)} is already active for this project.`
      : null;
  const blockingOperation = latestBlockingOperation("process");
  const blockingReason = blockingOperation
    ? `${operationStatusLabel(blockingOperation)} is already active in ${operationOwnerLabel(
        blockingOperation,
        state.tabId
      )}.`
    : null;
  const processState = providerBatchProcessButtonState({
    recordCount: count,
    hasModel: Boolean(selectedModel()),
    hasTemplate: Boolean(activeTemplate()),
    busyReason,
    blockingReason
  });
  const processButton = $("processButton");
  processButton.textContent = `Process ${label} (${count})`;
  processButton.disabled = processState.disabled;
  processButton.setAttribute("aria-describedby", "processButtonHint");
  const processButtonHint = $("processButtonHint");
  if (processButtonHint) {
    processButtonHint.hidden = false;
    processButtonHint.dataset.state = processState.disabled ? "error" : "ready";
    processButtonHint.textContent = processState.reason;
  }
  const failed = projectResults().filter((result) => result.status === "failed" && !result.trashed).length;
  const activeProviderBatchOperations = state.jobs.filter(
    (job) =>
      job.executionMode === "provider-batch" &&
      (!state.activeProjectId || job.projectId === state.activeProjectId) &&
      !isTerminalProviderBatchOperation(job)
  );
  const retrySuppressed = activeProviderBatchOperations.some((job) => !providerBatchOperationCanRetry(job));
  $("retryButton").textContent = `Retry Failed (${failed})`;
  $("retryButton").disabled = failed === 0 || Boolean(state.processing) || retrySuppressed;
  $("retryButton").title = retrySuppressed
    ? "Retry is disabled while a provider batch may still exist remotely."
    : "";
}

function updateCostEstimate(executionPlan = null) {
  const model = selectedModel();
  const records = scopeRecords();
  let plan = executionPlan;
  if (!plan && model) {
    try {
      plan = resolveExecutionPlan(model, state.settings.executionMode);
    } catch {
      plan = {
        requested: normalizeExecutionSetting(state.settings.executionMode),
        mode: "standard",
        batch: modelBatchCapability(model)
      };
    }
  }
  if (
    !model ||
    !Number.isFinite(model.pricing?.inputPerMillionTokens) ||
    !Number.isFinite(model.pricing?.outputPerMillionTokens)
  ) {
    $("batchCostEstimate").textContent =
      model?.pricing?.status === "local-compute"
        ? "Local compute; no hosted API token fee."
        : "Estimated cost unavailable.";
    return;
  }
  const templateTokens = Math.ceil($("templateEditor").value.length / 4);
  const input = records.reduce(
    (total, record) => total + templateTokens + Math.ceil(JSON.stringify(record.normalized).length / 4),
    0
  );
  const output = records.length * 500;
  const cost =
    (input / 1_000_000) * model.pricing.inputPerMillionTokens +
    (output / 1_000_000) * model.pricing.outputPerMillionTokens;
  const batchInput = model.pricing?.batch?.inputPerMillionTokens;
  const batchOutput = model.pricing?.batch?.outputPerMillionTokens;
  const batchCost =
    Number.isFinite(batchInput) && Number.isFinite(batchOutput)
      ? (input / 1_000_000) * batchInput + (output / 1_000_000) * batchOutput
      : null;
  const savingsPercent =
    Number.isFinite(batchCost) && cost > 0 ? (((cost - batchCost) / cost) * 100).toFixed(1) : null;
  const tokenSummary = `${input.toLocaleString()} input and ${output.toLocaleString()} output tokens approximated`;
  if (plan?.mode === "provider-batch" && Number.isFinite(batchCost)) {
    $("batchCostEstimate").textContent =
      `Estimated provider-batch cost: ${formatUsd(batchCost)} (${tokenSummary}; ${formatUsd(cost)} on the standard API, about ${savingsPercent}% lower).`;
    return;
  }
  if (Number.isFinite(batchCost) && model.pricing?.batch?.classification === "native_discounted_batch") {
    $("batchCostEstimate").textContent =
      `Estimated standard API cost: ${formatUsd(cost)} (${tokenSummary}). Native provider batch is also available at ${formatUsd(batchCost)}${savingsPercent ? `, about ${savingsPercent}% lower` : ""}.`;
    return;
  }
  $("batchCostEstimate").textContent = `Estimated standard API cost: ${formatUsd(cost)} (${tokenSummary}).`;
}

function importedContactCandidates(record) {
  const output = [];
  for (const [key, value] of Object.entries(record.normalized ?? {})) {
    if (/email/i.test(key)) {
      const email = String(value ?? "")
        .replace(/[\r\n]/g, "")
        .trim()
        .toLowerCase();
      if (/^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(email)) {
        output.push({
          id: `email:${email}`,
          type: "email",
          value: email,
          sourceUrl: record.sourceName,
          sourceCategory: "imported-record",
          method: "record-field",
          confidence: 0.98,
          confidenceLabel: "high",
          reason: `Imported ${key} field.`
        });
      }
      continue;
    }
    if (/^(phone|phoneNumber|telephone|tel|mobile|cell|contactPhone)$/i.test(key)) {
      const phone = phoneDisplay(value);
      if (!phone) continue;
      output.push({
        id: `phone:${phone}`,
        type: "phone",
        value: phone,
        sourceUrl: record.sourceName,
        sourceCategory: "imported-record",
        method: "record-field",
        confidence: 0.97,
        confidenceLabel: "high",
        reason: `Imported ${key} field.`
      });
      continue;
    }
    if (/^(website|websiteUrl|url|homepage|site)$/i.test(key)) {
      const website = websiteValue(value);
      if (!website) continue;
      output.push({
        id: `website:${website}`,
        type: "website",
        value: website,
        sourceUrl: website,
        sourceCategory: "imported-record",
        method: "record-field",
        confidence: 0.96,
        confidenceLabel: "high",
        reason: `Imported ${key} field.`
      });
    }
  }
  return [...new Map(output.map((item) => [`${item.type}:${item.value}`, item])).values()].sort(
    (left, right) => right.confidence - left.confidence
  );
}

function createProcessingResult(job, record, model, template) {
  return {
    id: `result_${job.id}_${record.id}`,
    jobId: job.id,
    projectId: state.activeProjectId,
    recordId: record.id,
    templateId: template.id,
    provider: model.providerId,
    model: model.providerModelId,
    status: "processing",
    subject: "",
    originalAiBodyHtml: "",
    finalEmailHtml: "",
    finalText: "",
    addendumSnapshot: "",
    signatureSnapshot: state.settings.businessSignature,
    contacts: importedContactCandidates(record),
    primaryContactId: null,
    consentStatus: record.normalized.consentStatus || record.normalized.consent_status || "unknown",
    consentSource: record.normalized.consentSource || record.normalized.consent_source || "",
    consentTimestamp: record.normalized.consentTimestamp || record.normalized.consent_timestamp || "",
    version: 1,
    trashed: false,
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
}

function mergeContactCandidates(existing, incoming) {
  return [
    ...new Map(
      [...(existing ?? []), ...(incoming ?? [])].map((candidate) => [
        `${candidate.type}:${candidate.value}`,
        candidate
      ])
    ).values()
  ].sort((left, right) => right.confidence - left.confidence);
}

function applyGeneratedEmail(result, generated, { record, research, prompt, usage }) {
  const addendum = selectedAddendum();
  const complianceFooter = [
    state.settings.companyAddress
      ? `<p>${escapeHtml(state.settings.companyAddress).replace(/\n/g, "<br>")}</p>`
      : "",
    state.settings.resendUnsubscribeUrl
      ? `<p><a href="${escapeHtml(state.settings.resendUnsubscribeUrl)}">${escapeHtml(
          state.settings.resendUnsubscribeUrl
        )}</a></p>`
      : ""
  ].join("");
  const composed = composeCanonicalEmail({
    subject: generated.subject,
    aiBodyHtml: generated.bodyHtml,
    addendumHtml: addendum?.content || "",
    signature: state.settings.businessSignature,
    finalUrl: state.settings.businessUrl,
    footerHtml: complianceFooter
  });
  if (!composed.subject || !composed.html.trim()) {
    throw appError(
      "EMAIL_RENDER_INVALID",
      `Generation for ${record.displayName || "this record"} did not produce complete HTML output.`,
      {
        recordId: record.id,
        subjectPresent: Boolean(composed.subject),
        htmlPresent: Boolean(composed.html)
      },
      "html-rendering"
    );
  }
  const researchCandidates = research?.contact?.candidates ?? research?.search?.candidates ?? [];
  result.status = "completed";
  result.subject = composed.subject;
  result.originalAiBodyHtml = generated.bodyHtml;
  result.finalEmailHtml = composed.html;
  result.finalText = composed.text;
  result.addendumId = addendum?.id || null;
  result.addendumSnapshot = addendum?.content || "";
  result.research = research ?? null;
  result.renderedPrompt = prompt ?? "";
  result.contacts = mergeContactCandidates(result.contacts, researchCandidates);
  result.primaryContactId =
    result.contacts.find((item) => item.type === "email")?.id ?? result.contacts[0]?.id ?? null;
  result.usage = usage ?? null;
  result.error = null;
  result.updatedAt = nowIso();
  return result;
}

async function rekeyProviderBatchJob(oldId, newId) {
  if (!oldId || !newId || oldId === newId) return state.jobs.find((job) => job.id === oldId) ?? null;
  const job = await state.repository.get("jobs", oldId);
  if (!job) return null;
  const results = (await state.repository.all("results")).filter((result) => result.jobId === oldId);
  const nextJob = {
    ...job,
    id: newId,
    providerBatch: {
      ...(job.providerBatch ?? {}),
      operationId: newId,
      updatedAt: nowIso()
    },
    updatedAt: nowIso()
  };
  for (const result of results) result.jobId = newId;
  await state.repository.atomicPut([
    { store: "jobs", value: nextJob },
    ...results.map((result) => ({ store: "results", value: result }))
  ]);
  await state.repository.delete("jobs", oldId);
  state.jobs = await state.repository.all("jobs");
  state.results = (await state.repository.all("results")).map((result) => normalizeStoredResult(result));
  return nextJob;
}

async function syncProviderBatchJob(job, batch) {
  if (!batch) return job;
  let currentJob = job;
  if (batch.operationId && batch.operationId !== job.id) {
    currentJob = (await rekeyProviderBatchJob(job.id, batch.operationId)) ?? {
      ...job,
      id: batch.operationId
    };
  }
  const persisted = (await state.repository.get("jobs", currentJob.id)) ?? currentJob;
  const nextJob = {
    ...persisted,
    ...currentJob,
    status: batch.status ?? persisted.status ?? currentJob.status,
    requestHash:
      batch.requestHash ?? persisted.requestHash ?? currentJob.requestHash ?? batch.clientRequestKey ?? null,
    clientRequestKey:
      batch.clientRequestKey ?? persisted.clientRequestKey ?? currentJob.clientRequestKey ?? null,
    counts: batch.counts ?? persisted.counts ?? currentJob.counts ?? {},
    error: batch.error ?? persisted.error ?? null,
    providerBatch: {
      ...(persisted.providerBatch ?? {}),
      ...(currentJob.providerBatch ?? {}),
      ...(batch.providerBatch ?? {}),
      operationId: batch.operationId ?? currentJob.id,
      requestHash:
        batch.requestHash ??
        persisted.requestHash ??
        currentJob.requestHash ??
        batch.clientRequestKey ??
        null,
      clientRequestKey:
        batch.clientRequestKey ?? persisted.clientRequestKey ?? currentJob.clientRequestKey ?? null,
      provider:
        batch.provider ?? persisted.providerBatch?.provider ?? currentJob.providerBatch?.provider ?? null,
      model: batch.model ?? persisted.providerBatch?.model ?? currentJob.providerBatch?.model ?? null,
      requests:
        batch.requests ?? persisted.providerBatch?.requests ?? currentJob.providerBatch?.requests ?? [],
      chunks: batch.chunks ?? persisted.providerBatch?.chunks ?? currentJob.providerBatch?.chunks ?? [],
      estimate:
        batch.estimate ?? persisted.providerBatch?.estimate ?? currentJob.providerBatch?.estimate ?? null,
      submissionState:
        batch.status ??
        persisted.providerBatch?.submissionState ??
        currentJob.providerBatch?.submissionState ??
        null,
      monitoringState:
        batch.status ??
        persisted.providerBatch?.monitoringState ??
        currentJob.providerBatch?.monitoringState ??
        null,
      updatedAt: nowIso()
    },
    updatedAt: nowIso()
  };
  await state.repository.put("jobs", nextJob);
  state.jobs = await state.repository.all("jobs");
  return nextJob;
}

function providerBatchResultStatus(resultState) {
  if (resultState === "completed") return "completed";
  if (["canceled", "cancelled"].includes(resultState)) return "stopped";
  return "failed";
}

function allProviderBatchChunksTerminal(chunks = []) {
  return (
    chunks.length > 0 &&
    chunks.every((chunk) =>
      ["completed", "failed", "cancelled", "canceled", "expired", "ended"].includes(
        String(chunk.providerStatus ?? "").toLowerCase()
      )
    )
  );
}

function reconcileProviderBatchCounts(job) {
  const relevant = state.results.filter((item) => item.jobId === job.id);
  const total = job.providerBatch?.requests?.length ?? job.options?.recordIds?.length ?? relevant.length;
  const completed = relevant.filter((item) => item.status === "completed").length;
  const failed = relevant.filter((item) => item.status === "failed").length;
  const stopped = relevant.filter((item) => item.status === "stopped").length;
  const running = Math.max(0, total - completed - failed - stopped);
  job.counts = {
    queued: 0,
    running,
    completed,
    failed,
    stopped,
    remaining: running
  };
}

async function finalizeUnresolvedProviderBatchResults(job, reason = "BATCH_RESULT_MISSING") {
  const requestById = new Map((job.providerBatch?.requests ?? []).map((item) => [item.recordId, item]));
  const unresolved = state.results.filter((item) => item.jobId === job.id && item.status === "processing");
  if (!unresolved.length) return;
  const stopping =
    job.status === "stopping" ||
    (job.providerBatch?.chunks ?? []).some((chunk) =>
      ["cancelled", "canceled"].includes(String(chunk.providerStatus ?? "").toLowerCase())
    );
  for (const result of unresolved) {
    result.status = stopping ? "stopped" : "failed";
    result.error = {
      code: stopping ? "BATCH_CANCELED" : reason,
      message: stopping
        ? "The provider batch was canceled before this record completed."
        : "The provider batch finished without returning a result for this record."
    };
    result.research = requestById.get(result.recordId)?.research ?? result.research ?? null;
    result.renderedPrompt = requestById.get(result.recordId)?.prompt ?? result.renderedPrompt ?? "";
    result.updatedAt = nowIso();
  }
  for (let index = 0; index < unresolved.length; index += 1) {
    unresolved[index] = await persistRevisionedRecord("results", unresolved[index]);
    upsertLocalResult(unresolved[index]);
  }
  reconcileProviderBatchCounts(job);
}

async function applyProviderBatchRefresh(job, batchPayload) {
  const nextUpdatedAt = nowIso();
  job.requestHash =
    batchPayload.requestHash ??
    job.requestHash ??
    job.clientRequestKey ??
    job.providerBatch?.requestHash ??
    null;
  job.clientRequestKey = batchPayload.clientRequestKey ?? job.clientRequestKey ?? job.requestHash ?? null;
  job.providerBatch = {
    ...(job.providerBatch ?? {}),
    ...(batchPayload.providerBatch ?? {}),
    operationId: batchPayload.operationId ?? job.id,
    requestHash:
      batchPayload.requestHash ??
      job.requestHash ??
      job.clientRequestKey ??
      job.providerBatch?.requestHash ??
      null,
    clientRequestKey:
      batchPayload.clientRequestKey ?? job.clientRequestKey ?? job.providerBatch?.clientRequestKey ?? null,
    provider: batchPayload.provider ?? job.providerBatch?.provider ?? job.options?.provider ?? null,
    model: batchPayload.model ?? job.providerBatch?.model ?? job.options?.model ?? null,
    requests: batchPayload.requests ?? job.providerBatch?.requests ?? [],
    chunks: batchPayload.chunks ?? job.providerBatch?.chunks ?? [],
    estimate: batchPayload.estimate ?? job.providerBatch?.estimate ?? null,
    lastPolledAt: nextUpdatedAt,
    pollCount: (job.providerBatch?.pollCount ?? 0) + 1,
    updatedAt: nextUpdatedAt
  };
  const requestById = new Map((job.providerBatch?.requests ?? []).map((item) => [item.customId, item]));
  const resultByRecordId = new Map(
    state.results.filter((item) => item.jobId === job.id).map((item) => [item.recordId, item])
  );
  const updated = [];
  for (const providerResult of batchPayload.results ?? []) {
    const request = requestById.get(providerResult.customId);
    if (!request) continue;
    const result = resultByRecordId.get(request.recordId);
    if (!result) continue;
    if (providerResult.state === "completed") {
      try {
        applyGeneratedEmail(result, providerResult.generated, {
          record: state.records.find((item) => item.id === request.recordId) ?? {
            id: request.recordId,
            displayName: request.displayName,
            normalized: {}
          },
          research: request.research,
          prompt: request.prompt,
          usage: providerResult.usage
        });
      } catch (error) {
        result.status = "failed";
        result.error = {
          code: error.code || "PROCESSING_FAILED",
          message: error.message,
          stage: error.stage || "processing"
        };
        result.updatedAt = nowIso();
      }
    } else {
      result.status = providerBatchResultStatus(providerResult.state);
      result.research = request.research ?? result.research ?? null;
      result.renderedPrompt = request.prompt ?? result.renderedPrompt ?? "";
      result.error = providerResult.error ?? {
        code: providerResult.state || "PROVIDER_ERROR",
        message: "The provider batch request did not complete successfully."
      };
      result.updatedAt = nowIso();
    }
    updated.push(result);
  }
  if (updated.length) {
    for (let index = 0; index < updated.length; index += 1) {
      updated[index] = await persistRevisionedRecord("results", updated[index]);
      upsertLocalResult(updated[index]);
    }
  }
  reconcileProviderBatchCounts(job);
  const summary = providerBatchOperationSummary(job);
  job.counts = {
    ...job.counts,
    total: summary.counts.total,
    accepted: summary.counts.accepted,
    pending: summary.counts.pending,
    submissionUnknown: summary.counts.submissionUnknown,
    reconciling: summary.counts.reconciling
  };
  const providedStatus = String(batchPayload.status ?? "").toLowerCase();
  const countsStatus =
    summary.counts.submissionUnknown > 0
      ? "submission_unknown"
      : summary.counts.reconciling > 0
        ? "reconciling"
        : summary.counts.completed > 0 &&
            summary.counts.failed > 0 &&
            summary.counts.pending === 0 &&
            summary.counts.stopped === 0
          ? "partially_failed"
          : summary.counts.completed > 0 &&
              summary.counts.pending === 0 &&
              summary.counts.failed === 0 &&
              summary.counts.stopped === 0
            ? "completed"
            : summary.counts.failed > 0 && summary.counts.completed === 0 && summary.counts.pending === 0
              ? "failed"
              : summary.counts.stopped > 0 &&
                  summary.counts.completed === 0 &&
                  summary.counts.failed === 0 &&
                  summary.counts.pending === 0
                ? "stopped"
                : summary.anyAccepted && summary.counts.pending > 0
                  ? "monitoring"
                  : summary.counts.total > 0
                    ? "submitted"
                    : job.status;
  const nextStatus = [
    "submission_unknown",
    "reconciling",
    "partially_failed",
    "completed",
    "failed",
    "stopped"
  ].includes(countsStatus)
    ? countsStatus
    : providedStatus || countsStatus;
  job.status = nextStatus;
  const nextError =
    batchPayload.error ??
    job.providerBatch?.error ??
    (["credential_required", "submission_unknown", "monitoring_degraded"].includes(nextStatus)
      ? (job.error ?? null)
      : null);
  job.error = nextError;
  if (allProviderBatchChunksTerminal(job.providerBatch?.chunks) && job.counts.running > 0) {
    await finalizeUnresolvedProviderBatchResults(job);
  }
  await updateJob(job);
  renderResults({ preserveEditor: true });
}

function providerBatchJobRecords(job) {
  const recordIds =
    job?.options?.recordIds ?? job?.providerBatch?.requests?.map((item) => item.recordId) ?? [];
  return recordIds.map((id) => state.records.find((record) => record.id === id)).filter(Boolean);
}

function providerBatchJobModel(job) {
  const provider = job?.providerBatch?.provider ?? job?.options?.provider ?? null;
  const modelId = job?.providerBatch?.model ?? job?.options?.model ?? job?.options?.modelId ?? null;
  return (
    state.models.find(
      (item) =>
        item.providerId === provider &&
        (item.providerModelId === modelId || item.id === modelId || item.displayName === modelId)
    ) ?? null
  );
}

function mergeProviderBatchJob(existingJob, incomingJob) {
  if (!existingJob) return incomingJob;
  if (!incomingJob) return existingJob;
  const existingProviderBatch = existingJob.providerBatch ?? {};
  const incomingProviderBatch = incomingJob.providerBatch ?? {};
  const existingOptions = existingJob.options ?? {};
  const incomingOptions = incomingJob.options ?? {};
  const recordIds =
    existingOptions.recordIds ??
    existingProviderBatch.requests?.map((item) => item.recordId) ??
    incomingOptions.recordIds ??
    incomingProviderBatch.requests?.map((item) => item.recordId) ??
    [];
  return {
    ...existingJob,
    ...incomingJob,
    projectId: incomingJob.projectId ?? existingJob.projectId ?? null,
    executionMode: incomingJob.executionMode ?? existingJob.executionMode ?? "provider-batch",
    requestHash:
      incomingJob.requestHash ?? existingJob.requestHash ?? existingProviderBatch.requestHash ?? null,
    clientRequestKey:
      incomingJob.clientRequestKey ??
      existingJob.clientRequestKey ??
      existingProviderBatch.clientRequestKey ??
      null,
    options: {
      ...incomingOptions,
      ...existingOptions,
      modelId: existingOptions.modelId ?? incomingOptions.modelId ?? null,
      provider:
        existingOptions.provider ?? incomingOptions.provider ?? existingProviderBatch.provider ?? null,
      model: existingOptions.model ?? incomingOptions.model ?? existingProviderBatch.model ?? null,
      templateId: existingOptions.templateId ?? incomingOptions.templateId ?? null,
      recordIds
    },
    providerBatch: {
      ...existingProviderBatch,
      ...incomingProviderBatch,
      operationId: incomingProviderBatch.operationId ?? incomingJob.operationId ?? existingJob.id ?? null,
      requestHash:
        incomingProviderBatch.requestHash ?? incomingJob.requestHash ?? existingJob.requestHash ?? null,
      clientRequestKey:
        incomingProviderBatch.clientRequestKey ??
        incomingJob.clientRequestKey ??
        existingJob.clientRequestKey ??
        null,
      provider:
        incomingProviderBatch.provider ??
        incomingJob.provider ??
        existingProviderBatch.provider ??
        existingOptions.provider ??
        incomingOptions.provider ??
        null,
      model:
        incomingProviderBatch.model ??
        incomingJob.model ??
        existingProviderBatch.model ??
        existingOptions.model ??
        incomingOptions.model ??
        null,
      requests: incomingProviderBatch.requests ?? existingProviderBatch.requests ?? [],
      chunks: incomingProviderBatch.chunks ?? existingProviderBatch.chunks ?? [],
      estimate:
        incomingProviderBatch.estimate ??
        existingProviderBatch.estimate ??
        existingJob.providerBatch?.estimate ??
        null,
      submissionState:
        incomingProviderBatch.submissionState ??
        incomingJob.status ??
        existingProviderBatch.submissionState ??
        existingJob.status ??
        null,
      monitoringState:
        incomingProviderBatch.monitoringState ??
        incomingJob.status ??
        existingProviderBatch.monitoringState ??
        existingJob.status ??
        null
    }
  };
}

async function resumeProviderBatchSubmission(job) {
  const model = providerBatchJobModel(job);
  if (!model) {
    throw appError(
      "MODEL_NOT_FOUND",
      "The original model for this provider batch is no longer available.",
      { jobId: job.id },
      "batch-submission"
    );
  }
  const records = providerBatchJobRecords(job);
  if (!records.length) {
    throw appError(
      "BATCH_RECORDS_MISSING",
      "The original records for this provider batch could not be found.",
      { jobId: job.id },
      "batch-submission"
    );
  }
  const template =
    state.templates.find((item) => item.id === job?.options?.templateId) ??
    state.templates.find((item) => item.name === job?.options?.templateName) ??
    activeTemplate();
  if (!template) {
    throw appError(
      "TEMPLATE_NOT_FOUND",
      "The original template for this provider batch could not be found.",
      { jobId: job.id },
      "batch-submission"
    );
  }
  const executionPlan = resolveExecutionPlan(model, "provider-batch");
  const requestHash = await providerBatchRequestKey({
    projectId: state.activeProjectId,
    records,
    template: { name: template.name, content: $("templateEditor").value },
    provider: model.providerId,
    model: model.providerModelId,
    researchEnabled: $("researchEnabled").checked,
    researchDepth: Number($("researchDepth").value),
    options: {
      ollamaHost: state.settings.ollamaHost,
      confirmedCustomOllamaHost: state.settings.confirmedCustomOllamaHost,
      customBaseUrl: state.settings.customBaseUrl,
      confirmedCustomProviderHost: state.settings.confirmedCustomProviderHost,
      httpReferer: state.settings.openrouterReferer
    }
  });
  if (
    (job.requestHash ?? job.clientRequestKey) &&
    requestHash !== (job.requestHash ?? job.clientRequestKey)
  ) {
    throw appError(
      "BATCH_INPUT_CHANGED",
      "The batch inputs changed since this provider batch was created. Restore the original template or start a new batch.",
      { jobId: job.id },
      "batch-submission"
    );
  }
  return processProviderBatchScope(records, model, template, executionPlan, {
    operationId: job.id,
    resumeSubmission: true
  });
}

function currentProjectProviderBatchOperations() {
  return state.jobs
    .filter(
      (job) =>
        job.executionMode === "provider-batch" &&
        (!state.activeProjectId || job.projectId === state.activeProjectId)
    )
    .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)));
}

function renderProviderBatchOperations() {
  const tbody = $("providerBatchOperationRows");
  if (!tbody) return;
  const operations = currentProjectProviderBatchOperations();
  if (!operations.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 6;
    cell.className = "caption";
    cell.textContent = "No provider-batch operations for this project yet.";
    row.append(cell);
    tbody.replaceChildren(row);
    return;
  }
  tbody.replaceChildren(
    ...operations.map((job) => {
      const summary = providerBatchOperationSummary(job);
      const row = document.createElement("tr");
      if (summary.attention) row.dataset.attention = "true";

      const operationCell = document.createElement("td");
      operationCell.style.whiteSpace = "normal";
      const operationTitle = document.createElement("strong");
      operationTitle.textContent = job.id;
      const operationMeta = document.createElement("div");
      operationMeta.className = "caption";
      operationMeta.textContent = `${job.options?.provider ?? job.providerBatch?.provider ?? "Unknown"} / ${
        job.options?.model ?? job.providerBatch?.model ?? "Unknown"
      }`;
      operationCell.append(operationTitle, document.createElement("br"), operationMeta);
      row.append(operationCell);

      const statusCell = document.createElement("td");
      statusCell.style.whiteSpace = "normal";
      const statusLabel = document.createElement("div");
      statusLabel.textContent = providerBatchOperationStatusLabel(job.status);
      const statusMeta = document.createElement("div");
      statusMeta.className = "caption";
      statusMeta.textContent = job.error?.message || "";
      statusCell.append(statusLabel, statusMeta);
      row.append(statusCell);

      const phaseCell = document.createElement("td");
      phaseCell.style.whiteSpace = "normal";
      phaseCell.textContent = `Submission: ${job.providerBatch?.submissionState ?? "n/a"} · Monitoring: ${
        job.providerBatch?.monitoringState ?? "n/a"
      }`;
      row.append(phaseCell);

      const progressCell = document.createElement("td");
      progressCell.style.whiteSpace = "normal";
      progressCell.textContent = `${summary.counts.accepted}/${summary.counts.total} accepted · ${summary.counts.completed} completed · ${summary.counts.failed} failed · ${summary.counts.pending} pending`;
      row.append(progressCell);

      const updatedCell = document.createElement("td");
      updatedCell.textContent = formatDate(job.updatedAt);
      row.append(updatedCell);

      const actionCell = document.createElement("td");
      actionCell.style.whiteSpace = "normal";
      const canResumeSubmission =
        [
          "credential_required",
          "submission_unknown",
          "reconciling",
          "monitoring_degraded",
          "submitting"
        ].includes(String(job.status ?? "").toLowerCase()) && !summary.anyAccepted;
      const canResumeMonitoring =
        !isTerminalProviderBatchOperation(job) && (summary.anyAccepted || summary.counts.total > 0);
      if (canResumeSubmission || canResumeMonitoring) {
        const button = document.createElement("button");
        button.type = "button";
        button.dataset.providerBatchAction = canResumeSubmission ? "resume-submission" : "resume-monitoring";
        button.dataset.jobId = job.id;
        button.textContent = canResumeSubmission ? "Resume submission" : "Resume monitoring";
        button.disabled = Boolean(state.processing) || state.providerBatchMonitors.has(job.id);
        actionCell.append(button);
      } else {
        actionCell.textContent = "No action";
      }
      row.append(actionCell);

      return row;
    })
  );
}

async function cancelProviderBatchMonitoring(job) {
  if (!job.providerBatch?.chunks?.length || job.providerBatch?.cancellationRequestedAt) return;
  const payload = await api("/api/gateway/batches/cancel", {
    method: "POST",
    body: JSON.stringify({
      provider: job.options.provider,
      model: job.options.model,
      operationId: job.id,
      requestHash: job.requestHash ?? job.clientRequestKey ?? job.providerBatch?.requestHash ?? null,
      clientRequestKey: job.clientRequestKey,
      chunks: job.providerBatch.chunks
    })
  });
  job.providerBatch = {
    ...(job.providerBatch ?? {}),
    chunks: payload.batch?.chunks ?? job.providerBatch?.chunks ?? [],
    cancellationRequestedAt: nowIso()
  };
  await updateJob(job);
}

async function resumeProviderBatchMonitoring() {
  const resumable = state.jobs
    .filter(
      (job) =>
        job.executionMode === "provider-batch" &&
        !isTerminalProviderBatchOperation(job) &&
        (job.providerBatch?.chunks?.some((chunk) => chunk.providerBatchId) ||
          [
            "submitting",
            "partially_submitted",
            "submitted",
            "monitoring",
            "monitoring_degraded",
            "credential_required",
            "stopping"
          ].includes(String(job.status ?? "").toLowerCase()))
    )
    .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)));
  for (const job of resumable) {
    if (state.providerBatchMonitors.has(job.id)) continue;
    void monitorProviderBatchJob(job, { resumed: true, background: true }).catch((error) => {
      state.logger?.warn?.("provider_batch_monitor_failed", {
        jobId: job.id,
        message: error.message
      });
    });
  }
}

async function monitorProviderBatchJob(job, { resumed = false, background = false } = {}) {
  if (state.providerBatchMonitors.has(job.id)) return;
  state.providerBatchMonitors.set(job.id, true);
  let latestJob = job;
  let backoffMs = PROVIDER_BATCH_POLL_INTERVAL_MS;
  try {
    if (!background) {
      state.processing = {
        mode: "provider-batch",
        job: latestJob,
        stopRequested: latestJob.status === "stopping",
        cancelStarted: false,
        controllers: new Map()
      };
      $("stopButton").hidden = false;
      $("stopButton").disabled = false;
      updateProcessingButton();
    }
    renderProgress(latestJob);
    if (resumed) {
      const recordCount =
        latestJob.providerBatch?.requests?.length ??
        latestJob.options?.recordIds?.length ??
        providerBatchJobRecords(latestJob).length;
      if (recordCount > 0) {
        setStatus(`Resuming provider batch monitoring for ${pluralize(recordCount, "record")}.`);
      }
    }
    while (true) {
      if (!background && state.processing?.stopRequested && !state.processing.cancelStarted) {
        state.processing.cancelStarted = true;
        await cancelProviderBatchMonitoring(latestJob);
      }
      const current = (await state.repository.get("jobs", latestJob.id)) ?? latestJob;
      latestJob = current;
      if (isTerminalProviderBatchOperation(latestJob)) {
        break;
      }
      if (
        String(latestJob.status ?? "").toLowerCase() === "submission_unknown" &&
        !latestJob.providerBatch?.chunks?.some((chunk) => chunk.providerBatchId)
      ) {
        await updateJob(latestJob);
        setStatus(`Provider batch ${latestJob.id} needs reconciliation before retrying.`, true);
        break;
      }
      const payload = await api("/api/gateway/batches/status", {
        method: "POST",
        body: JSON.stringify({
          provider: latestJob.providerBatch?.provider ?? latestJob.options?.provider ?? null,
          model: latestJob.providerBatch?.model ?? latestJob.options?.model ?? null,
          operationId: latestJob.id,
          requestHash:
            latestJob.requestHash ??
            latestJob.clientRequestKey ??
            latestJob.providerBatch?.requestHash ??
            null,
          clientRequestKey: latestJob.clientRequestKey ?? latestJob.providerBatch?.clientRequestKey ?? null,
          chunks: latestJob.providerBatch?.chunks ?? []
        })
      });
      await applyProviderBatchRefresh(latestJob, payload.batch ?? payload.operation ?? payload);
      const refreshed = (await state.repository.get("jobs", latestJob.id)) ?? latestJob;
      latestJob = refreshed;
      backoffMs =
        String(latestJob.status ?? "").toLowerCase() === "monitoring_degraded"
          ? Math.min(backoffMs * 2, 30_000)
          : PROVIDER_BATCH_POLL_INTERVAL_MS;
      if (isTerminalProviderBatchOperation(latestJob)) {
        await state.logger.info("browser_provider_batch_finished", {
          jobId: latestJob.id,
          projectId: state.activeProjectId,
          resumed,
          status: latestJob.status,
          counts: latestJob.counts,
          chunkCount: latestJob.providerBatch?.chunks?.length ?? 0
        });
        setStatus(
          `Job ${latestJob.status}: ${latestJob.counts.completed} completed, ${latestJob.counts.failed} failed, ${latestJob.counts.stopped} stopped.`
        );
        break;
      }
      if (String(latestJob.status ?? "").toLowerCase() === "credential_required") {
        setStatus(`Provider batch ${latestJob.id} is paused until credentials are restored.`, true);
        break;
      }
      if (String(latestJob.status ?? "").toLowerCase() === "submission_unknown") {
        setStatus(`Provider batch ${latestJob.id} needs reconciliation before it can continue.`, true);
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    }
  } catch (error) {
    if (!background) throw error;
    await state.logger.warn("browser_provider_batch_monitor_error", {
      jobId: latestJob.id,
      message: error.message
    });
  } finally {
    state.providerBatchMonitors.delete(job.id);
    if (!background) {
      state.processing = null;
      $("stopButton").hidden = true;
      $("stopButton").disabled = true;
      updateProcessingButton();
    }
  }
}

async function processProviderBatchScope(
  records,
  model,
  template,
  executionPlan,
  { operation = null, scopeIdentity = null, operationId = null, resumeSubmission = false } = {}
) {
  const projectId = state.activeProjectId ?? null;
  const resolvedScopeIdentity =
    scopeIdentity ??
    (await processScopeIdentity({
      projectId,
      recordIds: records.map((item) => item.id),
      template: { id: template.id, name: template.name, content: $("templateEditor").value },
      provider: model.providerId,
      model: model.providerModelId,
      researchEnabled: $("researchEnabled").checked,
      researchDepth: Number($("researchDepth").value),
      options: {
        ollamaHost: state.settings.ollamaHost,
        confirmedCustomOllamaHost: state.settings.confirmedCustomOllamaHost,
        customBaseUrl: state.settings.customBaseUrl,
        confirmedCustomProviderHost: state.settings.confirmedCustomProviderHost,
        httpReferer: state.settings.openrouterReferer
      },
      addendum: selectedAddendum(),
      scope: "provider-batch"
    }));
  const operationScopeId = operation?.operationId ?? operationId ?? makeId("job");
  const requestHash = await providerBatchRequestKey({
    projectId,
    records,
    template: { name: template.name, content: $("templateEditor").value },
    provider: model.providerId,
    model: model.providerModelId,
    researchEnabled: $("researchEnabled").checked,
    researchDepth: Number($("researchDepth").value),
    options: {
      ollamaHost: state.settings.ollamaHost,
      confirmedCustomOllamaHost: state.settings.confirmedCustomOllamaHost,
      customBaseUrl: state.settings.customBaseUrl,
      confirmedCustomProviderHost: state.settings.confirmedCustomProviderHost,
      httpReferer: state.settings.openrouterReferer
    }
  });
  let job = {
    id: operationScopeId,
    operationId: operationScopeId,
    scopeKey: resolvedScopeIdentity.scopeKey,
    ownerTabId: state.tabId,
    projectId,
    status: "submitting",
    executionMode: "provider-batch",
    requestedExecutionMode: executionPlan.requested,
    requestHash,
    clientRequestKey: requestHash,
    options: {
      modelId: model.id,
      provider: model.providerId,
      model: model.providerModelId,
      templateId: template.id,
      recordIds: records.map((item) => item.id)
    },
    counts: {
      queued: 0,
      running: records.length,
      completed: 0,
      failed: 0,
      stopped: 0,
      remaining: records.length
    },
    providerBatch: {
      operationId: operationScopeId,
      requestHash,
      clientRequestKey: requestHash,
      provider: model.providerId,
      model: model.providerModelId,
      requests: records.map((record) => ({
        recordId: record.id,
        displayName: record.displayName,
        customId: record.id
      })),
      chunks: [],
      submissionState: "submitting",
      monitoringState: "submitting"
    },
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
  const existingResultsByRecordId = new Map(
    state.results.filter((item) => item.jobId === job.id).map((item) => [item.recordId, item])
  );
  const placeholderResults = records.map((record) => {
    const existingResult = existingResultsByRecordId.get(record.id);
    if (existingResult) {
      return {
        ...existingResult,
        jobId: job.id,
        projectId,
        recordId: record.id,
        templateId: template.id,
        provider: model.providerId,
        model: model.providerModelId,
        status: "processing",
        updatedAt: nowIso()
      };
    }
    return createProcessingResult(job, record, model, template);
  });
  await state.repository.put("jobs", job);
  for (let index = 0; index < placeholderResults.length; index += 1) {
    placeholderResults[index] = await persistRevisionedRecord("results", placeholderResults[index]);
    upsertLocalResult(placeholderResults[index]);
  }
  state.jobs = [job, ...state.jobs.filter((item) => item.id !== job.id)];
  state.results = (await state.repository.all("results")).map((result) => normalizeStoredResult(result));
  renderResults({ preserveEditor: true });
  if (state.operationCoordinator && resolvedScopeIdentity) {
    const current = operation ?? (await state.operationCoordinator.read(resolvedScopeIdentity.scopeKey));
    if (current) {
      operation = await state.operationCoordinator
        .update(resolvedScopeIdentity.scopeKey, current.revision, {
          status: "in-progress",
          jobId: job.id,
          projectId,
          recordCount: records.length,
          counts: { ...job.counts },
          provider: model.providerId,
          model: model.providerModelId,
          templateId: template.id
        })
        .catch(() => current);
    }
  }
  await state.logger.info("browser_provider_batch_submission_requested", {
    jobId: job.id,
    projectId,
    recordCount: records.length,
    provider: model.providerId,
    model: model.providerModelId,
    templateId: template.id,
    requestHash
  });
  try {
    const payload = await api("/api/gateway/batches/submit", {
      method: "POST",
      body: JSON.stringify(
        providerBatchSubmitPayload({
          operationId: job.id,
          requestHash,
          clientRequestKey: requestHash,
          projectId,
          resumeSubmission,
          records,
          template: { name: template.name, content: $("templateEditor").value },
          provider: model.providerId,
          model: model.providerModelId,
          researchEnabled: $("researchEnabled").checked,
          researchDepth: Number($("researchDepth").value),
          options: {
            ollamaHost: state.settings.ollamaHost,
            confirmedCustomOllamaHost: state.settings.confirmedCustomOllamaHost,
            customBaseUrl: state.settings.customBaseUrl,
            confirmedCustomProviderHost: state.settings.confirmedCustomProviderHost,
            httpReferer: state.settings.openrouterReferer
          }
        })
      )
    });
    const batch = payload.batch ?? payload.operation ?? payload;
    job = await syncProviderBatchJob(job, batch);
    await state.logger.info("browser_provider_batch_submission_completed", {
      jobId: job.id,
      projectId,
      recordCount: records.length,
      provider: model.providerId,
      model: model.providerModelId,
      templateId: template.id,
      requestHash,
      status: job.status,
      acceptedChunkCount: job.providerBatch?.chunks?.filter((chunk) => Boolean(chunk.providerBatchId)).length ?? 0,
      chunkCount: job.providerBatch?.chunks?.length ?? 0
    });
    if (!job.providerBatch?.chunks?.some((chunk) => chunk.providerBatchId)) {
      await updateJob(job);
      setStatus(
        `Submitted ${pluralize(records.length, "record")} to ${model.providerId} provider batch.${Number.isFinite(job.providerBatch?.estimate?.savingsPercent) ? ` About ${job.providerBatch.estimate.savingsPercent}% lower estimated cost.` : ""}`
      );
      if (job.status === "submission_unknown" || job.status === "credential_required") {
        renderResults({ preserveEditor: true });
        return job;
      }
      return monitorProviderBatchJob(job);
    }
    await updateJob(job);
    setStatus(
      `${providerBatchOperationStatusLabel(job.status)} for ${pluralize(records.length, "record")} on ${model.providerId} provider batch.`
    );
    renderResults({ preserveEditor: true });
    if (state.operationCoordinator && resolvedScopeIdentity && operation) {
      if (isTerminalProviderBatchOperation(job)) {
        await state.operationCoordinator
          .release(operation, {
            status: "succeeded",
            completedAt: nowIso(),
            leaseExpiresAt: null,
            ownerTabId: null
          })
          .catch(() => {});
      } else {
        operation = await state.operationCoordinator
          .update(resolvedScopeIdentity.scopeKey, operation.revision, {
            status: "monitoring",
            jobId: job.id,
            counts: { ...job.counts },
            leaseExpiresAt: new Date(Date.now() + 30_000).toISOString()
          })
          .catch(() => operation);
      }
    }
    if (!isTerminalProviderBatchOperation(job)) {
      return monitorProviderBatchJob(job);
    }
    return job;
  } catch (error) {
    const resolved = shouldAttemptProviderBatchResolve(error)
      ? await api("/api/gateway/batches/resolve", {
          method: "POST",
          body: JSON.stringify(
            providerBatchResolvePayload({
              operationId: job.id,
              requestHash,
              clientRequestKey: requestHash
            })
          ),
          logErrors: false
        }).catch(() => null)
      : null;
    if (resolved?.operation) {
      job = await syncProviderBatchJob(job, resolved.operation);
      await updateJob(job);
      await state.logger.info("browser_provider_batch_submission_reconciled", {
        jobId: job.id,
        projectId,
        recordCount: records.length,
        provider: model.providerId,
        model: model.providerModelId,
        templateId: template.id,
        requestHash,
        status: job.status,
        acceptedChunkCount: job.providerBatch?.chunks?.filter((chunk) => Boolean(chunk.providerBatchId)).length ?? 0,
        chunkCount: job.providerBatch?.chunks?.length ?? 0
      });
      setStatus(
        `${providerBatchOperationStatusLabel(job.status)} recovered for ${pluralize(records.length, "record")} on ${model.providerId} provider batch.`
      );
      renderResults({ preserveEditor: true });
      if (
        !isTerminalProviderBatchOperation(job) &&
        job.providerBatch?.chunks?.some((chunk) => chunk.providerBatchId)
      ) {
        return monitorProviderBatchJob(job, { resumed: true });
      }
      return job;
    }

    const code = error.code || "BATCH_SUBMISSION_UNKNOWN";
    if (code === "PROVIDER_CREDENTIAL_MISSING" || code === "PROVIDER_AUTH_FAILED") {
      job.status = "credential_required";
      job.error = {
        code,
        message: error.message
      };
      job.providerBatch = {
        ...(job.providerBatch ?? {}),
        submissionState: "credential_required",
        monitoringState: "credential_required",
        recoveredAt: nowIso(),
        error: {
          code,
          message: error.message,
          stage: error.stage || "batch-submission"
        }
      };
      await state.repository.put("jobs", job);
      state.jobs = await state.repository.all("jobs");
      await state.logger.warn("browser_provider_batch_submission_blocked", {
        jobId: job.id,
        projectId,
        recordCount: records.length,
        provider: model.providerId,
        model: model.providerModelId,
        templateId: template.id,
        requestHash,
        code,
        stage: error.stage || "batch-submission"
      });
      setStatus("Provider credentials are required to continue submitting this batch.", true);
      renderResults({ preserveEditor: true });
      if (state.operationCoordinator && resolvedScopeIdentity && operation) {
        await state.operationCoordinator
          .update(resolvedScopeIdentity.scopeKey, operation.revision, {
            status: "reconciliation-required",
            lastError: { code, message: error.message }
          })
          .catch(() => {});
      }
      return job;
    }

    if (code === "VALIDATION_ERROR" || code === "BATCH_MODE_UNAVAILABLE") {
      for (const result of placeholderResults) {
        result.status = "failed";
        result.error = {
          code,
          message: error.message,
          stage: error.stage || "batch-submission"
        };
        result.updatedAt = nowIso();
      }
      job.status = "failed";
      job.error = {
        code,
        message: error.message
      };
      job.providerBatch = {
        ...(job.providerBatch ?? {}),
        submissionState: "failed",
        monitoringState: "failed",
        recoveredAt: nowIso()
      };
      for (let index = 0; index < placeholderResults.length; index += 1) {
        placeholderResults[index] = await persistRevisionedRecord("results", placeholderResults[index]);
        upsertLocalResult(placeholderResults[index]);
      }
      await state.repository.put("jobs", job);
      state.jobs = await state.repository.all("jobs");
      state.results = (await state.repository.all("results")).map((result) => normalizeStoredResult(result));
      await state.logger.warn("browser_provider_batch_submission_rejected", {
        jobId: job.id,
        projectId,
        recordCount: records.length,
        provider: model.providerId,
        model: model.providerModelId,
        templateId: template.id,
        requestHash,
        code,
        stage: error.stage || "batch-submission"
      });
      renderResults({ preserveEditor: true });
      setStatus(error.message, true);
      if (state.operationCoordinator && scopeIdentity && operation) {
        await state.operationCoordinator
          .release(operation, {
            status: "failed-safe",
            lastError: { code, message: error.message },
            leaseExpiresAt: null,
            ownerTabId: null
          })
          .catch(() => {});
      }
      throw error;
    }

    await state.logger.warn("browser_provider_batch_submission_unknown", {
      jobId: job.id,
      projectId,
      recordCount: records.length,
      provider: model.providerId,
      model: model.providerModelId,
      templateId: template.id,
      requestHash,
      code,
      message: error.message || "The provider batch submission outcome is unknown."
    });
    job.status = "submission_unknown";
    job.error = {
      code,
      message: error.message || "The provider batch submission outcome is unknown. Reconcile before retrying."
    };
    job.providerBatch = {
      ...(job.providerBatch ?? {}),
      submissionState: "submission_unknown",
      monitoringState: "reconciling",
      recoveredAt: nowIso()
    };
    await state.repository.put("jobs", job);
    state.jobs = await state.repository.all("jobs");
    setStatus("Provider batch submission outcome is unknown. Reconcile before retrying.", true);
    renderResults({ preserveEditor: true });
    if (state.operationCoordinator && resolvedScopeIdentity && operation) {
      await state.operationCoordinator
        .update(resolvedScopeIdentity.scopeKey, operation.revision, {
          status: "outcome-unknown",
          lastError: { code, message: job.error.message }
        })
        .catch(() => {});
    }
    return job;
  }
}

async function processScopeStandard(
  records = scopeRecords(),
  { operation = null, scopeIdentity = null, retryExisting = false } = {}
) {
  assertStorageGate("external", "processing");
  const model = selectedModel();
  const template = activeTemplate();
  if (!records.length) throw new Error("No ready records match this scope.");
  if (!model) throw new Error("Select a model in Model Catalog first.");
  if (model.availability === "unavailable")
    throw new Error(
      "The selected model is unavailable. Choose an alternative; the app will not switch silently."
    );
  const analysis = records.map((record) => analyzeTemplate($("templateEditor").value, record.normalized));
  if (analysis.some((item) => !item.canProcess))
    throw new Error("One or more records have unresolved required or malformed template variables.");
  if (state.repository.temporary || !state.operationCoordinator)
    throw appError(
      "COORDINATION_UNAVAILABLE",
      "Browser storage is unavailable. Paid processing is disabled until durable storage is restored.",
      undefined,
      "coordination"
    );
  const identity =
    scopeIdentity ??
    (await processScopeIdentity({
      projectId: state.activeProjectId,
      recordIds: records.map((item) => item.id),
      template: { id: template.id, name: template.name, content: $("templateEditor").value },
      provider: model.providerId,
      model: model.providerModelId,
      researchEnabled: $("researchEnabled").checked,
      researchDepth: Number($("researchDepth").value),
      options: {
        ollamaHost: state.settings.ollamaHost,
        confirmedCustomOllamaHost: state.settings.confirmedCustomOllamaHost,
        customBaseUrl: state.settings.customBaseUrl,
        confirmedCustomProviderHost: state.settings.confirmedCustomProviderHost,
        httpReferer: state.settings.openrouterReferer
      },
      addendum: selectedAddendum(),
      scope: $("processingScope").value
    }));
  let activeOperation = operation ?? (await state.operationCoordinator.read(identity.scopeKey));
  if (!operation) {
    if (
      activeOperation &&
      (state.operationCoordinator.isActive(activeOperation) ||
        state.operationCoordinator.isUncertain(activeOperation))
    ) {
      state.operations = (await state.operationCoordinator.list()).map(withRevision);
      renderProgress();
      updateProcessingButton();
      setStatus(
        `${operationStatusLabel(activeOperation)} is already active in ${operationOwnerLabel(
          activeOperation,
          state.tabId
        )}.`
      );
      return activeOperation;
    }
    const before = activeOperation;
    const acquisition = await state.operationCoordinator.acquire(identity, {
      kind: "process",
      before,
      retryExisting
    });
    if (!acquisition.acquired) {
      state.operations = (await state.operationCoordinator.list()).map(withRevision);
      renderProgress();
      updateProcessingButton();
      const message =
        acquisition.reason === "reconciliation-required"
          ? "Another tab owns an unresolved processing operation. Reconcile before retrying."
          : `${operationStatusLabel(acquisition.operation)} is already active in ${operationOwnerLabel(
              acquisition.operation,
              state.tabId
            )}.`;
      setStatus(message, acquisition.reason === "reconciliation-required");
      return acquisition.operation;
    }
    activeOperation = acquisition.operation;
  }
  const heartbeatTimer = setInterval(() => {
    void state.operationCoordinator
      .heartbeat(activeOperation)
      .then((next) => {
        activeOperation = next;
      })
      .catch(() => {
        // Best-effort heartbeat; follow-up operations will surface stale leases.
      });
  }, 5000);
  heartbeatTimer.unref?.();
  const syncOperation = async (patch) => {
    activeOperation = await state.operationCoordinator.update(
      identity.scopeKey,
      activeOperation.revision,
      patch
    );
    return activeOperation;
  };
  const job = {
    id: activeOperation.operationId,
    operationId: activeOperation.operationId,
    scopeKey: identity.scopeKey,
    ownerTabId: state.tabId,
    projectId: state.activeProjectId,
    status: "running",
    executionMode: "standard",
    requestedExecutionMode: normalizeExecutionSetting(state.settings.executionMode),
    options: { modelId: model.id, templateId: template.id, recordIds: records.map((item) => item.id) },
    counts: {
      queued: records.length,
      running: 0,
      completed: 0,
      failed: 0,
      stopped: 0,
      remaining: records.length
    },
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
  await state.repository.put("jobs", job);
  state.jobs.unshift(job);
  state.processing = {
    mode: "standard",
    job,
    operation: activeOperation,
    stopRequested: false,
    controllers: new Map()
  };
  activeOperation = await syncOperation({
    status: "in-progress",
    jobId: job.id,
    projectId: state.activeProjectId,
    recordCount: records.length,
    counts: { ...job.counts },
    provider: model.providerId,
    model: model.providerModelId,
    templateId: template.id
  });
  await state.logger.info("browser_processing_started", {
    jobId: job.id,
    operationId: activeOperation.operationId,
    projectId: state.activeProjectId,
    recordCount: records.length,
    provider: model.providerId,
    model: model.providerModelId,
    templateId: template.id
  });
  $("stopButton").hidden = false;
  $("stopButton").disabled = false;
  updateProcessingButton();
  renderProgress(job);
  const queue = [...records];
  const concurrency = Math.max(
    1,
    Math.min(state.bootstrap.app.ai.maxConcurrency, Number($("concurrencyInput").value) || 1)
  );
  const delay = Math.max(0, Math.min(state.bootstrap.app.ai.maxDelayMs, Number($("delayInput").value) || 0));
  const classifyError = (error) => {
    if (error?.name === "AbortError") return "cancelled";
    if (
      ["PROVIDER_TIMEOUT", "PROVIDER_REQUEST_FAILED", "HTTP_ERROR", "RESEND_NETWORK_FAILED"].includes(
        error?.code
      )
    )
      return "outcome-unknown";
    return "failed-safe";
  };
  const worker = async () => {
    while (queue.length && !state.processing.stopRequested) {
      const record = queue.shift();
      job.counts.queued -= 1;
      job.counts.running += 1;
      await updateJob(job);
      activeOperation = await syncOperation({
        status: "in-progress",
        jobId: job.id,
        projectId: state.activeProjectId,
        currentRecordId: record.id,
        counts: { ...job.counts }
      });
      await state.logger.info("browser_record_processing_started", {
        jobId: job.id,
        operationId: activeOperation.operationId,
        projectId: state.activeProjectId,
        recordId: record.id,
        recordName: record.displayName,
        provider: model.providerId,
        model: model.providerModelId
      });
      let result = createProcessingResult(job, record, model, template);
      result = await persistRevisionedRecord("results", result);
      upsertLocalResult(result);
      const controller = new AbortController();
      state.processing.controllers.set(record.id, controller);
      try {
        await state.logger.debug("browser_gateway_request_started", {
          jobId: job.id,
          operationId: activeOperation.operationId,
          recordId: record.id,
          recordName: record.displayName
        });
        const requestIdentity = await gatewayRequestIdentity({
          record,
          template: { name: template.name, content: $("templateEditor").value },
          provider: model.providerId,
          model: model.providerModelId,
          researchEnabled: $("researchEnabled").checked,
          researchDepth: Number($("researchDepth").value),
          options: {
            ollamaHost: state.settings.ollamaHost,
            confirmedCustomOllamaHost: state.settings.confirmedCustomOllamaHost,
            customBaseUrl: state.settings.customBaseUrl,
            confirmedCustomProviderHost: state.settings.confirmedCustomProviderHost,
            httpReferer: state.settings.openrouterReferer
          }
        });
        const payload = await api("/api/gateway/generate", {
          method: "POST",
          signal: controller.signal,
          body: JSON.stringify({
            operationId: activeOperation.operationId,
            retryExisting: Boolean(retryExisting),
            scopeKey: requestIdentity.scopeKey,
            record,
            template: { name: template.name, content: $("templateEditor").value },
            provider: model.providerId,
            model: model.providerModelId,
            researchEnabled: $("researchEnabled").checked,
            researchDepth: Number($("researchDepth").value),
            options: {
              ollamaHost: state.settings.ollamaHost,
              confirmedCustomOllamaHost: state.settings.confirmedCustomOllamaHost,
              customBaseUrl: state.settings.customBaseUrl,
              confirmedCustomProviderHost: state.settings.confirmedCustomProviderHost,
              httpReferer: state.settings.openrouterReferer
            }
          })
        });
        const generated = validateGatewayPayload(payload, record);
        await state.logger.debug("browser_gateway_response_received", {
          jobId: job.id,
          operationId: activeOperation.operationId,
          recordId: record.id,
          recordName: record.displayName,
          usage: generated.usage ?? null
        });
        applyGeneratedEmail(result, generated, {
          record,
          research: payload.research,
          prompt: payload.prompt,
          usage: generated.usage ?? null
        });
        result = await persistRevisionedRecord("results", result);
        upsertLocalResult(result);
        job.counts.completed += 1;
        await state.logger.info("browser_record_processing_completed", {
          jobId: job.id,
          operationId: activeOperation.operationId,
          projectId: state.activeProjectId,
          recordId: record.id,
          recordName: record.displayName,
          resultId: result.id,
          contactCount: result.contacts.length
        });
      } catch (error) {
        if (error.name === "AbortError") {
          result.status = "stopped";
          result.error = { code: "JOB_CANCELED", message: "This record was canceled." };
          job.counts.stopped += 1;
        } else {
          result.status = "failed";
          result.error = {
            code: error.code || "PROCESSING_FAILED",
            message: error.message,
            stage: error.stage || "processing"
          };
          job.counts.failed += 1;
          await state.logger.error("browser_record_processing_failed", {
            jobId: job.id,
            operationId: activeOperation.operationId,
            projectId: state.activeProjectId,
            recordId: record.id,
            recordName: record.displayName,
            code: result.error.code,
            stage: result.error.stage,
            message: result.error.message
          });
        }
        result.updatedAt = nowIso();
        result = await persistRevisionedRecord("results", result);
        upsertLocalResult(result);
        activeOperation = await syncOperation({
          status: classifyError(error),
          jobId: job.id,
          projectId: state.activeProjectId,
          currentRecordId: record.id,
          lastError: {
            code: result.error?.code || error.code || "PROCESSING_FAILED",
            message: result.error?.message || error.message
          },
          counts: { ...job.counts }
        });
      } finally {
        state.processing?.controllers.delete(record.id);
        job.counts.running -= 1;
        job.counts.remaining = queue.length + job.counts.running;
        await updateJob(job);
        activeOperation = await syncOperation({
          status: state.processing.stopRequested ? "cancelled" : "in-progress",
          jobId: job.id,
          projectId: state.activeProjectId,
          counts: { ...job.counts },
          remaining: job.counts.remaining
        });
        state.results = (await state.repository.all("results")).map((result) => normalizeStoredResult(result));
        renderResults();
      }
      if (delay && !state.processing.stopRequested) {
        await new Promise((resolve) => setTimeout(resolve, delay));
        await state.operationCoordinator
          .heartbeat(activeOperation)
          .then((next) => {
            activeOperation = next;
          })
          .catch(() => {});
      }
    }
  };
  let finalStatus = "succeeded";
  try {
    await Promise.all(Array.from({ length: Math.min(concurrency, records.length) }, worker));
    if (state.processing.stopRequested) {
      job.counts.stopped += queue.length;
      job.counts.queued = 0;
      job.counts.remaining = 0;
      job.status = "stopped";
      finalStatus = "cancelled";
    } else {
      job.status = job.counts.failed && !job.counts.completed ? "failed" : "completed";
      finalStatus = job.status === "failed" ? "failed-safe" : "succeeded";
    }
    await updateJob(job);
    activeOperation = await syncOperation({
      status: finalStatus,
      jobId: job.id,
      projectId: state.activeProjectId,
      counts: { ...job.counts },
      completedAt: nowIso(),
      leaseExpiresAt: null,
      ownerTabId: null
    });
    setStatus(
      `Job ${job.status}: ${job.counts.completed} completed, ${job.counts.failed} failed, ${job.counts.stopped} stopped.`,
      job.status === "failed"
    );
    await state.logger.info("browser_processing_finished", {
      jobId: job.id,
      operationId: activeOperation.operationId,
      projectId: state.activeProjectId,
      status: job.status,
      counts: job.counts
    });
    return job;
  } catch (error) {
    finalStatus = classifyError(error);
    activeOperation = await syncOperation({
      status: finalStatus,
      jobId: job.id,
      projectId: state.activeProjectId,
      lastError: { code: error.code || "PROCESSING_FAILED", message: error.message }
    }).catch(() => {});
    throw error;
  } finally {
    clearInterval(heartbeatTimer);
    try {
      await state.operationCoordinator.release(activeOperation, {
        status: finalStatus,
        counts: { ...job.counts },
        leaseExpiresAt: null,
        ownerTabId: null
      });
    } catch (error) {
      void error;
      // Ignore release errors during shutdown; the coordinator may already be gone.
    }
    state.processing = null;
    $("stopButton").hidden = true;
    $("stopButton").disabled = true;
    updateProcessingButton();
    await refreshOperationSnapshot().catch(() => {});
  }
}

async function processScope(records = scopeRecords(), options = {}) {
  assertStorageGate("external", "processing");
  const model = selectedModel();
  const template = activeTemplate();
  if (!records.length) throw new Error("No ready records match this scope.");
  if (!model) throw new Error("Select a model in Model Catalog first.");
  if (!template) throw new Error("Choose or create a template first.");
  const executionPlan = resolveExecutionPlan(model, state.settings.executionMode);
  if (state.repository.temporary || !state.operationCoordinator)
    throw appError(
      "COORDINATION_UNAVAILABLE",
      "Browser storage is unavailable. Paid processing is disabled until durable storage is restored.",
      undefined,
      "coordination"
    );
  const scopeIdentity = await processScopeIdentity({
    projectId: state.activeProjectId,
    recordIds: records.map((item) => item.id),
    template: { id: template.id, name: template.name, content: $("templateEditor").value },
    provider: model.providerId,
    model: model.providerModelId,
    researchEnabled: $("researchEnabled").checked,
    researchDepth: Number($("researchDepth").value),
    options: {
      ollamaHost: state.settings.ollamaHost,
      confirmedCustomOllamaHost: state.settings.confirmedCustomOllamaHost,
      customBaseUrl: state.settings.customBaseUrl,
      confirmedCustomProviderHost: state.settings.confirmedCustomProviderHost,
      httpReferer: state.settings.openrouterReferer
    },
    addendum: selectedAddendum(),
    scope: $("processingScope").value
  });
  const beforeOperation = await state.operationCoordinator.read(scopeIdentity.scopeKey);
  const acquisition = await state.operationCoordinator.acquire(scopeIdentity, {
    kind: "process",
    before: beforeOperation,
    retryExisting: Boolean(options.retryExisting)
  });
  if (!acquisition.acquired) {
    state.operations = (await state.operationCoordinator.list()).map(withRevision);
    renderProgress();
    updateProcessingButton();
    setStatus(
      acquisition.reason === "reconciliation-required"
        ? "Another tab owns an unresolved processing operation. Reconcile before retrying."
        : `${operationStatusLabel(acquisition.operation)} is already active in ${operationOwnerLabel(
            acquisition.operation,
            state.tabId
          )}.`,
      acquisition.reason === "reconciliation-required"
    );
    return acquisition.operation;
  }
  if (executionPlan.mode === "provider-batch") {
    return processProviderBatchScope(records, model, template, executionPlan, {
      ...options,
      operation: acquisition.operation,
      scopeIdentity
    });
  }
  return processScopeStandard(records, {
    ...options,
    operation: acquisition.operation,
    scopeIdentity
  });
}

async function updateJob(job) {
  job.updatedAt = nowIso();
  await state.repository.put("jobs", job);
  state.jobs = [job, ...state.jobs.filter((item) => item.id !== job.id)];
  if (state.operationCoordinator && job.scopeKey && job.operationId) {
    const currentOperation = await state.operationCoordinator.read(job.scopeKey).catch(() => null);
    if (currentOperation && currentOperation.operationId === job.operationId) {
      const nextStatus =
        job.status === "completed"
          ? "succeeded"
          : job.status === "failed"
            ? "failed-safe"
            : job.status === "stopped"
              ? "cancelled"
              : job.status === "stopping"
                ? "in-progress"
                : currentOperation.status;
      await state.operationCoordinator
        .update(job.scopeKey, currentOperation.revision, {
          status: nextStatus,
          jobStatus: job.status,
          counts: { ...job.counts },
          leaseExpiresAt:
            nextStatus === "succeeded" || nextStatus === "failed-safe" || nextStatus === "cancelled"
              ? null
              : currentOperation.leaseExpiresAt,
          ownerTabId:
            nextStatus === "succeeded" || nextStatus === "failed-safe" || nextStatus === "cancelled"
              ? null
              : currentOperation.ownerTabId
        })
        .catch(() => {});
    }
  }
  renderProgress(job);
  renderProviderBatchOperations();
}

function renderProgress(job = state.jobs[0]) {
  const counts = job?.counts ?? { queued: 0, running: 0, completed: 0, failed: 0, stopped: 0, remaining: 0 };
  const keys = ["queued", "running", "completed", "failed", "stopped", "remaining"];
  $("progressSummary")
    .querySelectorAll("dd")
    .forEach((node, index) => {
      node.textContent = String(counts[keys[index]] ?? 0);
    });
  const matchingOperation =
    (job && state.operations.find((operation) => operation.operationId === job.id)) ??
    latestBlockingOperation(job?.executionMode === "provider-batch" ? "process" : null);
  const summary = job
    ? `${
        job.executionMode === "provider-batch" ? providerBatchOperationStatusLabel(job.status) : job.status
      } · ${counts.completed} completed · ${counts.failed} failed`
    : "No active job";
  $("jobSummary").textContent = matchingOperation
    ? `${summary} · ${operationStatusLabel(matchingOperation)} · ${operationOwnerLabel(matchingOperation, state.tabId)}`
    : summary;
}

function stopProcessing() {
  if (!state.processing) return;
  state.processing.stopRequested = true;
  state.processing.job.status = "stopping";
  if (state.processing.mode === "standard") {
    for (const controller of state.processing.controllers.values()) controller.abort();
    setStatus("Stop requested. No new records will start; in-flight gateway requests were canceled.");
  } else {
    setStatus(
      "Cancellation requested. Provider-batch monitoring will stop after the provider confirms batch state."
    );
  }
  $("stopButton").disabled = true;
  if (state.processing.operation && state.operationCoordinator) {
    void state.operationCoordinator
      .update(state.processing.operation.scopeKey, state.processing.operation.revision, {
        status: "cancelled",
        stopRequestedAt: nowIso(),
        leaseExpiresAt: null
      })
      .then((next) => {
        state.processing.operation = next;
      })
      .catch(() => {});
  }
  void updateJob(state.processing.job);
}

function resultContact(result) {
  return (
    result?.contacts?.find((item) => item.id === result.primaryContactId) ?? result?.contacts?.[0] ?? null
  );
}

function filteredResults() {
  const query = $("resultSearch").value.trim().toLowerCase();
  const filter = $("resultStatusFilter").value;
  const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });
  return projectResults()
    .filter((result) =>
      filter === "trashed"
        ? result.trashed
        : !result.trashed && (filter === "all" || result.status === filter)
    )
    .filter(
      (result) =>
        !query ||
        `${result.subject} ${state.records.find((item) => item.id === result.recordId)?.displayName ?? ""}`
          .toLowerCase()
          .includes(query)
    )
    .sort((left, right) => {
      const key = state.resultSort.key;
      const value = (result) =>
        key === "record"
          ? state.records.find((item) => item.id === result.recordId)?.displayName
          : result[key];
      const comparison = collator.compare(String(value(left) ?? ""), String(value(right) ?? ""));
      return state.resultSort.direction === "desc" ? -comparison : comparison;
    });
}

function renderResultColumnChooser() {
  const fieldset = $("resultColumnChooser");
  const legend = fieldset.querySelector("legend");
  fieldset.replaceChildren(legend);
  for (const [key, labelText] of RESULT_COLUMNS) {
    const label = document.createElement("label");
    label.className = "switch";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = state.settings.resultColumns[key] !== false;
    input.addEventListener("change", async () => {
      await persistSettings({ resultColumns: { ...state.settings.resultColumns, [key]: input.checked } });
      renderResults({ preserveEditor: true });
    });
    label.append(input, document.createTextNode(labelText));
    fieldset.append(label);
  }
}

function renderResults({ preserveEditor = false } = {}) {
  const results = filteredResults();
  renderResultColumnChooser();
  document.querySelectorAll("[data-result-column]").forEach((element) => {
    element.hidden = state.settings.resultColumns[element.dataset.resultColumn] === false;
  });
  const currentIds = new Set(projectResults().map((item) => item.id));
  state.selectedResultIds = new Set([...state.selectedResultIds].filter((id) => currentIds.has(id)));
  const previousActiveResultId = state.activeResultId;
  if (!currentIds.has(state.activeResultId)) state.activeResultId = results[0]?.id || null;
  if (state.activeResultId !== previousActiveResultId) {
    state.logger?.info("browser_selected_result_changed", {
      previousResultId: previousActiveResultId,
      resultId: state.activeResultId,
      reason: currentIds.has(previousActiveResultId) ? "result-refresh" : "result-unavailable"
    });
  }
  $("resultRows").replaceChildren(
    ...results.map((result) => {
      const record = state.records.find((item) => item.id === result.recordId);
      const row = document.createElement("tr");
      row.tabIndex = 0;
      if (result.id === state.activeResultId) row.classList.add("is-active");
      if (state.selectedResultIds.has(result.id)) row.classList.add("is-selected");
      if (result.trashed) row.classList.add("is-trashed");
      const selectCell = document.createElement("td");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = state.selectedResultIds.has(result.id);
      checkbox.disabled = result.status !== "completed" && !result.trashed;
      checkbox.setAttribute("aria-label", `Select ${record?.displayName || result.subject || "result"}`);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) state.selectedResultIds.add(result.id);
        else state.selectedResultIds.delete(result.id);
        invalidateResendConfirmation("Selected resend recipients changed.");
        renderResults({ preserveEditor: true });
      });
      selectCell.append(checkbox);
      row.append(selectCell);
      const recordCell = document.createElement("td");
      recordCell.dataset.resultColumn = "record";
      recordCell.hidden = state.settings.resultColumns.record === false;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "link-button";
      button.textContent = record?.displayName || "Unknown record";
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        selectResult(result.id);
      });
      recordCell.append(button);
      row.append(recordCell);
      const contact = resultContact(result);
      const values = [
        ["contact", contact ? `${contact.type}: ${contact.value}` : "None"],
        ["status", result.status],
        ["subject", result.subject || result.error?.message || ""],
        ["provider", `${result.provider} / ${result.model}`],
        ["updatedAt", formatDate(result.updatedAt)],
        ["delivery", result.delivery?.status || "Not sent"]
      ];
      values.forEach(([key, value]) => {
        const cell = document.createElement("td");
        cell.dataset.resultColumn = key;
        cell.hidden = state.settings.resultColumns[key] === false;
        cell.textContent = value;
        row.append(cell);
      });
      row.addEventListener("click", () => selectResult(result.id));
      row.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          selectResult(result.id);
        }
        if (event.key === "Delete") {
          event.preventDefault();
          softDeleteSelected();
        }
      });
      return row;
    })
  );
  const selectedCount = state.selectedResultIds.size;
  $("resultSelectionCount").textContent = `${selectedCount} selected`;
  const deletingTrash = $("resultStatusFilter").value === "trashed";
  $("deleteSelectedResultsButton").textContent =
    `${deletingTrash ? "Restore" : "Delete"} selected (${selectedCount})`;
  $("deleteSelectedResultsButton").disabled = selectedCount === 0;
  const allSelectable = results.filter((item) => item.status === "completed" || item.trashed);
  $("selectAllResults").checked =
    allSelectable.length > 0 && allSelectable.every((item) => state.selectedResultIds.has(item.id));
  $("selectAllResults").indeterminate = state.selectedResultIds.size > 0 && !$("selectAllResults").checked;
  if (!preserveEditor) renderActiveResult();
}

function selectResult(id) {
  if (state.resultDirty && !confirm("Discard unsaved result edits?")) return;
  const previousId = state.activeResultId;
  state.activeResultId = id;
  state.resultDirty = false;
  state.logger?.info("browser_selected_result_changed", {
    previousResultId: previousId,
    resultId: id
  });
  renderResults();
}

function renderActiveResult() {
  state.resultPanelSyncing = true;
  try {
    const result = normalizeStoredResult(activeResult());
    const disabled = !result || result.trashed;
    const outputDisabled = disabled || !hasRenderableResult(result);
    ["subjectInput", "bodyInput", "saveEditButton", "discardEditButton", "regenerateButton"].forEach((id) => {
      $(id).disabled = disabled;
    });
    $("copyEmailButton").disabled = disabled;
    $("copySubjectButton").disabled = disabled || !String(result?.subject ?? "").trim();
    ["copyRenderedButton", "copyHtmlButton", "copyTextButton", "exportOneButton", "printButton"].forEach(
      (id) => {
        $(id).disabled = outputDisabled;
      }
    );
    $("deleteActiveResultButton").disabled = !result;
    setEditorPanelAvailability(disabled);
    if (!result) {
      $("activeResultMetadata").textContent = "No result selected";
      $("resultError").hidden = true;
      $("resultError").textContent = "";
      $("subjectInput").value = "";
      $("bodyInput").value = "";
      $("resultPrompt").textContent = "";
      $("selectedContactValue").textContent = "No result selected";
      $("contactCandidateList").replaceChildren();
      setEditorPanelMessage("");
      updateRawEditor();
      updateVisualEditor("");
      return;
    }
    const record = state.records.find((item) => item.id === result.recordId);
    $("activeResultMetadata").textContent =
      `${record?.displayName || "Unknown record"} · version ${result.version} · ${formatDate(result.updatedAt)}`;
    $("resultError").hidden = !result.error;
    $("resultError").textContent = result.error?.message || "";
    $("subjectInput").value = result.subject || "";
    $("bodyInput").value = result.finalEmailHtml || "";
    $("resultPrompt").textContent =
      `${result.renderedPrompt || ""}\n\nResearch:\n${JSON.stringify(result.research || {}, null, 2)}`;
    renderContacts(result);
    setEditorPanelMessage("");
    updateRawEditor();
    updateVisualEditor(result.finalEmailHtml || "");
    state.resultDirty = false;
  } finally {
    state.resultPanelSyncing = false;
  }
}

function clipboardIcon() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "16");
  svg.setAttribute("height", "16");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  rect.setAttribute("x", "9");
  rect.setAttribute("y", "9");
  rect.setAttribute("width", "11");
  rect.setAttribute("height", "11");
  rect.setAttribute("rx", "2");
  rect.setAttribute("ry", "2");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", "M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1");
  svg.append(rect, path);
  return svg;
}

function applyContactLinkAttributes(node, href) {
  node.href = href;
  if (/^https?:\/\//i.test(href)) {
    node.rel = "noopener noreferrer";
    node.target = "_blank";
  }
}

function renderContactCandidateItem(contact, result) {
  const item = document.createElement("li");
  item.className = "contact-candidate-item";

  const header = document.createElement("div");
  header.className = "contact-candidate-header";

  const href = hrefForContactCandidate(contact, result);
  const valueNode = href ? document.createElement("a") : document.createElement("span");
  valueNode.className = href ? "contact-candidate-link" : "contact-candidate-value";
  valueNode.textContent = contact.value;
  if (href) {
    applyContactLinkAttributes(valueNode, href);
    const copyButton = document.createElement("button");
    copyButton.type = "button";
    copyButton.className = "contact-candidate-copy";
    copyButton.setAttribute("aria-label", `Copy hyperlink for ${contact.value}`);
    copyButton.title =
      contact?.type === "email" ? `Copy email draft link for ${contact.value}` : `Copy ${href}`;
    copyButton.dataset.testid = "contact-candidate-copy";
    copyButton.append(clipboardIcon());
    copyButton.addEventListener("click", () => {
      writeClipboard(href, contactClipboardLabel(contact)).catch(handleError);
    });
    header.append(valueNode, copyButton);
  } else header.append(valueNode);

  const meta = document.createElement("span");
  meta.className = "contact-candidate-meta";
  meta.textContent = `${contact.sourceCategory || "unknown source"} · ${contact.confidenceLabel || "unrated"} · ${contact.reason || "No reason provided."}`;

  item.append(header, meta);
  return item;
}

function renderContacts(result) {
  const primary = resultContact(result);
  const primaryLabel = primary ? `${primary.value} (${primary.confidenceLabel || "unrated"})` : "";
  const primaryHref = hrefForContactCandidate(primary, result);
  $("selectedContactValue").replaceChildren();
  if (!primary) $("selectedContactValue").textContent = "No contact method found";
  else if (primaryHref) {
    const link = document.createElement("a");
    link.className = "contact-candidate-link";
    link.textContent = primaryLabel;
    applyContactLinkAttributes(link, primaryHref);
    $("selectedContactValue").append(link);
  } else $("selectedContactValue").textContent = primaryLabel;
  $("primaryContactSelect").disabled = !result.contacts?.length;
  $("primaryContactSelect").replaceChildren(
    new Option("No primary contact", ""),
    ...(result.contacts ?? []).map((contact) => new Option(`${contact.type}: ${contact.value}`, contact.id))
  );
  $("primaryContactSelect").value = result.primaryContactId || "";
  $("contactCandidateList").replaceChildren(
    ...(result.contacts ?? []).map((contact) => renderContactCandidateItem(contact, result))
  );
  $("copyEmailButton").disabled = primary?.type !== "email";
}

function updateRawEditor() {
  try {
    const lines = $("bodyInput").value.split("\n");
    $("rawLineNumbers").textContent = lines.map((_, index) => index + 1).join("\n");
    const source = $("bodyInput").value;
    const rawSyntaxPreview = $("rawSyntaxPreview");
    const rendered = renderRawSyntaxHtml(source);
    rawSyntaxPreview.innerHTML = `<code class="syntax-preview-code${rendered.highlighted ? " hljs language-xml" : ""}">${rendered.html}</code>`;
    const opened = (source.match(/<[a-z][^/>]*>/gi) ?? []).length;
    const closed = (source.match(/<\/[a-z][^>]*>/gi) ?? []).length;
    const errors = Math.max(0, Math.abs(opened - closed));
    $("rawErrorCount").textContent = `${errors} structural warning${errors === 1 ? "" : "s"}`;
    logEditor("debug", "raw_editor_updated", {
      warnings: errors,
      summary: summarizeHtml(source)
    });
  } catch (error) {
    $("rawErrorCount").textContent = "Editor preview unavailable";
    setEditorPanelMessage("Raw HTML annotations could not be refreshed.", "warning");
    logEditor("error", "raw_editor_update_failed", {
      message: error.message
    });
  }
}

function updateVisualEditor(html) {
  const source = String(html ?? "");
  if (!state.visualEditor) {
    setEditorPanelMessage("Rendered preview is unavailable. Raw HTML editing still works.", "warning");
    logEditor("warn", "visual_editor_missing", { summary: summarizeHtml(source) });
    return;
  }
  state.visualEditorSyncing = true;
  try {
    state.visualEditor.innerHTML = source;
    $("visualPreviewState").textContent = source
      ? "Rendered HTML preview updated."
      : "Rendered HTML preview is empty.";
    logEditor("debug", "visual_editor_updated", {
      summary: summarizeHtml(source)
    });
  } catch (error) {
    state.visualEditor.textContent = source;
    $("visualPreviewState").textContent = "Rendered HTML preview fell back to plain text.";
    setEditorPanelMessage("Rendered preview hit an issue and fell back to safe text.", "warning");
    logEditor("error", "visual_editor_update_failed", {
      message: error.message,
      summary: summarizeHtml(source)
    });
  } finally {
    state.visualEditorSyncing = false;
  }
}

function showSanitizationWarnings(warnings = []) {
  $("sanitizationWarnings").textContent = warnings.length ? `Safety cleanup: ${warnings.join(" ")}` : "";
  if (warnings.length) {
    logEditor("warn", "editor_sanitization_warning", {
      warningCount: warnings.length,
      warnings
    });
  }
}

async function saveResultEdits() {
  assertStorageGate("local", "result editing");
  const result = normalizeStoredResult(activeResult());
  if (!result) return;
  const sanitized = sanitizeEditedEmail($("bodyInput").value);
  await state.repository.put("resultVersions", {
    id: makeId("result-version"),
    resultId: result.id,
    version: result.version,
    subject: result.subject,
    finalEmailHtml: result.finalEmailHtml,
    finalText: result.finalText,
    originalAiBodyHtml: result.originalAiBodyHtml,
    addendumSnapshot: result.addendumSnapshot,
    createdAt: nowIso()
  });
  const saved = await updateRevisionedRecord(
    "results",
    result.id,
    (current) => ({
      ...current,
      subject: $("subjectInput")
        .value.replace(/[\r\n]/g, " ")
        .trim()
        .slice(0, 160),
      finalEmailHtml: sanitized.html,
      finalText: sanitized.text,
      version: current.version + 1,
      editedAt: nowIso(),
      updatedAt: nowIso()
    }),
    {
      conflictCode: "RESULT_CONFLICT",
      conflictMessage: "This result changed in another tab. Reload the latest version before saving edits."
    }
  );
  upsertLocalResult(saved);
  showSanitizationWarnings(sanitized.warnings);
  state.resultDirty = false;
  renderResults();
  state.logger?.info("browser_result_edit_saved", {
    resultId: result.id,
    version: saved.version,
    htmlLength: sanitized.html.length,
    textLength: sanitized.text.length,
    fallbackUsed: sanitized.warnings.length > 0
  });
  setStatus(
    state.storageHealth.mode === STORAGE_MODES.DURABLE
      ? "Result edits saved as a recoverable version."
      : "Result edits stored in memory as a recoverable version. Export an encrypted backup before closing."
  );
}

async function regenerateResult() {
  const result = normalizeStoredResult(activeResult());
  const record = state.records.find((item) => item.id === result?.recordId);
  if (!result || !record) return;
  state.logger?.info("browser_result_regeneration_requested", {
    resultId: result.id,
    recordId: result.recordId,
    subjectLength: result.subject.length
  });
  await saveResultEdits();
  await processScope([record]);
}

async function softDeleteSelected() {
  assertStorageGate("local", "result editing");
  const ids = [...state.selectedResultIds];
  if (!ids.length) return;
  const restore = $("resultStatusFilter").value === "trashed";
  const subjects = projectResults()
    .filter((item) => ids.includes(item.id))
    .map((item) => item.subject || item.id)
    .slice(0, 4);
  if (
    !confirm(
      `${restore ? "Restore" : "Move to trash"} ${ids.length} result(s): ${subjects.join(", ")}${ids.length > 4 ? "…" : ""}?`
    )
  )
    return;
  for (const result of projectResults().filter((item) => ids.includes(item.id))) {
    const saved = await updateRevisionedRecord(
      "results",
      result.id,
      (current) => ({
        ...current,
        trashed: !restore,
        trashedAt: restore ? null : nowIso(),
        updatedAt: nowIso()
      }),
      {
        conflictCode: "RESULT_CONFLICT",
        conflictMessage:
          "This result changed in another tab. Reload the latest version before updating trash state."
      }
    );
    upsertLocalResult(saved);
  }
  state.selectedResultIds.clear();
  renderResults();
}

async function deleteActiveResult() {
  assertStorageGate("local", "result editing");
  const result = activeResult();
  if (!result) return;
  const record = state.records.find((item) => item.id === result.recordId);
  if (
    !confirm(`Move “${result.subject || "Untitled"}” for ${record?.displayName || "this prospect"} to trash?`)
  )
    return;
  const saved = await updateRevisionedRecord(
    "results",
    result.id,
    (current) => ({
      ...current,
      trashed: true,
      trashedAt: nowIso(),
      updatedAt: nowIso()
    }),
    {
      conflictCode: "RESULT_CONFLICT",
      conflictMessage: "This result changed in another tab. Reload the latest version before deleting."
    }
  );
  upsertLocalResult(saved);
  state.activeResultId =
    projectResults({ includeTrash: false }).find((item) => item.id !== result.id)?.id || null;
  renderResults();
}

async function writeClipboard(text, label) {
  let usedFallback = false;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    usedFallback = true;
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.append(textarea);
    textarea.select();
    if (!document.execCommand("copy")) {
      textarea.style.opacity = "1";
      throw new Error("Clipboard permission was denied. The text is selected for manual copying.");
    }
    textarea.remove();
  }
  state.logger?.info("browser_clipboard_written", {
    label,
    length: String(text ?? "").length,
    usedFallback
  });
  setStatus(`${label} copied.`);
}

async function copyRendered() {
  const result = assertRenderableOutput(activeResult(), "copied");
  try {
    if (navigator.clipboard.write && globalThis.ClipboardItem) {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([result.finalEmailHtml], { type: "text/html" }),
          "text/plain": new Blob([result.finalText], { type: "text/plain" })
        })
      ]);
      state.logger?.info("browser_clipboard_written", {
        label: "Rendered email",
        length: result.finalEmailHtml.length,
        textLength: result.finalText.length,
        usedFallback: false
      });
    } else await writeClipboard(result.finalText, "Rendered email");
    setStatus("Rendered email copied.");
  } catch (error) {
    await writeClipboard(result.finalText, "Plain-text fallback");
    state.logger.warn("clipboard_html_fallback", { message: error.message });
  }
}

function exportOne(result = activeResult()) {
  const exportable = assertRenderableOutput(result, "exported");
  const record = state.records.find((item) => item.id === result.recordId);
  const html = renderStandaloneDocument({ result: exportable, contacts: exportable.contacts ?? [] });
  downloadBlob(
    new Blob([html], { type: "text/html;charset=utf-8" }),
    safeFilename(`${record?.displayName || "result"}-${exportable.subject || "email"}`, ".html")
  );
  state.logger.info("browser_result_export_started", {
    resultId: exportable.id,
    recordId: exportable.recordId,
    projectId: exportable.projectId,
    format: "html"
  });
  setStatus("HTML download started.");
}

function buildDeliveryEntries(results, profile = "all") {
  const encoder = new TextEncoder();
  const entries = [];
  const manifest = {
    applicationVersion: VERSIONS.application,
    generatedAt: nowIso(),
    profile,
    count: results.length,
    files: []
  };
  let estimatedBytes = 0;
  for (const result of results) {
    const exportable = assertRenderableOutput(result, "included in a delivery export");
    const record = state.records.find((item) => item.id === result.recordId);
    const base = safeFilename(`${record?.displayName || "record"}-${exportable.subject || "email"}`).replace(
      /\s+/g,
      "_"
    );
    const htmlPath = `html/${base}.html`;
    const textPath = `plain-text/${base}.txt`;
    const html = renderStandaloneDocument({ result: exportable, contacts: exportable.contacts ?? [] });
    entries.push({
      path: htmlPath,
      compression: "deflate",
      content: html,
      estimatedBytes: encoder.encode(html).byteLength
    });
    entries.push({
      path: textPath,
      compression: "deflate",
      content: exportable.finalText,
      estimatedBytes: encoder.encode(exportable.finalText).byteLength
    });
    manifest.files.push(htmlPath, textPath);
    estimatedBytes += encoder.encode(html).byteLength + encoder.encode(exportable.finalText).byteLength;
    const primary = resultContact(exportable);
    if ((profile === "all" || profile === "email-clients") && primary?.type === "email") {
      const emlPath = `email-clients/${base}.eml`;
      const eml = makeEml({
        result: exportable,
        primaryEmail: primary.value,
        fromName: state.settings.businessName,
        fromAddress: state.settings.resendFromAddress || "no-reply@example.invalid"
      });
      entries.push({
        path: emlPath,
        compression: "deflate",
        content: eml,
        estimatedBytes: encoder.encode(eml).byteLength
      });
      manifest.files.push(emlPath);
      estimatedBytes += encoder.encode(eml).byteLength;
    }
  }
  const manifestJson = JSON.stringify(manifest, null, 2);
  entries.unshift({
    path: "manifest.json",
    compression: "deflate",
    content: manifestJson,
    estimatedBytes: encoder.encode(manifestJson).byteLength
  });
  estimatedBytes += encoder.encode(manifestJson).byteLength;
  return { entries, manifest, estimatedBytes };
}

async function exportResults(results, filename = "email-exports.zip", profile = "all") {
  if (!results.length) throw new Error("No completed results are ready to export.");
  if (results.length === 1 && filename.endsWith(".html")) return exportOne(results[0]);
  const controller = beginArchiveTask("export");
  try {
    const { entries, estimatedBytes } = buildDeliveryEntries(results, profile);
    const staged = await streamArchive({
      filename,
      entries,
      estimatedBytes,
      limits: state.bootstrap.app.limits,
      signal: controller.signal,
      onProgress: (progress) => setStatus(archiveStatusMessage(`Exporting ${filename}`, progress)),
      verifyExpectedPaths: false
    });
    downloadBlob(staged.file, filename);
    setTimeout(() => staged.cleanup(), 60_000);
    await state.logger.info("browser_delivery_export_started", {
      projectId: state.activeProjectId,
      filename,
      profile,
      resultCount: results.length,
      storage: staged.storage,
      bytesWritten: staged.bytesWritten
    });
    setStatus(`Download started: ${filename}${staged.storage === "opfs" ? " (staged in OPFS)" : ""}`);
  } catch (error) {
    if (String(error.code || "").toUpperCase() === "ARCHIVE_CANCELLED") {
      setStatus("Delivery export cancelled.");
      return;
    }
    setStatus(error.message, true);
    throw error;
  } finally {
    endArchiveTask();
  }
}

async function readResendSnapshot() {
  const snapshot = await state.repository.snapshot(["results", "suppressions", "settings"]);
  const settingsRecord = snapshot.settings?.find((item) => item.key === "application") ?? null;
  const settings = { ...DEFAULT_SETTINGS, ...(settingsRecord ?? {}) };
  return {
    settings,
    results: snapshot.results ?? [],
    suppressions: (snapshot.suppressions ?? []).map((item) => item.email).filter(Boolean)
  };
}

function resendSourceResults(results, settings) {
  const eligibleResults = results.filter(
    (item) => item.projectId === settings.activeProjectId && item.status === "completed" && !item.trashed
  );
  const selected = eligibleResults.filter((item) => state.selectedResultIds.has(item.id));
  return selected.length ? selected : eligibleResults;
}

function mapResendItems(results) {
  return results.map((result) => {
    const resolved = normalizeStoredResult(result);
    const contact = resultContact(resolved);
    return {
      id: resolved.id,
      primaryEmail: contact?.type === "email" ? contact.value : "",
      contactSource: contact?.sourceCategory,
      consentStatus: resolved.consentStatus,
      consentSource: resolved.consentSource,
      consentTimestamp: resolved.consentTimestamp,
      subject: resolved.subject,
      html: resolved.finalEmailHtml,
      text: resolved.finalText
    };
  });
}

function deliveryHistoryId(operationId, delivery) {
  return `resend:${operationId}:${delivery.messageDigest || delivery.resendId || delivery.resultId}`;
}

function invalidateResendConfirmation(message = "The resend confirmation is now stale.") {
  if (!$("resendFinalConfirmation").checked && !state.resendPreflight) return;
  $("resendFinalConfirmation").checked = false;
  $("resendSendButton").disabled = true;
  if (state.resendPreflight) {
    state.resendPreflight = {
      ...state.resendPreflight,
      invalidatedAt: nowIso(),
      invalidationMessage: message
    };
  }
}

async function buildFreshResendReview({
  reviewId = null,
  reviewedAt = null,
  expiresAt = null,
  snapshot = null
} = {}) {
  const data = snapshot ?? (await readResendSnapshot());
  const sourceResults = resendSourceResults(data.results, data.settings);
  const sourceItems = mapResendItems(sourceResults);
  let items = sourceItems;
  if (data.settings.resendTestRecipient) {
    const matching = sourceItems.filter((item) => item.primaryEmail === data.settings.resendTestRecipient);
    if (!matching.length) {
      throw new Error(
        "Resend test-recipient mode requires a matching opted-in recipient with its own evidence."
      );
    }
    items = matching;
  }
  const preflight = buildResendPreflight(items, {
    suppressions: data.suppressions,
    batchSize: data.settings.resendBatchSize
  });
  if (
    preflight.recipientCount > 1 &&
    (!data.settings.companyAddress || !data.settings.resendUnsubscribeUrl)
  ) {
    throw new Error(
      "Bulk Resend requires a company postal address and a valid one-click unsubscribe URL in Configuration."
    );
  }
  const nextReviewId = reviewId ?? makeId("resend-review");
  const nextReviewedAt = reviewedAt ?? nowIso();
  const nextExpiresAt =
    expiresAt ?? new Date(Date.parse(nextReviewedAt) + RESEND_REVIEW_TTL_MS).toISOString();
  const review = await buildResendReviewFingerprint({
    reviewId: nextReviewId,
    reviewedAt: nextReviewedAt,
    expiresAt: nextExpiresAt,
    projectId: data.settings.activeProjectId,
    sender: {
      fromName: data.settings.resendFromName,
      fromAddress: data.settings.resendFromAddress,
      replyTo: data.settings.resendReplyTo,
      unsubscribeUrl: data.settings.resendUnsubscribeUrl,
      companyAddress: data.settings.companyAddress
    },
    items: preflight.eligible,
    suppressions: data.suppressions,
    batchSize: data.settings.resendBatchSize,
    testRecipient: data.settings.resendTestRecipient
  });
  return {
    settings: data.settings,
    sourceResults,
    items: review.items,
    preflight,
    review: {
      reviewId: review.reviewId,
      reviewedAt: review.reviewedAt,
      expiresAt: review.expiresAt,
      payloadDigest: review.payloadDigest,
      suppressionDigest: review.suppressionDigest,
      batchSize: review.batchSize,
      testRecipient: review.testRecipient
    },
    digests: {
      payloadDigest: review.payloadDigest,
      suppressionDigest: review.suppressionDigest,
      messageDigests: review.messages.map((message) => message.messageDigest),
      chunkDigests: review.chunks.map((chunk) => chunk.chunkDigest)
    },
    reviewDetails: review,
    suppressions: data.suppressions
  };
}

async function persistResendDeliveries(operationId, result) {
  const deliveries = Array.isArray(result?.deliveries) ? result.deliveries : [];
  if (!deliveries.length) return 0;
  const entries = [];
  for (const delivery of deliveries) {
    const record = state.results.find((item) => item.id === delivery.resultId);
    if (!record) continue;
    const saved = await updateRevisionedRecord(
      "results",
      record.id,
      (current) => ({
        ...current,
        delivery: {
          ...(current.delivery || {}),
          ...delivery,
          operationId,
          updatedAt: nowIso()
        },
        updatedAt: nowIso()
      }),
      {
        conflictCode: "RESULT_CONFLICT",
        conflictMessage:
          "This result changed in another tab. Reload the latest version before updating delivery state."
      }
    );
    upsertLocalResult(saved);
    entries.push({
      store: "deliveryHistory",
      value: {
        id: deliveryHistoryId(operationId, delivery),
        operationId,
        resultId: record.id,
        messageDigest: delivery.messageDigest ?? null,
        chunkIndex: delivery.chunkIndex ?? null,
        resendId: delivery.resendId ?? null,
        providerMessageId: delivery.providerMessageId ?? delivery.resendId ?? null,
        email: delivery.email ?? "",
        status: delivery.status ?? "sent",
        idempotencyKey: delivery.idempotencyKey ?? null,
        reviewedAt: result?.review?.reviewedAt ?? null,
        reviewId: result?.review?.reviewId ?? null,
        updatedAt: nowIso()
      }
    });
  }
  if (entries.length) await state.repository.atomicPut(entries);
  return entries.length;
}

async function recoverResendOperation(operationId) {
  return api(`/api/gateway/resend/${operationId}`, { logErrors: false });
}

async function resendPreflight() {
  assertStorageGate("external", "resend preflight");
  const snapshot = await readResendSnapshot();
  const reviewBundle = await buildFreshResendReview({ snapshot });
  const payload = await api("/api/gateway/resend/preflight", {
    method: "POST",
    body: JSON.stringify({
      items: reviewBundle.items,
      suppressions: reviewBundle.suppressions,
      batchSize: reviewBundle.review.batchSize
    })
  });
  if (
    payload.preflight.recipientCount > 1 &&
    (!reviewBundle.settings.companyAddress || !reviewBundle.settings.resendUnsubscribeUrl)
  ) {
    throw new Error(
      "Bulk Resend requires a company postal address and a valid one-click unsubscribe URL in Configuration."
    );
  }
  state.resendPreflight = {
    ...payload.preflight,
    items: reviewBundle.items,
    suppressions: reviewBundle.suppressions,
    review: reviewBundle.review,
    digests: reviewBundle.digests,
    settings: reviewBundle.settings,
    sourceResults: reviewBundle.sourceResults
  };
  $("resendPreflightSummary").textContent =
    `${payload.preflight.recipientCount} eligible, ${payload.preflight.excludedCount} excluded, ${payload.preflight.estimatedBatches} estimated batch(es). Sender: ${reviewBundle.settings.resendFromName || "not configured"} <${reviewBundle.settings.resendFromAddress || "not configured"}>.${reviewBundle.settings.resendTestRecipient ? ` Test-recipient mode: ${reviewBundle.settings.resendTestRecipient}.` : ""}`;
  const eligibleIds = new Set(payload.preflight.eligible.map((item) => item.id));
  const excludedById = new Map(payload.preflight.excluded.map((item) => [item.id, item]));
  $("resendPreflightRows").replaceChildren(
    ...reviewBundle.items.map((item) => {
      const row = document.createElement("tr");
      [
        eligibleIds.has(item.id) ? "Yes" : "No",
        item.primaryEmail || "No primary email",
        item.consentStatus || "unknown",
        eligibleIds.has(item.id) ? "Eligible" : excludedById.get(item.id)?.reasons.join(" ")
      ].forEach((value) => {
        const cell = document.createElement("td");
        cell.textContent = value;
        row.append(cell);
      });
      return row;
    })
  );
  $("resendFinalConfirmation").checked = false;
  $("resendSendButton").disabled = true;
  $("resendPreflightDialog").showModal();
}

async function sendResend() {
  assertStorageGate("external", "resend send");
  if (!$("resendFinalConfirmation").checked) return;
  if (state.repository.temporary || !state.operationCoordinator)
    throw appError(
      "COORDINATION_UNAVAILABLE",
      "Browser storage is unavailable. Sending is disabled until durable storage is restored.",
      undefined,
      "coordination"
    );
  const preflight = state.resendPreflight;
  if (!preflight?.review) {
    throw new Error("Run Resend preflight before sending.");
  }
  return withBrowserExclusiveLock("email-gen:resend-send", async () => {
    const fresh = await buildFreshResendReview({
      reviewId: preflight.review.reviewId,
      reviewedAt: preflight.review.reviewedAt,
      expiresAt: preflight.review.expiresAt
    });
    if (fresh.review.payloadDigest !== preflight.review.payloadDigest) {
      throw new Error(
        "The resend confirmation is stale because recipients, content, consent evidence, sender data, or suppressions changed. Run a fresh preflight."
      );
    }
    if (fresh.review.suppressionDigest !== preflight.review.suppressionDigest) {
      throw new Error(
        "The resend confirmation is stale because suppression state changed. Run a fresh preflight."
      );
    }
    if (Date.parse(fresh.review.expiresAt) <= Date.now()) {
      throw new Error("The resend confirmation expired. Run a fresh preflight.");
    }
    const identity = await resendScopeIdentity({
      projectId: fresh.settings.activeProjectId,
      reviewId: fresh.review.reviewId,
      reviewedAt: fresh.review.reviewedAt,
      expiresAt: fresh.review.expiresAt,
      payloadDigest: fresh.review.payloadDigest,
      resultIds: fresh.items.map((item) => item.id),
      messageDigests: fresh.digests.messageDigests,
      sender: {
        fromName: fresh.settings.resendFromName,
        fromAddress: fresh.settings.resendFromAddress,
        replyTo: fresh.settings.resendReplyTo,
        unsubscribeUrl: fresh.settings.resendUnsubscribeUrl,
        companyAddress: fresh.settings.companyAddress
      },
      suppressionDigest: fresh.digests.suppressionDigest,
      batchSize: fresh.review.batchSize,
      testRecipient: fresh.review.testRecipient
    });
    let operation = await state.operationCoordinator.read(identity.scopeKey);
    if (operation && operation.fingerprint?.payloadDigest === fresh.review.payloadDigest) {
      if (state.operationCoordinator.isActive(operation)) {
        if (!state.operationCoordinator.leaseExpired(operation)) {
          setStatus(
            "Another resend operation is already active. Wait for it to finish or reopen the recovery path.",
            true
          );
          return operation;
        }
        const takeover = await state.operationCoordinator.takeOverAfterExpiry(
          identity.scopeKey,
          async () => ({
            canTakeOver: true
          })
        );
        if (!takeover?.acquired) {
          state.operations = (await state.operationCoordinator.list()).map(withRevision);
          renderProgress();
          updateProcessingButton();
          setStatus("Another tab refreshed the resend lease before this tab could resume.", true);
          return takeover?.operation ?? operation;
        }
        operation = takeover.operation;
      }
      if (String(operation.status) === "failed-safe") {
        setStatus(
          "This resend operation failed safely. Run a fresh preflight to create a new reviewed operation.",
          true
        );
        return operation;
      }
      if (state.operationCoordinator.isTerminal(operation)) {
        setStatus("This resend operation already completed. Run a fresh preflight to send again.", true);
        return operation;
      }
    } else {
      const acquisition = await state.operationCoordinator.acquire(identity, {
        kind: "resend",
        before: operation
      });
      if (!acquisition.acquired) {
        state.operations = (await state.operationCoordinator.list()).map(withRevision);
        renderProgress();
        updateProcessingButton();
        const message =
          acquisition.reason === "reconciliation-required"
            ? "Another tab owns an unresolved resend operation. Reconcile before retrying."
            : `${operationStatusLabel(acquisition.operation)} is already active in ${operationOwnerLabel(
                acquisition.operation,
                state.tabId
              )}.`;
        setStatus(message, acquisition.reason === "reconciliation-required");
        return acquisition.operation;
      }
      operation = acquisition.operation;
    }
    operation = await state.operationCoordinator.update(identity.scopeKey, operation.revision, {
      status: "in-progress",
      ownerTabId: state.tabId,
      projectId: fresh.settings.activeProjectId,
      resultCount: fresh.items.length,
      reviewId: fresh.review.reviewId,
      reviewedAt: fresh.review.reviewedAt,
      expiresAt: fresh.review.expiresAt,
      payloadDigest: fresh.review.payloadDigest,
      suppressionDigest: fresh.digests.suppressionDigest,
      messageDigests: fresh.digests.messageDigests,
      batchSize: fresh.review.batchSize,
      sender: {
        fromName: fresh.settings.resendFromName,
        fromAddress: fresh.settings.resendFromAddress,
        replyTo: fresh.settings.resendReplyTo,
        unsubscribeUrl: fresh.settings.resendUnsubscribeUrl,
        companyAddress: fresh.settings.companyAddress
      }
    });
    state.resendPreflight = {
      ...state.resendPreflight,
      operationId: operation.operationId
    };
    try {
      const payload = await api("/api/gateway/resend/send", {
        method: "POST",
        body: JSON.stringify({
          confirmed: true,
          operationId: operation.operationId,
          review: fresh.review,
          items: fresh.items,
          suppressions: fresh.suppressions,
          batchSize: fresh.review.batchSize,
          sender: {
            fromName: fresh.settings.resendFromName,
            fromAddress: fresh.settings.resendFromAddress,
            replyTo: fresh.settings.resendReplyTo,
            unsubscribeUrl: fresh.settings.resendUnsubscribeUrl,
            companyAddress: fresh.settings.companyAddress
          },
          projectId: fresh.settings.activeProjectId
        })
      });
      const result = payload.result ?? payload.operation ?? {};
      await persistResendDeliveries(operation.operationId, result);
      const nextStatus =
        result.status === "completed"
          ? "succeeded"
          : result.status === "partially_completed"
            ? "reconciliation-required"
            : result.deliveries?.length
              ? "reconciliation-required"
              : "outcome-unknown";
      operation = await state.operationCoordinator.release(operation, {
        status: nextStatus,
        completedAt: result.status === "completed" ? nowIso() : null,
        leaseExpiresAt: null,
        ownerTabId: null,
        lastError: result.lastError ?? null
      });
      state.operations = (await state.operationCoordinator.list()).map(withRevision);
      renderProgress();
      updateProcessingButton();
      if (result.status === "completed") {
        $("resendPreflightDialog").close();
        state.resendPreflight = null;
        renderResults();
        setStatus(`Resend accepted ${result.deliveries.length} eligible messages.`);
      } else {
        renderResults({ preserveEditor: true });
        setStatus(
          `Resend saved ${result.deliveries?.length ?? 0} receipt(s) and requires reconciliation before retrying.`,
          true
        );
      }
      return payload;
    } catch (error) {
      const recovery = await recoverResendOperation(operation.operationId).catch(() => null);
      if (recovery?.operation) {
        await persistResendDeliveries(operation.operationId, recovery.operation);
      }
      const nextStatus =
        error?.code === "RESEND_NETWORK_FAILED" || error?.code === "RESEND_TRANSIENT_FAILED"
          ? "outcome-unknown"
          : error?.code === "RESEND_PERMANENT_FAILED"
            ? "failed-safe"
            : error?.code === "HTTP_ERROR"
              ? "outcome-unknown"
              : "failed-safe";
      await state.operationCoordinator
        .release(operation, {
          status: recovery?.operation?.status || nextStatus,
          lastError: { code: error.code || "RESEND_FAILED", message: error.message },
          leaseExpiresAt: null,
          ownerTabId: null
        })
        .catch(() => {});
      state.operations = (await state.operationCoordinator.list()).map(withRevision);
      renderProgress();
      updateProcessingButton();
      if (recovery?.operation?.status === "completed") {
        $("resendPreflightDialog").close();
        state.resendPreflight = null;
      }
      throw error;
    }
  });
}

async function importDataset(payload) {
  const name = safeFilename(payload.sourceName.replace(/\.[^.]+$/, "")) || "Imported project";
  const project = {
    id: makeId("project"),
    name,
    sourceName: payload.sourceName,
    templateId: state.activeTemplateId,
    recordCount: payload.records.length,
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
  const records = payload.records.map((record) => ({
    id: makeId("record"),
    projectId: project.id,
    sourceName: payload.sourceName,
    recordKey: String(record.internalId),
    displayName: record.displayName,
    sourceRow: record.sourceRow,
    raw: record.raw,
    normalized: record.normalized,
    validation: record.validation,
    status: record.validation?.errors?.length ? "invalid" : "ready",
    contactLookup: Object.entries(record.normalized)
      .filter(([key]) => /email|contact/i.test(key))
      .map(([, value]) => String(value))
      .join(" ")
      .toLowerCase(),
    createdAt: nowIso(),
    updatedAt: nowIso()
  }));
  await state.repository.atomicPut([
    { store: "projects", value: project },
    ...records.map((value) => ({ store: "records", value }))
  ]);
  await persistSettings({ activeProjectId: project.id });
  await loadAllState();
  renderAll();
  await state.logger.info("records_imported", {
    projectId: project.id,
    count: records.length,
    sourceName: payload.sourceName
  });
  setStatus(`Imported ${records.length} records into ${project.name}.`);
}

function fillConfiguration() {
  const map = {
    businessNameSetting: state.settings.businessName,
    businessSignatureSetting: state.settings.businessSignature,
    businessUrlSetting: state.settings.businessUrl,
    companyAddressSetting: state.settings.companyAddress,
    modelCacheTtlSetting: state.settings.modelCacheTtlHours,
    openrouterRefererSetting: state.settings.openrouterReferer,
    ollamaHostSetting: state.settings.ollamaHost,
    customBaseUrlSetting: state.settings.customBaseUrl,
    resendFromNameSetting: state.settings.resendFromName,
    resendFromAddressSetting: state.settings.resendFromAddress,
    resendReplyToSetting: state.settings.resendReplyTo,
    resendTestRecipientSetting: state.settings.resendTestRecipient,
    resendBatchSizeSetting: state.settings.resendBatchSize,
    resendUnsubscribeSetting: state.settings.resendUnsubscribeUrl,
    logLevelSetting: state.settings.logLevel
  };
  Object.entries(map).forEach(([id, value]) => {
    $(id).value = value ?? "";
  });
  $("confirmCustomOllamaHost").checked = state.settings.confirmedCustomOllamaHost;
  $("confirmCustomProviderHost").checked = state.settings.confirmedCustomProviderHost;
  $("reducedMotionSetting").checked = state.settings.reducedMotion;
  $("highContrastSetting").checked = state.settings.highContrast;
  clearCredentialInputs();
  renderCredentialStates();
  renderOllamaStatus();
  state.configurationSnapshot = JSON.stringify(configurationValues());
  state.configurationDirty = false;
  renderStorageStatus();
}

function configurationValues() {
  return {
    businessName: $("businessNameSetting").value.trim(),
    businessSignature: $("businessSignatureSetting").value,
    businessUrl: $("businessUrlSetting").value.trim(),
    companyAddress: $("companyAddressSetting").value.trim(),
    modelCacheTtlHours: Number($("modelCacheTtlSetting").value) || 24,
    openrouterReferer: $("openrouterRefererSetting").value.trim(),
    ollamaHost: $("ollamaHostSetting").value.trim(),
    confirmedCustomOllamaHost: $("confirmCustomOllamaHost").checked,
    customBaseUrl: $("customBaseUrlSetting").value.trim(),
    confirmedCustomProviderHost: $("confirmCustomProviderHost").checked,
    resendFromName: $("resendFromNameSetting").value.trim(),
    resendFromAddress: $("resendFromAddressSetting").value.trim(),
    resendReplyTo: $("resendReplyToSetting").value.trim(),
    resendTestRecipient: $("resendTestRecipientSetting").value.trim(),
    resendBatchSize: Math.min(100, Math.max(1, Number($("resendBatchSizeSetting").value) || 100)),
    resendUnsubscribeUrl: $("resendUnsubscribeSetting").value.trim(),
    logLevel: $("logLevelSetting").value,
    reducedMotion: $("reducedMotionSetting").checked,
    highContrast: $("highContrastSetting").checked
  };
}

function credentialValues() {
  return Object.fromEntries(
    RUNTIME_CREDENTIAL_FIELDS.map((field) => [field.id, $(field.inputId)?.value?.trim() || ""])
  );
}

function credentialState(providerId) {
  return state.credentialStatus.find((item) => item.id === providerId) ?? null;
}

function credentialStatusLabel(providerId) {
  const status = credentialState(providerId)?.status ?? "not-configured";
  if (status === "valid") return "Valid";
  if (status === "validation-failed") return "Validation failed";
  if (status === "configured") return "Configured";
  return "Not configured";
}

function renderCredentialStates() {
  for (const field of RUNTIME_CREDENTIAL_FIELDS) {
    const node = $(field.statusId);
    if (!node) continue;
    node.textContent = credentialStatusLabel(field.id);
    node.dataset.status = credentialState(field.id)?.status ?? "not-configured";
  }
}

function clearCredentialInputs() {
  for (const field of RUNTIME_CREDENTIAL_FIELDS) {
    if ($(field.inputId)) $(field.inputId).value = "";
  }
}

async function refreshCredentialStates() {
  const payload = await api("/api/credentials", { logErrors: false });
  state.credentialStatus = payload.credentials ?? [];
  if (state.bootstrap) {
    state.bootstrap.ai = payload.ai;
    state.bootstrap.credentials = payload.credentials ?? [];
  }
  renderCredentialStates();
  renderSelectedModelSummary();
  return payload;
}

function pendingCredentialUpdates() {
  return Object.entries(credentialValues()).filter(([, value]) => value);
}

async function saveRuntimeCredentials() {
  assertStorageGate("external", "runtime credentials");
  const pending = pendingCredentialUpdates();
  for (const [providerId, credential] of pending) {
    await api(`/api/credentials/${providerId}`, {
      method: "PUT",
      body: JSON.stringify({ credential })
    });
    const inputId = RUNTIME_CREDENTIAL_FIELD_BY_ID.get(providerId)?.inputId;
    if (inputId) $(inputId).value = "";
  }
  if (pending.length) await refreshCredentialStates();
}

async function testRuntimeCredential(providerId) {
  assertStorageGate("external", "runtime credentials");
  const field = RUNTIME_CREDENTIAL_FIELD_BY_ID.get(providerId);
  if ($(field.inputId).value.trim()) {
    await api(`/api/credentials/${providerId}`, {
      method: "PUT",
      body: JSON.stringify({ credential: $(field.inputId).value.trim() })
    });
    $(field.inputId).value = "";
  }
  const body =
    providerId === "custom"
      ? {
          baseUrl: $("customBaseUrlSetting").value.trim(),
          customProviderType: "openai-compatible",
          confirmedCustomProviderHost: $("confirmCustomProviderHost").checked
        }
      : {};
  await api(`/api/credentials/${providerId}/test`, { method: "POST", body: JSON.stringify(body) });
  await refreshCredentialStates();
}

async function clearRuntimeCredential(providerId) {
  assertStorageGate("external", "runtime credentials");
  await api(`/api/credentials/${providerId}`, { method: "DELETE" });
  const inputId = RUNTIME_CREDENTIAL_FIELD_BY_ID.get(providerId)?.inputId;
  if (inputId) $(inputId).value = "";
  await refreshCredentialStates();
}

function toggleCredentialVisibility(providerId) {
  const field = RUNTIME_CREDENTIAL_FIELD_BY_ID.get(providerId);
  const input = $(field.inputId);
  const button = $(field.toggleId);
  if (!input || !button) return;
  const visible = input.type === "text";
  input.type = visible ? "password" : "text";
  button.textContent = visible ? "Show" : "Hide";
}

async function saveConfiguration({ close = false } = {}) {
  const values = configurationValues();
  if (values.businessUrl && !/^https?:\/\//.test(values.businessUrl))
    throw new Error("Canonical product URL must use HTTP or HTTPS.");
  await persistSettings(values);
  let credentialsSaved = true;
  try {
    await saveRuntimeCredentials();
  } catch (error) {
    if (error?.code !== "STORAGE_EXTERNAL_ACTION_BLOCKED") throw error;
    credentialsSaved = false;
  }
  state.configurationSnapshot = JSON.stringify(values);
  state.configurationDirty = pendingCredentialUpdates().length > 0;
  renderSelectedModelSummary();
  renderCredentialStates();
  renderOllamaStatus();
  if (close && credentialsSaved) $("configurationDialog").close();
  setStatus(
    credentialsSaved
      ? state.storageHealth.mode === STORAGE_MODES.DURABLE
        ? "Configuration saved."
        : "Configuration stored in memory only."
      : state.storageHealth.mode === STORAGE_MODES.DURABLE
        ? "Configuration saved locally. Runtime credentials remain blocked until durable storage is restored."
        : "Configuration stored in memory only. Runtime credentials remain blocked until durable storage is restored.",
    !credentialsSaved
  );
}

async function renderStorageStatus() {
  const status = await state.repository.estimate();
  const opfsAvailable = Boolean(navigator.storage?.getDirectory);
  const health = state.storageHealth;
  $("storageStatus").innerHTML =
    `<dt>Mode</dt><dd>${health.mode === STORAGE_MODES.DURABLE ? "Durable and verified" : storageModeLabel()}</dd><dt>Temporary</dt><dd>${health.temporaryDirty ? "Dirty" : "Clean"}</dd><dt>Reason</dt><dd>${health.reasonCode || "None"}</dd><dt>Last durable save</dt><dd>${health.lastDurableSaveAt ? formatDate(health.lastDurableSaveAt) : "Never"}</dd><dt>Persistence</dt><dd>${health.persistenceState}</dd><dt>Usage</dt><dd>${formatBytes(status.usage)} of ${formatBytes(status.quota)}</dd><dt>Persistent</dt><dd>${status.persisted ? "Yes" : "Not guaranteed"}</dd><dt>Large artifact storage</dt><dd>${opfsAvailable ? "OPFS available on demand" : "Blob download fallback"}</dd><dt>Schema</dt><dd>${VERSIONS.browserSchema}</dd>`;
}

async function requestPersistenceAction() {
  const result = await requestPersistenceStatus();
  state.storageHealth = {
    ...state.storageHealth,
    persistenceState: result.status
  };
  updateStorageGateUi();
  renderStorageStatus();
  if (result.granted) {
    setStatus("Persistent browser storage granted.");
    return result;
  }
  const message =
    result.status === PERSISTENCE_STATES.UNSUPPORTED
      ? "Persistent browser storage is not supported in this browser."
      : result.status === PERSISTENCE_STATES.DENIED
        ? "The browser did not grant persistent storage."
        : "Persistent storage could not be verified.";
  setStatus(message, true);
  return result;
}

function backupOptionsForScope(scope) {
  if (scope === "template") {
    const templateId = state.activeTemplateId;
    return {
      stores: ["templates", "templateVersions"],
      filter: (store, record) =>
        store === "templates" ? record.id === templateId : record.templateId === templateId
    };
  }
  if (scope === "addendum") {
    const addendumId = $("addendumSelect").value;
    return { stores: ["addenda"], filter: (_store, record) => record.id === addendumId };
  }
  if (scope === "result") {
    const resultId = state.activeResultId;
    return {
      stores: ["results", "resultVersions", "deliveryHistory"],
      filter: (store, record) => (store === "results" ? record.id === resultId : record.resultId === resultId)
    };
  }
  if (scope === "templates") return { stores: ["templates", "templateVersions"] };
  if (scope === "addenda") return { stores: ["addenda"] };
  if (scope === "settings") return { stores: ["settings"] };
  if (scope === "logs") return { stores: ["logs"], includeLogs: true };
  if (scope !== "project") return {};
  const projectId = state.activeProjectId;
  const resultIds = new Set(
    state.results.filter((item) => item.projectId === projectId).map((item) => item.id)
  );
  const project = activeProject();
  const templateIds = new Set(
    [
      project?.templateId,
      ...state.results.filter((item) => item.projectId === projectId).map((item) => item.templateId)
    ].filter(Boolean)
  );
  const addendumIds = new Set(
    state.results
      .filter((item) => item.projectId === projectId)
      .map((item) => item.addendumId)
      .filter(Boolean)
  );
  const stores = [
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
    "artifacts"
  ];
  return {
    stores,
    filter(store, record) {
      if (store === "projects") return record.id === projectId;
      if (["records", "results", "jobs", "contacts", "artifacts"].includes(store))
        return record.projectId === projectId;
      if (store === "templates") return templateIds.has(record.id);
      if (store === "templateVersions") return templateIds.has(record.templateId);
      if (store === "addenda") return addendumIds.has(record.id);
      if (store === "resultVersions" || store === "deliveryHistory") return resultIds.has(record.resultId);
      return false;
    }
  };
}

async function exportBackupAction() {
  const scope = $("backupScopeSelect").value;
  const filename = `ai-batch-personalizer-${scope}-${new Date().toISOString().slice(0, 10)}.emailgen`;
  const controller = beginArchiveTask("backup");
  try {
    const backup = await createBackup(state.repository, {
      ...backupOptionsForScope(scope),
      filename,
      signal: controller.signal,
      onProgress: (progress) => setStatus(archiveStatusMessage(`Creating ${filename}`, progress))
    });
    downloadBlob(backup.file, filename);
    setTimeout(() => backup.cleanup?.(), 60_000);
    state.storageHealth = {
      ...state.storageHealth,
      backupOfferedAt: nowIso(),
      checkpointMutations: 0,
      checkpointPromptAt: null
    };
    syncStorageMarker();
    updateStorageGateUi();
    setStatus(
      `Backup download started: ${Object.values(backup.manifest.counts).reduce((sum, value) => sum + value, 0)} records.`
    );
  } catch (error) {
    if (isArchiveCancelled(error)) {
      setStatus("Backup export cancelled.");
      return;
    }
    setStatus(error.message, true);
    throw error;
  } finally {
    endArchiveTask();
  }
}

async function exportEncryptedBackupAction() {
  const scope = $("backupScopeSelect").value;
  const passphrase = prompt("Enter a passphrase for the encrypted backup");
  if (!passphrase) return;
  const filename = `ai-batch-personalizer-${scope}-${new Date().toISOString().slice(0, 10)}.emailgen.enc`;
  const controller = beginArchiveTask("backup");
  try {
    const backup = await createEncryptedBackup(state.repository, {
      ...backupOptionsForScope(scope),
      filename,
      passphrase,
      signal: controller.signal,
      onProgress: (progress) => setStatus(archiveStatusMessage(`Creating ${filename}`, progress))
    });
    downloadBlob(backup.file, filename);
    setTimeout(() => backup.cleanup?.(), 60_000);
    state.storageHealth = {
      ...state.storageHealth,
      backupOfferedAt: state.storageHealth.backupOfferedAt ?? nowIso(),
      checkpointMutations: 0,
      checkpointPromptAt: null
    };
    syncStorageMarker();
    updateStorageGateUi();
    setStatus("Encrypted backup download started. Verify that the file was saved.");
  } catch (error) {
    if (isArchiveCancelled(error)) {
      setStatus("Encrypted backup export cancelled.");
      return;
    }
    setStatus(error.message, true);
    throw error;
  } finally {
    endArchiveTask();
  }
}

async function importBackupAction(file) {
  const controller = beginArchiveTask("backup");
  let inspected;
  try {
    setStatus("Validating backup archive and checksums…");
    const resolved = await resolveBackupArchive(file).catch(async (error) => {
      if (error?.code !== "BACKUP_PASSPHRASE_REQUIRED") throw error;
      const passphrase = prompt("Enter the encrypted backup passphrase");
      if (!passphrase) throw error;
      return resolveBackupArchive(file, { passphrase });
    });
    inspected = await inspectBackup(resolved.archive, {
      limits: state.bootstrap.app.limits,
      signal: controller.signal,
      onProgress: (progress) => setStatus(archiveStatusMessage("Validating backup", progress))
    });
  } catch (error) {
    if (isArchiveCancelled(error)) {
      setStatus("Backup validation cancelled.");
      return;
    }
    setStatus(error.message, true);
    throw error;
  } finally {
    endArchiveTask();
  }
  const policy = prompt("Conflict policy: merge, replace, duplicate, or skip", "merge")?.toLowerCase();
  if (!policy) return;
  if (!["merge", "replace", "duplicate", "skip"].includes(policy)) {
    setStatus("Unsupported backup conflict policy.", true);
    return;
  }
  let preview;
  try {
    preview = await previewRestore(state.repository, inspected, { conflict: policy });
  } catch (error) {
    setStatus(error.message, true);
    throw error;
  }
  const previewText = buildRestorePreviewText(preview);
  setStatus(previewText.summaryText);
  if (!confirm(`${previewText.detailText}\n\nProceed with this restore? No changes occur until you confirm.`))
    return;
  const identity = await restoreScopeIdentity({
    manifest: inspected.manifest,
    conflict: policy
  });
  let restoreOperation = null;
  if (state.operationCoordinator) {
    const acquisition = await state.operationCoordinator.acquire(identity, {
      kind: "restore",
      before: await state.operationCoordinator.read(identity.scopeKey),
      retryExisting: false
    });
    if (!acquisition.acquired) {
      setStatus(
        `${operationStatusLabel(acquisition.operation)} is already handling a restore in ${operationOwnerLabel(
          acquisition.operation,
          state.tabId
        )}.`,
        true
      );
      return;
    }
    restoreOperation = acquisition.operation;
  }
  let restoreStatus = "succeeded";
  try {
    setStatus("Restoring backup in one transaction…");
    const { summary } = await restoreBackup(state.repository, inspected, { conflict: policy });
    await loadAllState();
    renderAll();
    setStatus(
      state.storageHealth.mode === STORAGE_MODES.DURABLE
        ? `Backup restored: ${Object.entries(summary)
            .map(([key, value]) => `${key} ${value}`)
            .join(", ")}.`
        : `Backup restored into temporary storage: ${Object.entries(summary)
            .map(([key, value]) => `${key} ${value}`)
            .join(", ")}. Export an encrypted backup before closing.`
    );
  } catch (error) {
    restoreStatus = "failed-safe";
    throw error;
  } finally {
    if (restoreOperation) {
      await state.operationCoordinator
        .release(restoreOperation, {
          status: restoreStatus,
          completedAt: nowIso(),
          leaseExpiresAt: null,
          ownerTabId: null
        })
        .catch(() => {});
    }
  }
}

async function refreshDeliveryEvents() {
  assertStorageGate("external", "delivery refresh");
  const payload = await api("/api/gateway/resend/events");
  const history = await state.repository.all("deliveryHistory");
  const entries = [];
  const updatedResults = [];
  let matched = 0;
  for (const event of payload.events ?? []) {
    const messageId = event.data?.email_id || event.data?.email?.id || event.data?.id;
    const status = String(event.type || "").replace(/^email\./, "");
    if (["email.bounced", "email.complained", "email.suppressed"].includes(event.type)) {
      const recipients = Array.isArray(event.data?.to) ? event.data.to : [event.data?.to];
      for (const email of recipients.filter(Boolean)) {
        entries.push({
          store: "suppressions",
          value: {
            email: String(email).toLowerCase(),
            reason: event.type,
            source: "resend-webhook",
            updatedAt: event.createdAt || nowIso()
          }
        });
      }
    }
    const delivery = history.find(
      (item) => item.providerMessageId === messageId || item.resendId === messageId
    );
    if (!delivery) continue;
    delivery.status = status;
    delivery.lastEvent = event.type;
    delivery.updatedAt = event.createdAt || nowIso();
    entries.push({ store: "deliveryHistory", value: delivery });
    const result = state.results.find((item) => item.id === delivery.resultId);
    if (result) {
      result.delivery = {
        ...(result.delivery || {}),
        status,
        providerMessageId: messageId,
        updatedAt: delivery.updatedAt
      };
      result.updatedAt = nowIso();
      updatedResults.push(result);
    }
    matched += 1;
  }
  if (entries.length) await state.repository.atomicPut(entries);
  if (updatedResults.length) {
    for (let index = 0; index < updatedResults.length; index += 1) {
      updatedResults[index] = await persistRevisionedRecord("results", updatedResults[index]);
      upsertLocalResult(updatedResults[index]);
    }
  }
  renderResults({ preserveEditor: true });
  setStatus(
    `Delivery refresh received ${payload.events?.length ?? 0} event(s); ${matched} matched stored deliveries.`
  );
}

function resetActiveConfigurationSection() {
  const section = $(state.activeConfigurationSection) || $("settingsGeneral");
  if (!confirm(`Reset the ${section.querySelector("h3")?.textContent || "current"} section to defaults?`))
    return;
  const defaultsByControl = {
    businessNameSetting: DEFAULT_SETTINGS.businessName,
    businessSignatureSetting: DEFAULT_SETTINGS.businessSignature,
    businessUrlSetting: DEFAULT_SETTINGS.businessUrl,
    companyAddressSetting: DEFAULT_SETTINGS.companyAddress,
    modelCacheTtlSetting: DEFAULT_SETTINGS.modelCacheTtlHours,
    openrouterRefererSetting: DEFAULT_SETTINGS.openrouterReferer,
    ollamaHostSetting: DEFAULT_SETTINGS.ollamaHost,
    customBaseUrlSetting: DEFAULT_SETTINGS.customBaseUrl,
    resendFromNameSetting: DEFAULT_SETTINGS.resendFromName,
    resendFromAddressSetting: DEFAULT_SETTINGS.resendFromAddress,
    resendReplyToSetting: DEFAULT_SETTINGS.resendReplyTo,
    resendTestRecipientSetting: DEFAULT_SETTINGS.resendTestRecipient,
    resendBatchSizeSetting: DEFAULT_SETTINGS.resendBatchSize,
    resendUnsubscribeSetting: DEFAULT_SETTINGS.resendUnsubscribeUrl,
    logLevelSetting: DEFAULT_SETTINGS.logLevel
  };
  for (const control of section.querySelectorAll("input, textarea, select")) {
    if (control.type === "checkbox") control.checked = false;
    else control.value = defaultsByControl[control.id] ?? "";
    control.dispatchEvent(new Event("input", { bubbles: true }));
  }
  setStatus(
    `${section.querySelector("h3")?.textContent || "Configuration"} reset in the form. Choose Apply or Save to persist it.`
  );
}

async function migrateLegacy() {
  const payload = await api("/api/migration/legacy");
  if (state.settings.legacyMigrationChecksum === payload.checksum) {
    setStatus("This legacy database snapshot was already imported.");
    return;
  }
  const controller = beginArchiveTask("backup");
  try {
    const backup = await createBackup(state.repository, {
      filename: "pre-legacy-migration-backup.emailgen",
      signal: controller.signal,
      onProgress: (progress) => setStatus(archiveStatusMessage("Creating legacy backup", progress))
    });
    downloadBlob(backup.file, "pre-legacy-migration-backup.emailgen");
    setTimeout(() => backup.cleanup?.(), 60_000);
  } catch (error) {
    if (isArchiveCancelled(error)) {
      setStatus("Legacy backup cancelled.");
      return;
    }
    setStatus(error.message, true);
    throw error;
  } finally {
    endArchiveTask();
  }
  if (
    !confirm(
      `Import ${payload.counts.projects} projects, ${payload.counts.records} records, and ${payload.counts.results} results? The original SQLite database will not be deleted.`
    )
  )
    return;
  const projects = payload.projects.map((project) => ({
    ...project,
    id: `legacy:${project.id}`,
    templateId:
      state.templates.find((item) => item.name === project.promptName)?.id || state.activeTemplateId,
    migratedAt: nowIso()
  }));
  const records = payload.records.map((record) => ({
    ...record,
    id: `legacy-record:${record.id}`,
    projectId: `legacy:${record.projectId}`,
    migratedAt: nowIso()
  }));
  const recordIds = new Map(payload.records.map((record) => [record.id, `legacy-record:${record.id}`]));
  const results = payload.results.map((result) => ({
    ...result,
    id: `legacy-result:${result.id}`,
    projectId: `legacy:${result.projectId}`,
    recordId: recordIds.get(result.recordId),
    originalAiBodyHtml: result.bodyHtml,
    finalEmailHtml: result.emailHtml,
    finalText: result.bodyText,
    contacts: result.research?.contact?.candidates ?? [],
    primaryContactId: result.research?.contact?.candidates?.[0]?.id ?? null,
    trashed: false,
    migratedAt: nowIso()
  }));
  await state.repository.atomicPut([
    ...projects.map((value) => ({ store: "projects", value })),
    ...records.map((value) => ({ store: "records", value })),
    ...results.map((value) => ({ store: "results", value }))
  ]);
  await persistSettings({
    legacyMigrationChecksum: payload.checksum,
    activeProjectId: projects[0]?.id || state.activeProjectId
  });
  await loadAllState();
  renderAll();
  setStatus("Legacy data imported. Original SQLite data was retained.");
}

const WALKTHROUGH = [
  [
    "Import prospect data",
    "Load the sample or import a supported dataset. Each import becomes its own browser-owned project.",
    "#dataSection"
  ],
  [
    "Choose or create a template",
    "Edit a user template or duplicate a bundled template, then resolve variable warnings.",
    "#templateHeading"
  ],
  [
    "Select an AI model",
    "Choose one compatible model from the discovered catalog. Pricing shows source and freshness.",
    "#modelCatalogSection"
  ],
  [
    "Configure addendum and research",
    "Add optional email-safe supporting content and bounded public research.",
    "#processingSection"
  ],
  [
    "Process records",
    "Choose one scope and use the single Process action. Stop cancels in-flight work and schedules nothing new.",
    "#processingSection"
  ],
  [
    "Review and edit",
    "Use Raw HTML or the editable Visual Email view. Saving creates a recoverable version.",
    "#emailEditorShell"
  ],
  [
    "Choose a contact method",
    "Review every source-attributed candidate and override the primary choice when needed.",
    "#contactCandidatesHeading"
  ],
  [
    "Copy, export, or send",
    "Download real browser files, create delivery kits, or send only consent-eligible Resend messages.",
    "#deliveryHeading"
  ]
];

function renderWalkthrough() {
  const [heading, text, selector] = WALKTHROUGH[state.walkthroughIndex];
  $("walkthroughHeading").textContent = heading;
  $("walkthroughText").textContent = text;
  $("walkthroughProgress").textContent = `${state.walkthroughIndex + 1} of ${WALKTHROUGH.length}`;
  $("walkthroughBack").disabled = state.walkthroughIndex === 0;
  $("walkthroughNext").textContent = state.walkthroughIndex === WALKTHROUGH.length - 1 ? "Finish" : "Next";
  document
    .querySelectorAll(".walkthrough-target")
    .forEach((node) => node.classList.remove("walkthrough-target"));
  document.querySelector(selector)?.classList.add("walkthrough-target");
}

async function finishWalkthrough() {
  document
    .querySelectorAll(".walkthrough-target")
    .forEach((node) => node.classList.remove("walkthrough-target"));
  $("walkthroughDialog").close();
  await persistSettings({ walkthroughVersion: VERSIONS.walkthrough });
}

function trapDialog(dialog) {
  dialog.addEventListener("keydown", (event) => {
    if (event.key !== "Tab") return;
    const focusable = [
      ...dialog.querySelectorAll(
        'button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])'
      )
    ].filter((item) => !item.hidden);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
}

function renderAll() {
  renderProjects();
  renderTemplates();
  renderModelCatalog();
  renderOllamaStatus();
  renderRecords();
  renderResults();
  renderProgress();
  renderProviderBatchOperations();
  updateProcessingButton();
}

async function refreshOperationSnapshot() {
  state.operations = (await state.repository.all("operations")).map(withRevision);
  renderProgress();
  updateProcessingButton();
}

function bind() {
  $("refreshButton").addEventListener("click", async () => {
    await loadAllState();
    renderAll();
    setStatus("Browser data refreshed.");
  });
  $("projectSelect").addEventListener("change", async () => {
    if (
      (state.templateDirty || state.resultDirty) &&
      !confirm("Discard unsaved changes and switch projects?")
    ) {
      $("projectSelect").value = state.activeProjectId;
      return;
    }
    invalidateResendConfirmation("Project changed after resend preflight.");
    await persistSettings({ activeProjectId: $("projectSelect").value });
    await loadAllState();
    renderAll();
  });
  $("sampleButton").addEventListener("click", () =>
    api("/api/gateway/sample", { method: "POST", body: "{}" }).then(importDataset).catch(handleError)
  );
  $("fileInput").addEventListener("change", (event) => {
    const file = event.target.files[0];
    if (!file) return;
    const form = new FormData();
    form.append("file", file);
    api("/api/gateway/import", { method: "POST", body: form })
      .then(importDataset)
      .catch(handleError)
      .finally(() => {
        event.target.value = "";
      });
  });
  ["recordSearch", "recordStatusFilter", "recordPageSize"].forEach((id) =>
    $(id).addEventListener("input", () => {
      state.recordPage = 1;
      renderRecords();
    })
  );
  $("recordPreviousPage").addEventListener("click", () => {
    state.recordPage -= 1;
    renderRecords();
  });
  $("recordNextPage").addEventListener("click", () => {
    state.recordPage += 1;
    renderRecords();
  });
  $("recordSelect").addEventListener("change", () => selectRecord($("recordSelect").value));
  $("templateSelect").addEventListener("change", () => {
    if (state.templateDirty && !confirm("Discard unsaved template changes?")) {
      $("templateSelect").value = state.activeTemplateId;
      return;
    }
    state.activeTemplateId = $("templateSelect").value;
    renderTemplates();
  });
  ["templateSearch", "templateSort"].forEach((id) =>
    $(id).addEventListener("input", () => renderTemplates({ preserveDraft: true }))
  );
  $("templateEditor").addEventListener("input", () => {
    state.templateDirty = $("templateEditor").value !== state.templateBaseline;
    $("revertTemplateButton").disabled = !state.templateDirty;
    recordStorageMutation({ temporary: true });
    renderTemplateWarnings();
    updateCostEstimate();
  });
  $("templateTags").addEventListener("input", () => {
    state.templateDirty = true;
    recordStorageMutation({ temporary: true });
  });
  $("newTemplateButton").addEventListener("click", () => {
    state.activeTemplateId = null;
    $("templateEditor").value = "";
    $("templateTags").value = "";
    state.templateBaseline = "";
    state.templateDirty = true;
    recordStorageMutation({ temporary: true });
    renderTemplates({ preserveDraft: true });
    $("templateEditor").focus();
  });
  $("saveTemplateButton").addEventListener("click", () => saveTemplate().catch(handleError));
  $("saveAsTemplateButton").addEventListener("click", () =>
    saveTemplate({ saveAs: true }).catch(handleError)
  );
  $("duplicateTemplateButton").addEventListener("click", () =>
    saveTemplate({ saveAs: true }).catch(handleError)
  );
  $("renameTemplateButton").addEventListener("click", () => renameTemplate().catch(handleError));
  $("revertTemplateButton").addEventListener("click", () => {
    $("templateEditor").value = activeTemplate()?.content || "";
    state.templateDirty = false;
    renderTemplates({ preserveDraft: true });
  });
  $("deleteTemplateButton").addEventListener("click", () => deleteTemplate().catch(handleError));
  $("previewButton").addEventListener("click", previewPrompt);
  $("templateHistoryButton").addEventListener("click", () => showTemplateHistory().catch(handleError));
  $("exportTemplateButton").addEventListener("click", () => {
    const template = activeTemplate();
    if (template)
      downloadBlob(new Blob([template.content], { type: "text/plain" }), safeFilename(template.name, ".txt"));
  });
  $("templateImportInput").addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    $("templateEditor").value = await file.text();
    state.activeTemplateId = null;
    state.templateDirty = true;
    recordStorageMutation({ temporary: true });
    renderTemplates({ preserveDraft: true });
    event.target.value = "";
  });
  const debouncedModelRender = debounce(renderModelCatalog);
  ["modelSearch", "modelProviderFilter", "compatibleModelsOnly", "favoriteModelsOnly"].forEach((id) =>
    $(id).addEventListener("input", debouncedModelRender)
  );
  $("modelSyncButton").addEventListener("click", async () => {
    $("modelSyncButton").disabled = true;
    const statuses = [];
    try {
      const serverStatus = await syncServerModelCatalog({ runSync: true });
      statuses.push(`catalog: ${serverStatus?.latestRuns?.[0]?.status || "updated"}`);
    } catch (error) {
      statuses.push(`catalog: ${error.message}`);
    }
    for (const provider of ["openrouter", "ollama"]) {
      try {
        statuses.push(`${provider}: ${(await refreshRuntimeModels(provider)).status}`);
      } catch (error) {
        statuses.push(`${provider}: ${error.message}`);
      }
    }
    $("modelSyncButton").disabled = false;
    $("modelSyncSummary").textContent = statuses.join(" · ");
  });
  $("processingScope").addEventListener("change", () => {
    updateProcessingButton();
    updateCostEstimate();
  });
  $("executionModeSelect").addEventListener("change", async () => {
    await persistSettings({ executionMode: normalizeExecutionSetting($("executionModeSelect").value) });
    renderSelectedModelSummary();
    updateProcessingButton();
  });
  ["rangeStart", "rangeEnd", "concurrencyInput", "delayInput"].forEach((id) =>
    $(id).addEventListener("input", () => {
      updateProcessingButton();
      updateCostEstimate();
    })
  );
  $("processButton").addEventListener("click", () => processScope().catch(handleError));
  $("stopButton").addEventListener("click", stopProcessing);
  $("retryButton").addEventListener("click", () => {
    const ids = new Set(
      projectResults()
        .filter((item) => item.status === "failed" && !item.trashed)
        .map((item) => item.recordId)
    );
    processScope(
      projectRecords().filter((item) => ids.has(item.id)),
      { retryExisting: true }
    ).catch(handleError);
  });
  $("providerBatchOperationRows")?.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-provider-batch-action]");
    if (!button) return;
    const job = state.jobs.find((item) => item.id === button.dataset.jobId);
    if (!job) return;
    if (button.dataset.providerBatchAction === "resume-submission") {
      resumeProviderBatchSubmission(job).catch(handleError);
      return;
    }
    monitorProviderBatchJob(job, { resumed: true }).catch(handleError);
  });
  $("changeModelButton").addEventListener("click", () => {
    $("modelCatalogSection").scrollIntoView();
    $("modelSearch").focus();
  });
  $("addendumEnabled").addEventListener("change", () => {
    $("addendumSelect").disabled = !$("addendumEnabled").checked;
    $("previewAddendumButton").disabled = !$("addendumEnabled").checked || !$("addendumSelect").value;
  });
  $("addendumSelect").addEventListener("change", () => {
    $("previewAddendumButton").disabled = !$("addendumEnabled").checked || !$("addendumSelect").value;
  });
  $("previewAddendumButton").addEventListener("click", () => {
    $("addendumPreviewContent").innerHTML =
      state.addenda.find((item) => item.id === $("addendumSelect").value)?.content || "";
    $("addendumPreviewDialog").showModal();
  });
  ["resultSearch", "resultStatusFilter"].forEach((id) => $(id).addEventListener("input", renderResults));
  document.querySelectorAll("[data-result-sort]").forEach((button) =>
    button.addEventListener("click", () => {
      const key = button.dataset.resultSort;
      state.resultSort =
        state.resultSort.key === key
          ? { key, direction: state.resultSort.direction === "asc" ? "desc" : "asc" }
          : { key, direction: key === "updatedAt" ? "desc" : "asc" };
      renderResults();
    })
  );
  $("selectAllResults").addEventListener("change", () => {
    filteredResults()
      .filter((item) => item.status === "completed" || item.trashed)
      .forEach((item) =>
        $("selectAllResults").checked
          ? state.selectedResultIds.add(item.id)
          : state.selectedResultIds.delete(item.id)
      );
    invalidateResendConfirmation("Selected resend recipients changed.");
    renderResults({ preserveEditor: true });
  });
  $("deleteSelectedResultsButton").addEventListener("click", () => softDeleteSelected().catch(handleError));
  $("deleteActiveResultButton").addEventListener("click", () => deleteActiveResult().catch(handleError));
  $("primaryContactSelect").addEventListener("change", async () => {
    const result = activeResult();
    if (!result) return;
    const saved = await updateRevisionedRecord(
      "results",
      result.id,
      (current) => ({
        ...current,
        primaryContactId: $("primaryContactSelect").value || null,
        updatedAt: nowIso()
      }),
      {
        conflictCode: "RESULT_CONFLICT",
        conflictMessage:
          "This result changed in another tab. Reload the latest version before updating the contact."
      }
    );
    upsertLocalResult(saved);
    invalidateResendConfirmation("Primary contact changed after resend preflight.");
    renderContacts(saved);
  });
  $("subjectInput").addEventListener("input", () => {
    if (state.resultPanelSyncing) return;
    state.resultDirty = true;
    recordStorageMutation({ temporary: true });
    if (activeResult()) renderContacts(activeResult());
  });
  $("bodyInput").addEventListener("input", () => {
    if (state.resultPanelSyncing) return;
    state.resultDirty = true;
    recordStorageMutation({ temporary: true });
    updateRawEditor();
    updateVisualEditor($("bodyInput").value);
    if (activeResult()) renderContacts(activeResult());
    logEditor("debug", "raw_editor_input", {
      summary: summarizeHtml($("bodyInput").value)
    });
  });
  $("bodyInput").addEventListener("scroll", () => {
    $("rawLineNumbers").scrollTop = $("bodyInput").scrollTop;
  });
  $("rawCollapseButton").addEventListener("click", () => resizeEditor("raw", "collapse"));
  $("rawFitButton").addEventListener("click", () => resizeEditor("raw", "fit"));
  $("rawExpandButton").addEventListener("click", () => resizeEditor("raw", "expand"));
  $("visualCollapseButton").addEventListener("click", () => resizeEditor("preview", "collapse"));
  $("visualFitButton").addEventListener("click", () => resizeEditor("preview", "fit"));
  $("visualExpandButton").addEventListener("click", () => resizeEditor("preview", "expand"));
  ["raw", "preview"].forEach((panel) => {
    const handle = editorPanelHandle(panel);
    handle.addEventListener("pointerdown", (event) => beginEditorPanelResize(panel, event));
    handle.addEventListener("keydown", (event) => handleEditorPanelResizeKey(panel, event));
  });
  $("rawFindNextButton").addEventListener("click", () => {
    const query = $("rawFindInput").value;
    if (!query) return;
    const source = $("bodyInput").value;
    const start = source.indexOf(query, $("bodyInput").selectionEnd);
    const index = start >= 0 ? start : source.indexOf(query);
    if (index >= 0) {
      $("bodyInput").focus();
      $("bodyInput").setSelectionRange(index, index + query.length);
    }
  });
  $("saveEditButton").addEventListener("click", () => saveResultEdits().catch(handleError));
  $("discardEditButton").addEventListener("click", () => {
    state.logger?.info("browser_result_edit_discarded", {
      resultId: activeResult()?.id || null
    });
    renderActiveResult();
  });
  $("regenerateButton").addEventListener("click", () => regenerateResult().catch(handleError));
  $("copyEmailButton").addEventListener("click", () => {
    const contact = resultContact(activeResult());
    if (contact?.type === "email") writeClipboard(contact.value, "Email address").catch(handleError);
  });
  $("copySubjectButton").addEventListener("click", () =>
    writeClipboard(activeResult()?.subject || "", "Subject").catch(handleError)
  );
  $("copyRenderedButton").addEventListener("click", () => copyRendered().catch(handleError));
  $("copyHtmlButton").addEventListener("click", () => {
    try {
      writeClipboard(assertRenderableOutput(activeResult(), "copied").finalEmailHtml, "HTML").catch(
        handleError
      );
    } catch (error) {
      handleError(error);
    }
  });
  $("copyTextButton").addEventListener("click", () => {
    try {
      writeClipboard(assertRenderableOutput(activeResult(), "copied").finalText, "Plain text").catch(
        handleError
      );
    } catch (error) {
      handleError(error);
    }
  });
  $("exportOneButton").addEventListener("click", () => {
    try {
      exportOne();
    } catch (error) {
      handleError(error);
    }
  });
  $("exportAllButton").addEventListener("click", () =>
    exportResults(
      projectResults({ includeTrash: false }).filter((item) => item.status === "completed"),
      "email-exports.zip"
    ).catch(handleError)
  );
  $("exportDeliverySelectedButton").addEventListener("click", () =>
    exportResults(
      projectResults({ includeTrash: false }).filter(
        (item) => state.selectedResultIds.has(item.id) && item.status === "completed"
      ),
      "selected-delivery-kit.zip",
      $("deliveryProfileSelect").value
    ).catch(handleError)
  );
  $("exportDeliveryAllButton").addEventListener("click", () =>
    exportResults(
      projectResults({ includeTrash: false }).filter((item) => item.status === "completed"),
      "completed-delivery-kit.zip",
      $("deliveryProfileSelect").value
    ).catch(handleError)
  );
  $("printButton").addEventListener("click", () => {
    try {
      const printable = assertRenderableOutput(activeResult(), "printed");
      state.logger?.info("browser_result_print_requested", {
        resultId: printable.id,
        recordId: printable.recordId
      });
      window.print();
    } catch (error) {
      handleError(error);
    }
  });
  $("resendPreflightButton").addEventListener("click", () => resendPreflight().catch(handleError));
  $("resendFinalConfirmation").addEventListener("change", () => {
    $("resendSendButton").disabled =
      !$("resendFinalConfirmation").checked || !state.resendPreflight?.eligible.length;
  });
  $("resendSendButton").addEventListener("click", () => sendResend().catch(handleError));
  $("configurationButton").addEventListener("click", () => {
    fillConfiguration();
    refreshCredentialStates().catch(handleError);
    $("configurationDialog").showModal();
  });
  $("configurationCloseButton").addEventListener("click", closeConfiguration);
  $("cancelConfigurationButton").addEventListener("click", closeConfiguration);
  $("applyConfigurationButton").addEventListener("click", () => saveConfiguration().catch(handleError));
  $("saveConfigurationButton").addEventListener("click", () =>
    saveConfiguration({ close: true }).catch(handleError)
  );
  $("configurationForm").addEventListener("input", () => {
    state.configurationDirty =
      JSON.stringify(configurationValues()) !== state.configurationSnapshot ||
      pendingCredentialUpdates().length > 0;
    recordStorageMutation({ temporary: true });
  });
  $("configurationDialog").addEventListener("cancel", (event) => {
    if (state.configurationDirty) {
      event.preventDefault();
      closeConfiguration();
    }
  });
  RUNTIME_CREDENTIAL_FIELDS.forEach((field) => {
    $(field.toggleId)?.addEventListener("click", () => toggleCredentialVisibility(field.id));
    $(field.testButtonId)?.addEventListener("click", () =>
      testRuntimeCredential(field.id)
        .then(() => setStatus(`${field.id} credential validated.`))
        .catch(handleError)
    );
    $(field.clearButtonId)?.addEventListener("click", () =>
      clearRuntimeCredential(field.id)
        .then(() => setStatus(`${field.id} credential cleared.`))
        .catch(handleError)
    );
  });
  $("detectOllamaButton").addEventListener("click", () => {
    state.settings.ollamaHost = $("ollamaHostSetting").value;
    state.settings.confirmedCustomOllamaHost = $("confirmCustomOllamaHost").checked;
    detectOllama()
      .then((result) => {
        setStatus(formatOllamaStatus(result));
      })
      .catch(handleError);
  });
  $("refreshDeliveryEventsButton").addEventListener("click", () =>
    refreshDeliveryEvents().catch(handleError)
  );
  $("requestPersistenceButton").addEventListener("click", () =>
    requestPersistenceAction().catch(handleError)
  );
  $("storagePersistenceButton")?.addEventListener("click", () =>
    requestPersistenceAction().catch(handleError)
  );
  $("storageAcknowledgeButton")?.addEventListener("click", () =>
    acknowledgeTemporaryStorage().catch(handleError)
  );
  $("storageRetryButton")?.addEventListener("click", () => retryDurableStorage().catch(handleError));
  $("storageResolveButton")?.addEventListener("click", () => resolveRecoveryWarning().catch(handleError));
  $("exportBackupButton").addEventListener("click", () => exportBackupAction().catch(handleError));
  $("exportEncryptedBackupButton")?.addEventListener("click", () =>
    exportEncryptedBackupAction().catch(handleError)
  );
  $("storageExportEncryptedButton")?.addEventListener("click", () =>
    exportEncryptedBackupAction().catch(handleError)
  );
  $("importBackupInput").addEventListener("change", (event) => {
    const file = event.target.files[0];
    if (file)
      importBackupAction(file)
        .catch(handleError)
        .finally(() => {
          event.target.value = "";
        });
  });
  $("storageBannerImportInput")?.addEventListener("change", (event) => {
    const file = event.target.files[0];
    if (!file) return;
    importBackupAction(file)
      .catch(handleError)
      .finally(() => {
        event.target.value = "";
      });
  });
  $("legacyMigrationButton").addEventListener("click", () => migrateLegacy().catch(handleError));
  $("exportDiagnosticsButton").addEventListener("click", async () => {
    let controller = null;
    try {
      controller = beginArchiveTask("diagnostics");
      const backup = await createBackup(state.repository, {
        stores: ["logs"],
        includeLogs: true,
        filename: "diagnostics.emailgen",
        signal: controller.signal,
        onProgress: (progress) => setStatus(archiveStatusMessage("Creating diagnostics backup", progress))
      });
      downloadBlob(backup.file, "diagnostics.emailgen");
      setTimeout(() => backup.cleanup?.(), 60_000);
      setStatus("Diagnostics download started.");
    } catch (error) {
      if (isArchiveCancelled(error)) {
        setStatus("Diagnostics export cancelled.");
        return;
      }
      handleError(error);
    } finally {
      if (controller) endArchiveTask();
    }
  });
  $("cancelArchiveButton").addEventListener("click", () => cancelArchiveTask());
  $("restartWalkthroughButton").addEventListener("click", () => {
    state.walkthroughIndex = 0;
    renderWalkthrough();
    $("walkthroughDialog").showModal();
  });
  $("resetAllSettingsButton").addEventListener("click", () => {
    if (!confirm("Reset all settings but keep projects?")) return;
    Object.assign(state.settings, DEFAULT_SETTINGS);
    fillConfiguration();
  });
  document.querySelectorAll(".settings-nav a").forEach((link) =>
    link.addEventListener("click", () => {
      state.activeConfigurationSection = link.getAttribute("href").slice(1);
    })
  );
  $("resetSectionButton").addEventListener("click", resetActiveConfigurationSection);
  $("resetAllDataButton").addEventListener("click", async () => {
    assertStorageGate("irreversible", "reset all data");
    if (!confirm("Permanently clear all browser-owned data? Export a backup first. This cannot be undone."))
      return;
    for (const store of [
      "projects",
      "records",
      "templates",
      "templateVersions",
      "addenda",
      "results",
      "resultVersions",
      "jobs",
      "researchCache",
      "contacts",
      "modelCatalog",
      "providerStatus",
      "settings",
      "deliveryHistory",
      "suppressions",
      "artifacts",
      "logs"
    ])
      await state.repository.clear(store);
    location.reload();
  });
  $("walkthroughBack").addEventListener("click", () => {
    state.walkthroughIndex = Math.max(0, state.walkthroughIndex - 1);
    renderWalkthrough();
  });
  $("walkthroughNext").addEventListener("click", () => {
    if (state.walkthroughIndex === WALKTHROUGH.length - 1) finishWalkthrough();
    else {
      state.walkthroughIndex += 1;
      renderWalkthrough();
    }
  });
  $("walkthroughSkip").addEventListener("click", finishWalkthrough);
  document
    .querySelectorAll("[data-close-dialog]")
    .forEach((button) => button.addEventListener("click", () => button.closest("dialog").close()));
  document.querySelectorAll("dialog").forEach(trapDialog);
  window.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      document.activeElement?.closest?.(".template-pane")
        ? saveTemplate().catch(handleError)
        : activeResult() && saveResultEdits().catch(handleError);
    }
    if (
      (event.ctrlKey || event.metaKey) &&
      event.key === "Enter" &&
      document.activeElement?.closest?.(".template-pane")
    ) {
      event.preventDefault();
      previewPrompt();
    }
  });
  window.addEventListener("beforeunload", (event) => {
    if (
      state.templateDirty ||
      state.resultDirty ||
      state.processing ||
      (state.storageHealth.mode !== STORAGE_MODES.DURABLE &&
        (state.storageHealth.temporaryDirty || state.storageHealth.recoveryRequired))
    ) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
  window.addEventListener("pagehide", () => {
    state.logger?.flush({ force: true }).catch(() => {});
  });
  window.addEventListener("pointermove", (event) => updateEditorPanelResize(event));
  window.addEventListener("pointerup", () => endEditorPanelResize("pointerup"));
  window.addEventListener("pointercancel", () => endEditorPanelResize("pointercancel"));
  window.addEventListener("resize", () => {
    if (state.editorPanelResize) endEditorPanelResize("window_resize");
    syncEditorPanelsToViewport("window_resize");
  });
  window.addEventListener("error", (event) =>
    state.logger?.error("browser_unhandled_error", { message: event.message })
  );
  window.addEventListener("unhandledrejection", (event) =>
    state.logger?.error("browser_unhandled_rejection", {
      message: event.reason?.message || String(event.reason)
    })
  );
}

function resizeEditor(panel, action) {
  adjustEditorPanel(panel, action);
}

function closeConfiguration() {
  if (state.configurationDirty && !confirm("Discard unsaved configuration changes?")) return;
  state.configurationDirty = false;
  $("configurationDialog").close();
}

function handleError(error) {
  const message = error?.message || String(error);
  setStatus(message, true);
  setEditorPanelMessage(message, "warning");
  state.logger?.error("operation_failed", {
    code: error?.code,
    message,
    stack: error?.stack
  });
}

async function initialize() {
  state.bootstrap = await api("/api/gateway/bootstrap");
  state.credentialStatus = state.bootstrap.credentials ?? [];
  const persistence = await readPersistenceStatus();
  const marker = readContinuityMarker();
  await activateRepository(await openBrowserRepository());
  state.storageBootstrapInProgress = true;
  const baseHealth = createStorageHealthState({ persistenceState: persistence.status });
  if (state.repository.temporary) {
    state.storageHealth = startTemporaryEpisode(baseHealth, {
      reasonCode: state.repository.reason?.code || "STORAGE_UNAVAILABLE",
      message: state.repository.reason?.message || "Browser storage is unavailable.",
      marker,
      degradedAt: nowIso()
    });
  } else if (marker) {
    state.storageHealth = startTemporaryEpisode(baseHealth, {
      reasonCode: marker.reasonCode || "STORAGE_RECOVERY_REQUIRED",
      message: marker.message || "A previous temporary-storage episode was detected.",
      marker,
      degradedAt: marker.markerDetectedAt || nowIso()
    });
  } else {
    state.storageHealth = {
      ...finishRecovery(baseHealth, { durable: true, now: nowIso() }),
      mode: STORAGE_MODES.DURABLE,
      temporaryDirty: false,
      recoveryRequired: false,
      markerSeen: false,
      acknowledged: false,
      reasonCode: null,
      message: "Durable storage verified."
    };
  }
  updateStorageGateUi();
  renderStorageStatus();
  const shouldShowWalkthrough =
    state.settings.walkthroughVersion < VERSIONS.walkthrough && !navigator.webdriver;
  if (shouldShowWalkthrough) {
    renderWalkthrough();
    $("walkthroughDialog").showModal();
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  await seedBundledContent();
  await loadAllState();
  state.storageBootstrapInProgress = false;
  mountVisualEditor();
  $("addendumSelect").replaceChildren(
    new Option("None", ""),
    ...state.addenda.map((item) => new Option(item.name, item.id))
  );
  $("concurrencyInput").max = state.bootstrap.app.ai.maxConcurrency;
  $("concurrencyInput").value = state.bootstrap.app.ai.defaultConcurrency;
  $("delayInput").max = state.bootstrap.app.ai.maxDelayMs;
  $("delayInput").value = state.bootstrap.app.ai.defaultDelayMs;
  createSplitPane($("dataSplit"), { key: "data", defaultRatio: 56, minimum: 28, maximum: 72 });
  createSplitPane($("catalogSplit"), { key: "catalog", defaultRatio: 34, minimum: 25, maximum: 65 });
  createSplitPane($("resultsSplit"), { key: "results", defaultRatio: 48, minimum: 30, maximum: 68 });
  bind();
  await refreshCredentialStates().catch(() => {});
  await syncServerModelCatalog({ runSync: false, silent: true }).catch(() => {});
  renderAll();
  $("applicationVersion").textContent = VERSIONS.application;
  $("copyrightYear").textContent = String(new Date().getFullYear());
  setStatus(
    `${projectRecords().length} records · ${projectResults({ includeTrash: false }).length} results · ${storageModeStatusMessage()}`
  );
  await state.logger.info("browser_application_started", {
    schemaVersion: VERSIONS.browserSchema,
    temporary: state.repository.temporary,
    editorPanels: state.settings.editorPanels
  });
  await state.logger.info("editor_panels_ready", {
    raw: editorPanelHeight("raw"),
    preview: editorPanelHeight("preview")
  });
  if (state.bootstrap.app.modelSync.enabled) {
    void syncServerModelCatalog({ runSync: true, silent: true }).catch(() => {});
  }
  if (shouldAutoDetectOllama()) {
    if (!ollamaRuntimeState().models.length) $("ollamaStatusSetting").textContent = "Checking localhost...";
    void detectOllama({ silent: true });
  }
  void resumeProviderBatchMonitoring().catch(handleError);
}

initialize().catch((error) => {
  console.error(error);
  setStatus(`Startup failed: ${error.message}`, true);
  state.storageBootstrapInProgress = false;
});
