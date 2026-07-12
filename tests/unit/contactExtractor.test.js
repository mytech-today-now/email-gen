import { describe, expect, it } from "vitest";
import { extractContactInfo } from "../../src/research/contentExtractor.js";

describe("contact extraction", () => {
  it("extracts mailto and visible email addresses plus contact links", () => {
    const contact = extractContactInfo({
      url: "https://example.com/",
      body: `
        <a href="mailto:hello@example.com">Email</a>
        <p>Events: events@example.com</p>
        <a href="/contact-us">Contact us</a>
      `
    });

    expect(contact.primaryEmail).toBe("hello@example.com");
    expect(contact.emails).toContain("events@example.com");
    expect(contact.contactPage).toBe("https://example.com/contact-us");
  });
});
