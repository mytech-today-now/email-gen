CREATE TABLE IF NOT EXISTS provider_batch_ledger (
  operation_id TEXT NOT NULL,
  chunk_ordinal INTEGER NOT NULL DEFAULT 0,
  request_hash TEXT NOT NULL,
  operation_type TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  provider_batch_id TEXT,
  provider_file_id TEXT,
  provider_request_id TEXT,
  reconciliation_key TEXT,
  reconciliation_name TEXT,
  reconciliation_metadata_json TEXT,
  state TEXT NOT NULL,
  provider_status TEXT,
  last_error_class TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  request_intent_at TEXT,
  receipt_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (operation_id, chunk_ordinal)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_provider_batch_ledger_request_hash
  ON provider_batch_ledger(request_hash, provider_id, model_id, chunk_ordinal);

CREATE INDEX IF NOT EXISTS idx_provider_batch_ledger_state ON provider_batch_ledger(state, updated_at);
CREATE INDEX IF NOT EXISTS idx_provider_batch_ledger_provider_batch_id ON provider_batch_ledger(provider_batch_id);
CREATE INDEX IF NOT EXISTS idx_provider_batch_ledger_provider_file_id ON provider_batch_ledger(provider_file_id);
CREATE INDEX IF NOT EXISTS idx_provider_batch_ledger_provider_request_id ON provider_batch_ledger(provider_request_id);
CREATE INDEX IF NOT EXISTS idx_provider_batch_ledger_operation_type ON provider_batch_ledger(operation_type, updated_at);
