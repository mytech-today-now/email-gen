import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadAppConfig } from "../../config/app.config.js";
import { buildResendReviewFingerprint } from "../../public/modules/resendReview.js";
import { createTestHarness } from "../helpers/appTestHarness.js";

const harnesses = [];
const baseLimits = loadAppConfig().limits;
afterEach(() => {
  while (harnesses.length) harnesses.pop().cleanup();
});

function removeHarness(harness) {
  const index = harnesses.indexOf(harness);
  if (index >= 0) harnesses.splice(index, 1);
}

function setup(options) {
  const harness = createTestHarness(options);
  harnesses.push(harness);
  return harness;
}

async function bootstrap(harness) {
  const response = await harness.request.get("/api/gateway/bootstrap").expect(200);
  return response.body.csrfToken;
}

function saveCredential(harness, csrf, providerId, credential) {
  return harness.request
    .put(`/api/credentials/${providerId}`)
    .set("x-email-gen-csrf", csrf)
    .send({ credential });
}

function discoveredModel(providerId, providerModelId, extra = {}) {
  return {
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
        verifiedAt: "2026-07-21"
      }
    },
    regionalAvailability: null,
    requiredApiVersion: null,
    capabilityConfidence: "confirmed",
    discoverySource: "integration-test",
    metadataSource: { providerMetadata: true },
    rawProviderMetadata: null,
    compatibility: { compatible: true, reasons: [] },
    ...extra
  };
}

function seedOpenAiBatchModel(harness, providerModelId = "gpt-5.6-sol") {
  harness.context.modelCatalogRepository.upsertDiscoveredModels({
    providerId: "openai",
    runId: "gateway-batch-test",
    models: [discoveredModel("openai", providerModelId)]
  });
}

async function createResendReview({
  reviewId,
  reviewedAt = "2030-01-01T12:00:00.000Z",
  expiresAt = "2030-01-01T12:15:00.000Z",
  projectId = null,
  sender,
  items,
  suppressions = [],
  batchSize = 100,
  testRecipient = ""
}) {
  return buildResendReviewFingerprint({
    reviewId,
    reviewedAt,
    expiresAt,
    projectId,
    sender,
    items,
    suppressions,
    batchSize,
    testRecipient
  });
}

