import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestHarness } from "../helpers/appTestHarness.js";
import {
  closeServer,
  createHttpServer,
  createMappedRequestFactory,
  createSequenceResolver
} from "../helpers/secureResearchFixtures.js";

const envKeys = ["AI_MOCK", "ENABLED_AI_PROVIDERS", "DEFAULT_AI_PROVIDER", "DEFAULT_AI_MODEL"];
let previousEnv;
let harness;

beforeEach(() => {
  previousEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  process.env.AI_MOCK = "true";
  process.env.ENABLED_AI_PROVIDERS = "openai,mock";
  process.env.DEFAULT_AI_PROVIDER = "mock";
  process.env.DEFAULT_AI_MODEL = "mock-structured-v1";
});

afterEach(() => {
  harness?.cleanup();
  harness = null;
  vi.useRealTimers();
  for (const key of envKeys) {
    if (previousEnv[key] === undefined) delete process.env[key];
    else process.env[key] = previousEnv[key];
  }
});

describe("model pricing synchronization", () => {
  it("fills fallback provider pricing from official pricing pages", async () => {
    const server = await createHttpServer((req, res) => {
      const host = String(req.headers.host ?? "").split(":")[0];
      const pages = {
        "developers.openai.com":
          "<table><tr><td>gpt-5.6-sol</td><td>$5.00</td><td>$0.50</td><td>$6.25</td><td>$30.00</td></tr></table>"
      };
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(pages[host] ?? "<html><body>Unknown</body></html>");
    });
    const requestFactory = createMappedRequestFactory({
      "1.1.1.1": { hostname: "127.0.0.1", port: server.port, protocol: "http:" }
    });
    const resolver = createSequenceResolver({
      "developers.openai.com": [[{ address: "1.1.1.1", family: 4 }]]
    });

    try {
      harness = createTestHarness({ requestFactory, resolver });

      await harness.request.post("/api/models/sync").send({}).expect(200);
      const catalog = await harness.request.get("/api/models/catalog").expect(200);
      const openAi = catalog.body.models.find(
        (model) => model.providerId === "openai" && model.providerModelId === "gpt-5.6-sol"
      );

      expect(openAi.pricing).toMatchObject({
        inputPerMillionTokens: 5,
        outputPerMillionTokens: 30,
        status: "fresh",
        sourceUrl: "https://developers.openai.com/api/docs/pricing"
      });
    } finally {
      await closeServer(server.server);
    }
  });

  it("hydrates discovered Anthropic model pricing from the Claude pricing page", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-20T12:00:00Z"));
    process.env.ENABLED_AI_PROVIDERS = "anthropic,mock";

    const server = await createHttpServer((req, res) => {
      const host = String(req.headers.host ?? "").split(":")[0];
      const pages = {
        "platform.claude.com": [
          "<div>Claude Sonnet 5</div>",
          "<div>through August 31, 2026 $2 / MTok $2.50 / MTok $4 / MTok $0.20 / MTok $10 / MTok</div>",
          "<div>Claude Sonnet 5 starting September 1, 2026 $3 / MTok $3.75 / MTok $6 / MTok $0.30 / MTok $15 / MTok</div>"
        ].join("")
      };
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(pages[host] ?? "<html><body>Unknown</body></html>");
    });
    const requestFactory = createMappedRequestFactory({
      "1.1.1.1": { hostname: "127.0.0.1", port: server.port, protocol: "http:" }
    });
    const resolver = createSequenceResolver({
      "platform.claude.com": [[{ address: "1.1.1.1", family: 4 }]]
    });

    try {
      harness = createTestHarness({ requestFactory, resolver });

      await harness.request.post("/api/models/sync").send({}).expect(200);
      const catalog = await harness.request.get("/api/models/catalog").expect(200);
      const anthropic = catalog.body.models.find(
        (model) => model.providerId === "anthropic" && model.providerModelId === "claude-sonnet-5"
      );

      expect(anthropic.pricing).toMatchObject({
        inputPerMillionTokens: 2,
        outputPerMillionTokens: 10,
        status: "fresh",
        sourceUrl: "https://platform.claude.com/docs/en/about-claude/pricing"
      });
    } finally {
      await closeServer(server.server);
    }
  });
});
