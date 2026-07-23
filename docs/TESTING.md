# Testing

## Commands

| Command                                 | Scope                                                                                     |
| --------------------------------------- | ----------------------------------------------------------------------------------------- |
| `npm run verify`                        | formatting, lint, secret scan, and Vitest coverage                                        |
| `npm test`                              | all Vitest unit, integration, edge, regression, and security tests                        |
| `npm run test:unit`                     | parsers, storage-oriented utilities, HTML, contacts, runtime credentials, pricing, Resend |
| `npm run test:integration`              | HTTP routes, CSRF/runtime-credential boundary, persistence, export/gateway flows          |
| `npm run test:edge`                     | malformed/large inputs, empty fields, network and format boundaries                       |
| `npm run test:regression`               | previously fixed UI/output/project behaviors                                              |
| `npm run test:security`                 | SSRF, static-JS import, error and sanitization controls                                   |
| `npm run test:e2e`                      | Playwright browser workflows and responsive layouts                                       |
| `npm run test:e2e:01`                   | core browser workflows (`tests/e2e/app.spec.js`)                                         |
| `npm run test:e2e:02`                   | multi-tab and batch workflows (`tests/e2e/multi-tab.spec.js`, `tests/e2e/provider-batch.spec.js`) |
| `npm run test:e2e:03`                   | responsive layout checks (`tests/e2e/responsive-layout.spec.js`)                         |
| `npm run test:e2e:04`                   | protected live credential checks (`tests/e2e/live-credentials.spec.js`)                  |
| `npm run test:e2e:live`                 | protected live Playwright suite (`RUN_LIVE_E2E=true`)                                     |
| `npm run scan:secrets`                  | repo-local secret scan for committed credentials, tokens, and private keys                |
| `npm run test:credentials:install`      | one-time OS credential-store setup for live E2E                                           |
| `npm run test:credentials:list`         | configured/unconfigured live-test credential status                                       |
| `npm run test:credentials:remove`       | remove one or more stored live-test credentials                                           |
| `npm run test:credentials:remove-all`   | clear all stored live-test credentials                                                    |
| `npm run test:coverage`                 | V8 coverage report                                                                        |
| `npm run lint` / `npm run format:check` | static and formatting gates                                                               |

The generic dispatcher `npm run test:e2e:section -- 01` also works and forwards extra Playwright flags, so you can do things like `npm run test:e2e:section -- 02 --project=chromium --workers=1`.

## Coverage Matrix

| Area                            | Representative suites                                                                                                      |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Shared limit profile            | `tests/unit/limits.test.js`, `tests/unit/backup.test.js`                                                                   |
| Bounded response reads          | `tests/unit/responseBodies.test.js`, `tests/unit/resendGateway.test.js`                                                    |
| Backup export/restore           | `tests/unit/backup.test.js`, `tests/integration/backupRestore.test.js`                                                     |
| Browser archive streaming       | `tests/unit/browserArchitecture.test.js`                                                                                   |
| Canonical unsafe-request policy | `tests/security/requestPolicy.test.js`                                                                                     |
| Provider batching and recovery  | `tests/unit/resendGateway.test.js`, `tests/integration/providerBatchRecovery.test.js`, `tests/integration/gateway.test.js` |
| Model discovery and sync        | `tests/unit/browserArchitecture.test.js`, `tests/integration/modelSync.test.js`                                            |

Tests run with `NODE_ENV=test AI_MOCK=true`; paid providers are not contacted. Resend, OpenRouter, Ollama, direct provider, discovery responses, and provider-batch endpoints are mocked at the fetch boundary. Coverage now includes batch capability normalization, OpenAI Batch pricing parsing, and gateway batch submit/status/cancel flows in addition to Resend eligibility, dedupe, 100-item batching, idempotency, transient retry, and signed webhook dedupe.

The test harness also raises the API-request rate ceiling in test mode so large suites can run quickly without hitting the normal production ceiling.

`npm run verify` is the default local and CI non-browser gate. It is the command to reach for first when checking formatting, lint, secret scanning, and coverage together. CI then installs Playwright browsers and runs the browser suite separately.

Live E2E must use rotated low-privilege credentials installed once in the OS credential store or injected through protected process environment variables. The resolver order is:

1. Protected process environment variable
2. Operating-system credential store
3. Credential unavailable

The regression suites also cover the canonical two-record restaurant JSON fixture, malformed JSON import diagnostics with line/column reporting, legacy `**Subject:**` provider replies, phone/website contact actions, and protection against recipient-visible `undefined`, `null`, `NaN`, or unresolved placeholders in standalone HTML exports.

Playwright exercises import → catalog selection → processing → editing → copy → export → reload; inspects ZIP contents; verifies standalone contact actions; operates split panes by keyboard; checks template CRUD/configuration/backup; and runs axe. Responsive tests run Chromium, Firefox, and WebKit projects at desktop/tablet/mobile sizes. When you only need a slice, run `npm run test:e2e:01`, `02`, `03`, or `04` instead of the full suite.

Accessibility targets WCAG 2.2 AA. Automated axe checks supplement—rather than replace—keyboard-only, screen-reader, zoom/reflow, contrast, focus order, dialog focus restoration, reduced-motion, and email-client manual review.

Before release run the complete command set, `npm audit --audit-level=low`, and a production-mode smoke test on loopback. Live provider and Resend tests must use dedicated test accounts/recipients and must never target real prospect lists.
