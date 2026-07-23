import { VERSIONS, nowIso } from "./constants.js";
import { exportableStores } from "./storage.js";
import { inspectArchive, normalizeArchiveLimits, streamArchive } from "./archive.js";
import { previewRestore, validateBackupManifest, validateInspectedBackup } from "./backupValidation.js";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const ENCRYPTED_BACKUP_FORMAT = "ai-batch-personalizer-encrypted-backup";
const ENCRYPTED_BACKUP_VERSION = 1;
const ENCRYPTED_BACKUP_ITERATIONS = 310_000;
const ENCRYPTED_BACKUP_MIME = "application/vnd.ai-batch-personalizer.encrypted-backup+json";

async function sha256Hex(bytes) {
  if (globalThis.crypto?.subtle?.digest) {
    const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(bytes).digest("hex");
}

function bytesToBase64(bytes) {
  if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value) {
  if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(value, "base64"));
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function encryptedBackupError(code, message, details = {}) {
  return Object.assign(new Error(message), { code, details });
}

function encryptedBackupMetadata(envelope) {
  return {
    format: envelope.format,
    envelopeVersion: envelope.envelopeVersion,
    applicationVersion: envelope.applicationVersion,
    archiveFormat: envelope.archiveFormat,
    archiveVersion: envelope.archiveVersion,
    browserSchemaVersion: envelope.browserSchemaVersion,
    exportedAt: envelope.exportedAt,
    algorithm: envelope.algorithm,
    kdf: envelope.kdf,
    nonce: envelope.nonce
  };
}

async function deriveEncryptedBackupKey(passphrase, salt, iterations) {
  const passphraseBytes = textEncoder.encode(passphrase);
  try {
    const baseKey = await crypto.subtle.importKey("raw", passphraseBytes, "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt,
        iterations,
        hash: "SHA-256"
      },
      baseKey,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
  } finally {
    passphraseBytes.fill(0);
  }
}

function validateEncryptedBackupEnvelope(raw) {
  if (!raw || typeof raw !== "object") {
    throw encryptedBackupError("BACKUP_MANIFEST_INVALID", "Encrypted backup envelope is malformed.");
  }
  if (raw.format !== ENCRYPTED_BACKUP_FORMAT) {
    throw encryptedBackupError("BACKUP_FORMAT_UNSUPPORTED", "Encrypted backup format is not supported.");
  }
  if (raw.envelopeVersion !== ENCRYPTED_BACKUP_VERSION) {
    throw encryptedBackupError("BACKUP_VERSION_UNSUPPORTED", "Encrypted backup version is not supported.");
  }
  if (raw.algorithm !== "AES-GCM") {
    throw encryptedBackupError("BACKUP_MANIFEST_INVALID", "Encrypted backup algorithm is not supported.");
  }
  if (!raw.kdf || raw.kdf.name !== "PBKDF2" || raw.kdf.hash !== "SHA-256") {
    throw encryptedBackupError("BACKUP_MANIFEST_INVALID", "Encrypted backup KDF parameters are invalid.");
  }
  if (!Number.isInteger(raw.kdf.iterations) || raw.kdf.iterations < 100_000) {
    throw encryptedBackupError("BACKUP_MANIFEST_INVALID", "Encrypted backup KDF iterations are invalid.");
  }
  if (!raw.kdf.salt || !raw.nonce || !raw.ciphertext) {
    throw encryptedBackupError("BACKUP_MANIFEST_INVALID", "Encrypted backup is missing required fields.");
  }
  return raw;
}

async function decryptEncryptedBackupEnvelope(envelope, passphrase) {
  const validated = validateEncryptedBackupEnvelope(envelope);
  const metadata = encryptedBackupMetadata(validated);
  const key = await deriveEncryptedBackupKey(
    passphrase,
    base64ToBytes(validated.kdf.salt),
    validated.kdf.iterations
  );
  try {
    const plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: base64ToBytes(validated.nonce),
        additionalData: textEncoder.encode(JSON.stringify(metadata))
      },
      key,
      base64ToBytes(validated.ciphertext)
    );
    return new Blob([plaintext], { type: "application/zip" });
  } catch (error) {
    throw encryptedBackupError(
      "BACKUP_DECRYPTION_FAILED",
      "The passphrase is incorrect or the encrypted backup was tampered with.",
      { cause: error?.name || error?.code || null }
    );
  }
}

async function detectEncryptedBackupEnvelope(file) {
  const prefix = await file
    .slice(0, 512)
    .text()
    .catch(() => "");
  return prefix.trimStart().startsWith("{") && prefix.includes(`"format":"${ENCRYPTED_BACKUP_FORMAT}"`);
}

