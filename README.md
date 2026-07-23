# AI Batch Personalizer 2.0

A local-first browser application for importing prospect data, maintaining reusable prompt templates, selecting discovered AI models, researching public contact options, generating and editing email-safe messages, and copying, exporting, or sending policy-eligible results.

The browser is the source of truth for user data. The Express process is a loopback-only execution gateway for provider calls, headless-browser research, Resend, runtime model discovery, rotating logs, and read-only legacy migration. Ordinary projects, records, results, and exports are not persisted by the gateway.

## Requirements

- Node.js 22.12 or newer and npm 10 or newer.
- A current Chromium, Firefox, or WebKit browser with IndexedDB and Web Crypto.
- Optional provider credentials entered through the Configuration screen. Mock mode needs no paid service.
- OPFS is optional; large generated archives use it when available and fall back to browser memory/Blob downloads.

## Install and run

```powershell
npm ci
Copy-Item .env.example .env
npm start
```

Open `http://127.0.0.1:3000`. Keep the default loopback binding. `AI_MOCK=true` with the mock model is the safe no-cost development path.

Do not add provider API keys to `.env`. Configure them in the application's Configuration screen so they stay in backend memory only for the current app session.

## Practical workflow

1. Import CSV, TSV, JSON, static JS/MJS, XLS, XLSX, or ODS data, or load the bundled sample.
2. Choose or create a template. Variables support `{{field}}`, `{{field|required}}`, `{{field?}}`, `{{field|default:"value"}}`, and nested paths.
3. Select a compatible model in Model Catalog. The Processing section displays that single selection; it has no second model selector.
4. Configure execution mode, addendum, research depth, processing scope, concurrency, and delay.
5. Process records. `Auto` prefers verified discounted provider batch when available; `Provider batch` requires explicit verified native batch support; `Standard API` keeps the existing per-record workflow. Browser-owned jobs and partial results survive navigation, and provider-batch monitoring resumes after refresh instead of silently resubmitting work.
6. Review contact candidates and choose a primary method. Edit the canonical final email in Raw HTML or Visual Email mode.
7. Copy the primary email, subject, rendered email, HTML, or text; export standalone HTML, ZIP delivery kits, or `.eml` when a primary email exists.
8. Use Resend only for recipients with verifiable explicit opt-in. Every send has an exact preflight and final confirmation.

## Browser-owned data and backups

IndexedDB stores projects, records, templates and versions, addenda, jobs, results and versions, research/contact/model caches, settings, delivery history, suppressions, logs, and artifacts. Provider credentials are not stored in browser storage. `localStorage` is limited to small non-sensitive split-pane ratios. The app exposes storage estimates and `navigator.storage.persist()`.

Configuration can export Everything, a project, selected result/template/addendum, category, settings, or diagnostics. `.emailgen` archives contain a versioned `manifest.json`, category files, counts, checksums, timestamps, and migration metadata. Import validates paths, expansion size, checksums, schema version, object keys, and conflicts; merge, replace, duplicate, and skip commit through a multi-store transaction.

A shared versioned limit profile bounds archive paths, export filenames, backup field sizes, worker queueing, and restore validation so browser and server code fail early on oversized or malformed data.

The legacy migration wizard reads the existing SQLite database, reports counts/checksum, offers a pre-migration backup, imports idempotently, and never deletes the original database. See [browser storage](docs/BROWSER_STORAGE.md), [backup format](docs/BACKUP_FORMAT.md), and [migration](docs/MIGRATION.md).

## Runtime credentials and threat model

Credentials entered in Configuration are sent only to the loopback backend, stored in server memory, and cleared when the app stops or when the user clears them. Saved credential values are never returned to the browser, never written to IndexedDB/localStorage, and are not included in exports or diagnostics.

This protects against accidental browser persistence, but not against a compromised local machine, malicious extension, or server-memory inspection on the host. Rotate any credential that has ever been exposed in chat, logs, screenshots, or Git history. See [security](docs/SECURITY.md).

## Providers and model catalog

- OpenAI, Anthropic, xAI, Venice, and user-confirmed OpenAI-compatible custom endpoints.
- OpenRouter runtime discovery and generation, including provider/model IDs, supported parameters, availability, source-attributed pricing, routing options, and sentinel-safe pricing normalization.
- Ollama loopback discovery and structured generation. Local models show “Local compute cost; no provider token price,” never `$0`.
- Browser-rendered pricing refresh for hosted providers, using official provider pricing pages during model sync so the discovered catalog can show current source-attributed pricing even when provider model-list APIs omit prices.
- Verified provider-batch capability metadata for OpenAI, Anthropic, and xAI, including classification, batch pricing, limits, discount percent, verification date, and source URL when official discounted native batch support exists.
- Mock generation for deterministic tests.

Catalog selection is persisted by canonical provider/model ID. Missing, stale, incompatible, or unavailable models remain visible with explicit status and do not silently replace the user’s choice. Pricing is informational and displays source, verification time, and unknown/variable status instead of inventing zeroes. See [provider setup](docs/PROVIDERS.md).

## Research and contact discovery

