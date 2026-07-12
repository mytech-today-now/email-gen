import { describe, expect, it } from "vitest";
import { buildDeliveryArtifacts, toCsv } from "../../src/output/deliveryExporter.js";

const config = {
  outputDir: "output",
  limits: { exportFilenameLength: 160 },
  business: {
    name: "Local AI SMS",
    email: "hello@example.com",
    city: "Omaha",
    region: "Nebraska",
    signature: "Best,\nKyle",
    aiSmsUrl: "https://example.com/ai-sms",
    printFooter: "Generated locally"
  }
};

const item = {
  result: {
    id: "res_1",
    subject: 'Lunch "special", today',
    bodyHtml: "<p>Hello, chef.</p>",
    bodyText: "Hello, chef.",
    emailHtml: "<p>Hello, chef.</p>",
    status: "completed"
  },
  record: {
    id: 7,
    displayName: "Ada Lovelace",
    normalized: {
      id: 7,
      name: "Ada Lovelace",
      email: "ada@example.com",
      company: "Analytical Engines"
    }
  }
};

describe("delivery exporter", () => {
  it("quotes CSV cells for commas, quotes, and newlines", () => {
    expect(toCsv([{ email: "a@example.com", subject: 'Hi, "Ada"', body: "Line 1\nLine 2" }])).toBe(
      'email,subject,body\r\na@example.com,"Hi, ""Ada""","Line 1\nLine 2"'
    );
  });

  it("builds a named-service and client delivery kit", () => {
    const artifacts = buildDeliveryArtifacts([item], config, { profile: "all" });
    const names = artifacts.map((artifact) => artifact.name);
    expect(names).toContain("beehiiv/contacts.csv");
    expect(names).toContain("mailchimp/contacts.csv");
    expect(names).toContain("constant-contact/contacts.csv");
    expect(names).toContain("email-clients/outlook-thunderbird.mbox");
    expect(names).toContain("generic/api-payload.jsonl");
    expect(artifacts.find((artifact) => artifact.name === "mailchimp/contacts.csv").content).toContain(
      "AI_SUBJECT"
    );
  });

  it("removes header injection from EML subjects and recipients", () => {
    const artifacts = buildDeliveryArtifacts(
      [
        {
          result: { ...item.result, subject: "Hello\r\nBcc: hidden@example.com" },
          record: { ...item.record, normalized: { ...item.record.normalized, email: "ada@example.com" } }
        }
      ],
      config,
      { profile: "email-clients" }
    );
    const eml = artifacts.find((artifact) => artifact.name.endsWith(".eml")).content;
    expect(eml).toContain("Subject: Hello Bcc: hidden@example.com");
    expect(eml).not.toMatch(/\r\nBcc:/);
  });
});
