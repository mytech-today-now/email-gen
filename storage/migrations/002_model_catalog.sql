CREATE TABLE IF NOT EXISTS model_sync_runs (
  id TEXT PRIMARY KEY,
  trigger_source TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  duration_ms INTEGER,
  summary_json TEXT NOT NULL DEFAULT '{}',
  error_json TEXT
);

CREATE TABLE IF NOT EXISTS ai_models (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL,
  provider_model_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  aliases_json TEXT NOT NULL DEFAULT '[]',
  family TEXT,
  version TEXT,
  status TEXT NOT NULL,
  availability TEXT NOT NULL,
  created_at_provider TEXT,
  deprecated_at TEXT,
  retired_at TEXT,
  input_modalities_json TEXT NOT NULL DEFAULT '[]',
  output_modalities_json TEXT NOT NULL DEFAULT '[]',
  supported_data_types_json TEXT NOT NULL DEFAULT '[]',
  capabilities_json TEXT NOT NULL DEFAULT '{}',
  limits_json TEXT NOT NULL DEFAULT '{}',
  pricing_json TEXT,
  regional_availability_json TEXT,
  required_api_version TEXT,
  capability_confidence TEXT NOT NULL,
  discovery_source TEXT NOT NULL,
  metadata_source_json TEXT NOT NULL DEFAULT '{}',
  compatibility_json TEXT NOT NULL DEFAULT '{}',
  raw_provider_metadata_json TEXT,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  last_successfully_validated_at TEXT,
  last_sync_run_id TEXT,
  unavailable_since TEXT,
  exclusion_reason TEXT,
  schema_version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  UNIQUE(provider_id, provider_model_id)
);

CREATE INDEX IF NOT EXISTS idx_ai_models_provider ON ai_models(provider_id);
CREATE INDEX IF NOT EXISTS idx_ai_models_availability ON ai_models(availability);
CREATE INDEX IF NOT EXISTS idx_ai_models_compatibility ON ai_models(provider_id, availability);

CREATE TABLE IF NOT EXISTS provider_sync_status (
  provider_id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  availability TEXT NOT NULL,
  last_sync_run_id TEXT,
  last_attempt_at TEXT,
  last_success_at TEXT,
  next_sync_after TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  models_discovered INTEGER NOT NULL DEFAULT 0,
  models_accepted INTEGER NOT NULL DEFAULT 0,
  cache_state TEXT NOT NULL DEFAULT 'none',
  fallback_state TEXT NOT NULL DEFAULT 'none',
  error_json TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS provider_model_response_cache (
  provider_id TEXT PRIMARY KEY,
  response_json TEXT NOT NULL,
  normalized_models_json TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  source TEXT NOT NULL,
  schema_version INTEGER NOT NULL DEFAULT 1
);
