import { createHash } from "node:crypto";
import { Resend } from "resend";
import { AppError } from "../utils/errors.js";
import {
  RESEND_BATCH_LIMIT,
  buildResendPreflight,
  buildResendReviewFingerprint,
  canonicalResendMessage,
  validateResendComplianceContent,
  resendEligibility,
  splitResendChunks
} from "../../public/modules/resendReview.js";
import { sanitizeEmailHtml } from "../output/sanitizer.js";
import { readBoundedResponseText } from "../utils/responseBodies.js";
export const RESEND_EVENT_TYPES = new Set([
  "email.sent",
  "email.delivered",
  "email.delivery_delayed",
  "email.bounced",
  "email.complained",
  "email.failed",
  "email.suppressed"
]);

export {
  RESEND_BATCH_LIMIT,
  buildResendPreflight,
  buildResendReviewFingerprint,
  resendEligibility,
  validateResendComplianceContent
};

export function parseRetryAfterMs(value, { maxDelayMs = 60_000 } = {}) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) {
    return Math.min(maxDelayMs, Math.max(0, Math.round(seconds * 1000)));
  }
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) return null;
  return Math.min(maxDelayMs, Math.max(0, parsed - Date.now()));
}

function backoffDelayMs(
  attempt,
  { backoffMinMs = 500, backoffMaxMs = 4_000, jitter = 0.2, random = Math.random } = {}
) {
  const exponential = Math.min(backoffMaxMs, backoffMinMs * 2 ** Math.max(0, attempt - 1));
  const jitterMs = Math.floor(exponential * Math.max(0, Math.min(1, jitter)) * random());
  return Math.min(backoffMaxMs, exponential + jitterMs);
}

