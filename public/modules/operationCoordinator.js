import { makeId, nowIso } from "./constants.js";
import { stableTabId } from "./operationIdentity.js";

const DEFAULT_LEASE_MS = 30_000;
const DEFAULT_POLL_MS = 2_000;
const ACTIVE_STATUSES = new Set(["prepared", "acquired", "in-progress", "submitting", "monitoring"]);
const UNCERTAIN_STATUSES = new Set([
  "outcome-unknown",
  "reconciliation-required",
  "submission_unknown",
  "monitoring_degraded"
]);
const TERMINAL_STATUSES = new Set([
  "succeeded",
  "failed-safe",
  "cancelled",
  "completed",
  "failed",
  "stopped"
]);

function isObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function lower(value) {
  return String(value ?? "").toLowerCase();
}

function isActive(operation) {
  return ACTIVE_STATUSES.has(lower(operation?.status));
}

function isUncertain(operation) {
  return UNCERTAIN_STATUSES.has(lower(operation?.status));
}

function isTerminal(operation) {
  return TERMINAL_STATUSES.has(lower(operation?.status));
}

function leaseExpired(operation, now = Date.now()) {
  if (!operation?.leaseExpiresAt) return false;
  const value = Date.parse(operation.leaseExpiresAt);
  return Number.isFinite(value) ? value <= now : false;
}

