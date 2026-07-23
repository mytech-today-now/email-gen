import { defineConfig } from "vitest/config";

const sharedTimeouts = {
  testTimeout: 90000,
  hookTimeout: 90000,
  teardownTimeout: 90000
};

export default defineConfig({
  test: {
    environment: "node",
    exclude: ["node_modules/**", "tests/e2e/**"],
    pool: "threads",
    ...sharedTimeouts,
    maxWorkers: 1,
    fileParallelism: false,
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      thresholds: {
        statements: 55,
        branches: 45,
        functions: 50,
        lines: 55
      },
      include: ["src/**/*.js"],
      exclude: ["src/app.js", "src/routes/**/*.js"]
    }
  }
});
