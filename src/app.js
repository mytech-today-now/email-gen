import express from "express";
import path from "node:path";
import { loadAppConfig } from "../config/app.config.js";
import { loadProviderConfig } from "../config/providers.config.js";
import { createProviderRegistry } from "./ai/providerRegistry.js";
import { createBatchManager } from "./batch/batchManager.js";
import { normalizeRecords } from "./data/normalizer.js";
import { applySecurity } from "./middleware/security.js";
import { requestId } from "./middleware/requestId.js";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import { createDatabase } from "./persistence/database.js";
import { createRecordRepository } from "./persistence/repositories/recordRepository.js";
import { createJobRepository } from "./persistence/repositories/jobRepository.js";
import { createResultRepository } from "./persistence/repositories/resultRepository.js";
import { createProjectRepository } from "./persistence/repositories/projectRepository.js";
import { createResearchCacheRepository } from "./persistence/repositories/researchCacheRepository.js";
import { createModelCatalogRepository } from "./persistence/repositories/modelCatalogRepository.js";
import { createModelSynchronizer } from "./ai/modelCatalog/synchronizer.js";
import { createAppLogger } from "./utils/logger.js";
import { ensureDir } from "./utils/files.js";
import { healthRoutes } from "./routes/healthRoutes.js";
import { dataRoutes } from "./routes/dataRoutes.js";
import { templateRoutes } from "./routes/templateRoutes.js";
import { addendumRoutes } from "./routes/addendumRoutes.js";
import { processingRoutes } from "./routes/processingRoutes.js";
import { resultRoutes } from "./routes/resultRoutes.js";
import { modelCatalogRoutes } from "./routes/modelCatalogRoutes.js";
import { projectRoutes } from "./routes/projectRoutes.js";

export function createApp(options = {}) {
  const config = options.config ?? loadAppConfig();
  ensureDir(config.dataDir);
  ensureDir(config.outputDir);
  ensureDir(config.logsDir);

  const logger = options.logger ?? createAppLogger(config);
  const providerConfig = options.providerConfig ?? loadProviderConfig(config);
  const db = options.db ?? createDatabase(config);
  const modelCatalogRepository = createModelCatalogRepository(db);
  modelCatalogRepository.seedConfiguredFallback(providerConfig);
  const providerRegistry = createProviderRegistry(providerConfig, {
    catalogRepository: modelCatalogRepository,
    providerPreference: config.modelSync.providerPreference
  });
  const repositories = {
    projects: createProjectRepository(db),
    records: createRecordRepository(db),
    jobs: createJobRepository(db),
    results: createResultRepository(db)
  };
  const cacheRepository = createResearchCacheRepository(db);
  const fetchImpl = options.fetchImpl ?? fetch;
  const browserLauncher = options.browserLauncher;
  const modelSynchronizer = createModelSynchronizer({
    config,
    providerConfig,
    repository: modelCatalogRepository,
    fetchImpl,
    logger,
    adapters: options.modelDiscoveryAdapters
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
    normalizeRecords
  };
  context.batchManager = createBatchManager({
    repositories,
    config,
    providerRegistry,
    logger,
    cacheRepository,
    browserLauncher
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
  applySecurity(app, config);
  app.get("/favicon.ico", (_req, res) => {
    res.status(204).end();
  });
  app.get("/.well-known/appspecific/com.chrome.devtools.json", (_req, res) => {
    res.status(204).end();
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
  app.use(notFoundHandler);
  app.use(errorHandler({ logger, config }));
  return { app, context };
}
