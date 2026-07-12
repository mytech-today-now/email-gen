import fs from "node:fs";
import { describe, expect, it } from "vitest";

const indexHtml = fs.readFileSync("public/index.html", "utf8");
const appJs = fs.readFileSync("public/app.js", "utf8");

describe("results delivery controls regressions", () => {
  it("keeps Send / Import controls with the generated results table and supports selected-row export", () => {
    expect(indexHtml).toMatch(
      /<div class="results-list">[\s\S]*<section class="delivery-tools"[\s\S]*<tbody id="resultRows"/
    );
    expect(indexHtml).toContain('data-testid="select-all-results"');
    expect(indexHtml).toContain('data-testid="export-delivery-selected"');
    expect(indexHtml).not.toContain("exportDeliveryCurrentButton");
    expect(appJs).toContain("selectedResultIds: new Set()");
    expect(appJs).toContain("toggleResultSelection");
  });
});
