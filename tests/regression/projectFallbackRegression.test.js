import fs from "node:fs";
import { describe, expect, it } from "vitest";

const appJs = fs.readFileSync("public/app.js", "utf8");

describe("project API fallback regression", () => {
  it("keeps the browser usable when /api/projects is unavailable", () => {
    expect(appJs).toContain("projectApiAvailable");
    expect(appJs).toContain("legacyProjectFromCounts");
    expect(appJs).toContain("Project API unavailable; using current-data fallback.");
    expect(appJs).toContain('error.code !== "ROUTE_NOT_FOUND"');
  });

  it("does not append projectId query strings while running against a legacy API", () => {
    expect(appJs).toContain("state.projectApiAvailable && state.activeProjectId");
  });
});