Research first checks imported record fields, then the prospect’s public website and a bounded set of discovered or likely contact/about/team/location/sitemap pages through a hardened headless browser. If no usable candidate is found and a Brave Search credential is configured, the official Search API is the external fallback. Website text is delimited as untrusted content in prompts.

Candidates retain source URL/category, discovery method, confidence, ranking reason, and timestamp. Ranking is deterministic, duplicate-safe, and separately chooses the best email and form. Manual primary choices persist. External discovery is not consent evidence.

## Resend safety

Resend configuration includes API key, verified-domain connection test, sender, Reply-To, test-recipient mode, batch size, webhook secret, and one-click unsubscribe URL. Sending:

- excludes missing/invalid primary emails, duplicates, suppressions, and any record without explicit opt-in source and timestamp;
- never treats scraped or externally discovered addresses as permission to send;
- requires company postal identification and a valid unsubscribe URL for bulk sends;
- batches at no more than 100, uses stable idempotency keys, honors `Retry-After`, and retries only network/429/5xx failures;
- persists per-result IDs/status in IndexedDB and supports signed, idempotent webhook events plus manual refresh;
- uses the exact sanitized HTML and text displayed by the editor.

The app intentionally offers no compliance bypass. Copy/export/manual contact remains available for ineligible records. A loopback webhook is not publicly reachable; do not expose this server unauthenticated. Review Resend’s current policy and applicable law before every campaign.

## Testing and quality gates

```powershell
npm run verify
npm test
npm run test:e2e
npm run test:e2e:01
npm run test:e2e:02
npm run test:e2e:03
npm run test:e2e:04
npm run test:credentials:list
npm run test:e2e:live
npm run test:coverage
npm audit --audit-level=low
```

`npm run verify` is the main repository gate. It runs formatting, lint, secret scanning, and Vitest coverage in one pass, while Playwright stays separate for the browser suite. Vitest covers unit, integration, edge, regression, and security suites. Playwright covers the complete browser workflow, reload persistence, exports, ZIP contents, keyboard split panes, accessibility with axe, and responsive Chromium/Firefox/WebKit layouts. Default automated tests use the mock provider and do not make paid provider calls.

For faster browser checks, use the numbered sections:

1. `npm run test:e2e:01` for core browser workflows.
2. `npm run test:e2e:02` for multi-tab and batch workflows.
3. `npm run test:e2e:03` for responsive layout checks.
4. `npm run test:e2e:04` or `npm run test:e2e:live` for the protected live credential suite.

Focused coverage also includes the shared limit registry, bounded HTTP response reader, archive/backup validation, provider batch recovery, and model discovery/sync paths that now enforce the new timeouts and byte ceilings.

For live E2E, install rotated low-privilege test credentials once into the OS credential store:

```powershell
npm run test:credentials:install -- --provider openai --provider anthropic
npm run test:credentials:list
npm run test:credentials:remove -- --provider openai
npm run test:credentials:remove-all
```

Live tests resolve credentials in this order: protected process environment, OS credential store, unavailable. They never read `.env`, fixtures, or plaintext files for provider secrets.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Provider batch processing plan](docs/batch-processing-plan.md)
- [Browser storage](docs/BROWSER_STORAGE.md)
- [Portable backup format](docs/BACKUP_FORMAT.md)
- [Legacy migration](docs/MIGRATION.md)
- [Provider setup and pricing](docs/PROVIDERS.md)
- [Security and credential threat model](docs/SECURITY.md)
- [Testing](docs/TESTING.md)
- [Performance](docs/PERFORMANCE.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)
- [Requirement traceability](docs/REQUIREMENTS.md)
- [Versions and compatibility](VERSIONS.md)
- [Changelog](CHANGELOG.md)

## Verified external references

Research was rechecked on 2026-07-21 against primary documentation: [WCAG 2.2](https://www.w3.org/TR/WCAG22/), [WCAG 3 status](https://www.w3.org/WAI/standards-guidelines/wcag/wcag3-intro/), [IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API/Using_IndexedDB), [OPFS](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system), [Web Crypto deriveKey](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/deriveKey), [OpenAI Batch](https://developers.openai.com/api/docs/guides/batch), [OpenAI pricing](https://developers.openai.com/api/docs/pricing), [Anthropic Message Batches](https://platform.claude.com/docs/en/build-with-claude/batch-processing), [Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing), [xAI Batch API](https://docs.x.ai/developers/advanced-api-usage/batch-api), [xAI pricing](https://docs.x.ai/developers/pricing), [OpenRouter models](https://openrouter.ai/docs/api/api-reference/models/get-models), [Ollama model listing](https://docs.ollama.com/api/tags), [Ollama structured outputs](https://docs.ollama.com/capabilities/structured-outputs), [Resend batch API](https://resend.com/docs/api-reference/emails/send-batch-emails), [Resend idempotency](https://resend.com/docs/dashboard/emails/idempotency-keys), [Resend webhooks](https://resend.com/docs/webhooks/verify-webhooks-requests), [Resend acceptable use](https://resend.com/legal/acceptable-use), and [Brave Search authentication](https://api-dashboard.search.brave.com/documentation/guides/authentication).
