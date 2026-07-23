# Browser storage

Browser schema version: **4**.

| Store                          | Key             | Important indexes / purpose                         |
| ------------------------------ | --------------- | --------------------------------------------------- |
| projects                       | `id`            | `updatedAt`; imported datasets                      |
| records                        | `id`            | `projectId`, `status`, `updatedAt`, `contactLookup` |
| templates / templateVersions   | `id`            | name/source/update and template/version history     |
| addenda                        | `id`            | name/source/update                                  |
| results / resultVersions       | `id`            | project, record, status, trash, update, history     |
| jobs                           | `id`            | project, status, update                             |
| researchCache / contacts       | URL / `id`      | expiry, project, candidate value                    |
| modelCatalog / providerStatus  | `id` / provider | availability, favorite, update                      |
| settings                       | `key`           | configuration, selected model, columns, walkthrough |
| deliveryHistory / suppressions | `id` / email    | result/status/update                                |
| artifacts                      | `id`            | project/update; retained Blob metadata              |
| logs                           | `id`            | timestamp/event; redacted browser diagnostics       |

`meta` records schema upgrades. Stable UUID-based IDs avoid row-number identity. Related result/job/contact writes use multi-store transactions.

Split ratios are the only persistent values in `localStorage`; they are small and non-sensitive. Provider credentials, templates, addenda, datasets, and generated bodies never use it.

The Configuration dialog reports `navigator.storage.estimate()`, persistence state, IndexedDB/temporary mode, schema version, and OPFS availability. “Request persistent storage” calls `navigator.storage.persist()`; browsers may decline. Users should still export backups because site-data clearing and profile loss remain possible.

Large ZIPs are staged in `generated-artifacts/` within OPFS above the configured threshold, downloaded as a Blob/File, then removed. If OPFS is unavailable or fails, generation falls back to an in-memory Blob. IndexedDB remains the structured source of truth.

The same versioned limit profile also governs backup staging, archive path validation, worker chunking, and other browser-side size checks so the app can reject oversized work before it grows into a quota problem.

Private browsing, blocked IndexedDB, upgrade errors, and quota errors are surfaced. Temporary fallback data is lost when the page closes, so export immediately if that mode appears.
