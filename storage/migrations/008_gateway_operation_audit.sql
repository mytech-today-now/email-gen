CREATE TABLE IF NOT EXISTS gateway_operation_audit (
  entry_id TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL,
  parent_operation_id TEXT,
  event_index INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  event_version INTEGER NOT NULL DEFAULT 1,
  previous_hash TEXT,
  entry_hash TEXT NOT NULL,
  event_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_gateway_operation_audit_operation_index
  ON gateway_operation_audit(operation_id, event_index);

CREATE UNIQUE INDEX IF NOT EXISTS idx_gateway_operation_audit_entry_hash
  ON gateway_operation_audit(entry_hash);

CREATE INDEX IF NOT EXISTS idx_gateway_operation_audit_parent_operation_id
  ON gateway_operation_audit(parent_operation_id);

CREATE INDEX IF NOT EXISTS idx_gateway_operation_audit_created_at
  ON gateway_operation_audit(created_at);
