# AGENTS.md

This repository is a local-first browser app with a loopback Express gateway. If a nested `AGENTS.md` appears later, its instructions override this file within that subtree.

## Project Overview

- `public/app.js` is the browser entry point. The browser owns mutable user state in IndexedDB and uses OPFS only as an optional large-artifact staging layer.
- `server.js` starts the loopback gateway, configures request timeouts, and installs graceful shutdown handling.
- `src/app.js` assembles the app context, logger, database, security middleware, routes, model sync, batch manager, and runtime credential manager.
- The Express process is an execution gateway for provider calls, headless-browser research, Resend, model discovery, logging, and read-only legacy migration. Ordinary projects, records, results, and exports are not persisted there.
- SQLite under `storage/` is legacy and migration infrastructure only. The browser remains the source of truth for current app data.
- Runtime targets are Node.js 22.12+ and npm 10+, plus current stable Chromium, Firefox, and WebKit/Safari equivalents with IndexedDB, Web Crypto, AbortController, and ES modules.
- Keep the server bound to loopback. Public deployment is unsupported unless the threat model is redesigned and protected by authenticated network controls.

## Repository Map

- `src/ai/`: provider registry, model catalog sync, provider adapters, provider-batch support, response parsing, and structured email generation.
- `src/batch/`: job state, retry policy, and batch orchestration.
- `src/data/`: importers, normalizers, validators, and static JS parsing for data ingestion.
- `src/output/`: email sanitization, rendering, delivery/export helpers, contact actions, and addendum preparation.
- `src/research/`: contact discovery, hardened document and website fetchers, network policy, search fallback, and content extraction.
- `src/persistence/`: SQLite database setup, ordered migrations, restart recovery, and repositories for projects, records, jobs, results, research cache, model catalog, and gateway auditing.
- `storage/migrations/`: source-controlled SQL migrations. Generated `storage/*.sqlite*` files are ignored and should not be edited as source.
- `src/security/`: request policy, runtime credential manager, credential catalog, and test credential helpers.
- `src/middleware/`: request ID assignment, security enforcement, and HTTP error handling.
- `src/routes/`: route groups for health, data, templates, addenda, processing, results, model catalog, projects, credentials, gateway, migration, diagnostics, and Resend.
- `src/lifecycle/`: shutdown coordination and drain handling.
- `config/app.config.js`, `config/providers.config.js`, and `.env.example`: environment parsing and defaults. Update these together when a setting changes.
- `public/`: browser UI, styles, worker code, and browser-side modules for storage, backup, logging, provider-batch state, editors, and exports.
- `tests/unit/`, `tests/integration/`, `tests/edge/`, `tests/regression/`, `tests/security/`, and `tests/e2e/`: the tracked test suites and browser flows.
- `tests/helpers/` and `tests/fixtures/`: shared harnesses and input fixtures.
- `scripts/`: verification, secret scanning, Playwright section runners, and live credential setup/cleanup.
- `docs/`: authoritative architecture, storage, backup, migration, provider, testing, security, troubleshooting, performance, and requirements documentation.
- `docs/security/research-fetch-hardening.md`: detailed note for the hardened public-fetch policy.
- `prompts/` and `addenda/`: runtime prompt and addendum content used by the app.
- `ai-prompts/`: historical implementation briefs only. They are not the source of truth for the current app.
- `data/`: bundled sample import data, including `data/restaurants.js` and `data/samples/`.
- `logs/`, `output/`, `coverage/`, `test-results/`, `playwright-report/`, and `.inspect/`: generated artifacts. Do not commit them.

## Setup And Commands

### Prerequisites

- Install Node.js 22.12 or newer and npm 10 or newer.
- Run commands from the repository root.
- Install Playwright browsers when running the browser suite on a fresh machine: `npx playwright install --with-deps chromium firefox webkit`.
- The app serves on loopback by default. `npm start` listens on `http://127.0.0.1:3000`, and `npm run test:e2e` uses `http://127.0.0.1:3200` via `tests/e2e/start-server.mjs`.

### Local Setup And Run

| Command                       | Purpose                   | Notes                                                                                          |
| ----------------------------- | ------------------------- | ---------------------------------------------------------------------------------------------- |
| `npm ci`                      | Install dependencies      | Use a clean install from the repo root.                                                        |
| `Copy-Item .env.example .env` | Create a local env file   | Keep provider secrets out of `.env`; use the app Configuration screen for runtime credentials. |
| `npm start`                   | Start the loopback server | Production-like local start on `127.0.0.1:3000`.                                               |
| `npm run dev`                 | Start watch mode          | Runs `node --watch server.js`.                                                                 |

