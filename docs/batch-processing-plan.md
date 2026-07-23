# Provider Batch Processing Plan

Verified on 2026-07-21.

## Current provider inventory

Authoritative application support comes from `config/providers.config.js`, `src/ai/gatewayProvider.js`, and runtime-discovery code:

- Configured providers: `openai`, `anthropic`, `xai`, `venice`, `lumaai`, `custom`, `mock`
- Runtime-discovered browser providers: `openrouter`, `ollama`
- Browser gateway generation path today: `openai`, `anthropic`, `xai`, `venice`, `custom`, `openrouter`, `ollama`, `mock`

Before this work, “batch” in the product meant browser-owned local iteration plus bounded concurrency. It did not mean provider-side discounted asynchronous batch execution.

## Capability matrix

| Provider   | Classification                                                                                                                                                               | Verified eligible models in this repo                                                                                      | Batch discount                                                              | Notes                                                                                                              |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| OpenAI     | `native_discounted_batch` when the official pricing page includes a Batch row for the selected model; otherwise `standard_api_only`                                          | Any synced OpenAI model with verified Batch pricing, such as `gpt-5.6-sol`                                                 | 50% lower than standard synchronous pricing when Batch pricing is published | Requires uploaded JSONL, one model per input file, `custom_id` reconciliation, 24h completion window               |
| Anthropic  | `native_discounted_batch` for currently verified active Claude models; otherwise `unavailable_or_unverified`                                                                 | `claude-fable-5`, `claude-opus-4-8`, `claude-sonnet-5`, `claude-haiku-4-5`, `claude-haiku-4-5-20251001`, `claude-mythos-5` | 50% lower than standard pricing                                             | Uses Message Batches, JSONL results, 24h expiry, 29-day result retention                                           |
| xAI        | `native_discounted_batch` only for explicitly verified discounted models; otherwise `unavailable_or_unverified` or `standard_api_only` when the model is explicitly excluded | `grok-4.3`, `grok-4.3-latest`, `grok-4.20-0309-reasoning`, `grok-4.20-0309-non-reasoning`                                  | 20% lower on verified discounted models                                     | `grok-4.5`, `grok-4.5-latest`, and `grok-latest` are excluded from xAI Batch                                       |
| Venice     | `standard_api_only`                                                                                                                                                          | none verified                                                                                                              | none verified                                                               | Official docs show synchronous OpenAI-compatible usage, not a discounted inference batch program for this workflow |
| LumaAI     | `standard_api_only`                                                                                                                                                          | none verified                                                                                                              | none verified                                                               | Async generation exists, but not a discounted prompt batch API for structured email generation                     |
| OpenRouter | `standard_api_only`                                                                                                                                                          | none verified                                                                                                              | none verified                                                               | Unified synchronous routing and caching, but no verified provider-side discounted batch endpoint                   |
| Ollama     | `standard_api_only`                                                                                                                                                          | none verified                                                                                                              | local compute                                                               | Local loopback runtime, not a provider-side discounted batch service                                               |
| Custom     | `unavailable_or_unverified`                                                                                                                                                  | provider-specific                                                                                                          | unknown                                                                     | Cannot assume native batch or discount support without authoritative tenant docs                                   |
| Mock       | `standard_api_only`                                                                                                                                                          | `mock-structured-v1`                                                                                                       | not applicable                                                              | Deterministic test path only                                                                                       |

## Architecture findings

- Browser IndexedDB remains the source of truth for projects, records, jobs, and results.
- The gateway remains the only place where provider credentials live and where provider HTTP requests execute.
- The synced model catalog already stores structured pricing JSON, so native batch metadata belongs there instead of a parallel store.
- Reload recovery already existed for browser jobs, but only standard per-record work could be resumed safely. Provider-batch monitoring needed a resumable browser-side poller.

## Implemented architecture

### Provider capability abstraction

- Added `src/ai/modelCatalog/batchMetadata.js`
- Enriches every model with `pricing.batch`
- Normalizes:
  - `classification`
  - `supported`
  - `discounted`
  - batch token prices
  - `discountPercent`
  - `limits`
  - `sourceUrl`
  - `verifiedAt`
  - `reason`
  - `limitations`

### Shared structured output parsing

- Added `src/ai/structuredEmail.js`
- Reused by direct generation and provider-batch reconciliation
- Accepts strict JSON or legacy `**Subject:**` formats and normalizes to `{ subject, bodyHtml }`

### Provider-batch service layer

- Added `src/ai/providerBatchService.js`
- Supports:
  - batch submission
  - status refresh
  - cancellation
  - per-provider request shaping
  - request chunking against verified limits
  - deterministic request correlation IDs
  - estimated standard-vs-batch cost summaries

Current native batch adapters:

- OpenAI Batch
- Anthropic Message Batches
- xAI Batch API

### Gateway routes

Added browser-safe loopback endpoints:

- `POST /api/gateway/batches/submit`
- `POST /api/gateway/batches/status`
- `POST /api/gateway/batches/cancel`

