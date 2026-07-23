import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { unzipSync, strFromU8 } from "fflate";

async function dismissWalkthrough(page, timeout = 30_000, browserName = "chromium") {
  if (browserName === "webkit") {
    await expect(page.locator("#saveAsTemplateButton")).toBeVisible({ timeout });
  } else {
    const statusLine = page.getByTestId("status-line");
    await expect(statusLine).toContainText(
      /durable storage verified|temporary in-memory storage active|recovery required/,
      {
        timeout
      }
    );
  }
  const dialog = page.locator("#walkthroughDialog");
  if (await dialog.isVisible()) await page.locator("#walkthroughSkip").click();
}

async function selectMockModel(page) {
  await page
    .getByRole("radio", { name: /from mock/i })
    .first()
    .check();
  await expect(page.locator("#selectedModelSummary")).toContainText(/mock/i);
}

async function importOneRecord(page) {
  await page.getByTestId("file-input").setInputFiles({
    name: "consented-prospect.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "id,name,city,website,email,phone,consentStatus,consentSource,consentTimestamp\n1,Example Bistro,Omaha,https://example.com/,owner@example.com,(402) 555-0199,opted-in,signup-form,2026-07-01T12:00:00Z\n"
    )
  });
  await expect(page.getByTestId("record-rows")).toContainText("Example Bistro");
}

async function panelHeight(page, selector) {
  return page.locator(selector).evaluate((node) => Math.round(node.getBoundingClientRect().height));
}

async function dragResizeHandle(page, selector, deltaY) {
  await page.locator(selector).evaluate((handle, dragDelta) => {
    const box = handle.getBoundingClientRect();
    const startY = box.top + box.height / 2;
    const pointerId = 41;
    handle.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        pointerId,
        pointerType: "mouse",
        buttons: 1,
        clientY: startY
      })
    );
    window.dispatchEvent(
      new PointerEvent("pointermove", {
        bubbles: true,
        pointerId,
        pointerType: "mouse",
        buttons: 1,
        clientY: startY + dragDelta
      })
    );
    window.dispatchEvent(
      new PointerEvent("pointerup", {
        bubbles: true,
        pointerId,
        pointerType: "mouse",
        clientY: startY + dragDelta
      })
    );
  }, deltaY);
}

test.describe.configure({ timeout: 240_000 });

test.beforeEach(async ({ page, browserName }) => {
  page.on("pageerror", (error) => console.error(`Browser page error: ${error.message}`));
  if (browserName === "webkit") {
    const started = page.waitForEvent("console", {
      predicate: (message) => message.text().includes("browser_application_started"),
      timeout: 120_000
    });
    await page.goto("/", { waitUntil: "load" });
    await started;
  } else {
    await page.goto("/", { waitUntil: "domcontentloaded" });
  }
  await dismissWalkthrough(page, browserName === "webkit" ? 120_000 : 30_000, browserName);
});

test("catalog-only selection, dynamic columns, and all split panes are keyboard operable", async ({
  page
}) => {
  await page.getByTestId("load-sample").click();
  await expect(page.locator("#recordHeaderRows")).toContainText(/website/i);
  await expect(page.locator("#recordHeaderRows .prompt-column")).not.toHaveCount(0);
  await selectMockModel(page);
  await expect(page.getByTestId("execution-mode-select")).toHaveValue("auto");

  for (const split of ["dataSplit", "catalogSplit", "resultsSplit"]) {
    const separator = page.locator(`#${split} .split-separator[role="separator"]`);
    const before = Number(await separator.getAttribute("aria-valuenow"));
    await separator.focus();
    await separator.press("ArrowRight");
    expect(Number(await separator.getAttribute("aria-valuenow"))).toBeGreaterThan(before);
    await separator.press("Shift+ArrowLeft");
    await separator.press("Home");
    expect(Number(await separator.getAttribute("aria-valuenow"))).toBe(
      Number(await separator.getAttribute("aria-valuemin"))
    );
    await separator.press("Control+Enter");
  }
});