### Formatting, Linting, And Static Checks

| Command                | Purpose                    | Notes                                                                               |
| ---------------------- | -------------------------- | ----------------------------------------------------------------------------------- |
| `npm run format`       | Reformat the repository    | Prettier write mode.                                                                |
| `npm run format:check` | Check formatting only      | Used by the main verification script.                                               |
| `npm run lint`         | Run ESLint                 | There is no separate TypeScript typecheck script in this repo.                      |
| `npm run scan:secrets` | Scan for committed secrets | Uses the repo-local `.secretscan.json`.                                             |
| `npm run verify`       | Run the non-browser gate   | Executes `format:check`, `lint`, `scan:secrets`, and `test:coverage` in that order. |

### Tests

| Command                               | Purpose                           | Notes                                                                                                                  |
| ------------------------------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `npm test`                            | Run the full Vitest suite         | Includes unit, integration, edge, regression, and security tests. Uses `NODE_ENV=test AI_MOCK=true`.                   |
| `npm run test:unit`                   | Run unit tests                    | Focused on parsers, renderers, storage helpers, repositories, logging, limits, retry policy, and performance coverage. |
| `npm run test:integration`            | Run integration tests             | Covers routes, persistence, gateway flows, backup/restore, model sync, and provider-batch recovery.                    |
| `npm run test:regression`             | Run regression tests              | Covers previously fixed UI, output, HTTP, and provider behaviors.                                                      |
| `npm run test:edge`                   | Run edge-case tests               | Covers malformed, empty, oversized, boundary, and failure-path inputs.                                                 |
| `npm run test:security`               | Run security tests                | Covers request policy, SSRF controls, sanitization, and other security boundaries.                                     |
| `npm run test:coverage`               | Run Vitest with coverage          | Uses V8 coverage and enforces thresholds from `vitest.config.js`.                                                      |
| `npm run test:e2e`                    | Run the Playwright browser suite  | Boots `tests/e2e/start-server.mjs`, uses port `3200`, and exercises Chromium, Firefox, and WebKit projects.            |
| `npm run test:e2e:01`                 | Core browser workflows            | Runs `tests/e2e/app.spec.js`.                                                                                          |
| `npm run test:e2e:02`                 | Multi-tab and batch workflows     | Runs `tests/e2e/multi-tab.spec.js` and `tests/e2e/provider-batch.spec.js`.                                             |
| `npm run test:e2e:03`                 | Responsive layout checks          | Runs `tests/e2e/responsive-layout.spec.js`.                                                                            |
| `npm run test:e2e:04`                 | Live credential checks            | Runs `tests/e2e/live-credentials.spec.js`.                                                                             |
| `npm run test:e2e:live`               | Protected live Playwright suite   | Requires `RUN_LIVE_E2E=true` and real test credentials.                                                                |
| `npm run test:e2e:section -- 01`      | Generic Playwright section runner | Pass extra Playwright args after the section number when you need a focused slice.                                     |
| `npm run test:credentials:install`    | Install live-test credentials     | Stores rotated credentials in the OS credential store.                                                                 |
| `npm run test:credentials:list`       | List live-test credentials        | Confirms which providers are configured.                                                                               |
| `npm run test:credentials:remove`     | Remove live-test credentials      | Accepts one or more `--provider` flags.                                                                                |
| `npm run test:credentials:remove-all` | Remove all live-test credentials  | Clears the OS credential store entries used by live E2E.                                                               |
| `npm audit --audit-level=low`         | Release hardening check           | Not part of CI, but run before release or handoff.                                                                     |

### Full Local CI Equivalent

1. `npm ci`
2. `npx playwright install --with-deps chromium firefox webkit`
3. `npm run verify`
4. `npm run test:e2e`
5. `npm audit --audit-level=low` before release or sign-off

## Coding Standards

