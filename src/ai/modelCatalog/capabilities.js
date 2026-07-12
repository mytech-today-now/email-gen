const KNOWN_MODALITIES = new Set(["text", "image", "audio", "video", "embedding"]);
const KNOWN_DATA_TYPES = new Set(["email", "text", "structured-json", "image", "audio", "video"]);

function uniqueStrings(values, allowed = null) {
  const result = [];
  for (const value of values ?? []) {
    const text = String(value ?? "")
      .trim()
      .toLowerCase();
    if (!text || (allowed && !allowed.has(text))) continue;
    if (!result.includes(text)) result.push(text);
  }
  return result;
}

export function capabilityBoolean(value) {
  return value === true ? true : value === false ? false : null;
}

export function configuredCapabilities(configuredModel = {}) {
  const capabilities = configuredModel.capabilities ?? [];
  return {
    text: capabilities.includes("text") ? true : null,
    toolCalling: capabilityBoolean(configuredModel.toolCalling),
    structuredOutput: capabilities.includes("structured") ? true : null,
    streaming: capabilityBoolean(configuredModel.streaming),
    embedding: capabilities.includes("embedding") ? true : null,
    imageGeneration: capabilities.includes("image") ? true : null,
    audioInput: capabilities.includes("audio") ? true : null,
    audioOutput: capabilities.includes("audio") ? true : null,
    video: capabilities.includes("video") ? true : null,
    reasoning: capabilityBoolean(configuredModel.reasoning)
  };
}

export function modelCapabilitiesForLegacyUi(model) {
  const capabilities = [];
  if (model.capabilities?.text || model.inputModalities?.includes("text")) capabilities.push("text");
  if (model.capabilities?.structuredOutput) capabilities.push("structured");
  if (model.capabilities?.imageGeneration) capabilities.push("image");
  if (model.capabilities?.audioInput || model.capabilities?.audioOutput) capabilities.push("audio");
  if (model.capabilities?.video) capabilities.push("video");
  if (model.capabilities?.embedding) capabilities.push("embedding");
  return capabilities.length ? capabilities : ["unknown"];
}

export function mergeCapabilities(primary = {}, override = {}) {
  const keys = new Set([...Object.keys(primary), ...Object.keys(override)]);
  const merged = {};
  for (const key of keys) {
    merged[key] = override[key] !== undefined && override[key] !== null ? override[key] : primary[key];
  }
  return merged;
}

export function normalizeModalities(values) {
  return uniqueStrings(values, KNOWN_MODALITIES);
}

export function normalizeDataTypes(values) {
  return uniqueStrings(values, KNOWN_DATA_TYPES);
}

export function evaluateModelCompatibility(model, requirements, policies = {}) {
  const reasons = [];
  const requireKnown = policies.allowInferredCapabilities !== true;
  const capabilities = model.capabilities ?? {};
  const inputModalities = normalizeModalities(model.inputModalities);
  const outputModalities = normalizeModalities(model.outputModalities);
  const dataTypes = normalizeDataTypes(model.supportedDataTypes);

  for (const modality of requirements.inputModalities ?? []) {
    if (!inputModalities.includes(modality)) reasons.push(`missing_input_${modality}`);
  }
  for (const modality of requirements.outputModalities ?? []) {
    if (!outputModalities.includes(modality)) reasons.push(`missing_output_${modality}`);
  }
  for (const dataType of requirements.dataTypes ?? []) {
    if (!dataTypes.includes(dataType)) reasons.push(`missing_data_type_${dataType}`);
  }
  if (requirements.structuredOutput && capabilities.structuredOutput !== true) {
    reasons.push(
      capabilities.structuredOutput === null ? "unknown_structured_output" : "missing_structured_output"
    );
  }
  if (requirements.minContextWindow > 0) {
    const contextWindow = model.limits?.contextWindow;
    if (!Number.isFinite(contextWindow) || contextWindow < requirements.minContextWindow) {
      reasons.push(contextWindow === undefined ? "unknown_context_window" : "insufficient_context_window");
    }
  }
  if (model.availability && !["available", "limited"].includes(model.availability)) {
    reasons.push(`model_${model.availability}`);
  }
  if (model.status && ["deprecated", "retired"].includes(model.status)) {
    reasons.push(`status_${model.status}`);
  }
  if (requireKnown && model.capabilityConfidence === "inferred") {
    reasons.push("inferred_capabilities_disabled");
  }

  return {
    compatible: reasons.length === 0,
    reasons,
    requirements: {
      dataTypes: requirements.dataTypes ?? [],
      inputModalities: requirements.inputModalities ?? [],
      outputModalities: requirements.outputModalities ?? [],
      structuredOutput: Boolean(requirements.structuredOutput),
      minContextWindow: requirements.minContextWindow ?? 0
    }
  };
}

export function publicModelFromCatalog(model) {
  return {
    id: model.providerModelId,
    label: model.displayName,
    capabilities: modelCapabilitiesForLegacyUi(model),
    aliases: model.aliases,
    family: model.family,
    status: model.status,
    availability: model.availability,
    compatible: Boolean(model.compatibility?.compatible),
    exclusionReason: model.compatibility?.compatible ? null : model.compatibility?.reasons?.join(", "),
    firstSeenAt: model.firstSeenAt,
    lastSeenAt: model.lastSeenAt,
    lastSuccessfullyValidatedAt: model.lastSuccessfullyValidatedAt,
    discoverySource: model.discoverySource,
    capabilityConfidence: model.capabilityConfidence
  };
}
