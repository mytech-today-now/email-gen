import express from "express";
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  buildResendPreflight,
  buildResendReviewFingerprint,
  RESEND_BATCH_LIMIT,
  validateResendComplianceContent,
  sendResendChunk
} from "../resend/resendGateway.js";
import { AppError } from "../utils/errors.js";
import { nowIso } from "../utils/helpers.js";
import { readBoundedResponseJson } from "../utils/responseBodies.js";
import { idempotencyKeyFor } from "../resend/resendGateway.js";

const RESEND_ACTIVE_STATUSES = new Set([
  "prepared",
  "acquired",
  "in-progress",
  "outcome-unknown",
  "reconciliation-required"
]);

const ResendItemSchema = z
  .object({
    id: z.string().min(1).max(120),
    primaryEmail: z.string().email().max(320),
    subject: z.string().max(160).default(""),
    html: z.string().default(""),
    text: z.string().default(""),
    consentStatus: z.string().max(40).default(""),
    consentSource: z.string().max(200).default(""),
    consentTimestamp: z.string().max(40).default(""),
    contactSource: z.string().max(80).default("")
  })
  .strict();

const ResendSenderSchema = z
  .object({
    fromName: z.string().max(120).default(""),
    fromAddress: z.union([z.literal(""), z.string().email().max(320)]).default(""),
    replyTo: z.union([z.literal(""), z.string().email().max(320)]).default(""),
    unsubscribeUrl: z
      .union([
        z.literal(""),
        z
          .string()
          .max(2000)
          .refine((value) => {
            try {
              const url = new URL(value);
              return ["http:", "https:"].includes(url.protocol);
            } catch {
              return false;
            }
          }, "A valid http or https unsubscribe URL is required.")
      ])
      .default(""),
    companyAddress: z.string().max(500).default("")
  })
  .strict();

const ResendReviewSchema = z
  .object({
    reviewId: z.string().min(1).max(120),
    reviewedAt: z.string().min(1).max(40),
    expiresAt: z.string().min(1).max(40),
    payloadDigest: z.string().min(1).max(200),
    suppressionDigest: z.string().min(1).max(200),
    batchSize: z.number().int().min(1).max(RESEND_BATCH_LIMIT).optional().default(RESEND_BATCH_LIMIT),
    testRecipient: z.union([z.literal(""), z.string().email().max(320)]).default("")
  })
  .strict();

function resendPayloadSchema(maxItems) {
  return z
    .object({
      items: z.array(ResendItemSchema).min(1).max(maxItems),
      suppressions: z.array(z.string().min(1).max(320)).max(maxItems).default([]),
      batchSize: z.number().int().min(1).max(RESEND_BATCH_LIMIT).optional().default(RESEND_BATCH_LIMIT),
      projectId: z.string().min(1).max(120).nullable().optional().default(null)
    })
    .strict();
}

function resendSendSchema(maxItems) {
  return z
    .object({
      confirmed: z.literal(true),
      operationId: z.string().min(1).max(120),
      parentOperationId: z.string().min(1).max(120).nullable().optional().default(null),
      projectId: z.string().min(1).max(120).nullable().optional().default(null),
      review: ResendReviewSchema,
      items: z.array(ResendItemSchema).min(1).max(maxItems),
      suppressions: z.array(z.string().email().max(320)).max(maxItems).default([]),
      sender: ResendSenderSchema.default({}),
      batchSize: z.number().int().min(1).max(RESEND_BATCH_LIMIT).optional()
    })
    .strict();
}

function requestFingerprintFor({
  operationId,
  reviewId,
  payloadDigest,
  projectId = null,
  parentOperationId = null
}) {
  return createHash("sha256")
    .update(JSON.stringify({ operationId, reviewId, payloadDigest, projectId, parentOperationId }))
    .digest("hex")
    .slice(0, 40);
}

function digestValue(value) {
  return createHash("sha256")
    .update(String(value ?? ""))
    .digest("hex")
    .slice(0, 24);
}

function summarizeSender(sender = {}) {
  return {
    fromName: String(sender.fromName ?? "").slice(0, 120),
    fromAddressDigest: digestValue(sender.fromAddress),
    replyToDigest: digestValue(sender.replyTo),
    unsubscribeUrlDigest: digestValue(sender.unsubscribeUrl),
    companyAddressDigest: digestValue(sender.companyAddress)
  };
}

