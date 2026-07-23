import { makeId, nowIso } from "./constants.js";

const SECRET_PATTERN = /(sk-[a-z0-9_-]{8,}|re_[a-z0-9_-]{8,}|authorization\s*:\s*bearer\s+\S+)/gi;
const SENSITIVE_KEYS = /api.?key|authorization|password|passphrase|secret|token/i;
const FLUSH_BATCH_SIZE = 100;
const DEFAULT_RETRY_AFTER_MS = 5_000;
const MIN_RETRY_AFTER_MS = 1_000;

export function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        SENSITIVE_KEYS.test(key) ? "[REDACTED]" : redact(child)
      ])
    );
  }
  return typeof value === "string" ? value.replace(SECRET_PATTERN, "[REDACTED]") : value;
}

export function createBrowserLogger(repository, api) {
  const pending = [];
  let flushPromise = null;
  let retryTimer = null;
  let nextFlushAt = 0;
  let repositoryFailureLogged = false;
  let flushFailureLogged = false;

  function consoleMethod(level) {
    if (level === "debug") return "debug";
    if (level === "warn") return "warn";
    if (level === "error") return "error";
    return "info";
  }

  function clearRetryTimer() {
    if (!retryTimer) return;
    clearTimeout(retryTimer);
    retryTimer = null;
  }

  function retryDelayMs(error) {
    const delayMs =
      Number.isFinite(error?.retryAfterMs) && error.retryAfterMs >= 0
        ? error.retryAfterMs
        : DEFAULT_RETRY_AFTER_MS;
    return Math.max(MIN_RETRY_AFTER_MS, delayMs);
  }

  function sendBeacon(entries) {
    if (typeof navigator === "undefined" || typeof navigator.sendBeacon !== "function") return false;
    try {
      return navigator.sendBeacon(
        "/api/client-logs",
        new Blob([JSON.stringify({ entries })], { type: "application/json" })
      );
    } catch {
      return false;
    }
  }

  function warnFailure(event, error, metadata = {}, { once = false, kind = "general" } = {}) {
    if (once) {
      if (kind === "repository" && repositoryFailureLogged) return;
      if (kind === "flush" && flushFailureLogged) return;
      if (kind === "repository") repositoryFailureLogged = true;
      if (kind === "flush") flushFailureLogged = true;
    }
    console.warn(`[${event}]`, {
      message: error?.message || String(error),
      metadata: redact(metadata)
    });
  }

  async function log(level, event, metadata = {}) {
    const severity = level === "warn" ? "warning" : level;
    const entry = {
      id: makeId("log"),
      timestamp: nowIso(),
      level,
      severity,
      event,
      correlationId: makeId("corr"),
      metadata: redact(metadata)
    };
    console[consoleMethod(level)]?.(`[${event}]`, entry.metadata);
    await repository.put("logs", entry).catch((error) => {
      warnFailure("browser_log_repository_failed", error, { event, level }, { once: true, kind: "repository" });
    });
    pending.push(entry);
    if (pending.length >= 10) await flush();
    return entry;
  }

  async function flush({ force = false } = {}) {
    if (!pending.length) return;
    if (flushPromise) return flushPromise;
    if (!force && nextFlushAt > Date.now()) return;
    const entries = pending.splice(0, FLUSH_BATCH_SIZE);
    if (force) {
      if (sendBeacon(entries)) {
        nextFlushAt = 0;
        clearRetryTimer();
        if (pending.length >= 10 && nextFlushAt <= Date.now()) void flush();
      } else {
        pending.unshift(...entries);
      }
      return;
    }
    flushPromise = api("/api/client-logs", {
      method: "POST",
      body: JSON.stringify({ entries }),
      logErrors: false
    })
      .then(() => {
        nextFlushAt = 0;
        clearRetryTimer();
      })
      .catch((error) => {
        const delayMs = retryDelayMs(error);
        nextFlushAt = Date.now() + delayMs;
        warnFailure("browser_log_flush_failed", error, { count: entries.length, retryAfterMs: delayMs }, {
          once: true,
          kind: "flush"
        });
        pending.unshift(...entries);
        clearRetryTimer();
        retryTimer = setTimeout(() => {
          retryTimer = null;
          flush().catch(() => {});
        }, delayMs);
      })
      .finally(() => {
        flushPromise = null;
        if (pending.length >= 10 && nextFlushAt <= Date.now()) void flush();
      });
    return flushPromise;
  }
  return {
    log,
    flush,
    debug: (event, metadata) => log("debug", event, metadata),
    info: (event, metadata) => log("info", event, metadata),
    warn: (event, metadata) => log("warn", event, metadata),
    error: (event, metadata) => log("error", event, metadata)
  };
}
