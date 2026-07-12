CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  dataset_name TEXT NOT NULL,
  prompt_name TEXT NOT NULL,
  source_name TEXT NOT NULL,
  record_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

ALTER TABLE records ADD COLUMN project_id TEXT;
ALTER TABLE jobs ADD COLUMN project_id TEXT;
ALTER TABLE results ADD COLUMN project_id TEXT;

CREATE INDEX IF NOT EXISTS idx_records_project ON records(project_id);
CREATE INDEX IF NOT EXISTS idx_jobs_project ON jobs(project_id);
CREATE INDEX IF NOT EXISTS idx_results_project ON results(project_id);

INSERT OR IGNORE INTO projects (
  id, name, dataset_name, prompt_name, source_name, record_count, created_at, updated_at
) VALUES (
  'project_default',
  'Default Project',
  'Legacy imported data',
  'restaurant-ai-sms.txt',
  'existing storage',
  (SELECT COUNT(*) FROM records),
  datetime('now'),
  datetime('now')
);

UPDATE records SET project_id = 'project_default' WHERE project_id IS NULL;
UPDATE jobs SET project_id = 'project_default' WHERE project_id IS NULL;
UPDATE results SET project_id = 'project_default' WHERE project_id IS NULL;
