import fs from "node:fs";
import { describe, expect, it } from "vitest";

const indexHtml = fs.readFileSync("public/index.html", "utf8");
const appJs = fs.readFileSync("public/app.js", "utf8");

describe("results table management regressions", () => {
  it("keeps sort and delete controls on the generated results table", () => {
    expect(indexHtml).toContain('data-testid="sort-results-record"');
    expect(indexHtml).toContain('data-testid="sort-results-status"');
    expect(indexHtml).toContain('data-testid="sort-results-subject"');
    expect(indexHtml).toContain('data-testid="delete-selected-results"');
    expect(indexHtml).toContain('data-testid="delete-active-result"');
  });

  it("keeps multi-select delete and keyboard delete behavior wired in the client", () => {
    expect(appJs).toContain("async function deleteSelectedResults()");
    expect(appJs).toContain("async function deleteActiveResult()");
    expect(appJs).toContain('if (event.key !== "Delete" || isTypingTarget) return;');
    expect(appJs).toContain('api("/api/results/delete"');
  });
});
