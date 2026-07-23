import { makeId, nowIso, parseJson } from "../../utils/helpers.js";
import { applyBatchMetadata } from "../../ai/modelCatalog/batchMetadata.js";

function json(value, fallback) {
  return JSON.stringify(value ?? fallback);
}

function parse(value, fallback) {
  return parseJson(value, fallback) ?? fallback;
}

function modelId(providerId, providerModelId) {
  return `${providerId}:${providerModelId}`;
}

function mapRow(row) {
  if (!row) return null;
  return applyBatchMetadata({
    id: row.id,
    providerId: row.provider_id,
    providerModelId: row.provider_model_id,
    displayName: row.display_name,
    aliases: parse(row.aliases_json, []),
    family: row.family,
    version: row.version,
    status: row.status,
    availability: row.availability,
    createdAtProvider: row.created_at_provider,
    deprecatedAt: row.deprecated_at,
    retiredAt: row.retired_at,
    inputModalities: parse(row.input_modalities_json, []),
    outputModalities: parse(row.output_modalities_json, []),
    supportedDataTypes: parse(row.supported_data_types_json, []),
    capabilities: parse(row.capabilities_json, {}),
    limits: parse(row.limits_json, {}),
    pricing: row.pricing_json ? parse(row.pricing_json, null) : null,
    regionalAvailability: row.regional_availability_json ? parse(row.regional_availability_json, null) : null,
    requiredApiVersion: row.required_api_version,
    capabilityConfidence: row.capability_confidence,
    discoverySource: row.discovery_source,
    metadataSource: parse(row.metadata_source_json, {}),
    compatibility: parse(row.compatibility_json, {}),
    rawProviderMetadata: row.raw_provider_metadata_json ? parse(row.raw_provider_metadata_json, null) : null,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    lastSuccessfullyValidatedAt: row.last_successfully_validated_at,
    lastSyncRunId: row.last_sync_run_id,
    unavailableSince: row.unavailable_since,
    exclusionReason: row.exclusion_reason,
    schemaVersion: row.schema_version,
    updatedAt: row.updated_at
  });
}

function mapStatus(row) {
  if (!row) return null;
  return {
    providerId: row.provider_id,
    status: row.status,
    availability: row.availability,
    lastSyncRunId: row.last_sync_run_id,
    lastAttemptAt: row.last_attempt_at,
    lastSuccessAt: row.last_success_at,
    nextSyncAfter: row.next_sync_after,
    consecutiveFailures: row.consecutive_failures,
    modelsDiscovered: row.models_discovered,
    modelsAccepted: row.models_accepted,
    cacheState: row.cache_state,
    fallbackState: row.fallback_state,
    error: row.error_json ? parse(row.error_json, null) : null,
    updatedAt: row.updated_at
  };
}

function normalizeFallbackModel(providerId, item, runId, timestamp) {
  const providerModelId = item.providerModelId ?? item.id;
  return {
    providerId,
    providerModelId,
    displayName: item.displayName ?? item.label ?? providerModelId,
    aliases: item.aliases ?? (item.aliasFor ? [item.aliasFor] : []),
    family: item.family ?? null,
    version: item.version ?? null,
    status: item.status ?? (item.legacy ? "legacy" : "available"),
    availability: item.availability ?? "available",
    createdAtProvider: item.createdAtProvider ?? null,
    deprecatedAt: item.deprecatedAt ?? null,
    retiredAt: item.retiredAt ?? null,
    inputModalities: item.inputModalities ?? (item.capabilities?.includes("text") ? ["text"] : []),
    outputModalities: item.outputModalities ?? (item.capabilities?.includes("structured") ? ["text"] : []),
    supportedDataTypes:
      item.supportedDataTypes ?? (item.capabilities?.includes("structured") ? ["email"] : []),
    capabilities: {
      text: item.capabilities?.includes("text") ?? false,
      structuredOutput: item.capabilities?.includes("structured") ?? false,
      imageGeneration: item.capabilities?.includes("image") ?? false,
      audioInput: item.capabilities?.includes("audio") ?? false,
      audioOutput: item.capabilities?.includes("audio") ?? false,
      video: item.capabilities?.includes("video") ?? false,
      ...(item.normalizedCapabilities ?? {})
    },
    limits: item.limits ?? {},
    pricing: item.pricing ?? null,
    regionalAvailability: item.regionalAvailability ?? null,
    requiredApiVersion: item.requiredApiVersion ?? null,
    capabilityConfidence: item.capabilityConfidence ?? "configured",
    discoverySource: item.discoverySource ?? "configured-fallback",
    metadataSource: item.metadataSource ?? { configured: true },
    compatibility: item.compatibility ?? {
      compatible: item.capabilities?.includes("structured") ?? false,
      reasons: item.capabilities?.includes("structured") ? [] : ["missing_structured_output"]
    },
    rawProviderMetadata: item.rawProviderMetadata ?? null,
    lastSuccessfullyValidatedAt: timestamp,
    lastSyncRunId: runId,
    exclusionReason: item.exclusionReason ?? null
  };
}

