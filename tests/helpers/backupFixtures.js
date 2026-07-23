import { createHash } from "node:crypto";
import { zipSync } from "fflate";

const encoder = new TextEncoder();

function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function buildBackupData({
  projectId = "project_source",
  recordId = "record_source",
  templateId = "template_source",
  jobId = "job_source",
  resultId = "result_source",
  includeSettings = true,
  activeProjectId = projectId,
  selectedModel = null
} = {}) {
  const data = {
    projects: [
      {
        id: projectId,
        name: "Source project",
        sourceName: "source.csv",
        templateId,
        recordCount: 1,
        createdAt: "2026-07-22T00:00:00.000Z",
        updatedAt: "2026-07-22T00:00:00.000Z",
        revision: 0
      }
    ],
    records: [
      {
        id: recordId,
        projectId,
        sourceName: "source.csv",
        recordKey: "row-1",
        displayName: "Record One",
        sourceRow: 1,
        raw: { name: "Record One" },
        normalized: { name: "Record One", email: "person@example.com" },
        validation: { errors: [] },
        status: "ready",
        contactLookup: "person@example.com",
        createdAt: "2026-07-22T00:00:00.000Z",
        updatedAt: "2026-07-22T00:00:00.000Z",
        revision: 0
      }
    ],
    templates: [
      {
        id: templateId,
        name: "Welcome template",
        content: "Hello {{name}}",
        tags: ["welcome"],
        folder: "Inbox",
        source: "seed",
        immutable: false,
        createdAt: "2026-07-22T00:00:00.000Z",
        updatedAt: "2026-07-22T00:00:00.000Z",
        revision: 0
      }
    ],
    templateVersions: [
      {
        id: `version_${templateId}`,
        templateId,
        name: "Welcome template",
        content: "Hello {{name}}",
        tags: ["welcome"],
        createdAt: "2026-07-22T00:00:00.000Z"
      }
    ],
    jobs: [
      {
        id: jobId,
        operationId: jobId,
        projectId,
        status: "completed",
        executionMode: "provider-batch",
        requestedExecutionMode: "provider-batch",
        counts: { queued: 0, running: 0, completed: 1, failed: 0, stopped: 0, remaining: 0 },
        providerBatch: {
          operationId: jobId,
          clientRequestKey: "pb-source",
          provider: "openai",
          model: "gpt-5.6",
          requests: [
            {
              customId: "req_source",
              recordId,
              displayName: "Record One",
              prompt: "Hello Record One",
              research: { status: "ok", url: "https://example.com", content: "ok" }
            }
          ],
          chunks: [
            {
              chunkId: "chunk_1",
              index: 0,
              requestIds: ["req_source"],
              recordIds: [recordId],
              submissionState: "completed",
              providerBatchId: "batch_source",
              providerStatus: "completed"
            }
          ],
          estimate: { inputTokens: 1, outputTokens: 1 },
          submissionState: "completed",
          monitoringState: "completed",
          createdAt: "2026-07-22T00:00:00.000Z",
          updatedAt: "2026-07-22T00:00:00.000Z"
        },
        createdAt: "2026-07-22T00:00:00.000Z",
        updatedAt: "2026-07-22T00:00:00.000Z"
      }
    ],
    results: [
      {
        id: resultId,
        jobId,
        projectId,
        recordId,
        templateId,
        provider: "openai",
        model: "gpt-5.6",
        status: "completed",
        subject: "Hello",
        originalAiBodyHtml: "<p>Hello</p>",
        finalEmailHtml: "<p>Hello</p>",
        finalText: "Hello",
        addendumSnapshot: "",
        signatureSnapshot: "Best,\nKyle",
        contacts: [
          {
            id: "contact_1",
            type: "email",
            value: "person@example.com",
            sourceUrl: "https://example.com",
            sourceCategory: "imported",
            method: "crawl",
            sameDomain: true,
            confidence: 0.9,
            confidenceLabel: "high",
            reason: "Seed contact",
            discoveredAt: "2026-07-22T00:00:00.000Z"
          }
        ],
        primaryContactId: "contact_1",
        consentStatus: "unknown",
        consentSource: "",
        consentTimestamp: "",
        version: 1,
        trashed: false,
        addendumId: null,
        research: null,
        renderedPrompt: "Hello Record One",
        usage: { inputTokens: 1, outputTokens: 1 },
        error: null,
        createdAt: "2026-07-22T00:00:00.000Z",
        updatedAt: "2026-07-22T00:00:00.000Z",
        revision: 0
      }
    ],
    resultVersions: [
      {
        id: `version_${resultId}`,
        resultId,
        version: 1,
        subject: "Hello",
        finalEmailHtml: "<p>Hello</p>",
        finalText: "Hello",
        originalAiBodyHtml: "<p>Hello</p>",
        addendumSnapshot: "",
        createdAt: "2026-07-22T00:00:00.000Z"
      }
    ],
    deliveryHistory: [
      {
        id: `delivery_${resultId}`,
        operationId: jobId,
        resultId,
        messageDigest: "digest-1",
        chunkIndex: 0,
        resendId: "resend-1",
        providerMessageId: "provider-1",
        email: "person@example.com",
        status: "delivered",
        idempotencyKey: "idempotency-1",
        reviewedAt: "2026-07-22T00:00:00.000Z",
        reviewId: "review-1",
        updatedAt: "2026-07-22T00:00:00.000Z"
      }
    ]
  };
  if (includeSettings) {
    data.settings = [
      {
        key: "application",
        activeProjectId,
        selectedModel,
        executionMode: "provider-batch",
        businessName: "Local AI SMS",
        businessSignature: "Best,\nKyle",
        businessUrl: "https://example.com/ai-sms",
        companyAddress: "",
        modelCacheTtlHours: 24,
        openrouterReferer: "",
        ollamaHost: "http://127.0.0.1:11434",
        confirmedCustomOllamaHost: false,
        customBaseUrl: "",
        confirmedCustomProviderHost: false,
        resendFromName: "",
        resendFromAddress: "",
        resendReplyTo: "",
        resendTestRecipient: "",
        resendBatchSize: 100,
        resendUnsubscribeUrl: "",
        logLevel: "info",
        reducedMotion: false,
        highContrast: false,
        walkthroughVersion: 0,
        editorHeight: 480,
        editorPanels: { raw: 540, preview: 560 },
        recordColumns: {},
        resultColumns: {},
        updatedAt: "2026-07-22T00:00:00.000Z",
        revision: 0
      }
    ];
  }
  return data;
}

export function makeBackupArchive(data, overrides = {}) {
  const counts = {};
  const checksums = {};
  for (const [store, records] of Object.entries(data)) {
    const bytes = encoder.encode(JSON.stringify(records));
    const path = `data/${store}.json`;
    counts[store] = records.length;
    checksums[path] = sha256Hex(bytes);
  }
  const entries = {
    "manifest.json": null
  };
  const manifest = {
    format: "ai-batch-personalizer-backup",
    archiveVersion: 1,
    applicationVersion: "2.0.0",
    browserSchemaVersion: 5,
    exportedAt: "2026-07-22T00:00:00.000Z",
    includedCategories: Object.keys(data),
    counts,
    checksums,
    migration: { version: 1 },
    ...overrides
  };
  entries["manifest.json"] = encoder.encode(JSON.stringify(manifest));
  for (const [store, records] of Object.entries(data)) {
    const path = `data/${store}.json`;
    entries[path] = encoder.encode(JSON.stringify(records));
  }
  return { archive: zipSync(entries), manifest };
}