### Browser workflow

- Added execution modes:
  - `auto`
  - `provider-batch`
  - `standard`
- `auto` now prefers verified `native_discounted_batch` models
- Provider-batch jobs:
  - persist to IndexedDB like existing jobs
  - create placeholder results immediately
  - monitor provider status through the gateway
  - reconcile out-of-order results by provider request ID
  - resume monitoring after refresh instead of degrading to `ambiguous`

## Data-model changes

- `modelCatalog.pricing.batch` now carries normalized batch capability metadata
- Browser settings now persist `executionMode`
- Browser jobs now persist:
  - `executionMode`
  - `requestedExecutionMode`
  - `providerBatch`
- Browser results now persist `jobId` so batch reconciliation can update the correct placeholder result

No destructive schema migration was required because browser stores are schemaless at the record-property level and the SQLite model catalog already stores pricing as JSON.

## Job-state transitions

Standard mode remains unchanged:

- `running` → `completed`
- `running` → `failed`
- `running` → `stopping` → `stopped`
- interrupted standard jobs still recover as `ambiguous`

Provider-batch mode now uses:

- `running` after batch submission
- `stopping` after local cancellation request
- `completed` when all records reach terminal states with at least one successful or mixed outcome
- `failed` when every record fails
- `stopped` when every unresolved record is canceled/stopped

Provider result states are normalized to browser result states:

- provider `completed` → result `completed`
- provider `canceled` / `cancelled` → result `stopped`
- provider `failed` / `expired` / malformed output → result `failed`

## Pricing-display changes

- The selected-model summary now shows whether provider batch is eligible for the selected model
- The processing panel now exposes execution mode selection
- Cost messaging now distinguishes:
  - standard API estimate
  - provider-batch estimate
  - comparative savings when verified batch pricing exists

## Logging and security strategy

- Provider-batch execution stays behind the same CSRF-protected loopback gateway as direct generation
- Runtime credentials remain backend-memory-only
- Added structured gateway events for:
  - provider-batch submission
  - provider-batch cancellation request
  - browser provider-batch start/finish
- Batch request prompts and research stay in browser-owned results only when they are already part of the normal user-visible workflow

## Error handling and fallback behavior

- `auto` falls back to standard processing when no verified discounted native batch path exists
- Explicit `provider-batch` selection fails fast with a typed error if the selected model is not verified for discounted native batch
- Provider terminal batches that do not return a result for every request mark unresolved records as failed or stopped instead of hanging forever
- Unsupported providers are labeled accurately as `standard_api_only` or `unavailable_or_unverified`

## Testing strategy

Added or updated coverage for:

- batch metadata normalization
- OpenAI Batch pricing parsing
- gateway batch submit/status/cancel routes
- processing-layout regression for execution-mode controls

Verification run after implementation:

- `npm run lint` ✅
- `npm test` ✅
- `npm run format:check` ⚠️ still reports unrelated pre-existing formatting drift in:
  - `config/providers.config.js`
  - `public/modules/emailPipeline.js`
  - `public/modules/logger.js`
  - `tests/regression/editorPanelsRegression.test.js`

## Backward compatibility

- Existing standard processing remains the default for models without verified discounted provider batch support
- Existing browser projects, results, settings, and backups remain valid
- Existing model selections are preserved
- Existing direct synchronous generation routes remain available

## Known limitations and future work

- Anthropic eligibility is intentionally limited to models explicitly verified from current official documentation
- xAI batch support is intentionally limited to models with a verified documented discount
- Browser polling currently monitors one active provider-batch job at a time in the foreground UI
- Native provider-batch support is not enabled for custom endpoints without tenant-specific official proof
- Playwright E2E coverage for provider-batch execution can be added later with deterministic mock timing in the browser

## Official sources

- OpenAI Batch guide: <https://developers.openai.com/api/docs/guides/batch>
- OpenAI pricing: <https://developers.openai.com/api/docs/pricing>
- OpenAI batch API reference: <https://developers.openai.com/api/reference/resources/batches/methods/create>
- Anthropic batch processing: <https://platform.claude.com/docs/en/build-with-claude/batch-processing>
- Anthropic pricing: <https://platform.claude.com/docs/en/about-claude/pricing>
- Anthropic batch API reference: <https://platform.claude.com/docs/en/api/messages/batches/create>
- xAI Batch API: <https://docs.x.ai/developers/advanced-api-usage/batch-api>
- xAI pricing: <https://docs.x.ai/developers/pricing>
- xAI batch REST reference: <https://docs.x.ai/developers/rest-api-reference/inference/batches>
- Venice docs: <https://docs.venice.ai/getting-started/quick-start>
- LumaAI docs: <https://docs.lumalabs.ai/docs/api>
- OpenRouter docs: <https://openrouter.ai/docs/quickstart>
- Ollama OpenAI compatibility: <https://docs.ollama.com/api/openai-compatibility>
