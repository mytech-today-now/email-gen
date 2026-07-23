const textEncoder = new TextEncoder();

export const LIMIT_PROFILE_VERSION = 1;

export const LIMIT_REGISTRY = Object.freeze([
  {
    key: "requestBytes",
    name: "Gateway request bytes",
    unit: "bytes",
    scope: "HTTP ingress",
    countingSemantics: "UTF-8 byte length of incoming JSON/form payloads before parsing.",
    defaultValue: 5 * 1024 * 1024,
    tightenable: true,
    errorCode: "REQUEST_BYTES_EXCEEDED"
  },
  {
    key: "uploadBytes",
    name: "Upload bytes",
    unit: "bytes",
    scope: "File upload ingress",
    countingSemantics: "UTF-8 byte length of a single uploaded file or request body.",
    defaultValue: 5 * 1024 * 1024,
    tightenable: true,
    errorCode: "UPLOAD_BYTES_EXCEEDED"
  },
  {
    key: "apiRequestsPerMinute",
    name: "API requests per minute",
    unit: "requests/minute",
    scope: "Gateway ingress",
    countingSemantics: "Moving one-minute request count for untrusted HTTP traffic.",
    defaultValue: 240,
    tightenable: true,
    errorCode: "API_RATE_LIMIT_EXCEEDED"
  },
  {
    key: "records",
    name: "Maximum records",
    unit: "records",
    scope: "Imports, batches, restore, Resend review, browser UI",
    countingSemantics:
      "Top-level record entries in a single imported dataset, batch submission, or restored store.",
    defaultValue: 1000,
    tightenable: true,
    errorCode: "RECORD_LIMIT_EXCEEDED"
  },
  {
    key: "fields",
    name: "Maximum fields per record",
    unit: "fields",
    scope: "Import normalization and backup validation",
    countingSemantics: "Own enumerable keys on a record object before nested traversal.",
    defaultValue: 100,
    tightenable: true,
    errorCode: "FIELD_COUNT_EXCEEDED"
  },
  {
    key: "fieldBytes",
    name: "Maximum UTF-8 bytes per field",
    unit: "bytes",
    scope: "Import normalization and backup validation",
    countingSemantics: "UTF-8 byte length of each string value after normalization and before truncation.",
    defaultValue: 12_000,
    tightenable: true,
    errorCode: "FIELD_BYTES_EXCEEDED"
  },
  {
    key: "nestingDepth",
    name: "Maximum object nesting depth",
    unit: "levels",
    scope: "Import normalization and backup validation",
    countingSemantics: "Recursive object/array nesting depth with the root at depth zero.",
    defaultValue: 40,
    tightenable: true,
    errorCode: "NESTING_DEPTH_EXCEEDED"
  },
  {
    key: "properties",
    name: "Maximum traversed properties",
    unit: "properties",
    scope: "Import normalization and backup validation",
    countingSemantics: "Total enumerable object properties visited across a traversed value.",
    defaultValue: 10_000,
    tightenable: true,
    errorCode: "PROPERTY_LIMIT_EXCEEDED"
  },
  {
    key: "promptBytes",
    name: "Maximum prompt bytes",
    unit: "bytes",
    scope: "Prompt rendering and gateway submission",
    countingSemantics: "UTF-8 byte length of the rendered prompt body passed to providers.",
    defaultValue: 60_000,
    tightenable: true,
    errorCode: "PROMPT_BYTES_EXCEEDED"
  },
  {
    key: "addendumBytes",
    name: "Maximum addendum bytes",
    unit: "bytes",
    scope: "Addendum loading and rendering",
    countingSemantics: "UTF-8 byte length of an addendum file or payload.",
    defaultValue: 250_000,
    tightenable: true,
    errorCode: "ADDENDUM_BYTES_EXCEEDED"
  },
  {
    key: "providerResponseBytes",
    name: "Maximum provider response bytes",
    unit: "bytes",
    scope: "Provider, Resend, search, and model-discovery HTTP responses",
    countingSemantics: "Decoded UTF-8 byte length accepted from the response stream.",
    defaultValue: 500_000,
    tightenable: true,
    errorCode: "PROVIDER_RESPONSE_TOO_LARGE"
  },
  {
    key: "batchResponseBytes",
    name: "Maximum batch response bytes",
    unit: "bytes",
    scope: "Provider batch result and error-file responses",
    countingSemantics: "Decoded UTF-8 byte length accepted from batch result streams.",
    defaultValue: 5 * 1024 * 1024,
    tightenable: true,
    errorCode: "BATCH_RESPONSE_TOO_LARGE"
  },
  {
    key: "archiveBytes",
    name: "Maximum compressed archive bytes",
    unit: "bytes",
    scope: "Archive inspection and backup restore",
    countingSemantics: "Compressed ZIP input bytes read from the archive stream.",
    defaultValue: 100 * 1024 * 1024,
    tightenable: true,
    errorCode: "ARCHIVE_TOO_LARGE"
  },
  {
    key: "archiveExpandedBytes",
    name: "Maximum expanded archive bytes",
    unit: "bytes",
    scope: "Archive inspection and backup restore",
    countingSemantics: "Expanded bytes produced after decompression across all entries.",
    defaultValue: 250 * 1024 * 1024,
    tightenable: true,
    errorCode: "ARCHIVE_DECOMPRESSION_BOMB"
  },
  {
    key: "archiveEntries",
    name: "Maximum archive entries",
    unit: "entries",
    scope: "Archive creation and inspection",
    countingSemantics: "Number of archive entries seen after manifest validation.",
    defaultValue: 5000,
    tightenable: true,
    errorCode: "ARCHIVE_TOO_MANY_ENTRIES"
  },
  {
    key: "archiveEntryBytes",
    name: "Maximum expanded bytes per archive entry",
    unit: "bytes",
    scope: "Archive creation and inspection",
    countingSemantics: "Expanded bytes for a single entry after decompression.",
    defaultValue: 25 * 1024 * 1024,
    tightenable: true,
    errorCode: "ARCHIVE_ENTRY_TOO_LARGE"
  },
  {
    key: "archiveInMemoryBytes",
    name: "Maximum in-memory archive bytes",
    unit: "bytes",
    scope: "Browser artifact staging fallback",
    countingSemantics: "Estimated archive size before falling back to Blob-only staging.",
    defaultValue: 20 * 1024 * 1024,
    tightenable: true,
    errorCode: "ARCHIVE_STORAGE_UNAVAILABLE"
  },
  {
    key: "archiveCompressionRatio",
    name: "Maximum archive compression ratio",
    unit: "ratio",
    scope: "Archive inspection",
    countingSemantics:
      "Expanded bytes divided by compressed bytes for each entry, ignoring zero-byte safe cases.",
    defaultValue: 1000,
    tightenable: true,
    errorCode: "ARCHIVE_COMPRESSION_RATIO_EXCEEDED"
  },
  {
    key: "archivePathBytes",
    name: "Maximum archive path bytes",
    unit: "bytes",
    scope: "Archive creation and inspection",
    countingSemantics: "UTF-8 byte length of the archive entry path after normalization.",
    defaultValue: 512,
    tightenable: true,
    errorCode: "ARCHIVE_PATH_TOO_LONG"
  },
  {
    key: "gatewayConcurrency",
    name: "Maximum gateway concurrency",
    unit: "requests",
    scope: "Gateway worker queue",
    countingSemantics: "Simultaneous gateway operations accepted before rejecting new requests.",
    defaultValue: 4,
    tightenable: true,
    errorCode: "CONCURRENCY_LIMIT_REACHED"
  },
  {
    key: "providerConcurrency",
    name: "Maximum provider concurrency",
    unit: "requests",
    scope: "Provider batch and paid external calls",
    countingSemantics:
      "Simultaneous provider-side external operations accepted before backpressure or rejection.",
    defaultValue: 4,
    tightenable: true,
    errorCode: "CONCURRENCY_LIMIT_REACHED"
  },
  {
    key: "exportFilenameLength",
    name: "Maximum export filename bytes",
    unit: "bytes",
    scope: "Result export and delivery export filenames",
    countingSemantics: "UTF-8 byte length of the generated filename after sanitization.",
    defaultValue: 160,
    tightenable: true,
    errorCode: "EXPORT_FILENAME_TOO_LONG"
  },
  {
    key: "workerChunkBytes",
    name: "Archive worker chunk size",
    unit: "bytes",
    scope: "Browser archive streaming",
    countingSemantics: "Maximum uncompressed chunk size posted from the main thread to the archive worker.",
    defaultValue: 64 * 1024,
    tightenable: true,
    errorCode: "ARCHIVE_WORKER_LIMIT_EXCEEDED"
  },
  {
    key: "workerMaxQueuedChunks",
    name: "Maximum queued archive chunks",
    unit: "chunks",
    scope: "Browser archive streaming",
    countingSemantics: "Maximum number of in-flight chunks waiting for worker acknowledgement.",
    defaultValue: 1,
    tightenable: true,
    errorCode: "ARCHIVE_QUEUE_LIMIT_EXCEEDED"
  },
  {
    key: "workerMaxQueuedBytes",
    name: "Maximum queued archive bytes",
    unit: "bytes",
    scope: "Browser archive streaming",
    countingSemantics: "Maximum total bytes waiting for worker acknowledgement.",
    defaultValue: 128 * 1024,
    tightenable: true,
    errorCode: "ARCHIVE_QUEUE_LIMIT_EXCEEDED"
  },
  {
    key: "responseDeadlineMs",
    name: "Absolute response deadline",
    unit: "milliseconds",
    scope: "External HTTP reads",
    countingSemantics: "Wall-clock time from request start until the response must finish.",
    defaultValue: 60_000,
    tightenable: true,
    errorCode: "DEADLINE_EXCEEDED"
  },
  {
    key: "responseIdleTimeoutMs",
    name: "Idle read timeout",
    unit: "milliseconds",
    scope: "External HTTP reads",
    countingSemantics: "Maximum gap between accepted chunks before the reader is cancelled.",
    defaultValue: 15_000,
    tightenable: true,
    errorCode: "IDLE_TIMEOUT"
  },
  {
    key: "cancellationLatencyMs",
    name: "Cancellation latency target",
    unit: "milliseconds",
    scope: "Streaming workers and readers",
    countingSemantics: "Target maximum time for cancellation to propagate through active streaming work.",
    defaultValue: 1_000,
    tightenable: true,
    errorCode: "CANCELLED"
  },
  {
    key: "storageSafetyMarginBytes",
    name: "Storage safety margin",
    unit: "bytes",
    scope: "Backup staging and restore preflight",
    countingSemantics: "Reserved free space kept aside when estimating storage headroom.",
    defaultValue: 20 * 1024 * 1024,
    tightenable: true,
    errorCode: "INSUFFICIENT_QUOTA"
  },
  {
    key: "temporaryStagingBytes",
    name: "Temporary staging limit",
    unit: "bytes",
    scope: "Backup and export staging",
    countingSemantics: "Maximum bytes allowed in temporary OPFS or fallback staging.",
    defaultValue: 20 * 1024 * 1024,
    tightenable: true,
    errorCode: "INSUFFICIENT_QUOTA"
  },
  {
    key: "logMaxSize",
    name: "Diagnostic log file size",
    unit: "bytes",
    scope: "Rotating file and OPFS log sink",
    countingSemantics: "Maximum size of a single diagnostic log file before rotation.",
    defaultValue: 1 * 1024 * 1024,
    tightenable: true,
    errorCode: "LOG_SIZE_LIMIT_EXCEEDED"
  },
  {
    key: "logMaxFiles",
    name: "Diagnostic log rotation count",
    unit: "files",
    scope: "Rotating file and OPFS log sink",
    countingSemantics: "Maximum number of retained diagnostic log files.",
    defaultValue: 5,
    tightenable: true,
    errorCode: "LOG_FILE_LIMIT_EXCEEDED"
  }
]);

