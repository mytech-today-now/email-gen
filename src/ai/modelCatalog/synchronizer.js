import { nowIso } from "../../utils/helpers.js";
import { evaluateModelCompatibility } from "./capabilities.js";
import { cacheExpiry, createProviderDiscoveryAdapters } from "./providerAdapters.js";

function providerList(providerConfig) {
  return Object.values(providerConfig.providers).filter((provider) => provider.enabled);
}

function previousFailures(repository, providerId) {
  return repository.getProviderStatus(providerId)?.consecutiveFailures ?? 0;
}

function emergencyModelsForProvider(providerId, config, runId) {
  return config.modelSync.emergencyFallbackModels
    .filter((model) => !model.providerId || model.providerId === providerId)
    .map((model) => {
      const providerModelId = String(model.providerModelId ?? model.id ?? "").trim();
      const normalized = {
        providerId,
        providerModelId,
        displayName: model.displayName ?? model.label ?? providerModelId,
        aliases: model.aliases ?? [],
        family: model.family ?? null,
        version: model.version ?? null,
        status: "emergency-fallback",
        availability: "available",
        createdAtProvider: null,
        deprecatedAt: null,
        retiredAt: null,
        inputModalities: model.inputModalities ?? ["text"],
        outputModalities: model.outputModalities ?? ["text"],
        supportedDataTypes: model.supportedDataTypes ?? ["email", "text", "structured-json"],
        capabilities: {
          text: true,
          structuredOutput: true,
          toolCalling: null,
          streaming: null,
          embedding: false,
          imageGeneration: false,
          audioInput: false,
          audioOutput: false,
          video: false,
          reasoning: null,
          ...(model.capabilities ?? {})
        },
        limits: model.limits ?? {},
        pricing: null,
        regionalAvailability: null,
        requiredApiVersion: null,
        capabilityConfidence: "configured",
        discoverySource: "emergency-fallback",
        metadataSource: { emergencyFallback: true },
        rawProviderMetadata: null,
        lastSyncRunId: runId
      };
      return {
        ...normalized,
        compatibility: evaluateModelCompatibility(normalized, config.modelSync.requiredCapabilities, {
          allowInferredCapabilities: true
        })
      };
    })
    .filter((model) => model.providerModelId);
}

function summarizeProvider(result) {
  return {
    providerId: result.providerId,
    status: result.status,
    source: result.source,
    fallbackState: result.fallbackState,
    modelsDiscovered: result.modelsDiscovered,
    modelsAccepted: result.modelsAccepted,
    modelsFiltered: result.modelsFiltered,
    added: result.changes?.added ?? 0,
    updated: result.changes?.updated ?? 0,
    markedUnavailable: result.changes?.markedUnavailable ?? 0,
    restored: result.changes?.restored ?? 0,
    validationFailures: result.validationFailures?.length ?? 0,
    error: result.error ?? null
  };
}

function runStatus(providerResults) {
  if (providerResults.every((result) => result.status === "success")) return "success";
  if (providerResults.some((result) => result.status === "success")) return "partial_success";
  if (providerResults.some((result) => result.fallbackState !== "none")) return "success_using_fallback";
  return "complete_failure";
}

