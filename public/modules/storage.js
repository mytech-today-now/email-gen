import { STORE_DEFINITIONS, VERSIONS, nowIso } from "./constants.js";

const DATABASE_NAME = "ai-batch-personalizer";
const OPEN_TIMEOUT_MS = 10_000;
const STORAGE_PROBE_KEY = "__storage_health_probe__";
const REVISIONED_STORES = new Set(["settings", "templates", "addenda", "results", "operations"]);
const FATAL_STORAGE_ERROR_CODES = new Set([
  "STORAGE_VERSION_UNSUPPORTED",
  "STORAGE_OPEN_BLOCKED",
  "STORAGE_OPEN_TIMEOUT",
  "STORAGE_OPEN_FAILED",
  "STORAGE_SECURITY_FAILED",
  "STORAGE_QUOTA_EXCEEDED",
  "STORAGE_TRANSACTION_ABORTED",
  "STORAGE_CONNECTION_CLOSED",
  "STORAGE_DATABASE_MISSING",
  "STORAGE_VERIFICATION_FAILED",
  "STORAGE_UNAVAILABLE",
  "BROWSER_STORAGE_FAILED"
]);

function currentRevision(value) {
  return Number.isInteger(value?.revision) ? value.revision : 0;
}

function nextRevision(value) {
  return currentRevision(value) + 1;
}

function revisionConflict(store, key, expectedRevision, latest) {
  const error = new Error(`Stale ${store} revision.`);
  error.code = "REVISION_CONFLICT";
  error.store = store;
  error.key = key;
  error.expectedRevision = expectedRevision ?? null;
  error.latest = latest ? structuredClone(latest) : null;
  return error;
}

function normalizedRevisionValue(store, value) {
  const next = structuredClone(value);
  if (REVISIONED_STORES.has(store) && !Number.isInteger(next?.revision)) next.revision = 0;
  return next;
}

function requestPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionPromise(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () =>
      reject(transaction.error || new DOMException("Transaction aborted", "AbortError"));
  });
}

function storageErrorCode(error, stage = "runtime") {
  const name = String(error?.name || error?.code || "");
  if (String(error?.code || "").startsWith("STORAGE_")) return error.code;
  if (name === "VersionError") return "STORAGE_VERSION_UNSUPPORTED";
  if (name === "QuotaExceededError") return "STORAGE_QUOTA_EXCEEDED";
  if (name === "SecurityError") return "STORAGE_SECURITY_FAILED";
  if (name === "AbortError") return stage === "open" ? "STORAGE_OPEN_BLOCKED" : "STORAGE_TRANSACTION_ABORTED";
  if (name === "InvalidStateError") return "STORAGE_CONNECTION_CLOSED";
  if (name === "NotFoundError") return "STORAGE_DATABASE_MISSING";
  if (name === "DataError") return "STORAGE_VERIFICATION_FAILED";
  if (name === "UnknownError") return stage === "open" ? "STORAGE_OPEN_FAILED" : "STORAGE_CONNECTION_CLOSED";
  return stage === "open" ? "STORAGE_OPEN_FAILED" : "BROWSER_STORAGE_FAILED";
}

