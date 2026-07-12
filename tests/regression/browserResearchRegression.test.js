import { describe, expect, it, vi } from "vitest";
import { loadAppConfig } from "../../config/app.config.js";
import { collectResearch } from "../../src/research/researchService.js";
import { createFakeBrowserLauncher } from "../helpers/fakeBrowserLauncher.js";

function config() {
  const base = loadAppConfig();
  return loadAppConfig({
    research: {
      ...base.research,
      enabled: true,
      timeoutMs: 1000,
      responseBytes: 12000,
      cacheSeconds: 60,
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

describe("browser-backed restaurant research regressions", () => {
  it("extracts details from rendered restaurant pages and logs the scrape lifecycle", async () => {
    const { launcher } = createFakeBrowserLauncher({
      html: `
        <html>
          <head><title>Rendered Bistro</title></head>
          <body>
            <h1>Rendered Bistro</h1>
            <p>Seasonal brunch, late-night ramen, patio seating, and online ordering.</p>
          </body>
        </html>`
    });
    const logger = { info: vi.fn(), warn: vi.fn() };
    const repository = cacheRepository();

    const result = await collectResearch(
      { normalized: { name: "Rendered Bistro", website: "https://example.com/" } },
      {
        config: config(),
        cacheRepository: repository,
        browserLauncher: launcher,
        logger,
        enabled: true
      }
    );

    expect(result).toMatchObject({
      status: "ok",
      url: "https://example.com/",
      title: "Rendered Bistro"
    });
    expect(result.content).toContain("late-night ramen");
    expect(repository.save).toHaveBeenCalledWith(
      "https://example.com/",
      expect.objectContaining({ status: "ok", title: "Rendered Bistro" }),
      60
    );
    expect(logger.info).toHaveBeenCalledWith(
      { url: "https://example.com/" },
      "Website research scrape started"
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://example.com/",
        finalUrl: "https://example.com/",
        title: "Rendered Bistro"
      }),
      "Website research scrape completed"
    );
  });

  it("logs and caches browser scrape failures without failing record processing", async () => {
    const launcher = {
      launch: vi.fn(async () => {
        throw new Error("browser unavailable");
      })
    };
    const logger = { info: vi.fn(), warn: vi.fn() };
    const repository = cacheRepository();

    const result = await collectResearch(
      { normalized: { name: "Closed Cafe", website: "https://example.com/" } },
      {
        config: config(),
        cacheRepository: repository,
        browserLauncher: launcher,
        logger,
        enabled: true
      }
    );

    expect(result).toMatchObject({
      status: "failed",
      error: { code: "RESEARCH_FETCH_FAILED" }
    });
    expect(repository.save).toHaveBeenCalledWith(
      "https://example.com/",
      expect.objectContaining({ status: "failed" }),
      60
    );
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ url: "https://example.com/", code: "RESEARCH_FETCH_FAILED" }),
      "Website research scrape failed"
    );
  });

  it("discovers a business email from a linked contact page and caches contact metadata", async () => {
    const { launcher } = createFakeBrowserLauncher({
      htmlByUrl: {
        "https://example.com/": `
          <html><head><title>Rendered Bistro</title></head>
          <body><a href="/contact-us">Contact us</a></body></html>`,
        "https://example.com/contact-us": `
          <html><head><title>Contact Rendered Bistro</title></head>
          <body><a href="mailto:hello@rendered.example">hello@rendered.example</a></body></html>`
      }
    });
    const logger = { info: vi.fn(), warn: vi.fn() };
    const repository = cacheRepository();

    const result = await collectResearch(
      { normalized: { name: "Rendered Bistro", website: "https://example.com/" } },
      {
        config: config(),
        cacheRepository: repository,
        browserLauncher: launcher,
        logger,
        enabled: true
      }
    );

    expect(result.contact).toMatchObject({
      primaryEmail: "hello@rendered.example",
      contactPage: "https://example.com/contact-us"
    });
    expect(repository.save).toHaveBeenCalledWith(
      "https://example.com/",
      expect.objectContaining({
        metadata: expect.objectContaining({
          contact: expect.objectContaining({ primaryEmail: "hello@rendered.example" })
        })
      }),
      60
    );
  });
});
