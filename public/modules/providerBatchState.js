const CANONICAL_OPERATION_STATES = Object.freeze({
  PREPARING: "preparing",
  SUBMITTING: "submitting",
  PARTIALLY_SUBMITTED: "partially-submitted",
  SUBMITTED: "submitted",
  MONITORING: "monitoring",
  MONITORING_DEGRADED: "monitoring-degraded",
  AWAITING_CREDENTIAL: "awaiting-credential",
  CANCEL_REQUESTED: "cancel-requested",
  RECONCILING: "reconciling",
  COMPLETED: "completed",
  PARTIALLY_COMPLETED: "partially-completed",
  CANCELED: "canceled",
  FAILED_TERMINAL: "failed-terminal",
  AMBIGUOUS: "ambiguous"
});

const OPERATION_STATE_ALIASES = Object.freeze({
  queued: CANONICAL_OPERATION_STATES.PREPARING,
  preparing: CANONICAL_OPERATION_STATES.PREPARING,
  submitting: CANONICAL_OPERATION_STATES.SUBMITTING,
  partially_submitted: CANONICAL_OPERATION_STATES.PARTIALLY_SUBMITTED,
  "partially-submitted": CANONICAL_OPERATION_STATES.PARTIALLY_SUBMITTED,
  submitted: CANONICAL_OPERATION_STATES.SUBMITTED,
  monitoring: CANONICAL_OPERATION_STATES.MONITORING,
  monitoring_degraded: CANONICAL_OPERATION_STATES.MONITORING_DEGRADED,
  "monitoring-degraded": CANONICAL_OPERATION_STATES.MONITORING_DEGRADED,
  credential_required: CANONICAL_OPERATION_STATES.AWAITING_CREDENTIAL,
  awaiting_credential: CANONICAL_OPERATION_STATES.AWAITING_CREDENTIAL,
  "awaiting-credential": CANONICAL_OPERATION_STATES.AWAITING_CREDENTIAL,
  stopping: CANONICAL_OPERATION_STATES.CANCEL_REQUESTED,
  cancel_requested: CANONICAL_OPERATION_STATES.CANCEL_REQUESTED,
  "cancel-requested": CANONICAL_OPERATION_STATES.CANCEL_REQUESTED,
  reconciling: CANONICAL_OPERATION_STATES.RECONCILING,
  submission_unknown: CANONICAL_OPERATION_STATES.AMBIGUOUS,
  ambiguous: CANONICAL_OPERATION_STATES.AMBIGUOUS,
  completed: CANONICAL_OPERATION_STATES.COMPLETED,
  partially_failed: CANONICAL_OPERATION_STATES.PARTIALLY_COMPLETED,
  partially_completed: CANONICAL_OPERATION_STATES.PARTIALLY_COMPLETED,
  "partially-completed": CANONICAL_OPERATION_STATES.PARTIALLY_COMPLETED,
  failed: CANONICAL_OPERATION_STATES.FAILED_TERMINAL,
  failed_terminal: CANONICAL_OPERATION_STATES.FAILED_TERMINAL,
  "failed-terminal": CANONICAL_OPERATION_STATES.FAILED_TERMINAL,
  stopped: CANONICAL_OPERATION_STATES.CANCELED,
  cancelled: CANONICAL_OPERATION_STATES.CANCELED,
  canceled: CANONICAL_OPERATION_STATES.CANCELED
});

