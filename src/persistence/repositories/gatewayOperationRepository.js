import { makeId, nowIso, parseJson } from "../../utils/helpers.js";

const ACTIVE_STATUSES = new Set([
  "prepared",
  "acquired",
  "in-progress",
  "outcome-unknown",
  "reconciliation-required"
]);
const TERMINAL_STATUSES = new Set(["succeeded", "failed-safe", "cancelled"]);

function rowToOperation(row) {
  if (!row) return null;
  return {
    operationId: row.operation_id,
    scopeKey: row.scope_key,
    kind: row.kind,
    requestFingerprint: row.request_fingerprint,
    status: row.status,
    generation: Number.isInteger(row.generation) ? row.generation : 0,
    leaseExpiresAt: row.lease_expires_at ?? null,
    response: parseJson(row.response_json, null),
    error: parseJson(row.error_json, null),
    providerRequestId: row.provider_request_id ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function serializeOperation(operation = {}) {
  return {
    operationId: operation.operationId ?? makeId("operation"),
    scopeKey: operation.scopeKey,
    kind: operation.kind ?? "generate",
    requestFingerprint: operation.requestFingerprint,
    status: operation.status ?? "prepared",
    generation: Number.isInteger(operation.generation) ? operation.generation : 0,
    leaseExpiresAt: operation.leaseExpiresAt ?? null,
    responseJson: operation.response ? JSON.stringify(operation.response) : null,
    errorJson: operation.error ? JSON.stringify(operation.error) : null,
    providerRequestId: operation.providerRequestId ?? null,
    createdAt: operation.createdAt ?? nowIso(),
    updatedAt: operation.updatedAt ?? nowIso()
  };
}

export function createGatewayOperationRepository(db) {
  const insert = db.prepare(`
    INSERT INTO gateway_operations (
      operation_id,
      scope_key,
      kind,
      request_fingerprint,
      status,
      generation,
      lease_expires_at,
      response_json,
      error_json,
      provider_request_id,
      created_at,
      updated_at
    ) VALUES (
      @operationId,
      @scopeKey,
      @kind,
      @requestFingerprint,
      @status,
      @generation,
      @leaseExpiresAt,
      @responseJson,
      @errorJson,
      @providerRequestId,
      @createdAt,
      @updatedAt
    )
  `);
  const update = db.prepare(`
    UPDATE gateway_operations
    SET
      scope_key = ?,
      kind = ?,
      request_fingerprint = ?,
      status = ?,
      generation = ?,
      lease_expires_at = ?,
      response_json = ?,
      error_json = ?,
      provider_request_id = ?,
      updated_at = ?
    WHERE operation_id = ?
  `);

  return {
    get(operationId) {
      const row = db.prepare("SELECT * FROM gateway_operations WHERE operation_id = ?").get(operationId);
      return rowToOperation(row);
    },

    getByFingerprint(requestFingerprint) {
      if (!requestFingerprint) return null;
      const row = db
        .prepare("SELECT * FROM gateway_operations WHERE request_fingerprint = ? LIMIT 1")
        .get(requestFingerprint);
      return rowToOperation(row);
    },

    getActiveByScopeKey(scopeKey) {
      if (!scopeKey) return null;
      const row = db
        .prepare(
          `SELECT * FROM gateway_operations
           WHERE scope_key = ?
             AND status IN ('prepared', 'acquired', 'in-progress', 'outcome-unknown', 'reconciliation-required')
           ORDER BY updated_at DESC, created_at DESC
           LIMIT 1`
        )
        .get(scopeKey);
      return rowToOperation(row);
    },

    create(operation) {
      const next = serializeOperation(operation);
      insert.run(next);
      return this.get(next.operationId);
    },

    update(operationId, patch = {}) {
      const current = this.get(operationId);
      if (!current) return null;
      const next = {
        ...current,
        ...patch,
        leaseExpiresAt: patch.leaseExpiresAt === undefined ? current.leaseExpiresAt : patch.leaseExpiresAt,
        response: patch.response === undefined ? current.response : patch.response,
        error: patch.error === undefined ? current.error : patch.error,
        providerRequestId:
          patch.providerRequestId === undefined ? current.providerRequestId : patch.providerRequestId,
        generation: Number.isInteger(patch.generation) ? patch.generation : current.generation,
        updatedAt: nowIso()
      };
      update.run(
        next.scopeKey,
        next.kind,
        next.requestFingerprint,
        next.status,
        next.generation,
        next.leaseExpiresAt,
        next.response ? JSON.stringify(next.response) : null,
        next.error ? JSON.stringify(next.error) : null,
        next.providerRequestId ?? null,
        next.updatedAt,
        operationId
      );
      return this.get(operationId);
    },

    resolve(operationId, { status, response = null, error = null, providerRequestId = null } = {}) {
      const current = this.get(operationId);
      if (!current) return null;
      return this.update(operationId, {
        status,
        response,
        error,
        providerRequestId,
        leaseExpiresAt: null
      });
    },

    markActive(operationId, patch = {}) {
      const current = this.get(operationId);
      if (!current) return null;
      return this.update(operationId, {
        ...patch,
        status: patch.status ?? current.status,
        generation: Number.isInteger(patch.generation) ? patch.generation : current.generation
      });
    },

    activeStatuses: ACTIVE_STATUSES,
    terminalStatuses: TERMINAL_STATUSES
  };
}
