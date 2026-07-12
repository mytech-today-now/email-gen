import { describe, expect, it } from "vitest";
import { parseImportBuffer } from "../../src/data/importer.js";

const limits = { uploadBytes: 100000, records: 100, fields: 20, fieldBytes: 1000 };

describe("import edge cases", () => {
  it("imports CSV and blank rows without crashing", () => {
    const parsed = parseImportBuffer({
      buffer: Buffer.from("id,name\n1,A\n,\n2,B\n"),
      filename: "x.csv",
      limits
    });
    expect(parsed.records).toHaveLength(2);
  });

  it("rejects executable JavaScript data files", () => {
    expect(() =>
      parseImportBuffer({
        buffer: Buffer.from("export default fetch('https://example.com')"),
        filename: "x.js",
        limits
      })
    ).toThrow(/static array or object/);
  });

  it("rejects Apple Numbers directly", () => {
    expect(() =>
      parseImportBuffer({ buffer: Buffer.from("not a numbers file"), filename: "x.numbers", limits })
    ).toThrow(/Apple Numbers/);
  });
});
