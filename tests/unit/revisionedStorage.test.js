import { describe, expect, it } from "vitest";
import { openBrowserRepository } from "../../public/modules/storage.js";

describe("revisioned browser storage", () => {
  it("rejects stale compare-and-swap writes for revisioned stores", async () => {
    const repository = await openBrowserRepository();
    expect(repository.temporary).toBe(true);

    const created = await repository.compareAndSwap("operations", "scope-1", 0, {
      scopeKey: "scope-1",
      operationId: "operation-1",
      kind: "process",
      status: "prepared"
    });
    expect(created.revision).toBe(0);

    const updated = await repository.compareAndSwap("operations", "scope-1", 0, {
      ...created,
      status: "in-progress"
    });
    expect(updated.revision).toBe(1);
    expect(updated.status).toBe("in-progress");

    await expect(
      repository.compareAndSwap("operations", "scope-1", 0, {
        ...updated,
        status: "succeeded"
      })
    ).rejects.toMatchObject({
      code: "REVISION_CONFLICT",
      store: "operations",
      key: "scope-1",
      expectedRevision: 0,
      latest: expect.objectContaining({
        revision: 1,
        status: "in-progress"
      })
    });
  });
});
