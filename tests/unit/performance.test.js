import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import { columnUnion, sortAndFilterRecords } from "../../public/modules/records.js";

describe("bounded large-dataset browser transformations", () => {
  it("unions, filters, and sorts the configured 1,000-record maximum within a responsive budget", () => {
    const records = Array.from({ length: 1000 }, (_, index) => ({
      id: `record-${index}`,
      displayName: `Restaurant ${String(index).padStart(4, "0")}`,
      status: index % 13 === 0 ? "invalid" : "ready",
      normalized: Object.fromEntries([
        ...Array.from({ length: 36 }, (__, field) => [`field_${field}`, `${index}-${field}`]),
        ["address", { city: index % 2 ? "Omaha" : "Lincoln", geo: { lat: 41 + index / 10000 } }]
      ])
    }));
    const started = performance.now();
    const columns = columnUnion(records, ["address.city", "field_1"]);
    const visible = sortAndFilterRecords(records, {
      search: "field_",
      filter: "all",
      sortKey: "displayName",
      direction: "desc"
    });
    const elapsedMs = performance.now() - started;
    expect(columns.length).toBeGreaterThanOrEqual(38);
    expect(visible).toHaveLength(1000);
    expect(elapsedMs).toBeLessThan(1500);
  });
});
