import { Zip, ZipDeflate, ZipPassThrough } from "/vendor/fflate.js";

const jobs = new Map();

function transferChunk(chunk) {
  const view = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
  if (view.byteOffset === 0 && view.byteLength === view.buffer.byteLength) {
    return { bytes: view, transfer: [view.buffer] };
  }
  const copy = view.slice();
  return { bytes: copy, transfer: [copy.buffer] };
}

function post(jobId, message, transfer = []) {
  self.postMessage({ jobId, ...message }, transfer);
}

function fail(jobId, error) {
  const job = jobs.get(jobId);
  if (job?.zip) {
    try {
      job.zip.terminate();
    } catch {
      // ignore cleanup errors
    }
  }
  jobs.delete(jobId);
  post(jobId, {
    type: "error",
    error: {
      code: error?.code || "ARCHIVE_WORKER_FAILED",
      message: error?.message || "Archive worker failed."
    }
  });
}

function startJob(message) {
  const { jobId, level = 6 } = message;
  if (!jobId) throw new Error("Archive job id is required.");
  if (jobs.has(jobId)) throw new Error("Archive job already exists.");
  const job = {
    jobId,
    level,
    zip: null,
    currentEntry: null,
    currentEntryName: null,
    entryCount: 0,
    bytesIn: 0,
    bytesOut: 0,
    done: false,
    paths: new Set()
  };
  job.zip = new Zip((err, chunk, final) => {
    if (err) {
      fail(jobId, err);
      return;
    }
    const { bytes, transfer } = transferChunk(chunk);
    job.bytesOut += bytes.byteLength;
    post(
      jobId,
      {
        type: "chunk",
        bytes: bytes.byteLength,
        chunk: bytes,
        final: Boolean(final)
      },
      transfer
    );
    if (final && !job.done) {
      job.done = true;
      jobs.delete(jobId);
      post(jobId, {
        type: "complete",
        bytesIn: job.bytesIn,
        bytesOut: job.bytesOut,
        entryCount: job.entryCount
      });
    }
  });
  jobs.set(jobId, job);
  post(jobId, { type: "ready" });
}

function startEntry(message) {
  const job = jobs.get(message.jobId);
  if (!job) throw new Error("Archive job not found.");
  const path = String(message.path || "");
  if (!path) throw new Error("Archive entry path is required.");
  if (job.currentEntry) throw new Error("Archive entry already open.");
  if (job.paths.has(path)) throw new Error(`Duplicate archive path: ${path}`);
  job.paths.add(path);
  const compression = String(message.compression || "deflate").toLowerCase();
  const entry =
    compression === "store" ? new ZipPassThrough(path) : new ZipDeflate(path, { level: job.level });
  job.currentEntry = entry;
  job.currentEntryName = path;
  job.entryCount += 1;
  job.zip.add(entry);
  post(job.jobId, {
    type: "entry-started",
    path,
    entryCount: job.entryCount
  });
}

function pushEntry(message) {
  const job = jobs.get(message.jobId);
  if (!job || !job.currentEntry) throw new Error("Archive entry is not open.");
  const chunk =
    message.chunk instanceof ArrayBuffer ? new Uint8Array(message.chunk) : new Uint8Array(message.chunk);
  job.bytesIn += chunk.byteLength;
  job.currentEntry.push(chunk, Boolean(message.final));
  post(job.jobId, {
    type: "chunk-processed",
    bytes: chunk.byteLength
  });
  if (message.final) {
    post(job.jobId, {
      type: "entry-complete",
      path: job.currentEntryName,
      bytesIn: job.bytesIn
    });
    job.currentEntry = null;
    job.currentEntryName = null;
  }
}

function endJob(message) {
  const job = jobs.get(message.jobId);
  if (!job) throw new Error("Archive job not found.");
  if (job.currentEntry) throw new Error("Archive entry is still open.");
  job.zip.end();
}

function cancelJob(message) {
  const job = jobs.get(message.jobId);
  if (!job) return;
  try {
    job.zip.terminate();
  } catch {
    // ignore cleanup errors
  }
  jobs.delete(message.jobId);
  post(job.jobId, { type: "cancelled" });
}

self.onmessage = (event) => {
  const message = event.data ?? {};
  try {
    switch (message.type) {
      case "start":
        startJob(message);
        break;
      case "entry-start":
        startEntry(message);
        break;
      case "entry-chunk":
        pushEntry(message);
        break;
      case "end":
        endJob(message);
        break;
      case "cancel":
        cancelJob(message);
        break;
      default:
        throw new Error(`Unknown archive worker message: ${message.type}`);
    }
  } catch (error) {
    fail(message.jobId, error);
  }
};
