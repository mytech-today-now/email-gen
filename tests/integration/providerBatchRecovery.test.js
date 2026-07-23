import { afterEach, describe, expect, it } from "vitest";
import { createTestHarness } from "../helpers/appTestHarness.js";
import { recoverInterruptedWork } from "../../src/persistence/migrations.js";
import { providerBatchRequestKey } from "../../public/modules/providerBatchState.js";

const harnesses = [];

afterEach(() => {
  while (harnesses.length) harnesses.pop().cleanup();
});

function setup(options) {
  const harness = createTestHarness(options);
  harnesses.push(harness);
  return harness;
}

async function bootstrap(harness) {
  const response = await harness.request.get("/api/gateway/bootstrap").expect(200);
  return response.body.csrfToken;
}

function discoveredModel(providerId, providerModelId, batchLimits = {}) {
  return {
    id: `${providerId}:${providerModelId}`,
    providerId,
    providerModelId,
    displayName: providerModelId,
    aliases: [],
    family: "stable",
    version: null,
    status: "available",
    availability: "available",
    createdAtProvider: null,
    deprecatedAt: null,
    retiredAt: null,
    inputModalities: ["text"],
    outputModalities: ["text"],
    supportedDataTypes: ["email"],
    capabilities: { text: true, structuredOutput: true },
    limits: {},
    pricing: {
      currency: "USD",
      status: "fresh",
      inputPerMillionTokens: 5,
      cachedInputReadPerMillionTokens: 0.5,
      cachedInputWritePerMillionTokens: 6.25,
      outputPerMillionTokens: 30,
      sourceUrl: "https://developers.openai.com/api/docs/pricing",
      verifiedAt: "2026-07-21",
      batch: {
        inputPerMillionTokens: 2.5,
        cachedInputReadPerMillionTokens: 0.25,
        cachedInputWritePerMillionTokens: 3.125,
        outputPerMillionTokens: 15,
        sourceUrl: "https://developers.openai.com/api/docs/pricing",
        verifiedAt: "2026-07-21",
        limits: batchLimits
      }
    },
    regionalAvailability: null,
    requiredApiVersion: null,
    capabilityConfidence: "confirmed",
    discoverySource: "integration-test",
    metadataSource: { providerMetadata: true },
    rawProviderMetadata: null,
    compatibility: { compatible: true, reasons: [] }
  };
}

function seedOpenAiBatchModel(
  harness,
  providerModelId = "gpt-5.6-sol",
  batchLimits = { maxRequestsPerBatch: 1 }
) {
  harness.context.modelCatalogRepository.upsertDiscoveredModels({
    providerId: "openai",
    runId: "provider-batch-recovery-test",
    models: [discoveredModel("openai", providerModelId, batchLimits)]
  });
}

function providerBatchRequestBody() {
  return {
    records: [
      {
        id: "browser-record",
        displayName: "Browser Bistro",
        normalized: { name: "Browser Bistro", city: "Omaha" },
        raw: {},
        validation: {}
      }
    ],
    template: { name: "browser-template", content: "Write for {{name|required}} in {{city?}}" },
    provider: "openai",
    model: "gpt-5.6-sol",
    researchEnabled: false,
    options: {}
  };
}

function seedUnresolvedOpenAiBatchOperation(
  harness,
  { operationId = "job_unresolved", requestHash = "pb_request_hash", providerBatchId = null } = {}
) {
  return harness.context.repositories.providerBatches.create({
    id: operationId,
    projectId: "project_alpha",
    status: "submitting",
    requestHash,
    clientRequestKey: requestHash,
    options: {
      provider: "openai",
      model: "gpt-5.6-sol",
      executionMode: "provider-batch"
    },
    counts: {
      total: 1,
      accepted: providerBatchId ? 1 : 0,
      completed: 0,
      failed: 0,
      stopped: 0,
      pending: 1,
      running: 1,
      remaining: 1
    },
    providerBatch: {
      operationId,
      requestHash,
      provider: "openai",
      model: "gpt-5.6-sol",
      submissionState: "submitting",
      monitoringState: "monitoring",
      chunks: [
        {
          chunkId: "chunk_1",
          index: 0,
          requestHash,
          state: "submitting",
          submissionState: "submitting",
          requestIntentAt: "2026-07-21T12:00:00.000Z",
          providerBatchId,
          providerFileId: null,
          providerRequestId: null,
          providerStatus: null
        }
      ]
    }
  });
}

