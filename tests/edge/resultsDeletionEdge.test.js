import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestHarness } from "../helpers/appTestHarness.js";

let harness;

beforeEach(() => {
  harness = createTestHarness();
});

afterEach(() => {
  harness.cleanup();
});

describe("results deletion edge cases", () => {
  it("returns a safe error when bulk delete matches no results", async () => {
    const response = await harness.request
      .post("/api/results/delete")
      .send({ projectId: "project_default", resultIds: ["res_missing"] })
      .expect(404);
    expect(response.body.error.code).toBe("NO_RESULTS_DELETED");
  });

  it("returns a safe error when deleting a missing single result", async () => {
    const response = await harness.request
      .delete("/api/results/res_missing?projectId=project_default")
      .expect(404);
    expect(response.body.error.code).toBe("RESULT_NOT_FOUND");
  });
});
