import { createApp } from "./src/app.js";
import { createShutdownCoordinator } from "./src/lifecycle/shutdown.js";
import { closeDatabase } from "./src/persistence/database.js";

const { app, context } = createApp();

const server = app.listen(context.config.port, context.config.host, () => {
  context.logger.info(
    { host: context.config.host, port: context.config.port },
    `AI Batch Personalizer listening at http://${context.config.host}:${context.config.port}`
  );
});

server.requestTimeout = Math.max(
  context.config.limits.responseDeadlineMs + context.config.limits.cancellationLatencyMs,
  30_000
);
server.headersTimeout = Math.max(server.requestTimeout + 1_000, 5_000);
server.keepAliveTimeout = Math.max(context.config.limits.responseIdleTimeoutMs, 5_000);
server.timeout = Math.max(context.config.limits.responseIdleTimeoutMs, 5_000);

context.logger.info(
  {
    requestTimeoutMs: server.requestTimeout,
    headersTimeoutMs: server.headersTimeout,
    keepAliveTimeoutMs: server.keepAliveTimeout,
    socketTimeoutMs: server.timeout
  },
  "Server timeout policy configured"
);

const shutdown = createShutdownCoordinator({
  context,
  server,
  logger: context.logger,
  closeDatabase,
  drainTimeoutMs: Math.max(8_000, context.config.limits.cancellationLatencyMs)
});
shutdown.attachServer(server);
shutdown.installProcessHandlers();