function storageFailure(
  error,
  { stage = "runtime", blocked = false, timeout = false, retryable = true } = {}
) {
  if (error?.code === "REVISION_CONFLICT") return error;
  if (String(error?.code || "").startsWith("STORAGE_") || error?.code === "BROWSER_STORAGE_FAILED") {
    const wrapped = error;
    if (!wrapped.stage) wrapped.stage = stage;
    if (blocked) wrapped.blocked = true;
    if (timeout) wrapped.timeout = true;
    if (wrapped.retryable == null) wrapped.retryable = retryable;
    return wrapped;
  }
  const code = blocked ? "STORAGE_OPEN_BLOCKED" : storageErrorCode(error, stage);
  const wrapped = new Error(error?.message || "Browser storage operation failed.");
  wrapped.code = code;
  wrapped.stage = stage;
  wrapped.reasonCode = code.toLowerCase();
  wrapped.retryable = retryable;
  if (blocked) wrapped.blocked = true;
  if (timeout) wrapped.timeout = true;
  if (error?.details) wrapped.details = error.details;
  if (error?.latest) wrapped.latest = structuredClone(error.latest);
  if (error?.stack) wrapped.stack = error.stack;
  if (code === "STORAGE_VERSION_UNSUPPORTED") {
    wrapped.message =
      "The browser database format is newer than this browser can open. Close other tabs and retry after updating the app.";
    wrapped.retryable = false;
  } else if (code === "STORAGE_OPEN_BLOCKED") {
    wrapped.message =
      "Another tab or window is still blocking the browser database. Close the other tab or wait for the upgrade to finish, then retry.";
  } else if (code === "STORAGE_OPEN_TIMEOUT") {
    wrapped.message =
      "Browser storage did not finish opening in time. Retry after other tabs finish using the database.";
  } else if (code === "STORAGE_OPEN_FAILED") {
    wrapped.message = "Browser storage failed to open.";
  } else if (code === "STORAGE_SECURITY_FAILED") {
    wrapped.message = "Browser storage is blocked by browser security or permissions.";
  } else if (code === "STORAGE_QUOTA_EXCEEDED") {
    wrapped.message =
      "Browser storage quota was exceeded. Export a backup, then remove unused data and retry.";
  } else if (code === "STORAGE_TRANSACTION_ABORTED") {
    wrapped.message = "A browser storage transaction was aborted.";
  } else if (code === "STORAGE_CONNECTION_CLOSED") {
    wrapped.message =
      "The browser storage connection closed unexpectedly. Retry after the browser regains access.";
  } else if (code === "STORAGE_DATABASE_MISSING") {
    wrapped.message = "The browser database is missing or has been cleared.";
  } else if (code === "STORAGE_VERIFICATION_FAILED") {
    wrapped.message = "Browser storage opened, but read/write verification failed.";
  } else if (code === "STORAGE_UNAVAILABLE") {
    wrapped.message = "Browser storage is unavailable.";
  }
  return wrapped;
}

function reportFatalStorageFailure(repository, error) {
  if (!repository || repository.temporary || !FATAL_STORAGE_ERROR_CODES.has(error?.code)) return;
  try {
    repository.onFatalFailure?.(error);
  } catch {
    // The caller will handle the user-visible failure.
  }
}

function notifyWriteComplete(repository, details) {
  try {
    repository.onWriteComplete?.(details);
  } catch {
    // Best effort only.
  }
}

async function openRequestWithTimeout(request, timeoutMs = OPEN_TIMEOUT_MS) {
  let blocked = false;
  let timedOut = false;
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = (timeoutId) => {
      settled = true;
      clearTimeout(timeoutId);
    };
    const timeoutId = setTimeout(() => {
      if (settled) return;
      timedOut = true;
      cleanup(timeoutId);
      reject(
        storageFailure(
          new Error(
            blocked
              ? "Another tab is blocking browser storage."
              : "Browser storage did not finish opening in time."
          ),
          {
            stage: "open",
            blocked,
            timeout: !blocked
          }
        )
      );
    }, timeoutMs);
    timeoutId.unref?.();
    request.onsuccess = () => {
      if (settled) {
        try {
          request.result?.close?.();
        } catch {
          // Ignore the result if the caller already fell back to temporary mode.
        }
        return;
      }
      cleanup(timeoutId);
      resolve(request.result);
    };
    request.onerror = () => {
      if (settled) return;
      cleanup(timeoutId);
      reject(
        storageFailure(request.error || new Error("Browser storage open failed."), {
          stage: "open",
          blocked,
          timeout: timedOut
        })
      );
    };
    request.onblocked = () => {
      blocked = true;
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("storage-blocked", {
            detail: {
              code: "STORAGE_OPEN_BLOCKED",
              message: "Browser storage open is blocked by another tab."
            }
          })
        );
      }
    };
  });
}

function storageError(error) {
  return storageFailure(error, { stage: "runtime" });
}

class IndexedRepository {
  constructor(db) {
    this.db = db;
    this.temporary = false;
    this.reason = null;
    this.onFatalFailure = null;
    this.onWriteComplete = null;
    this.db.onversionchange = () => {
      const error = storageFailure(
        new Error("The browser database connection closed because another tab requested an upgrade."),
        { stage: "runtime" }
      );
      error.code = "STORAGE_CONNECTION_CLOSED";
      reportFatalStorageFailure(this, error);
      this.db.close();
    };
  }

  async get(store, key) {
    try {
      return await requestPromise(this.db.transaction(store).objectStore(store).get(key));
    } catch (error) {
      const wrapped = storageError(error);
      reportFatalStorageFailure(this, wrapped);
      throw wrapped;
    }
  }

  async all(store) {
    try {
      return await requestPromise(this.db.transaction(store).objectStore(store).getAll());
    } catch (error) {
      const wrapped = storageError(error);
      reportFatalStorageFailure(this, wrapped);
      throw wrapped;
    }
  }

