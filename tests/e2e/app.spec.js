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
  await expect(modelSelect.locator('option[value="gpt-image-2"]')).toHaveJSProperty("disabled", true);

  await providerSelect.selectOption("anthropic");
  await expect(modelSelect.locator('option[value="claude-fable-5"]')).toHaveText("Claude Fable 5");

  await providerSelect.selectOption("xai");
  await expect(modelSelect.locator('option[value="grok-4.5"]')).toHaveText("Grok 4.5");

  await providerSelect.selectOption("venice");
  await expect(modelSelect.locator('option[value="llama-3.3-70b"]')).toHaveText("Llama 3.3 70B");
  await expect(modelSelect.locator('option[value="fluently-xl"]')).toHaveJSProperty("disabled", true);

  await providerSelect.selectOption("lumaai");
  await expect(modelSelect.locator('option[value="ray-3.2"]')).toHaveJSProperty("disabled", true);
  await expect(modelSelect.locator('option[value="ray-2"]')).toHaveJSProperty("disabled", true);

  await providerSelect.selectOption("mock");
  await expect(modelSelect.locator('option[value="mock-structured-v1"]')).toHaveText("Mock Structured v1");
});

test("falls back gracefully when the project API is unavailable", async ({ page }) => {
  await page.route("**/api/projects", (route) =>
    route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({
        error: { code: "ROUTE_NOT_FOUND", message: "Route not found.", requestId: "req_test" }
      })
    })
  );

  await page.goto("/");
  await expect(page.getByTestId("project-select")).toHaveValue("legacy_current");
  await expect(page.getByTestId("project-select")).toContainText("Current Data");
  await expect(page.getByTestId("status-line")).toContainText(/records|results/);

  await page.getByTestId("load-sample").click();
  await expect(page.getByTestId("record-rows")).toContainText("Acadian Grille & Bar");
  await expect(page.getByTestId("project-select")).toContainText("Current Data");
});

test("complete mock workflow", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/");
  await expect(page.getByTestId("status-line")).toContainText(/records|Starting|results/);
  await page.getByTestId("load-sample").click();
  await expect(page.getByTestId("record-rows")).toContainText("Acadian Grille & Bar");
  await page.getByTestId("preview-button").click();
  await expect(page.getByTestId("prompt-preview")).toContainText("https://acadiangrille.com/");
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
  await page.getByTestId("delivery-profile-select").selectOption("mailchimp");
  await page.getByTestId("export-delivery-selected").click();
  await expect(page.getByTestId("status-line")).toContainText("Select one or more completed results first.");
  const completedRow = page.getByTestId("result-rows").locator("tr", { hasText: "Saved e2e subject" });
  await completedRow.click();
  await expect(completedRow.locator(".result-check")).toBeChecked();
  await page.getByTestId("export-delivery-selected").click();
  await expect(page.getByTestId("status-line")).toContainText(/Delivery kit exported: delivery-mailchimp/);
  await page.getByTestId("delivery-profile-select").selectOption("email-clients");
  await page.getByTestId("export-delivery-all").click();
  await expect(page.getByTestId("status-line")).toContainText(
    /Delivery kit exported: delivery-email-clients/
  );
});

test("clicking a generated result row updates the editable selected result", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("load-sample").click();
  await expect(page.getByTestId("record-rows")).toContainText("Acadian Grille & Bar");
  await page.getByTestId("provider-select").selectOption("mock");
  await page.locator("#researchEnabled").uncheck();
  await page.getByTestId("process-all").click();
  await expect(page.getByTestId("result-rows").locator("tr")).toHaveCount(4, { timeout: 15000 });

  const tomoRow = page.getByTestId("result-rows").locator("tr", { hasText: "Tomo Sushi & Ramen" });
  await tomoRow.click();
  await expect(tomoRow).toHaveClass(/is-active/);
  await expect(tomoRow.locator(".result-check")).toBeChecked();
  await expect(page.getByTestId("subject-input")).toHaveValue(/Tomo Sushi & Ramen/);
  await expect(page.getByTestId("body-input")).toHaveValue(/Tomo Sushi & Ramen/);
  await expect(page.getByTestId("selected-contact")).toContainText(/No email|@|contact/i);
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
