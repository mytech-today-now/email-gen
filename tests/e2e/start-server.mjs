import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createApp } from "../../src/app.js";
import { createShutdownCoordinator } from "../../src/lifecycle/shutdown.js";
import { closeDatabase } from "../../src/persistence/database.js";

const live = process.env.RUN_LIVE_E2E === "true";

process.env.NODE_ENV = "test";
process.env.AI_MOCK = live ? "false" : "true";
process.env.DEFAULT_AI_PROVIDER = "mock";
process.env.DEFAULT_AI_MODEL = "mock-structured-v1";
process.env.ENABLED_AI_PROVIDERS = "openai,anthropic,xai,venice,lumaai,custom,mock";
process.env.CUSTOM_PROVIDER_BASE_URL = "http://127.0.0.1:9999/v1";
process.env.HOST = "127.0.0.1";
process.env.PORT = "3200";
process.env.LOG_LEVEL = "silent";
process.env.DEFAULT_DELAY_MS = "0";
process.env.RESEARCH_ENABLED = "true";
process.env.RESEARCH_RENDER_DELAY_MS = "0";
const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "email-gen-e2e-"));
process.env.DATABASE_PATH = path.join(runDir, "e2e.sqlite");

if (live) {
  await import("../../server.js");
} else {
  const { app, context } = createApp({ fetchImpl: createE2eFetchMock() });
  seedOpenAiBatchModel(context);
  context.runtimeCredentials.set("openai", "sk-e2e-openai-batch");

  const server = app.listen(context.config.port, context.config.host);
  server.requestTimeout = Math.max(
    context.config.limits.responseDeadlineMs + context.config.limits.cancellationLatencyMs,
    30_000
  );
  server.headersTimeout = Math.max(server.requestTimeout + 1_000, 5_000);
  server.keepAliveTimeout = Math.max(context.config.limits.responseIdleTimeoutMs, 5_000);
  server.timeout = Math.max(context.config.limits.responseIdleTimeoutMs, 5_000);

  const shutdown = createShutdownCoordinator({
    context,
    server,
    logger: context.logger,
    closeDatabase,
    drainTimeoutMs: Math.max(8_000, context.config.limits.cancellationLatencyMs)
  });
  shutdown.attachServer(server);
  shutdown.installProcessHandlers();
}

function seedOpenAiBatchModel(context) {
  context.modelCatalogRepository.upsertDiscoveredModels({
    providerId: "openai",
    runId: "e2e-provider-batch",
    models: [
      {
        providerId: "openai",
        providerModelId: "gpt-5.6-sol",
        displayName: "GPT-5.6 Sol",
        aliases: ["gpt-5.6"],
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
        discoverySource: "e2e-provider-batch",
        metadataSource: { providerMetadata: true },
        rawProviderMetadata: null,
        compatibility: { compatible: true, reasons: [] }
      }
    ]
  });
}

function createE2eFetchMock() {
  const openAiBatch = createOpenAiBatchMock();
  return async (url, options = {}) => {
    const target = String(url);
    if (target.startsWith("https://api.openai.com/v1/")) {
      return openAiBatch.handle(target, options);
    }
    throw new Error(`Unexpected mocked fetch: ${options.method || "GET"} ${target}`);
  };
}

function createOpenAiBatchMock() {
  const files = new Map();
  const batches = new Map();
  let fileCounter = 0;
  let batchCounter = 0;

  return {
    async handle(url, options = {}) {
      if (url === "https://api.openai.com/v1/files" && options.method === "POST") {
        const form = options.body;
        const uploaded = form?.get?.("file");
        const lines = uploaded ? await uploaded.text() : "";
        const fileId = `file_${++fileCounter}`;
        files.set(fileId, {
          type: "input",
          lines,
          requests: parseJsonLines(lines)
        });
        return jsonResponse({ id: fileId });
      }

      if (url === "https://api.openai.com/v1/batches" && options.method === "POST") {
        const payload = JSON.parse(String(options.body || "{}"));
        const source = files.get(payload.input_file_id);
        if (!source) throw new Error(`Missing mocked OpenAI file ${payload.input_file_id}`);
        const batchId = `batch_${++batchCounter}`;
        const outputFileId = `file_${++fileCounter}`;
        batches.set(batchId, {
          id: batchId,
          inputFileId: payload.input_file_id,
          outputFileId,
          pollCount: 0,
          status: "validating",
          requests: source.requests
        });
        files.set(outputFileId, {
          type: "output",
          lines: renderOpenAiBatchResults(source.requests)
        });
        return jsonResponse({
          id: batchId,
          input_file_id: payload.input_file_id,
          output_file_id: null,
          status: "validating"
        });
      }

      const statusMatch = url.match(/^https:\/\/api\.openai\.com\/v1\/batches\/([^/]+)$/);
      if (statusMatch && (options.method === undefined || options.method === "GET")) {
        const batch = batches.get(statusMatch[1]);
        if (!batch) throw new Error(`Missing mocked OpenAI batch ${statusMatch[1]}`);
        batch.pollCount += 1;
        if (batch.status !== "cancelling" && batch.status !== "cancelled") {
          batch.status = batch.pollCount < 3 ? "in_progress" : "completed";
        }
        return jsonResponse({
          id: batch.id,
          input_file_id: batch.inputFileId,
          output_file_id: batch.status === "completed" ? batch.outputFileId : null,
          status: batch.status,
          request_counts: {
            total: batch.requests.length,
            completed: batch.status === "completed" ? batch.requests.length : 0,
            failed: 0
          }
        });
      }

      const cancelMatch = url.match(/^https:\/\/api\.openai\.com\/v1\/batches\/([^/]+)\/cancel$/);
      if (cancelMatch && options.method === "POST") {
        const batch = batches.get(cancelMatch[1]);
        if (!batch) throw new Error(`Missing mocked OpenAI batch ${cancelMatch[1]}`);
        batch.status = "cancelling";
        return jsonResponse({ id: batch.id, status: batch.status });
      }

      const fileMatch = url.match(/^https:\/\/api\.openai\.com\/v1\/files\/([^/]+)\/content$/);
      if (fileMatch && (options.method === undefined || options.method === "GET")) {
        const file = files.get(fileMatch[1]);
        if (!file) throw new Error(`Missing mocked OpenAI file ${fileMatch[1]}`);
        return textResponse(file.lines, "application/jsonl");
      }

      throw new Error(`Unhandled mocked OpenAI request: ${options.method || "GET"} ${url}`);
    }
  };
}

function parseJsonLines(lines) {
  return String(lines)
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function renderOpenAiBatchResults(requests) {
  return requests
    .map((request, index) =>
      JSON.stringify({
        custom_id: request.custom_id,
        response: {
          body: {
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    subject: `Provider batch result ${index + 1}`,
                    bodyHtml: `<p>Provider batch mock completed for request ${index + 1}.</p>`
                  })
                }
              }
            ],
            usage: {
              prompt_tokens: 20 + index,
              completion_tokens: 40 + index
            }
          }
        }
      })
    )
    .join("\n");
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function textResponse(text, type = "text/plain") {
  return new Response(text, {
    status: 200,
    headers: { "content-type": type }
  });
}