  async *iterate(store) {
    const transaction = this.db.transaction(store, "readonly");
    const objectStore = transaction.objectStore(store);
    const queue = [];
    let done = false;
    let error = null;
    let resolveWait = null;

    const request = objectStore.openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        done = true;
        resolveWait?.();
        return;
      }
      queue.push(structuredClone(cursor.value));
      cursor.continue();
      resolveWait?.();
    };
    request.onerror = () => {
      error = storageError(request.error);
      done = true;
      resolveWait?.();
    };

    try {
      while (true) {
        if (error) throw error;
        if (queue.length) {
          yield queue.shift();
          continue;
        }
        if (done) break;
        await new Promise((resolve) => {
          resolveWait = resolve;
        });
        resolveWait = null;
      }
    } finally {
      await transactionPromise(transaction).catch(() => {});
    }
  }

  async snapshot(stores = []) {
    const uniqueStores = [...new Set(stores)].filter(Boolean);
    if (!uniqueStores.length) return {};
    try {
      const transaction = this.db.transaction(uniqueStores, "readonly");
      const requests = uniqueStores.map((store) => [
        store,
        requestPromise(transaction.objectStore(store).getAll())
      ]);
      const result = {};
      for (const [store, promise] of requests) result[store] = await promise;
      await transactionPromise(transaction);
      return result;
    } catch (error) {
      const wrapped = storageError(error);
      reportFatalStorageFailure(this, wrapped);
      throw wrapped;
    }
  }

  async byIndex(store, index, value) {
    try {
      return await requestPromise(this.db.transaction(store).objectStore(store).index(index).getAll(value));
    } catch (error) {
      const wrapped = storageError(error);
      reportFatalStorageFailure(this, wrapped);
      throw wrapped;
    }
  }

  async put(store, value) {
    try {
      const transaction = this.db.transaction(store, "readwrite");
      transaction.objectStore(store).put(normalizedRevisionValue(store, value));
      await transactionPromise(transaction);
      notifyWriteComplete(this, { store, operation: "put", temporary: this.temporary });
      return value;
    } catch (error) {
      const wrapped = storageError(error);
      reportFatalStorageFailure(this, wrapped);
      throw wrapped;
    }
  }

  async compareAndSwap(store, key, expectedRevision, value) {
    try {
      const transaction = this.db.transaction(store, "readwrite");
      const objectStore = transaction.objectStore(store);
      const current = await requestPromise(objectStore.get(key));
      const currentRev = currentRevision(current);
      const hasCurrent = Boolean(current);
      const matches = !hasCurrent
        ? expectedRevision == null || expectedRevision === 0
        : expectedRevision == null
          ? false
          : currentRev === expectedRevision;
      if (!matches) throw revisionConflict(store, key, expectedRevision, current);
      const next = normalizedRevisionValue(store, value);
      next.revision = hasCurrent ? nextRevision(current) : 0;
      objectStore.put(next);
      await transactionPromise(transaction);
      notifyWriteComplete(this, { store, operation: "compareAndSwap", temporary: this.temporary });
      return next;
    } catch (error) {
      if (error?.code === "REVISION_CONFLICT") throw error;
      const wrapped = storageError(error);
      reportFatalStorageFailure(this, wrapped);
      throw wrapped;
    }
  }

  async delete(store, key) {
    try {
      const transaction = this.db.transaction(store, "readwrite");
      transaction.objectStore(store).delete(key);
      await transactionPromise(transaction);
      notifyWriteComplete(this, { store, operation: "delete", temporary: this.temporary });
    } catch (error) {
      const wrapped = storageError(error);
      reportFatalStorageFailure(this, wrapped);
      throw wrapped;
    }
  }

  async clear(store) {
    try {
      const transaction = this.db.transaction(store, "readwrite");
      transaction.objectStore(store).clear();
      await transactionPromise(transaction);
      notifyWriteComplete(this, { store, operation: "clear", temporary: this.temporary });
    } catch (error) {
      const wrapped = storageError(error);
      reportFatalStorageFailure(this, wrapped);
      throw wrapped;
    }
  }

  async bulkPut(store, values) {
    try {
      const transaction = this.db.transaction(store, "readwrite");
      const objectStore = transaction.objectStore(store);
      for (const value of values) objectStore.put(normalizedRevisionValue(store, value));
      await transactionPromise(transaction);
      notifyWriteComplete(this, { store, operation: "bulkPut", temporary: this.temporary });
      return values.length;
    } catch (error) {
      const wrapped = storageError(error);
      reportFatalStorageFailure(this, wrapped);
      throw wrapped;
    }
  }

  async atomicPut(entries) {
    const stores = [...new Set(entries.map((entry) => entry.store))];
    try {
      const transaction = this.db.transaction(stores, "readwrite");
      for (const entry of entries)
        transaction.objectStore(entry.store).put(normalizedRevisionValue(entry.store, entry.value));
      await transactionPromise(transaction);
      notifyWriteComplete(this, { store: stores, operation: "atomicPut", temporary: this.temporary });
    } catch (error) {
      const wrapped = storageError(error);
      reportFatalStorageFailure(this, wrapped);
      throw wrapped;
    }
  }

  async atomicRestore(storeData, conflict = "merge") {
    const stores = Object.keys(storeData);
    try {
      const transaction = this.db.transaction(stores, "readwrite");
      for (const [storeName, values] of Object.entries(storeData)) {
        const store = transaction.objectStore(storeName);
        if (conflict === "replace") store.clear();
        if (conflict === "skip" && (await requestPromise(store.count())) > 0) continue;
        for (const value of values) store.put(normalizedRevisionValue(storeName, value));
      }
      await transactionPromise(transaction);
      notifyWriteComplete(this, {
        store: stores,
        operation: "atomicRestore",
        temporary: this.temporary
      });
    } catch (error) {
      const wrapped = storageError(error);
      reportFatalStorageFailure(this, wrapped);
      throw wrapped;
    }
  }

  async replaceStore(store, values) {
    try {
      const transaction = this.db.transaction(store, "readwrite");
      const objectStore = transaction.objectStore(store);
      objectStore.clear();
      for (const value of values) objectStore.put(normalizedRevisionValue(store, value));
      await transactionPromise(transaction);
      notifyWriteComplete(this, { store, operation: "replaceStore", temporary: this.temporary });
    } catch (error) {
      const wrapped = storageError(error);
      reportFatalStorageFailure(this, wrapped);
      throw wrapped;
    }
  }

  async estimate() {
    try {
      const estimate = await navigator.storage?.estimate?.();
      let persisted = false;
      try {
        persisted = (await navigator.storage?.persisted?.()) ?? false;
      } catch {
        persisted = false;
      }
      return {
        usage: estimate?.usage ?? null,
        quota: estimate?.quota ?? null,
        persisted
      };
    } catch (error) {
      const wrapped = storageFailure(error, { stage: "runtime" });
      reportFatalStorageFailure(this, wrapped);
      return { usage: null, quota: null, persisted: false, error: wrapped };
    }
  }

  async requestPersistence() {
    try {
      return (await navigator.storage?.persist?.()) ?? false;
    } catch {
      return false;
    }
  }

  close() {
    this.db.close();
  }
}

