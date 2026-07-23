import path from "node:path";
import pino from "pino";
import { createStream } from "rotating-file-stream";
import { ensureDir } from "./files.js";

const REDACT_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  "headers.authorization",
  "headers.cookie",
  "apiKey",
  "apikey",
  "password",
  "token",
  "secret",
  "*.apiKey",
  "*.authorization",
  "*.cookie"
];

const SECRET_PATTERNS = [
  /xai-[A-Za-z0-9_-]{8,}/g,
  /sk-[A-Za-z0-9_-]{8,}/g,
  /sk-ant-[A-Za-z0-9_-]{8,}/g,
  /(authorization:\s*bearer\s+)[A-Za-z0-9._-]+/gi,
  /([?&](?:key|token|secret|api_key)=)[^&\s]+/gi
];

export function redactSecrets(value) {
  let text = typeof value === "string" ? value : JSON.stringify(value);
  for (const pattern of SECRET_PATTERNS) {
    text = text.replace(pattern, (_match, prefix = "") => `${prefix}[REDACTED]`);
  }
  return text;
}

export function createAppLogger(config) {
  ensureDir(config.logsDir);
  const fileStream = createStream(config.logFileName, {
    path: config.logsDir,
    size: `${config.limits.logMaxSize}B`,
    maxFiles: config.limits.logMaxFiles,
    compress: "gzip"
  });
  let fileStreamWarned = false;
  fileStream.on("error", (error) => {
    if (fileStreamWarned) return;
    fileStreamWarned = true;
    console.warn("[log-stream-error]", {
      message: redactSecrets(error?.message || String(error)),
      degradedLogging: true
    });
  });

  const streams = [{ stream: process.stdout }, { stream: fileStream }];
  const logger = pino(
    {
      name: "email-gen",
      level: config.logLevel,
      timestamp: pino.stdTimeFunctions.isoTime,
      formatters: {
        level(label) {
          return { level: label, severity: label === "warn" ? "warning" : label };
        }
      },
      redact: { paths: REDACT_PATHS, censor: "[REDACTED]" },
      serializers: {
        err(error) {
          if (!error) return error;
          return {
            type: error.name,
            message: redactSecrets(error.message),
            code: error.code,
            status: error.status,
            stack: config.diagnosticLogging ? redactSecrets(error.stack ?? "") : undefined
          };
        }
      },
      base: { pid: process.pid, app: "ai-batch-personalizer" }
    },
    pino.multistream(streams)
  );
  logger.close = () => {
    logger.flush?.();
    fileStream.end?.();
  };
  return logger;
}

export function logFilePath(config) {
  return path.join(config.logsDir, config.logFileName);
}
