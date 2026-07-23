import fs from "node:fs";
import path from "node:path";
import archiver from "archiver";
import { safeExportFilename, uniquePath, ensureDir } from "../utils/files.js";
import { renderHtmlDocument } from "./documentRenderer.js";
import { contactCandidatesForResult } from "./contactActions.js";

function writeUtf8Atomic(filePath, content) {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(tempPath, content, "utf8");
    fs.renameSync(tempPath, filePath);
  } finally {
    if (fs.existsSync(tempPath)) fs.rmSync(tempPath, { force: true });
  }
}

export function writeResultHtml(result, record, config) {
  ensureDir(config.outputDir);
  const filename = safeExportFilename({
    id: record.normalized?.id ?? record.id,
    name: record.displayName,
    suffix: "ai-sms",
    maxLength: config.limits.exportFilenameLength
  });
  const filePath = uniquePath(config.outputDir, filename);
  writeUtf8Atomic(
    filePath,
    renderHtmlDocument({
      subject: result.subject,
      emailHtml: result.emailHtml,
      config,
      contactCandidates: contactCandidatesForResult(result, record)
    })
  );
  return { filePath, filename: path.basename(filePath) };
}

export async function writeResultsZip(items, config) {
  ensureDir(config.outputDir);
  const filePath = uniquePath(config.outputDir, "email-exports.zip");
  const output = fs.createWriteStream(filePath);
  const archive = archiver("zip", { zlib: { level: 9 } });
  archive.pipe(output);
  for (const { result, record } of items) {
    const filename = safeExportFilename({
      id: record.normalized?.id ?? record.id,
      name: record.displayName,
      suffix: "ai-sms",
      maxLength: config.limits.exportFilenameLength
    });
    archive.append(
      renderHtmlDocument({
        subject: result.subject,
        emailHtml: result.emailHtml,
        config,
        contactCandidates: contactCandidatesForResult(result, record)
      }),
      { name: filename }
    );
  }
  await archive.finalize();
  await new Promise((resolve, reject) => {
    output.on("close", resolve);
    output.on("error", reject);
  });
  return { filePath, filename: path.basename(filePath) };
}
