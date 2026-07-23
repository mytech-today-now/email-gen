import fs from "node:fs";
import { describe, expect, it } from "vitest";

const appJs = fs.readFileSync("public/app.js", "utf8");
const storageJs = fs.readFileSync("public/modules/storage.js", "utf8");

describe("browser persistence fallback regression", () => {
  it("uses browser storage as the project source of truth", () => {
    expect(appJs).toContain('state.repository.all("projects")');
    expect(appJs).toContain('state.repository.all("records")');
    expect(appJs).not.toContain('api("/api/projects"');
    expect(appJs).not.toContain("projectApiAvailable");
  });

  it("keeps a clearly marked temporary fallback when IndexedDB is unavailable", () => {
    expect(storageJs).toContain("class TemporaryRepository");
    expect(storageJs).toContain("this.temporary = true");
    expect(appJs).toContain("Running in temporary mode; export before closing the page.");
  });
});
