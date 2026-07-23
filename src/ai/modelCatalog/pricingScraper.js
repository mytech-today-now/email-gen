import { fetchDocument } from "../../research/secureDocumentFetcher.js";

const DEFAULT_TIMEOUT_MS = 20_000;

const PROVIDER_PRICING_SOURCES = {
  openai: {
    url: "https://developers.openai.com/api/docs/pricing",
    aliases: {
      "gpt-5.6": "gpt-5.6-sol"
    },
    parse: parseOpenAiPricing
  },
  anthropic: {
    url: "https://platform.claude.com/docs/en/about-claude/pricing",
    aliases: {
      "claude-haiku-4-5-20251001": "claude-haiku-4-5",
      "claude-haiku-4-5": "claude-haiku-4-5"
    },
    parse: parseAnthropicPricing
  },
  xai: {
    url: "https://docs.x.ai/developers/pricing?utm_source=chatgpt.com",
    aliases: {
      "grok-4.5-latest": "grok-4.5",
      "grok-4.3-latest": "grok-4.3",
      "grok-build-latest": "grok-build-0.1",
      "grok-latest": "grok-4.5"
    },
    parse: parseXaiPricing
  },
  venice: {
    url: "https://docs.venice.ai/overview/pricing",
    aliases: {},
    parse: parseVenicePricing
  },
  lumaai: {
    url: "https://docs.lumalabs.ai/docs/modify-video",
    aliases: {
      "ray-2-720p": "ray-2",
      "ray-flash-2-720p": "ray-flash-2"
    },
    parse: parseLumaPricing
  }
};

