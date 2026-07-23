import fs from "node:fs";
import { describe, expect, it } from "vitest";

const indexHtml = fs.readFileSync("public/index.html", "utf8");
const appJs = fs.readFileSync("public/app.js", "utf8");
const styles = fs.readFileSync("public/styles.css", "utf8");

describe("results table management regressions", () => {
  it("keeps sorting and destructive controls inside their result panes", () => {
    expect(indexHtml).toContain('data-result-sort="record"');
    expect(indexHtml).toContain('data-result-sort="status"');
    expect(indexHtml).toContain('data-result-sort="subject"');
    expect(indexHtml).toMatch(/id="generatedResultsHeading"[\s\S]*id="deleteSelectedResultsButton"/);
    expect(indexHtml).toMatch(/id="activeResultHeading"[\s\S]*id="deleteActiveResultButton"/);
    expect(indexHtml).toContain("Delete Selected Result");
  });

  it("keeps multi-select and recoverable soft-delete behavior in the browser repository", () => {
    expect(appJs).toContain("async function softDeleteSelected()");
    expect(appJs).toContain("async function deleteActiveResult()");
    expect(appJs).toContain('if (event.key === "Delete")');
    expect(appJs).toContain("trashed: true");
    expect(appJs).toMatch(/updateRevisionedRecord\(\s*"results"/);
  });

  it("gives the generated results split enough vertical room for the selected result pane", () => {
    expect(styles).toMatch(/\.split-pane-results\s*{[^}]*height:\s*max\(78rem,\s*120vh\);/);
    expect(styles).toMatch(
      /\.results-table-wrap\s*{[^}]*flex:\s*0 0 auto;[^}]*min-height:\s*calc\(4\.75rem \+ \(20 \* 2\.35rem\)\);/
    );
  });
});
