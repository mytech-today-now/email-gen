import { z } from "zod";
import { AppError, createShutdownError } from "../utils/errors.js";
import { truncateBytes } from "../utils/helpers.js";
import { renderTemplate } from "../templates/renderer.js";
import { collectResearch } from "../research/researchService.js";
import { loadAddendum } from "../addenda/loader.js";
import { renderAddendum } from "../addenda/renderer.js";
import { renderEmailFragment, renderPlainText } from "../output/emailRenderer.js";
import { normalizeAiResponse } from "./responseParser.js";
import { createAiPoweredClient } from "./grokProvider.js";
import { normalizeProviderError } from "./providerErrors.js";

const StructuredEmailSchema = z.object({
  subject: z.string().min(1).max(160),
  bodyHtml: z.string().min(1)
});

const USABLE_RESEARCH_STATUSES = new Set(["ok", "degraded", "partial"]);

function researchPromptSection(research) {
  if (!research || !USABLE_RESEARCH_STATUSES.has(research.status)) {
    return "\n\nWebsite research: unavailable or disabled. Do not claim research was completed.";
  }
  const partialNote =
    research.status === "ok"
      ? ""
      : "\nNote: website research was only partially successful and some contact-page checks failed.";
  return `${partialNote}\n\nWebsite research from ${research.url}:\nTitle: ${research.title || "Untitled"}\nExcerpt: ${research.excerpt || research.content}`;
}

function finalInstructionSection(config) {
  return `\n\nConfigured business details:\n- Business name: ${config.business.name}\n- City: ${config.business.city}, ${config.business.region}\n- AI SMS URL: ${config.business.aiSmsUrl}\n- The application will append the signature, contact block, and final AI SMS URL after your bodyHtml.\n- Do not include a sender signature, contact block, footer, or repeated promotional link in bodyHtml.\n\nReturn only valid JSON with subject and bodyHtml.`;
}

function mockEmail(record) {
  return {
    subject: `Quick AI SMS idea for ${record.displayName}`,
    bodyHtml: `<p>Dear ${record.displayName} Owner and the General Manager,</p><p>I noticed ${record.displayName} and thought a simple AI SMS flow could help capture missed calls, answer guest questions faster, and ease pressure on your team during busy service.</p><p>Worth a quick look?</p>`
  };
}

export async function processRecord({
  record,
  template,
  addendumName,
  provider,
  model,
  researchEnabled,
  config,
  providerRegistry,
  runtimeCredentials,
  cacheRepository,
  browserLauncher,
  logger,
  signal = null
}) {
  if (signal?.aborted) {
    throw signal.reason instanceof Error ? signal.reason : createShutdownError();
  }
  const logContext = {
    recordId: record.id,
    recordName: record.displayName,
    provider,
    model,
    sourceRow: record.sourceRow
  };
  logger?.info({ ...logContext, stage: "template-interpolation" }, "Record processing started");
  const validated = providerRegistry.validate(provider, model);
  const { rendered, analysis } = renderTemplate(template.content, record.normalized, {
    blockOnMissing: true
  });
  if (!analysis.canProcess) {
    logger?.warn(
      { ...logContext, stage: "template-interpolation", missing: analysis.missing, blank: analysis.blank },
      "Record blocked by missing template variables"
    );
    throw new AppError(
      "TEMPLATE_VARIABLE_MISSING",
      "Required template variables are missing.",
      400,
      analysis
    );
  }

  const research = await collectResearch(record, {
    config,
    cacheRepository,
    browserLauncher,
    logger,
    enabled: researchEnabled,
    signal
  });
  logger?.info(
    { ...logContext, stage: "research", researchStatus: research.status },
    "Record research completed"
  );
  const addendum = renderAddendum(addendumName ? loadAddendum(config, addendumName) : null);
  const prompt = truncateBytes(
    `${rendered}${researchPromptSection(research)}${finalInstructionSection(config)}`,
    config.limits.promptBytes
  );

  const client = await createAiPoweredClient({ provider, model, config, runtimeCredentials });
  let normalized;
  let rawAi;
  try {
    logger?.info({ ...logContext, stage: "provider-request" }, "Provider request started");
    const result = await client.generateStructured(prompt, StructuredEmailSchema, {
      maxTokens: config.ai.maxTokens,
      temperature: config.ai.temperature,
      signal
    });
    rawAi = JSON.stringify(result.data);
    normalized = normalizeAiResponse(result.data);
    logger?.info(
      { ...logContext, stage: "response-parse", subjectLength: normalized.subject.length },
      "Provider response parsed"
    );
    if ((provider === "mock" || process.env.AI_MOCK === "true") && normalized.subject === "mock-string") {
      normalized = mockEmail(record);
      rawAi = JSON.stringify(normalized);
    }
  } catch (error) {
    if (signal?.aborted) {
      throw signal.reason instanceof Error ? signal.reason : createShutdownError();
    }
    if (provider === "mock" || process.env.AI_MOCK === "true") {
      normalized = mockEmail(record);
      rawAi = JSON.stringify(normalized);
    } else {
      logger?.warn({ ...logContext, stage: "provider-request", err: error }, "Provider request failed");
      throw normalizeProviderError(error, validated.provider);
    }
  }

  const emailHtml = renderEmailFragment({
    subject: normalized.subject,
    bodyHtml: normalized.bodyHtml,
    addendumHtml: addendum.html,
    record,
    config
  });
  logger?.info({ ...logContext, stage: "html-rendering" }, "Record HTML rendered");
  const bodyText = renderPlainText({
    subject: normalized.subject,
    bodyHtml: normalized.bodyHtml,
    addendumHtml: addendum.html,
    config
  });

  return {
    subject: normalized.subject,
    bodyHtml: normalized.bodyHtml,
    bodyText,
    emailHtml,
    prompt,
    research,
    addendum,
    rawAi
  };
}
