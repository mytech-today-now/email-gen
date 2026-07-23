import { setTimeout as sleep } from "node:timers/promises";
import { nowIso } from "../utils/helpers.js";
import { createShutdownError } from "../utils/errors.js";

function markLifecycle(lifecycle, phase, extra = {}) {
  lifecycle.phase = phase;
  lifecycle.ready = phase === "RUNNING";
  lifecycle.updatedAt = nowIso();
  Object.assign(lifecycle, extra);
  return lifecycle;
}

function safeLoggerCall(logger, level, payload, message) {
  logger?.[level]?.(payload, message);
}

function destroyTrackedSockets(sockets) {
  for (const socket of sockets) {
    try {
      socket.destroy();
    } catch {
      // Best-effort cleanup only.
    }
  }
}

function closeSockets(server, sockets, logger, reason, { destroy = false } = {}) {
  if (server?.closeIdleConnections) {
    try {
      server.closeIdleConnections();
    } catch (error) {
      safeLoggerCall(logger, "warn", { err: error, reason }, "Failed to close idle connections");
    }
  }
  if (destroy) destroyTrackedSockets(sockets);
}

export function createShutdownCoordinator({
  context,
  server = null,
  logger,
  closeDatabase,
  drainTimeoutMs = 8_000
} = {}) {
  if (!context) throw new Error("A shutdown coordinator requires an application context.");

  const lifecycle =
    context.lifecycle ??
    markLifecycle(
      {
        phase: "RUNNING",
        ready: true,
        startedAt: nowIso(),
        updatedAt: nowIso()
      },
      "RUNNING"
    );
  context.lifecycle = lifecycle;

  const shutdownController = context.shutdownController ?? new AbortController();
  context.shutdownController = shutdownController;

  const sockets = new Set();
  let attachedServer = server;
  let shutdownPromise = null;
  let processHandlersInstalled = false;
  let hardDeadlineTimer = null;
  let finalized = false;

  function attachServer(targetServer) {
    if (!targetServer) return null;
    attachedServer = targetServer;
    targetServer.on("connection", (socket) => {
      sockets.add(socket);
      socket.once("close", () => sockets.delete(socket));
      if (lifecycle.phase !== "RUNNING") {
        socket.destroy();
      }
    });
    return targetServer;
  }

  function requestStopConnections(reason, { destroy = false } = {}) {
    if (!attachedServer) return;
    closeSockets(attachedServer, sockets, logger, reason, { destroy });
  }

  async function finalizeShutdown(reason, { fatal = false } = {}) {
    if (finalized) return;
    finalized = true;
    markLifecycle(lifecycle, "FINALIZING", {
      reason,
      shutdownReason: reason,
      shutdownCompletedAt: null
    });
    safeLoggerCall(logger, "info", { reason, phase: lifecycle.phase }, "Shutdown finalizing");

    try {
      await Promise.resolve(logger?.flush?.());
    } catch (error) {
      safeLoggerCall(logger, "warn", { err: error, reason }, "Logger flush failed during shutdown");
    }

    if (typeof context.modelSyncTimer === "object" || typeof context.modelSyncTimer === "number") {
      clearInterval(context.modelSyncTimer);
      context.modelSyncTimer = null;
    }

    if (typeof context.modelSynchronizer?.stopSchedule === "function") {
      try {
        context.modelSynchronizer.stopSchedule();
      } catch {
        // Ignore best-effort cleanup failures.
      }
    }

    if (closeDatabase) {
      try {
        closeDatabase(context.db);
        safeLoggerCall(logger, "info", { reason }, "Database closed during shutdown");
      } catch (error) {
        safeLoggerCall(logger, "error", { err: error, reason }, "Database close failed during shutdown");
      }
    }

    try {
      await Promise.resolve(logger?.flush?.());
    } catch (error) {
      safeLoggerCall(logger, "warn", { err: error, reason }, "Logger flush failed after database close");
    }

    try {
      await Promise.resolve(logger?.close?.());
    } catch (error) {
      safeLoggerCall(logger, "warn", { err: error, reason }, "Logger close failed during shutdown");
    }

    markLifecycle(lifecycle, "CLOSED", {
      reason,
      shutdownCompletedAt: nowIso(),
      ready: false
    });
    process.exitCode = fatal ? 1 : (process.exitCode ?? 0);
  }

  async function beginShutdown(reason, { fatal = false } = {}) {
    if (shutdownPromise) {
      if (lifecycle.phase === "DRAINING") {
        requestStopConnections(`${reason}:force`, { destroy: true });
      }
      return shutdownPromise;
    }

    shutdownPromise = (async () => {
      markLifecycle(lifecycle, "DRAINING", {
        reason,
        shutdownRequestedAt: nowIso()
      });
      shutdownController.abort(createShutdownError(reason, lifecycle.phase));
      safeLoggerCall(logger, "info", { reason, phase: lifecycle.phase }, "Shutdown draining started");

      requestStopConnections(reason);

      hardDeadlineTimer = setTimeout(() => {
        requestStopConnections(`${reason}:deadline`, { destroy: true });
      }, drainTimeoutMs);
      hardDeadlineTimer.unref?.();

      try {
        await Promise.race([
          attachedServer
            ? new Promise((resolve) => {
                try {
                  attachedServer.close?.(() => resolve("closed"));
                } catch {
                  resolve("failed");
                }
              })
            : Promise.resolve("no-server"),
          sleep(drainTimeoutMs)
        ]);
      } catch (error) {
        safeLoggerCall(logger, "warn", { err: error, reason }, "Shutdown drain wait failed");
      } finally {
        if (hardDeadlineTimer) clearTimeout(hardDeadlineTimer);
      }

      await finalizeShutdown(reason, { fatal });
    })().catch(async (error) => {
      safeLoggerCall(logger, "error", { err: error, reason }, "Shutdown coordinator failed");
      process.exitCode = 1;
      try {
        await finalizeShutdown(reason, { fatal: true });
      } catch {
        // Final best-effort cleanup already attempted.
      }
    });

    return shutdownPromise;
  }

  function installProcessHandlers() {
    if (processHandlersInstalled) return;
    processHandlersInstalled = true;

    process.on("SIGINT", () => {
      void beginShutdown("SIGINT");
    });
    process.on("SIGTERM", () => {
      void beginShutdown("SIGTERM");
    });
    process.on("unhandledRejection", (reason) => {
      safeLoggerCall(
        logger,
        "fatal",
        { err: reason, reason: "unhandledRejection" },
        "Unhandled promise rejection"
      );
      void beginShutdown("unhandledRejection", { fatal: true });
    });
    process.on("uncaughtException", (error) => {
      safeLoggerCall(logger, "fatal", { err: error, reason: "uncaughtException" }, "Uncaught exception");
      void beginShutdown("uncaughtException", { fatal: true });
    });
  }

  return {
    lifecycle,
    signal: shutdownController.signal,
    sockets,
    attachServer,
    installProcessHandlers,
    beginShutdown
  };
}
