import fs from "node:fs";
import path from "node:path";
import archiver from "archiver";
import { safeExportFilename, uniquePath, ensureDir } from "../utils/files.js";
import { renderHtmlDocument } from "./documentRenderer.js";

export function writeResultHtml(result, record, config) {
  ensureDir(config.outputDir);
  const filename = safeExportFilename({
    id: record.normalized?.id ?? record.id,
    name: record.displayName,
    suffix: "ai-sms",
    maxLength: config.limits.exportFilenameLength
  });
  const filePath = uniquePath(config.outputDir, filename);
  fs.writeFileSync(filePath, renderHtmlDocument({ subject: result.subject, emailHtml: result.emailHtml, config }), "utf8");
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
    archive.append(renderHtmlDocument({ subject: result.subject, emailHtml: result.emailHtml, config }), { name: filename });
  }
  await archive.finalize();
  await new Promise((resolve, reject) => {
    output.on("close", resolve);
    output.on("error", reject);
  });
  return { filePath, filename: path.basename(filePath) };
}
