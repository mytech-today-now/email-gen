# Provider setup and pricing

## Runtime-managed credentials

Open Configuration → AI Providers, enter the credential, and Save. OpenRouter, Resend, Brave Search, and the Resend webhook secret have dedicated sections. Credentials are sent only to the same-origin loopback gateway, stored in backend memory, and never returned to the browser. Do not place provider secrets in `.env`.

## OpenRouter

Set `OPENROUTER_API_KEY`; optional HTTP-Referer is supported. Refresh calls the documented `/api/v1/models` endpoint. Rows retain canonical ID, provider, modalities, context length, supported parameters, availability, pricing fields, source URL, and verification time. Negative sentinel prices become “variable”; absent fields become “unavailable”; genuine zeroes remain zero. Generation requests strict JSON schema through the OpenAI-compatible chat API. Optional routing preferences pass through separately from model selection.

## Ollama

Install and start Ollama, then use `http://127.0.0.1:11434`, `http://localhost:11434`, or `http://[::1]:11434`. Detect calls `/api/tags`; generation calls `/api/chat` with a JSON schema `format`. Approved localhost hosts work without an API key or extra confirmation; other loopback origins still require explicit confirmation. Catalog prices read “Local compute cost; no provider token price.” Detected models are treated as ready for local structured generation.

## Direct and custom providers

OpenAI, Anthropic, xAI, Venice, and Luma pricing are refreshed from their official documentation pages with a headless Chromium scrape during model sync. This fills in current source-attributed pricing even when the provider’s model-discovery endpoint omits price metadata. OpenAI specifically uses `https://developers.openai.com/api/docs/pricing`. OpenAI, Anthropic, xAI, and Venice use runtime credentials from the Configuration screen. A custom OpenAI-compatible base URL and optional key are supported after explicit trust; remote custom URLs must use HTTPS. Image/audio/video-only models are visible for catalog accuracy but disabled for structured email generation.

## Native provider batch support

The catalog now stores normalized `pricing.batch` metadata so the browser can distinguish verified discounted native batch support from ordinary synchronous APIs.

| Provider                                 | Classification behavior                                                                                        | Notes                                                                             |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| OpenAI                                   | `native_discounted_batch` only when the official pricing page includes a Batch row for the model               | Uses uploaded JSONL plus `/v1/batches`; 24h completion window; one model per file |
| Anthropic                                | `native_discounted_batch` for explicitly verified current Claude models; otherwise `unavailable_or_unverified` | Uses Message Batches; 50% pricing; 24h expiry; JSONL results                      |
| xAI                                      | `native_discounted_batch` only for explicitly verified discounted models; some models are explicitly excluded  | Results are paginated and reconciled by `batch_request_id`                        |
| Venice, LumaAI, OpenRouter, Ollama, Mock | `standard_api_only`                                                                                            | No verified discounted provider-side batch service for this email workflow        |
| Custom                                   | `unavailable_or_unverified`                                                                                    | Tenant-specific docs are required before native batch can be enabled safely       |

Processing execution modes:

- `auto`: use verified discounted provider batch when available; otherwise use the standard API
- `provider-batch`: require verified native discounted batch support and fail fast if the selected model is not eligible
- `standard`: always use the existing synchronous per-record gateway flow

See [batch-processing-plan.md](batch-processing-plan.md) for the full capability matrix, limits, and source inventory.

## Brave Search fallback

Set `BRAVE_SEARCH_API_KEY`. The gateway calls the official Web Search API only after bounded first-party website discovery yields no candidate. Search-derived candidates are labeled external and never count as consent.

## Resend

Set `RESEND_API_KEY` and, for webhooks, `RESEND_WEBHOOK_SECRET`. Test Connection queries verified domains. Batches contain at most 100 messages and use a stable idempotency key. `Retry-After` is honored for 429/5xx; permanent errors are returned without automatic retry. See the README compliance section before enabling any send.

## Source and freshness policy

Pricing is descriptive metadata, not a bill guarantee. Every displayed price has status/source/time. Stale cached data remains labeled stale and refresh failures do not silently replace it. Current references: [OpenRouter authentication](https://openrouter.ai/docs/api/reference/authentication), [OpenRouter models](https://openrouter.ai/docs/api/api-reference/models/get-models), [Ollama tags](https://docs.ollama.com/api/tags), [Ollama OpenAI compatibility](https://docs.ollama.com/api/openai-compatibility), [Resend rate limits](https://resend.com/docs/api-reference/rate-limit), and [Brave authentication](https://api-dashboard.search.brave.com/documentation/guides/authentication).