- Use ES modules and the repository's existing named-export style.
- Keep route handlers thin. Put persistence logic in repositories, browser-specific logic in `public/modules/`, and domain logic in `src/ai/`, `src/output/`, `src/research/`, or `src/data/`.
- Preserve the browser/server ownership boundary. The browser owns mutable app data; the server owns ephemeral gateway work, runtime credentials in process memory, rotating logs, and migration helpers.
- Validate input at trust boundaries with the existing helpers and patterns: `AppError`, request-policy checks, Zod config parsing, sanitizers, URL helpers, and repository invariants.
- Reuse nearby patterns instead of inventing new abstractions. Small, targeted changes are preferred over broad rewrites.
- Keep async work bounded with configured deadlines, retry limits, backoff, cancellation, and concurrency gates.
- Use transactions, revision checks, and ordered migrations for persistence changes. Update `storage/migrations/` when schema behavior changes.
- Preserve accessibility and responsive behavior in the browser UI. Follow the established split-pane, keyboard, focus, and ARIA patterns already in the `public/` code.
- Keep comments short and only where the logic is not obvious.
- Avoid new dependencies unless an existing library cannot reasonably solve the problem.
- Update `.env.example`, config loaders, and the docs whenever a command, environment variable, or user-visible behavior changes.

## Logging And Observability

- Use `context.logger` on the server and `public/modules/logger.js` in the browser. Do not scatter ad hoc logging throughout application code.
- Server logging goes to stdout and to a rotating gzip file under `LOG_DIR` and `LOG_FILE_NAME`. `LOG_LEVEL`, `LOG_MAX_SIZE`, and `LOG_MAX_FILES` control verbosity and growth.
- Browser diagnostics are redacted, stored locally, and flushed to `/api/client-logs` with retry/backoff. Keep that path working when changing client telemetry.
- Include useful context such as `requestId`, correlation IDs, component names, provider IDs, job IDs, batch IDs, operation names, and status fields where they help diagnosis.
- Log startup, shutdown, request start/completion, security accept/reject decisions, retries, fallbacks, state transitions, background jobs, and unexpected failures.
- Redact API keys, credentials, authorization headers, cookies, tokens, passwords, message bodies, and prospect data. Preserve the existing redaction helpers and tests.
- Keep log volume bounded. Do not add duplicate noisy logs or unbounded debug output.
- If file logging fails, preserve console logging and degrade safely. The current logger emits a one-time warning on file-stream errors, but startup still depends on the log directory being writable.
- Update or add tests when changing log formatting, redaction, rotation, or failure handling.

## Error Handling And Resilience

- Validate inputs at every trust boundary. Use the existing request-policy layer, config schema checks, sanitizers, and parser helpers rather than ad hoc validation.
- Return safe, user-facing error messages. Keep request IDs in error responses and preserve the original cause in logs and structured error details.
- Honor deadlines, idle timeouts, cancellation, and bounded retries. Use retries only for transient, idempotent failures and keep `Retry-After` behavior intact where applicable.
- Keep optional provider, search, Resend, logging-sink, and local-resource failures degradable when a fallback path exists.
- Clean up sockets, timers, database connections, and background jobs during shutdown and failure recovery. Follow `src/lifecycle/shutdown.js`.
- Use atomic transactions or compare-and-swap for state changes that must not partially commit. Avoid silent data loss.
- Do not hide programming errors or corrupted invariants. Those must remain visible in logs and tests.
- Add tests for failure, timeout, malformed-response, partial-success, retry, and restart-recovery paths whenever you touch those flows.

## Testing Strategy

| Area                  | Command                                          | Scope                                                                                                              | When to run                                                                   |
| --------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| Verification gate     | `npm run verify`                                 | Format check, lint, secret scan, and coverage                                                                      | Before handoff, before PRs, and after broad code changes.                     |
| Unit tests            | `npm test` or `npm run test:unit`                | Parsers, renderers, helpers, repositories, logger behavior, limits, retry policy, and performance-sensitive logic  | For most code changes.                                                        |
| Integration tests     | `npm run test:integration`                       | HTTP routes, persistence, gateway flows, backup/restore, model sync, and provider-batch recovery                   | When changing API boundaries, persistence, or external-service orchestration. |
| Edge tests            | `npm run test:edge`                              | Malformed, empty, oversized, and boundary inputs                                                                   | When changing import, export, validation, parsing, or request handling.       |
| Regression tests      | `npm run test:regression`                        | Previously fixed bugs and UI/output behaviors                                                                      | When touching areas that already had a bug fix or compatibility concern.      |
| Security tests        | `npm run test:security`                          | Request policy, SSRF protection, sanitization, and unsafe-input handling                                           | When changing trust-boundary logic or security-sensitive code.                |
| Coverage              | `npm run test:coverage`                          | V8 coverage for `src/`                                                                                             | When changing shared logic or before merge.                                   |
| Secret scan           | `npm run scan:secrets`                           | Repo-local secret detection                                                                                        | Before commit or whenever fixtures, docs, or sample data change.              |
| Browser E2E           | `npm run test:e2e`                               | End-to-end browser workflows, reload persistence, exports, responsive layouts, and axe-backed accessibility checks | For UI, storage, export, or browser-flow changes.                             |
| E2E section 01        | `npm run test:e2e:01`                            | Core browser workflows                                                                                             | For targeted browser workflow checks.                                         |
| E2E section 02        | `npm run test:e2e:02`                            | Multi-tab and provider-batch workflows                                                                             | When working on jobs, provider-batch, or cross-tab state.                     |
| E2E section 03        | `npm run test:e2e:03`                            | Responsive layout checks                                                                                           | When changing CSS, panes, or viewport behavior.                               |
| E2E section 04 / live | `npm run test:e2e:04` or `npm run test:e2e:live` | Protected live-credential coverage                                                                                 | Only with rotated low-privilege credentials and explicit intent.              |

