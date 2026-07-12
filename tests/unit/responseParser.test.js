import { describe, expect, it } from "vitest";
import { normalizeAiResponse, parseAiTextResponse } from "../../src/ai/responseParser.js";

describe("AI response parser", () => {
  it("parses JSON wrapped in markdown fences", () => {
    const parsed = parseAiTextResponse('```json\n{"subject":"Hi","bodyHtml":"<p>Hello</p>"}\n```');
    expect(parsed.subject).toBe("Hi");
  });

  it("falls back to subject-prefixed plain text", () => {
    const parsed = parseAiTextResponse("Subject: Quick note\n\nHello there");
    expect(parsed.subject).toBe("Quick note");
    expect(parsed.bodyHtml).toContain("Hello");
  });

  it("sanitizes script tags", () => {
    const normalized = normalizeAiResponse({
      subject: "Hi",
      bodyHtml: '<p>Hello</p><script>alert("x")</script>'
    });
    expect(normalized.bodyHtml).not.toContain("script");
  });
});
