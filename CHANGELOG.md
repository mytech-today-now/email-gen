# Changelog

## Unreleased

### Added

- Verified provider-batch capability metadata for supported providers/models, including native discounted batch classification, normalized limits, source URLs, and verification dates in the model catalog.
- Gateway routes and provider adapters for OpenAI Batch, Anthropic Message Batches, and xAI Batch submission, polling, cancellation, and structured result reconciliation.
- Browser execution-mode controls for `auto`, `provider-batch`, and `standard`, plus provider-batch cost comparisons and reload-safe monitoring recovery.
- Batch-processing architecture and provider capability documentation, along with targeted unit, integration, and regression coverage.
- Shared versioned limit registry and byte-aware validation helpers for archive paths, backup fields, export filenames, and browser/server response handling.
- Bounded response-body reading with strict size, content-type, idle-timeout, and deadline enforcement for provider, discovery, search, and resend flows.

### Changed

- `Auto` processing now prefers verified discounted provider batch when the selected model officially supports it.
- Browser-owned jobs preserve in-flight provider-batch monitoring across refresh instead of marking those jobs ambiguous immediately.
- Browser archive streaming now chunks and backpressures worker messages instead of pushing unbounded in-flight data.

### Fixed

- Removed the last legacy browser-credential store plumbing from IndexedDB backups, reset flows, and schema upgrade handling so runtime credentials stay backend-memory-only.
- Added credential lifecycle coverage for runtime status, connection tests, restart clearing, and rapid save/test/clear behavior.
- Added a GitHub Actions CI workflow, a repo-local secret scan command, and broader log artifact ignores.
- Hardened public-website research with connected-address verification, degraded partial-contact handling, and shared network-policy enforcement for Google Sheets CSV imports.
- Documented the research-fetch hardening design note, traceability matrix, and updated research/environment limits.
- Hardened backup validation to reject oversized fields and oversized restore payloads earlier, with focused unit coverage for the new limit profile and response reader.

## 2.0.0 — 2026-07-19

### Added

- Browser-owned IndexedDB data layer, schema/version metadata, quota/persistence UI, OPFS large-archive staging, runtime credential routes, and read-only legacy migration.
- Dynamic prospect table, full template CRUD/history/import/export, three accessible split panes, catalog-only model selection, processing scopes, progress, result trash, and first-run walkthrough.
- Unified sanitized raw/visual email editor, canonical HTML/text pipeline, inline addendum preparation, contact candidate provenance/manual primary selection, standalone contact actions, real Blob/ZIP/EML downloads, and configurable result columns.
- OpenRouter and Ollama runtime discovery/generation, sentinel-safe source-attributed pricing, custom OpenAI-compatible endpoints, and runtime-managed credentials for direct providers.
- Bounded first-party website/contact-page discovery, optional official Brave Search fallback, and untrusted-content prompt delimiting.
- Consent-gated Resend batching, preflight/confirmation, idempotency, transient retry, suppression handling, signed webhook buffer, and manual delivery refresh.
- Portable scoped `.emailgen` backups with manifest/checksums/conflict policies/transactional rollback and diagnostics export.
- Expanded unit/integration/regression/security/Playwright/axe coverage and architecture, storage, backup, migration, provider, security, testing, troubleshooting, version, and traceability documentation.

### Changed

- The browser, not SQLite, is the source of truth for user projects/results/settings.
- The server is a loopback execution gateway and no longer treats server filesystem exports as browser downloads.
- Application version is now independent from browser schema, backup, migration, and walkthrough versions.

### Fixed

- Hardened JSON import failures with actionable line/column diagnostics for malformed payloads instead of continuing with partial or broken data.
- Accepted legacy AI reply formats such as `**Subject:**` in addition to structured JSON `subject`/`bodyHtml` replies, while treating empty subject/body responses as typed failures.
- Restored record-derived phone and website contact actions across standalone HTML and delivery exports, including browser-owned results with no email address.
- Blocked browser copy/export/print actions for incomplete results and replaced recipient-visible `undefined` output with safe failure handling plus correlated stage logging.

### Security

- Strengthened CSP, Origin/CSRF checks, runtime credential handling, logging redaction, strict email sanitization, research SSRF controls, archive validation, and provider endpoint allow/confirmation rules.
- Overrode all transitive Anthropic SDK copies to 0.91.1; `npm audit` reports zero known vulnerabilities at release verification.
