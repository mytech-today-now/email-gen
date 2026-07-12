import { describe, expect, it } from "vitest";
import { JOB_STATUS } from "../../src/batch/jobState.js";
import { settledJobStatus } from "../../src/batch/batchManager.js";

describe("batch manager status settling", () => {
  it("marks an all-failed finished job as failed", () => {
    expect(settledJobStatus({ completed: 0, failed: 4 })).toBe(JOB_STATUS.FAILED);
  });

  it("keeps partially successful finished jobs completed with failed counts", () => {
    expect(settledJobStatus({ completed: 2, failed: 1 })).toBe(JOB_STATUS.COMPLETED);
  });

  it("keeps cancellation precedence over record counts", () => {
    expect(settledJobStatus({ completed: 0, failed: 4 }, { canceled: true })).toBe(JOB_STATUS.CANCELED);
  });
});