function normalizeWhitespace(value) {
  return String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeEntities(value) {
  return String(value ?? "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function htmlToLines(html) {
  const withBreaks = String(html ?? "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<(?:br|hr)\s*\/?>/gi, "\n")
    .replace(
      /<\/(?:p|div|section|article|main|header|footer|aside|nav|tr|table|thead|tbody|tfoot|caption|li|ul|ol|h[1-6]|pre)>/gi,
      "\n"
    )
    .replace(/<[^>]+>/g, " ");
  return decodeEntities(withBreaks).split(/\r?\n/).map(normalizeWhitespace).filter(Boolean);
}

function findModelIds(provider) {
  return [...new Set((provider.models ?? []).map((model) => String(model.id ?? "").trim()).filter(Boolean))];
}

function toNumber(raw) {
  const value = Number.parseFloat(String(raw ?? "").replace(/,/g, ""));
  return Number.isFinite(value) ? value : null;
}

function createTokenPricing({
  input,
  output,
  sourceUrl,
  verifiedAt,
  raw = null,
  cachedInput = null,
  cacheWrite = null
}) {
  return {
    currency: "USD",
    inputPerMillionTokens: input,
    outputPerMillionTokens: output,
    cachedInputReadPerMillionTokens: cachedInput,
    cachedInputWritePerMillionTokens: cacheWrite,
    inputDisplay: input === null ? null : `$${input.toFixed(input < 1 ? 4 : 2)}`,
    outputDisplay: output === null ? null : `$${output.toFixed(output < 1 ? 4 : 2)}`,
    status: input !== null || output !== null ? "fresh" : "unavailable",
    sourceUrl,
    verifiedAt,
    raw
  };
}

function mergeBatchPricing(pricing, batchPricing, sourceUrl, verifiedAt) {
  if (!pricing && !batchPricing) return null;
  return {
    ...(pricing ?? createTokenPricing({ input: null, output: null, sourceUrl, verifiedAt })),
    ...(batchPricing
      ? {
          batch: {
            inputPerMillionTokens: batchPricing.inputPerMillionTokens,
            outputPerMillionTokens: batchPricing.outputPerMillionTokens,
            cachedInputReadPerMillionTokens: batchPricing.cachedInputReadPerMillionTokens,
            cachedInputWritePerMillionTokens: batchPricing.cachedInputWritePerMillionTokens,
            sourceUrl,
            verifiedAt,
            raw: batchPricing.raw ?? null
          }
        }
      : {})
  };
}

function createDisplayPricing({
  input = null,
  output = null,
  inputDisplay = null,
  outputDisplay = null,
  sourceUrl,
  verifiedAt,
  raw = null
}) {
  return {
    currency: "USD",
    inputPerMillionTokens: input,
    outputPerMillionTokens: output,
    inputDisplay,
    outputDisplay,
    status: input !== null || output !== null || inputDisplay || outputDisplay ? "fresh" : "unavailable",
    sourceUrl,
    verifiedAt,
    raw
  };
}

function firstCurrencyValues(line) {
  return [...line.matchAll(/\$([0-9]+(?:\.[0-9]+)?)/g)]
    .map((match) => toNumber(match[1]))
    .filter((value) => value !== null);
}

function escapeRegex(value) {
  return String(value ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseMonthDayYear(raw, endOfDay = false) {
  const match = /^\s*([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})\s*$/.exec(String(raw ?? ""));
  if (!match) return null;
  const month = {
    january: 0,
    february: 1,
    march: 2,
    april: 3,
    may: 4,
    june: 5,
    july: 6,
    august: 7,
    september: 8,
    october: 9,
    november: 10,
    december: 11
  }[match[1].toLowerCase()];
  if (month === undefined) return null;
  const day = Number.parseInt(match[2], 10);
  const year = Number.parseInt(match[3], 10);
  return Date.UTC(
    year,
    month,
    day,
    endOfDay ? 23 : 0,
    endOfDay ? 59 : 0,
    endOfDay ? 59 : 0,
    endOfDay ? 999 : 0
  );
}

function anthropicLineAppliesAt(line, verifiedAt) {
  const referenceMs = new Date(verifiedAt).getTime();
  if (!Number.isFinite(referenceMs)) return true;

  const throughDate = /through\s+([A-Za-z]+\s+\d{1,2},\s+\d{4})/i.exec(line)?.[1];
  if (throughDate) {
    const throughMs = parseMonthDayYear(throughDate, true);
    return throughMs === null ? true : referenceMs <= throughMs;
  }

  const startingDate = /starting\s+([A-Za-z]+\s+\d{1,2},\s+\d{4})/i.exec(line)?.[1];
  if (startingDate) {
    const startingMs = parseMonthDayYear(startingDate);
    return startingMs === null ? true : referenceMs >= startingMs;
  }

  return true;
}

function priceMapForAliases(prices, aliases = {}) {
  const resolved = new Map(prices);
  for (const [modelId, targetId] of Object.entries(aliases)) {
    if (!resolved.has(modelId) && resolved.has(targetId)) {
      resolved.set(modelId, {
        ...resolved.get(targetId),
        raw: { ...(resolved.get(targetId).raw ?? {}), aliasOf: targetId }
      });
    }
  }
  return resolved;
}

function parseOpenAiPricing({ lines, provider, sourceUrl, verifiedAt }) {
  const ids = findModelIds(provider);
  const standardPrices = new Map();
  const batchPrices = new Map();
  const sections = new Set(["standard", "batch", "flex", "priority"]);
  let currentSection = null;

  for (const line of lines) {
    const lowered = line.toLowerCase();
    if (sections.has(lowered)) {
      currentSection = lowered;
      continue;
    }
    for (const modelId of ids) {
      const pattern = new RegExp(`^${escapeRegex(modelId)}\\s*\\$`, "i");
      if (!pattern.test(line)) continue;
      const values = firstCurrencyValues(line);
      if (!values.length) continue;
      const pricing = createTokenPricing({
        input: values[0] ?? null,
        cachedInput: values[1] ?? null,
        cacheWrite: values.length >= 4 ? (values[2] ?? null) : null,
        output: values.length >= 4 ? values[3] : values[values.length - 1],
        sourceUrl,
        verifiedAt,
        raw: { line, section: currentSection ?? "implicit-standard" }
      });
      if (currentSection === "batch") batchPrices.set(modelId, pricing);
      else if (!standardPrices.has(modelId)) standardPrices.set(modelId, pricing);
      break;
    }
  }

  const merged = new Map();
  for (const modelId of ids) {
    const standard = standardPrices.get(modelId) ?? null;
    const batch = batchPrices.get(modelId) ?? null;
    if (!standard && !batch) continue;
    merged.set(modelId, mergeBatchPricing(standard, batch, sourceUrl, verifiedAt));
  }
  return priceMapForAliases(merged, PROVIDER_PRICING_SOURCES.openai.aliases);
}

function parseAnthropicPricing({ lines, provider, sourceUrl, verifiedAt }) {
  const prices = new Map();
  const currentName = { value: null };
  const labelById = new Map(
    (provider.models ?? []).map((model) => [String(model.id), normalizeWhitespace(model.label ?? model.id)])
  );
  const idsByLabel = new Map();
  for (const [id, label] of labelById.entries()) {
    idsByLabel.set(label.toLowerCase(), [...(idsByLabel.get(label.toLowerCase()) ?? []), id]);
  }
  for (const line of lines) {
    const key = line.toLowerCase();
    if (idsByLabel.has(key)) {
      currentName.value = key;
      continue;
    }
    let matchedId = null;
    for (const [label, ids] of idsByLabel.entries()) {
      if (key.startsWith(label)) {
        matchedId = ids[0];
        break;
      }
    }
    if (!anthropicLineAppliesAt(line, verifiedAt)) continue;
    const values = firstCurrencyValues(line);
    if (!values.length) continue;
    const targetIds =
      matchedId !== null
        ? [matchedId]
        : currentName.value && idsByLabel.has(currentName.value)
          ? idsByLabel.get(currentName.value)
          : [];
    if (!targetIds.length) continue;
    const input = values[0] ?? null;
    const output = values.length >= 5 ? values[4] : values[values.length - 1];
    for (const targetId of targetIds) {
      prices.set(
        targetId,
        createTokenPricing({
          input,
          cachedInput: values.length >= 4 ? values[3] : null,
          cacheWrite: values.length >= 3 ? values[2] : null,
          output,
          sourceUrl,
          verifiedAt,
          raw: { line }
        })
      );
    }
    currentName.value = null;
  }
  return priceMapForAliases(prices, PROVIDER_PRICING_SOURCES.anthropic.aliases);
}

function parseXaiPricing({ lines, provider: _provider, sourceUrl, verifiedAt }) {
  const prices = new Map();
  for (const line of lines) {
    if (!/^grok/i.test(line)) continue;
    const modelId = /^([a-z0-9.-]+)/i.exec(line)?.[1]?.toLowerCase();
    if (!modelId) continue;
    const values = firstCurrencyValues(line);
    if (values.length < 3) continue;
    const contextWindow = /^([a-z0-9.-]+)\s+([0-9.]+[kKmM])/i.exec(line)?.[2] ?? null;
    const [
      shortInput,
      shortCachedInput,
      shortOutput,
      longInput = null,
      longCachedInput = null,
      longOutput = null
    ] = values;
    prices.set(
      modelId,
      createTokenPricing({
        input: shortInput ?? null,
        cachedInput: shortCachedInput ?? null,
        output: shortOutput ?? null,
        sourceUrl,
        verifiedAt,
        raw: {
          line,
          contextWindow,
          shortContext: {
            inputPerMillionTokens: shortInput ?? null,
            cachedInputReadPerMillionTokens: shortCachedInput ?? null,
            outputPerMillionTokens: shortOutput ?? null
          },
          longContext:
            longInput !== null || longCachedInput !== null || longOutput !== null
              ? {
                  inputPerMillionTokens: longInput,
                  cachedInputReadPerMillionTokens: longCachedInput,
                  outputPerMillionTokens: longOutput
                }
              : null
        }
      })
    );
  }
  return priceMapForAliases(prices, PROVIDER_PRICING_SOURCES.xai.aliases);
}

function parseVenicePricing({ lines, provider, sourceUrl, verifiedAt }) {
  const prices = new Map();
  const ids = findModelIds(provider);
  for (const modelId of ids) {
    const pattern = new RegExp(`(?:\`${escapeRegex(modelId)}\`|${escapeRegex(modelId)}\\s*\\$)`, "i");
    const line = lines.find((candidate) => pattern.test(candidate));
    if (!line) continue;
    const values = firstCurrencyValues(line);
    if (!values.length) continue;
    prices.set(
      modelId,
      createTokenPricing({
        input: values[0] ?? null,
        output: values[1] ?? values[0] ?? null,
        cachedInput: values[2] ?? null,
        cacheWrite: values[3] ?? null,
        sourceUrl,
        verifiedAt,
        raw: { line }
      })
    );
  }
  return prices;
}

function parseLumaPricing({ lines, provider, sourceUrl, verifiedAt }) {
  const prices = new Map();
  const ids = findModelIds(provider);
  for (const modelId of ids) {
    const baseId = PROVIDER_PRICING_SOURCES.lumaai.aliases[modelId] ?? modelId;
    const pattern = new RegExp(`^${escapeRegex(baseId)}\\s*\\$`, "i");
    const line = lines.find((candidate) => pattern.test(candidate));
    if (!line) continue;
    const value = /\$([0-9]+(?:\.[0-9]+)?)\s*\/\s*million pixels/i.exec(line)?.[1];
    if (!value) continue;
    prices.set(
      modelId,
      createDisplayPricing({
        inputDisplay: `$${value} / MPx`,
        outputDisplay: "Per render",
        sourceUrl,
        verifiedAt,
        raw: { line }
      })
    );
  }
  return priceMapForAliases(prices, PROVIDER_PRICING_SOURCES.lumaai.aliases);
}

async function scrapeHtml(url, { resolver, requestFactory, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const response = await fetchDocument(url, {
    resolver,
    requestFactory,
    timeoutMs,
    maxResponseBytes: 750_000,
    maxPageBytes: 1_500_000,
    maxRedirects: 5
  });
  return response.body;
}

export async function scrapeProviderPricing(provider, options = {}) {
  const source = PROVIDER_PRICING_SOURCES[provider.id];
  if (!source || !provider.models?.length) return new Map();
  const verifiedAt = new Date().toISOString();
  const html = await scrapeHtml(source.url, {
    resolver: options.resolver,
    requestFactory: options.requestFactory,
    timeoutMs: options.timeoutMs
  });
  const lines = htmlToLines(html);
  return source.parse({ lines, provider, sourceUrl: source.url, verifiedAt });
}

export async function scrapeProviderPricingCatalog(providers, options = {}) {
  const results = new Map();
  for (const provider of providers ?? []) {
    try {
      results.set(provider.id, await scrapeProviderPricing(provider, options));
    } catch (error) {
      options.logger?.warn(
        { providerId: provider.id, err: error },
        "Provider pricing scrape failed; continuing without scraped pricing"
      );
      results.set(provider.id, new Map());
    }
  }
  return results;
}

export { PROVIDER_PRICING_SOURCES };
