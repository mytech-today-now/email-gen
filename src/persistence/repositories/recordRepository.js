import { makeId, nowIso, parseJson } from "../../utils/helpers.js";

function rowToRecord(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    datasetId: row.dataset_id,
    sourceName: row.source_name,
    recordKey: row.record_key,
    displayName: row.display_name,
    sourceRow: row.source_row,
    raw: parseJson(row.raw_json, {}),
    normalized: parseJson(row.normalized_json, {}),
    validation: parseJson(row.validation_json, {}),
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function createRecordRepository(db) {
  const insert = db.prepare(`
    INSERT INTO records (
      project_id, dataset_id, source_name, record_key, display_name, source_row, raw_json,
      normalized_json, validation_json, status, created_at, updated_at
    ) VALUES (
      @projectId, @datasetId, @sourceName, @recordKey, @displayName, @sourceRow, @rawJson,
      @normalizedJson, @validationJson, @status, @createdAt, @updatedAt
    )
  `);

  return {
    replaceAll({ records, sourceName, projectId = "project_default", datasetId = makeId("dataset") }) {
      const now = nowIso();
      const tx = db.transaction(() => {
        db.prepare("DELETE FROM records WHERE project_id = ?").run(projectId);
        for (const record of records) {
          insert.run({
            projectId,
            datasetId,
            sourceName,
            recordKey: String(record.internalId),
            displayName: record.displayName,
            sourceRow: record.sourceRow,
            rawJson: JSON.stringify(record.raw),
            normalizedJson: JSON.stringify(record.normalized),
            validationJson: JSON.stringify(record.validation),
            status: record.validation.errors.length > 0 ? "invalid" : "ready",
            createdAt: now,
            updatedAt: now
          });
        }
      });
      tx();
      return { datasetId, count: records.length };
    },

    list({ projectId } = {}) {
      const rows = projectId
        ? db.prepare("SELECT * FROM records WHERE project_id = ? ORDER BY id").all(projectId)
        : db.prepare("SELECT * FROM records ORDER BY id").all();
      return rows.map(rowToRecord);
    },

    get(id, { projectId } = {}) {
      const row = projectId
        ? db.prepare("SELECT * FROM records WHERE id = ? AND project_id = ?").get(id, projectId)
        : db.prepare("SELECT * FROM records WHERE id = ?").get(id);
      return row ? rowToRecord(row) : null;
    },

    findMany(ids, { projectId } = {}) {
      if (!ids.length) return [];
      const placeholders = ids.map(() => "?").join(",");
      const projectClause = projectId ? " AND project_id = ?" : "";
      const params = projectId ? [...ids, projectId] : ids;
      return db
        .prepare(`SELECT * FROM records WHERE id IN (${placeholders})${projectClause} ORDER BY id`)
        .all(...params)
        .map(rowToRecord);
    },

    clear({ projectId } = {}) {
      if (projectId) db.prepare("DELETE FROM records WHERE project_id = ?").run(projectId);
      else db.prepare("DELETE FROM records").run();
    }
  };
}
