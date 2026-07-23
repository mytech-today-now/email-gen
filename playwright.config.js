import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 90000,
  workers: 3,
  retries: 1,
  use: {
    baseURL: "http://127.0.0.1:3200",
    trace: "retain-on-failure"
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } }
  ],
  webServer: {
    command: "node tests/e2e/start-server.mjs",
    url: "http://127.0.0.1:3200/api/health",
    reuseExistingServer: false,
    timeout: 90000
  }
});
