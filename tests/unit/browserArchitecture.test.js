import { createHmac, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { STORE_DEFINITIONS, VERSIONS } from "../../public/modules/constants.js";
import { columnUnion, flattenRecord } from "../../public/modules/records.js";
import { exportableStores } from "../../public/modules/storage.js";
import {
  analyzeTemplate,
  parseTemplateVariables,
  renderTemplate,
  safeTemplateName
} from "../../public/modules/templates.js";
import { clampSplitRatio } from "../../public/modules/splitPane.js";
import { inspectBackup } from "../../public/modules/backup.js";
import {
  OPENROUTER_MODELS_URL,
  discoverOpenRouter,
  normalizeOllamaModel,
  normalizeOpenRouterModel,
  normalizeOpenRouterPricing,
  validateOllamaOrigin
} from "../../src/ai/modelCatalog/runtimeDiscovery.js";
import { discoverContactCandidates, selectPrimaryContacts } from "../../src/research/contactDiscovery.js";
import {
  buildResendPreflight,
  createResendWebhookBuffer,
  idempotencyKeyFor,
  resendEligibility,
  sendResendBatch
} from "../../src/resend/resendGateway.js";
import { redact } from "../../public/modules/logger.js";
import { createRuntimeCredentialManager } from "../../src/security/runtimeCredentialManager.js";

describe("browser-first architecture utilities", () => {
  it("flattens nested records and prioritizes prompt variables in the complete column union", () => {
    const records = [
      { normalized: { name: "One", address: { city: "Omaha", geo: { lat: 41.2 } } } },
      { normalized: { name: "Two", email: "two@example.com", tags: ["a", "b"] } }
    ];
    expect(flattenRecord(records[0].normalized)).toEqual({
      name: "One",
      "address.city": "Omaha",
      "address.geo.lat": 41.2
    });
    expect(columnUnion(records, ["address.city", "name"]).map((column) => column.name)).toEqual([
      "address.city",
      "name",
      "address.geo.lat",
      "email",
      "tags"
    ]);
  });

  it("discovers, validates, and renders every supported template variable form", () => {
    const source = '{{name}} {{email|required}} {{phone?}} {{city|default:"Omaha"}} {{nested.value}}';
    const parsed = parseTemplateVariables(source);
    expect(parsed.variables.map((item) => item.name)).toEqual([
      "name",
      "email",
      "phone",
      "city",
      "nested.value"
    ]);
    expect(analyzeTemplate(source, { name: "A", email: "a@b.com", nested: { value: "x" } }).canProcess).toBe(
      true
    );
    expect(
      renderTemplate(source, { name: "A", email: "a@b.com", nested: { value: "x" } }).rendered
    ).toContain("Omaha");
    expect(safeTemplateName("../../bad<script>.txt")).not.toContain("..");
  });

  it("clamps split ratios and keeps runtime credentials in memory only", async () => {
    expect(clampSplitRatio(-10, 25, 75)).toBe(25);
    expect(clampSplitRatio(90, 25, 75)).toBe(75);
    const runtimeCredentials = createRuntimeCredentialManager();
    runtimeCredentials.set("openrouter", "test-key");
    expect(runtimeCredentials.get("OPENROUTER_API_KEY")).toBe("test-key");
    expect(runtimeCredentials.publicState("openrouter")).toMatchObject({
      configured: true,
      status: "configured"
    });
    runtimeCredentials.clear("openrouter");
    expect(runtimeCredentials.get("OPENROUTER_API_KEY")).toBe("");
  });

  it("keeps the revisioned browser schema stable and excludes internal stores from export", () => {
    expect(VERSIONS.browserSchema).toBe(5);
    expect(STORE_DEFINITIONS.operations).toMatchObject({
      keyPath: "scopeKey",
      indexes: expect.objectContaining({
        kind: "kind",
        status: "status",
        operationId: "operationId",
        updatedAt: "updatedAt",
        leaseExpiresAt: "leaseExpiresAt"
      })
    });
    expect(STORE_DEFINITIONS.secrets).toBeUndefined();
    expect(exportableStores()).not.toContain("operations");
    expect(exportableStores()).not.toContain("secrets");
    expect(exportableStores({ includeLogs: true })).toContain("logs");
  });

  it("normalizes OpenRouter pricing without treating sentinels as zero", () => {
    const pricing = normalizeOpenRouterPricing({
      prompt: "0.0000015",
      completion: "0.000006",
      input_cache_read: "-1",
      request: null
    });
    expect(pricing.inputPerMillionTokens).toBe(1.5);
    expect(pricing.outputPerMillionTokens).toBe(6);
    expect(pricing.cachedInputReadPerMillionTokens).toBeNull();
    expect(pricing.status).toBe("variable");
    expect(pricing.sourceUrl).toBe("https://openrouter.ai/api/v1/models");
    const model = normalizeOpenRouterModel({
      id: "vendor/model",
      name: "Model",
      architecture: { input_modalities: ["text"], output_modalities: ["text"] },
      supported_parameters: ["structured_outputs"],
      pricing: { prompt: "0", completion: "0" }
    });
    expect(model.compatibility.compatible).toBe(true);
    expect(model.metadataSource.url).toBe("https://openrouter.ai/api/v1/models");
  });

  it("discovers OpenRouter models from the official models JSON endpoint", async () => {
    const calls = [];
    const fetchImpl = async (url, options = {}) => {
      calls.push({ url, headers: options.headers ?? {} });
      return new Response(
        JSON.stringify({
          data: [
            {
              id: "openai/gpt-4.1-mini",
              name: "OpenAI: GPT-4.1 Mini",
              architecture: { input_modalities: ["text"], output_modalities: ["text"] },
              supported_parameters: ["structured_outputs"],
              pricing: { prompt: "0.0000004", completion: "0.0000016" }
            }
          ]
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    };

    const result = await discoverOpenRouter({ apiKey: "test-openrouter-key", fetchImpl });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(OPENROUTER_MODELS_URL);
    expect(calls[0].headers.authorization).toBe("Bearer test-openrouter-key");
    expect(result.models[0].pricing.sourceUrl).toBe("https://openrouter.ai/api/v1/models");
  });

  it("normalizes Ollama as local compute and rejects non-loopback hosts", () => {
    const model = normalizeOllamaModel({
      model: "gemma3",
      size: 123,
      details: { family: "gemma", parameter_size: "4B", quantization_level: "Q4" }
    });
    expect(model.pricing.status).toBe("local-compute");
    expect(model.compatibility.status).toBe("ready");
    expect(validateOllamaOrigin("http://127.0.0.1:11434")).toBe("http://127.0.0.1:11434");
    expect(validateOllamaOrigin("http://localhost:11434")).toBe("http://localhost:11434");
    expect(() => validateOllamaOrigin("https://example.com")).toThrowError(/loopback/i);
  });

  it("retains and ranks source-attributed emails and forms deterministically", () => {
    const candidates = discoverContactCandidates({
      url: "https://restaurant.example/",
      record: { normalized: { email: "owner@restaurant.example" } },
      body: '<a href="mailto:info@restaurant.example">Email</a><form action="/contact"><textarea name="message"></textarea><button>Send inquiry</button></form>'
    });
    expect(candidates).toHaveLength(3);
    expect(candidates.every((item) => item.sourceUrl && item.method && item.reason)).toBe(true);
    expect(selectPrimaryContacts(candidates).primaryEmail.value).toBe("info@restaurant.example");
  });

  it("blocks Resend recipients without explicit evidence, deduplicates, and creates stable idempotency", () => {
    expect(
      resendEligibility({
        primaryEmail: "scraped@example.com",
        contactSource: "scraped",
        consentStatus: "unknown"
      }).eligible
    ).toBe(false);
    const item = {
      id: "one",
      primaryEmail: "opted@example.com",
      consentStatus: "opted-in",
      consentSource: "signup",
      consentTimestamp: "2026-01-01T00:00:00Z"
    };
    const preflight = buildResendPreflight([item, { ...item, id: "two" }], { batchSize: 100 });
    expect(preflight.recipientCount).toBe(1);
    expect(preflight.excluded[0].reasons).toContain("Duplicate recipient in this send scope.");
    expect(idempotencyKeyFor([item], { fromAddress: "from@example.com" })).toBe(
      idempotencyKeyFor([item], { fromAddress: "from@example.com" })
    );
  });

  it("redacts nested browser diagnostics", () => {
    expect(
      redact({ apiKey: "sk-secret-value", nested: { authorization: "Bearer abc", message: "sk-123456789" } })
    ).toEqual({ apiKey: "[REDACTED]", nested: { authorization: "[REDACTED]", message: "[REDACTED]" } });
  });

  it("batches Resend sends at 100, preserves idempotency, and retries only transient responses", async () => {
    const calls = [];
    const responses = [
      new Response(JSON.stringify({ message: "slow down" }), {
        status: 429,
        headers: { "retry-after": "0" }
      }),
      new Response(
        JSON.stringify({ data: Array.from({ length: 100 }, (_, index) => ({ id: `resend-${index}` })) }),
        { status: 200 }
      ),
      new Response(JSON.stringify({ data: [{ id: "resend-100" }] }), { status: 200 })
    ];
    const fetchImpl = async (_url, options) => {
      calls.push(options);
      return responses.shift();
    };
    const items = Array.from({ length: 101 }, (_, index) => ({
      id: `result-${index}`,
      primaryEmail: `person-${index}@example.com`,
      subject: `Hello ${index}`,
      html: "<p>Hello</p>",
      text: "Hello"
    }));
    const result = await sendResendBatch({
      apiKey: "re_test",
      items,
      sender: {
        fromAddress: "sender@example.com",
        companyAddress: "123 Main St",
        unsubscribeUrl: "https://example.com/unsubscribe"
      },
      fetchImpl,
      maxRetries: 1
    });
    expect(result).toMatchObject({ batchCount: 2 });
    expect(result.deliveries).toHaveLength(101);
    expect(calls).toHaveLength(3);
    expect(calls[0].headers["idempotency-key"]).toBe(calls[1].headers["idempotency-key"]);
    expect(JSON.parse(calls[1].body)).toHaveLength(100);
    expect(JSON.parse(calls[2].body)).toHaveLength(1);
  });

  it("treats aborted backup validation as a cancellation", async () => {
    const controller = new AbortController();
    controller.abort(new DOMException("Archive cancelled.", "AbortError"));
    await expect(inspectBackup(new Blob(["not-a-zip"]), { signal: controller.signal })).rejects.toMatchObject(
      {
        code: "ARCHIVE_CANCELLED"
      }
    );
  });

  it("verifies, deduplicates, and exposes supported Resend webhook events", () => {
    const rawSecret = randomBytes(32);
    const webhookSecret = `whsec_${rawSecret.toString("base64")}`;
    const payload = JSON.stringify({
      type: "email.delivered",
      created_at: new Date().toISOString(),
      data: { email_id: "resend-1" }
    });
    const id = "msg_test";
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = createHmac("sha256", rawSecret)
      .update(`${id}.${timestamp}.${payload}`)
      .digest("base64");
    const buffer = createResendWebhookBuffer();
    const input = { payload, headers: { id, timestamp, signature: `v1,${signature}` }, webhookSecret };
    expect(buffer.verifyAndStore(input).duplicate).toBe(false);
    expect(buffer.verifyAndStore(input).duplicate).toBe(true);
    expect(buffer.list()).toEqual([
      expect.objectContaining({ type: "email.delivered", data: { email_id: "resend-1" } })
    ]);
  });
});
