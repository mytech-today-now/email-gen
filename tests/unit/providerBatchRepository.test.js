import { afterEach, describe, expect, it } from "vitest";
import { createTestHarness } from "../helpers/appTestHarness.js";

const harnesses = [];

afterEach(() => {
  while (harnesses.length) harnesses.pop().cleanup();
});

function setup(options) {
  const harness = createTestHarness(options);
  harnesses.push(harness);
  return harness;
}

describe("provider batch repository", () => {
  it("reuses the same row set for identical request hashes and rejects hash changes", () => {
    const harness = setup();
    const repo = harness.context.repositories.providerBatches;
    const base = {
      id: "job_hash_guard",
      requestHash: "pb_hash_1",
      clientRequestKey: "pb_hash_1",
      status: "submitting",
      state: "submitting",
      options: {
        provider: "openai",
        model: "gpt-5.6-sol"
      },
      providerBatch: {
        operationId: "job_hash_guard",
        requestHash: "pb_hash_1",
        provider: "openai",
        model: "gpt-5.6-sol",
        chunks: [
          {
            chunkId: "chunk_1",
            index: 0,
            requestHash: "pb_hash_1",
            state: "submitting",
            submissionState: "submitting",
            requestIntentAt: "2026-07-21T12:00:00.000Z"
          }
        ]
      }
    };

    const first = repo.create(base);
    const reused = repo.create({
      ...base,
      id: "job_hash_guard_retry"
    });

    expect(reused.id).toBe(first.id);
    expect(reused.requestHash).toBe(first.requestHash);

    expect(() =>
      repo.create({
        ...base,
        requestHash: "pb_hash_2",
        clientRequestKey: "pb_hash_2"
      })
    ).toThrowError(/different request hash/i);
  });
});
