import { describe, expect, it } from "vitest";
import { renderEmailFragment, renderPlainText } from "../../src/output/emailRenderer.js";

const config = {
  business: {
    aiSmsUrl: "https://mytech.today/tools/ai-sms.html",
    signature:
      "Best Regards,\n\nKyle Rode\nkyle@mytech.today\n(847) 767-4914\nHospitality Technology Solutions",
    name: "myTech.Today",
    city: "Omaha",
    region: "Nebraska"
  }
};

describe("email rendering edge cases", () => {
  it("strips duplicate signature, duplicate promo links, and footer-like remnants from the AI body", () => {
    const html = renderEmailFragment({
      subject: "Hello",
      bodyHtml: `
        <p><a href="https://mytech.today/tools/ai-sms.html">AI SMS examples</a></p>
        <p>Dear Acadian Grille &amp; Bar Owner and the General Manager,</p>
        <p>Paragraph one.</p>
        <p>Best Regards,<br><br>Kyle Rode<br>kyle@mytech.today<br>(847) 767-4914<br>Hospitality Technology Solutions</p>
        <p><a href="https://mytech.today/tools/ai-sms.html">https://mytech.today/tools/ai-sms.html</a></p>
        <p>myTech.Today · Omaha, Nebraska</p>
        <p>Personalized for Acadian Grille &amp; Bar</p>
      `,
      record: { displayName: "Acadian Grille & Bar", normalized: { id: 1 } },
      config
    });

    expect((html.match(/Kyle Rode/g) || []).length).toBe(1);
    expect((html.match(/Hospitality Technology Solutions/g) || []).length).toBe(1);
    expect((html.match(/<a href="https:\/\/mytech\.today\/tools\/ai-sms\.html"/g) || []).length).toBe(1);
    expect(html).not.toContain("Personalized for");
    expect(html).not.toContain("myTech.Today · Omaha, Nebraska");
  });

  it("keeps paragraph breaks in plain text instead of collapsing the whole email", () => {
    const text = renderPlainText({
      subject: "Hello",
      bodyHtml: "<p>Dear Team,</p><p>Paragraph one.</p><p>Paragraph two.</p>",
      config
    });

    expect(text).toContain("Dear Team,\n\nParagraph one.\n\nParagraph two.");
  });
});
