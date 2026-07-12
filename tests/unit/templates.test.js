import { describe, expect, it } from "vitest";
import { discoverVariables, analyzeRecord } from "../../src/templates/variables.js";
import { renderTemplate } from "../../src/templates/renderer.js";

describe("template variables", () => {
  it("discovers required, optional, nested, and default variables", () => {
    const found = discoverVariables('Hi {{company|required}} {{contact.name?}} {{city|default:"Omaha"}}');
    expect(found.variables.map((item) => item.path)).toEqual(["company", "contact.name", "city"]);
    expect(found.variables[0].required).toBe(true);
    expect(found.variables[1].required).toBe(false);
    expect(found.variables[2].defaultValue).toBe("Omaha");
  });

  it("renders nested fields and preserves ampersands for prompts", () => {
    const result = renderTemplate("Hello {{name}} from {{contact.name}}", {
      name: "Tomo Sushi & Ramen",
      contact: { name: "Aki" }
    });
    expect(result.rendered).toBe("Hello Tomo Sushi & Ramen from Aki");
  });

  it("detects missing and blank required variables", () => {
    const analysis = analyzeRecord("{{name|required}} {{website|required}}", { name: "", city: "Omaha" });
    expect(analysis.canProcess).toBe(false);
    expect(analysis.blank).toContain("name");
    expect(analysis.missing).toContain("website");
  });
});
