CREATE TABLE IF NOT EXISTS migrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dataset_id TEXT NOT NULL,
  source_name TEXT NOT NULL,
  record_key TEXT NOT NULL,
  display_name TEXT,
  source_row INTEGER NOT NULL,
  raw_json TEXT NOT NULL,
  normalized_json TEXT NOT NULL,
  validation_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ready',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_records_dataset ON records(dataset_id);
CREATE INDEX IF NOT EXISTS idx_records_record_key ON records(record_key);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  options_json TEXT NOT NULL,
  counts_json TEXT NOT NULL,
  cancel_requested INTEGER NOT NULL DEFAULT 0,
  error_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS results (
  id TEXT PRIMARY KEY,
  job_id TEXT,
  record_id INTEGER NOT NULL,
  template_name TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  status TEXT NOT NULL,
  subject TEXT NOT NULL DEFAULT '',
  body_html TEXT NOT NULL DEFAULT '',
  body_text TEXT NOT NULL DEFAULT '',
  email_html TEXT NOT NULL DEFAULT '',
  prompt TEXT NOT NULL DEFAULT '',
  research_json TEXT NOT NULL DEFAULT '{}',
  error_json TEXT,
  raw_ai TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  edited_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(record_id) REFERENCES records(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_results_record ON results(record_id);
CREATE INDEX IF NOT EXISTS idx_results_job ON results(job_id);
CREATE INDEX IF NOT EXISTS idx_results_status ON results(status);

CREATE TABLE IF NOT EXISTS result_versions (
  id TEXT PRIMARY KEY,
  result_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  subject TEXT NOT NULL,
  body_html TEXT NOT NULL,
  body_text TEXT NOT NULL,
  email_html TEXT NOT NULL,
  prompt TEXT NOT NULL,
  raw_ai TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(result_id) REFERENCES results(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS research_cache (
  url TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  title TEXT,
  content TEXT,
  error_json TEXT,
  fetched_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
