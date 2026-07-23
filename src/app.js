import express from "express";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { loadAppConfig } from "../config/app.config.js";
import { loadProviderConfig } from "../config/providers.config.js";
import { createProviderRegistry } from "./ai/providerRegistry.js";
import { createBatchManager } from "./batch/batchManager.js";
import { createConcurrencyGate } from "./utils/concurrencyGate.js";
import { normalizeRecords } from "./data/normalizer.js";
import { applySecurity } from "./middleware/security.js";
import { requestId } from "./middleware/requestId.js";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import { createDatabase } from "./persistence/database.js";
import { createRecordRepository } from "./persistence/repositories/recordRepository.js";
import { createJobRepository } from "./persistence/repositories/jobRepository.js";
import { createGatewayOperationRepository } from "./persistence/repositories/gatewayOperationRepository.js";
import { createGatewayOperationAuditRepository } from "./persistence/repositories/gatewayOperationAuditRepository.js";
import { createProviderBatchRepository } from "./persistence/repositories/providerBatchRepository.js";
import { createResultRepository } from "./persistence/repositories/resultRepository.js";
import { createProjectRepository } from "./persistence/repositories/projectRepository.js";
import { createResearchCacheRepository } from "./persistence/repositories/researchCacheRepository.js";
import { createModelCatalogRepository } from "./persistence/repositories/modelCatalogRepository.js";
import { createModelSynchronizer } from "./ai/modelCatalog/synchronizer.js";
import { createAppLogger } from "./utils/logger.js";
import { ensureDir } from "./utils/files.js";
import { validateUnsafeRequestHeaders } from "./security/requestPolicy.js";
import { healthRoutes } from "./routes/healthRoutes.js";
import { dataRoutes } from "./routes/dataRoutes.js";
import { templateRoutes } from "./routes/templateRoutes.js";
import { addendumRoutes } from "./routes/addendumRoutes.js";
import { processingRoutes } from "./routes/processingRoutes.js";
import { resultRoutes } from "./routes/resultRoutes.js";
import { modelCatalogRoutes } from "./routes/modelCatalogRoutes.js";
import { projectRoutes } from "./routes/projectRoutes.js";
import { gatewayRoutes } from "./routes/gatewayRoutes.js";
import { migrationRoutes } from "./routes/migrationRoutes.js";
import { diagnosticRoutes } from "./routes/diagnosticRoutes.js";
import { resendRoutes } from "./routes/resendRoutes.js";
import { credentialRoutes } from "./routes/credentialRoutes.js";
import { createRuntimeCredentialManager } from "./security/runtimeCredentialManager.js";
import { createResendWebhookBuffer } from "./resend/resendGateway.js";
import { createShutdownError } from "./utils/errors.js";

function loadHighlightAssets(rootDir) {
  const stylePath = path.join(rootDir, "node_modules", "highlight.js", "styles", "github-dark.min.css");
  const corePath = path.join(rootDir, "node_modules", "highlight.js", "lib", "core.js");
  const xmlPath = path.join(rootDir, "node_modules", "highlight.js", "lib", "languages", "xml.js");
  if (![stylePath, corePath, xmlPath].every((filePath) => fs.existsSync(filePath))) {
    return { browserScript: "", stylePath: "" };
  }
  const coreSource = fs.readFileSync(corePath, "utf8");
  const xmlSource = fs.readFileSync(xmlPath, "utf8");
  return {
    stylePath,
    browserScript: `(() => {
  const coreModule = { exports: {} };
  {
    const module = coreModule;
    const exports = coreModule.exports;
${coreSource}
  }
  const hljs = coreModule.exports;
  const xmlModule = { exports: {} };
  {
    const module = xmlModule;
    const exports = xmlModule.exports;
${xmlSource}
  }
  hljs.registerLanguage("xml", xmlModule.exports);
  globalThis.hljs = hljs;
})();`
  };
}

