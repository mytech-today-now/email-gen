import { describe, expect, it } from "vitest";
import {
  canonicalJson,
  digestCanonical,
  processScopeIdentity,
  resendScopeIdentity,
  restoreScopeIdentity
} from "../../public/modules/operationIdentity.js";

describe("operation identity helpers", () => {
  it("canonicalizes equivalent payloads and hashes them deterministically", async () => {
    const left = {
      b: 1,
      a: {
        y: 2,
        x: [{ z: 3, skip: undefined }, 4]
      }
    };
    const right = {
      a: {
        x: [{ z: 3 }, 4],
        y: 2
      },
      b: 1
    };

    expect(canonicalJson(left)).toBe(canonicalJson(right));
    const leftDigest = await digestCanonical(left, "op");
    const rightDigest = await digestCanonical(right, "op");
    expect(leftDigest).toBe(rightDigest);
  });

  it("builds stable scope identities for equivalent browser inputs", async () => {
    const left = await processScopeIdentity({
      projectId: "project-1",
      recordIds: ["2", "1", "1"],
      template: { id: "template-1", name: "Welcome", content: "Hello {{name}}" },
      provider: "openai",
      model: "gpt-5.6",
      researchEnabled: true,
      researchDepth: 5,
      options: {
        customBaseUrl: "https://example.com",
        confirmedCustomProviderHost: true,
        ollamaHost: "http://127.0.0.1:11434"
      },
      addendum: { id: "addendum-1", content: "Thanks" },
      scope: "selected"
    });
    const right = await processScopeIdentity({
      projectId: "project-1",
      recordIds: ["1", "2"],
      template: { name: "Welcome", content: "Hello {{name}}", id: "template-1" },
      provider: "openai",
      model: "gpt-5.6",
      researchEnabled: true,
      researchDepth: 5,
      options: {
        ollamaHost: "http://127.0.0.1:11434",
        confirmedCustomProviderHost: true,
        customBaseUrl: "https://example.com"
      },
      addendum: { content: "Thanks", id: "addendum-1" },
      scope: "selected"
    });

    expect(left.scopeKey).toBe(right.scopeKey);
    expect(left.fingerprint.recordIds).toEqual(["1", "2"]);
    expect(left.fingerprint.template).toEqual(right.fingerprint.template);
  });

  it("keeps resend and restore identities stable for the same logical input", async () => {
    const resendLeft = await resendScopeIdentity({
      projectId: "project-1",
      reviewId: "review-1",
      reviewedAt: "2026-07-21T12:00:00.000Z",
      expiresAt: "2026-07-21T12:15:00.000Z",
      payloadDigest: "resend_payload_a",
      resultIds: ["result-2", "result-1", "result-1"],
      messageDigests: ["message-b", "message-a", "message-a"],
      sender: {
        fromName: "Acme",
        fromAddress: "hello@example.com",
        replyTo: "reply@example.com",
        unsubscribeUrl: "https://example.com/unsubscribe",
        companyAddress: "123 Main St"
      },
      suppressionDigest: "resend_suppression_a",
      items: [
        {
          id: "row-1",
          primaryEmail: "person@example.com",
          subject: "Hello",
          html: "<p>Hello</p>",
          text: "Hello"
        }
      ],
      testRecipient: "person@example.com",
      suppressions: ["s-2", "s-1", "s-1"],
      batchSize: 100
    });
    const resendRight = await resendScopeIdentity({
      projectId: "project-1",
      reviewId: "review-1",
      reviewedAt: "2026-07-21T12:00:00.000Z",
      expiresAt: "2026-07-21T12:15:00.000Z",
      payloadDigest: "resend_payload_a",
      resultIds: ["result-1", "result-2"],
      messageDigests: ["message-a", "message-b"],
      sender: {
        companyAddress: "123 Main St",
        unsubscribeUrl: "https://example.com/unsubscribe",
        replyTo: "reply@example.com",
        fromAddress: "hello@example.com",
        fromName: "Acme"
      },
      suppressionDigest: "resend_suppression_a",
      items: [
        {
          id: "row-1",
          primaryEmail: "person@example.com",
          subject: "Hello",
          html: "<p>Hello</p>",
          text: "Hello"
        }
      ],
      testRecipient: "person@example.com",
      suppressions: ["s-1", "s-2"],
      batchSize: 100
    });
    const restoreLeft = await restoreScopeIdentity({
      manifest: {
        archiveVersion: 1,
        applicationVersion: "2.0.0",
        includedCategories: ["projects", "results"]
      },
      conflict: "merge"
    });
    const restoreRight = await restoreScopeIdentity({
      conflict: "merge",
      manifest: {
        includedCategories: ["projects", "results"],
        applicationVersion: "2.0.0",
        archiveVersion: 1
      }
    });

    expect(resendLeft.scopeKey).toBe(resendRight.scopeKey);
    expect(resendLeft.fingerprint.resultIds).toEqual(["result-1", "result-2"]);
    expect(resendLeft.fingerprint.messageDigests).toEqual(["message-a", "message-b"]);
    expect(restoreLeft.scopeKey).toBe(restoreRight.scopeKey);
  });

  it("changes resend scope identity when the review session changes", async () => {
    const common = {
      projectId: "project-1",
      reviewedAt: "2026-07-21T12:00:00.000Z",
      expiresAt: "2026-07-21T12:15:00.000Z",
      payloadDigest: "resend_payload_a",
      resultIds: ["result-1"],
      messageDigests: ["message-a"],
      sender: {
        fromName: "Acme",
        fromAddress: "hello@example.com",
        replyTo: "reply@example.com",
        unsubscribeUrl: "https://example.com/unsubscribe",
        companyAddress: "123 Main St"
      },
      suppressionDigest: "resend_suppression_a",
      batchSize: 100,
      testRecipient: "person@example.com"
    };

    const first = await resendScopeIdentity({ ...common, reviewId: "review-1" });
    const second = await resendScopeIdentity({ ...common, reviewId: "review-2" });
    const payloadChanged = await resendScopeIdentity({
      ...common,
      reviewId: "review-1",
      payloadDigest: "resend_payload_b"
    });

    expect(first.scopeKey).not.toBe(second.scopeKey);
    expect(first.scopeKey).not.toBe(payloadChanged.scopeKey);
  });
});
