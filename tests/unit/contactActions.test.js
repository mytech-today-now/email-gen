import { describe, expect, it } from "vitest";
import { contactCandidatesForResult, renderContactActions } from "../../src/output/contactActions.js";

describe("contact actions", () => {
  it("builds phone and website actions from normalized records", () => {
    const record = {
      sourceName: "restaurants.json",
      normalized: {
        name: "712 Eat + Drink",
        phone: "(712) 256-5525",
        website: "http://sevenonetwocb.com/"
      }
    };

    const candidates = contactCandidatesForResult({}, record);
    expect(candidates.map((candidate) => candidate.type)).toEqual(["phone", "website"]);

    const html = renderContactActions(candidates);
    expect(html).toContain('href="tel:7122565525"');
    expect(html).toContain("(712) 256-5525");
    expect(html).toContain('href="http://sevenonetwocb.com/"');
    expect(html).not.toContain("No contact method found");
  });

  it("prefers valid imported email while retaining website and phone actions", () => {
    const record = {
      sourceName: "restaurants.json",
      normalized: {
        email: "owner@example.com",
        phone: "(712) 322-0306",
        website: "https://www.barleysbar.com/"
      }
    };

    const candidates = contactCandidatesForResult({}, record);
    expect(candidates[0]).toMatchObject({ type: "email", value: "owner@example.com" });
    expect(candidates.map((candidate) => candidate.type)).toEqual(["email", "phone", "website"]);
  });
});
