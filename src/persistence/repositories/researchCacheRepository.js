import { nowIso, parseJson } from "../../utils/helpers.js";

function rowToCache(row) {
  return {
    url: row.url,
    status: row.status,
    title: row.title,
    content: row.content,
    error: parseJson(row.error_json, null),
    metadata: parseJson(row.metadata_json, {}),
    fetchedAt: row.fetched_at,
    expiresAt: row.expires_at
  };
}

export function createResearchCacheRepository(db) {
  return {
    getFresh(url, clock = Date) {
      const row = db
        .prepare("SELECT * FROM research_cache WHERE url = ? AND expires_at > ?")
        .get(url, new clock().toISOString());
      return row ? rowToCache(row) : null;
    },

    save(url, entry, ttlSeconds) {
      const fetchedAt = nowIso();
      const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
      db.prepare(
        `INSERT INTO research_cache (url, status, title, content, error_json, metadata_json, fetched_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(url) DO UPDATE SET status = excluded.status, title = excluded.title, content = excluded.content,
         error_json = excluded.error_json, metadata_json = excluded.metadata_json,
         fetched_at = excluded.fetched_at, expires_at = excluded.expires_at`
      ).run(
        url,
        entry.status,
        entry.title ?? null,
        entry.content ?? null,
        entry.error ? JSON.stringify(entry.error) : null,
        entry.metadata ? JSON.stringify(entry.metadata) : null,
        fetchedAt,
        expiresAt
      );
      return this.getFresh(url) ?? { url, ...entry, fetchedAt, expiresAt };
    }
  };
}
