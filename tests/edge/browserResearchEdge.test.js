import { describe, expect, it, vi } from "vitest";
import { loadAppConfig } from "../../config/app.config.js";
import { collectResearch } from "../../src/research/researchService.js";
import { fetchWebsite } from "../../src/research/websiteFetcher.js";
import { createFakeBrowserLauncher, createFakeRoute } from "../helpers/fakeBrowserLauncher.js";

function researchConfig(overrides = {}) {
  const base = loadAppConfig();
  return loadAppConfig({
    research: {
      ...base.research,
      enabled: true,
      timeoutMs: 1000,
      responseBytes: 1000,
      renderDelayMs: 0,
      ...overrides
    }
  });
}

describe("headless browser research edge cases", () => {
  it("blocks private restaurant URLs before launching Chrome", async () => {
    const launcher = { launch: vi.fn() };
    await expect(
      fetchWebsite("http://127.0.0.1:3000/menu", {
        config: researchConfig(),
        browserLauncher: launcher
      })
    ).rejects.toMatchObject({ code: "SSRF_BLOCKED" });
    expect(launcher.launch).not.toHaveBeenCalled();
  });

  it("aborts private browser subresource requests during scraping", async () => {
    const privateRoute = createFakeRoute({ url: "http://127.0.0.1/private.js" });
    const logger = { warn: vi.fn() };
    const { launcher } = createFakeBrowserLauncher({
      onGoto: async ({ routeHandler }) => {
        await routeHandler(privateRoute);
      }
    });

    await fetchWebsite("https://example.com/", {
      config: researchConfig(),
      browserLauncher: launcher,
      logger
    });

    expect(privateRoute.abort).toHaveBeenCalledWith("blockedbyclient");
    expect(privateRoute.continue).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ requestUrl: "http://127.0.0.1/private.js" }),
      "Blocked unsafe browser research request"
    );
  });

  it("fails oversized rendered pages with a bounded response error", async () => {
    const { launcher } = createFakeBrowserLauncher({
      html: `<html><body>${"x".repeat(2000)}</body></html>`
    });

    await expect(
      fetchWebsite("https://example.com/", {
        config: researchConfig({ responseBytes: 128 }),
        browserLauncher: launcher
      })
    ).rejects.toMatchObject({ code: "RESEARCH_RESPONSE_TOO_LARGE", status: 413 });
  });

  it("keeps processing usable when a discovered contact page cannot be fetched", async () => {
    const launcher = {
      launch: vi
        .fn()
        .mockResolvedValueOnce({
          newContext: vi.fn(async () => ({
            route: vi.fn(async () => {}),
            newPage: vi.fn(async () => ({
              goto: vi.fn(async () => ({
                status: () => 200,
                headers: () => ({ "content-type": "text/html" }),
                request: () => ({ redirectedFrom: () => null })
              })),
              url: vi.fn(() => "https://example.com/"),
              waitForTimeout: vi.fn(async () => {}),
              content: vi.fn(async () => '<a href="/contact">Contact</a><p>No email here.</p>')
            })),
            close: vi.fn(async () => {})
          })),
          close: vi.fn(async () => {})
        })
        .mockRejectedValueOnce(new Error("contact page unavailable"))
    };
    const logger = { info: vi.fn(), warn: vi.fn() };

    const result = await collectResearch(
      { normalized: { name: "Fallback Cafe", website: "https://example.com/" } },
      { config: researchConfig({ responseBytes: 12000 }), browserLauncher: launcher, logger, enabled: true }
    );

    expect(result.status).toBe("ok");
    expect(result.contact.contactPage).toBe("https://example.com/contact");
    expect(result.contact.primaryEmail).toBe("");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ url: "https://example.com/contact" }),
      "Contact page research scrape failed"
    );
  });
});
