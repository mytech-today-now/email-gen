import { describe, expect, it } from "vitest";
import { safeExportFilename } from "../../src/utils/files.js";
import { sanitizeEmailHtml, safeUrl } from "../../src/output/sanitizer.js";
import {
  normalizeAddendumForEmail,
  renderEmailFragment,
  renderPlainText
} from "../../src/output/emailRenderer.js";

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

  it("places the optional addendum after the sender signature and canonical link", () => {
    const bodyHtml = "<p>Hello.</p><p>Would a quick demo help?</p>";
    const addendumHtml = "<p>AI-Powered SMS Pickup Ordering | myTech.Today</p>";
    const html = renderEmailFragment({
      subject: "Hi",
      bodyHtml,
      addendumHtml,
      config
    });
    const text = renderPlainText({
      subject: "Hi",
      bodyHtml,
      addendumHtml,
      config
    });

    expect(html.indexOf("Would a quick demo help?")).toBeLessThan(html.indexOf("Best,<br>Kyle"));
    expect(html.indexOf("Best,<br>Kyle")).toBeLessThan(html.indexOf("https://example.com/ai-sms"));
    expect(html.indexOf("https://example.com/ai-sms")).toBeLessThan(
      html.indexOf("AI-Powered SMS Pickup Ordering")
    );
    expect(text).toContain(
      "Would a quick demo help?\n\nBest,\nKyle\n\nhttps://example.com/ai-sms\n\nAI-Powered SMS Pickup Ordering"
    );
  });

  it("keeps the restaurant addendum's key headings, price separator, and call to action centered for email", () => {
    const source = `
      <h2>How It Works</h2><h2>Why Restaurants Love It</h2><h2>Simple Pricing</h2>
      <p>per completed order</p><span>–</span><a href="tel:8477674914">Call (847) 767-4914 to Start</a>`;
    const rendered = renderEmailFragment({
      subject: "Hi",
      bodyHtml: "<p>Hello</p>",
      addendumHtml: source,
      config
    });
    expect(normalizeAddendumForEmail(source)).toContain("&ndash;");
    expect(rendered).toContain("How It Works");
    expect(rendered).toContain("text-align:center");
    expect(rendered).toContain("per completed order");
    expect(rendered).toContain("Call (847) 767-4914 to Start");
  });
});
