import { expect, test } from "@playwright/test";
import { responsiveViewportCases } from "../helpers/responsiveViewports.js";

async function layoutMetrics(page) {
  return page.evaluate(() => {
    const documentElement = document.documentElement;
    const researchToggle = [...document.querySelectorAll(".switch")].find((item) =>
      item.textContent.includes("Research")
    );
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
    test(`keeps controls visible at ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto("/");
      await expect(page.locator(".switch", { hasText: "Research" })).toBeVisible();
      await expect(page.getByTestId("provider-select")).toBeVisible();
      await expect(page.getByTestId("model-select")).toBeVisible();

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
    });
  }
});