test("complete browser-persistent mock workflow and real completed ZIP download", async ({
  page,
  context,
  browserName
}, testInfo) => {
  test.slow();
  page.on("dialog", (dialog) => dialog.accept());
  await context.grantPermissions(["clipboard-read", "clipboard-write"]).catch(() => {});
  await importOneRecord(page);
  await page.getByTestId("preview-button").click();
  await expect(page.getByTestId("prompt-preview")).toContainText("https://example.com/");
  await selectMockModel(page);
  await page.locator("#researchEnabled").uncheck();
  await page.getByTestId("process-button").click();
  await expect(page.getByTestId("result-rows")).toContainText("completed", { timeout: 30_000 });
  await expect(page.getByTestId("subject-input")).toHaveValue(/Example Bistro/);
  const selectedResult = page.locator(".selected-result");
  await expect(selectedResult.locator(".result-actions")).toHaveCount(1);
  const toolbarOrder = await page.evaluate(() => {
    const heading = document.getElementById("activeResultHeading");
    const actions = document.querySelector(".selected-result .result-actions");
    const metadata = document.getElementById("activeResultMetadata");
    return {
      headingBeforeActions:
        Boolean(heading && actions) &&
        Boolean(heading.compareDocumentPosition(actions) & Node.DOCUMENT_POSITION_FOLLOWING),
      actionsBeforeMetadata:
        Boolean(actions && metadata) &&
        Boolean(actions.compareDocumentPosition(metadata) & Node.DOCUMENT_POSITION_FOLLOWING)
    };
  });
  expect(toolbarOrder.headingBeforeActions).toBe(true);
  expect(toolbarOrder.actionsBeforeMetadata).toBe(true);
  await expect(page.getByTestId("body-input")).toHaveValue(/<!-- Subject:/);
  await expect(page.getByTestId("body-input")).toHaveValue(/<table role="presentation"/);
  await expect(page.locator("#visualPreviewState")).toContainText("Rendered HTML preview updated.");
  await expect(page.locator("#visualEditorHost .canvas")).toContainText("Would a quick demo be useful?");

  await expect(page.locator("#rawEditorPane")).toBeVisible();
  await expect(page.locator("#visualEditorPane")).toBeVisible();
  const visual = page.locator("#visualEditorHost .canvas");
  await visual.click();
  await visual.press("Control+End");
  await visual.pressSequentially(" Visual edit.");
  await expect(page.getByTestId("body-input")).toHaveValue(/Visual edit/);
  await page.getByTestId("subject-input").fill("Saved browser subject");
  await page.getByTestId("save-edit").click();
  await expect(page.getByTestId("status-line")).toContainText("recoverable version");

  const primaryContactLink = page.locator("#selectedContactValue a");
  await expect(primaryContactLink).toContainText("owner@example.com");
  const primaryHref = await primaryContactLink.getAttribute("href");
  const primaryParams = new URLSearchParams((primaryHref || "").split("?")[1] || "");
  expect(primaryHref).toContain("mailto:owner@example.com?");
  expect(primaryParams.get("subject")).toBe("Saved browser subject");
  expect(primaryParams.get("body")).toContain("Visual edit.");

  const emailCandidate = page.locator("#contactCandidateList li").filter({ hasText: "owner@example.com" });
  const emailCandidateLink = emailCandidate.locator("a").first();
  await expect(emailCandidateLink).toHaveText("owner@example.com");
  const emailHref = await emailCandidateLink.getAttribute("href");
  const emailParams = new URLSearchParams((emailHref || "").split("?")[1] || "");
  expect(emailHref).toContain("mailto:owner@example.com?");
  expect(emailParams.get("subject")).toBe("Saved browser subject");
  expect(emailParams.get("body")).toContain("Visual edit.");
  await emailCandidate.getByTestId("contact-candidate-copy").click();
  await expect(page.getByTestId("status-line")).toContainText("Email link copied");

  const websiteCandidate = page
    .locator("#contactCandidateList li")
    .filter({ has: page.locator('a[href="https://example.com/"]') });
  await expect(websiteCandidate.locator('a[href="https://example.com/"]')).toHaveText("https://example.com/");
  await websiteCandidate.getByTestId("contact-candidate-copy").click();
  await expect(page.getByTestId("status-line")).toContainText("Link copied");
  if (browserName !== "webkit") {
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe("https://example.com/");
  }

  await page.locator("#copyEmailButton").click();
  await expect(page.getByTestId("status-line")).toContainText("Email address copied");

  await page.getByTestId("export-all").click();
  const downloadPromise = page.waitForEvent("download", { timeout: 120_000 });
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("email-exports.zip");
  await download.saveAs(testInfo.outputPath(download.suggestedFilename()));

  await page.reload();
  await dismissWalkthrough(page);
  await expect(page.getByTestId("result-rows")).toContainText("Saved browser subject");
});

