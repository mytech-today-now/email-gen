import { spawnSync } from "node:child_process";

const sections = new Map([
  [
    "01",
    {
      label: "core browser workflows",
      files: ["tests/e2e/app.spec.js"],
      env: { AI_MOCK: "true" }
    }
  ],
  [
    "02",
    {
      label: "multi-tab and batch workflows",
      files: ["tests/e2e/multi-tab.spec.js", "tests/e2e/provider-batch.spec.js"],
      env: { AI_MOCK: "true" }
    }
  ],
  [
    "03",
    {
      label: "responsive layout checks",
      files: ["tests/e2e/responsive-layout.spec.js"],
      env: { AI_MOCK: "true" }
    }
  ],
  [
    "04",
    {
      label: "live credential checks",
      files: ["tests/e2e/live-credentials.spec.js"],
      env: { AI_MOCK: "false", RUN_LIVE_E2E: "true" }
    }
  ]
]);

const rawSection = (process.argv[2] || "").trim();
const extraArgs = process.argv.slice(3).filter((arg) => arg !== "--");
const section = normalizeSection(rawSection);
const config = sections.get(section);

if (!config) {
  printUsage();
  process.exit(1);
}

const env = {
  ...process.env,
  NODE_ENV: "test",
  ...config.env
};

const playwrightCommand = "npx";
console.log(`> Playwright section ${section}: ${config.label}`);

const result = spawnSync(playwrightCommand, ["playwright", "test", ...config.files, ...extraArgs], {
  env,
  stdio: "inherit",
  shell: process.platform === "win32",
  windowsHide: true
});

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

process.exit(result.status ?? 1);

function normalizeSection(value) {
  if (/^\d+$/.test(value)) return value.padStart(2, "0");
  return value.toLowerCase();
}

function printUsage() {
  console.error("Usage: node scripts/test-e2e-section.mjs <01|02|03|04> [playwright args...]");
  console.error("Available sections:");
  for (const [section, config] of sections) {
    console.error(`  ${section}  ${config.label}`);
  }
}
