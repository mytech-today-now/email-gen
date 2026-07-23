import { describe, expect, it } from "vitest";
import {
  providerBatchOperationStatusLabel,
  providerBatchOperationSummary,
  providerBatchProcessButtonState,
  providerBatchResolvePayload,
  providerBatchRequestKey,
  providerBatchSubmitPayload,
  shouldAttemptProviderBatchResolve
} from "../../public/modules/providerBatchState.js";

describe("provider batch state helpers", () => {
  it("builds a stable request key regardless of record ordering", async () => {
    const left = await providerBatchRequestKey({
      projectId: "project-a",
      provider: "openai",
      model: "gpt-5.6-sol",
      template: { name: "template-a", content: "Hello {{name}}" },
      records: [
        { id: "2", displayName: "Bravo", normalized: { name: "Bravo" } },
        { id: "1", displayName: "Alpha", normalized: { name: "Alpha" } }
      ],
      options: { openrouterHost: "https://example.invalid" }
    });
    const right = await providerBatchRequestKey({
      projectId: "project-a",
      provider: "openai",
      model: "gpt-5.6-sol",
      template: { name: "template-a", content: "Hello {{name}}" },
      records: [
        { id: "1", displayName: "Alpha", normalized: { name: "Alpha" } },
        { id: "2", displayName: "Bravo", normalized: { name: "Bravo" } }
      ],
      options: { openrouterHost: "https://example.invalid" }
    });

    expect(left).toBe(right);
  });

  it("labels credential and monitoring recovery states clearly", () => {
    expect(providerBatchOperationStatusLabel("credential_required")).toBe("Credentials required");
    expect(providerBatchOperationStatusLabel("monitoring_degraded")).toBe("Monitoring degraded");
    expect(providerBatchOperationStatusLabel("submission_unknown")).toBe("Submission unknown");
  });

  it("summarizes active, unresolved, and attention-requiring chunks", () => {
    const summary = providerBatchOperationSummary({
      providerBatch: {
        chunks: [
          {
            chunkId: "chunk_1",
            providerBatchId: "batch_1",
            providerStatus: "in_progress",
            submissionState: "submitted"
          },
          {
            chunkId: "chunk_2",
            submissionState: "submission_unknown"
          },
          {
            chunkId: "chunk_3",
            submissionState: "reconciling"
          }
        ]
      }
    });

    expect(summary.counts).toMatchObject({
      total: 3,
      accepted: 1,
      pending: 1,
      submissionUnknown: 1,
      reconciling: 1
    });
    expect(summary.status).toBe("submission_unknown");
    expect(summary.attention).toBe(true);
  });

  it("describes why provider-batch processing cannot start and when it can", () => {
    expect(providerBatchProcessButtonState({ recordCount: 0, hasModel: true, hasTemplate: true })).toMatchObject(
      {
        disabled: true,
        reason: "Select at least one record to process."
      }
    );
    expect(
      providerBatchProcessButtonState({
        recordCount: 2,
        hasModel: false,
        hasTemplate: true
      })
    ).toMatchObject({
      disabled: true,
      reason: "Choose a compatible model before starting."
    });
    expect(
      providerBatchProcessButtonState({
        recordCount: 2,
        hasModel: true,
        hasTemplate: true,
        busyReason: "Provider batch processing is already in progress."
      })
    ).toMatchObject({
      disabled: true,
      reason: "Provider batch processing is already in progress."
    });
    expect(
      providerBatchProcessButtonState({
        recordCount: 2,
        hasModel: true,
        hasTemplate: true
      })
    ).toMatchObject({
      disabled: false,
      reason: "Ready to process 2 records."
    });
  });

  it("omits null project ids from the provider-batch submit payload", () => {
    const payload = providerBatchSubmitPayload({
      projectId: null,
      operationId: "job_123",
      requestHash: "pb_hash_123",
      clientRequestKey: "pb_hash_123",
      records: [{ id: "1" }],
      template: { name: "template", content: "Hi" },
      provider: "openai",
      model: "gpt-5.6-sol",
      options: { httpReferer: "https://example.com" }
    });

    expect(Object.prototype.hasOwnProperty.call(payload, "projectId")).toBe(false);
    expect(payload).toMatchObject({
      operationId: "job_123",
      requestHash: "pb_hash_123",
      clientRequestKey: "pb_hash_123",
      records: [{ id: "1" }],
      provider: "openai",
      model: "gpt-5.6-sol"
    });
  });

  it("builds resolve payloads and only retries ambiguous submit errors", () => {
    expect(
      providerBatchResolvePayload({
        operationId: "job_123",
        requestHash: "pb_hash_123",
        clientRequestKey: "pb_hash_123"
      })
    ).toMatchObject({
      operationId: "job_123",
      requestHash: "pb_hash_123",
      clientRequestKey: "pb_hash_123"
    });
    expect(shouldAttemptProviderBatchResolve({ code: "PROVIDER_BATCH_REQUEST_FAILED" })).toBe(true);
    expect(shouldAttemptProviderBatchResolve({ code: "OPERATION_RECONCILIATION_REQUIRED" })).toBe(true);
    expect(shouldAttemptProviderBatchResolve({ code: "PROVIDER_CREDENTIAL_MISSING" })).toBe(false);
    expect(shouldAttemptProviderBatchResolve({ code: "VALIDATION_ERROR" })).toBe(false);
    expect(shouldAttemptProviderBatchResolve({ status: 503, code: "VALIDATION_ERROR" })).toBe(true);
  });
});
