import { describe, expect, it } from "vitest";
import {
  composeMailtoHref,
  hasRenderableResult,
  resolveResultOutput,
  renderStandaloneDocument,
  safeUrl
} from "../../public/modules/emailPipeline.js";

describe("browser email pipeline exports", () => {
  it("treats completed results with subject and html as renderable", () => {
    expect(
      hasRenderableResult({ status: "completed", subject: "Hello", finalEmailHtml: "<p>World</p>" })
    ).toBe(true);
    expect(hasRenderableResult({ status: "failed", subject: "Hello", finalEmailHtml: "<p>World</p>" })).toBe(
      false
    );
  });

  it("resolves legacy browser results into the canonical final HTML and text", () => {
    const resolved = resolveResultOutput({
      status: "completed",
      subject: "Hello",
      emailHtml: "<p>World</p>"
    });

    expect(resolved.finalEmailHtml).toBe("<p>World</p>");
    expect(resolved.finalText).toBe("World");
    expect(
      hasRenderableResult({ status: "completed", subject: "Hello", emailHtml: "<p>World</p>" })
    ).toBe(true);
  });

  it("renders a safe failure panel instead of literal undefined output", () => {
    const html = renderStandaloneDocument({
      result: {
        status: "failed",
        subject: "",
        finalEmailHtml: undefined,
        error: { message: "Provider timeout" }
      },
      contacts: [
        {
          type: "phone",
          value: "(712) 256-5525",
          sourceCategory: "imported-record",
          reason: "Imported phone",
          confidenceLabel: "high"
        }
      ]
    });

    expect(html).toContain("<!doctype html>");
    expect(html).toContain("Email output unavailable");
    expect(html).toContain("Provider timeout");
    expect(html).toContain('href="tel:7122565525"');
    expect(html).not.toContain(">undefined<");
  });

  it("renders legacy stored HTML through the standalone browser document", () => {
    const html = renderStandaloneDocument({
      result: {
        status: "completed",
        subject: "Hello",
        emailHtml: "<p>World</p>",
        bodyText: "World"
      }
    });

    expect(html).toContain("<!doctype html>");
    expect(html).toContain("<p>World</p>");
    expect(html).toContain("Subject: Hello");
  });

  it("validates absolute web URLs even without a browser location object", () => {
    expect(safeUrl("https://example.com/path")).toBe("https://example.com/path");
  });

  it("builds a mailto draft with a sanitized subject and multiline body", () => {
    expect(
      composeMailtoHref({
        email: "owner@example.com",
        subject: "Hello\r\nBcc: nope",
        body: "Line 1\n\nLine 2"
      })
    ).toBe("mailto:owner@example.com?subject=Hello%20Bcc%3A%20nope&body=Line%201%0D%0A%0D%0ALine%202");
  });
});