const LEGAL_OPERATION_TRANSITIONS = new Map([
  [
    CANONICAL_OPERATION_STATES.PREPARING,
    new Set([CANONICAL_OPERATION_STATES.SUBMITTING, CANONICAL_OPERATION_STATES.AMBIGUOUS])
  ],
  [
    CANONICAL_OPERATION_STATES.SUBMITTING,
    new Set([
      CANONICAL_OPERATION_STATES.PARTIALLY_SUBMITTED,
      CANONICAL_OPERATION_STATES.SUBMITTED,
      CANONICAL_OPERATION_STATES.AWAITING_CREDENTIAL,
      CANONICAL_OPERATION_STATES.AMBIGUOUS,
      CANONICAL_OPERATION_STATES.FAILED_TERMINAL
    ])
  ],
  [
    CANONICAL_OPERATION_STATES.PARTIALLY_SUBMITTED,
    new Set([
      CANONICAL_OPERATION_STATES.SUBMITTED,
      CANONICAL_OPERATION_STATES.MONITORING,
      CANONICAL_OPERATION_STATES.MONITORING_DEGRADED,
      CANONICAL_OPERATION_STATES.AWAITING_CREDENTIAL,
      CANONICAL_OPERATION_STATES.RECONCILING,
      CANONICAL_OPERATION_STATES.CANCEL_REQUESTED,
      CANONICAL_OPERATION_STATES.AMBIGUOUS,
      CANONICAL_OPERATION_STATES.FAILED_TERMINAL
    ])
  ],
  [
    CANONICAL_OPERATION_STATES.SUBMITTED,
    new Set([
      CANONICAL_OPERATION_STATES.MONITORING,
      CANONICAL_OPERATION_STATES.MONITORING_DEGRADED,
      CANONICAL_OPERATION_STATES.AWAITING_CREDENTIAL,
      CANONICAL_OPERATION_STATES.RECONCILING,
      CANONICAL_OPERATION_STATES.CANCEL_REQUESTED,
      CANONICAL_OPERATION_STATES.COMPLETED,
      CANONICAL_OPERATION_STATES.PARTIALLY_COMPLETED,
      CANONICAL_OPERATION_STATES.CANCELED,
      CANONICAL_OPERATION_STATES.FAILED_TERMINAL,
      CANONICAL_OPERATION_STATES.AMBIGUOUS
    ])
  ],
  [
    CANONICAL_OPERATION_STATES.MONITORING,
    new Set([
      CANONICAL_OPERATION_STATES.MONITORING_DEGRADED,
      CANONICAL_OPERATION_STATES.AWAITING_CREDENTIAL,
      CANONICAL_OPERATION_STATES.RECONCILING,
      CANONICAL_OPERATION_STATES.CANCEL_REQUESTED,
      CANONICAL_OPERATION_STATES.COMPLETED,
      CANONICAL_OPERATION_STATES.PARTIALLY_COMPLETED,
      CANONICAL_OPERATION_STATES.CANCELED,
      CANONICAL_OPERATION_STATES.FAILED_TERMINAL,
      CANONICAL_OPERATION_STATES.AMBIGUOUS
    ])
  ],
  [
    CANONICAL_OPERATION_STATES.MONITORING_DEGRADED,
    new Set([
      CANONICAL_OPERATION_STATES.MONITORING,
      CANONICAL_OPERATION_STATES.AWAITING_CREDENTIAL,
      CANONICAL_OPERATION_STATES.RECONCILING,
      CANONICAL_OPERATION_STATES.CANCEL_REQUESTED,
      CANONICAL_OPERATION_STATES.COMPLETED,
      CANONICAL_OPERATION_STATES.PARTIALLY_COMPLETED,
      CANONICAL_OPERATION_STATES.CANCELED,
      CANONICAL_OPERATION_STATES.FAILED_TERMINAL,
      CANONICAL_OPERATION_STATES.AMBIGUOUS
    ])
  ],
  [
    CANONICAL_OPERATION_STATES.AWAITING_CREDENTIAL,
    new Set([
      CANONICAL_OPERATION_STATES.SUBMITTING,
      CANONICAL_OPERATION_STATES.PARTIALLY_SUBMITTED,
      CANONICAL_OPERATION_STATES.SUBMITTED,
      CANONICAL_OPERATION_STATES.MONITORING,
      CANONICAL_OPERATION_STATES.MONITORING_DEGRADED,
      CANONICAL_OPERATION_STATES.RECONCILING,
      CANONICAL_OPERATION_STATES.CANCEL_REQUESTED,
      CANONICAL_OPERATION_STATES.AMBIGUOUS
    ])
  ],
  [
    CANONICAL_OPERATION_STATES.CANCEL_REQUESTED,
    new Set([
      CANONICAL_OPERATION_STATES.CANCELED,
      CANONICAL_OPERATION_STATES.RECONCILING,
      CANONICAL_OPERATION_STATES.MONITORING,
      CANONICAL_OPERATION_STATES.MONITORING_DEGRADED,
      CANONICAL_OPERATION_STATES.AMBIGUOUS
    ])
  ],
  [
    CANONICAL_OPERATION_STATES.RECONCILING,
    new Set([
      CANONICAL_OPERATION_STATES.SUBMITTING,
      CANONICAL_OPERATION_STATES.PARTIALLY_SUBMITTED,
      CANONICAL_OPERATION_STATES.SUBMITTED,
      CANONICAL_OPERATION_STATES.MONITORING,
      CANONICAL_OPERATION_STATES.MONITORING_DEGRADED,
      CANONICAL_OPERATION_STATES.AWAITING_CREDENTIAL,
      CANONICAL_OPERATION_STATES.CANCEL_REQUESTED,
      CANONICAL_OPERATION_STATES.COMPLETED,
      CANONICAL_OPERATION_STATES.PARTIALLY_COMPLETED,
      CANONICAL_OPERATION_STATES.CANCELED,
      CANONICAL_OPERATION_STATES.FAILED_TERMINAL,
      CANONICAL_OPERATION_STATES.AMBIGUOUS
    ])
  ],
  [CANONICAL_OPERATION_STATES.COMPLETED, new Set()],
  [CANONICAL_OPERATION_STATES.PARTIALLY_COMPLETED, new Set()],
  [CANONICAL_OPERATION_STATES.CANCELED, new Set()],
  [CANONICAL_OPERATION_STATES.FAILED_TERMINAL, new Set()],
  [
    CANONICAL_OPERATION_STATES.AMBIGUOUS,
    new Set([
      CANONICAL_OPERATION_STATES.RECONCILING,
      CANONICAL_OPERATION_STATES.CANCELED,
      CANONICAL_OPERATION_STATES.FAILED_TERMINAL
    ])
  ]
]);

