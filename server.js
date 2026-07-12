import { createApp } from "./src/app.js";
import { closeDatabase } from "./src/persistence/database.js";

const { app, context } = createApp();

const server = app.listen(context.config.port, context.config.host, () => {
  context.logger.info(
    { host: context.config.host, port: context.config.port },
    `AI Batch Personalizer listening at http://${context.config.host}:${context.config.port}`
  );
});

function shutdown(signal) {
  context.logger.info({ signal }, "Shutting down");
  if (context.modelSyncTimer) clearInterval(context.modelSyncTimer);
  server.close(() => {
    closeDatabase(context.db);
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 8000).unref();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
