import { expect, test } from "@playwright/test";

async function dismissWalkthrough(page) {
  await expect
    .poll(
      async () => {
        const text = ((await page.getByTestId("status-line").textContent()) || "").trim();
        return text && !/^Starting(?:\.{3}|…)?$/i.test(text);
      },
      { timeout: 30_000 }
    )
    .toBeTruthy();
  const dialog = page.locator("#walkthroughDialog");
  if (await dialog.isVisible()) await page.locator("#walkthroughSkip").click();
}

async function importProviderBatchRecords(page) {
  await page.getByTestId("file-input").setInputFiles({
    name: "provider-batch-prospects.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      [
        "id,name,city,website,email,phone,consentStatus,consentSource,consentTimestamp",
        "1,Provider Batch Alpha,Omaha,https://alpha.example/,alpha@example.com,(402) 555-0101,opted-in,signup-form,2026-07-01T12:00:00Z",
        "2,Provider Batch Bravo,Lincoln,https://bravo.example/,bravo@example.com,(402) 555-0102,opted-in,signup-form,2026-07-01T12:05:00Z"
      ].join("\n")
    )
  });
  await expect
    .poll(
      async () => {
        const text = ((await page.getByTestId("record-rows").textContent()) || "").trim();
        return text.includes("Provider Batch Alpha") && text.includes("Provider Batch Bravo");
      },
      { timeout: 20_000 }
    )
    .toBeTruthy();
}

async function selectOpenAiBatchModel(page) {
  await page.getByRole("radio", { name: /gpt-5\.6 sol.*openai/i }).check();
  await expect(page.locator("#selectedModelSummary")).toContainText("openai / GPT-5.6 Sol");
  await expect(page.locator("#selectedModelSummary")).toContainText(/provider batch 50% lower/i);
}

test.beforeEach(async ({ page }) => {
  page.on("pageerror", (error) => console.error(`Browser page error: ${error.message}`));
  await page.goto("/");
  await dismissWalkthrough(page);
});

test("explains why provider-batch processing is disabled until a model is chosen", async ({ page }) => {
  await importProviderBatchRecords(page);
  await expect(page.locator("#processButton")).toBeDisabled();
  await expect(page.getByTestId("process-button-hint")).toContainText(
    "Choose a compatible model before starting."
  );

  await selectOpenAiBatchModel(page);
  await expect(page.locator("#processButton")).toBeEnabled();
  await expect(page.getByTestId("process-button-hint")).toContainText("Ready to process 1 record.");
});

test("provider-batch processing survives reload and completes in the browser flow", async ({ page }) => {
  test.slow();
  await importProviderBatchRecords(page);
  await selectOpenAiBatchModel(page);
  await page.locator("#processingScope").selectOption("all");
  await page.getByTestId("execution-mode-select").selectOption("provider-batch");
  await expect(page.locator("#executionModeSummary")).toContainText("Execution mode: Provider Batch");
  await expect(page.locator("#batchCostEstimate")).toContainText(/Estimated provider-batch cost/i);

  await page.locator("#researchEnabled").uncheck();
  await page.getByTestId("process-button").click();

  await expect(page.getByTestId("status-line")).toContainText(
    "Submitted for 2 records on openai provider batch."
  );
  await expect(page.getByTestId("result-rows")).toContainText("processing");
  await expect(page.locator("#stopButton")).toBeVisible();

  await page.reload();
  await dismissWalkthrough(page);

  await expect
    .poll(
      async () => {
        const text = ((await page.getByTestId("status-line").textContent()) || "").trim();
        return (
          /Resuming provider batch monitoring/i.test(text) ||
          /^Submitted · 0 completed · 0 failed · .*This tab$/i.test(text) ||
          /^Job completed: 2 completed, 0 failed, 0 stopped\.$/i.test(text)
        );
      },
      { timeout: 15_000 }
    )
    .toBeTruthy();
  await expect(page.getByTestId("result-rows")).toContainText("completed", {
    timeout: 15_000
  });
  await expect(page.locator("#stopButton")).toBeHidden();
  await expect(page.locator("#resultRows tr")).toHaveCount(2);
  await expect(page.getByTestId("provider-batch-operation-rows")).toContainText("Completed");

  await page.locator("#resultRows tr").first().getByRole("button").first().click();
  await expect(page.getByTestId("subject-input")).toHaveValue(/Provider batch result/);

  await page.reload();
  await dismissWalkthrough(page);
  await expect(page.getByTestId("result-rows")).toContainText("Provider batch result 1");
  await expect(page.getByTestId("result-rows")).toContainText("Provider batch result 2");
});
