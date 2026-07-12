import { expect, test } from "@playwright/test";

test("renders expanded provider and model catalog", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("model-sync-summary")).toContainText(/catalog|success|fallback/i);
  await expect(page.getByTestId("model-catalog-rows")).toContainText("mock-structured-v1");
  await expect(page.getByTestId("model-sync-button")).toBeVisible();
  const providerSelect = page.getByTestId("provider-select");
  const modelSelect = page.getByTestId("model-select");

  await expect(providerSelect).toHaveValue("mock");
  const providerIds = await providerSelect
    .locator("option")
    .evaluateAll((options) => options.map((option) => option.value));
  expect(providerIds).toEqual(["openai", "anthropic", "xai", "venice", "lumaai", "custom", "mock"]);

  await providerSelect.selectOption("openai");
  await expect(modelSelect.locator('option[value="gpt-5.6-sol"]')).toHaveText("GPT-5.6 Sol");
  await expect(modelSelect.locator('option[value="gpt-image-2"]')).toBeDisabled();

  await providerSelect.selectOption("anthropic");
  await expect(modelSelect.locator('option[value="claude-fable-5"]')).toHaveText("Claude Fable 5");

  await providerSelect.selectOption("xai");
  await expect(modelSelect.locator('option[value="grok-4.5"]')).toHaveText("Grok 4.5");

  await providerSelect.selectOption("venice");
  await expect(modelSelect.locator('option[value="llama-3.3-70b"]')).toHaveText("Llama 3.3 70B");
  await expect(modelSelect.locator('option[value="fluently-xl"]')).toBeDisabled();

  await providerSelect.selectOption("lumaai");
  await expect(modelSelect.locator('option[value="ray-3.2"]')).toBeDisabled();
  await expect(modelSelect.locator('option[value="ray-2"]')).toBeDisabled();

  await providerSelect.selectOption("mock");
  await expect(modelSelect.locator('option[value="mock-structured-v1"]')).toHaveText("Mock Structured v1");
});

test("complete mock workflow", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/");
  await expect(page.getByTestId("status-line")).toContainText(/records|Starting|results/);
  await page.getByTestId("load-sample").click();
  await expect(page.getByTestId("record-rows")).toContainText("Acadian Grille & Bar");
  await page.getByTestId("preview-button").click();
  await expect(page.getByTestId("prompt-preview")).toContainText("Acadian Grille & Bar");
  await page.getByTestId("provider-select").selectOption("mock");
  await page.locator("#researchEnabled").uncheck();
  await page.getByTestId("process-current").click();
  await expect(page.getByTestId("job-summary")).toContainText(/completed|running/, { timeout: 10000 });
  await expect(page.getByTestId("result-rows")).toContainText("completed", { timeout: 10000 });
  await page.getByTestId("subject-input").fill("Saved e2e subject");
  await page.getByTestId("body-input").fill("<p>Saved e2e body</p>");
  await page.getByTestId("save-edit").click();
  await expect(page.getByTestId("status-line")).toContainText("Edits saved");
  await page.reload();
  await expect(page.getByTestId("result-rows")).toContainText("Saved e2e subject");
  await page.getByTestId("copy-subject").click();
  await expect(page.getByTestId("status-line")).toContainText("Subject copied");
  await page.getByTestId("export-all").click();
  await expect(page.getByTestId("status-line")).toContainText(/Exported/);
});

test("processes a restaurant with browser-backed research enabled", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("file-input").setInputFiles({
    name: "research-restaurant.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("id,name,city,website\n1,Example Bistro,Omaha,https://example.com/\n")
  });
  await expect(page.getByTestId("record-rows")).toContainText("Example Bistro");
  await page.getByTestId("provider-select").selectOption("mock");
  await page.locator("#researchEnabled").check();
  await page.getByTestId("process-current").click();
  await expect(page.getByTestId("job-summary")).toContainText(/completed|running/, { timeout: 15000 });
  await expect(page.getByTestId("result-rows")).toContainText("Example Bistro", { timeout: 15000 });
  await page.getByTestId("result-rows").getByRole("button", { name: "Example Bistro" }).click();
  await page.getByText("Rendered prompt and research").click();
  await expect(page.getByTestId("result-prompt")).toContainText('"status": "ok"', { timeout: 10000 });
  await expect(page.getByTestId("result-prompt")).toContainText("Example Domain");
});
