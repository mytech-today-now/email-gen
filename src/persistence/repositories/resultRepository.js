import { makeId, nowIso, parseJson } from "../../utils/helpers.js";

function rowToResult(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    jobId: row.job_id,
    recordId: row.record_id,
    templateName: row.template_name,
    provider: row.provider,
    model: row.model,
    status: row.status,
    subject: row.subject,
    bodyHtml: row.body_html,
    bodyText: row.body_text,
    emailHtml: row.email_html,
    prompt: row.prompt,
    research: parseJson(row.research_json, {}),
    error: parseJson(row.error_json, null),
    rawAi: row.raw_ai,
    version: row.version,
    editedAt: row.edited_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function createResultRepository(db) {
  const insert = db.prepare(`
    INSERT INTO results (
      id, project_id, job_id, record_id, template_name, provider, model, status, subject, body_html,
      body_text, email_html, prompt, research_json, error_json, raw_ai, version, edited_at,
      created_at, updated_at
    ) VALUES (
      @id, @projectId, @jobId, @recordId, @templateName, @provider, @model, @status, @subject, @bodyHtml,
      @bodyText, @emailHtml, @prompt, @researchJson, @errorJson, @rawAi, @version, @editedAt,
      @createdAt, @updatedAt
    )
  `);

  return {
    createProcessing({
      projectId = "project_default",
      jobId,
      recordId,
      templateName,
      provider,
      model,
      prompt = ""
    }) {
      const now = nowIso();
      const id = makeId("res");
      insert.run({
        id,
        projectId,
        jobId,
        recordId,
        templateName,
        provider,
        model,
        status: "processing",
        subject: "",
        bodyHtml: "",
        bodyText: "",
        emailHtml: "",
        prompt,
        researchJson: "{}",
        errorJson: null,
        rawAi: null,
        version: 1,
        editedAt: null,
        createdAt: now,
        updatedAt: now
      });
      return this.get(id);
    },

    saveCompleted(id, payload) {
      const now = nowIso();
      db.prepare(
        `UPDATE results SET status = 'completed', subject = ?, body_html = ?, body_text = ?, email_html = ?,
         prompt = ?, research_json = ?, error_json = NULL, raw_ai = ?, updated_at = ? WHERE id = ?`
      ).run(
        payload.subject,
        payload.bodyHtml,
        payload.bodyText,
        payload.emailHtml,
        payload.prompt,
        JSON.stringify(payload.research ?? {}),
        payload.rawAi ?? null,
        now,
        id
      );
      return this.get(id);
    },

    saveFailed(id, error, extra = {}) {
      db.prepare(
        "UPDATE results SET status = 'failed', error_json = ?, prompt = COALESCE(?, prompt), research_json = COALESCE(?, research_json), updated_at = ? WHERE id = ?"
      ).run(
        JSON.stringify({ code: error.code || "PROCESSING_ERROR", message: error.message || String(error) }),
        extra.prompt ?? null,
        extra.research ? JSON.stringify(extra.research) : null,
        nowIso(),
        id
      );
      return this.get(id);
    },

    get(id) {
      const row = db.prepare("SELECT * FROM results WHERE id = ?").get(id);
      return row ? rowToResult(row) : null;
    },

    latestForRecord(recordId) {
      const row = db
        .prepare("SELECT * FROM results WHERE record_id = ? ORDER BY updated_at DESC LIMIT 1")
        .get(recordId);
      return row ? rowToResult(row) : null;
    },

    list({ status, recordId, projectId } = {}) {
      const clauses = [];
      const params = [];
      if (projectId) {
        clauses.push("project_id = ?");
        params.push(projectId);
      }
      if (status) {
        clauses.push("status = ?");
        params.push(status);
      }
      if (recordId) {
        clauses.push("record_id = ?");
        params.push(recordId);
      }
      const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
      return db
        .prepare(`SELECT * FROM results ${where} ORDER BY updated_at DESC`)
        .all(...params)
        .map(rowToResult);
    },

    listByIds(ids, { projectId } = {}) {
      if (!ids.length) return [];
      const placeholders = ids.map(() => "?").join(",");
      const projectClause = projectId ? " AND project_id = ?" : "";
      const params = projectId ? [...ids, projectId] : ids;
      return db
        .prepare(
          `SELECT * FROM results WHERE id IN (${placeholders})${projectClause} ORDER BY updated_at DESC`
        )
        .all(...params)
        .map(rowToResult);
    },

    updateManual(id, { subject, bodyHtml, bodyText, emailHtml }) {
      const current = this.get(id);
      if (!current) return null;
      const nextVersion = current.version + 1;
      const now = nowIso();
      const tx = db.transaction(() => {
        db.prepare(
          `INSERT INTO result_versions (id, result_id, version, subject, body_html, body_text, email_html, prompt, raw_ai, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          makeId("ver"),
          id,
          current.version,
          current.subject,
          current.bodyHtml,
          current.bodyText,
          current.emailHtml,
          current.prompt,
          current.rawAi,
          now
        );
        db.prepare(
          "UPDATE results SET subject = ?, body_html = ?, body_text = ?, email_html = ?, version = ?, edited_at = ?, updated_at = ? WHERE id = ?"
        ).run(subject, bodyHtml, bodyText, emailHtml, nextVersion, now, now, id);
      });
      tx();
      return this.get(id);
    },

    versions(resultId) {
      return db
        .prepare("SELECT * FROM result_versions WHERE result_id = ? ORDER BY version DESC")
        .all(resultId)
        .map((row) => ({
          id: row.id,
          resultId: row.result_id,
          version: row.version,
          subject: row.subject,
          bodyHtml: row.body_html,
          bodyText: row.body_text,
          emailHtml: row.email_html,
          prompt: row.prompt,
          rawAi: row.raw_ai,
          createdAt: row.created_at
        }));
    },

    failedForJob(jobId) {
      return db
        .prepare("SELECT * FROM results WHERE job_id = ? AND status = 'failed' ORDER BY updated_at")
        .all(jobId)
        .map(rowToResult);
    },

    delete(id, { projectId } = {}) {
      const current = projectId ? this.get(id) : this.get(id);
      if (!current || (projectId && current.projectId !== projectId)) return null;
      const tx = db.transaction(() => {
        db.prepare("DELETE FROM result_versions WHERE result_id = ?").run(id);
        db.prepare("DELETE FROM results WHERE id = ?").run(id);
      });
      tx();
      return current;
    },

    deleteMany(ids, { projectId } = {}) {
      if (!ids.length) return [];
      const deleted = [];
      const tx = db.transaction(() => {
        for (const id of ids) {
          const current = this.get(id);
          if (!current || (projectId && current.projectId !== projectId)) continue;
          db.prepare("DELETE FROM result_versions WHERE result_id = ?").run(id);
          db.prepare("DELETE FROM results WHERE id = ?").run(id);
          deleted.push(current);
        }
      });
      tx();
      return deleted;
    }
  };
}
