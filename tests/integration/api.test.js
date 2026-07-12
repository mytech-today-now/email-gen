import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestHarness, waitForJob } from "../helpers/appTestHarness.js";

let harness;
let previousEnv;
const providerEnvKeys = ["AI_MOCK", "ENABLED_AI_PROVIDERS", "CUSTOM_PROVIDER_BASE_URL", "OPENAI_API_KEY"];
const allProviders = "openai,anthropic,xai,venice,lumaai,custom,mock";

beforeEach(() => {
  previousEnv = Object.fromEntries(providerEnvKeys.map((key) => [key, process.env[key]]));
  process.env.AI_MOCK = "true";
  process.env.ENABLED_AI_PROVIDERS = allProviders;
  process.env.CUSTOM_PROVIDER_BASE_URL = "http://127.0.0.1:9999/v1";
  process.env.OPENAI_API_KEY = "sk-test-secret";
  harness = createTestHarness();
});

afterEach(() => {
  harness.cleanup();
  for (const key of providerEnvKeys) {
    if (previousEnv[key] === undefined) delete process.env[key];
    else process.env[key] = previousEnv[key];
  }
});

describe("API integration", () => {
  it("reports the expanded AI provider catalog without exposing credentials", async () => {
    const response = await harness.request.get("/api/config").expect(200);
    const providers = response.body.ai.providers;
    expect(providers.map((provider) => provider.id)).toEqual([
      "openai",
      "anthropic",
      "xai",
      "venice",
      "lumaai",
      "custom",
      "mock"
    ]);
    expect(providers.find((provider) => provider.id === "openai").models.map((model) => model.id)).toContain(
      "gpt-5.6-sol"
    );
    expect(
      providers.find((provider) => provider.id === "anthropic").models.map((model) => model.id)
    ).toContain("claude-fable-5");
    expect(providers.find((provider) => provider.id === "xai").models.map((model) => model.id)).toContain(
      "grok-4.5"
    );
    expect(providers.find((provider) => provider.id === "lumaai").models[0].capabilities).toEqual(["video"]);
    expect(JSON.stringify(response.body)).not.toContain("sk-test-secret");
  });

  it("does not report missing browser sidecar routes as server errors", async () => {
    await harness.request.get("/favicon.ico").expect(204);
    await harness.request.get("/.well-known/appspecific/com.chrome.devtools.json").expect(204);
    const missing = await harness.request.get("/not-a-real-route").expect(404);
    expect(missing.body.error.code).toBe("ROUTE_NOT_FOUND");
  });

  it("returns a safe validation error for malformed imports", async () => {
    const response = await harness.request
      .post("/api/records/import")
      .attach("file", Buffer.from('id,name\n1,"unterminated'), "bad.csv")
      .expect(400);
    expect(response.body.error.code).toBe("IMPORT_PARSE_FAILED");
  });

  it("loads sample data, previews a template, and processes one record with mock provider", async () => {
    await harness.request.get("/api/health").expect(200);
    const sample = await harness.request.post("/api/records/load-sample").send({}).expect(200);
    expect(sample.body.records).toHaveLength(4);
    const recordId = sample.body.records[0].id;

    const preview = await harness.request
      .post("/api/templates/preview")
      .send({ templateName: "restaurant-ai-sms.txt", recordId })
      .expect(200);
    expect(preview.body.rendered).toContain("https://acadiangrille.com/");

    const jobResponse = await harness.request
      .post("/api/jobs")
      .send({
        mode: "current",
        recordId,
        templateName: "restaurant-ai-sms.txt",
        addendumEnabled: true,
        addendumName: "ai-sms-email-blurb.html",
        provider: "mock",
        model: "mock-structured-v1",
        researchEnabled: false,
        concurrency: 1,
        delayMs: 0
      })
      .expect(202);
    const job = await waitForJob(harness.request, jobResponse.body.job.id);
    expect(job.counts.completed).toBe(1);
    const results = await harness.request.get("/api/results").expect(200);
    expect(results.body.results[0].subject).toContain("Acadian");
  });

  it("keeps imported datasets, prompts, and results siloed by project", async () => {
    const firstImport = await harness.request.post("/api/records/load-sample").send({}).expect(200);
    const firstProjectId = firstImport.body.project.id;
    const firstRecordId = firstImport.body.records[0].id;

    const firstJob = await harness.request
      .post("/api/jobs")
      .send({
        projectId: firstProjectId,
        mode: "current",
        recordId: firstRecordId,
        templateName: "restaurant-ai-sms.txt",
        provider: "mock",
        model: "mock-structured-v1",
        researchEnabled: false,
        concurrency: 1,
        delayMs: 0
      })
      .expect(202);
    await waitForJob(harness.request, firstJob.body.job.id);

    const secondImport = await harness.request
      .post("/api/records/import")
      .attach(
        "file",
        Buffer.from("id,name,city,website\n99,New Cafe,Lincoln,https://example.com/\n"),
        "new.csv"
      )
      .expect(200);
    const secondProjectId = secondImport.body.project.id;

    expect(secondProjectId).not.toBe(firstProjectId);
    expect(secondImport.body.project.name).toContain("New Cafe");

    const projects = await harness.request.get("/api/projects").expect(200);
    expect(projects.body.projects.map((project) => project.id)).toEqual(
      expect.arrayContaining([firstProjectId, secondProjectId])
    );

    const firstRecords = await harness.request.get(`/api/records?projectId=${firstProjectId}`).expect(200);
    const secondRecords = await harness.request.get(`/api/records?projectId=${secondProjectId}`).expect(200);
    expect(firstRecords.body.records).toHaveLength(4);
    expect(secondRecords.body.records).toHaveLength(1);

    const firstResults = await harness.request.get(`/api/results?projectId=${firstProjectId}`).expect(200);
    const secondResults = await harness.request.get(`/api/results?projectId=${secondProjectId}`).expect(200);
    expect(firstResults.body.results).toHaveLength(1);
    expect(secondResults.body.results).toHaveLength(0);
  });

  it("persists manual edits", async () => {
    const sample = await harness.request.post("/api/records/load-sample").send({}).expect(200);
    const jobResponse = await harness.request
      .post("/api/jobs")
      .send({
        mode: "current",
        recordId: sample.body.records[0].id,
        templateName: "restaurant-ai-sms.txt",
        provider: "mock",
        model: "mock-structured-v1",
        researchEnabled: false,
        concurrency: 1,
        delayMs: 0
      })
      .expect(202);
    await waitForJob(harness.request, jobResponse.body.job.id);
    const result = (await harness.request.get("/api/results").expect(200)).body.results[0];
    const edited = await harness.request
      .patch(`/api/results/${result.id}`)
      .send({ subject: "Edited", bodyHtml: "<p>Saved</p>" })
      .expect(200);
    expect(edited.body.result.subject).toBe("Edited");
    const fetched = await harness.request.get(`/api/results/${result.id}`).expect(200);
    expect(fetched.body.result.bodyHtml).toContain("Saved");
    expect(fetched.body.versions).toHaveLength(1);
  });

  it("exports completed emails as a delivery kit for sending systems", async () => {
    const sample = await harness.request.post("/api/records/load-sample").send({}).expect(200);
    const jobResponse = await harness.request
      .post("/api/jobs")
      .send({
        mode: "current",
        recordId: sample.body.records[0].id,
        templateName: "restaurant-ai-sms.txt",
        provider: "mock",
        model: "mock-structured-v1",
        researchEnabled: false,
        concurrency: 1,
        delayMs: 0
      })
      .expect(202);
    await waitForJob(harness.request, jobResponse.body.job.id);
    const result = (await harness.request.get("/api/results").expect(200)).body.results[0];
    const response = await harness.request
      .post("/api/results/delivery-export")
      .send({ profile: "mailchimp", resultIds: [result.id] })
      .expect(200);
    expect(response.body.export.filename).toMatch(/^delivery-mailchimp.*\.zip$/);
    expect(response.body.export.files).toContain("mailchimp/contacts.csv");
    expect(fs.existsSync(path.join(harness.context.config.outputDir, response.body.export.filename))).toBe(
      true
    );

    await harness.request.get(`/api/results/export-file/${response.body.export.filename}`).expect(200);
  });
});