const ATTENTION_OPERATION_STATES = new Set([
  CANONICAL_OPERATION_STATES.AMBIGUOUS,
  CANONICAL_OPERATION_STATES.MONITORING_DEGRADED,
  CANONICAL_OPERATION_STATES.AWAITING_CREDENTIAL,
  CANONICAL_OPERATION_STATES.RECONCILING,
  CANONICAL_OPERATION_STATES.CANCEL_REQUESTED
]);

const TERMINAL_OPERATION_STATES = new Set([
  CANONICAL_OPERATION_STATES.COMPLETED,
  CANONICAL_OPERATION_STATES.PARTIALLY_COMPLETED,
  CANONICAL_OPERATION_STATES.CANCELED,
  CANONICAL_OPERATION_STATES.FAILED_TERMINAL
]);

const STATE_LABELS = new Map([
  [CANONICAL_OPERATION_STATES.PREPARING, "Preparing"],
  [CANONICAL_OPERATION_STATES.SUBMITTING, "Submitting"],
  [CANONICAL_OPERATION_STATES.PARTIALLY_SUBMITTED, "Partially submitted"],
  [CANONICAL_OPERATION_STATES.SUBMITTED, "Submitted"],
  [CANONICAL_OPERATION_STATES.MONITORING, "Monitoring"],
  [CANONICAL_OPERATION_STATES.MONITORING_DEGRADED, "Monitoring degraded"],
  [CANONICAL_OPERATION_STATES.AWAITING_CREDENTIAL, "Credentials required"],
  [CANONICAL_OPERATION_STATES.CANCEL_REQUESTED, "Cancellation requested"],
  [CANONICAL_OPERATION_STATES.RECONCILING, "Reconciling"],
  [CANONICAL_OPERATION_STATES.COMPLETED, "Completed"],
  [CANONICAL_OPERATION_STATES.PARTIALLY_COMPLETED, "Partially completed"],
  [CANONICAL_OPERATION_STATES.CANCELED, "Canceled"],
  [CANONICAL_OPERATION_STATES.FAILED_TERMINAL, "Failed"],
  [CANONICAL_OPERATION_STATES.AMBIGUOUS, "Submission unknown"]
]);

