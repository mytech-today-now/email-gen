import { describe, expect, it } from "vitest";
import { buildDeliveryArtifacts } from "../../src/output/deliveryExporter.js";

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
    id: "res_2",
    subject: "Hello",
    bodyHtml: "<p>Hello</p>",
    bodyText: "Hello",
    emailHtml: "<p>Hello</p>",
    status: "completed"
  },
  record: {
    id: 2,
    displayName: "Grace Hopper",
    normalized: { id: 2, name: "Grace Hopper", email: "grace@example.com" }
  }
};

describe("delivery export regressions", () => {
  it("keeps stable artifact names for supported sending targets", () => {
    const names = buildDeliveryArtifacts([item], config, { profile: "all" }).map((artifact) => artifact.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "README.txt",
        "manifest.json",
        "beehiiv/contacts.csv",
        "mailchimp/contacts.csv",
        "constant-contact/contacts.csv",
        "email-clients/send-list.csv",
        "email-clients/outlook-thunderbird.mbox",
        "generic/send-list.csv",
        "generic/api-payload.jsonl"
      ])
    );
  });

  it("keeps Mailchimp and Constant Contact subject/body handoff fields", () => {
    const artifacts = buildDeliveryArtifacts([item], config, { profile: "all" });
    expect(artifacts.find((artifact) => artifact.name === "mailchimp/contacts.csv").content).toContain(
      "AI_HTML"
    );
    expect(artifacts.find((artifact) => artifact.name === "constant-contact/contacts.csv").content).toContain(
      "Custom Field 1"
    );
  });

  it("uses research-discovered email addresses when imported records do not include one", () => {
    const artifacts = buildDeliveryArtifacts(
      [
        {
          result: {
            ...item.result,
            research: { contact: { primaryEmail: "hello@grace.example" } }
          },
          record: { ...item.record, normalized: { id: 2, name: "Grace Hopper" } }
        }
      ],
      config,
      { profile: "mailchimp" }
    );
    expect(artifacts.find((artifact) => artifact.name === "mailchimp/contacts.csv").content).toContain(
      "hello@grace.example"
    );
  });
});
