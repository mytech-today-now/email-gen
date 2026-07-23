import { LIMIT_DEFAULTS, utf8ByteLength } from "./limits.js";

const DEFAULT_LIMITS = Object.freeze({
  archiveBytes: LIMIT_DEFAULTS.archiveBytes,
  archiveExpandedBytes: LIMIT_DEFAULTS.archiveExpandedBytes,
  archiveEntries: LIMIT_DEFAULTS.archiveEntries,
  archiveEntryBytes: LIMIT_DEFAULTS.archiveEntryBytes,
  archiveInMemoryBytes: LIMIT_DEFAULTS.archiveInMemoryBytes,
  workerChunkBytes: LIMIT_DEFAULTS.workerChunkBytes,
  workerMaxQueuedChunks: LIMIT_DEFAULTS.workerMaxQueuedChunks,
  workerMaxQueuedBytes: LIMIT_DEFAULTS.workerMaxQueuedBytes
});

const textEncoder = new TextEncoder();
let fflateModulePromise = null;

async function loadFflateModule() {
  if (!fflateModulePromise) {
    fflateModulePromise = import("/vendor/fflate.js").catch(() => import("fflate"));
  }
  return fflateModulePromise;
}

function safeName(value) {
  return String(value || "archive.zip")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .slice(-180);
}

export function normalizeArchiveLimits(limits = {}) {
  return { ...DEFAULT_LIMITS, ...(limits ?? {}) };
}

function canonicalArchivePath(path) {
  return String(path ?? "")
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .toLowerCase();
}

export function assertSafeArchivePath(path) {
  const value = String(path ?? "");
  if (
    !value ||
    utf8ByteLength(value) > LIMIT_DEFAULTS.archivePathBytes ||
    !/^[a-zA-Z0-9._/-]+$/.test(value) ||
    value.includes("\0") ||
    value.includes("..") ||
    value.includes("//") ||
    value.startsWith("/") ||
    value.endsWith("/") ||
    value.includes("\\") ||
    value.split("/").some((part) => part === "." || part === ".." || part === "")
  ) {
    throw Object.assign(new Error("Archive contains an unsafe path."), { code: "ARCHIVE_PATH_UNSAFE" });
  }
}

function toBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return textEncoder.encode(String(value ?? ""));
}

function concatBytes(chunks, totalBytes) {
  if (!chunks.length) return new Uint8Array(0);
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function* chunkValue(value, chunkSize = DEFAULT_LIMITS.workerChunkBytes) {
  if (value === undefined || value === null) return;
  if (value instanceof Blob) {
    const reader = value.stream().getReader();
    try {
      while (true) {
        const { done, value: chunk } = await reader.read();
        if (done) break;
        yield* chunkValue(chunk, chunkSize);
      }
    } finally {
      reader.releaseLock();
    }
    return;
  }
  if (value instanceof Uint8Array || ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
    const bytes = toBytes(value);
    for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
      yield bytes.subarray(offset, Math.min(bytes.byteLength, offset + chunkSize));
    }
    return;
  }
  const bytes = textEncoder.encode(String(value));
  for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
    yield bytes.subarray(offset, Math.min(bytes.byteLength, offset + chunkSize));
  }
}

async function* normalizeEntrySource(entry, chunkSize = DEFAULT_LIMITS.workerChunkBytes) {
  if (entry?.source) {
    const source = await entry.source();
    if (source?.[Symbol.asyncIterator]) {
      for await (const chunk of source) yield* chunkValue(chunk, chunkSize);
      return;
    }
    if (source?.[Symbol.iterator]) {
      for (const chunk of source) yield* chunkValue(chunk, chunkSize);
      return;
    }
    yield* chunkValue(source, chunkSize);
    return;
  }
  yield* chunkValue(entry?.content, chunkSize);
}

