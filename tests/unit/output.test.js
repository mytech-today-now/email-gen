import { describe, expect, it } from "vitest";
import { safeExportFilename } from "../../src/utils/files.js";
import { sanitizeEmailHtml, safeUrl } from "../../src/output/sanitizer.js";
import { renderEmailFragment, renderPlainText } from "../../src/output/emailRenderer.js";

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

  it("appends one clean signature and one final canonical link", () => {
    const html = renderEmailFragment({
      subject: "Hi",
      bodyHtml:
        '<p><a href="https://example.com/ai-sms">AI SMS examples</a></p><p>Hello</p><p>Best Regards,<br>Kyle<br>hello@example.com</p>',
      record: { displayName: "Acadian", normalized: { id: 1 } },
      config
    });
    expect((html.match(/<a href="https:\/\/example\.com\/ai-sms"/g) || []).length).toBe(1);
    expect(html).toContain("Best,<br>Kyle");
    expect(html).not.toContain("AI SMS examples</a></p>\n      <p");
    expect(html).not.toContain("Personalized for");
    expect(html).not.toContain("Local AI SMS");
  });

  it("preserves paragraph spacing in plain text output", () => {
    const text = renderPlainText({
      subject: "Hi",
      bodyHtml: "<p>Dear Team,</p><p>Paragraph one.</p><p>Paragraph two.</p>",
      config
    });
    expect(text).toContain("Dear Team,\n\nParagraph one.\n\nParagraph two.");
    expect(text).toContain("\n\nBest,\nKyle\n\nhttps://example.com/ai-sms");
  });
});
