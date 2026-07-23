import { makeId, nowIso, parseJson } from "../../utils/helpers.js";
import {
  normalizeProviderBatchState,
  providerBatchChunkId,
  providerBatchOperationStatusLabel,
  providerBatchOperationSummary,
  providerBatchStateTransition
} from "../../../public/modules/providerBatchState.js";

function chunkIndexFromId(chunkId) {
  const match = /^chunk_(\d+)$/.exec(String(chunkId ?? ""));
  return match ? Math.max(0, Number.parseInt(match[1], 10) - 1) : null;
}

function legacyStatusFromState(state) {
  const canonical = normalizeProviderBatchState(state);
  if (!canonical) return "queued";
  if (canonical === "partially-completed") return "partially_failed";
  if (canonical === "canceled") return "stopped";
  if (canonical === "failed-terminal") return "failed";
  if (canonical === "ambiguous") return "submission_unknown";
  if (canonical === "awaiting-credential") return "credential_required";
  if (canonical === "cancel-requested") return "stopping";
  if (canonical === "monitoring-degraded") return "monitoring_degraded";
  if (canonical === "partially-submitted") return "partially_submitted";
  return canonical;
}

function rowToChunk(row) {
  const state = normalizeProviderBatchState(row.state);
  return {
    chunkId: providerBatchChunkId(row.chunk_ordinal),
    index: row.chunk_ordinal,
    requestHash: row.request_hash,
    state,
    submissionState: legacyStatusFromState(state),
    providerBatchId: row.provider_batch_id ?? null,
    providerFileId: row.provider_file_id ?? null,
    inputFileId: row.provider_file_id ?? null,
    providerRequestId: row.provider_request_id ?? null,
    providerStatus: row.provider_status ?? null,
    reconciliationKey: row.reconciliation_key ?? null,
    reconciliationName: row.reconciliation_name ?? null,
    reconciliationMetadata: parseJson(row.reconciliation_metadata_json, null),
    lastErrorClass: row.last_error_class ?? null,
    attempts: Number.isInteger(row.attempts) ? row.attempts : 0,
    requestIntentAt: row.request_intent_at ?? null,
    receiptAt: row.receipt_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function groupRows(rows) {
  const groups = new Map();
  for (const row of rows) {
    const current = groups.get(row.operation_id) ?? [];
    current.push(row);
    groups.set(row.operation_id, current);
  }
  return groups;
}

function aggregateRows(rows) {
  if (!rows.length) return null;
  const sortedRows = [...rows].sort((left, right) => left.chunk_ordinal - right.chunk_ordinal);
  const chunks = sortedRows.map(rowToChunk);
  const rowStates = sortedRows
    .map((row) => normalizeProviderBatchState(row.state ?? row.submission_state ?? row.provider_status))
    .filter(Boolean);
  const explicitState =
    rowStates.length > 0 && rowStates.every((state) => state === rowStates[0]) ? rowStates[0] : null;
  const summary = providerBatchOperationSummary({
    state: explicitState,
    providerBatch: { chunks }
  });
  const createdAt = sortedRows.reduce(
    (earliest, row) => (row.created_at < earliest ? row.created_at : earliest),
    sortedRows[0].created_at
  );
  const updatedAt = sortedRows.reduce(
    (latest, row) => (row.updated_at > latest ? row.updated_at : latest),
    sortedRows[0].updated_at
  );
  const requestHash = sortedRows[0].request_hash;
  const providerId = sortedRows[0].provider_id;
  const modelId = sortedRows[0].model_id;
  const operationType = sortedRows[0].operation_type;
  const lastErrorClass =
    [...sortedRows].reverse().find((row) => row.last_error_class)?.last_error_class ?? null;

  return {
    id: sortedRows[0].operation_id,
    operationId: sortedRows[0].operation_id,
    requestHash,
    clientRequestKey: requestHash,
    executionMode: "provider-batch",
    operationType,
    status: summary.status,
    state: summary.state,
    options: {
      provider: providerId,
      model: modelId,
      operationType,
      requestHash
    },
    counts: {
      ...summary.counts,
      running: summary.counts.pending,
      remaining: summary.counts.pending
    },
    providerBatch: {
      operationId: sortedRows[0].operation_id,
      requestHash,
      operationType,
      provider: providerId,
      model: modelId,
      state: summary.state,
      status: summary.status,
      chunks,
      createdAt,
      updatedAt
    },
    cancelRequested: summary.state === "cancel-requested",
    error: lastErrorClass
      ? {
          code: lastErrorClass,
          message: providerBatchOperationStatusLabel(summary.state)
        }
      : null,
    createdAt,
    updatedAt
  };
}

function loadRows(db, where = "", params = []) {
  return db
    .prepare(`SELECT * FROM provider_batch_ledger ${where} ORDER BY operation_id ASC, chunk_ordinal ASC`)
    .all(...params);
}

function rowWhere({ requestHash = null, activeOnly = false } = {}) {
  const clauses = [];
  const params = [];
  if (requestHash) {
    clauses.push("request_hash = ?");
    params.push(requestHash);
  }
  if (activeOnly) {
    clauses.push("state NOT IN ('completed', 'partially-completed', 'canceled', 'failed-terminal')");
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  return { where, params };
}

function upsertChunk(db, row) {
  db.prepare(
    `INSERT INTO provider_batch_ledger (
      operation_id,
      chunk_ordinal,
      request_hash,
      operation_type,
      provider_id,
      model_id,
      provider_batch_id,
      provider_file_id,
      provider_request_id,
      reconciliation_key,
      reconciliation_name,
      reconciliation_metadata_json,
      state,
      provider_status,
      last_error_class,
      attempts,
      request_intent_at,
      receipt_at,
      created_at,
      updated_at
    ) VALUES (
      @operationId,
      @chunkOrdinal,
      @requestHash,
      @operationType,
      @providerId,
      @modelId,
      @providerBatchId,
      @providerFileId,
      @providerRequestId,
      @reconciliationKey,
      @reconciliationName,
      @reconciliationMetadataJson,
      @state,
      @providerStatus,
      @lastErrorClass,
      @attempts,
      @requestIntentAt,
      @receiptAt,
      @createdAt,
      @updatedAt
    )
    ON CONFLICT(operation_id, chunk_ordinal) DO UPDATE SET
      request_hash = excluded.request_hash,
      operation_type = excluded.operation_type,
      provider_id = excluded.provider_id,
      model_id = excluded.model_id,
      provider_batch_id = excluded.provider_batch_id,
      provider_file_id = excluded.provider_file_id,
      provider_request_id = excluded.provider_request_id,
      reconciliation_key = excluded.reconciliation_key,
      reconciliation_name = excluded.reconciliation_name,
      reconciliation_metadata_json = excluded.reconciliation_metadata_json,
      state = excluded.state,
      provider_status = excluded.provider_status,
      last_error_class = excluded.last_error_class,
      attempts = excluded.attempts,
      request_intent_at = excluded.request_intent_at,
      receipt_at = excluded.receipt_at,
      updated_at = excluded.updated_at`
  ).run(row);
}

function currentOperationRows(db, operationId) {
  return db
    .prepare("SELECT * FROM provider_batch_ledger WHERE operation_id = ? ORDER BY chunk_ordinal ASC")
    .all(operationId);
}

function requestHashConflict(existingRows, requestHash) {
  if (!existingRows.length) return null;
  const existingHash = existingRows[0].request_hash;
  if (existingHash === requestHash) return null;
  const error = new Error("Provider batch operation ID already belongs to a different request hash.");
  error.code = "PROVIDER_BATCH_REQUEST_HASH_CONFLICT";
  error.status = 409;
  error.requestHash = requestHash;
  error.existingRequestHash = existingHash;
  return error;
}

function isSqliteConstraintError(error) {
  return String(error?.code ?? "").startsWith("SQLITE_CONSTRAINT");
}

export function createProviderBatchRepository(db) {
  const txUpsert = db.transaction((rows) => {
    for (const row of rows) upsertChunk(db, row);
  });

  function createChunkRows(operation, { now = nowIso(), state = null } = {}) {
    const requestHash = operation.requestHash ?? operation.clientRequestKey ?? null;
    if (!requestHash) {
      const error = new Error("Provider batch request hash is required.");
      error.code = "PROVIDER_BATCH_REQUEST_HASH_REQUIRED";
      error.status = 400;
      throw error;
    }
    const provider =
      operation.provider ?? operation.options?.provider ?? operation.providerBatch?.provider ?? null;
    const model = operation.model ?? operation.options?.model ?? operation.providerBatch?.model ?? null;
    const operationType = operation.operationType ?? "provider-batch";
    const chunks = Array.isArray(operation.providerBatch?.chunks) ? operation.providerBatch.chunks : [];
    const nextState = normalizeProviderBatchState(
      state ?? operation.state ?? operation.status ?? "preparing"
    );
    const chunkRows = chunks.map((chunk, index) => {
      const chunkState = normalizeProviderBatchState(
        chunk?.state ?? chunk?.operationState ?? chunk?.submissionState ?? nextState
      );
      const reconciliationMetadata = chunk?.reconciliationMetadata ?? {
        operationId: operation.id ?? operation.operationId ?? null,
        chunkOrdinal: index,
        requestHash
      };
      return {
        operationId: operation.id ?? operation.operationId ?? makeId("operation"),
        chunkOrdinal: Number.isInteger(chunk?.index) ? chunk.index : index,
        requestHash,
        operationType,
        providerId: provider,
        modelId: model,
        providerBatchId: chunk?.providerBatchId ?? null,
        providerFileId: chunk?.providerFileId ?? chunk?.inputFileId ?? null,
        providerRequestId: chunk?.providerRequestId ?? null,
        reconciliationKey:
          chunk?.reconciliationKey ?? `${operation.id ?? operation.operationId ?? "operation"}:${index}`,
        reconciliationName:
          chunk?.reconciliationName ?? `${provider ?? "provider"}:${model ?? "model"}:${index}`,
        reconciliationMetadataJson: JSON.stringify(reconciliationMetadata),
        state: chunkState,
        providerStatus: chunk?.providerStatus ?? null,
        lastErrorClass: chunk?.lastErrorClass ?? chunk?.error?.code ?? null,
        attempts: Number.isInteger(chunk?.attempts) ? chunk.attempts : 0,
        requestIntentAt: chunk?.requestIntentAt ?? now,
        receiptAt: chunk?.receiptAt ?? chunk?.acceptedAt ?? null,
        createdAt: chunk?.createdAt ?? now,
        updatedAt: chunk?.updatedAt ?? now
      };
    });

    if (!chunkRows.length) {
      chunkRows.push({
        operationId: operation.id ?? operation.operationId ?? makeId("operation"),
        chunkOrdinal: 0,
        requestHash,
        operationType,
        providerId: provider,
        modelId: model,
        providerBatchId: null,
        providerFileId: null,
        providerRequestId: null,
        reconciliationKey: `${operation.id ?? operation.operationId ?? "operation"}:0`,
        reconciliationName: `${provider ?? "provider"}:${model ?? "model"}:0`,
        reconciliationMetadataJson: JSON.stringify({
          operationId: operation.id ?? operation.operationId ?? null,
          chunkOrdinal: 0,
          requestHash
        }),
        state: nextState,
        providerStatus: null,
        lastErrorClass: null,
        attempts: 0,
        requestIntentAt: now,
        receiptAt: null,
        createdAt: now,
        updatedAt: now
      });
    }

    return chunkRows;
  }

  return {
    get(id) {
      const rows = currentOperationRows(db, id);
      return aggregateRows(rows);
    },

    getByClientRequestKey(clientRequestKey) {
      if (!clientRequestKey) return null;
      const { where, params } = rowWhere({ requestHash: clientRequestKey });
      const rows = loadRows(db, where, params);
      const grouped = groupRows(rows);
      const first = grouped.values().next().value ?? [];
      return aggregateRows(first);
    },

    getActiveByClientRequestKey(clientRequestKey) {
      if (!clientRequestKey) return null;
      const { where, params } = rowWhere({ requestHash: clientRequestKey, activeOnly: true });
      const rows = loadRows(db, where, params);
      const grouped = groupRows(rows);
      const first = grouped.values().next().value ?? [];
      return aggregateRows(first);
    },

    list(limit = 50, { projectId = null, activeOnly = false } = {}) {
      void projectId;
      const { where, params } = rowWhere({ activeOnly });
      const rows = loadRows(db, where, params);
      const operations = [];
      for (const groupedRows of groupRows(rows).values()) {
        operations.push(aggregateRows(groupedRows));
      }
      return operations.slice(0, limit);
    },

    listAll({ projectId = null, activeOnly = false } = {}) {
      return this.list(10_000, { projectId, activeOnly });
    },

    create(operation = {}) {
      const requestHash = operation.requestHash ?? operation.clientRequestKey ?? null;
      const operationId = operation.id ?? operation.operationId ?? makeId("operation");
      const existingRows = currentOperationRows(db, operationId);
      const conflict = requestHashConflict(existingRows, requestHash);
      if (conflict) throw conflict;
      const existingByHash = this.getByClientRequestKey(requestHash);
      if (existingByHash) return existingByHash;

      const rows = createChunkRows({
        ...operation,
        id: operationId,
        operationId,
        requestHash,
        clientRequestKey: requestHash
      });
      try {
        txUpsert(rows);
      } catch (error) {
        if (isSqliteConstraintError(error)) {
          const existing = this.getByClientRequestKey(requestHash);
          if (existing) return existing;
          const currentRows = currentOperationRows(db, operationId);
          const retryConflict = requestHashConflict(currentRows, requestHash);
          if (retryConflict) throw retryConflict;
        }
        throw error;
      }
      return this.get(operationId);
    },

    update(id, patch = {}) {
      const current = this.get(id);
      if (!current) return null;
      const requestHash = patch.requestHash ?? patch.clientRequestKey ?? current.requestHash;
      if (requestHash && requestHash !== current.requestHash) {
        const error = new Error("Provider batch request hash changed for an existing operation.");
        error.code = "PROVIDER_BATCH_REQUEST_HASH_CONFLICT";
        error.status = 409;
        throw error;
      }
      const currentRows = currentOperationRows(db, id);
      const nextChunks = Array.isArray(patch.providerBatch?.chunks)
        ? patch.providerBatch.chunks.map((chunk, index) => ({
            ...chunk,
            index: Number.isInteger(chunk?.index) ? chunk.index : index
          }))
        : (current.providerBatch?.chunks ?? []);
      const nextState = providerBatchStateTransition(
        current.state ?? current.status,
        patch.state ?? patch.status ?? current.state ?? current.status
      );
      const nextOperationType = patch.operationType ?? current.operationType ?? "provider-batch";
      const nextProvider =
        patch.provider ??
        patch.options?.provider ??
        current.options?.provider ??
        current.providerBatch?.provider;
      const nextModel =
        patch.model ?? patch.options?.model ?? current.options?.model ?? current.providerBatch?.model;
      const now = nowIso();
      const rows = nextChunks.map((chunk, index) => {
        const existing = currentRows.find((row) => row.chunk_ordinal === index) ?? null;
        const chunkState = normalizeProviderBatchState(
          chunk?.state ?? chunk?.operationState ?? chunk?.submissionState ?? nextState
        );
        const requestIntentAt = chunk?.requestIntentAt ?? existing?.request_intent_at ?? now;
        const receiptAt = chunk?.receiptAt ?? chunk?.acceptedAt ?? existing?.receipt_at ?? null;
        return {
          operationId: id,
          chunkOrdinal: index,
          requestHash: requestHash ?? current.requestHash,
          operationType: nextOperationType,
          providerId: nextProvider ?? current.options?.provider ?? current.providerBatch?.provider,
          modelId: nextModel ?? current.options?.model ?? current.providerBatch?.model,
          providerBatchId: chunk?.providerBatchId ?? existing?.provider_batch_id ?? null,
          providerFileId: chunk?.providerFileId ?? chunk?.inputFileId ?? existing?.provider_file_id ?? null,
          providerRequestId: chunk?.providerRequestId ?? existing?.provider_request_id ?? null,
          reconciliationKey: chunk?.reconciliationKey ?? existing?.reconciliation_key ?? `${id}:${index}`,
          reconciliationName:
            chunk?.reconciliationName ??
            existing?.reconciliation_name ??
            `${nextProvider ?? "provider"}:${nextModel ?? "model"}:${index}`,
          reconciliationMetadataJson: JSON.stringify(
            chunk?.reconciliationMetadata ??
              parseJson(existing?.reconciliation_metadata_json, null) ?? {
                operationId: id,
                chunkOrdinal: index,
                requestHash: requestHash ?? current.requestHash
              }
          ),
          state: chunkState,
          providerStatus: chunk?.providerStatus ?? existing?.provider_status ?? null,
          lastErrorClass: chunk?.lastErrorClass ?? chunk?.error?.code ?? existing?.last_error_class ?? null,
          attempts: Number.isInteger(chunk?.attempts)
            ? chunk.attempts
            : Number.isInteger(existing?.attempts)
              ? existing.attempts
              : 0,
          requestIntentAt,
          receiptAt,
          createdAt: existing?.created_at ?? chunk?.createdAt ?? now,
          updatedAt: now
        };
      });
      txUpsert(rows);
      return this.get(id);
    },

    updateProviderBatch(id, updater) {
      const current = this.get(id);
      if (!current) return null;
      const nextProviderBatch = updater({
        ...(current.providerBatch ?? {}),
        chunks: Array.isArray(current.providerBatch?.chunks) ? current.providerBatch.chunks : []
      });
      return this.update(id, { providerBatch: nextProviderBatch });
    },

    mergeChunk(id, chunkId, patch = {}) {
      const current = this.get(id);
      if (!current) return null;
      const index = patch.index ?? chunkIndexFromId(chunkId);
      if (!Number.isInteger(index) || index < 0) {
        const error = new Error("Chunk ordinal is required.");
        error.code = "PROVIDER_BATCH_CHUNK_REQUIRED";
        error.status = 400;
        throw error;
      }
      const chunks = Array.isArray(current.providerBatch?.chunks) ? [...current.providerBatch.chunks] : [];
      const existing = chunks[index] ?? { chunkId, index };
      const nextChunk = {
        ...existing,
        ...patch,
        chunkId: chunkId ?? existing.chunkId ?? providerBatchChunkId(index),
        index
      };
      chunks[index] = nextChunk;
      return this.update(id, { providerBatch: { ...(current.providerBatch ?? {}), chunks } });
    },

    recordProviderBatchError(id, error, { status, providerBatch } = {}) {
      const current = this.get(id);
      if (!current) return null;
      return this.update(id, {
        status,
        state: normalizeProviderBatchState(status ?? current.state ?? current.status),
        error: error
          ? { code: error.code || "PROVIDER_BATCH_ERROR", message: error.message || String(error) }
          : null,
        providerBatch
      });
    },

    recordChunkIntent(id, chunkOrdinal, patch = {}) {
      const current = this.get(id);
      if (!current) return null;
      const chunks = Array.isArray(current.providerBatch?.chunks) ? [...current.providerBatch.chunks] : [];
      const existing = chunks[chunkOrdinal] ?? {
        chunkId: providerBatchChunkId(chunkOrdinal),
        index: chunkOrdinal
      };
      chunks[chunkOrdinal] = {
        ...existing,
        ...patch,
        index: chunkOrdinal,
        chunkId: patch.chunkId ?? existing.chunkId ?? providerBatchChunkId(chunkOrdinal),
        state: "submitting",
        submissionState: "submitting",
        requestIntentAt: patch.requestIntentAt ?? nowIso(),
        attempts: (existing.attempts ?? 0) + 1
      };
      return this.update(id, {
        state: patch.state ?? current.state ?? "submitting",
        providerBatch: { ...(current.providerBatch ?? {}), chunks }
      });
    },

    recordChunkReceipt(id, chunkOrdinal, patch = {}) {
      const current = this.get(id);
      if (!current) return null;
      const chunks = Array.isArray(current.providerBatch?.chunks) ? [...current.providerBatch.chunks] : [];
      const existing = chunks[chunkOrdinal] ?? {
        chunkId: providerBatchChunkId(chunkOrdinal),
        index: chunkOrdinal
      };
      const currentState = normalizeProviderBatchState(current.state ?? current.status);
      const nextChunkState = normalizeProviderBatchState(patch.state ?? existing.state ?? "submitted");
      const nextOperationState = patch.operationState
        ? normalizeProviderBatchState(patch.operationState)
        : nextChunkState === "submitted" && ["monitoring", "monitoring-degraded"].includes(currentState)
          ? currentState
          : normalizeProviderBatchState(patch.state ?? current.state ?? "submitted");
      chunks[chunkOrdinal] = {
        ...existing,
        ...patch,
        index: chunkOrdinal,
        chunkId: patch.chunkId ?? existing.chunkId ?? providerBatchChunkId(chunkOrdinal),
        state: nextChunkState,
        submissionState: patch.submissionState ?? legacyStatusFromState(nextChunkState),
        receiptAt: patch.receiptAt ?? nowIso(),
        attempts: Number.isInteger(patch.attempts) ? patch.attempts : (existing.attempts ?? 1)
      };
      return this.update(id, {
        state: nextOperationState,
        providerBatch: { ...(current.providerBatch ?? {}), chunks }
      });
    },

    findByRequestHash(requestHash) {
      return this.getByClientRequestKey(requestHash);
    },

    activeOperations({ projectId = null } = {}) {
      void projectId;
      return this.listAll({ activeOnly: true });
    },

    remove(id) {
      const current = this.get(id);
      if (!current) return null;
      db.prepare("DELETE FROM provider_batch_ledger WHERE operation_id = ?").run(id);
      return current;
    },

    getByProviderBatchId(providerBatchId) {
      if (!providerBatchId) return null;
      const row = db
        .prepare(
          "SELECT * FROM provider_batch_ledger WHERE provider_batch_id = ? ORDER BY updated_at DESC LIMIT 1"
        )
        .get(providerBatchId);
      return row ? this.get(row.operation_id) : null;
    },

    getByReconciliationKey(reconciliationKey) {
      if (!reconciliationKey) return null;
      const row = db
        .prepare(
          "SELECT * FROM provider_batch_ledger WHERE reconciliation_key = ? ORDER BY updated_at DESC LIMIT 1"
        )
        .get(reconciliationKey);
      return row ? this.get(row.operation_id) : null;
    },

    listRows() {
      return loadRows(db);
    }
  };
}