function isPlainObject(value) {
  return Object.prototype.toString.call(value) === "[object Object]";
}

function canonicalize(value) {
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

function normalizeStateKey(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
}

export function normalizeProviderBatchState(value) {
  if (!value) return null;
  const key = normalizeStateKey(value);
  return OPERATION_STATE_ALIASES[key] ?? key.replace(/_/g, "-");
}

export function providerBatchStateLabel(value) {
  const state = normalizeProviderBatchState(value);
  return STATE_LABELS.get(state) ?? (state ? state.replace(/-/g, " ") : "Unknown");
}

export function providerBatchStateTransition(fromState, toState) {
  const from = normalizeProviderBatchState(fromState) ?? CANONICAL_OPERATION_STATES.PREPARING;
  const to = normalizeProviderBatchState(toState);
  if (!to) {
    const error = new Error("Provider batch state transition target is required.");
    error.code = "ILLEGAL_PROVIDER_BATCH_TRANSITION";
    error.from = from;
    error.to = to;
    throw error;
  }
  if (from === to) return to;
  const allowed = LEGAL_OPERATION_TRANSITIONS.get(from);
  if (allowed && allowed.size > 0 && !allowed.has(to)) {
    const error = new Error(`Illegal provider batch state transition from ${from} to ${to}.`);
    error.code = "ILLEGAL_PROVIDER_BATCH_TRANSITION";
    error.from = from;
    error.to = to;
    throw error;
  }
  return to;
}

export function providerBatchOperationState(operation) {
  return normalizeProviderBatchState(
    operation?.state ??
      operation?.operationState ??
      operation?.providerBatch?.state ??
      operation?.providerBatch?.operationState ??
      operation?.status ??
      operation?.providerBatch?.submissionState ??
      operation?.providerBatch?.monitoringState
  );
}

async function sha256Hex(text) {
  const data = new TextEncoder().encode(text);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function providerBatchRequestKey(body = {}) {
  const records = Array.isArray(body.records)
    ? [...body.records]
        .map((record) => ({
          id: record.id,
          displayName: record.displayName ?? null,
          normalized: record.normalized ?? null,
          validation: record.validation ?? null
        }))
        .sort((left, right) => String(left.id).localeCompare(String(right.id)))
    : [];
  const fingerprint = canonicalJson({
    projectId: body.projectId ?? null,
    provider: body.provider ?? null,
    model: body.model ?? null,
    template: {
      name: body.template?.name ?? null,
      content: body.template?.content ?? null
    },
    researchEnabled: Boolean(body.researchEnabled),
    researchDepth: Number.isFinite(Number(body.researchDepth)) ? Number(body.researchDepth) : null,
    options: {
      ollamaHost: body.options?.ollamaHost ?? null,
      confirmedCustomOllamaHost: Boolean(body.options?.confirmedCustomOllamaHost),
      customBaseUrl: body.options?.customBaseUrl ?? null,
      confirmedCustomProviderHost: Boolean(body.options?.confirmedCustomProviderHost),
      httpReferer: body.options?.httpReferer ?? null
    },
    records
  });
  return `pb_${(await sha256Hex(fingerprint)).slice(0, 32)}`;
}

export function providerBatchChunkId(index) {
  return `chunk_${index + 1}`;
}

export function providerBatchOperationStatusLabel(status) {
  return providerBatchStateLabel(status);
}

export function isTerminalProviderBatchOperation(operation) {
  return TERMINAL_OPERATION_STATES.has(providerBatchOperationState(operation));
}

export function providerBatchOperationNeedsAttention(operation) {
  return ATTENTION_OPERATION_STATES.has(providerBatchOperationState(operation));
}

export function providerBatchOperationCanRetry(operation) {
  if (!operation || !isTerminalProviderBatchOperation(operation)) return false;
  const chunks = Array.isArray(operation.providerBatch?.chunks) ? operation.providerBatch.chunks : [];
  return chunks.every((chunk) => {
    const state = normalizeProviderBatchState(
      chunk?.state ?? chunk?.operationState ?? chunk?.submissionState ?? chunk?.providerStatus
    );
    return !chunk?.providerBatchId && state !== CANONICAL_OPERATION_STATES.AMBIGUOUS;
  });
}

function chunkTerminalState(chunk) {
  const state = normalizeProviderBatchState(
    chunk?.state ?? chunk?.operationState ?? chunk?.submissionState ?? chunk?.providerStatus
  );
  if (state === CANONICAL_OPERATION_STATES.COMPLETED) return CANONICAL_OPERATION_STATES.COMPLETED;
  if (state === CANONICAL_OPERATION_STATES.PARTIALLY_COMPLETED)
    return CANONICAL_OPERATION_STATES.PARTIALLY_COMPLETED;
  if (state === CANONICAL_OPERATION_STATES.CANCELED) return CANONICAL_OPERATION_STATES.CANCELED;
  if (state === CANONICAL_OPERATION_STATES.FAILED_TERMINAL) return CANONICAL_OPERATION_STATES.FAILED_TERMINAL;
  if (normalizeProviderBatchState(chunk?.providerStatus) === CANONICAL_OPERATION_STATES.COMPLETED)
    return CANONICAL_OPERATION_STATES.COMPLETED;
  if (["expired", "failed"].includes(normalizeStateKey(chunk?.providerStatus)))
    return CANONICAL_OPERATION_STATES.FAILED_TERMINAL;
  if (["cancelled", "canceled", "stopped"].includes(normalizeStateKey(chunk?.providerStatus)))
    return CANONICAL_OPERATION_STATES.CANCELED;
  return state;
}

export function providerBatchChunkCounts(operation) {
  const chunks = Array.isArray(operation?.providerBatch?.chunks) ? operation.providerBatch.chunks : [];
  return chunks.reduce(
    (accumulator, chunk) => {
      const submissionState = normalizeProviderBatchState(
        chunk?.state ?? chunk?.operationState ?? chunk?.submissionState
      );
      const providerStatus = normalizeProviderBatchState(chunk?.providerStatus);
      if (chunk?.providerBatchId) accumulator.accepted += 1;
      if (
        submissionState === CANONICAL_OPERATION_STATES.COMPLETED ||
        providerStatus === CANONICAL_OPERATION_STATES.COMPLETED ||
        chunkTerminalState(chunk) === CANONICAL_OPERATION_STATES.COMPLETED
      ) {
        accumulator.completed += 1;
      } else if (
        submissionState === CANONICAL_OPERATION_STATES.CANCELED ||
        providerStatus === CANONICAL_OPERATION_STATES.CANCELED ||
        chunkTerminalState(chunk) === CANONICAL_OPERATION_STATES.CANCELED
      ) {
        accumulator.stopped += 1;
      } else if (submissionState === CANONICAL_OPERATION_STATES.AMBIGUOUS) {
        accumulator.submissionUnknown += 1;
      } else if (
        submissionState === CANONICAL_OPERATION_STATES.RECONCILING ||
        providerStatus === CANONICAL_OPERATION_STATES.RECONCILING
      ) {
        accumulator.reconciling += 1;
      } else if (
        submissionState === CANONICAL_OPERATION_STATES.AWAITING_CREDENTIAL ||
        providerStatus === CANONICAL_OPERATION_STATES.AWAITING_CREDENTIAL
      ) {
        accumulator.awaitingCredential += 1;
      } else if (
        submissionState === CANONICAL_OPERATION_STATES.CANCEL_REQUESTED ||
        providerStatus === CANONICAL_OPERATION_STATES.CANCEL_REQUESTED
      ) {
        accumulator.cancelRequested += 1;
      } else if (
        submissionState === CANONICAL_OPERATION_STATES.MONITORING_DEGRADED ||
        providerStatus === CANONICAL_OPERATION_STATES.MONITORING_DEGRADED
      ) {
        accumulator.monitoringDegraded += 1;
      } else if (
        submissionState === CANONICAL_OPERATION_STATES.FAILED_TERMINAL ||
        providerStatus === CANONICAL_OPERATION_STATES.FAILED_TERMINAL ||
        normalizeStateKey(chunk?.providerStatus) === "expired"
      ) {
        accumulator.failed += 1;
      } else {
        accumulator.pending += 1;
      }
      return accumulator;
    },
    {
      total: chunks.length,
      accepted: 0,
      completed: 0,
      failed: 0,
      stopped: 0,
      pending: 0,
      submissionUnknown: 0,
      reconciling: 0,
      awaitingCredential: 0,
      cancelRequested: 0,
      monitoringDegraded: 0
    }
  );
}

function anyChunkPolled(chunks) {
  return chunks.some((chunk) => Boolean(chunk?.polledAt || chunk?.lastPolledAt));
}

function deriveProviderBatchState(operation, counts, chunks) {
  const explicit = providerBatchOperationState(operation);
  if (explicit) return explicit;
  if (counts.submissionUnknown > 0) return CANONICAL_OPERATION_STATES.AMBIGUOUS;
  if (counts.awaitingCredential > 0) return CANONICAL_OPERATION_STATES.AWAITING_CREDENTIAL;
  if (counts.reconciling > 0) return CANONICAL_OPERATION_STATES.RECONCILING;
  if (counts.cancelRequested > 0) return CANONICAL_OPERATION_STATES.CANCEL_REQUESTED;
  if (counts.monitoringDegraded > 0) return CANONICAL_OPERATION_STATES.MONITORING_DEGRADED;
  if (counts.completed > 0 && counts.failed > 0 && counts.pending === 0 && counts.stopped === 0) {
    return CANONICAL_OPERATION_STATES.PARTIALLY_COMPLETED;
  }
  if (counts.completed > 0 && counts.pending === 0 && counts.failed === 0 && counts.stopped === 0) {
    return CANONICAL_OPERATION_STATES.COMPLETED;
  }
  if (counts.failed > 0 && counts.completed === 0 && counts.pending === 0) {
    return CANONICAL_OPERATION_STATES.FAILED_TERMINAL;
  }
  if (counts.stopped > 0 && counts.completed === 0 && counts.failed === 0 && counts.pending === 0) {
    return CANONICAL_OPERATION_STATES.CANCELED;
  }
  if (counts.accepted > 0 && counts.pending === 0 && !anyChunkPolled(chunks)) {
    return CANONICAL_OPERATION_STATES.SUBMITTED;
  }
  if (counts.accepted > 0 && counts.pending > 0 && !anyChunkPolled(chunks)) {
    return CANONICAL_OPERATION_STATES.PARTIALLY_SUBMITTED;
  }
  if (counts.accepted > 0 && counts.pending > 0 && anyChunkPolled(chunks)) {
    return CANONICAL_OPERATION_STATES.MONITORING;
  }
  if (counts.accepted > 0 && counts.pending === 0 && anyChunkPolled(chunks)) {
    return CANONICAL_OPERATION_STATES.MONITORING;
  }
  if (counts.total > 0) return CANONICAL_OPERATION_STATES.PREPARING;
  return CANONICAL_OPERATION_STATES.PREPARING;
}

export function providerBatchOperationSummary(operation) {
  const counts = providerBatchChunkCounts(operation);
  const chunks = Array.isArray(operation?.providerBatch?.chunks) ? operation.providerBatch.chunks : [];
  const anyAccepted = chunks.some((chunk) => Boolean(chunk?.providerBatchId));
  const allTerminal =
    chunks.length > 0 &&
    chunks.every((chunk) => {
      const state = normalizeProviderBatchState(
        chunk?.state ?? chunk?.operationState ?? chunk?.submissionState ?? chunk?.providerStatus
      );
      return TERMINAL_OPERATION_STATES.has(state);
    });
  const state = deriveProviderBatchState(operation, counts, chunks);
  const status =
    state === CANONICAL_OPERATION_STATES.PARTIALLY_COMPLETED
      ? "partially_failed"
      : state === CANONICAL_OPERATION_STATES.CANCELED
        ? "stopped"
        : state === CANONICAL_OPERATION_STATES.FAILED_TERMINAL
          ? "failed"
          : state === CANONICAL_OPERATION_STATES.AMBIGUOUS
            ? "submission_unknown"
            : state === CANONICAL_OPERATION_STATES.AWAITING_CREDENTIAL
              ? "credential_required"
              : state === CANONICAL_OPERATION_STATES.CANCEL_REQUESTED
                ? "stopping"
                : state === CANONICAL_OPERATION_STATES.MONITORING_DEGRADED
                  ? "monitoring_degraded"
                  : state === CANONICAL_OPERATION_STATES.PARTIALLY_SUBMITTED
                    ? "partially_submitted"
                    : state;
  const attention = providerBatchOperationNeedsAttention({ state });
  return {
    counts,
    anyAccepted,
    allTerminal,
    state,
    status,
    label: providerBatchOperationStatusLabel(state),
    attention
  };
}

const PROVIDER_BATCH_RESOLVE_RETRYABLE_ERROR_CODES = new Set([
  "HTTP_ERROR",
  "NETWORK_ERROR",
  "FETCH_ERROR",
  "OPERATION_RECONCILIATION_REQUIRED",
  "BATCH_RECONCILIATION_AMBIGUOUS",
  "PROVIDER_BATCH_RECEIPT_PERSIST_FAILED",
  "PROVIDER_BATCH_REQUEST_FAILED",
  "PROVIDER_BATCH_RESPONSE_TOO_LARGE",
  "PROVIDER_BATCH_RESPONSE_INVALID",
  "PROVIDER_TIMEOUT",
  "PROVIDER_REQUEST_FAILED",
  "PROVIDER_RESPONSE_TOO_LARGE",
  "PROVIDER_RESPONSE_INVALID"
]);

export function providerBatchProcessButtonState({
  recordCount = 0,
  hasModel = false,
  hasTemplate = false,
  busyReason = null,
  blockingReason = null
} = {}) {
  const count = Number(recordCount);
  if (!Number.isFinite(count) || count < 1) {
    return {
      disabled: true,
      reason: "Select at least one record to process."
    };
  }
  if (!hasModel) {
    return {
      disabled: true,
      reason: "Choose a compatible model before starting."
    };
  }
  if (!hasTemplate) {
    return {
      disabled: true,
      reason: "Choose or create a template before starting."
    };
  }
  if (busyReason) {
    return {
      disabled: true,
      reason: busyReason
    };
  }
  if (blockingReason) {
    return {
      disabled: true,
      reason: blockingReason
    };
  }
  return {
    disabled: false,
    reason: `Ready to process ${count.toLocaleString()} ${count === 1 ? "record" : "records"}.`
  };
}

export function providerBatchSubmitPayload({
  projectId = null,
  operationId = null,
  requestHash = null,
  clientRequestKey = null,
  resumeSubmission = false,
  records = [],
  template,
  provider,
  model,
  researchEnabled = false,
  researchDepth = 5,
  options = {}
} = {}) {
  const payload = {
    operationId: operationId ?? undefined,
    requestHash: requestHash ?? undefined,
    clientRequestKey: clientRequestKey ?? undefined,
    resumeSubmission: Boolean(resumeSubmission),
    records,
    template,
    provider,
    model,
    researchEnabled: Boolean(researchEnabled),
    researchDepth: Number.isFinite(Number(researchDepth)) ? Number(researchDepth) : 5,
    options
  };
  if (typeof projectId === "string" && projectId.trim()) {
    payload.projectId = projectId;
  }
  return payload;
}

export function providerBatchResolvePayload({
  operationId = null,
  requestHash = null,
  clientRequestKey = null
} = {}) {
  const payload = {};
  if (typeof operationId === "string" && operationId.trim()) payload.operationId = operationId;
  if (typeof requestHash === "string" && requestHash.trim()) payload.requestHash = requestHash;
  if (typeof clientRequestKey === "string" && clientRequestKey.trim()) {
    payload.clientRequestKey = clientRequestKey;
  }
  return payload;
}

export function shouldAttemptProviderBatchResolve(error) {
  const code = String(error?.code ?? "").trim().toUpperCase();
  if (Number.isFinite(Number(error?.status)) && Number(error.status) >= 500) return true;
  if (!code) return true;
  return PROVIDER_BATCH_RESOLVE_RETRYABLE_ERROR_CODES.has(code);
}
