import { describe, expect, it } from "vitest";
import { assertSafeArchivePath } from "../../public/modules/archive.js";
import { inspectBackup, previewRestore } from "../../public/modules/backup.js";
import { openBrowserRepository } from "../../public/modules/storage.js";
import { buildBackupData, makeBackupArchive } from "../helpers/backupFixtures.js";

describe("backup validation", () => {
  it("rejects unsafe archive paths", () => {
    expect(() => assertSafeArchivePath("data//projects.json")).toThrowError(/unsafe path/i);
    expect(() => assertSafeArchivePath("data/projects.json\0")).toThrowError(/unsafe path/i);
  });

  it("rejects backups with broken cross-store relationships", async () => {
    const data = buildBackupData();
    data.results[0].jobId = "missing-job";
    const { archive } = makeBackupArchive(data);

    await expect(inspectBackup(archive)).rejects.toMatchObject({
      code: "BACKUP_RELATION_MISSING"
    });
  });

  it("rejects backups with oversized string fields", async () => {
    const data = buildBackupData();
    data.projects[0].name = "x".repeat(13_000);
    const { archive } = makeBackupArchive(data);

    await expect(inspectBackup(archive)).rejects.toMatchObject({
      code: "BACKUP_FIELD_TOO_LARGE"
    });
  });

  it("previews duplicate restores without mutating the repository", async () => {
    const repository = await openBrowserRepository();
    const data = buildBackupData();
    await repository.put("projects", {
      id: "existing-project",
      name: "Existing project",
      sourceName: "existing.csv",
      templateId: null,
      recordCount: 0,
      createdAt: "2026-07-22T00:00:00.000Z",
      updatedAt: "2026-07-22T00:00:00.000Z"
    });
    await repository.put("settings", {
      key: "application",
      activeProjectId: "existing-project",
      selectedModel: null,
      updatedAt: "2026-07-22T00:00:00.000Z"
    });
    const before = await repository.snapshot([
      "projects",
      "records",
      "templates",
      "templateVersions",
      "jobs",
      "results",
      "resultVersions",
      "deliveryHistory",
      "settings"
    ]);
    const { archive } = makeBackupArchive(data);
    const inspected = await inspectBackup(archive);
    const preview = await previewRestore(repository, inspected, { conflict: "duplicate" });
    const after = await repository.snapshot([
      "projects",
      "records",
      "templates",
      "templateVersions",
      "jobs",
      "results",
      "resultVersions",
      "deliveryHistory",
      "settings"
    ]);

    expect(after).toEqual(before);
    expect(preview.storePlans.find((item) => item.store === "projects")).toMatchObject({
      action: "duplicate"
    });
    expect(preview.storePlans.find((item) => item.store === "settings")).toMatchObject({
      action: "merge"
    });

    const nextProjectId = preview.preparedData.projects[0].id;
    const nextRecordId = preview.preparedData.records[0].id;
    const nextJobId = preview.preparedData.jobs[0].id;
    const nextResultId = preview.preparedData.results[0].id;

    expect(preview.preparedData.settings[0].activeProjectId).toBe(nextProjectId);
    expect(preview.preparedData.records[0].projectId).toBe(nextProjectId);
    expect(preview.preparedData.jobs[0].operationId).toBe(nextJobId);
    expect(preview.preparedData.jobs[0].providerBatch.operationId).toBe(nextJobId);
    expect(preview.preparedData.jobs[0].providerBatch.requests[0].recordId).toBe(nextRecordId);
    expect(preview.preparedData.jobs[0].providerBatch.chunks[0].recordIds[0]).toBe(nextRecordId);
    expect(preview.preparedData.results[0].projectId).toBe(nextProjectId);
    expect(preview.preparedData.results[0].jobId).toBe(nextJobId);
    expect(preview.preparedData.results[0].recordId).toBe(nextRecordId);
    expect(preview.preparedData.resultVersions[0].resultId).toBe(nextResultId);
    expect(preview.preparedData.deliveryHistory[0].resultId).toBe(nextResultId);
    expect(preview.summaryText).toContain("Restore preview");
  });
});
