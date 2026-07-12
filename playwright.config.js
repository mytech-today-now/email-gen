import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30000,
  use: {
    baseURL: "http://127.0.0.1:3200",
    trace: "retain-on-failure"
  },
  webServer: {
    command: "node tests/e2e/start-server.mjs",
    url: "http://127.0.0.1:3200/api/health",
    reuseExistingServer: false,
    timeout: 30000
  }
});