describe("provider batch recovery", () => {
  it("reuses an active provider batch when the same submission is posted twice", async () => {
    const previousMock = process.env.AI_MOCK;
    process.env.AI_MOCK = "false";
    const calls = [];
    try {
      const harness = setup({
        fetchImpl: async (url, options = {}) => {
          calls.push({ url, method: options.method, headers: options.headers, body: options.body });
          if (url === "https://api.openai.com/v1/files") {
            return new Response(JSON.stringify({ id: "file_1" }), {
              status: 200,
              headers: { "content-type": "application/json" }
            });
          }
          if (url === "https://api.openai.com/v1/batches") {
            return new Response(
              JSON.stringify({
                id: "batch_1",
                input_file_id: "file_1",
                status: "validating"
              }),
              { status: 200, headers: { "content-type": "application/json" } }
            );
          }
          throw new Error(`Unexpected URL ${url}`);
        }
      });
      seedOpenAiBatchModel(harness);
      harness.context.runtimeCredentials.set("openai", "sk-batch-test");
      const csrf = await bootstrap(harness);
      const body = providerBatchRequestBody();
      const requestHash = await providerBatchRequestKey({
        projectId: null,
        provider: body.provider,
        model: body.model,
        template: body.template,
        records: body.records,
        researchEnabled: body.researchEnabled,
        researchDepth: 5,
        options: body.options
      });

      const first = await harness.request
        .post("/api/gateway/batches/submit")
        .set("x-email-gen-csrf", csrf)
        .send({
          ...body,
          requestHash,
          clientRequestKey: requestHash
        })
        .expect(200);

      const second = await harness.request
        .post("/api/gateway/batches/submit")
        .set("x-email-gen-csrf", csrf)
        .send({
          ...body,
          operationId: "job_retry",
          requestHash: first.body.batch.requestHash,
          clientRequestKey: first.body.batch.requestHash
        })
        .expect(200);

      expect(first.body.batch.status).toBe("submitted");
      expect(second.body.batch.operationId).toBe(first.body.batch.operationId);
      expect(second.body.batch.requestHash).toBe(first.body.batch.requestHash);
      expect(second.body.batch.status).toBe("submitted");
      expect(calls).toHaveLength(2);
    } finally {
      process.env.AI_MOCK = previousMock;
    }
  });

  it("reconciles a persisted unresolved intent before creating a new provider batch", async () => {
    const previousMock = process.env.AI_MOCK;
    process.env.AI_MOCK = "false";
    const calls = [];
    try {
      const requestHash = await providerBatchRequestKey({
        ...providerBatchRequestBody(),
        researchDepth: 5
      });
      const harness = setup({
        fetchImpl: async (url, options = {}) => {
          calls.push({ url, method: options.method, headers: options.headers, body: options.body });
          if (url === "https://api.openai.com/v1/batches?limit=100") {
            return new Response(
              JSON.stringify({
                data: [
                  {
                    id: "batch_1",
                    status: "validating",
                    input_file_id: "file_1",
                    metadata: {
                      operation_id: "job_unresolved",
                      chunk_ordinal: "0",
                      request_hash: requestHash
                    }
                  }
                ]
              }),
              { status: 200, headers: { "content-type": "application/json" } }
            );
          }
          throw new Error(`Unexpected URL ${url}`);
        }
      });
      seedOpenAiBatchModel(harness);
      harness.context.runtimeCredentials.set("openai", "sk-batch-test");
      seedUnresolvedOpenAiBatchOperation(harness, { operationId: "job_unresolved", requestHash });
      const csrf = await bootstrap(harness);

      const response = await harness.request
        .post("/api/gateway/batches/submit")
        .set("x-email-gen-csrf", csrf)
        .send({
          ...providerBatchRequestBody(),
          operationId: "job_unresolved",
          requestHash,
          clientRequestKey: requestHash
        })
        .expect(200);

      expect(response.body.batch.status).toBe("submitted");
      expect(response.body.batch.chunks[0]).toMatchObject({
        providerBatchId: "batch_1",
        providerFileId: "file_1",
        providerStatus: "validating",
        submissionState: "submitted"
      });
      expect(calls).toHaveLength(1);
      expect(calls[0].url).toBe("https://api.openai.com/v1/batches?limit=100");
    } finally {
      process.env.AI_MOCK = previousMock;
    }
  });

  it("treats multiple provider matches as ambiguous instead of creating again", async () => {
    const previousMock = process.env.AI_MOCK;
    process.env.AI_MOCK = "false";
    const calls = [];
    try {
      const requestHash = await providerBatchRequestKey({
        ...providerBatchRequestBody(),
        researchDepth: 5
      });
      const harness = setup({
        fetchImpl: async (url, options = {}) => {
          calls.push({ url, method: options.method, headers: options.headers, body: options.body });
          if (url === "https://api.openai.com/v1/batches?limit=100") {
            return new Response(
              JSON.stringify({
                data: [
                  {
                    id: "batch_1",
                    status: "validating",
                    metadata: {
                      operation_id: "job_ambiguous",
                      chunk_ordinal: "0",
                      request_hash: requestHash
                    }
                  },
                  {
                    id: "batch_2",
                    status: "validating",
                    metadata: {
                      operation_id: "job_ambiguous",
                      chunk_ordinal: "0",
                      request_hash: requestHash
                    }
                  }
                ]
              }),
              { status: 200, headers: { "content-type": "application/json" } }
            );
          }
          throw new Error(`Unexpected URL ${url}`);
        }
      });
      seedOpenAiBatchModel(harness);
      harness.context.runtimeCredentials.set("openai", "sk-batch-test");
      seedUnresolvedOpenAiBatchOperation(harness, { operationId: "job_ambiguous", requestHash });
      const csrf = await bootstrap(harness);

      const response = await harness.request
        .post("/api/gateway/batches/submit")
        .set("x-email-gen-csrf", csrf)
        .send({
          ...providerBatchRequestBody(),
          operationId: "job_ambiguous",
          requestHash,
          clientRequestKey: requestHash
        })
        .expect(200);

      expect(response.body.batch.status).toBe("submission_unknown");
      expect(response.body.batch.chunks[0]).toMatchObject({
        state: "ambiguous",
        submissionState: "submission_unknown"
      });
      expect(calls).toHaveLength(1);
      expect(calls[0].url).toBe("https://api.openai.com/v1/batches?limit=100");
    } finally {
      process.env.AI_MOCK = previousMock;
    }
  });

  it("persists credential_required and resumes the same provider batch after credentials are restored", async () => {
    const previousMock = process.env.AI_MOCK;
    process.env.AI_MOCK = "false";
    const calls = [];
    try {
      const harness = setup({
        fetchImpl: async (url, options = {}) => {
          calls.push({ url, method: options.method, headers: options.headers, body: options.body });
          if (url === "https://api.openai.com/v1/files") {
            return new Response(JSON.stringify({ id: "file_1" }), {
              status: 200,
              headers: { "content-type": "application/json" }
            });
          }
          if (url === "https://api.openai.com/v1/batches") {
            return new Response(
              JSON.stringify({
                id: "batch_1",
                input_file_id: "file_1",
                status: "validating"
              }),
              { status: 200, headers: { "content-type": "application/json" } }
            );
          }
          throw new Error(`Unexpected URL ${url}`);
        }
      });
      seedOpenAiBatchModel(harness);
      const csrf = await bootstrap(harness);
      const requestHash = await providerBatchRequestKey({
        ...providerBatchRequestBody(),
        researchDepth: 5
      });
      const body = {
        ...providerBatchRequestBody(),
        operationId: "job_resume",
        requestHash,
        clientRequestKey: requestHash
      };

      const first = await harness.request
        .post("/api/gateway/batches/submit")
        .set("x-email-gen-csrf", csrf)
        .send(body)
        .expect(400);

      expect(first.body.error).toMatchObject({ code: "PROVIDER_CREDENTIAL_MISSING" });
      expect(calls).toHaveLength(0);

      harness.context.runtimeCredentials.set("openai", "sk-batch-test");
      const second = await harness.request
        .post("/api/gateway/batches/submit")
        .set("x-email-gen-csrf", csrf)
        .send({
          ...body,
          resumeSubmission: true
        })
        .expect(200);

      expect(second.body.batch.operationId).toBe(body.operationId);
      expect(second.body.batch.status).toBe("submitted");
      expect(second.body.batch.requestHash).toBe(requestHash);
      expect(second.body.batch.chunks[0]).toMatchObject({
        providerBatchId: "batch_1",
        providerStatus: "validating",
        submissionState: "submitted"
      });
      expect(calls).toHaveLength(2);
    } finally {
      process.env.AI_MOCK = previousMock;
    }
  });

  it("downgrades interrupted provider-batch jobs to recovery states on restart", async () => {
    const harness = setup();
    const accepted = harness.context.repositories.providerBatches.create({
      id: "job-accepted",
      projectId: "project_alpha",
      status: "submitted",
      clientRequestKey: "pb_accepted",
      options: { provider: "openai", model: "gpt-5.6-sol" },
      counts: {
        total: 1,
        accepted: 1,
        completed: 0,
        failed: 0,
        stopped: 0,
        pending: 1,
        running: 1,
        remaining: 1
      },
      providerBatch: {
        operationId: "job-accepted",
        clientRequestKey: "pb_accepted",
        provider: "openai",
        model: "gpt-5.6-sol",
        submissionState: "submitted",
        monitoringState: "monitoring",
        chunks: [
          {
            chunkId: "chunk_1",
            index: 0,
            providerBatchId: "batch_1",
            providerStatus: "in_progress",
            submissionState: "submitted"
          }
        ]
      }
    });
    const pending = harness.context.repositories.providerBatches.create({
      id: "job-pending",
      projectId: "project_alpha",
      status: "submitting",
      clientRequestKey: "pb_pending",
      options: { provider: "openai", model: "gpt-5.6-sol" },
      counts: {
        total: 1,
        accepted: 0,
        completed: 0,
        failed: 0,
        stopped: 0,
        pending: 1,
        running: 1,
        remaining: 1
      },
      providerBatch: {
        operationId: "job-pending",
        clientRequestKey: "pb_pending",
        provider: "openai",
        model: "gpt-5.6-sol",
        submissionState: "submitting",
        monitoringState: "monitoring",
        chunks: [
          {
            chunkId: "chunk_1",
            index: 0,
            submissionState: "pending"
          }
        ]
      }
    });

    recoverInterruptedWork(harness.context.db);

    const acceptedRecovered = harness.context.repositories.providerBatches.get(accepted.id);
    const pendingRecovered = harness.context.repositories.providerBatches.get(pending.id);
    expect(acceptedRecovered).toMatchObject({
      status: "credential_required",
      error: {
        code: "RECOVERED_AFTER_RESTART"
      },
      providerBatch: {
        state: "awaiting-credential",
        status: "credential_required"
      }
    });
    expect(pendingRecovered).toMatchObject({
      status: "submission_unknown",
      error: {
        code: "RECOVERED_AFTER_RESTART"
      },
      providerBatch: {
        state: "ambiguous",
        status: "submission_unknown"
      }
    });
  });
});
