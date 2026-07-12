import { makeId, nowIso } from "../../utils/helpers.js";
import { suggestProjectMetadata } from "../../projects/projectNamer.js";

function rowToProject(row) {
  return {
    id: row.id,
    name: row.name,
    datasetName: row.dataset_name,
    promptName: row.prompt_name,
    sourceName: row.source_name,
    recordCount: row.record_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function createProjectRepository(db) {
  const insert = db.prepare(`
    INSERT INTO projects (
      id, name, dataset_name, prompt_name, source_name, record_count, created_at, updated_at
    ) VALUES (
      @id, @name, @datasetName, @promptName, @sourceName, @recordCount, @createdAt, @updatedAt
    )
  `);

  return {
    createForImport({ records, sourceName, templateName = "restaurant-ai-sms.txt" }) {
      const now = nowIso();
      const metadata = suggestProjectMetadata({ records, sourceName, templateName });
      const project = {
        id: makeId("project"),
        name: metadata.name,
        datasetName: metadata.datasetName,
        promptName: metadata.promptName,
        sourceName,
        recordCount: records.length,
        createdAt: now,
        updatedAt: now
      };
      insert.run(project);
      return project;
    },

    get(id) {
      const row = db.prepare("SELECT * FROM projects WHERE id = ?").get(id);
      return row ? rowToProject(row) : null;
    },

    list() {
      return db
        .prepare("SELECT * FROM projects ORDER BY updated_at DESC, created_at DESC")
        .all()
        .map(rowToProject);
    },

    resolve(id) {
      if (id) {
        const project = this.get(id);
        if (project) return project;
      }
      return this.list()[0] ?? null;
    },

    updatePrompt(id, promptName) {
      if (!id || !promptName) return this.get(id);
      db.prepare("UPDATE projects SET prompt_name = ?, updated_at = ? WHERE id = ?").run(
        promptName,
        nowIso(),
        id
      );
      return this.get(id);
    },

    touchRecordCount(id) {
      if (!id) return null;
      db.prepare(
        "UPDATE projects SET record_count = (SELECT COUNT(*) FROM records WHERE project_id = ?), updated_at = ? WHERE id = ?"
      ).run(id, nowIso(), id);
      return this.get(id);
    }
  };
}
