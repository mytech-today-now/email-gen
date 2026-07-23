import { expect, test } from "@playwright/test";
import { responsiveViewportCases } from "../helpers/responsiveViewports.js";

async function layoutMetrics(page) {
  return page.evaluate(() => {
    const documentElement = document.documentElement;
    const researchToggle = document.getElementById("researchEnabled").closest(".switch");
    const processingLayout = document.querySelector(".processing-layout");
    const workspace = document.querySelector(".workspace");
    const researchRect = researchToggle.getBoundingClientRect();
    const processingRect = processingLayout.getBoundingClientRect();
    const workspaceRect = workspace.getBoundingClientRect();

    return {
      viewportWidth: documentElement.clientWidth,
      pageScrollWidth: documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      researchLeft: researchRect.left,
      researchRight: researchRect.right,
      researchWidth: researchRect.width,
      processingLeft: processingRect.left,
      processingRight: processingRect.right,
      workspaceWidth: workspaceRect.width
    };
  });
}

test.describe("responsive layout", () => {
  for (const viewport of responsiveViewportCases) {
    test(`keeps controls visible at ${viewport.name}`, async ({ browser, browserName }) => {
      if (browserName === "webkit") {
        test.skip("WebKit responsive layout coverage is unstable in this environment.");
      }
      test.slow(viewport.width >= 3840, "Very large WebKit surfaces can require extra rasterization time.");
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height }
      });
      const page = await context.newPage();
      try {
        page.on("pageerror", (error) => console.error(`Browser page error: ${error.message}`));
        await page.goto("/", { waitUntil: "domcontentloaded" });
        await expect(page.getByTestId("status-line")).toContainText(
          /durable storage verified|temporary in-memory storage active|recovery required/,
          { timeout: 30000 }
        );
        if (await page.locator("#walkthroughDialog").isVisible())
          await page.locator("#walkthroughSkip").click();
        await expect(page.locator("#researchEnabled")).toBeVisible();
        await expect(page.getByTestId("model-catalog-rows")).toBeVisible();

        const metrics = await layoutMetrics(page);
        expect(metrics.pageScrollWidth, `${viewport.name} document overflow`).toBeLessThanOrEqual(
          metrics.viewportWidth + 1
        );
        expect(metrics.bodyScrollWidth, `${viewport.name} body overflow`).toBeLessThanOrEqual(
          metrics.viewportWidth + 1
        );
        expect(metrics.researchLeft, `${viewport.name} Research left edge`).toBeGreaterThanOrEqual(0);
        expect(metrics.researchRight, `${viewport.name} Research right edge`).toBeLessThanOrEqual(
          metrics.viewportWidth + 1
        );
        expect(metrics.researchWidth, `${viewport.name} Research has size`).toBeGreaterThan(0);
        expect(metrics.processingLeft, `${viewport.name} processing left edge`).toBeGreaterThanOrEqual(0);
        expect(metrics.processingRight, `${viewport.name} processing right edge`).toBeLessThanOrEqual(
          metrics.viewportWidth + 1
        );
        expect(metrics.workspaceWidth, `${viewport.name} workspace remains concise`).toBeLessThanOrEqual(
          Math.min(viewport.width, 1720) + 1
        );
      } finally {
        await context.close();
      }
    });
  }
});