async function syncProvider({ provider, adapter, config, repository, fetchImpl, logger, runId, timestamp }) {
  const base = {
    providerId: provider.id,
    status: "skipped",
    source: "none",
    fallbackState: "none",
    modelsDiscovered: 0,
    modelsAccepted: 0,
    modelsFiltered: 0,
    validationFailures: [],
    changes: { added: 0, updated: 0, restored: 0, markedUnavailable: 0 },
    error: null
  };

  if (!adapter) {
    base.status = "skipped";
    base.fallbackState = "dynamic_discovery_unsupported";
    base.error = { code: "adapter_missing", message: "No model discovery adapter is registered." };
    return base;
  }

  logger.info({ runId, providerId: provider.id }, "Starting provider model discovery");
  const discovery = await adapter.discover({ provider, config, fetchImpl, logger, runId });
  const liveSuccess = discovery.status === "success" || discovery.status === "skipped";
  if (liveSuccess && discovery.models.length) {
    const modelsAccepted = discovery.models.filter((model) => model.compatibility?.compatible).length;
    const changes = repository.upsertDiscoveredModels({
      providerId: provider.id,
      runId,
      models: discovery.models,
      timestamp,
      missingGraceSeconds: config.modelSync.missingGraceSeconds
    });
    if (discovery.status === "success") {
      repository.saveProviderCache(provider.id, {
        response: discovery.rawResponse,
        normalizedModels: discovery.models,
        fetchedAt: timestamp,
        expiresAt: cacheExpiry(config),
        source: discovery.source
      });
    }
    repository.updateProviderStatus({
      providerId: provider.id,
      status: discovery.status === "success" ? "success" : "success_using_configured_fallback",
      availability: "available",
      lastSyncRunId: runId,
      lastAttemptAt: timestamp,
      lastSuccessAt: timestamp,
      consecutiveFailures: 0,
      modelsDiscovered: discovery.models.length,
      modelsAccepted,
      cacheState: discovery.status === "success" ? "refreshed" : "not_used",
      fallbackState: discovery.fallbackReason ?? "none"
    });
    return {
      ...base,
      status: "success",
      source: discovery.source,
      fallbackState: discovery.fallbackReason ?? "none",
      modelsDiscovered: discovery.models.length,
      modelsAccepted,
      modelsFiltered: discovery.models.length - modelsAccepted,
      validationFailures: discovery.validationFailures ?? [],
      changes
    };
  }

  const cache = repository.getProviderCache(provider.id, timestamp);
  if (cache?.fresh && cache.normalizedModels.length) {
    const modelsAccepted = cache.normalizedModels.filter((model) => model.compatibility?.compatible).length;
    const changes = repository.upsertDiscoveredModels({
      providerId: provider.id,
      runId,
      models: cache.normalizedModels.map((model) => ({
        ...model,
        discoverySource: "cache",
        lastSyncRunId: runId
      })),
      timestamp,
      missingGraceSeconds: config.modelSync.missingGraceSeconds
    });
    repository.updateProviderStatus({
      providerId: provider.id,
      status: "success_using_cache",
      availability: "available",
      lastSyncRunId: runId,
      lastAttemptAt: timestamp,
      consecutiveFailures: previousFailures(repository, provider.id) + 1,
      modelsDiscovered: cache.normalizedModels.length,
      modelsAccepted,
      cacheState: "hit",
      fallbackState: "cache",
      error: discovery.error
    });
    return {
      ...base,
      status: "success",
      source: "cache",
      fallbackState: "cache",
      modelsDiscovered: cache.normalizedModels.length,
      modelsAccepted,
      modelsFiltered: cache.normalizedModels.length - modelsAccepted,
      changes,
      error: discovery.error
    };
  }

  const persisted = repository.listSelectableModels(provider.id);
  if (persisted.length) {
    repository.updateProviderStatus({
      providerId: provider.id,
      status: "success_using_last_known_good",
      availability: "degraded",
      lastSyncRunId: runId,
      lastAttemptAt: timestamp,
      consecutiveFailures: previousFailures(repository, provider.id) + 1,
      modelsDiscovered: 0,
      modelsAccepted: persisted.length,
      cacheState: cache ? "stale" : "miss",
      fallbackState: "last_known_good",
      error: discovery.error
    });
    return {
      ...base,
      status: "success",
      source: "last_known_good",
      fallbackState: "last_known_good",
      modelsAccepted: persisted.length,
      error: discovery.error
    };
  }

  const emergency = emergencyModelsForProvider(provider.id, config, runId);
  if (emergency.length) {
    const modelsAccepted = emergency.filter((model) => model.compatibility?.compatible).length;
    const changes = repository.upsertDiscoveredModels({
      providerId: provider.id,
      runId,
      models: emergency,
      timestamp,
      missingGraceSeconds: config.modelSync.missingGraceSeconds
    });
    repository.updateProviderStatus({
      providerId: provider.id,
      status: "success_using_emergency_fallback",
      availability: "degraded",
      lastSyncRunId: runId,
      lastAttemptAt: timestamp,
      consecutiveFailures: previousFailures(repository, provider.id) + 1,
      modelsDiscovered: emergency.length,
      modelsAccepted,
      cacheState: cache ? "stale" : "miss",
      fallbackState: "emergency_fallback",
      error: discovery.error
    });
    return {
      ...base,
      status: "success",
      source: "emergency_fallback",
      fallbackState: "emergency_fallback",
      modelsDiscovered: emergency.length,
      modelsAccepted,
      modelsFiltered: emergency.length - modelsAccepted,
      changes,
      error: discovery.error
    };
  }

  repository.updateProviderStatus({
    providerId: provider.id,
    status: discovery.status ?? "complete_failure",
    availability: "disabled",
    lastSyncRunId: runId,
    lastAttemptAt: timestamp,
    consecutiveFailures: previousFailures(repository, provider.id) + 1,
    modelsDiscovered: 0,
    modelsAccepted: 0,
    cacheState: cache ? "stale" : "miss",
    fallbackState: "none",
    error: discovery.error ?? { code: "no_safe_catalog", message: "No safe model catalog is available." }
  });
  return {
    ...base,
    status: "complete_failure",
    source: "none",
    fallbackState: "none",
    error: discovery.error ?? { code: "no_safe_catalog", message: "No safe model catalog is available." }
  };
}