export class TemporaryRepository {
  constructor(reason) {
    this.temporary = true;
    this.reason = reason;
    this.onFatalFailure = null;
    this.onWriteComplete = null;
    this.stores = new Map(Object.keys(STORE_DEFINITIONS).map((name) => [name, new Map()]));
  }

  keyFor(store, value) {
    return value[STORE_DEFINITIONS[store].keyPath];
  }

  async get(store, key) {
    return structuredClone(this.stores.get(store).get(key));
  }

  async all(store) {
    return [...this.stores.get(store).values()].map((item) => structuredClone(item));
  }

  async *iterate(store) {
    for (const item of this.stores.get(store).values()) {
      yield structuredClone(item);
    }
  }

  async snapshot(stores = []) {
    const uniqueStores = [...new Set(stores)].filter(Boolean);
    return Object.fromEntries(
      uniqueStores.map((store) => [
        store,
        [...this.stores.get(store).values()].map((item) => structuredClone(item))
      ])
    );
  }

  async byIndex(store, index, value) {
    return (await this.all(store)).filter((item) => item[index] === value);
  }

  async put(store, value) {
    const next = normalizedRevisionValue(store, value);
    this.stores.get(store).set(this.keyFor(store, next), structuredClone(next));
    notifyWriteComplete(this, { store, operation: "put", temporary: this.temporary });
    return next;
  }

  async compareAndSwap(store, key, expectedRevision, value) {
    const current = this.stores.get(store).get(key);
    const currentRev = currentRevision(current);
    const hasCurrent = Boolean(current);
    const matches = !hasCurrent
      ? expectedRevision == null || expectedRevision === 0
      : expectedRevision == null
        ? false
        : currentRev === expectedRevision;
    if (!matches) throw revisionConflict(store, key, expectedRevision, current);
    const next = normalizedRevisionValue(store, value);
    next.revision = hasCurrent ? nextRevision(current) : 0;
    this.stores.get(store).set(key, structuredClone(next));
    notifyWriteComplete(this, { store, operation: "compareAndSwap", temporary: this.temporary });
    return next;
  }

