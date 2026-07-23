# Security and credential threat model

## Intended deployment

This is a single-user local application. Bind to `127.0.0.1`; a public bind changes the threat model and is unsupported without an authenticated reverse proxy, TLS, network access controls, and a public webhook design. The gateway checks loopback use, same-origin `Origin`, CSRF tokens, bounded payloads, and security headers.

## Canonical request policy

- All unsafe `/api` requests go through the shared request-policy layer before and after body parsing.
- Mutable browser requests must use a loopback `Host`, a matching same-origin `Origin` when present, the CSRF token, and must not include duplicate `Host`, `Origin`, `Content-Type`, or `Content-Encoding` headers.
- Method-override headers, `_method` query parameters, and method-override body fields are rejected.
- The signed `/api/gateway/resend/webhook` route is the only unsafe exception. It still requires a verified Resend/Svix signature and is not a general-purpose bypass.
- Once shutdown begins, new mutable work is rejected with `SERVER_SHUTTING_DOWN` while active requests drain or time out.

## Runtime credentials

- Provider credentials are entered through the Configuration screen and sent only to the loopback backend.
- The backend stores them only in process memory and clears them on explicit removal or process shutdown.
- Credential values are never returned by configuration endpoints, browser bootstrap payloads, diagnostics, exports, or backups.
- The legacy browser `secrets` store is deleted during schema upgrade and is no longer used for provider credentials.
- Live E2E credentials resolve only from protected process environment variables or the operating-system credential store.

This prevents browser persistence and Git leakage, but it does not protect against a compromised local machine, malicious extensions, malware, devtools access, or host-memory inspection. Any credential exposed in chat, logs, screenshots, OneDrive sync, or Git history must be revoked and rotated.

## Content and network controls

- CSP blocks objects/frames/base injection and limits script/style/connect/form sources.
- AI/addendum/editor HTML passes strict tag, attribute, URL, and CSS-property allowlists; scripts, handlers, dangerous URLs, remote CSS, and unsupported layout declarations are removed.
- Research validates HTTP(S), redirects, DNS results, and browser subresources against loopback/private/link-local/multicast/reserved ranges; it bounds time, redirects, type, and bytes.
- The research-fetch hardening note in [`docs/security/research-fetch-hardening.md`](security/research-fetch-hardening.md) documents the current connect-time policy, degraded-result semantics, and traceability matrix.
- Website research and the Google Sheets CSV import helper both use the shared public-address policy, pin numeric targets, verify the connected socket address, and revalidate redirects instead of falling back to a weaker fetch path.
- Contact-page failures during research are reported as degraded, not silently merged into a successful result.
- Ollama accepts loopback only. A non-default loopback host requires explicit confirmation.
- Custom provider endpoints require explicit trust; remote endpoints require HTTPS and URLs cannot embed credentials/query/fragment.
- Imported JavaScript is parsed as constrained static data and never executed.
- Website text is delimited and labeled untrusted before it reaches an AI prompt.

## Logs and diagnostics

Application/browser logs are structured and recursively redact secret-shaped fields, authorization values, and common key formats. Browser diagnostic entries and metadata sizes are bounded. Generation prompts, complete email bodies, credentials, and request headers are not intentionally logged. Production errors suppress stack traces.

## Backups and webhooks

Backups reject traversal, decompression bombs, invalid checksums/schema, prototype keys, and malformed categories. Provider credentials are excluded from backups and diagnostics. Resend webhook signatures use the official verification mechanism and Svix delivery IDs are deduplicated before storage.

Report a suspected exposure by clearing the affected runtime credential, stopping the server, rotating affected provider keys, preserving redacted diagnostics, and reviewing browser extensions and host integrity.