function sleepWithAbort(ms, signal) {
  if (!Number.isFinite(ms) || ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      cleanup();
      reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    };
    const cleanup = () => {
      if (signal) signal.removeEventListener("abort", onAbort);
    };
    if (!signal) return;
    if (signal.aborted) {
      clearTimeout(timer);
      cleanup();
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function composeAbortSignal(...signals) {
  const filtered = signals.filter(Boolean);
  if (!filtered.length) return null;
  if (typeof AbortSignal.any === "function") return AbortSignal.any(filtered);
  const controller = new AbortController();
  const abort = (signal) => {
    if (controller.signal.aborted) return;
    controller.abort(signal?.reason ?? new DOMException("Aborted", "AbortError"));
  };
  for (const signal of filtered) {
    if (signal.aborted) {
      abort(signal);
      break;
    }
    signal.addEventListener("abort", () => abort(signal), { once: true });
  }
  return controller.signal;
}

function canonicalizeChunkItems(items) {
  return items.map((item) => {
    const sanitizedHtml = sanitizeEmailHtml(item.html);
    if (sanitizedHtml.trim() !== String(item.html ?? "").trim()) {
      throw new AppError(
        "RESEND_CONTENT_NOT_CANONICAL",
        "Email content changed during server safety validation. Review and save the sanitized editor content before sending.",
        400
      );
    }
    return { ...item, html: sanitizedHtml };
  });
}

function chunkPayloadFingerprint(
  items,
  sender,
  { operationId = null, reviewId = null, chunkIndex = 0 } = {}
) {
  const canonicalItems = canonicalizeChunkItems(items);
  const messages = canonicalItems.map((item) => canonicalResendMessage(item, sender));
  const hash = createHash("sha256")
    .update(
      JSON.stringify({
        operationId: operationId ?? null,
        reviewId: reviewId ?? null,
        chunkIndex: Number.isInteger(chunkIndex) ? chunkIndex : null,
        messages
      })
    )
    .digest("hex")
    .slice(0, 40);
  return { hash, messages, canonicalItems };
}

export function idempotencyKeyFor(items, sender, options = {}) {
  return `email-gen/${chunkPayloadFingerprint(items, sender, options).hash}`;
}

function assertBulkSender(sender, itemCount) {
  if (
    itemCount > 1 &&
    (!String(sender.companyAddress ?? "").trim() || !String(sender.unsubscribeUrl ?? "").trim())
  ) {
    throw new AppError(
      "RESEND_BULK_IDENTIFICATION_REQUIRED",
      "Bulk sending requires a company postal address and a valid one-click unsubscribe URL.",
      400
    );
  }
}

export async function sendResendChunk({
  apiKey,
  items,
  sender,
  fetchImpl = fetch,
  maxRetries = 2,
  maxResponseBytes = 500000,
  operationId = null,
  reviewId = null,
  chunkIndex = 0,
  signal = null,
  idempotencyKey = null,
  retryWindowMs = 30_000,
  retryAfterMaxMs = 60_000,
  backoffMinMs = 500,
  backoffMaxMs = 4_000
}) {
  if (!apiKey)
    throw new AppError(
      "RESEND_CREDENTIAL_MISSING",
      "Configure a Resend API key in Configuration before sending.",
      401
    );
  assertBulkSender(sender, items.length);
  const { hash: idempotencyHash, messages } = chunkPayloadFingerprint(items, sender, {
    operationId,
    reviewId,
    chunkIndex
  });
  const computedIdempotencyKey = `email-gen/${idempotencyHash}`;
  if (idempotencyKey && idempotencyKey !== computedIdempotencyKey) {
    throw new AppError(
      "RESEND_IDEMPOTENCY_CONFLICT",
      "The persisted resend idempotency key no longer matches the reviewed request.",
      409,
      {
        expected: idempotencyKey,
        actual: computedIdempotencyKey,
        chunkIndex
      }
    );
  }
  const persistedIdempotencyKey = idempotencyKey ?? computedIdempotencyKey;
  const requestSignal = composeAbortSignal(
    signal,
    typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(30_000) : null
  );
  const startedAt = Date.now();
  let attempt = 0;
  for (;;) {
    let response;
    try {
      response = await fetchImpl("https://api.resend.com/emails/batch", {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
          "idempotency-key": persistedIdempotencyKey,
          "user-agent": "ai-batch-personalizer/2.0"
        },
        body: JSON.stringify(messages),
        signal: requestSignal ?? undefined
      });
    } catch {
      if (signal?.aborted) {
        throw new AppError("RESEND_ABORTED", "Resend delivery was cancelled.", 503);
      }
      if (attempt++ < maxRetries) {
        const retryDelay = Math.min(retryAfterMaxMs, backoffDelayMs(attempt, { backoffMinMs, backoffMaxMs }));
        if (Date.now() - startedAt + retryDelay > retryWindowMs) {
          throw new AppError(
            "RESEND_RETRY_WINDOW_EXCEEDED",
            "Resend retry would exceed the configured retry window.",
            503,
            {
              chunkIndex,
              retryAfterMs: retryDelay,
              attempt,
              retryWindowMs
            }
          );
        }
        await sleepWithAbort(retryDelay, signal);
        continue;
      }
      throw new AppError("RESEND_NETWORK_FAILED", "Resend could not be reached after safe retries.", 502);
    }
    const { text } = await readBoundedResponseText(
      response,
      response.ok
        ? {
            maxBytes: maxResponseBytes,
            deadlineMs: 30_000,
            idleTimeoutMs: 15_000,
            code: "RESEND_RESPONSE_TOO_LARGE",
            message: "Resend response exceeded the configured size limit.",
            status: response.status
          }
        : {
            maxBytes: maxResponseBytes,
            deadlineMs: 30_000,
            idleTimeoutMs: 15_000,
            code: "RESEND_RESPONSE_TOO_LARGE",
            message: "Resend response exceeded the configured size limit.",
            status: response.status
          }
    );
    let payload;
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      payload = {};
    }
    if (response.ok) {
      const rows = payload.data ?? payload;
      if (!Array.isArray(rows) || rows.length !== messages.length) {
        throw new AppError(
          "RESEND_RESPONSE_MALFORMED",
          "Resend returned an unexpected batch payload. Reconcile before retrying.",
          502,
          {
            chunkIndex,
            idempotencyKey: persistedIdempotencyKey
          }
        );
      }
      const deliveries = items.map((item, itemIndex) => ({
        resultId: item.id,
        email: item.primaryEmail,
        resendId: rows[itemIndex]?.id ?? null,
        status: "sent",
        idempotencyKey: persistedIdempotencyKey
      }));
      return {
        deliveries,
        batchCount: 1,
        idempotencyKey: persistedIdempotencyKey,
        rows,
        response: payload
      };
    }
    const transient = response.status === 429 || response.status >= 500;
    if (transient && attempt++ < maxRetries) {
      const providerDelay = parseRetryAfterMs(response.headers.get("retry-after"), {
        maxDelayMs: retryAfterMaxMs
      });
      const retryDelay = Math.min(
        retryAfterMaxMs,
        Math.max(providerDelay ?? 0, backoffDelayMs(attempt, { backoffMinMs, backoffMaxMs }))
      );
      if (Date.now() - startedAt + retryDelay > retryWindowMs) {
        throw new AppError(
          "RESEND_RETRY_WINDOW_EXCEEDED",
          "Resend retry would exceed the configured retry window.",
          503,
          {
            chunkIndex,
            retryAfterMs: retryDelay,
            attempt,
            retryWindowMs
          }
        );
      }
      await sleepWithAbort(retryDelay, signal);
      continue;
    }
    throw new AppError(
      transient ? "RESEND_TRANSIENT_FAILED" : "RESEND_PERMANENT_FAILED",
      payload.message || payload.error?.message || `Resend returned HTTP ${response.status}.`,
      response.status
    );
  }
}