  async delete(store, key) {
    this.stores.get(store).delete(key);
    notifyWriteComplete(this, { store, operation: "delete", temporary: this.temporary });
  }

  async clear(store) {
    this.stores.get(store).clear();
    notifyWriteComplete(this, { store, operation: "clear", temporary: this.temporary });
  }

  async bulkPut(store, values) {
    for (const value of values) await this.put(store, value);
    return values.length;
  }

  async atomicPut(entries) {
    for (const entry of entries) await this.put(entry.store, entry.value);
    notifyWriteComplete(this, {
      store: [...new Set(entries.map((entry) => entry.store))],
      operation: "atomicPut",
      temporary: this.temporary
    });
  }

  async atomicRestore(storeData, conflict = "merge") {
    const snapshot = new Map([...this.stores].map(([name, values]) => [name, new Map(values)]));
    try {
      for (const [store, values] of Object.entries(storeData)) {
        if (conflict === "replace") await this.clear(store);
        if (conflict === "skip" && (await this.all(store)).length > 0) continue;
        await this.bulkPut(store, values);
      }
      notifyWriteComplete(this, {
        store: Object.keys(storeData),
        operation: "atomicRestore",
        temporary: this.temporary
      });
    } catch (error) {
      this.stores = snapshot;
      throw error;
    }
  }

  async replaceStore(store, values) {
    await this.clear(store);
    await this.bulkPut(store, values);
  }

  async estimate() {
    return { usage: null, quota: null, persisted: false };
  }

  async requestPersistence() {
    return false;
  }

  close() {}
}

async function openIndexedRepository() {
  if (!globalThis.indexedDB) throw new Error("IndexedDB is unavailable.");
  const request = indexedDB.open(DATABASE_NAME, VERSIONS.browserSchema);
  request.onupgradeneeded = (event) => {
    const db = request.result;
    const transaction = request.transaction;
    for (const name of [...db.objectStoreNames]) {
      if (!STORE_DEFINITIONS[name]) db.deleteObjectStore(name);
    }
    for (const [name, definition] of Object.entries(STORE_DEFINITIONS)) {
      const store = db.objectStoreNames.contains(name)
        ? transaction.objectStore(name)
        : db.createObjectStore(name, { keyPath: definition.keyPath });
      for (const [indexName, keyPath] of Object.entries(definition.indexes ?? {})) {
        if (!store.indexNames.contains(indexName)) store.createIndex(indexName, keyPath, { unique: false });
      }
    }
    transaction.objectStore("meta").put({
      key: "schema",
      version: VERSIONS.browserSchema,
      upgradedFrom: event.oldVersion,
      upgradedAt: nowIso()
    });
  };
  const db = await openRequestWithTimeout(request, OPEN_TIMEOUT_MS);
  const repository = new IndexedRepository(db);
  await backfillEditableRevisions(repository);
  await verifyRepositoryWritable(repository);
  return repository;
}

async function verifyRepositoryWritable(repository) {
  const token = crypto.randomUUID();
  const probe = {
    key: STORAGE_PROBE_KEY,
    token,
    verifiedAt: nowIso()
  };
  try {
    await repository.put("meta", probe);
    const record = await repository.get("meta", STORAGE_PROBE_KEY);
    if (!record || record.token !== token) {
      throw storageFailure(new Error("Browser storage verification failed."), {
        stage: "verify",
        retryable: true
      });
    }
  } finally {
    await repository.delete("meta", STORAGE_PROBE_KEY).catch(() => {});
  }
}

async function backfillEditableRevisions(repository) {
  for (const store of REVISIONED_STORES) {
    const items = await repository.all(store).catch(() => []);
    const updated = items.filter((item) => !Number.isInteger(item?.revision));
    if (!updated.length) continue;
    await repository.bulkPut(
      store,
      items.map((item) => (Number.isInteger(item?.revision) ? item : { ...item, revision: 0 }))
    );
  }
}

export async function openBrowserRepository() {
  try {
    return await openIndexedRepository();
  } catch (error) {
    return new TemporaryRepository(storageFailure(error, { stage: "open" }));
  }
}

export function exportableStores({ includeLogs = false } = {}) {
  return Object.keys(STORE_DEFINITIONS).filter(
    (name) => name !== "meta" && name !== "operations" && (includeLogs || name !== "logs")
  );
}

export function classifyStorageFailure(error, stage = "runtime") {
  return storageFailure(error, { stage });
}
