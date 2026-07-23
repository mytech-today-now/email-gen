import { expect, test } from "@playwright/test";

async function dismissWalkthrough(page) {
  await expect(page.getByTestId("status-line")).toContainText(
    /durable storage verified|temporary in-memory storage active|recovery required/,
    {
      timeout: 15_000
    }
  );
  const dialog = page.locator("#walkthroughDialog");
  if (await dialog.isVisible()) await page.locator("#walkthroughSkip").click();
}

async function importOneRecord(page) {
  await page.getByTestId("file-input").setInputFiles({
    name: "consented-prospect.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "id,name,city,website,email,phone,consentStatus,consentSource,consentTimestamp\n1,Example Bistro,Omaha,https://example.com/,owner@example.com,(402) 555-0199,opted-in,signup-form,2026-07-01T12:00:00Z\n"
    )
  });
  await expect(page.locator("#recordRows tr")).toHaveCount(1, { timeout: 15_000 });
  await expect(page.getByTestId("record-rows")).toContainText("Example Bistro", { timeout: 15_000 });
}

async function selectMockModel(page) {
  await page
    .getByRole("radio", { name: /from mock/i })
    .first()
    .check();
  await expect(page.locator("#selectedModelSummary")).toContainText(/mock/i);
}

async function seedBlockingOperation(page, scopeKey = "tab-test-blocker") {
  await page.evaluate(
    async ({ scopeKey }) => {
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open("ai-batch-personalizer", 5);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
      });
      const now = new Date().toISOString();
      await new Promise((resolve, reject) => {
        const transaction = db.transaction("operations", "readwrite");
        transaction.onerror = () => reject(transaction.error);
        transaction.oncomplete = () => resolve();
        transaction.objectStore("operations").put({
          scopeKey,
          operationId: "browser-op-seeded",
          kind: "process",
          status: "in-progress",
          leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
          ownerTabId: "seeded-other-tab",
          updatedAt: now,
          createdAt: now,
          revision: 0
        });
      });
      db.close();
    },
    { scopeKey }
  );
}

test("simultaneous tabs share one blocking operation state and stay blocked after reload", async ({
  page,
  context
}) => {
  test.slow();

  await page.goto("/");
  await dismissWalkthrough(page);
  await importOneRecord(page);
  await page.getByTestId("preview-button").click();
  await expect(page.getByTestId("prompt-preview")).toContainText("https://example.com/");
  await selectMockModel(page);
  await page.locator("#researchEnabled").uncheck();
  await expect(page.getByTestId("process-button")).toBeEnabled();

  const page2 = await context.newPage();
  try {
    await page2.goto("/");
    await dismissWalkthrough(page2);
    await expect(page2.locator("#recordRows tr")).toHaveCount(1, { timeout: 15_000 });
    await expect(page2.getByTestId("record-rows")).toContainText("Example Bistro", { timeout: 15_000 });
    await expect(page2.locator("#selectedModelSummary")).toContainText(/mock/i);
    await expect(page2.getByTestId("process-button")).toBeEnabled();

    await seedBlockingOperation(page);
    await expect(page.getByTestId("process-button")).toBeDisabled({ timeout: 10_000 });
    await expect(page2.getByTestId("process-button")).toBeDisabled({ timeout: 10_000 });

    await page2.reload();
    await dismissWalkthrough(page2);
    await expect(page2.getByTestId("process-button")).toBeDisabled({ timeout: 10_000 });
  } finally {
    await page2.close().catch(() => {});
  }
});
