import fs from "node:fs";
import path from "node:path";

const rootDir = process.cwd();
const config = JSON.parse(fs.readFileSync(path.join(rootDir, ".secretscan.json"), "utf8"));
const ignorePatterns = (config.ignorePathPatterns ?? []).map((pattern) => new RegExp(pattern));
const binaryExtensions = new Set(config.binaryExtensions ?? []);
const detectors = (config.patterns ?? []).map((pattern) => ({
  name: pattern.name,
  regex: new RegExp(pattern.regex, "g")
}));

function shouldIgnore(relativePath) {
  const normalized = relativePath.replace(/\\/g, "/");
  return ignorePatterns.some((pattern) => pattern.test(normalized));
}

function isBinary(relativePath) {
  return binaryExtensions.has(path.extname(relativePath).toLowerCase());
}

function lineAndColumn(text, index) {
  const lines = text.slice(0, index).split("\n");
  return {
    line: lines.length,
    column: lines.at(-1).length + 1
  };
}

function scanFile(relativePath, findings) {
  if (shouldIgnore(relativePath) || isBinary(relativePath)) return;
  const absolutePath = path.join(rootDir, relativePath);
  const content = fs.readFileSync(absolutePath, "utf8");
  for (const detector of detectors) {
    detector.regex.lastIndex = 0;
    for (const match of content.matchAll(detector.regex)) {
      const position = lineAndColumn(content, match.index ?? 0);
      findings.push({
        file: relativePath.replace(/\\/g, "/"),
        detector: detector.name,
        line: position.line,
        column: position.column,
        sample: match[0].slice(0, 24)
      });
    }
  }
}

function walk(relativeDir, findings) {
  const absoluteDir = path.join(rootDir, relativeDir);
  for (const entry of fs.readdirSync(absoluteDir, { withFileTypes: true })) {
    const relativePath = path.join(relativeDir, entry.name);
    if (shouldIgnore(relativePath)) continue;
    if (entry.isDirectory()) walk(relativePath, findings);
    else if (entry.isFile()) scanFile(relativePath, findings);
  }
}

const findings = [];
walk(".", findings);

if (findings.length) {
  console.error("Potential secrets detected:");
  for (const finding of findings) {
    console.error(
      `${finding.file}:${finding.line}:${finding.column} [${finding.detector}] ${finding.sample}`
    );
  }
  process.exitCode = 1;
} else {
  console.log("No committed secret patterns detected.");
}