export function createModelCatalogRepository(db) {
  const insertRun = db.prepare(
    "INSERT INTO model_sync_runs (id, trigger_source, status, started_at, summary_json) VALUES (?, ?, ?, ?, ?)"
  );
  const completeRun = db.prepare(
    "UPDATE model_sync_runs SET status = ?, completed_at = ?, duration_ms = ?, summary_json = ?, error_json = ? WHERE id = ?"
  );
  const getRun = db.prepare("SELECT * FROM model_sync_runs WHERE id = ?");
  const listRuns = db.prepare("SELECT * FROM model_sync_runs ORDER BY started_at DESC LIMIT ?");
  const getModel = db.prepare("SELECT * FROM ai_models WHERE provider_id = ? AND provider_model_id = ?");
  const listModels = db.prepare(
    "SELECT * FROM ai_models ORDER BY provider_id ASC, display_name ASC, provider_model_id ASC"
  );
  const listProviderModels = db.prepare(
    "SELECT * FROM ai_models WHERE provider_id = ? ORDER BY display_name ASC, provider_model_id ASC"
  );
  const listSelectableModels = db.prepare(
    "SELECT * FROM ai_models WHERE provider_id = ? AND availability = 'available' ORDER BY display_name ASC, provider_model_id ASC"
  );
  const insertModel = db.prepare(`
    INSERT INTO ai_models (
      id, provider_id, provider_model_id, display_name, aliases_json, family, version, status,
      availability, created_at_provider, deprecated_at, retired_at, input_modalities_json,
      output_modalities_json, supported_data_types_json, capabilities_json, limits_json,
      pricing_json, regional_availability_json, required_api_version, capability_confidence,
      discovery_source, metadata_source_json, compatibility_json, raw_provider_metadata_json,
      first_seen_at, last_seen_at, last_successfully_validated_at, last_sync_run_id,
      unavailable_since, exclusion_reason, schema_version, updated_at
    ) VALUES (
      @id, @providerId, @providerModelId, @displayName, @aliasesJson, @family, @version, @status,
      @availability, @createdAtProvider, @deprecatedAt, @retiredAt, @inputModalitiesJson,
      @outputModalitiesJson, @supportedDataTypesJson, @capabilitiesJson, @limitsJson,
      @pricingJson, @regionalAvailabilityJson, @requiredApiVersion, @capabilityConfidence,
      @discoverySource, @metadataSourceJson, @compatibilityJson, @rawProviderMetadataJson,
      @firstSeenAt, @lastSeenAt, @lastSuccessfullyValidatedAt, @lastSyncRunId,
      @unavailableSince, @exclusionReason, 1, @updatedAt
    )
  `);
  const updateModel = db.prepare(`
    UPDATE ai_models SET
      display_name = @displayName,
      aliases_json = @aliasesJson,
      family = @family,
      version = @version,
      status = @status,
      availability = @availability,
      created_at_provider = @createdAtProvider,
      deprecated_at = @deprecatedAt,
      retired_at = @retiredAt,
      input_modalities_json = @inputModalitiesJson,
      output_modalities_json = @outputModalitiesJson,
      supported_data_types_json = @supportedDataTypesJson,
      capabilities_json = @capabilitiesJson,
      limits_json = @limitsJson,
      pricing_json = @pricingJson,
      regional_availability_json = @regionalAvailabilityJson,
      required_api_version = @requiredApiVersion,
      capability_confidence = @capabilityConfidence,
      discovery_source = @discoverySource,
      metadata_source_json = @metadataSourceJson,
      compatibility_json = @compatibilityJson,
      raw_provider_metadata_json = @rawProviderMetadataJson,
      last_seen_at = @lastSeenAt,
      last_successfully_validated_at = @lastSuccessfullyValidatedAt,
      last_sync_run_id = @lastSyncRunId,
      unavailable_since = @unavailableSince,
      exclusion_reason = @exclusionReason,
      updated_at = @updatedAt
    WHERE provider_id = @providerId AND provider_model_id = @providerModelId
  `);
  const markMissing = db.prepare(`
    UPDATE ai_models
    SET availability = CASE
        WHEN unavailable_since IS NOT NULL AND strftime('%s', ?) - strftime('%s', unavailable_since) >= ?
          THEN 'retired'
        ELSE 'unavailable'
      END,
      status = CASE
        WHEN unavailable_since IS NOT NULL AND strftime('%s', ?) - strftime('%s', unavailable_since) >= ?
          THEN 'retired'
        ELSE status
      END,
      unavailable_since = COALESCE(unavailable_since, ?),
      last_sync_run_id = ?,
      updated_at = ?
    WHERE provider_id = ?
      AND provider_model_id NOT IN (SELECT value FROM json_each(?))
      AND availability = 'available'
  `);
  const upsertStatus = db.prepare(`
    INSERT INTO provider_sync_status (
      provider_id, status, availability, last_sync_run_id, last_attempt_at, last_success_at,
      next_sync_after, consecutive_failures, models_discovered, models_accepted, cache_state,
      fallback_state, error_json, updated_at
    ) VALUES (
      @providerId, @status, @availability, @lastSyncRunId, @lastAttemptAt, @lastSuccessAt,
      @nextSyncAfter, @consecutiveFailures, @modelsDiscovered, @modelsAccepted, @cacheState,
      @fallbackState, @errorJson, @updatedAt
    )
    ON CONFLICT(provider_id) DO UPDATE SET
      status = excluded.status,
      availability = excluded.availability,
      last_sync_run_id = excluded.last_sync_run_id,
      last_attempt_at = excluded.last_attempt_at,
      last_success_at = COALESCE(excluded.last_success_at, provider_sync_status.last_success_at),
      next_sync_after = excluded.next_sync_after,
      consecutive_failures = excluded.consecutive_failures,
      models_discovered = excluded.models_discovered,
      models_accepted = excluded.models_accepted,
      cache_state = excluded.cache_state,
      fallback_state = excluded.fallback_state,
      error_json = excluded.error_json,
      updated_at = excluded.updated_at
  `);
  const getStatus = db.prepare("SELECT * FROM provider_sync_status WHERE provider_id = ?");
  const listStatus = db.prepare("SELECT * FROM provider_sync_status ORDER BY provider_id ASC");
  const getCache = db.prepare("SELECT * FROM provider_model_response_cache WHERE provider_id = ?");
  const upsertCache = db.prepare(`
    INSERT INTO provider_model_response_cache (
      provider_id, response_json, normalized_models_json, fetched_at, expires_at, source, schema_version
    ) VALUES (?, ?, ?, ?, ?, ?, 1)
    ON CONFLICT(provider_id) DO UPDATE SET
      response_json = excluded.response_json,
      normalized_models_json = excluded.normalized_models_json,
      fetched_at = excluded.fetched_at,
      expires_at = excluded.expires_at,
      source = excluded.source,
      schema_version = 1
  `);

  function modelParams(model, existing, timestamp) {
    return {
      id: existing?.id ?? modelId(model.providerId, model.providerModelId),
      providerId: model.providerId,
      providerModelId: model.providerModelId,
      displayName: model.displayName || model.providerModelId,
      aliasesJson: json(model.aliases, []),
      family: model.family ?? null,
      version: model.version ?? null,
      status: model.status ?? "available",
      availability: model.availability ?? "available",
      createdAtProvider: model.createdAtProvider ?? null,
      deprecatedAt: model.deprecatedAt ?? null,
      retiredAt: model.retiredAt ?? null,
      inputModalitiesJson: json(model.inputModalities, []),
      outputModalitiesJson: json(model.outputModalities, []),
      supportedDataTypesJson: json(model.supportedDataTypes, []),
      capabilitiesJson: json(model.capabilities, {}),
      limitsJson: json(model.limits, {}),
      pricingJson: model.pricing ? json(model.pricing, null) : null,
      regionalAvailabilityJson: model.regionalAvailability ? json(model.regionalAvailability, null) : null,
      requiredApiVersion: model.requiredApiVersion ?? null,
      capabilityConfidence: model.capabilityConfidence ?? "unknown",
      discoverySource: model.discoverySource ?? "unknown",
      metadataSourceJson: json(model.metadataSource, {}),
      compatibilityJson: json(model.compatibility, {}),
      rawProviderMetadataJson: model.rawProviderMetadata ? json(model.rawProviderMetadata, null) : null,
      firstSeenAt: existing?.firstSeenAt ?? timestamp,
      lastSeenAt: timestamp,
      lastSuccessfullyValidatedAt: model.lastSuccessfullyValidatedAt ?? timestamp,
      lastSyncRunId: model.lastSyncRunId ?? null,
      unavailableSince: model.availability === "available" ? null : (model.unavailableSince ?? null),
      exclusionReason: model.exclusionReason ?? null,
      updatedAt: timestamp
    };
  }

  const upsertDiscoveredModelsTx = db.transaction(
    ({ providerId, runId, models, timestamp = nowIso(), missingGraceSeconds = 0 }) => {
      let added = 0;
      let updated = 0;
      let restored = 0;
      const seen = new Set();

      for (const model of models) {
        const providerModelId = model.providerModelId;
        seen.add(providerModelId);
        const existing = mapRow(getModel.get(providerId, providerModelId));
        const next = { ...model, providerId, lastSyncRunId: runId };
        const params = modelParams(next, existing, timestamp);
        if (existing) {
          if (existing.availability !== "available" && params.availability === "available") restored += 1;
          updateModel.run(params);
          updated += 1;
        } else {
          insertModel.run(params);
          added += 1;
        }
      }

      const beforeMissing = listProviderModels.all(providerId).map(mapRow);
      markMissing.run(
        timestamp,
        missingGraceSeconds,
        timestamp,
        missingGraceSeconds,
        timestamp,
        runId,
        timestamp,
        providerId,
        JSON.stringify([...seen])
      );
      const afterMissing = listProviderModels.all(providerId).map(mapRow);
      const markedUnavailable = afterMissing.filter((after) => {
        const before = beforeMissing.find((item) => item.providerModelId === after.providerModelId);
        return before?.availability === "available" && after.availability !== "available";
      }).length;

      return { added, updated, restored, markedUnavailable };
    }
  );

  const seedFallbackTx = db.transaction(
    ({ providerConfig, runId = "configured-seed", timestamp = nowIso() }) => {
      let added = 0;
      for (const provider of Object.values(providerConfig.providers)) {
        for (const configuredModel of provider.models ?? []) {
          const model = normalizeFallbackModel(provider.id, configuredModel, runId, timestamp);
          const existing = mapRow(getModel.get(provider.id, model.providerModelId));
          if (existing && !["configured-fallback", "mock"].includes(existing.discoverySource)) continue;
          if (!existing) added += 1;
          const params = modelParams(model, existing, timestamp);
          if (existing) updateModel.run(params);
          else insertModel.run(params);
        }
      }
      return { added };
    }
  );

  return {
    modelId,
    createRun(triggerSource) {
      const id = makeId("model_sync");
      insertRun.run(id, triggerSource, "running", nowIso(), "{}");
      return this.getRun(id);
    },
    completeRun(id, { status, startedAt, summary = {}, error = null }) {
      const completedAt = nowIso();
      const durationMs = startedAt ? Date.parse(completedAt) - Date.parse(startedAt) : null;
      completeRun.run(
        status,
        completedAt,
        durationMs,
        json(summary, {}),
        error ? json(error, null) : null,
        id
      );
      return this.getRun(id);
    },
    getRun(id) {
      const row = getRun.get(id);
      if (!row) return null;
      return {
        id: row.id,
        triggerSource: row.trigger_source,
        status: row.status,
        startedAt: row.started_at,
        completedAt: row.completed_at,
        durationMs: row.duration_ms,
        summary: parse(row.summary_json, {}),
        error: row.error_json ? parse(row.error_json, null) : null
      };
    },
    listRuns(limit = 10) {
      return listRuns.all(limit).map((row) => this.getRun(row.id));
    },
    listModels() {
      return listModels.all().map(mapRow);
    },
    listProviderModels(providerId) {
      return listProviderModels.all(providerId).map(mapRow);
    },
    listSelectableModels(providerId) {
      return listSelectableModels
        .all(providerId)
        .map(mapRow)
        .filter((model) => model.compatibility?.compatible);
    },
    getModel(providerId, providerModelId) {
      return mapRow(getModel.get(providerId, providerModelId));
    },
    upsertDiscoveredModels(payload) {
      return upsertDiscoveredModelsTx(payload);
    },
    seedConfiguredFallback(providerConfig, options = {}) {
      return seedFallbackTx({ providerConfig, ...options });
    },
    updateProviderStatus(status) {
      upsertStatus.run({
        providerId: status.providerId,
        status: status.status,
        availability: status.availability ?? "unknown",
        lastSyncRunId: status.lastSyncRunId ?? null,
        lastAttemptAt: status.lastAttemptAt ?? nowIso(),
        lastSuccessAt: status.lastSuccessAt ?? null,
        nextSyncAfter: status.nextSyncAfter ?? null,
        consecutiveFailures: status.consecutiveFailures ?? 0,
        modelsDiscovered: status.modelsDiscovered ?? 0,
        modelsAccepted: status.modelsAccepted ?? 0,
        cacheState: status.cacheState ?? "none",
        fallbackState: status.fallbackState ?? "none",
        errorJson: status.error ? json(status.error, null) : null,
        updatedAt: nowIso()
      });
      return this.getProviderStatus(status.providerId);
    },
    getProviderStatus(providerId) {
      return mapStatus(getStatus.get(providerId));
    },
    listProviderStatuses() {
      return listStatus.all().map(mapStatus);
    },
    saveProviderCache(providerId, { response, normalizedModels, fetchedAt, expiresAt, source }) {
      upsertCache.run(
        providerId,
        json(response, {}),
        json(normalizedModels, []),
        fetchedAt,
        expiresAt,
        source ?? "live"
      );
    },
    getProviderCache(providerId, timestamp = nowIso()) {
      const row = getCache.get(providerId);
      if (!row) return null;
      return {
        providerId: row.provider_id,
        response: parse(row.response_json, null),
        normalizedModels: parse(row.normalized_models_json, []),
        fetchedAt: row.fetched_at,
        expiresAt: row.expires_at,
        source: row.source,
        schemaVersion: row.schema_version,
        fresh: Date.parse(row.expires_at) > Date.parse(timestamp)
      };
    }
  };
}
