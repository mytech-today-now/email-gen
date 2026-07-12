import fs from "node:fs";
import path from "node:path";

process.env.NODE_ENV = "test";
process.env.AI_MOCK = "true";
process.env.DEFAULT_AI_PROVIDER = "mock";
process.env.DEFAULT_AI_MODEL = "mock-structured-v1";
process.env.ENABLED_AI_PROVIDERS = "openai,anthropic,xai,venice,lumaai,custom,mock";
process.env.CUSTOM_PROVIDER_BASE_URL = "http://127.0.0.1:9999/v1";
process.env.HOST = "127.0.0.1";
process.env.PORT = "3200";
process.env.LOG_LEVEL = "silent";
process.env.DEFAULT_DELAY_MS = "0";
process.env.RESEARCH_ENABLED = "true";
process.env.RESEARCH_RENDER_DELAY_MS = "0";
process.env.DATABASE_PATH = "storage/e2e.sqlite";

for (const suffix of ["", "-wal", "-shm"]) {
  fs.rmSync(path.resolve(`storage/e2e.sqlite${suffix}`), { force: true });
}

await import("../../server.js");