function createMemorySink() {
  const parts = [];
  let bytesWritten = 0;
  return {
    storage: "memory",
    async write(chunk) {
      const bytes = toBytes(chunk);
      parts.push(bytes);
      bytesWritten += bytes.byteLength;
    },
    async finalize() {
      return new Blob(parts, { type: "application/zip" });
    },
    async cleanup() {},
    get bytesWritten() {
      return bytesWritten;
    }
  };
}

async function openOpfsSink(filename) {
  if (typeof navigator === "undefined" || !navigator.storage?.getDirectory) return null;
  const root = await navigator.storage.getDirectory();
  const directory = await root.getDirectoryHandle("generated-archives", { create: true });
  const entryName = `${crypto.randomUUID()}-${safeName(filename)}.part`;
  const handle = await directory.getFileHandle(entryName, { create: true });
  const writable = await handle.createWritable();
  return {
    storage: "opfs",
    async write(chunk) {
      await writable.write(chunk);
    },
    async finalize() {
      await writable.close();
      return handle.getFile();
    },
    async cleanup() {
      try {
        await writable.abort();
      } catch {
        // ignore cleanup failures
      }
      await directory.removeEntry(entryName).catch(() => {});
    },
    get bytesWritten() {
      return null;
    }
  };
}

async function openFilePickerSink(filename) {
  if (!globalThis.showSaveFilePicker) return null;
  const handle = await showSaveFilePicker({
    suggestedName: filename,
    types: [
      {
        description: "ZIP archive",
        accept: {
          "application/zip": [".zip", ".emailgen"]
        }
      }
    ]
  });
  const writable = await handle.createWritable();
  return {
    storage: "file-picker",
    async write(chunk) {
      await writable.write(chunk);
    },
    async finalize() {
      await writable.close();
      return handle.getFile();
    },
    async cleanup() {
      try {
        await writable.abort();
      } catch {
        // ignore cleanup failures
      }
    },
    get bytesWritten() {
      return null;
    }
  };
}

async function openArchiveSink(filename, { estimatedBytes, limits }) {
  const opfsSink = await openOpfsSink(filename);
  if (opfsSink) return opfsSink;
  const pickerSink = await openFilePickerSink(filename);
  if (pickerSink) return pickerSink;
  if (Number.isFinite(estimatedBytes) && estimatedBytes <= limits.archiveInMemoryBytes) {
    return createMemorySink();
  }
  throw Object.assign(new Error("No safe browser storage option is available for this archive."), {
    code: "ARCHIVE_STORAGE_UNAVAILABLE",
    details: {
      estimatedBytes: Number.isFinite(estimatedBytes) ? estimatedBytes : null,
      inMemoryLimit: limits.archiveInMemoryBytes
    }
  });
}

function throttleProgress(callback) {
  if (typeof callback !== "function") return () => {};
  let last = 0;
  let pending = null;
  return (state, force = false) => {
    pending = state;
    const now = performance.now();
    if (!force && now - last < 80) return;
    last = now;
    callback(pending);
  };
}

function normalizeError(error, fallbackCode = "ARCHIVE_FAILED") {
  if (error?.name === "AbortError") {
    return Object.assign(new Error(error?.message || "Archive operation cancelled."), {
      code: "ARCHIVE_CANCELLED"
    });
  }
  if (error?.code) return error;
  return Object.assign(new Error(error?.message || "Archive operation failed."), {
    code: fallbackCode
  });
}

function shouldUseArchiveWorker() {
  if (typeof Worker === "undefined") return false;
  const userAgent = typeof navigator !== "undefined" ? String(navigator.userAgent || "") : "";
  const isWebKit = /AppleWebKit/i.test(userAgent) && !/(Chrome|Chromium|Edg|OPR)\//i.test(userAgent);
  return !isWebKit;
}

async function finalizeVerification(file, expectedPaths, limits, signal = null) {
  if (!expectedPaths?.length) return;
  await inspectArchive(file, {
    limits,
    expectedPaths,
    collectContents: false,
    signal
  });
}

