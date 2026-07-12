# AI Batch Personalizer

Local-first browser application for importing prospect records, rendering reusable prompt templates, optionally collecting public website research, generating AI-personalized sales emails, editing results, copying email-safe output, printing, and exporting HTML.

## Architecture Summary

- `server.js` starts an Express server bound to `127.0.0.1` by default.
- `src/app.js` composes configuration, logging, SQLite, repositories, API routes, and the batch manager.
- `src/ai` keeps the application-facing AI boundary on `ai-powered`.
- `src/ai/modelCatalog` discovers, normalizes, validates, caches, and synchronizes provider model catalogs.
- `src/templates` provides generic `{{field}}`, `{{nested.field}}`, `{{field|required}}`, `{{field?}}`, and `{{field|default:"value"}}` rendering.
- `src/data` imports CSV, JSON, constrained static JS/MJS, XLS, XLSX, ODS, TSV, and Google Sheets published CSV URLs.
- `src/research` renders optional public website text through headless Chromium with SSRF protections.
- `src/output` sanitizes AI/addendum HTML and renders conservative table-based email markup.
- `public` contains the vanilla browser UI.
- `tests` contains unit, integration, edge, regression, security, and Playwright E2E coverage.

## Technology Decisions

- Node.js ESM, minimum Node `22.12.0`.
- Express for the local HTTP server.
- SQLite through `better-sqlite3` for local persistence.
- `ai-powered@0.3.2` as the primary AI integration layer.
- xAI/Grok as the default provider, with OpenAI, Anthropic, Venice.ai, Luma AI, custom, and mock providers also available through server-side configuration.
- Vanilla browser JavaScript to keep the local app simple and installable.
- `sanitize-html` for HTML safety, `@e965/xlsx` for spreadsheets, `csv-parse` for delimited files, `acorn` for constrained JS data parsing.
- Vitest, Supertest, and Playwright for verification.

## Verified Integration Assumptions

Verified on July 12, 2026:

- `ai-powered@0.3.2` is ESM-only and exports async `getAiClient(toolName, overrides)`.
- `ai-powered` supports providers `openai`, `anthropic`, `xai`, `venice`, `lumaai`, `custom`, and `mock`; this app exposes all of them.
- Email generation requires structured output. Text/structured models are selectable for jobs; image, audio, and video models remain visible in the catalog but are disabled in the browser selector.
- Its built-in xAI `GrokProvider` uses `XAI_API_KEY`, the OpenAI client, and `https://api.x.ai/v1`.
- Its xAI provider supports text and structured output through chat completions, but its static model list is older than current xAI docs.
- This app keeps current model allowlists in `config/providers.config.js` and passes selected model IDs through `ai-powered`.
- Venice.ai and custom providers can dynamically list models inside `ai-powered`, but this app uses a startup catalog plus optional environment allowlists for deterministic local UI configuration.
- Luma AI is exposed through the `ai-powered` video provider. Current Luma video models are visible in the catalog, but they are not valid choices for this app's structured email generation workflow.
- xAI server-side search tools are not invoked through `ai-powered` here. Website research is implemented by this app as a separate, optional, bounded headless browser scrape.

## Requirements

- Node.js `22.12.0` or newer.
- npm `10` or newer.
- Optional provider API key for live generation. Use mock mode for no-cost local tests.

## Installation

```bash
npm install
cp .env.example .env
```

On Windows PowerShell, copy `.env.example` manually or run:

```powershell
Copy-Item .env.example .env
```

## Environment Setup

Set at minimum:

```dotenv
XAI_API_KEY=your_xai_key
DEFAULT_AI_PROVIDER=xai
DEFAULT_AI_MODEL=grok-4.5
HOST=127.0.0.1
PORT=3000
```

Supported provider credentials:

```dotenv
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
XAI_API_KEY=
VENICE_API_KEY=
LUMAAI_API_KEY=
AI_CUSTOM_API_KEY=
CUSTOM_PROVIDER_BASE_URL=
CUSTOM_PROVIDER_TYPE=openai-compatible
```

By default, fresh installs enable all providers that `ai-powered` supports:

```dotenv
ENABLED_AI_PROVIDERS=openai,anthropic,xai,venice,lumaai,custom,mock
```

