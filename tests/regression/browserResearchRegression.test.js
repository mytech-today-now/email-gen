import { describe, expect, it, vi } from "vitest";
import { loadAppConfig } from "../../config/app.config.js";
import { collectResearch } from "../../src/research/researchService.js";
import {
  closeServer,
  createHttpServer,
  createMappedRequestFactory,
  createSequenceResolver
} from "../helpers/secureResearchFixtures.js";

function config() {
  const base = loadAppConfig();
  return loadAppConfig({
    research: {
      ...base.research,
      enabled: true,
      timeoutMs: 10000,
      responseBytes: 12000,
      cacheSeconds: 60,
      maxHeaderBytes: 4096,
      maxPageBytes: 50000,
      maxJobBytes: 100000,
      maxJobMs: 30000,
      maxRedirects: 3,
      maxContactPages: 3,
      maxConcurrentPages: 1,
      renderDelayMs: 0
    }
  });
}

function cacheRepository() {
  const entries = new Map();
  return {
    getFresh: vi.fn((url) => entries.get(url) ?? null),
    save: vi.fn((url, entry) => {
      entries.set(url, entry);
      return entry;
    })
  };
}

function createLogger() {
  return { info: vi.fn(), warn: vi.fn(), debug: vi.fn() };
}

describe("secure research regressions", () => {
  it("extracts details from rendered restaurant pages and logs the scrape lifecycle", async () => {
    const server = await createHttpServer((req, res) => {
      if (req.url === "/contact-us") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(
          '<html><head><title>Contact Rendered Bistro</title></head><body><a href="mailto:hello@rendered.example">hello@rendered.example</a></body></html>'
        );
        return;
      }
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(
        '<html><head><title>Rendered Bistro</title></head><body><a href="/contact-us">Contact us</a><p>Seasonal brunch, late-night ramen, patio seating, and online ordering.</p></body></html>'
      );
    });
    const logger = createLogger();
    const repository = cacheRepository();
    const requestFactory = createMappedRequestFactory(
      { "1.1.1.1": { hostname: "127.0.0.1", port: server.port } },
      []
    );
    const resolver = createSequenceResolver({
      "example.com": [[{ address: "1.1.1.1", family: 4 }], [{ address: "1.1.1.1", family: 4 }]]
    });

    try {
      const result = await collectResearch(
        { normalized: { name: "Rendered Bistro", website: "http://example.com/" } },
        {
          config: config(),
          cacheRepository: repository,
          resolver,
          requestFactory,
          logger,
          enabled: true
        }
      );

      expect(result).toMatchObject({
        status: "ok",
        url: "http://example.com/",
        title: "Rendered Bistro"
      });
      expect(result.content).toContain("late-night ramen");
      expect(repository.save).toHaveBeenCalledWith(
        "http://example.com/",
        expect.objectContaining({ status: "ok", title: "Rendered Bistro" }),
        60
      );
      expect(logger.info).toHaveBeenCalledWith(
        { url: "http://example.com/" },
        "Website research scrape started"
      );
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          url: "http://example.com/",
          finalUrl: "http://example.com/",
          title: "Rendered Bistro"
        }),
        "Website research scrape completed"
      );
    } finally {
      await closeServer(server.server);
    }
  });

  it("logs and caches research failures without failing record processing", async () => {
    const logger = createLogger();
    const repository = cacheRepository();

    const result = await collectResearch(
      { normalized: { name: "Closed Cafe", website: "http://127.0.0.1:3000/" } },
      {
        config: config(),
        cacheRepository: repository,
        logger,
        enabled: true
      }
    );

    expect(result).toMatchObject({
      status: "failed",
      error: { code: "FORBIDDEN_DESTINATION" }
    });
    expect(repository.save).toHaveBeenCalledWith(
      "http://127.0.0.1:3000/",
      expect.objectContaining({ status: "failed" }),
      60
    );
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ url: "http://127.0.0.1:3000/", code: "FORBIDDEN_DESTINATION" }),
      "Website research scrape failed"
    );
  });

  it("discovers a business email from a linked contact page and caches contact metadata", async () => {
    const server = await createHttpServer((req, res) => {
      if (req.url === "/contact-us") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(
          '<html><head><title>Contact Rendered Bistro</title></head><body><a href="mailto:hello@rendered.example">hello@rendered.example</a></body></html>'
        );
        return;
      }
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(
        '<html><head><title>Rendered Bistro</title></head><body><a href="/contact-us">Contact us</a></body></html>'
      );
    });
    const logger = createLogger();
    const repository = cacheRepository();
    const requestFactory = createMappedRequestFactory(
      { "1.1.1.1": { hostname: "127.0.0.1", port: server.port } },
      []
    );
    const resolver = createSequenceResolver({
      "example.com": [[{ address: "1.1.1.1", family: 4 }], [{ address: "1.1.1.1", family: 4 }]]
    });

    try {
      const result = await collectResearch(
        { normalized: { name: "Rendered Bistro", website: "http://example.com/" } },
        {
          config: config(),
          cacheRepository: repository,
          resolver,
          requestFactory,
          logger,
          enabled: true
        }
      );

      expect(result.contact).toMatchObject({
        primaryEmail: "hello@rendered.example",
        contactPage: "http://example.com/contact-us"
      });
      expect(repository.save).toHaveBeenCalledWith(
        "http://example.com/",
        expect.objectContaining({
          metadata: expect.objectContaining({
            contact: expect.objectContaining({ primaryEmail: "hello@rendered.example" })
          })
        }),
        60
      );
    } finally {
      await closeServer(server.server);
    }
  });

  it("marks research as degraded when a contact page fails but the main page succeeds", async () => {
    const server = await createHttpServer((req, res) => {
      if (req.url === "/contact-us") {
        res.writeHead(500, { "content-type": "text/html; charset=utf-8" });
        res.end("<html><body>contact failed</body></html>");
        return;
      }
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(
        '<html><head><title>Rendered Bistro</title></head><body><a href="/contact-us">Contact us</a><p>Seasonal brunch and late-night ramen.</p></body></html>'
      );
    });
    const logger = createLogger();
    const repository = cacheRepository();
    const requestFactory = createMappedRequestFactory(
      { "1.1.1.1": { hostname: "127.0.0.1", port: server.port } },
      []
    );
    const resolver = createSequenceResolver({
      "example.com": [[{ address: "1.1.1.1", family: 4 }], [{ address: "1.1.1.1", family: 4 }]]
    });

    try {
      const result = await collectResearch(
        { normalized: { name: "Rendered Bistro", website: "http://example.com/" } },
        {
          config: config(),
          cacheRepository: repository,
          resolver,
          requestFactory,
          logger,
          enabled: true
        }
      );

      expect(result).toMatchObject({
        status: "degraded",
        url: "http://example.com/"
      });
      expect(result.content).toContain("late-night ramen");
      expect(result.contactPageResearchFailures).toHaveLength(1);
      expect(repository.save).toHaveBeenCalledWith(
        "http://example.com/",
        expect.objectContaining({ status: "degraded" }),
        60
      );
    } finally {
      await closeServer(server.server);
    }
  });
});
