import { describe, expect, it } from "vitest";
import { buildResendReviewFingerprint } from "../../public/modules/resendReview.js";

describe("resend review fingerprints", () => {
  it("stays stable for the same logical resend review and changes with a new review session", async () => {
    const base = {
      reviewedAt: "2026-07-21T12:00:00.000Z",
      expiresAt: "2026-07-21T12:15:00.000Z",
      projectId: "project-1",
      sender: {
        fromName: "Acme",
        fromAddress: "hello@example.com",
        replyTo: "reply@example.com",
        unsubscribeUrl: "https://example.com/unsubscribe",
        companyAddress: "123 Main St"
      },
      items: [
        {
          id: "row-1",
          primaryEmail: "person@example.com",
          subject: "Hello",
          html: '<p>Hello</p><p>123 Main St</p><p><a href="https://example.com/unsubscribe">https://example.com/unsubscribe</a></p>',
          text: "Hello\n123 Main St\nhttps://example.com/unsubscribe",
          consentStatus: "opted-in",
          consentSource: "signup",
          consentTimestamp: "2026-01-01T00:00:00Z"
        }
      ],
      suppressions: ["s-2", "s-1"],
      batchSize: 100,
      testRecipient: "person@example.com"
    };

    const left = await buildResendReviewFingerprint({ ...base, reviewId: "review-1" });
    const right = await buildResendReviewFingerprint({
      ...base,
      reviewId: "review-1",
      suppressions: ["s-1", "s-2"],
      sender: {
        companyAddress: "123 Main St",
        unsubscribeUrl: "https://example.com/unsubscribe",
        replyTo: "reply@example.com",
        fromAddress: "hello@example.com",
        fromName: "Acme"
      }
    });
    const changed = await buildResendReviewFingerprint({ ...base, reviewId: "review-2" });

    expect(left.payloadDigest).toBe(right.payloadDigest);
    expect(left.suppressionDigest).toBe(right.suppressionDigest);
    expect(left.chunks).toHaveLength(1);
    expect(left.chunks[0].chunkDigest).toBe(right.chunks[0].chunkDigest);
    expect(left.items[0]).not.toHaveProperty("message");
    expect(left.payloadDigest).not.toBe(changed.payloadDigest);
    expect(left.chunks[0].chunkDigest).not.toBe(changed.chunks[0].chunkDigest);
  });
});
