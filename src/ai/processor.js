import { z } from "zod";
import { AppError } from "../utils/errors.js";
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

function researchPromptSection(research) {
  if (!research || research.status !== "ok") {
    return "\n\nWebsite research: unavailable or disabled. Do not claim research was completed.";
  }
  return `\n\nWebsite research from ${research.url}:\nTitle: ${research.title || "Untitled"}\nExcerpt: ${research.excerpt || research.content}`;
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
  cacheRepository,
  browserLauncher,
  logger
}) {
  const validated = providerRegistry.validate(provider, model);
  const { rendered, analysis } = renderTemplate(template.content, record.normalized, {
    blockOnMissing: true
  });
  if (!analysis.canProcess) {
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
    enabled: researchEnabled
  });
  const addendum = renderAddendum(addendumName ? loadAddendum(config, addendumName) : null);
  const prompt = truncateBytes(
    `${rendered}${researchPromptSection(research)}${finalInstructionSection(config)}`,
    config.limits.promptBytes
  );

  const client = await createAiPoweredClient({ provider, model, config });
  let normalized;
  let rawAi;
  try {
    const result = await client.generateStructured(prompt, StructuredEmailSchema, {
      maxTokens: config.ai.maxTokens,
      temperature: config.ai.temperature
    });
    rawAi = JSON.stringify(result.data);
    normalized = normalizeAiResponse(result.data);
    if ((provider === "mock" || process.env.AI_MOCK === "true") && normalized.subject === "mock-string") {
      normalized = mockEmail(record);
      rawAi = JSON.stringify(normalized);
    }
  } catch (error) {
    if (provider === "mock" || process.env.AI_MOCK === "true") {
      normalized = mockEmail(record);
      rawAi = JSON.stringify(normalized);
    } else {
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