- Automated suites must stay deterministic and isolated. They should not contact live paid providers unless the test is explicitly an opt-in live suite.
- Vitest runs with `NODE_ENV=test AI_MOCK=true` by default. Keep that mock boundary intact.
- `npm run test:e2e` uses `tests/e2e/start-server.mjs`, which creates an isolated temporary SQLite database under the system temp directory.
- Keep `tests/unit/performance.test.js` and the browser performance checks up to date when changing table rendering, import size handling, or other performance-sensitive code.
- If a check cannot be run, say so explicitly and explain why.

## Change Workflow

1. Read the relevant code, tests, docs, and any scoped instructions first.
2. Check `git status` and preserve unrelated work.
3. Identify the smallest coherent change.
4. Add or update tests with the implementation.
5. Implement using the existing repository patterns.
6. Run focused checks first.
7. Run the broader required checks before handoff.
8. Review the final diff for correctness, security, compatibility, and accidental changes.
9. Update docs and config examples whenever behavior, setup, APIs, or commands change.

When asked to make a change, continue through implementation and verification unless you are blocked by missing information or an unsafe assumption.

## Git And Workspace Safety

- Never discard, overwrite, or revert unrelated user changes.
- Avoid destructive Git operations unless the user explicitly authorizes them.
- Prefer targeted edits over broad rewrites.
- Do not commit generated files, secrets, logs, databases, coverage, or other local artifacts unless the repository explicitly tracks them.
- Do not amend commits, create commits, push branches, or open pull requests unless requested.
- Inspect the diff before reporting completion.
- If concurrent changes directly conflict with the requested work, stop and ask for direction.

## Security And Privacy

- Never commit credentials or secrets. Do not put provider API keys in `.env`.
- Use the existing runtime credential flow in the app Configuration screen, and use the OS credential store or protected environment variables for live E2E credentials.
- Treat provider, search, webhook, website, and imported data as untrusted input.
- Keep path traversal, request forgery, unsafe redirects, arbitrary file access, and command injection protections in place.
- Redact sensitive values from logs, diagnostics, errors, exports, and sample data.
- Bind to loopback only unless the deployment model has been intentionally redesigned for a secure public environment.
- Keep dependency and secret scans passing.
- Do not transmit user data to third parties unless the application explicitly does so and the user has authorized that path.

## Documentation Requirements

- Update the relevant documentation whenever you change setup, commands, environment variables, APIs, routes, provider support, persistence, schemas, logging, user-visible behavior, tests, or deployment-related behavior.
- The main docs to keep current are `README.md`, `docs/ARCHITECTURE.md`, `docs/TESTING.md`, `docs/SECURITY.md`, `docs/PROVIDERS.md`, `docs/BROWSER_STORAGE.md`, `docs/BACKUP_FORMAT.md`, `docs/MIGRATION.md`, `docs/PERFORMANCE.md`, `docs/TROUBLESHOOTING.md`, `VERSIONS.md`, and `CHANGELOG.md`.
- Document actual behavior only. Do not promise unfinished functionality.

## Definition Of Done

- The requested behavior is implemented.
- Existing behavior remains compatible unless the change was intentional.
- Relevant success, failure, edge, regression, and security tests are present and pass, or any missing check is explained.
- Required focused checks and broader gates have been run.
- Logging is useful, bounded, and free of secrets.
- Failures degrade safely where possible.
- Documentation and configuration examples are current.
- The final diff contains no unrelated changes.
- Any unresolved uncertainty is called out explicitly.