Leave `ENABLED_OPENAI_MODELS`, `ENABLED_ANTHROPIC_MODELS`, `ENABLED_XAI_MODELS`, `ENABLED_VENICE_MODELS`, `ENABLED_LUMAAI_MODELS`, `ENABLED_CUSTOM_MODELS`, and `ENABLED_MOCK_MODELS` blank to use the built-in catalog. Set any of them to a comma-separated allowlist to restrict that provider.

## Model Discovery and Synchronization

The app now maintains a SQLite-backed AI model catalog instead of relying only on hardcoded model arrays. At startup, configured models are seeded as a safe fallback. Manual, scheduled, or optional startup synchronization then updates the catalog provider-by-provider:

1. Load enabled providers.
2. Discover live model lists through the provider adapter when supported.
3. Normalize canonical provider IDs, aliases, modalities, capabilities, limits, pricing metadata when returned, and raw metadata.
4. Validate identifiers, duplicates, response shape, field size, and compatibility with this app's structured email workload.
5. Upsert changed records transactionally and preserve historical rows.
6. Mark models missing from a successful discovery as unavailable, then retired after `MODEL_SYNC_MISSING_GRACE_SECONDS`.
7. Keep the app usable through cache, last-known-good, configured fallback, or emergency fallback data.

Provider coverage:

- OpenAI: `GET /v1/models`; the endpoint provides basic model metadata, so unknown capabilities are excluded unless local configured metadata confirms support or `MODEL_SYNC_ALLOW_INFERRED_CAPABILITIES=true`.
- Anthropic: `GET /v1/models` with `x-api-key` and `anthropic-version`.
- xAI: `GET /v1/models`.
- Venice.ai: `GET /api/v1/models`.
- Custom OpenAI-compatible providers: `<base>/v1/models` or `<base>/models` when the base already ends in `/v1`.
- Mock: deterministic configured model discovery for tests.
- Luma AI: dynamic discovery is documented as unsupported in this app; configured video models remain visible but incompatible with structured email generation.

Configuration:

```dotenv
MODEL_SYNC_ENABLED=true
MODEL_SYNC_STARTUP=false
MODEL_SYNC_INTERVAL_SECONDS=21600
MODEL_SYNC_CACHE_TTL_SECONDS=3600
MODEL_SYNC_STALE_CATALOG_SECONDS=86400
MODEL_SYNC_MISSING_GRACE_SECONDS=604800
MODEL_SYNC_PROVIDER_TIMEOUT_MS=60000
MODEL_SYNC_MAX_RETRIES=2
MODEL_SYNC_BACKOFF_MIN_MS=500
MODEL_SYNC_BACKOFF_MAX_MS=6000
MODEL_SYNC_PAGINATION_LIMIT=20
MODEL_SYNC_MAX_RESPONSE_BYTES=500000
MODEL_SYNC_ALLOW_INFERRED_CAPABILITIES=false
MODEL_SYNC_PROVIDER_PREFERENCE=xai,openai,anthropic,venice,custom,mock,lumaai
MODEL_SYNC_REQUIRED_DATA_TYPES=email
MODEL_SYNC_REQUIRED_INPUT_MODALITIES=text
MODEL_SYNC_REQUIRED_OUTPUT_MODALITIES=text
MODEL_SYNC_REQUIRE_STRUCTURED_OUTPUT=true
MODEL_SYNC_MIN_CONTEXT_WINDOW=0
MODEL_SYNC_ADMIN_TOKEN=
MODEL_SYNC_EMERGENCY_FALLBACK_MODELS=[]
```

`MODEL_SYNC_EMERGENCY_FALLBACK_MODELS` is a JSON array. Use placeholder-free provider credentials in environment variables only; never place real keys in this JSON.

Manual synchronization:

```bash
curl -X POST http://127.0.0.1:3000/api/models/sync \
  -H "content-type: application/json" \
  -d "{}"
```

If `MODEL_SYNC_ADMIN_TOKEN` is set, include `x-model-sync-token: <token>`.

Status and catalog:

