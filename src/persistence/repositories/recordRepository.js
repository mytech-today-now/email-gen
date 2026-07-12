import { makeId, nowIso, parseJson } from "../../utils/helpers.js";

function rowToRecord(row) {
  return {
    id: row.id,
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
      dataset_id, source_name, record_key, display_name, source_row, raw_json,
      normalized_json, validation_json, status, created_at, updated_at
    ) VALUES (
      @datasetId, @sourceName, @recordKey, @displayName, @sourceRow, @rawJson,
      @normalizedJson, @validationJson, @status, @createdAt, @updatedAt
    )
  `);

  return {
    replaceAll({ records, sourceName, datasetId = makeId("dataset") }) {
      const now = nowIso();
      const tx = db.transaction(() => {
        db.prepare("DELETE FROM records").run();
        for (const record of records) {
          insert.run({
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

    list() {
      return db.prepare("SELECT * FROM records ORDER BY id").all().map(rowToRecord);
    },

    get(id) {
      const row = db.prepare("SELECT * FROM records WHERE id = ?").get(id);
      return row ? rowToRecord(row) : null;
    },

    findMany(ids) {
      if (!ids.length) return [];
      const placeholders = ids.map(() => "?").join(",");
      return db
        .prepare(`SELECT * FROM records WHERE id IN (${placeholders}) ORDER BY id`)
        .all(...ids)
        .map(rowToRecord);
    },

    clear() {
      db.prepare("DELETE FROM records").run();
    }
  };
}
