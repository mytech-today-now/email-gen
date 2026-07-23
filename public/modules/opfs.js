const LARGE_ARTIFACT_BYTES = 20 * 1024 * 1024;

function safeEntryName(value) {
  return String(value || "artifact.bin")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .slice(-180);
}

export async function stageLargeArtifact(blob, filename, { threshold = LARGE_ARTIFACT_BYTES } = {}) {
  if (blob.size < threshold || !navigator.storage?.getDirectory) {
    return { blob, storage: "memory", cleanup: async () => {} };
  }
  try {
    const root = await navigator.storage.getDirectory();
    const directory = await root.getDirectoryHandle("generated-artifacts", { create: true });
    const entryName = `${crypto.randomUUID()}-${safeEntryName(filename)}`;
    const handle = await directory.getFileHandle(entryName, { create: true });
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
    return {
      blob: await handle.getFile(),
      storage: "opfs",
      cleanup: () => directory.removeEntry(entryName).catch(() => {})
    };
  } catch {
    return { blob, storage: "memory-fallback", cleanup: async () => {} };
  }
}