function createResendAuditRecorder(context) {
  const repository = context.repositories.gatewayOperationAudits;
  if (!repository) return null;
  return {
    record(operationId, event) {
      try {
        return { ok: true, entry: repository.append(operationId, event) };
      } catch (error) {
        return {
          ok: false,
          error:
            error instanceof AppError
              ? error
              : new AppError("RESEND_AUDIT_WRITE_FAILED", "Resend audit entry could not be persisted.", 503, {
                  eventType: event?.eventType ?? "event"
                })
        };
      }
    },
    verify(operationId) {
      return repository.verify(operationId);
    },
    list(operationId) {
      return repository.list(operationId);
    }
  };
}

function parseOperationResponse(operation) {
  const response = operation?.response ?? null;
  if (!response) return null;
  return {
    ...response,
    chunks: Array.isArray(response.chunks) ? response.chunks : [],
    deliveries: Array.isArray(response.deliveries) ? response.deliveries : [],
    pendingChunks: Array.isArray(response.pendingChunks) ? response.pendingChunks : [],
    failedChunks: Array.isArray(response.failedChunks) ? response.failedChunks : []
  };
}

function cloneOperationResponse(response, patch = {}) {
  const next = {
    ...response,
    ...patch,
    chunks: Array.isArray(patch.chunks) ? patch.chunks : response.chunks,
    deliveries: Array.isArray(patch.deliveries) ? patch.deliveries : response.deliveries,
    pendingChunks: Array.isArray(patch.pendingChunks) ? patch.pendingChunks : response.pendingChunks,
    failedChunks: Array.isArray(patch.failedChunks) ? patch.failedChunks : response.failedChunks,
    updatedAt: patch.updatedAt ?? nowIso()
  };
  return next;
}

function isActiveOperation(operation) {
  return RESEND_ACTIVE_STATUSES.has(String(operation?.status ?? "").toLowerCase());
}

function terminalStatusForError(error, hadDeliveries) {
  const code = String(error?.code ?? "");
  if (code === "RESEND_PERMANENT_FAILED" && !hadDeliveries) return "failed-safe";
  if (code === "RESEND_RESPONSE_MALFORMED")
    return hadDeliveries ? "reconciliation-required" : "outcome-unknown";
  if (["RESEND_NETWORK_FAILED", "RESEND_TRANSIENT_FAILED", "HTTP_ERROR"].includes(code)) {
    return hadDeliveries ? "reconciliation-required" : "outcome-unknown";
  }
  return hadDeliveries ? "reconciliation-required" : "failed-safe";
}

