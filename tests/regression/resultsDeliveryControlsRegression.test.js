import fs from "node:fs";
import { describe, expect, it } from "vitest";

const indexHtml = fs.readFileSync("public/index.html", "utf8");
const styles = fs.readFileSync("public/styles.css", "utf8");
const appJs = fs.readFileSync("public/app.js", "utf8");
const backupJs = fs.readFileSync("public/modules/backup.js", "utf8");

describe("results delivery controls regressions", () => {
  it("keeps the selected-result toolbar directly below the heading and above metadata", () => {
    const headingIndex = indexHtml.indexOf('id="activeResultHeading"');
    const actionsIndex = indexHtml.indexOf('class="result-actions"');
    const metadataIndex = indexHtml.indexOf('id="activeResultMetadata"');

    expect(headingIndex).toBeGreaterThan(-1);
    expect(actionsIndex).toBeGreaterThan(headingIndex);
    expect(metadataIndex).toBeGreaterThan(actionsIndex);
    expect(indexHtml.match(/class="result-actions"/g)).toHaveLength(1);
    expect(indexHtml).toContain('class="caption result-metadata"');
    expect(styles).toContain(".result-metadata");
    expect(styles).toMatch(/@media \(max-width: 38rem\)[\s\S]*\.result-actions\s*{\s*flex-direction:\s*column;/);
  });

  it("keeps compact delivery controls with generated results and downloads from browser data", () => {
    expect(indexHtml).toMatch(
      /<section class="delivery-toolbar"[\s\S]*id="exportDeliverySelectedButton"[\s\S]*id="resultRows"/
    );
    expect(indexHtml).toContain('data-testid="select-all-results"');
    expect(indexHtml).toContain('data-testid="export-all"');
    expect(indexHtml).toContain('id="resendPreflightButton"');
    expect(appJs).toContain("selectedResultIds: new Set()");
    expect(appJs).toContain("streamArchive({");
    expect(backupJs).toContain("URL.createObjectURL");
    expect(backupJs).toContain("URL.revokeObjectURL");
  });
});
