import fs from "node:fs";
import path from "node:path";
import { ensureDir } from "../utils/files.js";
import { nowIso, parseJson } from "../utils/helpers.js";
import { providerBatchOperationSummary } from "../../public/modules/providerBatchState.js";

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
    "UPDATE jobs SET status = 'failed', error_json = ?, updated_at = ? WHERE COALESCE(execution_mode, 'standard') <> 'provider-batch' AND status IN ('queued', 'running', 'stopping')"
  ).run(
    JSON.stringify({
      code: "RECOVERED_AFTER_RESTART",
      message: "Job was interrupted by application restart."
    }),
    now
  );
  const providerRows = db
    .prepare(
      "SELECT id, status, provider_batch_json FROM jobs WHERE execution_mode = 'provider-batch' AND status IN ('queued', 'submitting', 'running', 'stopping', 'monitoring', 'monitoring_degraded', 'credential_required', 'reconciling', 'partially_submitted', 'submission_unknown', 'submitted')"
    )
    .all();
  const updateProvider = db.prepare(
    "UPDATE jobs SET status = ?, counts_json = ?, error_json = ?, provider_batch_json = ?, updated_at = ? WHERE id = ?"
  );
  for (const row of providerRows) {
    const providerBatch = parseJson(row.provider_batch_json, {}) ?? {};
    const chunks = Array.isArray(providerBatch.chunks) ? providerBatch.chunks : [];
    const counts = providerBatchOperationSummary({ providerBatch }).counts;
    const anyAccepted = chunks.some((chunk) => Boolean(chunk?.providerBatchId));
    const nextStatus = anyAccepted ? "monitoring_degraded" : "submission_unknown";
    const nextProviderBatch = {
      ...providerBatch,
      monitoringState: anyAccepted ? "monitoring_degraded" : "reconciling",
      submissionState: anyAccepted ? "partially_submitted" : "submission_unknown",
      recoveredAt: now
    };
    updateProvider.run(
      nextStatus,
      JSON.stringify({
        total: counts.total,
        accepted: counts.accepted,
        pending: counts.pending,
        completed: counts.completed,
        failed: counts.failed,
        stopped: counts.stopped,
        submissionUnknown: counts.submissionUnknown,
        reconciling: counts.reconciling,
        running: counts.pending,
        remaining: counts.pending
      }),
      JSON.stringify({
        code: "RECOVERED_AFTER_RESTART",
        message: anyAccepted
          ? "Provider batch monitoring will resume after restart."
          : "Provider batch submission must be reconciled after restart."
      }),
      JSON.stringify(nextProviderBatch),
      now,
      row.id
    );
  }

  const ledgerRows = db
    .prepare(
      "SELECT * FROM provider_batch_ledger WHERE state NOT IN ('completed', 'partially-completed', 'canceled', 'failed-terminal') ORDER BY operation_id ASC, chunk_ordinal ASC"
    )
    .all();
  const ledgerGroups = new Map();
  for (const row of ledgerRows) {
    const group = ledgerGroups.get(row.operation_id) ?? [];
    group.push(row);
    ledgerGroups.set(row.operation_id, group);
  }
  const updateLedger = db.prepare(
    "UPDATE provider_batch_ledger SET state = ?, provider_status = COALESCE(provider_status, ?), last_error_class = ?, updated_at = ? WHERE operation_id = ?"
  );
  for (const [operationId, rows] of ledgerGroups) {
    const nextState = rows.some(
      (row) => row.provider_batch_id || row.provider_file_id || row.provider_request_id
    )
      ? "awaiting-credential"
      : "ambiguous";
    const nextProviderStatus =
      rows.find((item) => item.provider_status)?.provider_status ?? rows[0].provider_status ?? null;
    updateLedger.run(nextState, nextProviderStatus, "RECOVERED_AFTER_RESTART", now, operationId);
  }

  const gatewayRows = db
    .prepare(
      "SELECT operation_id, kind, status, response_json FROM gateway_operations WHERE status IN ('prepared', 'acquired', 'in-progress', 'outcome-unknown', 'reconciliation-required')"
    )
    .all();
  const updateGateway = db.prepare(
    "UPDATE gateway_operations SET status = ?, error_json = ?, lease_expires_at = NULL, updated_at = ? WHERE operation_id = ?"
  );
  for (const row of gatewayRows) {
    const response = parseJson(row.response_json, null);
    if (row.kind === "resend") {
      const responseStatus = String(response?.status ?? "").toLowerCase();
      const deliveries = Array.isArray(response?.deliveries) ? response.deliveries : [];
      const nextStatus =
        responseStatus === "completed"
          ? "succeeded"
          : deliveries.length > 0
            ? "reconciliation-required"
            : "outcome-unknown";
      updateGateway.run(
        nextStatus,
        deliveries.length > 0
          ? null
          : JSON.stringify({
              code: "RECOVERED_AFTER_RESTART",
              message: "Resend operation outcome was unknown after application restart."
            }),
        now,
        row.operation_id
      );
      continue;
    }
    updateGateway.run(
      response ? "succeeded" : "outcome-unknown",
      response
        ? null
        : JSON.stringify({
            code: "RECOVERED_AFTER_RESTART",
            message: "Gateway operation outcome was unknown after application restart."
          }),
      now,
      row.operation_id
    );
  }
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
