import { describe, expect, it } from "vitest";
import { allRestaurants } from "../../data/restaurants.js";
import { normalizeRecords } from "../../src/data/normalizer.js";
import { renderTemplate } from "../../src/templates/renderer.js";

const limits = { records: 1000, fields: 100, fieldBytes: 12000 };

describe("regressions", () => {
  it("restaurant values render into prompts correctly", () => {
    const [record] = normalizeRecords(allRestaurants, { sourceName: "sample", limits }).records;
    const rendered = renderTemplate("{{name}} -> {{website}}", record.normalized).rendered;
    expect(rendered).toBe("Acadian Grille & Bar -> https://acadiangrille.com/");
  });

  it("unresolved required placeholders are never silently processable", () => {
    const [record] = normalizeRecords([{ id: 1, name: "Only Name" }], {
      sourceName: "sample",
      limits
    }).records;
    expect(() => renderTemplate("{{website|required}}", record.normalized)).toThrow(
      /Required template variables/
    );
  });
});
