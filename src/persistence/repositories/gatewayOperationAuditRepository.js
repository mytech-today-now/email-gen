import { createHash } from "node:crypto";
import { canonicalJson } from "../../../public/modules/operationIdentity.js";
import { makeId, nowIso, parseJson } from "../../utils/helpers.js";

const AUDIT_CHAIN_VERSION = 1;

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function sanitizeEvent(event = {}) {
  if (!isPlainObject(event)) return { value: event };
  const clone = structuredClone(event);
  delete clone.entryId;
  delete clone.entryHash;
  delete clone.eventIndex;
  delete clone.eventType;
  delete clone.eventVersion;
  delete clone.previousHash;
  delete clone.createdAt;
  return clone;
}

function hashAuditEntry({
  operationId,
  parentOperationId = null,
  eventIndex,
  previousHash = null,
  eventType,
  eventVersion = 1,
  createdAt,
  event
}) {
  return createHash("sha256")
    .update(
      canonicalJson({
        version: AUDIT_CHAIN_VERSION,
        operationId,
        parentOperationId,
        eventIndex,
        previousHash,
        eventType,
        eventVersion,
        createdAt,
        event
      })
    )
    .digest("hex");
}

function rowToAuditEntry(row) {
  if (!row) return null;
  return {
    entryId: row.entry_id,
    operationId: row.operation_id,
    parentOperationId: row.parent_operation_id ?? null,
    eventIndex: Number.isInteger(row.event_index) ? row.event_index : 0,
    eventType: row.event_type,
    eventVersion: Number.isInteger(row.event_version) ? row.event_version : 1,
    previousHash: row.previous_hash ?? null,
    entryHash: row.entry_hash,
    event: parseJson(row.event_json, null),
    createdAt: row.created_at
  };
}

export function createGatewayOperationAuditRepository(db) {
  const insert = db.prepare(`
    INSERT INTO gateway_operation_audit (
      entry_id,
      operation_id,
      parent_operation_id,
      event_index,
      event_type,
      event_version,
      previous_hash,
      entry_hash,
      event_json,
      created_at
    ) VALUES (
      @entryId,
      @operationId,
      @parentOperationId,
      @eventIndex,
      @eventType,
      @eventVersion,
      @previousHash,
      @entryHash,
      @eventJson,
      @createdAt
    )
  `);
  const tail = db.prepare(`
    SELECT event_index, entry_hash
    FROM gateway_operation_audit
    WHERE operation_id = ?
    ORDER BY event_index DESC
    LIMIT 1
  `);
  const list = db.prepare(`
    SELECT *
    FROM gateway_operation_audit
    WHERE operation_id = ?
    ORDER BY event_index ASC
  `);

  function append(operationId, event = {}) {
    if (!operationId) {
      throw Object.assign(new Error("Operation ID is required."), { code: "AUDIT_OPERATION_ID_REQUIRED" });
    }
    if (!isPlainObject(event)) {
      throw Object.assign(new Error("Audit event must be an object."), { code: "AUDIT_EVENT_INVALID" });
    }
    const createdAt = event.createdAt ?? nowIso();
    const eventVersion = Number.isInteger(event.eventVersion) ? event.eventVersion : 1;
    const eventType = String(event.eventType ?? "").trim() || "event";
    const parentOperationId = event.parentOperationId ?? null;
    const previous = tail.get(operationId);
    const eventIndex = Number.isInteger(previous?.event_index) ? previous.event_index + 1 : 0;
    const sanitizedEvent = sanitizeEvent(event);
    const entryHash = hashAuditEntry({
      operationId,
      parentOperationId,
      eventIndex,
      previousHash: previous?.entry_hash ?? null,
      eventType,
      eventVersion,
      createdAt,
      event: sanitizedEvent
    });
    const row = {
      entryId: event.entryId ?? makeId("audit"),
      operationId,
      parentOperationId,
      eventIndex,
      eventType,
      eventVersion,
      previousHash: previous?.entry_hash ?? null,
      entryHash,
      eventJson: canonicalJson(sanitizedEvent),
      createdAt
    };
    insert.run(row);
    return rowToAuditEntry({
      entry_id: row.entryId,
      operation_id: row.operationId,
      parent_operation_id: row.parentOperationId,
      event_index: row.eventIndex,
      event_type: row.eventType,
      event_version: row.eventVersion,
      previous_hash: row.previousHash,
      entry_hash: row.entryHash,
      event_json: row.eventJson,
      created_at: row.createdAt
    });
  }

  function get(operationId) {
    return list.get(operationId) ?? null;
  }

  function verify(operationId) {
    const rows = list.all(operationId).map(rowToAuditEntry);
    let previousHash = null;
    for (const [index, row] of rows.entries()) {
      if (!row) {
        return {
          ok: false,
          reason: "AUDIT_ROW_MISSING",
          entryIndex: index,
          operationId
        };
      }
      if (row.eventIndex !== index) {
        return {
          ok: false,
          reason: "AUDIT_INDEX_GAP",
          entryIndex: index,
          operationId
        };
      }
      if (row.previousHash !== previousHash) {
        return {
          ok: false,
          reason: "AUDIT_PREVIOUS_HASH_MISMATCH",
          entryIndex: index,
          operationId
        };
      }
      const expectedHash = hashAuditEntry({
        operationId: row.operationId,
        parentOperationId: row.parentOperationId,
        eventIndex: row.eventIndex,
        previousHash: row.previousHash,
        eventType: row.eventType,
        eventVersion: row.eventVersion,
        createdAt: row.createdAt,
        event: row.event
      });
      if (row.entryHash !== expectedHash) {
        return {
          ok: false,
          reason: "AUDIT_HASH_MISMATCH",
          entryIndex: index,
          operationId,
          expectedHash,
          actualHash: row.entryHash
        };
      }
      previousHash = row.entryHash;
    }
    return {
      ok: true,
      operationId,
      entryCount: rows.length,
      headHash: previousHash,
      entries: rows
    };
  }

  return {
    append,
    get,
    list(operationId) {
      return list.all(operationId).map(rowToAuditEntry);
    },
    verify
  };
}
