CREATE TABLE IF NOT EXISTS gateway_operations (
  operation_id TEXT PRIMARY KEY,
  scope_key TEXT NOT NULL,
  kind TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  status TEXT NOT NULL,
  generation INTEGER NOT NULL DEFAULT 0,
  lease_expires_at TEXT,
  response_json TEXT,
  error_json TEXT,
  provider_request_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_gateway_operations_request_fingerprint
  ON gateway_operations(request_fingerprint);

CREATE INDEX IF NOT EXISTS idx_gateway_operations_scope_key ON gateway_operations(scope_key);
CREATE INDEX IF NOT EXISTS idx_gateway_operations_status ON gateway_operations(status, updated_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_gateway_operations_active_scope
  ON gateway_operations(scope_key)
  WHERE status IN ('prepared', 'acquired', 'in-progress', 'outcome-unknown', 'reconciliation-required');
