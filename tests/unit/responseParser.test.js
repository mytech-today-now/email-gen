import { describe, expect, it } from "vitest";
import { normalizeAiResponse, parseAiTextResponse } from "../../src/ai/responseParser.js";

describe("AI response parser", () => {
  it("parses JSON wrapped in markdown fences", () => {
    const parsed = parseAiTextResponse('```json\n{"subject":"Hi","bodyHtml":"<p>Hello</p>"}\n```');
    expect(parsed.subject).toBe("Hi");
  });

  it("parses raw HTML strings with titles and complex markup", () => {
    const parsed = parseAiTextResponse(
      '<!doctype html><html><head><title>Weekend special</title></head><body><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr><td style="color:#0c6a63">Café &amp; tea <a href="https://example.com/">link</a></td></tr></table></body></html>'
    );
    expect(parsed.subject).toBe("Weekend special");
    expect(parsed.body).toContain("<table");
    expect(parsed.body).toContain('href="https://example.com/"');
    expect(parsed.body).toContain("Café &amp; tea");
  });

  it("parses fenced HTML strings and keeps the wrapped HTML intact", () => {
    const parsed = parseAiTextResponse(
      "```html\n<!-- Subject: Toasted sandwiches -->\n<p>Hello <strong>there</strong></p>\n```"
    );
    expect(parsed.subject).toBe("Toasted sandwiches");
    expect(parsed.body).toContain("<p>Hello <strong>there</strong></p>");
  });

  it("falls back to subject-prefixed plain text", () => {
    const parsed = parseAiTextResponse("Subject: Quick note\n\nHello there");
    expect(parsed.subject).toBe("Quick note");
    expect(parsed.body).toContain("Hello");
  });

  it("parses the legacy markdown subject format", () => {
    const parsed = parseAiTextResponse("**Subject:** Quick note\n\nHello there");
    expect(parsed.subject).toBe("Quick note");
    expect(parsed.body).toContain("Hello");
  });

  it("accepts JSON with subject and body fields", () => {
    const normalized = normalizeAiResponse({ subject: "Hi", body: "Hello there" });
    expect(normalized.subject).toBe("Hi");
    expect(normalized.bodyHtml).toContain("Hello there");
  });

  it("accepts content-block arrays returned by modern SDKs", () => {
    const normalized = normalizeAiResponse([
      { type: "text", text: "**Subject:** Bistro follow-up\n\n<p>Hello " },
      { type: "text", text: "there</p>" }
    ]);
    expect(normalized.subject).toBe("Bistro follow-up");
    expect(normalized.bodyHtml).toContain("<p>Hello there</p>");
  });

  it("sanitizes script tags", () => {
    const normalized = normalizeAiResponse({
      subject: "Hi",
      bodyHtml: '<p>Hello</p><script>alert("x")</script>'
    });
    expect(normalized.bodyHtml).not.toContain("script");
  });

  it("rejects empty subjects instead of inventing a fallback", () => {
    expect(() => parseAiTextResponse("Hello there only")).toThrow(/usable subject and body/i);
  });
});