async function streamArchiveInProcess({
  filename,
  entries,
  estimatedBytes = null,
  limits = {},
  signal = null,
  onProgress = null,
  verifyExpectedPaths = true
}) {
  const archiveLimits = normalizeArchiveLimits(limits);
  const { Zip, ZipPassThrough } = await loadFflateModule();
  const sink = await openArchiveSink(filename, {
    estimatedBytes,
    limits: archiveLimits
  });
  const progress = throttleProgress(onProgress);
  const expectedPaths = entries.map((entry) => entry.path);
  if (entries.length > archiveLimits.archiveEntries) {
    throw Object.assign(new Error("Archive contains too many entries."), {
      code: "ARCHIVE_TOO_MANY_ENTRIES"
    });
  }
  let settled = false;
  let cleaned = false;
  let bytesRead = 0;
  let bytesWritten = 0;
  let completedEntries = 0;
  let currentPhase = "initializing";
  let currentEntryBytes;
  let outputWrite = Promise.resolve();
  let completionResolve;
  let completionReject;
  const queueWaiters = [];
  const completion = new Promise((resolve, reject) => {
    completionResolve = resolve;
    completionReject = reject;
  });

  const flushQueueWaiters = () => {
    while (queueWaiters.length) queueWaiters.shift()?.resolve?.();
  };

  const cleanup = async () => {
    if (cleaned) return;
    cleaned = true;
    flushQueueWaiters();
    await sink.cleanup().catch(() => {});
  };

  const fail = async (error) => {
    if (settled) return;
    settled = true;
    await cleanup();
    completionReject(normalizeError(error));
  };

  const finish = async (result) => {
    if (settled) return;
    settled = true;
    completionResolve(result);
  };

  const waitForQueueCapacity = async (nextBytes) => {
    if (nextBytes > archiveLimits.workerMaxQueuedBytes) {
      throw Object.assign(new Error("Archive chunk exceeds the configured worker queue size."), {
        code: "ARCHIVE_WORKER_LIMIT_EXCEEDED"
      });
    }
    while (queueWaiters.length) {
      await new Promise((resolve) => queueWaiters.push({ resolve }));
      flushQueueWaiters();
      break;
    }
  };

  const zip = new Zip((error, chunk, final) => {
    if (error) {
      fail(error);
      return;
    }
    const bytes = toBytes(chunk);
    bytesWritten += bytes.byteLength;
    if (bytesWritten > archiveLimits.archiveBytes) {
      fail(
        Object.assign(new Error("Archive exceeds the configured size limit."), {
          code: "ARCHIVE_TOO_LARGE"
        })
      );
      return;
    }
    currentPhase = "writing";
    outputWrite = outputWrite
      .then(() => sink.write(bytes))
      .catch((writeError) => {
        fail(normalizeError(writeError, "ARCHIVE_WRITE_FAILED"));
      });
    progress(
      {
        phase: currentPhase,
        entriesCompleted: completedEntries,
        entriesTotal: entries.length,
        bytesRead,
        bytesWritten,
        final: Boolean(final)
      },
      Boolean(final)
    );
    if (final) {
      outputWrite
        .then(async () => {
          const file = await sink.finalize();
          if (verifyExpectedPaths) {
            await finalizeVerification(file, expectedPaths, archiveLimits, signal);
          }
          progress(
            {
              phase: "completed",
              entriesCompleted: completedEntries,
              entriesTotal: entries.length,
              bytesRead,
              bytesWritten,
              complete: true
            },
            true
          );
          await finish({
            file,
            storage: sink.storage,
            bytesRead,
            bytesWritten,
            entryCount: entries.length,
            cleanup
          });
        })
        .catch((writeError) => {
          fail(writeError);
        });
    }
  });

  const abortHandler = signal
    ? () => {
        fail(signal.reason ?? new DOMException("Aborted", "AbortError"));
      }
    : null;

  if (signal) {
    if (signal.aborted) {
      await fail(signal.reason ?? new DOMException("Aborted", "AbortError"));
      return completion;
    }
    signal.addEventListener("abort", abortHandler, { once: true });
  }

  const detachAbort = () => {
    if (signal && abortHandler) signal.removeEventListener("abort", abortHandler);
  };

  progress(
    {
      phase: currentPhase,
      entriesCompleted: completedEntries,
      entriesTotal: entries.length,
      bytesRead,
      bytesWritten
    },
    true
  );

  try {
    for (const entry of entries) {
      if (signal?.aborted) {
        throw signal.reason ?? new DOMException("Aborted", "AbortError");
      }
      assertSafeArchivePath(entry.path);
      currentEntryBytes = 0;
      const archiveEntry = new ZipPassThrough(entry.path);
      zip.add(archiveEntry);
      currentPhase = "compressing";
      progress({
        phase: currentPhase,
        currentEntry: entry.path,
        entriesCompleted: completedEntries,
        entriesTotal: entries.length,
        bytesRead,
        bytesWritten
      });

      let pending = null;
      for await (const chunk of normalizeEntrySource(entry, archiveLimits.workerChunkBytes)) {
        const bytes = toBytes(chunk);
        bytesRead += bytes.byteLength;
        currentEntryBytes += bytes.byteLength;
        if (bytesRead > archiveLimits.archiveExpandedBytes) {
          throw Object.assign(new Error("Archive source exceeds the configured expanded size limit."), {
            code: "ARCHIVE_EXPANDED_LIMIT_EXCEEDED"
          });
        }
        if (currentEntryBytes > archiveLimits.archiveEntryBytes) {
          throw Object.assign(new Error(`Archive entry ${entry.path} exceeds the configured size limit.`), {
            code: "ARCHIVE_ENTRY_TOO_LARGE"
          });
        }
        if (pending) {
          await waitForQueueCapacity(pending.byteLength);
          archiveEntry.push(pending, false);
        }
        pending = bytes;
      }
      if (pending) {
        await waitForQueueCapacity(pending.byteLength);
        archiveEntry.push(pending, true);
      } else {
        archiveEntry.push(new Uint8Array(0), true);
      }
      completedEntries += 1;
      progress({
        phase: currentPhase,
        currentEntry: entry.path,
        entriesCompleted: completedEntries,
        entriesTotal: entries.length,
        bytesRead,
        bytesWritten
      });
    }
    zip.end();
  } catch (error) {
    await fail(error);
  } finally {
    detachAbort();
  }

  return completion;
}

