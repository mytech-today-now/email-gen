import fs from "node:fs";
import { describe, expect, it } from "vitest";

const appJs = fs.readFileSync("public/app.js", "utf8");

describe("project fallback edge behavior", () => {
  it("preserves API failure metadata for graceful fallback and console diagnostics", () => {
    expect(appJs).toContain("error.status = response.status");
    expect(appJs).toContain("error.code = payload?.error?.code");
    expect(appJs).toContain("error.requestId = payload?.error?.requestId");
    expect(appJs).toContain('console.error("API request failed"');
  });
});
