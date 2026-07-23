import { expect, test } from "@playwright/test";
import { resolveTestCredential } from "../../src/security/testCredentialResolver.js";

test.use({ trace: "off", screenshot: "off", video: "off" });

const TEXT_PROVIDERS = [
  {
    id: "openai",
    inputId: "#openaiKeySetting",
    statusId: "#openaiCredentialStatus",
    testButtonId: "#testOpenaiCredentialButton",
    clearButtonId: "#clearOpenaiCredentialButton"
  },
  {
    id: "anthropic",
    inputId: "#anthropicKeySetting",
    statusId: "#anthropicCredentialStatus",
    testButtonId: "#testAnthropicCredentialButton",
    clearButtonId: "#clearAnthropicCredentialButton"
  },
  {
    id: "xai",
    inputId: "#xaiKeySetting",
    statusId: "#xaiCredentialStatus",
    testButtonId: "#testXaiCredentialButton",
    clearButtonId: "#clearXaiCredentialButton"
  },
  {
    id: "venice",
    inputId: "#veniceKeySetting",
    statusId: "#veniceCredentialStatus",
    testButtonId: "#testVeniceCredentialButton",
    clearButtonId: "#clearVeniceCredentialButton"
  }
];

const LUMA_PROVIDER = {
  id: "lumaai",
  inputId: "#lumaaiKeySetting",
  statusId: "#lumaaiCredentialStatus",
  clearButtonId: "#clearLumaaiCredentialButton"
};

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function dismissWalkthrough(page) {
  await expect(page.locator("#statusLine")).toContainText(
    /durable storage verified|temporary in-memory storage active|recovery required/,
    { timeout: 15_000 }
  );
  const dialog = page.locator("#walkthroughDialog");
  if (await dialog.isVisible()) await page.locator("#walkthroughSkip").click();
}

async function importOneRecord(page) {
  await page.locator("#fileInput").setInputFiles({
    name: "live-prospect.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "id,name,city,website,email,phone,consentStatus,consentSource,consentTimestamp\n1,Live Example Bistro,Omaha,https://example.com/,owner@example.com,(402) 555-0199,opted-in,signup-form,2026-07-01T12:00:00Z\n"
    )
  });
  await expect(page.locator("#recordRows")).toContainText("Live Example Bistro");
}

async function openConfiguration(page) {
  await page.locator("#configurationButton").click();
  await expect(page.locator("#configurationDialog")).toBeVisible();
}

async function saveCredentialThroughUi(page, provider, credential) {
  await openConfiguration(page);
  await page.locator(provider.inputId).fill(credential);
  await page.locator("#applyConfigurationButton").click();
  await expect(page.locator(provider.statusId)).toContainText(/Configured|Valid/);
  await expect(page.locator(provider.inputId)).toHaveValue("");
}

async function clearCredentialThroughUi(page, provider) {
  await openConfiguration(page);
  await page.locator(provider.clearButtonId).click();
  await expect(page.locator(provider.statusId)).toContainText("Not configured");
  await page.locator("#configurationCloseButton").click();
}

async function selectStructuredModel(request, page, providerId) {
  const response = await request.get("/api/config");
  const payload = await response.json();
  const provider = payload.ai.providers.find((item) => item.id === providerId);
  const model = provider?.models?.find((item) => (item.capabilities ?? []).includes("structured"));
  if (!model) test.skip(true, `${providerId} has no structured model available for live testing.`);
  await page
    .getByRole("radio", {
      name: new RegExp(`Select ${escapeRegex(model.label || model.id)} from ${escapeRegex(providerId)}`, "i")
    })
    .check();
  await expect(page.locator("#selectedModelSummary")).toContainText(providerId);
}

test.beforeEach(async ({ page }) => {
  test.skip(process.env.RUN_LIVE_E2E !== "true", "Live E2E is gated behind RUN_LIVE_E2E=true.");
  page.on("pageerror", () => {});
  await page.goto("/");
  await dismissWalkthrough(page);
});

for (const provider of TEXT_PROVIDERS) {
  test(`@live configures, validates, uses, and clears ${provider.id} through the real UI`, async ({
    page,
    request
  }) => {
    const resolved = await resolveTestCredential(provider.id).catch(() => ({
      available: false,
      source: "unavailable"
    }));
    test.skip(!resolved.available, `${provider.id} live credential is unavailable.`);

    await saveCredentialThroughUi(page, provider, resolved.value);
    await page.locator(provider.testButtonId).click();
    await expect(page.locator(provider.statusId)).toContainText("Valid");
    await page.locator("#configurationCloseButton").click();

    await importOneRecord(page);
    await selectStructuredModel(request, page, provider.id);
    await page.locator("#researchEnabled").uncheck();
    await page.locator("#processButton").click();
    await expect(page.locator("#resultRows")).toContainText("completed", { timeout: 30_000 });
    await expect(page.locator("#subjectInput")).not.toHaveValue("");

    await clearCredentialThroughUi(page, provider);
  });
}

test("@live configures and clears Luma AI through the UI without starting paid generation", async ({
  page
}) => {
  const resolved = await resolveTestCredential(LUMA_PROVIDER.id).catch(() => ({
    available: false,
    source: "unavailable"
  }));
  test.skip(!resolved.available, "lumaai live credential is unavailable.");

  await saveCredentialThroughUi(page, LUMA_PROVIDER, resolved.value);
  await clearCredentialThroughUi(page, LUMA_PROVIDER);
});

test("@live configures, validates, uses, and clears a custom OpenAI-compatible provider through the real UI", async ({
  page,
  request
}) => {
  const resolved = await resolveTestCredential("custom").catch(() => ({
    available: false,
    source: "unavailable"
  }));
  const baseUrl = String(process.env.EMAIL_GEN_E2E_CUSTOM_BASE_URL ?? "").trim();
  test.skip(!resolved.available, "custom live credential is unavailable.");
  test.skip(!baseUrl, "custom live base URL is unavailable.");

  await openConfiguration(page);
  await page.locator("#customBaseUrlSetting").fill(baseUrl);
  await page.locator("#confirmCustomProviderHost").check();
  await page.locator("#customKeySetting").fill(resolved.value);
  await page.locator("#applyConfigurationButton").click();
  await expect(page.locator("#customCredentialStatus")).toContainText(/Configured|Valid/);
  await page.locator("#testCustomCredentialButton").click();
  await expect(page.locator("#customCredentialStatus")).toContainText("Valid");
  await page.locator("#configurationCloseButton").click();

  await importOneRecord(page);
  await selectStructuredModel(request, page, "custom");
  await page.locator("#researchEnabled").uncheck();
  await page.locator("#processButton").click();
  await expect(page.locator("#resultRows")).toContainText("completed", { timeout: 30_000 });
  await clearCredentialThroughUi(page, {
    id: "custom",
    inputId: "#customKeySetting",
    statusId: "#customCredentialStatus",
    clearButtonId: "#clearCustomCredentialButton"
  });
});