export const LIMIT_DEFAULTS = Object.freeze(
  Object.fromEntries(LIMIT_REGISTRY.map((entry) => [entry.key, entry.defaultValue]))
);

const LIMIT_KEYS = new Set(LIMIT_REGISTRY.map((entry) => entry.key));

export function utf8ByteLength(value) {
  return textEncoder.encode(String(value ?? "")).byteLength;
}

export function describeLimitProfile() {
  return LIMIT_REGISTRY.map((entry) => ({
    ...entry,
    defaultValue: entry.defaultValue
  }));
}

export function applyLimitOverrides(overrides = {}, { allowAboveCeilingKeys = [] } = {}) {
  const result = { ...LIMIT_DEFAULTS };
  const allowedAboveCeiling = new Set(allowAboveCeilingKeys.map((key) => String(key)));
  for (const [key, rawValue] of Object.entries(overrides ?? {})) {
    if (!LIMIT_KEYS.has(key)) {
      throw new Error(`Unknown limit '${key}'.`);
    }
    if (rawValue === undefined || rawValue === null || rawValue === "") continue;
    const value = Number(rawValue);
    if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
      throw new Error(`Invalid integer limit override for '${key}'.`);
    }
    if (value > LIMIT_DEFAULTS[key] && !allowedAboveCeiling.has(key)) {
      throw new Error(
        `Invalid application configuration: ${key} cannot exceed compiled ceiling ${LIMIT_DEFAULTS[key]}.`
      );
    }
    result[key] = value;
  }
  return Object.freeze(result);
}

export function limitDescriptor(key) {
  return LIMIT_REGISTRY.find((entry) => entry.key === key) ?? null;
}
