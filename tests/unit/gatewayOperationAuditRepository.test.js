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

describe("gateway operation audit repository", () => {
  it("verifies the hash chain and detects tampering", () => {
    const harness = setup();
    const repo = harness.context.repositories.gatewayOperationAudits;

    repo.append("audit-operation-1", {
      eventType: "resend_operation_committed",
      projectId: "project-1",
      requestId: "req-1",
      payloadDigest: "payload-a",
      suppressionDigest: "suppression-a"
    });
    repo.append("audit-operation-1", {
      eventType: "resend_chunk_intent",
      projectId: "project-1",
      chunkIndex: 0,
      idempotencyKey: "email-gen/test",
      messageDigests: ["message-a"]
    });

    expect(repo.verify("audit-operation-1")).toMatchObject({
      ok: true,
      entryCount: 2
    });

    harness.context.db
      .prepare("UPDATE gateway_operation_audit SET event_json = ? WHERE operation_id = ? AND event_index = ?")
      .run(
        JSON.stringify({ eventType: "resend_chunk_intent", chunkIndex: 0, tampered: true }),
        "audit-operation-1",
        1
      );

    expect(repo.verify("audit-operation-1")).toMatchObject({
      ok: false,
      reason: "AUDIT_HASH_MISMATCH",
      entryIndex: 1
    });
  });
});