async function* storeJsonSource(repository, store, filter) {
  yield textEncoder.encode("[");
  let first = true;
  for await (const record of repository.iterate(store)) {
    if (filter && !filter(store, record)) continue;
    const prefix = first ? "" : ",";
    first = false;
    yield textEncoder.encode(`${prefix}${JSON.stringify(record)}`);
  }
  yield textEncoder.encode("]");
}

async function storeStats(repository, store, filter) {
  let bytes = 0;
  let count = 0;
  bytes += 1;
  let first = true;
  const canUseStreamingNodeHash =
    typeof window === "undefined" && typeof process !== "undefined" && !!process.versions?.node;
  let hash = null;
  const hashParts = canUseStreamingNodeHash ? null : ["["];
  if (canUseStreamingNodeHash) {
    const { createHash } = await import("node:crypto");
    hash = createHash("sha256");
    hash.update("[");
  }
  for await (const record of repository.iterate(store)) {
    if (filter && !filter(store, record)) continue;
    const serialized = `${first ? "" : ","}${JSON.stringify(record)}`;
    first = false;
    const chunk = textEncoder.encode(serialized);
    bytes += chunk.byteLength;
    count += 1;
    if (hash) hash.update(chunk);
    else hashParts.push(serialized);
  }
  bytes += 1;
  if (hash) {
    hash.update("]");
    return { bytes, count, checksum: hash.digest("hex") };
  }
  hashParts.push("]");
  return { bytes, count, checksum: await sha256Hex(textEncoder.encode(hashParts.join(""))) };
}

async function materializeEntries(repository, selectedStores, filter) {
  const counts = {};
  const checksums = {};
  const entries = [];
  let estimatedBytes = 0;

  for (const store of selectedStores) {
    const path = `data/${store}.json`;
    const stats = await storeStats(repository, store, filter);
    counts[store] = stats.count;
    checksums[path] = stats.checksum;
    estimatedBytes += stats.bytes;
    entries.push({
      path,
      compression: "deflate",
      estimatedBytes: stats.bytes,
      source: () => storeJsonSource(repository, store, filter)
    });
  }

  const manifest = {
    format: "ai-batch-personalizer-backup",
    archiveVersion: VERSIONS.backupFormat,
    applicationVersion: VERSIONS.application,
    browserSchemaVersion: VERSIONS.browserSchema,
    exportedAt: nowIso(),
    includedCategories: Object.keys(counts),
    counts,
    checksums,
    migration: { version: VERSIONS.migration }
  };
  const manifestJson = JSON.stringify(manifest, null, 2);
  const manifestBytes = textEncoder.encode(manifestJson).byteLength;
  estimatedBytes += manifestBytes;
  entries.unshift({
    path: "manifest.json",
    compression: "deflate",
    content: manifestJson,
    estimatedBytes: manifestBytes
  });

  return { manifest, entries, estimatedBytes };
}

export async function createBackup(
  repository,
  {
    stores = null,
    includeLogs = false,
    filter = null,
    limits = null,
    filename = "backup.emailgen",
    signal = null,
    onProgress = null
  } = {}
) {
  const selected = (stores ?? exportableStores({ includeLogs })).filter(
    (store) => store !== "logs" || includeLogs
  );
  const archiveLimits = normalizeArchiveLimits(limits);
  const { manifest, entries, estimatedBytes } = await materializeEntries(repository, selected, filter);
  const archive = await streamArchive({
    filename,
    entries,
    estimatedBytes,
    limits: archiveLimits,
    signal,
    onProgress,
    verifyExpectedPaths: false
  });
  try {
    await inspectBackup(archive.file, { limits: archiveLimits });
  } catch (error) {
    await archive.cleanup?.().catch(() => {});
    throw error;
  }
  return {
    file: archive.file,
    storage: archive.storage,
    cleanup: archive.cleanup,
    manifest,
    bytesRead: archive.bytesRead,
    bytesWritten: archive.bytesWritten,
    entryCount: archive.entryCount
  };
}

export async function createEncryptedBackup(
  repository,
  {
    passphrase,
    stores = null,
    includeLogs = false,
    filter = null,
    limits = null,
    filename = "backup.emailgen.enc",
    signal = null,
    onProgress = null
  } = {}
) {
  if (!passphrase) {
    throw encryptedBackupError("BACKUP_PASSPHRASE_REQUIRED", "An encrypted backup requires a passphrase.");
  }
  const backup = await createBackup(repository, {
    stores,
    includeLogs,
    filter,
    limits,
    filename,
    signal,
    onProgress
  });
  try {
    const archiveBytes = new Uint8Array(await backup.file.arrayBuffer());
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const nonce = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveEncryptedBackupKey(passphrase, salt, ENCRYPTED_BACKUP_ITERATIONS);
    const metadata = {
      format: ENCRYPTED_BACKUP_FORMAT,
      envelopeVersion: ENCRYPTED_BACKUP_VERSION,
      applicationVersion: VERSIONS.application,
      archiveFormat: backup.manifest.format,
      archiveVersion: backup.manifest.archiveVersion,
      browserSchemaVersion: backup.manifest.browserSchemaVersion,
      exportedAt: backup.manifest.exportedAt,
      algorithm: "AES-GCM",
      kdf: {
        name: "PBKDF2",
        hash: "SHA-256",
        iterations: ENCRYPTED_BACKUP_ITERATIONS,
        salt: bytesToBase64(salt)
      },
      nonce: bytesToBase64(nonce)
    };
    const ciphertext = await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv: nonce,
        additionalData: textEncoder.encode(JSON.stringify(metadata))
      },
      key,
      archiveBytes
    );
    const envelope = {
      ...metadata,
      ciphertext: bytesToBase64(new Uint8Array(ciphertext))
    };
    return {
      ...backup,
      file: new Blob([JSON.stringify(envelope, null, 2)], { type: ENCRYPTED_BACKUP_MIME }),
      envelope
    };
  } catch (error) {
    await backup.cleanup?.().catch(() => {});
    throw error;
  }
}