- `GET /api/models/status` shows latest runs, provider status, cache/fallback state, failures, and accepted counts.
- `GET /api/models/catalog` returns normalized catalog rows for the local admin UI.
- The browser's Model Catalog section shows provider status, model compatibility, excluded reasons, and a manual refresh control.
- `GET /api/ready` includes model synchronization health alongside database and log readiness.

Fallback behavior:

1. Fresh live discovery.
2. Fresh cached provider response.
3. Last known good persisted compatible catalog.
4. Configured emergency fallback models.
5. Disable only the affected provider if no safe catalog exists.

Existing selections are not silently changed. If a selected model is unavailable or incompatible, processing returns a safe error with a suggested fallback chosen by same provider and family, then same provider, then configured provider preference.

Adding a provider:

1. Add provider configuration in `config/providers.config.js`.
2. Add a focused adapter in `src/ai/modelCatalog/providerAdapters.js`.
3. Normalize provider metadata into the internal schema and keep provider-specific logic inside the adapter.
4. Add unit tests for normalization and integration tests for sync/cache/fallback behavior.

For no-cost local testing:

```dotenv
AI_MOCK=true
DEFAULT_AI_PROVIDER=mock
DEFAULT_AI_MODEL=mock-structured-v1
```

Credentials stay server-side. `/api/config` reports whether a provider has a credential and which environment variable is expected, but never returns the key.

## Run

```bash
npm start
```

Open `http://127.0.0.1:3000`.

Development mode:

```bash
npm run dev
```

## Usage

1. Load the bundled sample or import a supported file.
2. Use the Project selector in the header to switch between imported datasets. Each import creates a separate project with an auto-generated name based on the prompt, source, and records.
3. Select a prompt template.
4. Choose a record and preview the rendered prompt.
5. Resolve required-variable warnings before processing.
6. Select provider/model, optional addendum, research, concurrency, and delay.
7. Process current, selected, range, or all records.
8. Click a row in Generated results to make it the Selected Result. The subject, body, rendered preview, prompt/research details, contact email or contact-page fallback, edit controls, copy controls, export, and print actions follow the highlighted row.
9. Use the checkbox column to select completed results for delivery-kit export.
10. Edit subject/body, save, regenerate, copy, print, export HTML, or export delivery kits.

Projects are siloed: records, prompt choice, jobs, generated results, edits, and exports are scoped to the selected project so new imports do not overwrite earlier work.

## Supported Import Formats

- `.csv`
- `.tsv`, tab-delimited `.txt`
- `.json`
- `.js`, `.mjs` with only static exported array/object data
- `.xls`, `.xlsx`, `.ods`
- Google Sheets published CSV URL through `/api/records/import-url`

Apple Numbers `.numbers` files are rejected with a clear error. Export from Numbers as CSV or XLSX first.

User-uploaded JavaScript is never executed. It is parsed with `acorn` and only static literal exports are accepted.

## Template Syntax

- `{{name}}` required by default.
- `{{name|required}}` explicitly required.
- `{{name?}}` optional.
- `{{city|default:"Omaha"}}` optional with default.
- `{{contact.name}}` nested field access.
- `{{{field}}}` raw output marker is parsed but should be avoided unless the target context is safe.

The browser preview shows missing, blank, and malformed variables. Processing blocks when required variables are unresolved unless a route explicitly allows skipping invalid records.

## Research

Website research is optional. The app:

- accepts only `http:` and `https:`;
- blocks localhost, private, loopback, link-local, multicast, and reserved IP ranges;
- renders pages through headless Chromium so JavaScript-populated restaurant details can be captured;
- revalidates redirects and browser subresource requests;
- limits redirects, timeout, content type, and response bytes;
- skips images, media, fonts, and stylesheets during scraping to keep page loads bounded;
- logs scrape start, cache hit, success, and failure events to the configured app log file;
- treats failures as unavailable research, not verified facts.

Relevant environment knobs:

- `RESEARCH_BROWSER_CHANNEL`: optional Playwright browser channel, for example `chrome`; blank uses bundled Chromium.
- `RESEARCH_RENDER_DELAY_MS`: extra wait after `DOMContentLoaded` before extracting rendered HTML.

## Addenda

Place `.html`, `.txt`, or `.md` files in `addenda/`. HTML is sanitized for email-safe tags. Text and Markdown are converted to simple paragraphs and safe links.