test("raw and rendered editor panels resize, persist, and recover from malformed HTML", async ({ page }) => {
  test.slow();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await importOneRecord(page);
  await selectMockModel(page);
  await page.locator("#researchEnabled").uncheck();
  await page.getByTestId("process-button").click();
  await expect(page.getByTestId("result-rows")).toContainText("completed", { timeout: 30_000 });
  await expect(page.locator("#rawEditorPane")).toBeVisible();
  await expect(page.locator("#visualEditorPane")).toBeVisible();

  const rawBefore = await panelHeight(page, "#rawEditorPane");
  await dragResizeHandle(page, '[data-testid="raw-resize-handle"]', 90);
  await expect.poll(async () => panelHeight(page, "#rawEditorPane")).toBeGreaterThan(rawBefore + 40);
  const rawExpandedFromDefault = await panelHeight(page, "#rawEditorPane");
  await page.locator("#rawCollapseButton").click();
  const rawCollapsed = await panelHeight(page, "#rawEditorPane");
  expect(rawCollapsed).toBeLessThan(rawExpandedFromDefault);
  await dragResizeHandle(page, '[data-testid="raw-resize-handle"]', 110);
  await expect.poll(async () => panelHeight(page, "#rawEditorPane")).toBeGreaterThan(rawCollapsed + 50);

  await page.locator("#rawExpandButton").click();
  const rawExpanded = await panelHeight(page, "#rawEditorPane");
  expect(rawExpanded).toBeGreaterThan(rawCollapsed);

  await page.locator('[data-testid="raw-resize-handle"]').focus();
  await page.keyboard.press("Home");
  const rawKeyboardCollapsed = await panelHeight(page, "#rawEditorPane");
  expect(rawKeyboardCollapsed).toBeLessThan(rawExpanded);
  await page.keyboard.press("End");
  const rawKeyboardExpanded = await panelHeight(page, "#rawEditorPane");
  expect(rawKeyboardExpanded).toBeGreaterThan(rawKeyboardCollapsed);

  const visualBefore = await panelHeight(page, "#visualEditorPane");
  await page.locator("#visualCollapseButton").click();
  const visualCollapsed = await panelHeight(page, "#visualEditorPane");
  expect(visualCollapsed).toBeLessThan(visualBefore);
  await dragResizeHandle(page, '[data-testid="visual-resize-handle"]', 120);
  await expect.poll(async () => panelHeight(page, "#visualEditorPane")).toBeGreaterThan(visualCollapsed + 50);
  await page.locator("#visualExpandButton").click();
  const visualExpanded = await panelHeight(page, "#visualEditorPane");
  expect(visualExpanded).toBeGreaterThan(visualCollapsed);
  await page.locator('[data-testid="visual-resize-handle"]').focus();
  await page.keyboard.press("Home");
  const visualKeyboardCollapsed = await panelHeight(page, "#visualEditorPane");
  expect(visualKeyboardCollapsed).toBeLessThan(visualExpanded);
  await page.keyboard.press("End");
  const visualKeyboardExpanded = await panelHeight(page, "#visualEditorPane");
  expect(visualKeyboardExpanded).toBeGreaterThan(visualKeyboardCollapsed);

  await page.locator("#rawCollapseButton").click();
  await page.locator("#visualCollapseButton").click();
  const longHtml = Array.from(
    { length: 220 },
    (_, index) => `<p>Row ${index + 1} for scroll testing.</p>`
  ).join("\n");
  await page.getByTestId("body-input").fill(`<section><h1>Rendered preview</h1>${longHtml}</section>`);
  const visual = page.locator("#visualEditorHost .canvas");
  const visualHost = page.locator("#visualEditorHost");
  await expect(visual).toContainText("Rendered preview");
  await expect(visual).not.toContainText("<section>");
  const rawScrollable = await page.getByTestId("body-input").evaluate((node) => {
    node.scrollTop = 0;
    const scrollable = node.scrollHeight > node.clientHeight;
    if (scrollable) node.scrollTop = Math.min(120, node.scrollHeight - node.clientHeight);
    return {
      scrollable,
      scrollTop: node.scrollTop
    };
  });
  expect(rawScrollable.scrollable).toBe(true);
  expect(rawScrollable.scrollTop).toBeGreaterThan(0);

  const visualScrollable = await visualHost.evaluate((node) => {
    node.scrollTop = 0;
    const scrollable = node.scrollHeight > node.clientHeight;
    if (scrollable) node.scrollTop = Math.min(120, node.scrollHeight - node.clientHeight);
    return {
      scrollable,
      scrollTop: node.scrollTop
    };
  });
  expect(visualScrollable.scrollable).toBe(true);
  expect(visualScrollable.scrollTop).toBeGreaterThan(0);

  await page.getByTestId("body-input").fill("<table><tr><td>Broken preview");
  await expect(page.locator("#visualPreviewState")).toContainText(/Rendered HTML preview/i);
  await expect(visual).toContainText("Broken preview");
  await expect(page.getByTestId("body-input")).toHaveValue(/Broken preview/);

  await visual.click();
  await visual.press("Control+End");
  await visual.pressSequentially(" Visual sync.");
  await expect(page.getByTestId("body-input")).toHaveValue(/Visual sync/);

  const rawPersisted = await panelHeight(page, "#rawEditorPane");
  const visualPersisted = await panelHeight(page, "#visualEditorPane");
  await page.reload();
  await dismissWalkthrough(page);
  await expect(page.getByTestId("result-rows")).toContainText("completed", { timeout: 30_000 });
  const rawAfterReload = await panelHeight(page, "#rawEditorPane");
  expect(Math.abs(rawAfterReload - rawPersisted)).toBeLessThanOrEqual(12);
  await expect(page.locator("#visualEditorPane")).toBeVisible();
  const visualAfterReload = await panelHeight(page, "#visualEditorPane");
  expect(Math.abs(visualAfterReload - visualPersisted)).toBeLessThanOrEqual(12);

  expect(
    pageErrors.filter((message) => !message.includes("/api/client-logs due to access control checks."))
  ).toEqual([]);
});

