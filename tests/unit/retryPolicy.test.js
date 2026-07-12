import { describe, expect, it } from "vitest";
import { backoffDelay, isTransientError } from "../../src/batch/retryPolicy.js";

describe("retry policy", () => {
  it("classifies rate limits and timeouts as transient", () => {
    expect(isTransientError({ status: 429 })).toBe(true);
    expect(isTransientError(new Error("provider timeout"))).toBe(true);
    expect(isTransientError({ status: 401, message: "auth failed" })).toBe(false);
  });

  it("caps backoff", () => {
    expect(backoffDelay(10, { ai: { backoffMinMs: 100, backoffMaxMs: 500 } })).toBe(500);
  });
});
