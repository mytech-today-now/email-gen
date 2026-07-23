# Research Fetch Hardening

## Scope

This note covers the public-website research path, the related contact-page discovery flow, and every other repository network entry point that can consume a user-influenced URL. The current implementation is HTTP-based rather than Chromium-based for website research, so the browser-containment discussion here is a forward-looking safety requirement for any future rendered mode or browser-backed pricing/catalog scraping.

## Assets

- Imported records and their normalized website/contact fields.
- Research cache entries, extracted text, and contact candidates.
- Provider credentials and runtime configuration.
- Local-only gateway state, logs, and database rows.
- Downstream prompt/input text built from research output.

## Actors

- End user on the local browser UI.
- Loopback Express gateway.
- Research fetcher and contact-page discovery pipeline.
- Google Sheets import helper.
- Provider and search APIs.
- Future browser launcher or pricing scraper hooks.

## Entry Points

- `POST /api/records/import-url` for Google Sheets CSV imports.
- `collectResearch()` for website research during generation and batch processing.
- `searchPublicContacts()` for external search-assisted contact discovery.
- Provider discovery and provider-batch helpers that call fixed remote APIs.

## Trust Boundaries

- All imported URLs are adversarial until normalized and classified.
- DNS answers are adversarial until the selected address is pinned.
- Redirect targets are adversarial and must be revalidated.
- Research output is untrusted data and must never become executable instruction.
- Logs, prompts, and UI state must never carry secrets or raw page bodies.

## Data Flow

1. User input reaches the gateway as a website URL or a Google Sheets CSV URL.
2. The URL is parsed with WHATWG URL semantics and rejected if it contains credentials, unsupported schemes, or invalid syntax.
3. The hostname is resolved through the controlled resolver path.
4. Every DNS result is classified with the shared public-routability policy.
5. If any answer or CNAME target is blocked, ambiguous, or non-public, the request fails closed.
6. One numeric public address is selected and pinned for that request.
7. The connection is opened directly to the numeric address, while Host/SNI remain bound to the normalized hostname.
8. The connected socket address is verified against the pinned address before any body is trusted.
9. Redirects are revalidated one hop at a time with the same policy.
10. Transfer limits are enforced while streaming, before whole-body allocation.
11. Extracted text is bounded, sanitized, and stored as untrusted research content.

## Security Invariants

- Authorization happens at connection time, not only before connection.
- Every DNS resolution, redirect, origin transition, and new socket is independently governed.
- Approved hostnames are never passed to a lower layer that can re-resolve them outside policy.
- The actual connected remote address is verified and recorded.
- Unknown, malformed, ambiguous, or non-public destinations are denied by default.
- Security-policy failures never fall back to a weaker fetch path.
- Research failure is explicit and distinguishable from success, static-only, or disabled modes.

## Connect-Time Enforcement

The preferred architecture is a local, controlled resolver/proxy boundary implemented in the request layer. The key property is that the application resolves and classifies the hostname, chooses a numeric destination, and then connects to that numeric destination without allowing a second hostname lookup. Redirects repeat the same logic. This closes the validation-to-connection TOCTOU gap because the policy decision is tied to the socket that is actually opened, not to a preflight check that another layer can invalidate.

Where a browser-backed mode is introduced later, it must use the same connect-time policy and must not be able to reach the network except through the controlled enforcement layer.

## Browser Containment

The current website research path does not launch Chromium. If a rendered mode is added later, it must:

- Start with sandboxing enabled.
- Fail closed if the sandbox cannot be proven safe.
- Use strict TLS validation.
- Use ephemeral profiles and isolated contexts.
- Deny permissions, downloads, workers, WebRTC, and unsupported schemes by default.
- Avoid direct egress paths outside the controlled resolver/proxy.

## Resource Budgets

The implementation must enforce bounded:

- Response bytes and decompressed bytes.
- Page and record byte totals.
- Redirect count and unique origin count.
- Request count, socket count, and contact-page count.
- Job time and per-request time.
- Extracted text size.

Limits are enforced during transfer, not after the full body has been buffered.

## Failure Modes

- `INVALID_URL` for malformed or unsupported URL input.
- `FORBIDDEN_DESTINATION` or equivalent for blocked DNS or address classes.
- `DNS_RESOLUTION_FAILURE` for resolution failures.
- `TLS_VALIDATION_FAILURE` for certificate problems.
- `RESEARCH_RESPONSE_TOO_LARGE` and related size errors for transfer limits.
- `RESEARCH_TIMEOUT` for aborts and deadlines.
- `RESEARCH_FETCH_FAILED` for unexpected safe failures.

Failure is isolated to the affected record when possible. Optional research should continue in a disabled or degraded state rather than crashing the batch.

## Operational Requirements

- Loopback-only gateway binding remains the default.
- Logs must remain structured, redacted, and bounded.
- External network calls must be testable with deterministic local fixtures.
- Security regressions must fail in CI rather than being silently skipped.

## Testing Strategy

The required coverage is split into deterministic local fixtures and repository-level regression tests:

| Requirement group                                                    | Test files                                                                                                                        | Commands                                                                |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Public/private DNS, redirects, rebinding, and address classification | `tests/security/security.test.js`, `tests/edge/browserResearchEdge.test.js`, `tests/regression/browserResearchRegression.test.js` | `npm run test:security`, `npm run test:edge`, `npm run test:regression` |
| Streaming limits and decompression bombs                             | `tests/edge/browserResearchEdge.test.js`                                                                                          | `npm run test:edge`                                                     |
| Research success, cache, and failure behavior                        | `tests/regression/browserResearchRegression.test.js`                                                                              | `npm run test:regression`                                               |
| Contact extraction and URL sanitization                              | `tests/unit/contactExtractor.test.js`, `tests/unit/browserArchitecture.test.js`                                                   | `npm run test:unit`                                                     |
| Gateway and batch request limits                                     | `tests/integration/gateway.test.js`, `tests/integration/providerBatchRecovery.test.js`                                            | `npm run test:integration`                                              |
| UI state and bounded browser workflows                               | `tests/e2e/app.spec.js`, `tests/e2e/provider-batch.spec.js`, `tests/e2e/responsive-layout.spec.js`                                | `npm run test:e2e`                                                      |
| Logging redaction and diagnostics                                    | `tests/integration/gateway.test.js`                                                                                               | `npm run test:integration`                                              |
| Static analysis and formatting                                       | repository scripts                                                                                                                | `npm run lint`, `npm run format:check`                                  |

## Residual Risks

- A real browser-rendered research mode, if introduced later, will still inherit renderer-exploit risk even with sandboxing and network policy.
- Local host compromise, browser extensions, and devtools access remain out of scope.
- Third-party provider and search APIs can fail, rate-limit, or change formats.
