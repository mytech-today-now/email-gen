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

describe("delivery export edge cases", () => {
  it("keeps records with missing or invalid emails fixable in the send list", () => {
    const artifacts = buildDeliveryArtifacts(
      [
        {
          result: {
            id: "res_missing",
            subject: "Ready",
            bodyHtml: "<p>Body</p>",
            bodyText: "Body",
            emailHtml: "<p>Body</p>",
            status: "completed"
          },
          record: {
            id: 1,
            displayName: "No Email Cafe",
            normalized: { id: 1, name: "No Email Cafe", email: "not an email" }
          }
        }
      ],
      config,
      { profile: "generic" }
    );
    const sendList = artifacts.find((artifact) => artifact.name === "generic/send-list.csv").content;
    expect(sendList).toContain("No Email Cafe");
    expect(sendList.split("\r\n")[1].startsWith(",")).toBe(true);
  });

  it("adds contact-form fallback files when research finds only a contact page", () => {
    const artifacts = buildDeliveryArtifacts(
      [
        {
          result: {
            id: "res_contact",
            subject: "Worth a look?",
            bodyHtml: "<p>Body</p>",
            bodyText: "Body",
            emailHtml: "<p>Body</p>",
            status: "completed",
            research: { contact: { contactPage: "https://example.com/contact-us" } }
          },
          record: {
            id: 2,
            displayName: "Contact Page Cafe",
            normalized: { id: 2, name: "Contact Page Cafe" }
          }
        }
      ],
      config,
      { profile: "generic" }
    );
    const fallback = artifacts.find((artifact) => artifact.name === "generic/contact-form-fallbacks.csv");
    expect(fallback.content).toContain("https://example.com/contact-us");
    expect(fallback.content).toContain("Worth a look?");
    expect(fallback.content).toContain("hello@example.com");
  });

  it("rejects unknown delivery profiles", () => {
    expect(() => buildDeliveryArtifacts([], config, { profile: "fax-blaster" })).toThrow(
      /Unsupported delivery export profile/
    );
  });
});
