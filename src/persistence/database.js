import Database from "better-sqlite3";
import { runMigrations, recoverInterruptedWork } from "./migrations.js";

export function createDatabase(config) {
  const db = new Database(config.databasePath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  runMigrations(db, config);
  recoverInterruptedWork(db);
  return db;
}

export function closeDatabase(db) {
  if (db?.open) db.close();
}
