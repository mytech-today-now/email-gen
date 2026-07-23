import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import supertest from "supertest";
import { createApp } from "../../src/app.js";
import { loadAppConfig } from "../../config/app.config.js";
import { closeDatabase } from "../../src/persistence/database.js";

function defaultHostHeader(config) {
  return config.host.includes(":") ? `[${config.host}]:${config.port}` : `${config.host}:${config.port}`;
}

function withDefaultHeaders(request, headers) {
  const unsafeMethods = new Set(["post", "put", "patch", "delete"]);
  return new Proxy(request, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (!unsafeMethods.has(property) || typeof value !== "function") return value;
      return (...args) => {
        const pending = value.apply(target, args);
        for (const [header, headerValue] of Object.entries(headers)) {
          pending.set(header, headerValue);
        }
        return pending;
      };
    }
  });
}

export function createTestHarness(options = {}) {
  const dir = options.dir ?? fs.mkdtempSync(path.join(os.tmpdir(), "email-gen-test-"));
  const ownsDir = !options.dir;
  const base = loadAppConfig();
  const config = loadAppConfig({
    dataDir: path.join(dir, "storage"),
    databasePath: path.join(dir, "storage", "test.sqlite"),
    outputDir: path.join(dir, "output"),
    logsDir: path.join(dir, "logs"),
    logLevel: "silent",
    ai: {
      ...base.ai,
      defaultProvider: "mock",
      defaultModel: "mock-structured-v1",
      defaultDelayMs: 0,
      maxRetries: options.maxRetries ?? 1
    },
    research: {
      ...base.research,
      enabled: options.researchEnabled ?? false
    },
    modelSync: {
      ...base.modelSync,
      enabled: options.modelSyncEnabled ?? true,
      startup: options.modelSyncStartup ?? false,
      intervalSeconds: options.modelSyncIntervalSeconds ?? 0,
      cacheTtlSeconds: options.modelSyncCacheTtlSeconds ?? 3600,
      missingGraceSeconds: options.modelSyncMissingGraceSeconds ?? 60
    },
    ...(options.configOverrides ?? {})
  });
  const harness = createApp({
    config,
    fetchImpl: options.fetchImpl,
    browserLauncher: options.browserLauncher,
    requestFactory: options.requestFactory,
    resolver: options.resolver,
    logger: options.logger,
    modelDiscoveryAdapters: options.modelDiscoveryAdapters,
    runtimeCredentials: options.runtimeCredentials
  });
  const rawRequest = supertest(harness.app);
  const hostHeader = defaultHostHeader(config);
  return {
    ...harness,
    request: withDefaultHeaders(rawRequest, {
      host: hostHeader,
      "x-email-gen-csrf": harness.context.csrfToken
    }),
    rawRequest: withDefaultHeaders(rawRequest, {
      host: hostHeader
    }),
    dir,
    cleanup() {
      if (harness.context.modelSyncTimer) clearInterval(harness.context.modelSyncTimer);
      harness.context.logger?.flush?.();
      harness.context.logger?.close?.();
      closeDatabase(harness.context.db);
      if (ownsDir) fs.rmSync(dir, { recursive: true, force: true });
    }
  };
}

export async function waitForJob(request, id) {
  for (let index = 0; index < 30; index += 1) {
    const response = await request.get(`/api/jobs/${id}`).expect(200);
    if (["completed", "failed", "canceled"].includes(response.body.job.status)) return response.body.job;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Timed out waiting for job ${id}`);
}