test("Export Completed download contains standalone HTML contact actions", async ({ page }, testInfo) => {
  test.slow();
  await importOneRecord(page);
  await selectMockModel(page);
  await page.getByTestId("process-button").click();
  await expect(page.getByTestId("result-rows")).toContainText("completed", { timeout: 15_000 });
  await page.getByTestId("export-all").click();
  const downloadPromise = page.waitForEvent("download", { timeout: 120_000 });
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("email-exports.zip");
  const savePath = testInfo.outputPath(download.suggestedFilename());
  await download.saveAs(savePath);
  const fs = await import("node:fs/promises");
  const bytes = await fs.readFile(savePath);
  const files = unzipSync(bytes);
  const htmlPath = Object.keys(files).find((name) => name.endsWith(".html"));
  expect(htmlPath).toBeTruthy();
  const html = strFromU8(files[htmlPath]);
  expect(html).toContain("Contact actions");
  expect(html).toContain("mailto:owner@example.com");
  expect(html).not.toContain("<script");
});

test("template CRUD, configuration backup, and accessibility smoke", async ({ page, browserName }) => {
  if (browserName === "webkit") test.slow();
  page.on("dialog", async (dialog) => {
    if (dialog.type() === "prompt") await dialog.accept("E2E user template");
    else await dialog.accept();
  });
  await page.locator("#saveAsTemplateButton").click();
  await expect(page.locator("#templateSelect")).toContainText("E2E user template");
  await page.getByTestId("template-editor").fill("Hello {{name|required}} from {{city?}}");
  await page.locator("#saveTemplateButton").click();
  await expect(page.getByTestId("status-line")).toContainText(/Saved template|stored in memory only/);

  await page.locator("#configurationButton").click();
  await expect(page.locator("#configurationDialog")).toBeVisible();
  await page.locator("#backupScopeSelect").selectOption("settings");
  if (browserName === "webkit") {
    await page.locator("#exportBackupButton").click();
    await expect(page.getByTestId("status-line")).toContainText("Backup download started", {
      timeout: 120_000
    });
  } else {
    const backupPromise = page.waitForEvent("download");
    await page.locator("#exportBackupButton").click();
    const backup = await backupPromise;
    expect(backup.suggestedFilename()).toMatch(/\.emailgen$/);
  }
  await page.locator("#configurationCloseButton").click();

  const results = await new AxeBuilder({ page }).exclude("#visualEditorHost").analyze();
  expect(results.violations).toEqual([]);
});
