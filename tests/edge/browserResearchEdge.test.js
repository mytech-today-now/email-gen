import { describe, expect, it, vi } from "vitest";
import { loadAppConfig } from "../../config/app.config.js";
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
});
