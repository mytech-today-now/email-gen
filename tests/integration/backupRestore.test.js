import { describe, expect, it } from "vitest";
import { inspectBackup, previewRestore, restoreBackup } from "../../public/modules/backup.js";
import { openBrowserRepository } from "../../public/modules/storage.js";
import { buildBackupData, makeBackupArchive } from "../helpers/backupFixtures.js";

const SNAPSHOT_STORES = [
  "projects",
  "records",
  "templates",
  "templateVersions",
  "jobs",
  "results",
  "resultVersions",
  "deliveryHistory",
  "settings"
];

async function seedRepository(repository) {
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
}

async function snapshotRepository(repository) {
  return repository.snapshot(SNAPSHOT_STORES);
}

function totalPreparedWrites(preparedData) {
  return Object.values(preparedData).reduce((sum, records) => sum + records.length, 0);
}

describe("backup restore integration", () => {
  it("restores a valid backup atomically and rewrites imported references", async () => {
    const repository = await openBrowserRepository();
    await seedRepository(repository);
    const before = await snapshotRepository(repository);
    const { archive } = makeBackupArchive(buildBackupData());
    const inspected = await inspectBackup(archive);
    const preview = await previewRestore(repository, inspected, { conflict: "duplicate" });
    const restored = await restoreBackup(repository, inspected, { conflict: "duplicate" });
    const after = await snapshotRepository(repository);

    expect(repository.temporary).toBe(true);
    expect(after).not.toEqual(before);
    expect(restored.plan.summaryText).toBe(preview.summaryText);
    expect(restored.plan.detailText).toBe(preview.detailText);
    expect(restored.summary).toEqual({
      projects: 1,
      records: 1,
      templates: 1,
      templateVersions: 1,
      jobs: 1,
      results: 1,
      resultVersions: 1,
      deliveryHistory: 1,
      settings: 1
    });

    const importedProject = after.projects.find(
      (project) => project.name === "Source project (imported copy)"
    );
    const importedRecord = after.records.find((record) => record.displayName === "Record One");
    const importedTemplate = after.templates.find(
      (template) => template.name === "Welcome template (imported copy)"
    );
    const importedJob = after.jobs[0];
    const importedResult = after.results[0];
    const importedVersion = after.resultVersions[0];
    const importedDelivery = after.deliveryHistory[0];

    expect(importedProject).toBeDefined();
    expect(importedRecord).toBeDefined();
    expect(importedTemplate).toBeDefined();
    expect(importedJob).toBeDefined();
    expect(importedResult).toBeDefined();
    expect(importedVersion).toBeDefined();
    expect(importedDelivery).toBeDefined();
    expect(importedProject).toMatchObject({
      name: "Source project (imported copy)",
      templateId: importedTemplate.id
    });
    expect(importedRecord).toMatchObject({
      projectId: importedProject.id
    });
    expect(importedJob).toMatchObject({
      operationId: importedJob.id,
      providerBatch: expect.objectContaining({
        operationId: importedJob.id,
        requests: [expect.objectContaining({ recordId: importedRecord.id })],
        chunks: [expect.objectContaining({ recordIds: [importedRecord.id] })]
      })
    });
    expect(importedResult).toMatchObject({
      projectId: importedProject.id,
      jobId: importedJob.id,
      recordId: importedRecord.id,
      templateId: importedTemplate.id
    });
    expect(importedVersion).toMatchObject({
      resultId: importedResult.id
    });
    expect(importedDelivery).toMatchObject({
      resultId: importedResult.id
    });
    expect(after.settings[0]).toMatchObject({
      activeProjectId: importedProject.id
    });
  });

  it("rejects invalid backups without mutating the repository", async () => {
    const repository = await openBrowserRepository();
    await seedRepository(repository);
    const before = await snapshotRepository(repository);
    const data = buildBackupData();
    data.results[0].jobId = "missing-job";
    const { archive } = makeBackupArchive(data);

    await expect(inspectBackup(archive)).rejects.toMatchObject({
      code: "BACKUP_RELATION_MISSING"
    });

    const after = await snapshotRepository(repository);
    expect(after).toEqual(before);
  });

  for (const [label, failureMode] of [
    ["first", "first"],
    ["middle", "middle"],
    ["final", "final"]
  ]) {
    it(`rolls back when the ${label} write fails`, async () => {
      const repository = await openBrowserRepository();
      await seedRepository(repository);
      const before = await snapshotRepository(repository);
      const { archive } = makeBackupArchive(buildBackupData());
      const inspected = await inspectBackup(archive);
      const preview = await previewRestore(repository, inspected, { conflict: "duplicate" });
      const totalWrites = totalPreparedWrites(preview.preparedData);
      const failOn =
        failureMode === "first" ? 1 : failureMode === "middle" ? Math.ceil(totalWrites / 2) : totalWrites;
      let writeCount = 0;
      const originalPut = repository.put.bind(repository);
      repository.put = async (store, value) => {
        writeCount += 1;
        if (writeCount === failOn) {
          throw new Error(`simulated write failure during the ${label} write`);
        }
        return originalPut(store, value);
      };

      await expect(restoreBackup(repository, inspected, { conflict: "duplicate" })).rejects.toThrow(
        /simulated write failure/i
      );
      const after = await snapshotRepository(repository);
      expect(after).toEqual(before);
    });
  }
});