export async function streamArchive({
  filename,
  entries,
  estimatedBytes = null,
  limits = {},
  signal = null,
  onProgress = null,
  verifyExpectedPaths = true
}) {
  if (!shouldUseArchiveWorker()) {
    return streamArchiveInProcess({
      filename,
      entries,
      estimatedBytes,
      limits,
      signal,
      onProgress,
      verifyExpectedPaths
    });
  }
  const archiveLimits = normalizeArchiveLimits(limits);
  const jobId = crypto.randomUUID();
  const worker = new Worker(new URL("../workers/archiveWorker.js", import.meta.url), {
    type: "module"
  });
  const sink = await openArchiveSink(filename, {
    estimatedBytes,
    limits: archiveLimits
  });
  const progress = throttleProgress(onProgress);
  const expectedPaths = entries.map((entry) => entry.path);
  if (entries.length > archiveLimits.archiveEntries) {
    throw Object.assign(new Error("Archive contains too many entries."), {
      code: "ARCHIVE_TOO_MANY_ENTRIES"
    });
  }
  let settled = false;
  let cleaned = false;
  let workerReleased = false;
  let abortHandler = null;
  let queuedChunkBytes = 0;
  let queuedChunkCount = 0;
  let queueFailure = null;
  const queueWaiters = [];
  let bytesRead = 0;
  let bytesWritten = 0;
  let completedEntries = 0;
  let currentPhase = "initializing";
  let currentEntryBytes;
  let outputWrite = Promise.resolve();
  let completionResolve;
  let completionReject;
  const completion = new Promise((resolve, reject) => {
    completionResolve = resolve;
    completionReject = reject;
  });

  const releaseWorker = () => {
    if (workerReleased) return;
    workerReleased = true;
    worker.terminate();
  };

  const detachAbort = () => {
    if (signal && abortHandler) signal.removeEventListener("abort", abortHandler);
  };

  const cleanup = async () => {
    if (cleaned) return;
    cleaned = true;
    detachAbort();
    releaseWorker();
    await sink.cleanup().catch(() => {});
  };

  const flushQueueWaiters = () => {
    if (queueFailure || settled) {
      while (queueWaiters.length) queueWaiters.shift()?.resolve?.();
      return;
    }
    while (
      queueWaiters.length &&
      queuedChunkCount < archiveLimits.workerMaxQueuedChunks &&
      queuedChunkBytes + queueWaiters[0].nextBytes <= archiveLimits.workerMaxQueuedBytes
    ) {
      queueWaiters.shift()?.resolve?.();
    }
  };

  const releaseQueueWaiters = () => {
    while (queueWaiters.length) queueWaiters.shift()?.resolve?.();
  };

  const waitForQueueCapacity = async (nextBytes) => {
    if (nextBytes > archiveLimits.workerMaxQueuedBytes) {
      throw Object.assign(new Error("Archive chunk exceeds the configured worker queue size."), {
        code: "ARCHIVE_WORKER_LIMIT_EXCEEDED"
      });
    }
    while (
      !settled &&
      (queuedChunkCount >= archiveLimits.workerMaxQueuedChunks ||
        queuedChunkBytes + nextBytes > archiveLimits.workerMaxQueuedBytes)
    ) {
      await new Promise((resolve) => queueWaiters.push({ nextBytes, resolve }));
      if (queueFailure) throw queueFailure;
      if (settled) throw queueFailure ?? signal?.reason ?? new DOMException("Aborted", "AbortError");
    }
  };

  const fail = async (error) => {
    if (settled) return;
    settled = true;
    const normalized = normalizeError(error);
    queueFailure = normalized;
    releaseQueueWaiters();
    await cleanup();
    completionReject(normalized);
  };

  const finish = async (result) => {
    if (settled) return;
    settled = true;
    detachAbort();
    releaseWorker();
    completionResolve(result);
  };

  abortHandler = signal
    ? () => {
        worker.postMessage({ type: "cancel", jobId });
      }
    : null;

  if (signal) {
    if (signal.aborted) {
      await fail(signal.reason ?? new DOMException("Aborted", "AbortError"));
      return completion;
    }
    signal.addEventListener("abort", abortHandler, { once: true });
  }

  worker.onmessage = (event) => {
    const message = event.data ?? {};
    if (message.jobId !== jobId) return;
    if (message.type === "ready") {
      currentPhase = "compressing";
      progress(
        {
          phase: currentPhase,
          entriesCompleted: completedEntries,
          entriesTotal: entries.length,
          bytesRead,
          bytesWritten
        },
        true
      );
      return;
    }
    if (message.type === "entry-started") {
      currentPhase = "compressing";
      currentEntryBytes = 0;
      progress({
        phase: currentPhase,
        currentEntry: message.path,
        entriesCompleted: completedEntries,
        entriesTotal: entries.length,
        bytesRead,
        bytesWritten
      });
      return;
    }
    if (message.type === "entry-complete") {
      completedEntries += 1;
      progress({
        phase: currentPhase,
        currentEntry: message.path,
        entriesCompleted: completedEntries,
        entriesTotal: entries.length,
        bytesRead,
        bytesWritten
      });
      return;
    }
    if (message.type === "chunk-processed") {
      queuedChunkCount = Math.max(0, queuedChunkCount - 1);
      queuedChunkBytes = Math.max(0, queuedChunkBytes - (message.bytes ?? 0));
      flushQueueWaiters();
      return;
    }
    if (message.type === "chunk") {
      bytesWritten += message.bytes ?? 0;
      if (bytesWritten > archiveLimits.archiveBytes) {
        fail(
          Object.assign(new Error("Archive exceeds the configured size limit."), {
            code: "ARCHIVE_TOO_LARGE"
          })
        );
        return;
      }
      currentPhase = "writing";
      outputWrite = outputWrite
        .then(() => sink.write(message.chunk))
        .catch((error) => {
          fail(normalizeError(error, "ARCHIVE_WRITE_FAILED"));
        });
      progress({
        phase: currentPhase,
        entriesCompleted: completedEntries,
        entriesTotal: entries.length,
        bytesRead,
        bytesWritten,
        final: Boolean(message.final)
      });
      return;
    }
    if (message.type === "complete") {
      currentPhase = "finalizing";
      outputWrite
        .then(async () => {
          const file = await sink.finalize();
          if (verifyExpectedPaths) {
            await finalizeVerification(file, expectedPaths, archiveLimits, signal);
          }
          progress(
            {
              phase: "completed",
              entriesCompleted: completedEntries,
              entriesTotal: entries.length,
              bytesRead,
              bytesWritten,
              complete: true
            },
            true
          );
          await finish({
            file,
            storage: sink.storage,
            bytesRead,
            bytesWritten,
            entryCount: entries.length,
            cleanup
          });
        })
        .catch((error) => {
          fail(error);
        });
      return;
    }
    if (message.type === "cancelled") {
      fail(Object.assign(new Error("Archive operation cancelled."), { code: "ARCHIVE_CANCELLED" }));
      return;
    }
    if (message.type === "error") {
      fail(Object.assign(new Error(message.error?.message || "Archive worker failed."), message.error));
    }
  };

  worker.onerror = (error) => {
    fail(error);
  };

  worker.postMessage({ type: "start", jobId, level: archiveLimits.archiveCompressionLevel ?? 6 });

  try {
    for (const entry of entries) {
      if (signal?.aborted) {
        throw signal.reason ?? new DOMException("Aborted", "AbortError");
      }
      assertSafeArchivePath(entry.path);
      currentEntryBytes = 0;
      worker.postMessage({
        type: "entry-start",
        jobId,
        path: entry.path,
        compression: entry.compression ?? "deflate"
      });

      let pending = null;
      for await (const chunk of normalizeEntrySource(entry, archiveLimits.workerChunkBytes)) {
        const bytes = toBytes(chunk);
        bytesRead += bytes.byteLength;
        currentEntryBytes += bytes.byteLength;
        if (bytesRead > archiveLimits.archiveExpandedBytes) {
          throw Object.assign(new Error("Archive source exceeds the configured expanded size limit."), {
            code: "ARCHIVE_EXPANDED_LIMIT_EXCEEDED"
          });
        }
        if (currentEntryBytes > archiveLimits.archiveEntryBytes) {
          throw Object.assign(new Error(`Archive entry ${entry.path} exceeds the configured size limit.`), {
            code: "ARCHIVE_ENTRY_TOO_LARGE"
          });
        }
        if (pending) {
          await waitForQueueCapacity(pending.byteLength);
          queuedChunkCount += 1;
          queuedChunkBytes += pending.byteLength;
          worker.postMessage({ type: "entry-chunk", jobId, chunk: pending.buffer, final: false }, [
            pending.buffer
          ]);
        }
        pending = bytes;
      }
      if (pending) {
        await waitForQueueCapacity(pending.byteLength);
        queuedChunkCount += 1;
        queuedChunkBytes += pending.byteLength;
        worker.postMessage({ type: "entry-chunk", jobId, chunk: pending.buffer, final: true }, [
          pending.buffer
        ]);
      } else {
        const empty = new Uint8Array(0);
        await waitForQueueCapacity(0);
        queuedChunkCount += 1;
        worker.postMessage({ type: "entry-chunk", jobId, chunk: empty.buffer, final: true }, [empty.buffer]);
      }
    }
    worker.postMessage({ type: "end", jobId });
  } catch (error) {
    await fail(error);
  }

  return completion;
}