export function createApp(options = {}) {
  const config = options.config ?? loadAppConfig();
  ensureDir(config.dataDir);
  ensureDir(config.outputDir);
  ensureDir(config.logsDir);

  const logger = options.logger ?? createAppLogger(config);
  const highlightAssets = loadHighlightAssets(config.rootDir);
  const providerConfig = options.providerConfig ?? loadProviderConfig(config);
  const db = options.db ?? createDatabase(config);
  const runtimeCredentials = options.runtimeCredentials ?? createRuntimeCredentialManager();
  const modelCatalogRepository = createModelCatalogRepository(db);
  modelCatalogRepository.seedConfiguredFallback(providerConfig);
  const providerRegistry = createProviderRegistry(providerConfig, {
    catalogRepository: modelCatalogRepository,
    providerPreference: config.modelSync.providerPreference,
    runtimeCredentials
  });
  const repositories = {
    projects: createProjectRepository(db),
    records: createRecordRepository(db),
    jobs: createJobRepository(db),
    gatewayOperations: createGatewayOperationRepository(db),
    gatewayOperationAudits: createGatewayOperationAuditRepository(db),
    providerBatches: createProviderBatchRepository(db),
    results: createResultRepository(db)
  };
  const cacheRepository = createResearchCacheRepository(db);
  const fetchImpl = options.fetchImpl ?? fetch;
  const browserLauncher = options.browserLauncher;
  const requestFactory = options.requestFactory;
  const resolver = options.resolver;
  const modelSynchronizer = createModelSynchronizer({
    config,
    providerConfig,
    repository: modelCatalogRepository,
    fetchImpl,
    logger,
    browserLauncher,
    requestFactory,
    resolver,
    adapters: options.modelDiscoveryAdapters,
    runtimeCredentials
  });
  const context = {
    config,
    logger,
    providerConfig,
    providerRegistry,
    db,
    repositories,
    modelCatalogRepository,
    modelSynchronizer,
    cacheRepository,
    fetchImpl,
    browserLauncher,
    requestFactory,
    resolver,
    runtimeCredentials,
    normalizeRecords,
    csrfToken: options.csrfToken ?? randomUUID(),
    resendWebhooks: options.resendWebhooks ?? createResendWebhookBuffer(),
    shutdownController: options.shutdownController ?? new AbortController(),
    lifecycle: options.lifecycle ?? {
      phase: "RUNNING",
      ready: true,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  };
  context.gatewayConcurrencyGate = createConcurrencyGate({
    name: "gateway operation",
    limit: config.limits.gatewayConcurrency
  });
  context.providerConcurrencyGate = createConcurrencyGate({
    name: "provider batch operation",
    limit: config.limits.providerConcurrency
  });
  context.requireGatewayRequest = (req, { readOnly = false } = {}) => {
    if (readOnly) return true;
    if (context.lifecycle?.phase && context.lifecycle.phase !== "RUNNING") {
      throw createShutdownError(context.lifecycle.reason ?? context.lifecycle.phase, context.lifecycle.phase);
    }
    return validateUnsafeRequestHeaders(req, {
      config,
      csrfToken: context.csrfToken,
      allowWebhook: String(req?.originalUrl ?? req?.url ?? "") === "/api/gateway/resend/webhook",
      bodyParsed: true
    });
  };
  context.batchManager = createBatchManager({
    repositories,
    config,
    providerRegistry,
    logger,
    cacheRepository,
    browserLauncher,
    runtimeCredentials,
    shutdownController: context.shutdownController
  });
  context.modelSyncTimer = modelSynchronizer.startSchedule();
  if (config.modelSync.startup) {
    setImmediate(() => {
      modelSynchronizer.synchronize("startup").catch((error) => {
        logger.error({ err: error }, "Startup model synchronization failed");
      });
    });
  }

  const app = express();
  app.locals.context = context;
  app.use(requestId());
  app.use((req, _res, next) => {
    const startedAt = Date.now();
    logger.info({ requestId: req.id, method: req.method, url: req.originalUrl }, "Request started");
    _res.on("finish", () => {
      logger.info(
        {
          requestId: req.id,
          method: req.method,
          url: req.originalUrl,
          statusCode: _res.statusCode,
          durationMs: Date.now() - startedAt
        },
        "Request completed"
      );
    });
    next();
  });
  applySecurity(app, config, {
    csrfToken: context.csrfToken,
    logger,
    lifecycle: context.lifecycle
  });
  app.get("/favicon.ico", (_req, res) => {
    res.status(204).end();
  });
  app.get("/.well-known/appspecific/com.chrome.devtools.json", (_req, res) => {
    res.status(204).end();
  });
  app.get("/vendor/fflate.js", (_req, res) => {
    res
      .type("text/javascript")
      .sendFile(path.join(config.rootDir, "node_modules", "fflate", "esm", "browser.js"));
  });
  app.use("/vendor/zod", express.static(path.join(config.rootDir, "node_modules", "zod")));
  app.get("/vendor/highlight-html.js", (_req, res) => {
    if (!highlightAssets.browserScript) return res.status(404).end();
    res.type("text/javascript").send(highlightAssets.browserScript);
  });
  app.get("/vendor/highlight-github-dark.css", (_req, res) => {
    if (!highlightAssets.stylePath) return res.status(404).end();
    res.type("text/css").sendFile(highlightAssets.stylePath);
  });
  app.use(express.static(path.join(config.rootDir, "public"), { extensions: ["html"] }));
  app.use("/api", healthRoutes(context));
  app.use("/api", projectRoutes(context));
  app.use("/api", dataRoutes(context));
  app.use("/api", templateRoutes(context));
  app.use("/api", addendumRoutes(context));
  app.use("/api", processingRoutes(context));
  app.use("/api", resultRoutes(context));
  app.use("/api", modelCatalogRoutes(context));
  app.use("/api", credentialRoutes(context));
  app.use("/api", gatewayRoutes(context));
  app.use("/api", migrationRoutes(context));
  app.use("/api", diagnosticRoutes(context));
  app.use("/api", resendRoutes(context));
  app.use(notFoundHandler);
  app.use(errorHandler({ logger, config }));
  return { app, context };
}