export async function sendResendBatch({
  apiKey,
  items,
  sender,
  batchSize = RESEND_BATCH_LIMIT,
  fetchImpl = fetch,
  maxRetries = 2,
  maxResponseBytes = 500000,
  operationId = null,
  reviewId = null,
  signal = null
}) {
  const size = Math.max(1, Math.min(RESEND_BATCH_LIMIT, Number(batchSize) || RESEND_BATCH_LIMIT));
  const batches = splitResendChunks(items, size);
  const deliveries = [];
  const chunks = [];
  for (const [chunkIndex, batch] of batches.entries()) {
    const chunk = await sendResendChunk({
      apiKey,
      items: batch,
      sender,
      fetchImpl,
      maxRetries,
      maxResponseBytes,
      operationId,
      reviewId,
      chunkIndex,
      signal
    });
    deliveries.push(...chunk.deliveries);
    chunks.push({ chunkIndex, ...chunk });
  }
  return { deliveries, batchCount: batches.length, chunks };
}

export function createResendWebhookBuffer({ maxEvents = 1000 } = {}) {
  const ids = new Set();
  const events = [];
  return {
    verifyAndStore({ payload, headers, webhookSecret, apiKey = "" }) {
      if (!webhookSecret)
        throw new AppError("RESEND_WEBHOOK_NOT_CONFIGURED", "Webhook verification is not configured.", 503);
      const svixId = headers.id;
      if (ids.has(svixId)) return { duplicate: true, event: events.find((item) => item.svixId === svixId) };
      const resend = new Resend(apiKey || "re_webhook_verification_only");
      const verified = resend.webhooks.verify({ payload, headers, webhookSecret });
      if (!RESEND_EVENT_TYPES.has(verified.type)) return { ignored: true, event: verified };
      const event = { svixId, type: verified.type, createdAt: verified.created_at, data: verified.data };
      ids.add(svixId);
      events.push(event);
      while (events.length > maxEvents) {
        const removed = events.shift();
        ids.delete(removed.svixId);
      }
      return { duplicate: false, event };
    },
    list(after = "") {
      const index = after ? events.findIndex((event) => event.svixId === after) : -1;
      return events.slice(index + 1);
    }
  };
}
