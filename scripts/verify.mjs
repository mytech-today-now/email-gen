import { spawnSync } from "node:child_process";

const tasks = ["format:check", "lint", "scan:secrets", "test:coverage"];
const npmCommand = "npm";
const isWindows = process.platform === "win32";
const maxBuffer = 50 * 1024 * 1024;

for (const task of tasks) {
  console.log(`> npm run ${task}`);
  const result = spawnSync(npmCommand, ["run", task], {
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
    shell: isWindows,
    windowsHide: true,
    maxBuffer
  });
  if (result.error) {
    console.error(result.error);
    process.exit(1);
  }
  if (result.status !== 0) {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    process.exit(result.status ?? 1);
  }
}
