import { describe, expect, it } from "vitest";
import { responsiveViewportCases } from "../helpers/responsiveViewports.js";

describe("responsive layout edge cases", () => {
  it("covers the requested extreme, legacy, tablet, and phone viewport families", () => {
    expect(new Set(responsiveViewportCases.map((item) => item.family))).toEqual(
      new Set([
        "8K",
        "4K",
        "2K",
        "1028",
        "720",
        "640",
        "512",
        "480",
        "NTSC",
        "PAL",
        "Tablet",
        "Cell phone",
        "iPhone"
      ])
    );
  });

  it("includes narrow portrait and short landscape cases that stress wrapping", () => {
    expect(Math.min(...responsiveViewportCases.map((item) => item.width))).toBeLessThanOrEqual(360);
    expect(Math.min(...responsiveViewportCases.map((item) => item.height))).toBeLessThanOrEqual(360);
    expect(responsiveViewportCases.some((item) => item.width > 7000)).toBe(true);
  });
});