function createInitialResendResponse({ review, freshReview, preflight, operationId }) {
  return {
    operationId,
    review: {
      ...review,
      payloadDigest: freshReview.payloadDigest,
      suppressionDigest: freshReview.suppressionDigest
    },
    status: "reviewed",
    reviewStatus: "reviewed",
    sender: freshReview.sender,
    batchSize: freshReview.batchSize,
    eligible: freshReview.items.map((item) => ({
      id: item.id,
      primaryEmail: item.primaryEmail,
      subject: item.subject
    })),
    excluded: preflight.excluded,
    messages: freshReview.messages.map((message) => ({
      messageDigest: message.messageDigest,
      resultId: message.resultId,
      to: message.to,
      subject: message.subject,
      consent: message.consent
    })),
    chunks: freshReview.chunks.map((chunk) => ({
      chunkIndex: chunk.chunkIndex,
      chunkDigest: chunk.chunkDigest,
      messageDigests: chunk.messageDigests,
      idempotencyKey: idempotencyKeyFor(
        freshReview.items.slice(
          chunk.chunkIndex * freshReview.batchSize,
          chunk.chunkIndex * freshReview.batchSize + freshReview.batchSize
        ),
        freshReview.sender,
        {
          operationId,
          reviewId: review.reviewId,
          chunkIndex: chunk.chunkIndex
        }
      ),
      status: "pending",
      attempts: 0,
      receipts: []
    })),
    deliveries: [],
    pendingChunks: freshReview.chunks.map((chunk) => chunk.chunkIndex),
    failedChunks: [],
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
}

function mergeChunkResult(response, chunkIndex, chunkResult, freshReview) {
  const next = structuredClone(response);
  const messageEntries = freshReview.chunks.find((chunk) => chunk.chunkIndex === chunkIndex) ?? null;
  const chunk = next.chunks.find((item) => item.chunkIndex === chunkIndex) ?? {
    chunkIndex,
    receipts: []
  };
  chunk.status = "completed";
  chunk.completedAt = nowIso();
  chunk.attempts = (chunk.attempts ?? 0) + 1;
  chunk.idempotencyKey = chunkResult.idempotencyKey;
  chunk.receipts = chunkResult.deliveries.map((delivery, index) => ({
    ...delivery,
    messageDigest: messageEntries?.messageDigests?.[index] ?? null,
    chunkIndex,
    operationId: response.operationId,
    status: "sent",
    createdAt: nowIso(),
    updatedAt: nowIso()
  }));
  next.deliveries = [...next.deliveries, ...chunk.receipts];
  next.pendingChunks = next.pendingChunks.filter((value) => value !== chunkIndex);
  next.failedChunks = next.failedChunks.filter((value) => value !== chunkIndex);
  next.status = next.pendingChunks.length ? "sending" : "completed";
  next.reviewStatus = next.status;
  next.updatedAt = nowIso();
  return next;
}

function mergeChunkFailure(response, chunkIndex, error, freshReview) {
  const next = structuredClone(response);
  const chunk = next.chunks.find((item) => item.chunkIndex === chunkIndex) ?? {
    chunkIndex,
    receipts: []
  };
  chunk.status = terminalStatusForError(error, next.deliveries.length > 0);
  chunk.error = {
    code: error.code || "RESEND_FAILED",
    message: error.message || String(error)
  };
  chunk.attempts = (chunk.attempts ?? 0) + 1;
  chunk.updatedAt = nowIso();
  next.failedChunks = [...new Set([...next.failedChunks, chunkIndex])];
  next.pendingChunks = freshReview.chunks
    .map((item) => item.chunkIndex)
    .filter((value) => value >= chunkIndex && value !== chunkIndex)
    .filter((value) => !next.chunks.find((item) => item.chunkIndex === value && item.status === "completed"));
  next.status = next.deliveries.length ? "partially_completed" : chunk.status;
  next.reviewStatus = next.status;
  next.lastError = chunk.error;
  next.updatedAt = nowIso();
  return next;
}

export function resendRoutes(context) {
  const router = express.Router();

  router.post("/gateway/resend/preflight", (req, res, next) => {
    try {
      context.requireGatewayRequest(req);
      const parsed = resendPayloadSchema(context.config.limits.records).safeParse(req.body);
      if (!parsed.success)
        throw new AppError(
          "VALIDATION_ERROR",
          "Resend preflight payload failed validation.",
          400,
          parsed.error.issues
        );
      const preflight = buildResendPreflight(parsed.data.items, {
        suppressions: parsed.data.suppressions,
        batchSize: parsed.data.batchSize
      });
      res.json({ preflight });
    } catch (error) {
      next(error);
    }
  });

  router.post("/gateway/resend/test", async (req, res, next) => {
    try {
      context.requireGatewayRequest(req);
      const apiKey = context.runtimeCredentials.get("RESEND_API_KEY");
      if (!apiKey)
        throw new AppError(
          "RESEND_CREDENTIAL_MISSING",
          "Configure a Resend API key in Configuration before testing the connection.",
          401
        );
      const response = await context.fetchImpl("https://api.resend.com/domains", {
        headers: { authorization: `Bearer ${apiKey}`, "user-agent": "ai-batch-personalizer/2.0" },
        signal: AbortSignal.timeout(10_000)
      });
      if (!response.ok)
        throw new AppError("RESEND_CONNECTION_FAILED", `Resend returned HTTP ${response.status}.`, 502);
      const { payload } = await readBoundedResponseJson(response, {
        maxBytes: context.config.limits.providerResponseBytes,
        code: "RESEND_RESPONSE_TOO_LARGE",
        message: "Resend response exceeded the configured size limit.",
        jsonCode: "RESEND_RESPONSE_INVALID",
        jsonMessage: "Resend returned malformed JSON.",
        jsonStatus: 502
      });
      res.json({
        ok: true,
        domains: (payload.data ?? []).map((domain) => ({
          id: domain.id,
          name: domain.name,
          status: domain.status
        }))
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/gateway/resend/send", async (req, res, next) => {
    try {
      context.requireGatewayRequest(req);
      const parsed = resendSendSchema(context.config.limits.records).safeParse(req.body);
      if (!parsed.success)
        throw new AppError(
          "VALIDATION_ERROR",
          "Resend send payload failed validation.",
          400,
          parsed.error.issues
        );
      const body = parsed.data;
      const operations = context.repositories.gatewayOperations;
      const audits = createResendAuditRecorder(context);
      if (!operations)
        throw new AppError(
          "GATEWAY_OPERATION_STORAGE_UNAVAILABLE",
          "Gateway operation storage is unavailable.",
          503
        );
      if (!audits)
        throw new AppError("GATEWAY_AUDIT_STORAGE_UNAVAILABLE", "Gateway audit storage is unavailable.", 503);
      const batchSize = body.batchSize ?? body.review.batchSize ?? 100;
      const preflight = buildResendPreflight(body.items, {
        suppressions: body.suppressions,
        batchSize
      });
      if (!preflight.eligible.length)
        throw new AppError(
          "RESEND_NO_ELIGIBLE_RECIPIENTS",
          "No recipients satisfy consent and suppression requirements.",
          400,
          preflight.excluded
        );
      for (const item of preflight.eligible) {
        validateResendComplianceContent(item, body.sender, {
          bulk: preflight.eligible.length > 1
        });
      }
      const freshReview = await buildResendReviewFingerprint({
        reviewId: body.review.reviewId,
        reviewedAt: body.review.reviewedAt,
        expiresAt: body.review.expiresAt,
        projectId: body.projectId || null,
        sender: body.sender,
        items: preflight.eligible,
        suppressions: body.suppressions,
        batchSize,
        testRecipient: body.review.testRecipient
      });
      if (freshReview.payloadDigest !== body.review.payloadDigest) {
        throw new AppError(
          "RESEND_REVIEW_STALE",
          "The reviewed content changed after preflight. Run a fresh resend preflight.",
          409,
          {
            expectedDigest: body.review.payloadDigest,
            actualDigest: freshReview.payloadDigest
          }
        );
      }
      if (freshReview.suppressionDigest !== body.review.suppressionDigest) {
        throw new AppError(
          "RESEND_SUPPRESSION_CHANGED",
          "Recipient suppression state changed after preflight. Run a fresh resend preflight.",
          409,
          {
            expectedDigest: body.review.suppressionDigest,
            actualDigest: freshReview.suppressionDigest
          }
        );
      }
      const auditContext = {
        requestId: req.id ?? null,
        projectId: body.projectId || null,
        reviewId: body.review.reviewId,
        parentOperationId: body.parentOperationId || null,
        reviewedAt: body.review.reviewedAt,
        expiresAt: body.review.expiresAt,
        payloadDigest: body.review.payloadDigest,
        suppressionDigest: body.review.suppressionDigest,
        batchSize,
        recipientCount: preflight.eligible.length,
        excludedCount: preflight.excluded.length,
        testRecipient: body.review.testRecipient || null,
        sender: summarizeSender(body.sender),
        compliance: {
          companyAddressPresent: Boolean(String(body.sender.companyAddress ?? "").trim()),
          unsubscribeUrlPresent: Boolean(String(body.sender.unsubscribeUrl ?? "").trim())
        }
      };
      const expiresAtMs = Date.parse(body.review.expiresAt);
      if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) {
        throw new AppError(
          "RESEND_REVIEW_EXPIRED",
          "The resend confirmation expired. Run a fresh resend preflight.",
          409
        );
      }
      const requestFingerprint = requestFingerprintFor({
        operationId: body.operationId,
        reviewId: body.review.reviewId,
        payloadDigest: body.review.payloadDigest,
        projectId: body.projectId || null,
        parentOperationId: body.parentOperationId || null
      });
      let operation = operations.get(body.operationId);
      if (operation && operation.requestFingerprint !== requestFingerprint) {
        throw new AppError(
          "OPERATION_SCOPE_CONFLICT",
          "The requested resend operation already belongs to different content.",
          409
        );
      }
      const activeResponse = parseOperationResponse(operation);
      if (
        operation &&
        isActiveOperation(operation) &&
        operation.leaseExpiresAt &&
        Date.parse(operation.leaseExpiresAt) > Date.now()
      ) {
        const current =
          activeResponse ??
          createInitialResendResponse({
            review: body.review,
            freshReview,
            preflight,
            operationId: body.operationId
          });
        res.status(207).json({
          operationId: body.operationId,
          operation: current,
          result: current,
          excluded: preflight.excluded
        });
        return;
      }
      if (activeResponse && activeResponse.status === "completed") {
        res.status(200).json({
          operationId: body.operationId,
          operation: activeResponse,
          result: activeResponse,
          excluded: preflight.excluded
        });
        return;
      }
      const initialResponse =
        activeResponse ??
        createInitialResendResponse({
          review: body.review,
          freshReview,
          preflight,
          operationId: body.operationId
        });
      if (!operation) {
        operation = operations.create({
          operationId: body.operationId,
          scopeKey: body.review.reviewId,
          kind: "resend",
          requestFingerprint,
          status: "prepared",
          generation: 0,
          leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
          response: initialResponse
        });
      } else {
        operation = operations.update(operation.operationId, {
          scopeKey: body.review.reviewId,
          kind: "resend",
          requestFingerprint,
          status: operation.status === "reconciliation-required" ? "reconciliation-required" : "in-progress",
          generation: (operation.generation ?? 0) + 1,
          leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
          response: initialResponse,
          error: null,
          providerRequestId: null
        });
      }

      const commitEvent = await audits.record(operation.operationId, {
        eventType: operation.generation === 0 ? "resend_operation_committed" : "resend_operation_resumed",
        ...auditContext,
        operationStatus: operation.status,
        responseStatus: initialResponse.status,
        chunkCount: freshReview.chunks.length,
        messageDigests: freshReview.messages.map((message) => message.messageDigest)
      });
      if (!commitEvent.ok) {
        try {
          operation = operations.update(operation.operationId, {
            status: "failed-safe",
            leaseExpiresAt: null,
            response: initialResponse,
            error: {
              code: commitEvent.error.code || "RESEND_AUDIT_WRITE_FAILED",
              message: commitEvent.error.message || "Resend audit entry could not be persisted."
            },
            providerRequestId: null
          });
        } catch {
          // Delivery is still blocked even if the operation row cannot be updated.
        }
        throw commitEvent.error;
      }

      const currentState = parseOperationResponse(operation) ?? initialResponse;
      const chunkPlans = freshReview.chunks;
      const completed = new Set(
        currentState.chunks.filter((chunk) => chunk.status === "completed").map((chunk) => chunk.chunkIndex)
      );
      let responseState = currentState;

      for (const chunkPlan of chunkPlans) {
        if (completed.has(chunkPlan.chunkIndex)) continue;
        const batch = freshReview.items.slice(
          chunkPlan.chunkIndex * batchSize,
          chunkPlan.chunkIndex * batchSize + batchSize
        );
        const intentEvent = await audits.record(operation.operationId, {
          eventType: "resend_chunk_intent",
          ...auditContext,
          chunkIndex: chunkPlan.chunkIndex,
          idempotencyKey: chunkPlan.idempotencyKey,
          attempt:
            (responseState.chunks.find((chunk) => chunk.chunkIndex === chunkPlan.chunkIndex)?.attempts ?? 0) +
            1,
          messageDigests: chunkPlan.messageDigests,
          recipientCount: batch.length
        });
        if (!intentEvent.ok) {
          try {
            operation = operations.update(operation.operationId, {
              status: "failed-safe",
              leaseExpiresAt: null,
              response: responseState,
              error: {
                code: intentEvent.error.code || "RESEND_AUDIT_WRITE_FAILED",
                message: intentEvent.error.message || "Resend audit entry could not be persisted."
              },
              providerRequestId: null
            });
          } catch {
            // Ignore best-effort cleanup failures; the request has already been blocked.
          }
          throw intentEvent.error;
        }
        responseState = cloneOperationResponse(responseState, {
          status: "sending",
          reviewStatus: "sending"
        });
        const sendingLease = new Date(Date.now() + 60_000).toISOString();
        operation = operations.update(operation.operationId, {
          status: "in-progress",
          leaseExpiresAt: sendingLease,
          response: responseState
        });
        try {
          const chunkResult = await sendResendChunk({
            apiKey: context.runtimeCredentials.get("RESEND_API_KEY"),
            items: batch,
            sender: freshReview.sender,
            fetchImpl: context.fetchImpl,
            maxRetries: 2,
            maxResponseBytes: context.config.limits.providerResponseBytes,
            operationId: body.operationId,
            reviewId: body.review.reviewId,
            chunkIndex: chunkPlan.chunkIndex,
            idempotencyKey: chunkPlan.idempotencyKey,
            signal: context.shutdownController?.signal ?? null
          });
          responseState = mergeChunkResult(responseState, chunkPlan.chunkIndex, chunkResult, freshReview);
          responseState.deliveries = [
            ...new Map(
              responseState.deliveries.map((item) => [`${item.resultId}:${item.messageDigest}`, item])
            ).values()
          ];
          operation = operations.update(operation.operationId, {
            status: responseState.status === "completed" ? "succeeded" : "in-progress",
            leaseExpiresAt:
              responseState.status === "completed" ? null : new Date(Date.now() + 60_000).toISOString(),
            response: responseState,
            error: null,
            providerRequestId: null
          });
          const receiptEvent = await audits.record(operation.operationId, {
            eventType: "resend_chunk_receipt",
            ...auditContext,
            chunkIndex: chunkPlan.chunkIndex,
            attempt:
              responseState.chunks.find((chunk) => chunk.chunkIndex === chunkPlan.chunkIndex)?.attempts ?? 1,
            idempotencyKey: chunkResult.idempotencyKey,
            providerMessageIds: chunkResult.deliveries.map(
              (delivery) => delivery.resendId ?? delivery.providerMessageId ?? null
            ),
            statuses: chunkResult.deliveries.map((delivery) => delivery.status ?? "sent"),
            deliveryCount: chunkResult.deliveries.length,
            responseStatus: responseState.status
          });
          if (!receiptEvent.ok) {
            responseState = cloneOperationResponse(responseState, {
              status: "reconciliation-required",
              reviewStatus: "reconciliation-required"
            });
            operation = operations.update(operation.operationId, {
              status: "reconciliation-required",
              leaseExpiresAt: null,
              response: responseState,
              error: {
                code: receiptEvent.error.code || "RESEND_AUDIT_WRITE_FAILED",
                message: receiptEvent.error.message || "Resend audit entry could not be persisted."
              },
              providerRequestId: null
            });
            context.logger.warn(
              {
                event: "resend_audit_write_failed",
                operationId: body.operationId,
                reviewId: body.review.reviewId,
                chunkIndex: chunkPlan.chunkIndex,
                errorCode: receiptEvent.error.code || "RESEND_AUDIT_WRITE_FAILED"
              },
              "Resend receipt audit entry could not be persisted"
            );
            res.status(207).json({
              operationId: body.operationId,
              operation: responseState,
              result: responseState,
              excluded: preflight.excluded,
              error: {
                code: receiptEvent.error.code || "RESEND_AUDIT_WRITE_FAILED",
                message: receiptEvent.error.message || "Resend audit entry could not be persisted."
              }
            });
            return;
          }
          continue;
        } catch (error) {
          responseState = mergeChunkFailure(responseState, chunkPlan.chunkIndex, error, freshReview);
          responseState.deliveries = [
            ...new Map(
              responseState.deliveries.map((item) => [`${item.resultId}:${item.messageDigest}`, item])
            ).values()
          ];
          const persistedStatus =
            responseState.deliveries.length > 0
              ? "reconciliation-required"
              : terminalStatusForError(error, false);
          operation = operations.update(operation.operationId, {
            status: persistedStatus,
            leaseExpiresAt: null,
            response: responseState,
            error: {
              code: error.code || "RESEND_FAILED",
              message: error.message || String(error)
            },
            providerRequestId: null
          });
          await audits.record(operation.operationId, {
            eventType: "resend_chunk_failed",
            ...auditContext,
            chunkIndex: chunkPlan.chunkIndex,
            attempt:
              responseState.chunks.find((chunk) => chunk.chunkIndex === chunkPlan.chunkIndex)?.attempts ?? 1,
            idempotencyKey: chunkPlan.idempotencyKey,
            errorCode: error.code || "RESEND_FAILED",
            errorMessage: error.message || String(error),
            responseStatus: responseState.status,
            deliveryCount: responseState.deliveries.length
          });
          const statusCode = responseState.deliveries.length > 0 ? 207 : error.status || 502;
          context.logger.info(
            {
              event: "resend_operation_partial",
              operationId: body.operationId,
              reviewId: body.review.reviewId,
              status: responseState.status,
              deliveryCount: responseState.deliveries.length
            },
            "Resend operation paused"
          );
          res.status(statusCode).json({
            operationId: body.operationId,
            operation: responseState,
            result: responseState,
            excluded: preflight.excluded
          });
          return;
        }
      }

      responseState = cloneOperationResponse(responseState, {
        status: "completed",
        reviewStatus: "completed",
        pendingChunks: [],
        failedChunks: [],
        deliveries: responseState.deliveries,
        completedAt: nowIso(),
        updatedAt: nowIso()
      });
      operation = operations.resolve(operation.operationId, {
        status: "succeeded",
        response: responseState,
        providerRequestId: null
      });
      const completionEvent = await audits.record(operation.operationId, {
        eventType: "resend_operation_completed",
        ...auditContext,
        responseStatus: responseState.status,
        recipientCount: responseState.deliveries.length,
        chunkCount: responseState.chunks.length
      });
      if (!completionEvent.ok) {
        context.logger.warn(
          {
            event: "resend_audit_write_failed",
            operationId: body.operationId,
            reviewId: body.review.reviewId,
            errorCode: completionEvent.error.code || "RESEND_AUDIT_WRITE_FAILED"
          },
          "Resend completion audit entry could not be persisted"
        );
      }
      context.logger.info(
        {
          event: "resend_operation_completed",
          operationId: body.operationId,
          reviewId: body.review.reviewId,
          recipientCount: responseState.deliveries.length
        },
        "Resend operation completed"
      );
      res.status(200).json({
        operationId: body.operationId,
        operation: responseState,
        result: responseState,
        excluded: preflight.excluded
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/gateway/resend/webhook", (req, res, next) => {
    try {
      const result = context.resendWebhooks.verifyAndStore({
        payload: req.rawBody || JSON.stringify(req.body ?? {}),
        headers: {
          id: req.get("svix-id"),
          timestamp: req.get("svix-timestamp"),
          signature: req.get("svix-signature")
        },
        webhookSecret: context.runtimeCredentials.get("RESEND_WEBHOOK_SECRET"),
        apiKey: context.runtimeCredentials.get("RESEND_API_KEY")
      });
      res.json({ ok: true, duplicate: Boolean(result.duplicate), ignored: Boolean(result.ignored) });
    } catch (error) {
      next(error);
    }
  });

  router.get("/gateway/resend/events", (req, res, next) => {
    try {
      context.requireGatewayRequest(req, { readOnly: true });
      res.json({ events: context.resendWebhooks.list(req.query.after) });
    } catch (error) {
      next(error);
    }
  });

  router.get("/gateway/resend/:operationId/audit", (req, res, next) => {
    try {
      context.requireGatewayRequest(req, { readOnly: true });
      const audits = createResendAuditRecorder(context);
      if (!audits)
        throw new AppError("GATEWAY_AUDIT_STORAGE_UNAVAILABLE", "Gateway audit storage is unavailable.", 503);
      const operation = context.repositories.gatewayOperations.get(req.params.operationId);
      if (!operation)
        throw new AppError("RESEND_OPERATION_NOT_FOUND", "Resend operation was not found.", 404);
      res.json({
        operationId: operation.operationId,
        verification: audits.verify(operation.operationId),
        entries: audits.list(operation.operationId)
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/gateway/resend/:operationId", (req, res, next) => {
    try {
      context.requireGatewayRequest(req, { readOnly: true });
      const operation = context.repositories.gatewayOperations.get(req.params.operationId);
      if (!operation)
        throw new AppError("RESEND_OPERATION_NOT_FOUND", "Resend operation was not found.", 404);
      res.json({
        operationId: operation.operationId,
        operation: parseOperationResponse(operation) ?? operation.response ?? null,
        row: operation
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