export async function inspectArchive(
  archive,
  {
    limits = {},
    expectedPaths = [],
    collectContents = true,
    signal = null,
    onProgress = null,
    onEntry = null
  } = {}
) {
  if (signal?.aborted) {
    throw normalizeError(signal.reason ?? new DOMException("Aborted", "AbortError"));
  }
  const archiveLimits = normalizeArchiveLimits(limits);
  const { Unzip, UnzipInflate } = await loadFflateModule();
  const files = new Map();
  const entries = [];
  const seenPaths = new Set();
  const expectedPathSet = new Set(expectedPaths.map((path) => canonicalArchivePath(path)));
  let expandedBytes = 0;
  let entryCount = 0;
  let archiveBytes = 0;
  let declaredArchiveBytes = 0;
  let declaredExpandedBytes = 0;
  let failure = null;
  const progress = throttleProgress(onProgress);

  const unzip = new Unzip((file) => {
    try {
      const name = String(file.name || "");
      assertSafeArchivePath(name);
      const canonicalName = canonicalArchivePath(name);
      if (seenPaths.has(canonicalName)) {
        throw Object.assign(new Error(`Archive contains duplicate path ${name}.`), {
          code: "ARCHIVE_DUPLICATE_PATH"
        });
      }
      if (expectedPathSet.size && !expectedPathSet.has(canonicalName)) {
        throw Object.assign(new Error(`Archive contains an unexpected entry ${name}.`), {
          code: "ARCHIVE_ENTRY_UNEXPECTED",
          details: { path: name }
        });
      }
      seenPaths.add(canonicalName);
      entryCount += 1;
      if (entryCount > archiveLimits.archiveEntries) {
        throw Object.assign(new Error("Archive contains too many entries."), {
          code: "ARCHIVE_TOO_MANY_ENTRIES"
        });
      }
      const declaredCompressedSize = Number.isFinite(file.size) && file.size >= 0 ? file.size : null;
      const declaredExpandedSize =
        Number.isFinite(file.originalSize) && file.originalSize >= 0 ? file.originalSize : null;
      if (declaredCompressedSize != null) {
        declaredArchiveBytes += declaredCompressedSize;
        if (declaredArchiveBytes > archiveLimits.archiveBytes) {
          throw Object.assign(new Error("Archive exceeds the configured size limit."), {
            code: "ARCHIVE_TOO_LARGE"
          });
        }
      }
      if (declaredExpandedSize != null) {
        declaredExpandedBytes += declaredExpandedSize;
        if (declaredExpandedBytes > archiveLimits.archiveExpandedBytes) {
          throw Object.assign(new Error("Archive expands beyond the configured safety limit."), {
            code: "ARCHIVE_DECOMPRESSION_BOMB"
          });
        }
      }
      let entryBytes = 0;
      const captureBytes = collectContents || typeof onEntry === "function";
      const chunks = captureBytes ? [] : null;
      file.ondata = (err, chunk, final) => {
        if (err) {
          failure = err;
          stopReader(err);
          return;
        }
        const bytesChunk = toBytes(chunk);
        entryBytes += bytesChunk.byteLength;
        expandedBytes += bytesChunk.byteLength;
        if (entryBytes > archiveLimits.archiveEntryBytes) {
          failure = Object.assign(new Error(`Archive entry ${name} exceeds the size limit.`), {
            code: "ARCHIVE_ENTRY_TOO_LARGE"
          });
          stopReader(failure);
          try {
            unzip.terminate?.();
          } catch {
            // ignore cleanup failures
          }
          return;
        }
        if (expandedBytes > archiveLimits.archiveExpandedBytes) {
          failure = Object.assign(new Error("Archive expands beyond the configured safety limit."), {
            code: "ARCHIVE_DECOMPRESSION_BOMB"
          });
          stopReader(failure);
          try {
            unzip.terminate?.();
          } catch {
            // ignore cleanup failures
          }
          return;
        }
        if (captureBytes) chunks.push(bytesChunk);
        if (final) {
          const bytes = captureBytes ? concatBytes(chunks, entryBytes) : null;
          const metadata = {
            name,
            bytes,
            entryBytes,
            compressedBytes: declaredCompressedSize,
            originalBytes: declaredExpandedSize
          };
          if (collectContents && bytes) files.set(name, bytes);
          entries.push(metadata);
          if (onEntry) {
            try {
              onEntry(metadata);
            } catch (error) {
              failure = error;
              stopReader(error);
              try {
                unzip.terminate?.();
              } catch {
                // ignore cleanup failures
              }
            }
          }
        }
      };
      file.start();
    } catch (error) {
      failure = error;
    }
  });
  unzip.register(UnzipInflate);

  const reader = readArchiveStream(archive);
  const stopReader = (reason) => {
    try {
      reader.cancel(reason ?? new DOMException("Aborted", "AbortError")).catch(() => {});
    } catch {
      // ignore cancellation errors
    }
  };
  const abortHandler = signal
    ? () => {
        stopReader(signal.reason ?? new DOMException("Aborted", "AbortError"));
      }
    : null;
  if (signal) {
    if (signal.aborted) {
      throw normalizeError(signal.reason ?? new DOMException("Aborted", "AbortError"));
    }
    signal.addEventListener("abort", abortHandler, { once: true });
  }
  try {
    while (true) {
      if (failure) throw failure;
      if (signal?.aborted) {
        throw normalizeError(signal.reason ?? new DOMException("Aborted", "AbortError"));
      }
      const { done, value } = await reader.read();
      if (done) break;
      const bytesChunk = toBytes(value);
      archiveBytes += bytesChunk.byteLength;
      if (archiveBytes > archiveLimits.archiveBytes) {
        const tooLarge = Object.assign(new Error("Archive exceeds the configured size limit."), {
          code: "ARCHIVE_TOO_LARGE"
        });
        failure = tooLarge;
        stopReader(tooLarge);
        throw tooLarge;
      }
      unzip.push(bytesChunk, false);
      progress(
        {
          phase: "reading",
          entriesCompleted: entryCount,
          entriesTotal: expectedPaths.length,
          bytesRead: archiveBytes,
          bytesWritten: expandedBytes
        },
        false
      );
    }
    unzip.push(new Uint8Array(0), true);
    if (failure) throw failure;
  } catch (error) {
    throw normalizeError(error);
  } finally {
    if (signal && abortHandler) signal.removeEventListener("abort", abortHandler);
    reader.releaseLock();
  }

  const missing = expectedPaths.filter((path) => !seenPaths.has(path));
  if (missing.length) {
    throw Object.assign(new Error(`Archive is missing expected entries: ${missing.join(", ")}.`), {
      code: "ARCHIVE_ENTRIES_MISSING",
      details: { missing }
    });
  }

  return { files, entries, entryCount, expandedBytes, bytes: archiveBytes };
}

function readArchiveStream(archive) {
  if (archive instanceof Blob) return archive.stream().getReader();
  if (archive instanceof Uint8Array) {
    const blob = new Blob([archive]);
    return blob.stream().getReader();
  }
  if (ArrayBuffer.isView(archive)) {
    const blob = new Blob([
      archive.buffer.slice(archive.byteOffset, archive.byteOffset + archive.byteLength)
    ]);
    return blob.stream().getReader();
  }
  if (archive instanceof ArrayBuffer) {
    return new Blob([archive]).stream().getReader();
  }
  if (archive?.stream) return archive.stream().getReader();
  throw new Error("Unsupported archive input.");
}

export async function downloadArchiveFile(file, filename) {
  const blob = file instanceof Blob ? file : await file.getFile?.();
  if (!blob) throw new Error("Archive file is not readable.");
  const download = blob.type === "application/zip" ? blob : new Blob([blob], { type: "application/zip" });
  return { blob: download, filename };
}