## Output, Copy, Export, Print

- Copy Subject copies only the subject.
- Copy Rendered Email attempts rich `text/html` plus `text/plain`.
- Copy HTML copies only the email fragment.
- Copy Plain Text copies a readable fallback.
- Export writes deterministic safe filenames under `output/`.
- Print CSS hides application controls.

Generated HTML is sanitized and uses conservative table markup with inline CSS. It cannot guarantee identical rendering in every email client, but it avoids script/event attributes, unsafe URLs, and app controls.

The app owns the final sender presentation. AI-generated `bodyHtml` should contain only the actual message body. The renderer appends the configured signature and one canonical AI SMS URL consistently, and strips duplicate signature or footer remnants if a model includes them anyway.

## Persistence, Logs, Backup, Reset

- Database: `storage/email-gen.sqlite` by default.
- Logs: `logs/app.log` with rotation.
- Exports: `output/`.
- Projects: stored in SQLite and shown in the header Project selector.
- Model catalog tables: `ai_models`, `provider_sync_status`, `provider_model_response_cache`, and `model_sync_runs`.

The server logs request start/completion, imports, processing failures, manual edits, exports, delivery-kit creation, research activity, startup/shutdown, and unhandled process errors to both the console and rotating log file. Secret-like values are redacted.

Back up `storage/email-gen.sqlite` while the app is stopped. Reset by stopping the app and deleting the SQLite files in `storage/`.

## Security Notes

The app is intended for local use. Binding to a public interface can expose your local data and provider spending controls. Keep `HOST=127.0.0.1` unless you understand the risk.

Secret values are redacted from logs and never sent to the browser. Production HTTP errors suppress stack traces.

## Testing

```bash
npm test
npm run test:unit
npm run test:integration
npm run test:edge
npm run test:regression
npm run test:security
npm run test:e2e
npm run test:coverage
npm run lint
npm run format:check
```

Normal tests use the mock provider and do not require a live provider credential.

## Troubleshooting

- `PROVIDER_CREDENTIAL_MISSING`: set the selected provider's server-side key or switch to mock mode.
- `MODEL_MODALITY_UNSUPPORTED`: choose a model with `structured` capability. Image, audio, and video models cannot generate email JSON.
- `MODEL_UNAVAILABLE`: the selected model is unavailable or retired. Use the fallback suggestion returned by the API or refresh the catalog.
- `MODEL_SYNC_FORBIDDEN`: set or pass the configured manual synchronization token.
- `TEMPLATE_VARIABLE_MISSING`: preview the prompt and fix missing required fields or mark variables optional.
- `UNSUPPORTED_NUMBERS_FILE`: export from Apple Numbers to CSV or XLSX.
- `SSRF_BLOCKED`: the research URL resolves to a blocked network range.
- Spreadsheet import issues: save as CSV if the workbook has unusual formatting.

## Extension Points

- Add providers/models in `config/providers.config.js`, environment allowlists, and `src/ai/modelCatalog/providerAdapters.js`.
- Add datasets by importing files or placing trusted samples under `data/`.
- Add templates under `prompts/`.
- Add addenda under `addenda/`.
- Add output formats by extending `src/output/exporter.js`.

## Directory Tree

```text
.
├── addenda/
├── config/
├── data/
├── logs/
├── output/
├── prompts/
├── public/
├── src/
│   ├── addenda/
│   ├── ai/
│   ├── batch/
│   ├── data/
│   ├── middleware/
│   ├── output/
│   ├── persistence/
│   ├── research/
│   ├── routes/
│   ├── templates/
│   └── utils/
├── storage/
└── tests/
```

## Acceptance Checklist

- Imports structured data and sample restaurants.
- Renders reusable generic prompt templates.
- Detects missing required variables.
- Runs AI calls server-side through `ai-powered`.
- Defaults to xAI/Grok while exposing all `ai-powered` providers.
- Continues after individual record failures.
- Persists records, jobs, results, edits, versions, and errors.
- Sanitizes output and generated email HTML.
- Supports preview, edit, copy, print, regenerate, and export.
- Logs to console and rotating file output with redaction.
- Includes automated test coverage without paid AI calls.
