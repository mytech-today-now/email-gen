import { describe, expect, it } from "vitest";
import {
  LIMIT_DEFAULTS,
  applyLimitOverrides,
  describeLimitProfile,
  utf8ByteLength
} from "../../public/modules/limits.js";

describe("limit registry", () => {
  it("describes the compiled limit profile", () => {
    const profile = describeLimitProfile();
    expect(profile).toEqual(expect.arrayContaining([expect.objectContaining({ key: "records" })]));
    expect(profile.find((entry) => entry.key === "records")).toMatchObject({
      defaultValue: LIMIT_DEFAULTS.records
    });
  });

  it("rejects unknown or expanded overrides", () => {
    expect(() => applyLimitOverrides({ unknownLimit: 1 })).toThrow(/unknown limit/i);
    expect(() => applyLimitOverrides({ records: LIMIT_DEFAULTS.records + 1 })).toThrow(/compiled ceiling/i);
  });

  it("allows explicitly whitelisted test-only ceiling overrides", () => {
    const limits = applyLimitOverrides(
      { apiRequestsPerMinute: LIMIT_DEFAULTS.apiRequestsPerMinute + 1 },
      { allowAboveCeilingKeys: ["apiRequestsPerMinute"] }
    );
    expect(limits.apiRequestsPerMinute).toBe(LIMIT_DEFAULTS.apiRequestsPerMinute + 1);
  });

  it("measures UTF-8 bytes", () => {
    expect(utf8ByteLength("€")).toBe(3);
  });
});
