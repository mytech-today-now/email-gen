import fs from "node:fs";
import path from "node:path";
import { ensureDir } from "../utils/files.js";
import { nowIso } from "../utils/helpers.js";

export function runMigrations(db, config) {
  ensureDir(path.dirname(config.databasePath));
  const migrationDir = path.join(config.rootDir, "storage", "migrations");
  const files = fs
    .readdirSync(migrationDir)
    .filter((file) => file.endsWith(".sql"))
    .sort();
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(
    "CREATE TABLE IF NOT EXISTS migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, applied_at TEXT NOT NULL);"
  );

  const applied = new Set(
    db
      .prepare("SELECT name FROM migrations")
      .all()
      .map((row) => row.name)
  );
  const insert = db.prepare("INSERT INTO migrations (name, applied_at) VALUES (?, ?)");

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(migrationDir, file), "utf8");
    const apply = db.transaction(() => {
      db.exec(sql);
      insert.run(file, nowIso());
    });
    apply();
  }
}

export function recoverInterruptedWork(db) {
  const now = nowIso();
  db.prepare(
    "UPDATE jobs SET status = 'failed', error_json = ?, updated_at = ? WHERE status IN ('queued', 'running', 'stopping')"
  ).run(
    JSON.stringify({
      code: "RECOVERED_AFTER_RESTART",
      message: "Job was interrupted by application restart."
    }),
    now
  );
  db.prepare(
    "UPDATE results SET status = 'failed', error_json = ?, updated_at = ? WHERE status = 'processing'"
  ).run(
    JSON.stringify({
      code: "RECOVERED_AFTER_RESTART",
      message: "Result was marked failed after application restart."
    }),
    now
  );
}
