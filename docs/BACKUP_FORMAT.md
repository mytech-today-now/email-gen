# Portable `.emailgen` backup format

Archive version: **1**. A backup is a ZIP with safe relative paths:

```text
manifest.json
data/projects.json
data/records.json
...
```

`manifest.json` contains `format`, `archiveVersion`, `applicationVersion`, `browserSchemaVersion`, `exportedAt`, `includedCategories`, per-category `counts`, SHA-256 `checksums`, and `migration.version`.

Available scopes are Everything, current project, selected result, selected template, selected addendum, all templates, all addenda, settings, and diagnostic logs. Provider credentials are excluded from backups. Legacy archives that still contain the retired browser `secrets` category ignore it during restore.

Import performs these checks before showing the confirmation:

- 100 MiB compressed and 250 MiB expanded limits;
- no absolute paths, backslashes, traversal segments, or unexpected path characters;
- supported format/archive version;
- category presence and SHA-256 checksum;
- JSON array shape, bounded nesting, and rejection of `__proto__`, `prototype`, and `constructor` keys;
- per-store record limits, per-record field counts, and UTF-8 byte caps for oversized string fields.

The confirmation is the cancellation point before commit. Conflict policies:

- `merge`: upsert archive items by stable key;
- `replace`: clear included stores and insert archive items;
- `duplicate`: mint new keys, annotate names, and rewrite known relationships;
- `skip`: import only categories whose target store is empty.

All included stores commit in one IndexedDB transaction. An error aborts the transaction. The temporary-memory fallback snapshots and restores maps on failure. Future archive versions must add an explicit migrator; newer unknown versions are rejected rather than guessed.
