import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    exclude: ["node_modules/**", "tests/e2e/**"],
    testTimeout: 20000,
    hookTimeout: 20000,
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
