import fs from "node:fs";
import { describe, expect, it } from "vitest";

const indexHtml = fs.readFileSync("public/index.html", "utf8");
const styles = fs.readFileSync("public/styles.css", "utf8");

describe("responsive layout regressions", () => {
  it("keeps research and pacing in the compact progressive processing group", () => {
    expect(indexHtml).toMatch(
      /<details class="control-cluster processing-options"[\s\S]*id="executionModeSelect"[\s\S]*id="researchEnabled"[\s\S]*id="concurrencyInput"/
    );
    expect(styles).not.toMatch(/repeat\(8,\s*minmax\(90px,\s*1fr\)\)/);
  });

  it("keeps overflow in internal pane and table scrollers", () => {
    expect(styles).toMatch(/body\s*{[^}]*overflow-x:\s*clip;/);
    expect(styles).toMatch(/\.table-wrap\s*{[^}]*overflow:\s*auto;/);
    expect(styles).toMatch(/\.pane\s*{[^}]*min-height:\s*0;[^}]*overflow:\s*hidden;/);
    expect(styles).toMatch(/\.split-pane\.is-stacked\s*{[^}]*height:\s*auto;/);
  });
});
