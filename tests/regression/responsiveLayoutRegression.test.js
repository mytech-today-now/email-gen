import fs from "node:fs";
import { describe, expect, it } from "vitest";

const indexHtml = fs.readFileSync("public/index.html", "utf8");
const styles = fs.readFileSync("public/styles.css", "utf8");

describe("responsive layout regressions", () => {
  it("keeps Research in the compact options group instead of the old wide controls row", () => {
    expect(indexHtml).toMatch(
      /<legend>Options<\/legend>[\s\S]*<label class="switch">[\s\S]*id="researchEnabled"[\s\S]*<span>Research<\/span>/
    );
    expect(indexHtml).not.toContain('<label class="check"><input id="researchEnabled"');
    expect(styles).not.toMatch(/repeat\(8,\s*minmax\(90px,\s*1fr\)\)/);
  });

  it("keeps overflow local to scrollable content instead of the page shell", () => {
    expect(styles).toMatch(/body\s*{[\s\S]*overflow-x:\s*hidden;/);
    expect(styles).toMatch(/\.table-wrap\s*{[\s\S]*overflow:\s*auto;/);
    expect(styles).toMatch(/\.content-grid\s*{[\s\S]*minmax\(min\(100%,\s*440px\),\s*1fr\)/);
  });
});