export async function resolveBackupArchive(file, { passphrase = null } = {}) {
  const encrypted = await detectEncryptedBackupEnvelope(file);
  if (!encrypted) return { archive: file, envelope: null };
  const envelope = validateEncryptedBackupEnvelope(JSON.parse(await file.text()));
  if (!passphrase) {
    throw encryptedBackupError(
      "BACKUP_PASSPHRASE_REQUIRED",
      "This encrypted backup requires a passphrase before it can be restored.",
      { encrypted: true }
    );
  }
  return {
    archive: await decryptEncryptedBackupEnvelope(envelope, passphrase),
    envelope
  };
}

export async function inspectBackup(archive, { limits = null, signal = null, onProgress = null } = {}) {
  const archiveLimits = normalizeArchiveLimits(limits);
  const collected = { manifest: null, data: {} };
  const inspected = await inspectArchive(archive, {
    limits: archiveLimits,
    signal,
    onProgress,
    collectContents: false,
    onEntry(entry) {
      if (entry.name === "manifest.json") {
        if (collected.manifest) {
          throw Object.assign(new Error("Backup manifest appears more than once."), {
            code: "BACKUP_MANIFEST_DUPLICATE"
          });
        }
        const manifest = JSON.parse(textDecoder.decode(entry.bytes ?? new Uint8Array(0)));
        collected.manifest = validateBackupManifest(manifest).manifest;
        return;
      }
      if (!collected.manifest) {
        throw Object.assign(new Error("Backup manifest must appear before data entries."), {
          code: "BACKUP_MANIFEST_MISSING"
        });
      }
      if (
        !collected.manifest.includedCategories.includes(
          entry.name.replace(/^data\//, "").replace(/\.json$/, "")
        )
      ) {
        throw Object.assign(new Error(`Backup category ${entry.name} is unexpected.`), {
          code: "BACKUP_CATEGORY_UNEXPECTED"
        });
      }
      const store = entry.name.replace(/^data\//, "").replace(/\.json$/, "");
      const bytes = entry.bytes ?? new Uint8Array(0);
      collected.data[store] = { bytes, data: JSON.parse(textDecoder.decode(bytes)) };
    }
  });
  if (!collected.manifest) {
    throw Object.assign(new Error("Backup manifest is missing."), { code: "BACKUP_MANIFEST_MISSING" });
  }
  const resolvedData = {};
  for (const store of collected.manifest.includedCategories) {
    const entry = collected.data[store];
    if (!entry) {
      if ((collected.manifest.counts[store] ?? 0) === 0) {
        resolvedData[store] = [];
        continue;
      }
      throw Object.assign(new Error(`Backup category ${store} is missing from the archive.`), {
        code: "BACKUP_FILE_MISSING"
      });
    }
    const path = `data/${store}.json`;
    if ((await sha256Hex(entry.bytes)) !== collected.manifest.checksums[path]) {
      throw Object.assign(new Error(`Checksum failed for ${store}.json.`), {
        code: "BACKUP_CHECKSUM_FAILED"
      });
    }
    resolvedData[store] = entry.data;
  }
  const validated = validateInspectedBackup(
    { manifest: collected.manifest, data: resolvedData },
    { limits: archiveLimits }
  );
  return { ...validated, archive: inspected };
}

export async function restoreBackup(repository, inspected, policy = {}) {
  const plan = await previewRestore(repository, inspected, policy);
  await repository.atomicRestore(plan.preparedData, plan.effectiveConflict);
  const summary = Object.fromEntries(
    Object.entries(plan.preparedData).map(([store, records]) => [store, records.length])
  );
  return { summary, plan };
}

export {
  BACKUP_VERSION_SCHEMAS,
  RESTORE_POLICY_DEFAULTS,
  buildRestorePreviewText,
  normalizeRestorePolicy,
  previewRestore
} from "./backupValidation.js";

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
