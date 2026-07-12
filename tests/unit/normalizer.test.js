import { describe, expect, it } from "vitest";
import { normalizeRecords } from "../../src/data/normalizer.js";

const limits = { records: 100, fields: 20, fieldBytes: 1000 };

describe("record normalizer", () => {
  it("preserves raw data, normalizes headings, and flags duplicate ids", () => {
    const normalized = normalizeRecords(
      [
        { ID: 1, "Company Name": "A & B", Website: "https://example.com" },
        { ID: 1, "Company Name": "C" }
      ],
      { sourceName: "test.csv", limits }
    );
    expect(normalized.records[0].raw["Company Name"]).toBe("A & B");
    expect(normalized.records[0].normalized.companyName).toBe("A & B");
    expect(normalized.records[1].validation.warnings.some((item) => item.code === "DUPLICATE_ID")).toBe(true);
  });

  it("generates stable internal ids when id is missing and preserves unicode", () => {
    const normalized = normalizeRecords([{ Name: "Unicode Café", Emoji: "✨" }], {
      sourceName: "u.csv",
      limits
    });
    expect(normalized.records[0].internalId).toMatch(/^generated-/);
    expect(normalized.records[0].normalized.name).toBe("Unicode Café");
  });
});
