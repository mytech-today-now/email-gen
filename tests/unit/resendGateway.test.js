import { afterEach, describe, expect, it, vi } from "vitest";
import { validateResendComplianceContent } from "../../public/modules/resendReview.js";
import { idempotencyKeyFor, parseRetryAfterMs, sendResendChunk } from "../../src/resend/resendGateway.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("resend gateway helpers", () => {
  it("parses Retry-After values and clamps them safely", () => {
    const now = Date.parse("2026-07-22T12:00:00.000Z");
    vi.spyOn(Date, "now").mockReturnValue(now);

    expect(parseRetryAfterMs("1.5")).toBe(1500);
    expect(parseRetryAfterMs("-2")).toBe(0);
    expect(parseRetryAfterMs("invalid")).toBeNull();
    expect(parseRetryAfterMs(new Date(now + 5_000).toUTCString())).toBe(5_000);
    expect(parseRetryAfterMs(new Date(now - 5_000).toUTCString())).toBe(0);
    expect(parseRetryAfterMs("120", { maxDelayMs: 1_000 })).toBe(1_000);
  });

  it("binds idempotency keys to every provider-affecting resend field", () => {
    const sender = {
      fromAddress: "from@example.com",
      replyTo: "reply@example.com",
      unsubscribeUrl: "https://example.com/unsubscribe",
      companyAddress: "123 Main St"
    };
    const item = {
      id: "result-1",
      primaryEmail: "person@example.com",
      subject: "Hello",
      html: "<p>Hello</p>",
      text: "Hello"
    };

    const base = idempotencyKeyFor([item], sender, { operationId: "operation-1", reviewId: "review-1" });
    expect(base).toBe(
      idempotencyKeyFor([item], sender, { operationId: "operation-1", reviewId: "review-1" })
    );
    expect(idempotencyKeyFor([item], sender, { operationId: "operation-2", reviewId: "review-1" })).not.toBe(
      base
    );
    expect(
      idempotencyKeyFor([{ ...item, subject: "Changed" }], sender, { operationId: "operation-1" })
    ).not.toBe(base);
    expect(
      idempotencyKeyFor([{ ...item, html: "<p>Changed</p>" }], sender, { operationId: "operation-1" })
    ).not.toBe(base);
    expect(
      idempotencyKeyFor(
        [item],
        { ...sender, fromAddress: "other@example.com" },
        { operationId: "operation-1" }
      )
    ).not.toBe(base);
  });

  it("retries transient resend responses without changing the persisted idempotency key", async () => {
    const calls = [];
    const fetchImpl = async (_url, options = {}) => {
      calls.push(options);
      if (calls.length === 1) {
        return new Response(JSON.stringify({ message: "slow down" }), {
          status: 429,
          headers: { "retry-after": "0" }
        });
      }
      return new Response(JSON.stringify({ data: [{ id: "resend-1" }] }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    };

    const result = await sendResendChunk({
      apiKey: "re_test",
      items: [
        {
          id: "result-1",
          primaryEmail: "person@example.com",
          subject: "Hello",
          html: "<p>Hello</p>",
          text: "Hello"
        }
      ],
      sender: {
        fromAddress: "from@example.com"
      },
      fetchImpl,
      maxRetries: 1,
      backoffMinMs: 0,
      backoffMaxMs: 0,
      retryAfterMaxMs: 0
    });

    expect(result.deliveries).toHaveLength(1);
    expect(calls).toHaveLength(2);
    expect(calls[0].headers["idempotency-key"]).toBe(calls[1].headers["idempotency-key"]);
  });

  it("rejects bulk resend content that omits the required compliance footer", () => {
    expect(() =>
      validateResendComplianceContent(
        {
          id: "result-1",
          primaryEmail: "person@example.com",
          html: "<p>Hello</p>",
          text: "Hello"
        },
        {},
        { bulk: true }
      )
    ).toThrowError(/postal identification/i);
  });
});
