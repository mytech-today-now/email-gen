import { describe, expect, it } from "vitest";
import { safeExportFilename } from "../../src/utils/files.js";
import { sanitizeEmailHtml, safeUrl } from "../../src/output/sanitizer.js";
import { renderEmailFragment } from "../../src/output/emailRenderer.js";

const config = {
  business: {
    aiSmsUrl: "https://example.com/ai-sms",
    signature: "Best,\nKyle",
    name: "Local AI SMS",
    city: "Omaha",
    region: "Nebraska"
  }
};

describe("output generation", () => {
  it("slugifies deterministic filenames", () => {
    expect(safeExportFilename({ id: 2, name: "Tomo Sushi & Ramen", suffix: "ai-sms" })).toBe(
      "0002-tomo-sushi-and-ramen-ai-sms.html"
    );
  });

  it("blocks unsafe links and event handlers", () => {
    expect(safeUrl("javascript:alert(1)")).toBe("");
    expect(sanitizeEmailHtml('<a href="javascript:alert(1)" onclick="x()">bad</a>')).not.toContain(
      "javascript:"
    );
  });

  it("places AI SMS links near top and bottom and keeps signature", () => {
    const html = renderEmailFragment({
      subject: "Hi",
      bodyHtml: "<p>Hello</p>",
      record: { displayName: "Acadian", normalized: { id: 1 } },
      config
    });
    expect((html.match(/AI SMS examples/g) || []).length).toBe(2);
    expect(html).toContain("Best,<br>Kyle");
    expect(html).not.toContain("725 N 114th");
  });
});