function sameFingerprint(left, right) {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

function cloneOperation(operation) {
  return operation ? structuredClone(operation) : null;
}

function createBroadcastBus(channelName, onMessage) {
  if (!globalThis.BroadcastChannel) return null;
  const channel = new BroadcastChannel(channelName);
  channel.onmessage = (event) => {
    if (!isObject(event.data)) return;
    onMessage?.(event.data);
  };
  return channel;
}

export function operationStatusLabel(operation) {
  if (!operation) return "No active operation";
  const status = lower(operation.status);
  if (status === "acquired") return "Acquired";
  if (status === "in-progress") return "In progress";
  if (status === "prepared") return "Prepared";
  if (status === "succeeded" || status === "completed") return "Completed";
  if (status === "failed-safe" || status === "failed") return "Failed";
  if (status === "cancelled" || status === "stopped") return "Cancelled";
  if (status === "outcome-unknown" || status === "reconciliation-required" || status === "submission_unknown")
    return "Needs reconciliation";
  if (status === "monitoring" || status === "monitoring_degraded") return "Monitoring";
  if (status === "submitting") return "Submitting";
  return operation.status;
}

export function operationIsBlocking(operation) {
  return isActive(operation) || isUncertain(operation);
}

export function operationOwnerLabel(operation, tabId) {
  if (!operation) return "";
  const owner = operation.ownerTabId || "unknown";
  return owner === tabId ? "This tab" : `Another tab (${owner.slice(0, 8)})`;
}

export function createOperationCoordinator({
  repository,
  tabId = stableTabId(),
  channelName = "email-gen-operations",
  leaseMs = DEFAULT_LEASE_MS,
  pollMs = DEFAULT_POLL_MS
} = {}) {
  const listeners = new Set();
  let pollTimer = null;
  const broadcast = createBroadcastBus(channelName, async (message) => {
    if (message.type === "refresh") {
      await emitSnapshot();
      return;
    }
    if (message.type === "changed") {
      const operation = await repository.get("operations", message.scopeKey).catch(() => null);
      notify({ type: "changed", scopeKey: message.scopeKey, operation: cloneOperation(operation) });
    }
  });

  async function emitSnapshot() {
    const operations = await repository.all("operations").catch(() => []);
    notify({ type: "snapshot", operations: operations.map((operation) => cloneOperation(operation)) });
  }

  function notify(payload) {
    for (const listener of listeners) listener(payload);
  }

  function ensurePolling() {
    if (pollTimer || !listeners.size) return;
    pollTimer = setInterval(() => {
      emitSnapshot().catch(() => {});
    }, pollMs);
    pollTimer.unref?.();
  }

  function maybeStopPolling() {
    if (listeners.size || !pollTimer) return;
    clearInterval(pollTimer);
    pollTimer = null;
  }

  async function withScopeLock(scopeKey, callback) {
    const locks = globalThis.navigator?.locks;
    if (!locks?.request) return callback();
    return locks.request(`email-gen:${scopeKey}`, { mode: "exclusive" }, callback);
  }

  async function read(scopeKey) {
    return cloneOperation(await repository.get("operations", scopeKey).catch(() => null));
  }

  async function updateWithoutLock(scopeKey, expectedRevision, patch) {
    const current = await repository.get("operations", scopeKey).catch(() => null);
    if (!current) throw Object.assign(new Error("Operation not found."), { code: "OPERATION_NOT_FOUND" });

    const buildNext = (base) => {
      const next = {
        ...base,
        ...patch,
        updatedAt: nowIso()
      };
      if (patch.status && isTerminal(next)) {
        next.leaseExpiresAt = null;
        next.ownerTabId = patch.ownerTabId === undefined ? base.ownerTabId : patch.ownerTabId;
      }
      return next;
    };

    const write = async (base, revision) => {
      const written = await repository.compareAndSwap("operations", scopeKey, revision, buildNext(base));
      await broadcast?.postMessage?.({
        type: "changed",
        scopeKey,
        operationId: written.operationId,
        status: written.status,
        revision: written.revision
      });
      notify({ type: "changed", scopeKey, operation: cloneOperation(written) });
      return written;
    };

    const revision = current.ownerTabId === tabId ? current.revision : (expectedRevision ?? current.revision);
    try {
      return await write(current, revision);
    } catch (error) {
      if (error?.code !== "REVISION_CONFLICT") throw error;
      const latest = await repository.get("operations", scopeKey).catch(() => null);
      if (
        latest &&
        latest.operationId === current.operationId &&
        (latest.ownerTabId === tabId || latest.ownerTabId == null)
      ) {
        return write(latest, latest.revision);
      }
      throw error;
    }
  }

  async function update(scopeKey, expectedRevision, patch) {
    return withScopeLock(scopeKey, () => updateWithoutLock(scopeKey, expectedRevision, patch));
  }

  async function heartbeat(operation) {
    return update(operation.scopeKey, operation.revision, {
      leaseExpiresAt: new Date(Date.now() + leaseMs).toISOString(),
      heartbeatAt: nowIso()
    });
  }

  async function release(operation, patch = {}) {
    const current = await repository.get("operations", operation.scopeKey).catch(() => null);
    if (current && current.operationId === operation.operationId && isTerminal(current)) {
      return current;
    }
    const nextPatch = {
      ...patch,
      leaseExpiresAt: null,
      ownerTabId: patch.ownerTabId === undefined ? operation.ownerTabId : patch.ownerTabId
    };
    return update(operation.scopeKey, operation.revision, nextPatch);
  }

  async function acquire(scopeIdentity, options = {}) {
    if (!isObject(scopeIdentity) || !scopeIdentity.scopeKey) {
      throw Object.assign(new Error("Scope identity is required."), { code: "SCOPE_IDENTITY_REQUIRED" });
    }
    return withScopeLock(scopeIdentity.scopeKey, () => acquireWithoutLock(scopeIdentity, options));
  }

  async function acquireWithoutLock(scopeIdentity, options = {}) {
    const kind = options.kind || "operation";
    const current = await read(scopeIdentity.scopeKey);
    if (current && !sameFingerprint(current.fingerprint, scopeIdentity.fingerprint)) {
      throw Object.assign(new Error("Operation scope changed while acquiring the lock."), {
        code: "OPERATION_SCOPE_CONFLICT",
        latest: current
      });
    }
    if (current) {
      if (isUncertain(current)) {
        return { acquired: false, reason: "reconciliation-required", operation: current };
      }
      if (isActive(current) && !leaseExpired(current)) {
        return {
          acquired: false,
          reason: current.ownerTabId === tabId ? "owned" : "busy",
          operation: current
        };
      }
      if (
        isTerminal(current) &&
        options.before?.status &&
        isActive(options.before) &&
        options.before.operationId === current.operationId
      ) {
        return { acquired: false, reason: "duplicate", operation: current };
      }
      if (isTerminal(current) && options.retryExisting) {
        const restarted = {
          ...current,
          ownerTabId: tabId,
          status: options.initialStatus || "acquired",
          leaseExpiresAt: new Date(Date.now() + leaseMs).toISOString(),
          restartedAt: nowIso(),
          attempt: (current.attempt ?? 0) + 1,
          updatedAt: nowIso()
        };
        const written = await repository.compareAndSwap(
          "operations",
          scopeIdentity.scopeKey,
          current.revision,
          restarted
        );
        await broadcast?.postMessage?.({
          type: "changed",
          scopeKey: scopeIdentity.scopeKey,
          operationId: written.operationId,
          status: written.status,
          revision: written.revision
        });
        notify({ type: "changed", scopeKey: scopeIdentity.scopeKey, operation: cloneOperation(written) });
        return { acquired: true, operation: written };
      }
      if (isTerminal(current) && options.reuseTerminal) {
        return { acquired: false, reason: "terminal", operation: current };
      }
    }

    const operationId = current?.operationId && isUncertain(current) ? current.operationId : makeId(kind);
    const next = {
      scopeKey: scopeIdentity.scopeKey,
      kind,
      operationId,
      ownerTabId: tabId,
      status: options.initialStatus || "acquired",
      leaseExpiresAt: new Date(Date.now() + leaseMs).toISOString(),
      fingerprint: scopeIdentity.fingerprint,
      startedAt: current?.startedAt || nowIso(),
      updatedAt: nowIso(),
      previousOperationId: current?.operationId ?? null
    };
    const expectedRevision = current?.revision ?? 0;
    const written = await repository.compareAndSwap(
      "operations",
      scopeIdentity.scopeKey,
      expectedRevision,
      next
    );
    await broadcast?.postMessage?.({
      type: "changed",
      scopeKey: scopeIdentity.scopeKey,
      operationId: written.operationId,
      status: written.status,
      revision: written.revision
    });
    notify({ type: "changed", scopeKey: scopeIdentity.scopeKey, operation: cloneOperation(written) });
    return { acquired: true, operation: written };
  }

  async function reconcile(scopeKey, resolver) {
    return withScopeLock(scopeKey, async () => {
      const current = await read(scopeKey);
      if (!current) return null;
      const decision = await resolver?.(current);
      if (!decision) return current;
      return updateWithoutLock(scopeKey, current.revision, decision);
    });
  }

  async function takeOverAfterExpiry(scopeKey, resolver) {
    return withScopeLock(scopeKey, async () => {
      const current = await read(scopeKey);
      if (!current) return null;
      if (!leaseExpired(current)) {
        return { acquired: false, reason: "not-expired", operation: current };
      }
      const reconcileResult = await resolver?.(current);
      if (!reconcileResult?.canTakeOver) {
        return { acquired: false, reason: "reconciliation-required", operation: current };
      }
      const next = {
        ...current,
        ownerTabId: tabId,
        status: "acquired",
        leaseExpiresAt: new Date(Date.now() + leaseMs).toISOString(),
        takeoverAt: nowIso(),
        updatedAt: nowIso()
      };
      const written = await repository.compareAndSwap("operations", scopeKey, current.revision, next);
      await broadcast?.postMessage?.({
        type: "changed",
        scopeKey,
        operationId: written.operationId,
        status: written.status,
        revision: written.revision
      });
      notify({ type: "changed", scopeKey, operation: cloneOperation(written) });
      return { acquired: true, operation: written };
    });
  }

  async function list() {
    return repository.all("operations");
  }

  function observe(listener) {
    listeners.add(listener);
    ensurePolling();
    return () => {
      listeners.delete(listener);
      maybeStopPolling();
    };
  }

  async function refresh() {
    await emitSnapshot();
  }

  async function close() {
    listeners.clear();
    maybeStopPolling();
    broadcast?.close?.();
  }

  return {
    tabId,
    read,
    list,
    observe,
    refresh,
    acquire,
    update,
    heartbeat,
    release,
    reconcile,
    takeOverAfterExpiry,
    isActive,
    isUncertain,
    isTerminal,
    leaseExpired,
    operationStatusLabel,
    operationIsBlocking,
    operationOwnerLabel,
    close
  };
}

export async function withBrowserExclusiveLock(lockName, callback) {
  const locks = globalThis.navigator?.locks;
  if (!locks?.request) return callback();
  return locks.request(lockName, { mode: "exclusive" }, callback);
}
