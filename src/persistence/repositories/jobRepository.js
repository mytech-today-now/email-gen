import { makeId, nowIso, parseJson } from "../../utils/helpers.js";

function rowToJob(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    status: row.status,
    options: parseJson(row.options_json, {}),
    counts: parseJson(row.counts_json, {}),
    cancelRequested: Boolean(row.cancel_requested),
    error: parseJson(row.error_json, null),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function createJobRepository(db) {
  return {
    create({ options, counts, projectId }) {
      const now = nowIso();
      const id = makeId("job");
      const resolvedProjectId = projectId ?? options?.projectId ?? "project_default";
      db.prepare(
        "INSERT INTO jobs (id, project_id, status, options_json, counts_json, cancel_requested, created_at, updated_at) VALUES (?, ?, 'queued', ?, ?, 0, ?, ?)"
      ).run(id, resolvedProjectId, JSON.stringify(options), JSON.stringify(counts), now, now);
      return this.get(id);
    },

    get(id) {
      const row = db.prepare("SELECT * FROM jobs WHERE id = ?").get(id);
      return row ? rowToJob(row) : null;
    },

    list(limit = 50, { projectId } = {}) {
      const rows = projectId
        ? db
            .prepare("SELECT * FROM jobs WHERE project_id = ? ORDER BY created_at DESC LIMIT ?")
            .all(projectId, limit)
        : db.prepare("SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?").all(limit);
      return rows.map(rowToJob);
    },

    update(id, patch) {
      const current = this.get(id);
      if (!current) return null;
      const next = {
        status: patch.status ?? current.status,
        counts: patch.counts ?? current.counts,
        cancelRequested: patch.cancelRequested ?? current.cancelRequested,
        error: patch.error === undefined ? current.error : patch.error
      };
      db.prepare(
        "UPDATE jobs SET status = ?, counts_json = ?, cancel_requested = ?, error_json = ?, updated_at = ? WHERE id = ?"
      ).run(
        next.status,
        JSON.stringify(next.counts),
        next.cancelRequested ? 1 : 0,
        next.error ? JSON.stringify(next.error) : null,
        nowIso(),
        id
      );
      return this.get(id);
    },

    increment(id, fields) {
      const job = this.get(id);
      if (!job) return null;
      const counts = { ...job.counts };
      for (const [key, amount] of Object.entries(fields)) {
        counts[key] = (counts[key] ?? 0) + amount;
      }
      return this.update(id, { counts });
    }
  };
}