export function createModelSynchronizer({
  config,
  providerConfig,
  repository,
  fetchImpl,
  logger,
  adapters = createProviderDiscoveryAdapters()
}) {
  let activeRun = null;

  async function synchronize(triggerSource = "manual") {
    if (!config.modelSync.enabled) {
      return {
        status: "skipped",
        reason: "disabled",
        providers: [],
        startedAt: nowIso(),
        completedAt: nowIso()
      };
    }
    if (activeRun) return activeRun;

    activeRun = (async () => {
      const run = repository.createRun(triggerSource);
      const startedAt = run.startedAt;
      const timestamp = nowIso();
      const results = [];
      logger.info({ runId: run.id, triggerSource }, "Starting model catalog synchronization");

      for (const provider of providerList(providerConfig)) {
        const result = await syncProvider({
          provider,
          adapter: adapters[provider.id],
          config,
          repository,
          fetchImpl,
          logger,
          runId: run.id,
          timestamp
        });
        results.push(result);
        logger.info(
          {
            runId: run.id,
            ...summarizeProvider(result)
          },
          "Provider model synchronization completed"
        );
      }

      const status = runStatus(results);
      const completed = repository.completeRun(run.id, {
        status,
        startedAt,
        summary: {
          providers: results.map(summarizeProvider),
          totals: {
            modelsDiscovered: results.reduce((sum, result) => sum + result.modelsDiscovered, 0),
            modelsAccepted: results.reduce((sum, result) => sum + result.modelsAccepted, 0),
            modelsFiltered: results.reduce((sum, result) => sum + result.modelsFiltered, 0),
            catalogChanges: results.reduce(
              (sum, result) =>
                sum +
                (result.changes?.added ?? 0) +
                (result.changes?.updated ?? 0) +
                (result.changes?.markedUnavailable ?? 0) +
                (result.changes?.restored ?? 0),
              0
            )
          }
        },
        error: status === "complete_failure" ? { code: "MODEL_SYNC_FAILED" } : null
      });
      logger.info(
        {
          runId: run.id,
          status,
          durationMs: completed.durationMs,
          providers: results.length
        },
        "Model catalog synchronization finished"
      );
      return {
        ...completed,
        providers: results.map(summarizeProvider)
      };
    })();

    try {
      return await activeRun;
    } finally {
      activeRun = null;
    }
  }

  function status() {
    return {
      enabled: config.modelSync.enabled,
      startup: config.modelSync.startup,
      intervalSeconds: config.modelSync.intervalSeconds,
      nextSyncAfter: repository.listProviderStatuses().reduce((earliest, item) => {
        if (!item.nextSyncAfter) return earliest;
        if (!earliest || item.nextSyncAfter < earliest) return item.nextSyncAfter;
        return earliest;
      }, null),
      providers: repository.listProviderStatuses(),
      latestRuns: repository.listRuns(5)
    };
  }

  return {
    synchronize,
    status,
    isRunning() {
      return Boolean(activeRun);
    },
    startSchedule() {
      if (!config.modelSync.enabled || config.modelSync.intervalSeconds <= 0) return null;
      const timer = setInterval(() => {
        synchronize("schedule").catch((error) => {
          logger.error({ err: error }, "Scheduled model synchronization failed");
        });
      }, config.modelSync.intervalSeconds * 1000);
      timer.unref?.();
      return timer;
    }
  };
}

export function selectFallbackModel({ providerId, modelId, repository, providerPreference = [] }) {
  const selected = repository.getModel(providerId, modelId);
  const selectableSameProvider = repository.listSelectableModels(providerId);
  const sameFamily = selected?.family
    ? selectableSameProvider.find(
        (model) => model.family === selected.family && model.providerModelId !== modelId
      )
    : null;
  if (sameFamily) {
    return {
      providerId,
      modelId: sameFamily.providerModelId,
      reason: "same_provider_same_family",
      from: { providerId, modelId }
    };
  }
  const sameProvider = selectableSameProvider.find((model) => model.providerModelId !== modelId);
  if (sameProvider) {
    return {
      providerId,
      modelId: sameProvider.providerModelId,
      reason: "same_provider_compatible",
      from: { providerId, modelId }
    };
  }
  for (const preferredProvider of providerPreference) {
    const candidate = repository.listSelectableModels(preferredProvider)[0];
    if (candidate) {
      return {
        providerId: preferredProvider,
        modelId: candidate.providerModelId,
        reason: "preferred_provider_compatible",
        from: { providerId, modelId }
      };
    }
  }
  return null;
}