describe("ephemeral browser gateway", () => {
  it("reports sanitized runtime credential state through GET /api/credentials", async () => {
    const harness = setup();
    harness.context.runtimeCredentials.set("openai", "runtime-route-secret");

    const response = await harness.request.get("/api/credentials").expect(200);

    expect(response.body.credentials.find((item) => item.id === "openai")).toMatchObject({
      id: "openai",
      configured: true,
      status: "configured"
    });
    expect(response.body.ai.providers.find((provider) => provider.id === "openai")).toMatchObject({
      hasCredential: true,
      credentialStatus: "configured"
    });
    expect(JSON.stringify(response.body)).not.toContain("runtime-route-secret");
  });

  it("requires the CSRF token for credential changes and keeps runtime credentials server-side only", async () => {
    const harness = setup();
    const csrf = await bootstrap(harness);
    await harness.rawRequest.put("/api/credentials/openrouter").send({ credential: "secret" }).expect(403);
    const created = await saveCredential(harness, csrf, "openrouter", "secret");
    expect(created.status).toBe(200);
    expect(created.body.credential).toMatchObject({
      id: "openrouter",
      configured: true,
      status: "configured"
    });
    expect(JSON.stringify(created.body)).not.toContain("secret");
    expect(harness.context.runtimeCredentials.get("openrouter")).toBe("secret");
    await harness.request.delete("/api/credentials/openrouter").set("x-email-gen-csrf", csrf).expect(200);
    expect(harness.context.runtimeCredentials.get("openrouter")).toBe("");
  });

  it("tests runtime credentials through POST /api/credentials/:id/test without exposing the secret", async () => {
    const calls = [];
    const harness = setup({
      fetchImpl: async (url, options) => {
        calls.push({ url, headers: options.headers });
        return new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
    });
    const csrf = await bootstrap(harness);
    const credential = "secret-value-12345678901234567890";
    await saveCredential(harness, csrf, "openrouter", credential).expect(200);

    const response = await harness.request
      .post("/api/credentials/openrouter/test")
      .set("x-email-gen-csrf", csrf)
      .send({})
      .expect(200);

    expect(calls).toEqual([
      {
        url: "https://openrouter.ai/api/v1/models",
        headers: { authorization: `Bearer ${credential}` }
      }
    ]);
    expect(response.body).toMatchObject({
      ok: true,
      result: { ok: true },
      credential: {
        id: "openrouter",
        configured: true,
        status: "valid",
        validationCode: null
      }
    });
    expect(JSON.stringify(response.body)).not.toContain(credential);
  });

  it("clears runtime credentials on restart even when the storage directory is reused", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "email-gen-restart-"));
    let second = null;
    try {
      const first = setup({ dir });
      const csrf = await bootstrap(first);
      await saveCredential(first, csrf, "openrouter", "restart-only-secret").expect(200);
      expect(first.context.runtimeCredentials.get("openrouter")).toBe("restart-only-secret");
      first.cleanup();
      removeHarness(first);

      second = setup({ dir });
      const response = await second.request.get("/api/credentials").expect(200);
      expect(second.context.runtimeCredentials.get("openrouter")).toBe("");
      expect(response.body.credentials.find((item) => item.id === "openrouter")).toMatchObject({
        id: "openrouter",
        configured: false,
        status: "not-configured"
      });
    } finally {
      second?.cleanup();
      if (second) removeHarness(second);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("handles rapid save, test, replace, and clear cycles without reviving credentials", async () => {
    const seenAuthorizations = [];
    const harness = setup({
      fetchImpl: async (_url, options) => {
        seenAuthorizations.push(options.headers.authorization);
        return new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
    });
    const csrf = await bootstrap(harness);
    const firstCredential = "rapid-secret-12345678901234567890";
    const secondCredential = "rapid-secret-ABCDEFGHIJ1234567890";
    await saveCredential(harness, csrf, "openrouter", firstCredential).expect(200);
    await harness.request
      .post("/api/credentials/openrouter/test")
      .set("x-email-gen-csrf", csrf)
      .send({})
      .expect(200);
    await saveCredential(harness, csrf, "openrouter", secondCredential).expect(200);
    await harness.request
      .post("/api/credentials/openrouter/test")
      .set("x-email-gen-csrf", csrf)
      .send({})
      .expect(200);
    await harness.request.delete("/api/credentials/openrouter").set("x-email-gen-csrf", csrf).expect(200);
    const tested = await harness.request
      .post("/api/credentials/openrouter/test")
      .set("x-email-gen-csrf", csrf)
      .send({})
      .expect(400);

    expect(seenAuthorizations).toEqual([`Bearer ${firstCredential}`, `Bearer ${secondCredential}`]);
    expect(tested.body.error.code).toBe("PROVIDER_CREDENTIAL_MISSING");
    expect(harness.context.runtimeCredentials.get("openrouter")).toBe("");

    const afterClear = await harness.request.get("/api/credentials").expect(200);
    expect(afterClear.body.credentials.find((item) => item.id === "openrouter")).toMatchObject({
      id: "openrouter",
      configured: false,
      status: "not-configured",
      validationCode: "PROVIDER_CREDENTIAL_MISSING"
    });
  });

  it("generates mock output without persisting browser-owned records or results to SQLite", async () => {
    const harness = setup();
    const csrf = await bootstrap(harness);
    const beforeRecords = harness.context.repositories.records.list().length;
    const beforeResults = harness.context.repositories.results.list().length;
    const response = await harness.request
      .post("/api/gateway/generate")
      .set("x-email-gen-csrf", csrf)
      .send({
        record: {
          id: "browser-record",
          displayName: "Browser Bistro",
          normalized: { name: "Browser Bistro", city: "Omaha" },
          raw: {},
          validation: {}
        },
        template: { name: "browser-template", content: "Write for {{name|required}} in {{city?}}" },
        provider: "mock",
        model: "mock-structured-v1",
        researchEnabled: false,
        options: {}
      })
      .expect(200);
    expect(response.body.generated.subject).toContain("Browser Bistro");
    expect(harness.context.repositories.records.list()).toHaveLength(beforeRecords);
    expect(harness.context.repositories.results.list()).toHaveLength(beforeResults);
  });

  it("uses the direct OpenAI compatibility path for runtime-credential-backed gateway generation", async () => {
    const previousMock = process.env.AI_MOCK;
    process.env.AI_MOCK = "false";
    const calls = [];

    try {
      const harness = setup({
        fetchImpl: async (_url, options) => {
          calls.push({
            headers: options.headers,
            body: JSON.parse(options.body)
          });
          return new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: JSON.stringify({ subject: "Browser Bistro", bodyHtml: "<p>Hello</p>" })
                  }
                }
              ],
              usage: { prompt_tokens: 12, completion_tokens: 34 }
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }
      });
      harness.context.runtimeCredentials.set("openai", "sk-runtime-test");
      const csrf = await bootstrap(harness);
      const response = await harness.request
        .post("/api/gateway/generate")
        .set("x-email-gen-csrf", csrf)
        .send({
          record: {
            id: "browser-record",
            displayName: "Browser Bistro",
            normalized: { name: "Browser Bistro", city: "Omaha" },
            raw: {},
            validation: {}
          },
          template: { name: "browser-template", content: "Write for {{name|required}} in {{city?}}" },
          provider: "openai",
          model: "gpt-5.6",
          researchEnabled: false,
          options: {}
        })
        .expect(200);

      expect(response.body.generated.subject).toBe("Browser Bistro");
      expect(calls).toHaveLength(1);
      expect(calls[0].headers.authorization).toBe("Bearer sk-runtime-test");
      expect(calls[0].body.max_completion_tokens).toBe(harness.context.config.ai.maxTokens);
      expect(calls[0].body.max_tokens).toBeUndefined();
    } finally {
      process.env.AI_MOCK = previousMock;
    }
  });

  it("deduplicates simultaneous generate requests to one provider call and one stored operation", async () => {
    const previousMock = process.env.AI_MOCK;
    process.env.AI_MOCK = "false";
    const calls = [];
    let releaseFirstProviderCall = null;
    let firstProviderCallSeen = null;

    try {
      const harness = setup({
        fetchImpl: async (url, options) => {
          if (url !== "https://api.openai.com/v1/chat/completions") {
            throw new Error(`Unexpected URL ${url}`);
          }
          calls.push({
            url,
            headers: options.headers,
            body: JSON.parse(options.body)
          });
          if (calls.length === 1) {
            firstProviderCallSeen?.();
            await new Promise((resolve) => {
              releaseFirstProviderCall = resolve;
            });
          }
          return new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: JSON.stringify({ subject: "Browser Bistro", bodyHtml: "<p>Hello</p>" })
                  }
                }
              ],
              usage: { prompt_tokens: 12, completion_tokens: 34 }
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }
      });
      harness.context.runtimeCredentials.set("openai", "sk-runtime-test");
      const csrf = await bootstrap(harness);
      const body = {
        record: {
          id: "browser-record",
          displayName: "Browser Bistro",
          normalized: { name: "Browser Bistro", city: "Omaha" },
          raw: {},
          validation: {}
        },
        template: { name: "browser-template", content: "Write for {{name|required}} in {{city?}}" },
        provider: "openai",
        model: "gpt-5.6",
        researchEnabled: false,
        options: {}
      };

      const firstRequestSeen = new Promise((resolve) => {
        firstProviderCallSeen = resolve;
      });
      const firstResponsePromise = Promise.resolve(
        harness.request
          .post("/api/gateway/generate")
          .set("x-email-gen-csrf", csrf)
          .send({
            ...body,
            operationId: "browser-op-tab-1"
          })
      );
      await firstRequestSeen;
      const secondResponsePromise = Promise.resolve(
        harness.request
          .post("/api/gateway/generate")
          .set("x-email-gen-csrf", csrf)
          .send({
            ...body,
            operationId: "browser-op-tab-2"
          })
      );

      await new Promise((resolve) => setTimeout(resolve, 100));
      releaseFirstProviderCall?.();

      const [first, second] = await Promise.all([firstResponsePromise, secondResponsePromise]);
      expect(calls).toHaveLength(1);
      expect(first.body.operationId).toBe("browser-op-tab-1");
      expect(second.body.operationId).toBe(first.body.operationId);
      expect(second.body.scopeKey).toBe(first.body.scopeKey);
      expect(second.body.generated).toEqual(first.body.generated);
      expect(
        harness.context.repositories.gatewayOperations.getByFingerprint(first.body.scopeKey)
      ).toMatchObject({
        operationId: "browser-op-tab-1",
        status: "succeeded"
      });
    } finally {
      process.env.AI_MOCK = previousMock;
      releaseFirstProviderCall?.();
    }
  });

  it("parses legacy markdown provider responses in the browser gateway path", async () => {
    const previousMock = process.env.AI_MOCK;
    process.env.AI_MOCK = "false";

    try {
      const harness = setup({
        fetchImpl: async () =>
          new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: "**Subject:** Browser Bistro follow-up\n\nHello from the legacy formatter."
                  }
                }
              ],
              usage: { prompt_tokens: 12, completion_tokens: 34 }
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          )
      });
      harness.context.runtimeCredentials.set("openai", "sk-runtime-test");
      const csrf = await bootstrap(harness);
      const response = await harness.request
        .post("/api/gateway/generate")
        .set("x-email-gen-csrf", csrf)
        .send({
          record: {
            id: "browser-record",
            displayName: "Browser Bistro",
            normalized: { name: "Browser Bistro", city: "Omaha", website: "https://browser.example/" },
            raw: {},
            validation: {}
          },
          template: { name: "browser-template", content: "Write for {{name|required}} in {{city?}}" },
          provider: "openai",
          model: "gpt-5.6",
          researchEnabled: false,
          options: {}
        })
        .expect(200);

      expect(response.body.generated.subject).toBe("Browser Bistro follow-up");
      expect(response.body.generated.bodyHtml).toContain("Hello from the legacy formatter.");
    } finally {
      process.env.AI_MOCK = previousMock;
    }
  });

  it("parses fenced raw HTML provider responses in the browser gateway path", async () => {
    const previousMock = process.env.AI_MOCK;
    process.env.AI_MOCK = "false";

    try {
      const harness = setup({
        fetchImpl: async () =>
          new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content:
                      "```html\n<!-- Subject: Browser Bistro weekend special -->\n<table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" width=\"100%\"><tr><td style=\"color:#0c6a63\"><p>Freshly baked croissants &amp; coffee.</p></td></tr></table>\n```"
                  }
                }
              ],
              usage: { prompt_tokens: 12, completion_tokens: 34 }
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          )
      });
      harness.context.runtimeCredentials.set("openai", "sk-runtime-test");
      const csrf = await bootstrap(harness);
      const response = await harness.request
        .post("/api/gateway/generate")
        .set("x-email-gen-csrf", csrf)
        .send({
          record: {
            id: "browser-record",
            displayName: "Browser Bistro",
            normalized: { name: "Browser Bistro", city: "Omaha", website: "https://browser.example/" },
            raw: {},
            validation: {}
          },
          template: { name: "browser-template", content: "Write for {{name|required}} in {{city?}}" },
          provider: "openai",
          model: "gpt-5.6",
          researchEnabled: false,
          options: {}
        })
        .expect(200);

      expect(response.body.generated.subject).toBe("Browser Bistro weekend special");
      expect(response.body.generated.bodyHtml).toContain("<table role=\"presentation\"");
      expect(response.body.generated.bodyHtml).toContain("Freshly baked croissants &amp; coffee.");
    } finally {
      process.env.AI_MOCK = previousMock;
    }
  });

  it("normalizes a mocked Ollama catalog and treats absence as non-fatal", async () => {
    const present = setup({
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            models: [
              {
                model: "gemma3",
                modified_at: "2026-01-01T00:00:00Z",
                size: 123,
                details: { family: "gemma", parameter_size: "4B", quantization_level: "Q4" }
              }
            ]
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
    });
    const csrf = await bootstrap(present);
    const response = await present.request
      .post("/api/gateway/models/ollama")
      .set("x-email-gen-csrf", csrf)
      .send({ host: "http://127.0.0.1:11434" })
      .expect(200);
    expect(response.body.result.models[0].pricing.status).toBe("local-compute");
    expect(response.body.result.models[0].compatibility.status).toBe("ready");
  });

  it("submits a verified OpenAI provider batch through the gateway", async () => {
    const previousMock = process.env.AI_MOCK;
    process.env.AI_MOCK = "false";
    const calls = [];

    try {
      const harness = setup({
        fetchImpl: async (url, options) => {
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
      const response = await harness.request
        .post("/api/gateway/batches/submit")
        .set("x-email-gen-csrf", csrf)
        .send({
          projectId: null,
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
        })
        .expect(200);

      expect(response.body.batch.capability).toMatchObject({
        classification: "native_discounted_batch",
        discountPercent: 50
      });
      expect(response.body.batch.chunks[0]).toMatchObject({
        providerBatchId: "batch_1",
        inputFileId: "file_1",
        providerStatus: "validating"
      });
      expect(response.body.batch.requests[0].customId).toMatch(/^req_/);
      expect(calls[0].headers.authorization).toBe("Bearer sk-batch-test");
      expect(JSON.parse(calls[1].body)).toMatchObject({
        input_file_id: "file_1",
        endpoint: "/v1/chat/completions",
        completion_window: "24h"
      });
    } finally {
      process.env.AI_MOCK = previousMock;
    }
  });

  it("resolves provider batches by operation id when the request hash is unavailable", async () => {
    const harness = setup();
    const csrf = await bootstrap(harness);
    const operation = harness.context.repositories.providerBatches.create({
      id: "job_resolve",
      projectId: "project_alpha",
      status: "submitted",
      requestHash: "pb_resolve_1",
      clientRequestKey: "pb_resolve_1",
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
        operationId: "job_resolve",
        requestHash: "pb_resolve_1",
        provider: "openai",
        model: "gpt-5.6-sol",
        submissionState: "submitted",
        monitoringState: "monitoring",
        chunks: [
          {
            chunkId: "chunk_1",
            index: 0,
            requestHash: "pb_resolve_1",
            providerBatchId: "batch_1",
            providerStatus: "validating",
            submissionState: "submitted"
          }
        ]
      }
    });

    const response = await harness.request
      .post("/api/gateway/batches/resolve")
      .set("x-email-gen-csrf", csrf)
      .send({ operationId: operation.id })
      .expect(200);

    expect(response.body.operation).toMatchObject({
      operationId: operation.id,
      requestHash: "pb_resolve_1",
      providerBatch: {
        operationId: operation.id,
        requestHash: "pb_resolve_1"
      }
    });
  });

  it("retrieves completed OpenAI provider batch results through the gateway", async () => {
    const previousMock = process.env.AI_MOCK;
    process.env.AI_MOCK = "false";

    try {
      const harness = setup({
        fetchImpl: async (url) => {
          if (url === "https://api.openai.com/v1/batches/batch_1") {
            return new Response(
              JSON.stringify({
                id: "batch_1",
                status: "completed",
                output_file_id: "file_2"
              }),
              { status: 200, headers: { "content-type": "application/json" } }
            );
          }
          if (url === "https://api.openai.com/v1/files/file_2/content") {
            return new Response(
              [
                JSON.stringify({
                  custom_id: "req_browser_record_123",
                  response: {
                    body: {
                      choices: [
                        {
                          message: {
                            content: JSON.stringify({
                              subject: "Batch Browser Bistro",
                              bodyHtml: "<p>Hello from batch</p>"
                            })
                          }
                        }
                      ],
                      usage: { prompt_tokens: 12, completion_tokens: 34 }
                    }
                  }
                })
              ].join("\n"),
              { status: 200, headers: { "content-type": "application/json" } }
            );
          }
          throw new Error(`Unexpected URL ${url}`);
        }
      });
      seedOpenAiBatchModel(harness);
      harness.context.runtimeCredentials.set("openai", "sk-batch-test");
      const csrf = await bootstrap(harness);
      const response = await harness.request
        .post("/api/gateway/batches/status")
        .set("x-email-gen-csrf", csrf)
        .send({
          provider: "openai",
          model: "gpt-5.6-sol",
          chunks: [
            {
              chunkId: "chunk_1",
              providerBatchId: "batch_1",
              providerStatus: "in_progress",
              requestIds: ["req_browser_record_123"]
            }
          ]
        })
        .expect(200);

      expect(response.body.batch.chunks[0]).toMatchObject({
        providerBatchId: "batch_1",
        providerStatus: "completed",
        outputFileId: "file_2"
      });
      expect(response.body.batch.results[0]).toMatchObject({
        customId: "req_browser_record_123",
        state: "completed",
        generated: {
          subject: "Batch Browser Bistro",
          bodyHtml: "<p>Hello from batch</p>"
        },
        usage: {
          inputTokens: 12,
          outputTokens: 34
        }
      });
    } finally {
      process.env.AI_MOCK = previousMock;
    }
  });

  it("cancels submitted OpenAI provider batches through the gateway", async () => {
    const previousMock = process.env.AI_MOCK;
    process.env.AI_MOCK = "false";

    try {
      const harness = setup({
        fetchImpl: async (url, options) => {
          if (url === "https://api.openai.com/v1/batches/batch_1/cancel") {
            expect(options.method).toBe("POST");
            return new Response(JSON.stringify({ id: "batch_1", status: "cancelling" }), {
              status: 200,
              headers: { "content-type": "application/json" }
            });
          }
          throw new Error(`Unexpected URL ${url}`);
        }
      });
      seedOpenAiBatchModel(harness);
      harness.context.runtimeCredentials.set("openai", "sk-batch-test");
      const csrf = await bootstrap(harness);
      const response = await harness.request
        .post("/api/gateway/batches/cancel")
        .set("x-email-gen-csrf", csrf)
        .send({
          provider: "openai",
          model: "gpt-5.6-sol",
          chunks: [
            {
              chunkId: "chunk_1",
              providerBatchId: "batch_1",
              providerStatus: "in_progress",
              requestIds: ["req_browser_record_123"]
            }
          ]
        })
        .expect(200);

      expect(response.body.batch.chunks[0]).toMatchObject({
        providerBatchId: "batch_1",
        providerStatus: "cancelling"
      });
    } finally {
      process.env.AI_MOCK = previousMock;
    }
  });

  it("sends Ollama generation through localhost without an authorization header", async () => {
    const previousMock = process.env.AI_MOCK;
    process.env.AI_MOCK = "false";
    const calls = [];
    try {
      const harness = setup({
        fetchImpl: async (url, options) => {
          calls.push({
            url,
            headers: options.headers,
            body: JSON.parse(options.body)
          });
          return new Response(
            JSON.stringify({
              message: {
                content: JSON.stringify({ subject: "Browser Bistro", bodyHtml: "<p>Hello localhost</p>" })
              },
              prompt_eval_count: 21,
              eval_count: 34
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }
      });
      const csrf = await bootstrap(harness);
      const response = await harness.request
        .post("/api/gateway/generate")
        .set("x-email-gen-csrf", csrf)
        .send({
          record: {
            id: "browser-record",
            displayName: "Browser Bistro",
            normalized: { name: "Browser Bistro", city: "Omaha" },
            raw: {},
            validation: {}
          },
          template: { name: "browser-template", content: "Write for {{name|required}} in {{city?}}" },
          provider: "ollama",
          model: "phi4:latest",
          researchEnabled: false,
          options: { ollamaHost: "http://localhost:11434" }
        })
        .expect(200);

      expect(response.body.generated).toMatchObject({
        subject: "Browser Bistro",
        bodyHtml: "<p>Hello localhost</p>"
      });
      expect(calls).toHaveLength(1);
      expect(calls[0].url).toBe("http://localhost:11434/api/chat");
      expect(calls[0].headers.authorization).toBeUndefined();
      expect(calls[0].body.format).toMatchObject({ type: "object" });
    } finally {
      process.env.AI_MOCK = previousMock;
    }
  });

  it("forwards browser diagnostics to the persistent server logger with redaction", async () => {
    const entries = [];
    const logger = Object.fromEntries(
      ["debug", "info", "warn", "error", "fatal"].map((level) => [
        level,
        (payload, message) => entries.push({ level, payload, message })
      ])
    );
    const harness = setup({ logger });
    const csrf = await bootstrap(harness);
    const response = await harness.request
      .post("/api/client-logs")
      .set("x-email-gen-csrf", csrf)
      .send({
        entries: [
          {
            level: "info",
            event: "editor_panel_resize_end",
            timestamp: "2026-07-19T00:00:00.000Z",
            correlationId: "corr_1",
            metadata: {
              apiKey: "sk-secret-12345678",
              htmlSummary: { characters: 144, hash: "deadbeef" }
            }
          }
        ]
      })
      .expect(202);

    expect(response.body.accepted).toBe(1);
    const browserLog = entries.find((entry) => entry.message === "Browser diagnostic event");
    expect(browserLog).toBeTruthy();
    expect(JSON.stringify(browserLog)).toContain("editor_panel_resize_end");
    expect(JSON.stringify(browserLog)).toContain("[REDACTED]");
    expect(JSON.stringify(browserLog)).not.toContain("sk-secret-12345678");
  });

  it("still applies baseline rate limiting to trusted browser traffic carrying the CSRF token", async () => {
    const harness = setup({
      configOverrides: {
        limits: { ...baseLimits, apiRequestsPerMinute: 1 }
      }
    });

    for (let index = 0; index < 3; index += 1) {
      await harness.request
        .post("/api/client-logs")
        .send({ entries: [] })
        .expect(index === 0 ? 202 : 429);
    }
  });

  it("still rate-limits untrusted API requests without the CSRF token", async () => {
    const harness = setup({
      configOverrides: {
        limits: { ...baseLimits, apiRequestsPerMinute: 1 }
      }
    });

    await harness.request.get("/api/health").expect(200);
    await harness.request.get("/api/ready").expect(429);
  });

  it("returns an exact consent-aware Resend preflight without making a send", async () => {
    const harness = setup({ modelSyncEnabled: false, modelSyncStartup: false });
    const csrf = await bootstrap(harness);
    const response = await harness.request
      .post("/api/gateway/resend/preflight")
      .set("x-email-gen-csrf", csrf)
      .send({
        items: [
          {
            id: "eligible",
            primaryEmail: "yes@example.com",
            consentStatus: "opted-in",
            consentSource: "signup",
            consentTimestamp: "2026-01-01T00:00:00Z"
          },
          { id: "blocked", primaryEmail: "cold@example.com", consentStatus: "unknown" }
        ],
        suppressions: []
      })
      .expect(200);
    expect(response.body.preflight.recipientCount).toBe(1);
    expect(response.body.preflight.excluded[0].id).toBe("blocked");
  }, 60_000);

  it("rejects unknown resend preflight fields", async () => {
    const harness = setup({ modelSyncEnabled: false, modelSyncStartup: false });
    const csrf = await bootstrap(harness);

    const response = await harness.request
      .post("/api/gateway/resend/preflight")
      .set("x-email-gen-csrf", csrf)
      .send({
        items: [
          {
            id: "eligible",
            primaryEmail: "yes@example.com",
            consentStatus: "opted-in",
            consentSource: "signup",
            consentTimestamp: "2026-01-01T00:00:00Z"
          }
        ],
        suppressions: [],
        unexpected: true
      })
      .expect(400);

    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  }, 60_000);

  it("rejects stale resend confirmations when sender data changes after review", async () => {
    const harness = setup({ modelSyncEnabled: false, modelSyncStartup: false });
    const csrf = await bootstrap(harness);
    const reviewedAt = "2030-01-01T12:00:00.000Z";
    const expiresAt = "2030-01-01T12:15:00.000Z";
    const sender = {
      fromName: "Acme",
      fromAddress: "hello@example.com"
    };
    const review = await createResendReview({
      reviewId: "resend-review-stale",
      reviewedAt,
      expiresAt,
      sender,
      items: [
        {
          id: "eligible",
          primaryEmail: "yes@example.com",
          consentStatus: "opted-in",
          consentSource: "signup",
          consentTimestamp: "2026-01-01T00:00:00Z",
          subject: "Hello",
          html: "<p>Hello</p>",
          text: "Hello"
        }
      ],
      suppressions: [],
      batchSize: 100
    });

    const response = await harness.request
      .post("/api/gateway/resend/send")
      .set("x-email-gen-csrf", csrf)
      .send({
        confirmed: true,
        operationId: "resend-stale-confirmation",
        review: {
          reviewId: review.reviewId,
          reviewedAt,
          expiresAt,
          payloadDigest: review.payloadDigest,
          suppressionDigest: review.suppressionDigest,
          batchSize: review.batchSize,
          testRecipient: review.testRecipient
        },
        items: review.items,
        suppressions: review.suppressions,
        batchSize: review.batchSize,
        sender: {
          ...sender,
          fromAddress: "different@example.com"
        },
        projectId: null
      })
      .expect(409);

    expect(response.body.error.code).toBe("RESEND_REVIEW_STALE");
    expect(harness.context.repositories.gatewayOperations.get("resend-stale-confirmation")).toBeNull();
  }, 60_000);

  it("rejects invalid unsubscribe URLs in the resend send schema", async () => {
    const harness = setup({ modelSyncEnabled: false, modelSyncStartup: false });
    const csrf = await bootstrap(harness);
    harness.context.runtimeCredentials.set("resend", "re_test");
    const review = await createResendReview({
      reviewId: "resend-review-invalid-url",
      sender: {
        fromName: "Acme",
        fromAddress: "hello@example.com"
      },
      items: [
        {
          id: "eligible",
          primaryEmail: "person@example.com",
          consentStatus: "opted-in",
          consentSource: "signup",
          consentTimestamp: "2026-01-01T00:00:00Z",
          subject: "Hello",
          html: "<p>Hello</p>",
          text: "Hello"
        }
      ],
      suppressions: [],
      batchSize: 100
    });

    const response = await harness.request
      .post("/api/gateway/resend/send")
      .set("x-email-gen-csrf", csrf)
      .send({
        confirmed: true,
        operationId: "resend-invalid-url",
        review: {
          reviewId: review.reviewId,
          reviewedAt: review.reviewedAt,
          expiresAt: review.expiresAt,
          payloadDigest: review.payloadDigest,
          suppressionDigest: review.suppressionDigest,
          batchSize: review.batchSize,
          testRecipient: review.testRecipient
        },
        items: review.items,
        suppressions: review.suppressions,
        batchSize: review.batchSize,
        sender: {
          fromName: "Acme",
          fromAddress: "hello@example.com",
          unsubscribeUrl: "ftp://example.com"
        },
        projectId: null
      })
      .expect(400);

    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  }, 60_000);

  it("persists partial resend receipts and resumes the unsent chunk after recovery", async () => {
    const calls = [];
    const harness = setup(
      {
        modelSyncEnabled: false,
        modelSyncStartup: false,
        fetchImpl: async (_url, options = {}) => {
          calls.push({
            headers: { ...options.headers },
            body: JSON.parse(options.body)
          });
          if (calls.length === 1) {
            return new Response(JSON.stringify({ data: [{ id: "resend-1" }] }), {
              status: 200,
              headers: { "content-type": "application/json" }
            });
          }
          if (calls.length === 2) {
            return new Response(JSON.stringify({ message: "hard fail" }), {
              status: 400,
              headers: { "content-type": "application/json" }
            });
          }
          return new Response(JSON.stringify({ data: [{ id: "resend-2" }] }), {
            status: 200,
            headers: { "content-type": "application/json" }
          });
        }
      },
      60_000
    );
    const csrf = await bootstrap(harness);
    harness.context.runtimeCredentials.set("resend", "re_test");
    const reviewedAt = "2030-01-01T12:00:00.000Z";
    const expiresAt = "2030-01-01T12:15:00.000Z";
    const sender = {
      fromName: "Acme",
      fromAddress: "hello@example.com",
      companyAddress: "123 Main St",
      unsubscribeUrl: "https://example.com/unsubscribe"
    };
    const review = await createResendReview({
      reviewId: "resend-review-partial",
      reviewedAt,
      expiresAt,
      sender,
      items: [
        {
          id: "result-1",
          primaryEmail: "one@example.com",
          consentStatus: "opted-in",
          consentSource: "signup",
          consentTimestamp: "2026-01-01T00:00:00Z",
          subject: "Hello one",
          html: "<p>Hello one</p><p>123 Main St</p><p>https://example.com/unsubscribe</p>",
          text: "Hello one 123 Main St https://example.com/unsubscribe"
        },
        {
          id: "result-2",
          primaryEmail: "two@example.com",
          consentStatus: "opted-in",
          consentSource: "signup",
          consentTimestamp: "2026-01-01T00:00:00Z",
          subject: "Hello two",
          html: "<p>Hello two</p><p>123 Main St</p><p>https://example.com/unsubscribe</p>",
          text: "Hello two 123 Main St https://example.com/unsubscribe"
        }
      ],
      suppressions: [],
      batchSize: 1
    });
    const body = {
      confirmed: true,
      operationId: "resend-partial-recovery",
      review: {
        reviewId: review.reviewId,
        reviewedAt,
        expiresAt,
        payloadDigest: review.payloadDigest,
        suppressionDigest: review.suppressionDigest,
        batchSize: review.batchSize,
        testRecipient: review.testRecipient
      },
      items: review.items,
      suppressions: review.suppressions,
      batchSize: review.batchSize,
      sender,
      projectId: null
    };

    const firstResponse = await harness.request
      .post("/api/gateway/resend/send")
      .set("x-email-gen-csrf", csrf)
      .send(body)
      .expect(207);

    expect(firstResponse.body.operation.status).toBe("partially_completed");
    expect(firstResponse.body.operation.deliveries).toHaveLength(1);
    expect(calls).toHaveLength(2);
    expect(calls[0].body).toHaveLength(1);
    expect(calls[1].body).toHaveLength(1);

    const persisted = harness.context.repositories.gatewayOperations.get("resend-partial-recovery");
    expect(persisted).toMatchObject({
      status: "reconciliation-required"
    });
    expect(persisted.response.deliveries).toHaveLength(1);

    const recovery = await harness.request
      .get("/api/gateway/resend/resend-partial-recovery")
      .set("x-email-gen-csrf", csrf)
      .expect(200);
    expect(recovery.body.row.status).toBe("reconciliation-required");
    expect(recovery.body.operation.deliveries).toHaveLength(1);

    const secondResponse = await harness.request
      .post("/api/gateway/resend/send")
      .set("x-email-gen-csrf", csrf)
      .send(body)
      .expect(200);

    expect(secondResponse.body.operation.status).toBe("completed");
    expect(secondResponse.body.operation.deliveries).toHaveLength(2);
    expect(calls).toHaveLength(3);
    expect(calls[2].body).toHaveLength(1);
    expect(harness.context.repositories.gatewayOperations.get("resend-partial-recovery")).toMatchObject({
      status: "succeeded"
    });
  }, 60_000);

  it("records and exposes a tamper-evident resend audit trail", async () => {
    const harness = setup({
      modelSyncEnabled: false,
      modelSyncStartup: false,
      fetchImpl: async () =>
        new Response(JSON.stringify({ data: [{ id: "resend-1" }] }), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
    });
    const csrf = await bootstrap(harness);
    harness.context.runtimeCredentials.set("resend", "re_test");
    const review = await createResendReview({
      reviewId: "resend-review-audit",
      sender: {
        fromName: "Acme",
        fromAddress: "hello@example.com"
      },
      items: [
        {
          id: "eligible",
          primaryEmail: "person@example.com",
          consentStatus: "opted-in",
          consentSource: "signup",
          consentTimestamp: "2026-01-01T00:00:00Z",
          subject: "Hello",
          html: "<p>Hello</p>",
          text: "Hello"
        }
      ],
      suppressions: [],
      batchSize: 100
    });
    const body = {
      confirmed: true,
      operationId: "resend-audit-operation",
      review: {
        reviewId: review.reviewId,
        reviewedAt: review.reviewedAt,
        expiresAt: review.expiresAt,
        payloadDigest: review.payloadDigest,
        suppressionDigest: review.suppressionDigest,
        batchSize: review.batchSize,
        testRecipient: review.testRecipient
      },
      items: review.items,
      suppressions: review.suppressions,
      batchSize: review.batchSize,
      sender: {
        fromName: "Acme",
        fromAddress: "hello@example.com"
      },
      projectId: null
    };

    const sendResponse = await harness.request
      .post("/api/gateway/resend/send")
      .set("x-email-gen-csrf", csrf)
      .send(body)
      .expect(200);

    expect(sendResponse.body.operation.status).toBe("completed");

    const auditResponse = await harness.request
      .get("/api/gateway/resend/resend-audit-operation/audit")
      .set("x-email-gen-csrf", csrf)
      .expect(200);

    expect(auditResponse.body.verification).toMatchObject({
      ok: true,
      entryCount: expect.any(Number)
    });
    expect(auditResponse.body.entries[0].eventType).toBe("resend_operation_committed");
    expect(auditResponse.body.entries.some((entry) => entry.eventType === "resend_chunk_receipt")).toBe(true);
  }, 60_000);
});
