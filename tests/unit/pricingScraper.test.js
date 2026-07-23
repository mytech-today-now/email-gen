import { afterEach, describe, expect, it, vi } from "vitest";
import {
  scrapeProviderPricingCatalog,
  PROVIDER_PRICING_SOURCES
} from "../../src/ai/modelCatalog/pricingScraper.js";
import {
  closeServer,
  createHttpServer,
  createMappedRequestFactory,
  createSequenceResolver
} from "../helpers/secureResearchFixtures.js";

function provider(id, models) {
  return {
    id,
    models: models.map((model) => (typeof model === "string" ? { id: model, label: model } : model))
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("provider pricing scraper", () => {
  it("scrapes current pricing from official provider pages with secure HTML fetches", async () => {
    expect(PROVIDER_PRICING_SOURCES.openai.url).toBe("https://developers.openai.com/api/docs/pricing");
    expect(PROVIDER_PRICING_SOURCES.anthropic.url).toBe(
      "https://platform.claude.com/docs/en/about-claude/pricing"
    );
    expect(PROVIDER_PRICING_SOURCES.venice.url).toBe("https://docs.venice.ai/overview/pricing");

    const pages = {
      "developers.openai.com": [
        "<section>",
        "<div>Standard</div>",
        "<div>gpt-5.6-sol $5.00 $0.50 $6.25 $30.00</div>",
        "<div>Batch</div>",
        "<div>gpt-5.6-sol $2.50 $0.25 $3.125 $15.00</div>",
        "</section>"
      ].join(""),
      "platform.claude.com":
        "<div>Claude Sonnet 5</div><div>through August 31, 2026 $2 / MTok $2.50 / MTok $4 / MTok $0.20 / MTok $10 / MTok</div>",
      "docs.x.ai": [
        "<section>",
        "<div>Model Context Short context Long context</div>",
        "<div>Input Cached input Output Input Cached input Output</div>",
        "<div>grok-4.5 500k $2.00 $0.30 $6.00 $4.00 $0.60 $12.00</div>",
        "<div>grok-build-0.1 256k $1.00 $0.20 $2.00 $2.00 $0.40 $4.00</div>",
        "<div>grok-4.3 1M $1.25 $0.20 $2.50 $2.50 $0.40 $5.00</div>",
        "</section>"
      ].join(""),
      "docs.venice.ai":
        "<table><tr><td>Gemini 3.1 Pro Preview</td><td>`gemini-3-1-pro-preview`</td><td>$2.50</td><td>$15.00</td><td>$0.50</td><td>$0.50</td></tr></table>",
      "docs.lumalabs.ai":
        "<table><tr><td>ray-2</td><td>$0.01582 / million pixels</td></tr><tr><td>ray-flash-2</td><td>$0.00544 / million pixels</td></tr></table>"
    };
    const server = await createHttpServer((req, res) => {
      const host = String(req.headers.host ?? "").split(":")[0];
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(pages[host] ?? "<html><body>Unknown provider</body></html>");
    });
    const calls = [];
    const requestFactory = createMappedRequestFactory(
      {
        "1.1.1.1": { hostname: "127.0.0.1", port: server.port, protocol: "http:" }
      },
      calls
    );
    const resolver = createSequenceResolver({
      "developers.openai.com": [[{ address: "1.1.1.1", family: 4 }]],
      "platform.claude.com": [[{ address: "1.1.1.1", family: 4 }]],
      "docs.x.ai": [[{ address: "1.1.1.1", family: 4 }]],
      "docs.venice.ai": [[{ address: "1.1.1.1", family: 4 }]],
      "docs.lumalabs.ai": [[{ address: "1.1.1.1", family: 4 }]]
    });

    try {
      const results = await scrapeProviderPricingCatalog(
        [
          provider("openai", [
            { id: "gpt-5.6-sol", label: "GPT-5.6 Sol" },
            { id: "gpt-5.6", label: "GPT-5.6" }
          ]),
          provider("anthropic", [{ id: "claude-sonnet-5", label: "Claude Sonnet 5" }]),
          provider("xai", [
            { id: "grok-4.5", label: "Grok 4.5" },
            { id: "grok-4.5-latest", label: "Grok 4.5 Latest" },
            { id: "grok-build-latest", label: "Grok Build Latest" },
            { id: "grok-4.3-latest", label: "Grok 4.3 Latest" }
          ]),
          provider("venice", [{ id: "gemini-3-1-pro-preview", label: "Gemini 3.1 Pro Preview" }]),
          provider("lumaai", [
            { id: "ray-2", label: "Ray 2" },
            { id: "ray-2-720p", label: "Ray 2 720p" }
          ])
        ],
        { resolver, requestFactory, timeoutMs: 1000 }
      );

      expect(results.get("openai").get("gpt-5.6-sol")).toMatchObject({
        inputPerMillionTokens: 5,
        outputPerMillionTokens: 30,
        status: "fresh",
        batch: {
          inputPerMillionTokens: 2.5,
          outputPerMillionTokens: 15
        }
      });
      expect(results.get("openai").get("gpt-5.6")).toMatchObject({
        inputPerMillionTokens: 5,
        outputPerMillionTokens: 30
      });
      expect(results.get("anthropic").get("claude-sonnet-5")).toMatchObject({
        inputPerMillionTokens: 2,
        outputPerMillionTokens: 10
      });
      expect(results.get("xai").get("grok-4.5-latest")).toMatchObject({
        inputPerMillionTokens: 2,
        cachedInputReadPerMillionTokens: 0.3,
        outputPerMillionTokens: 6
      });
      expect(results.get("xai").get("grok-build-latest")).toMatchObject({
        inputPerMillionTokens: 1,
        outputPerMillionTokens: 2
      });
      expect(results.get("xai").get("grok-4.3-latest")).toMatchObject({
        inputPerMillionTokens: 1.25,
        outputPerMillionTokens: 2.5
      });
      expect(results.get("venice").get("gemini-3-1-pro-preview")).toMatchObject({
        inputPerMillionTokens: 2.5,
        outputPerMillionTokens: 15
      });
      expect(results.get("lumaai").get("ray-2-720p")).toMatchObject({
        inputDisplay: "$0.01582 / MPx",
        outputDisplay: "Per render"
      });
      expect(calls).toHaveLength(5);
    } finally {
      await closeServer(server.server);
    }
  });

  it("uses the currently effective Anthropic pricing row when the page lists dated tiers", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-20T12:00:00Z"));

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
      res.end(pages[host] ?? "<html><body>Unknown provider</body></html>");
    });
    const requestFactory = createMappedRequestFactory(
      {
        "1.1.1.1": { hostname: "127.0.0.1", port: server.port, protocol: "http:" }
      },
      []
    );
    const resolver = createSequenceResolver({
      "platform.claude.com": [[{ address: "1.1.1.1", family: 4 }]]
    });

    try {
      const results = await scrapeProviderPricingCatalog(
        [provider("anthropic", [{ id: "claude-sonnet-5", label: "Claude Sonnet 5" }])],
        { resolver, requestFactory, timeoutMs: 1000 }
      );

      expect(results.get("anthropic").get("claude-sonnet-5")).toMatchObject({
        inputPerMillionTokens: 2,
        outputPerMillionTokens: 10,
        sourceUrl: "https://platform.claude.com/docs/en/about-claude/pricing"
      });
    } finally {
      await closeServer(server.server);
    }
  });
});
