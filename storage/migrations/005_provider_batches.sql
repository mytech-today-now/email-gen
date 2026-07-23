ALTER TABLE jobs ADD COLUMN execution_mode TEXT NOT NULL DEFAULT 'standard';
ALTER TABLE jobs ADD COLUMN client_request_key TEXT;
ALTER TABLE jobs ADD COLUMN provider_batch_json TEXT;

UPDATE jobs SET execution_mode = COALESCE(execution_mode, 'standard');

CREATE INDEX IF NOT EXISTS idx_jobs_execution_mode ON jobs(execution_mode);
CREATE INDEX IF NOT EXISTS idx_jobs_client_request_key ON jobs(client_request_key);
CREATE INDEX IF NOT EXISTS idx_jobs_provider_batch_status ON jobs(execution_mode, status, updated_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_provider_batch_active_key
  ON jobs(client_request_key)
  WHERE execution_mode = 'provider-batch' AND client_request_key IS NOT NULL
    AND status NOT IN ('completed', 'partially_failed', 'failed', 'stopped');

