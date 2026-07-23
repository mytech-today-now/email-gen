import fs from "node:fs";
import path from "node:path";
import archiver from "archiver";
import { safeExportFilename, slugify, uniquePath, ensureDir } from "../utils/files.js";
import { renderHtmlDocument } from "./documentRenderer.js";
import { htmlToPlainText } from "./sanitizer.js";
import { contactCandidatesForResult } from "./contactActions.js";

export const deliveryExportProfiles = [
  { id: "all", label: "All services and clients" },
  { id: "beehiiv", label: "Beehiiv" },
  { id: "mailchimp", label: "Mailchimp" },
  { id: "constant-contact", label: "Constant Contact" },
  { id: "email-clients", label: "Outlook, Thunderbird, AOL" },
  { id: "generic", label: "Generic or API handoff" }
];

const profileIds = new Set(deliveryExportProfiles.map((profile) => profile.id));
const emailFieldPriority = [
  "email",
  "emailAddress",
  "recipientEmail",
  "contactEmail",
  "workEmail",
  "businessEmail",
  "ownerEmail"
];

function assertSupportedProfile(profile) {
  if (!profileIds.has(profile)) {
    throw new Error(`Unsupported delivery export profile '${profile}'.`);
  }
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(rows) {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  return [
    headers.map(csvCell).join(","),
    ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(","))
  ].join("\r\n");
}

function cleanHeader(value) {
  return String(value ?? "")
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function validEmail(value) {
  const candidate = cleanHeader(value);
  return /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(candidate) ? candidate : "";
}

function recipientEmail(record) {
  const normalized = record?.normalized ?? {};
  for (const field of emailFieldPriority) {
    const email = validEmail(normalized[field]);
    if (email) return email;
  }
  for (const [key, value] of Object.entries(normalized)) {
    if (/email/i.test(key)) {
      const email = validEmail(value);
      if (email) return email;
    }
  }
  return "";
}

function researchContact(result) {
  return result?.research?.contact ?? result?.research?.metadata?.contact ?? {};
}

function researchEmail(result) {
  const contact = researchContact(result);
  return validEmail(contact.primaryEmail) || validEmail(contact.emails?.[0]) || "";
}

function contactPageUrl(result) {
  const contact = researchContact(result);
  return cleanHeader(contact.contactPage || contact.contactPages?.[0] || "");
}

function nameParts(record) {
  const normalized = record?.normalized ?? {};
  const name = cleanHeader(normalized.name ?? normalized.contactName ?? record?.displayName ?? "");
  const first = cleanHeader(normalized.firstName ?? normalized.first ?? name.split(/\s+/)[0] ?? "");
  const last =
    cleanHeader(normalized.lastName ?? normalized.last ?? name.split(/\s+/).slice(1).join(" ")) || "";
  return { name, first, last };
}

function companyName(record) {
  const normalized = record?.normalized ?? {};
  return cleanHeader(normalized.company ?? normalized.business ?? normalized.name ?? record?.displayName ?? "");
}

function recordExternalId(record) {
  return cleanHeader(record?.normalized?.id ?? record?.normalized?.recordId ?? record?.id ?? "");
}

function itemBaseName(result, record, config, extension = ".html") {
  return safeExportFilename({
    id: record?.normalized?.id ?? record?.id,
    name: record?.displayName,
    suffix: result.subject || "email",
    extension,
    maxLength: config.limits.exportFilenameLength
  });
}

function deliveryRows(items) {
  return items.map(({ result, record }) => {
    const { name, first, last } = nameParts(record);
    const row = {
      result,
      record,
      email: recipientEmail(record),
      name,
      first,
      last,
      company: companyName(record),
      recordId: recordExternalId(record),
      subject: cleanHeader(result.subject),
      bodyHtml: result.emailHtml || result.bodyHtml || "",
      bodyText: result.bodyText || htmlToPlainText(result.emailHtml || result.bodyHtml || ""),
      contactPage: contactPageUrl(result)
    };
    row.email = row.email || researchEmail(result);
    return row;
  });
}

function platformRows(rows, platform) {
  return rows.map((row) => {
    if (platform === "mailchimp") {
      return {
        "Email Address": row.email,
        "First Name": row.first,
        "Last Name": row.last,
        Tags: "ai-personalized",
        AI_SUBJECT: row.subject,
        AI_HTML: row.bodyHtml,
        AI_TEXT: row.bodyText,
        CONTACT_PAGE: row.contactPage,
        RECORD_ID: row.recordId
      };
    }
    if (platform === "constant-contact") {
      return {
        "Email Address": row.email,
        "First Name": row.first,
        "Last Name": row.last,
        "Company Name": row.company,
        Tags: "ai-personalized",
        "Custom Field 1": row.subject,
        "Custom Field 2": row.bodyHtml,
        "Custom Field 3": row.bodyText,
        "Custom Field 4": row.contactPage,
        "Record ID": row.recordId
      };
    }
    return {
      email: row.email,
      name: row.name,
      first_name: row.first,
      last_name: row.last,
      tags: "ai-personalized",
      subject: row.subject,
      body_html: row.bodyHtml,
      body_text: row.bodyText,
      contact_page: row.contactPage,
      record_id: row.recordId
    };
  });
}

function emlFor(row, config) {
  const boundary = `email-gen-${slugify(row.result.id, "result")}`;
  const to = row.email ? `${row.name ? `"${cleanHeader(row.name).replace(/"/g, "")}" ` : ""}<${row.email}>` : "";
  const html = renderHtmlDocument({
    subject: row.subject,
    emailHtml: row.bodyHtml,
    config,
    contactCandidates: contactCandidatesForResult(row.result, row.record)
  });
  const headers = [
    `From: ${cleanHeader(config.business.name || "Generated Email")} <no-reply@example.invalid>`,
    `To: ${to}`,
    `Subject: ${row.subject}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "X-Generated-By: AI Batch Personalizer"
  ];
  const body = [
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    row.bodyText,
    "",
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    html,
    "",
    `--${boundary}--`,
    ""
  ];
  return [...headers, "", ...body].join("\r\n");
}

function mboxFor(rows, config) {
  return rows
    .map((row) => {
      const sender = "no-reply@example.invalid";
      const escaped = emlFor(row, config).replace(/^From /gm, ">From ");
      return `From ${sender} ${new Date().toUTCString()}\r\n${escaped}\r\n`;
    })
    .join("\r\n");
}

function apiPayload(rows) {
  return rows
    .map((row) =>
      JSON.stringify({
        to: row.email || null,
        subject: row.subject,
        html: row.bodyHtml,
        text: row.bodyText,
        contactPage: row.contactPage || null,
        metadata: {
          recordId: row.recordId || null,
          resultId: row.result.id,
          recordName: row.name || null
        }
      })
    )
    .join("\n");
}

function contactFallbackRows(rows, config) {
  return rows
    .filter((row) => !row.email && row.contactPage)
    .map((row) => ({
      name: row.name,
      company: row.company,
      contact_page: row.contactPage,
      subject: row.subject,
      message: row.bodyText,
      sender_name: config.business.name,
      sender_email: config.business.email,
      record_id: row.recordId
    }));
}

function addContactFallbackArtifacts(artifacts, rows, folder, config) {
  const fallbackRows = contactFallbackRows(rows, config);
  if (!fallbackRows.length) return;
  artifacts.push({ name: `${folder}/contact-form-fallbacks.csv`, content: toCsv(fallbackRows) });
  artifacts.push({
    name: `${folder}/contact-form-fallbacks.json`,
    content: JSON.stringify(fallbackRows, null, 2)
  });
}

function readme(profile, count) {
  return [
    "Email delivery kit",
    "",
    `Profile: ${profile}`,
    `Completed emails: ${count}`,
    "",
    "Folders:",
    "- beehiiv, mailchimp, constant-contact: CSV files plus HTML/text payloads for campaign or contact imports.",
    "- email-clients: .eml drafts, an .mbox bundle, and AOL-friendly copy/paste text drafts.",
    "- generic: CSV, HTML, text, and JSONL records for API, webhook, CRM, or other email tools.",
    "- contact-form-fallbacks: rows where no email was found, but a contact page was found. Use the included subject and message to complete the form manually.",
    "",
    "Use the files that match the system you are sending from. Records without an email address are kept in the exports with a blank recipient so they can be fixed before sending."
  ].join("\r\n");
}

function addPlatformArtifacts(artifacts, rows, items, config, platform) {
  const folder = platform;
  artifacts.push({ name: `${folder}/contacts.csv`, content: toCsv(platformRows(rows, platform)) });
  addContactFallbackArtifacts(artifacts, rows, folder, config);
  rows.forEach((row, index) => {
    const { result, record } = items[index];
    const htmlName = itemBaseName(result, record, config);
    const textName = itemBaseName(result, record, config, ".txt");
    artifacts.push({
      name: `${folder}/campaign-html/${htmlName}`,
      content: renderHtmlDocument({
        subject: row.subject,
        emailHtml: row.bodyHtml,
        config,
        contactCandidates: contactCandidatesForResult(result, record)
      })
    });
    artifacts.push({ name: `${folder}/plain-text/${textName}`, content: row.bodyText });
  });
}

function addClientArtifacts(artifacts, rows, items, config) {
  artifacts.push({ name: "email-clients/send-list.csv", content: toCsv(platformRows(rows, "beehiiv")) });
  const emailRows = rows.filter((row) => row.email);
  artifacts.push({ name: "email-clients/outlook-thunderbird.mbox", content: mboxFor(emailRows, config) });
  addContactFallbackArtifacts(artifacts, rows, "email-clients", config);
  rows.forEach((row, index) => {
    const { result, record } = items[index];
    const emlName = itemBaseName(result, record, config, ".eml");
    const txtName = itemBaseName(result, record, config, ".txt");
    if (row.email) artifacts.push({ name: `email-clients/eml/${emlName}`, content: emlFor(row, config) });
    artifacts.push({
      name: `email-clients/aol-copy-paste/${txtName}`,
      content: [`To: ${row.email}`, `Subject: ${row.subject}`, "", row.bodyText].join("\r\n")
    });
  });
}

function addGenericArtifacts(artifacts, rows, items, config) {
  artifacts.push({ name: "generic/send-list.csv", content: toCsv(platformRows(rows, "beehiiv")) });
  artifacts.push({ name: "generic/api-payload.jsonl", content: apiPayload(rows) });
  addContactFallbackArtifacts(artifacts, rows, "generic", config);
  artifacts.push({
    name: "generic/webhook-example.json",
    content: JSON.stringify(
      {
        method: "POST",
        contentType: "application/json",
        bodyShape: { to: "recipient@example.com", subject: "Subject", html: "<p>HTML</p>", text: "Text" }
      },
      null,
      2
    )
  });
  rows.forEach((row, index) => {
    const { result, record } = items[index];
    artifacts.push({
      name: `generic/html/${itemBaseName(result, record, config)}`,
      content: renderHtmlDocument({
        subject: row.subject,
        emailHtml: row.bodyHtml,
        config,
        contactCandidates: contactCandidatesForResult(result, record)
      })
    });
    artifacts.push({
      name: `generic/plain-text/${itemBaseName(result, record, config, ".txt")}`,
      content: row.bodyText
    });
  });
}

export function buildDeliveryArtifacts(items, config, { profile = "all" } = {}) {
  assertSupportedProfile(profile);
  const rows = deliveryRows(items);
  const artifacts = [
    { name: "README.txt", content: readme(profile, rows.length) },
    {
      name: "manifest.json",
      content: JSON.stringify(
        {
          profile,
          generatedAt: new Date().toISOString(),
          count: rows.length,
          targets:
            profile === "all"
              ? deliveryExportProfiles.filter((item) => item.id !== "all").map((item) => item.id)
              : [profile]
        },
        null,
        2
      )
    }
  ];

  if (profile === "all" || profile === "beehiiv") addPlatformArtifacts(artifacts, rows, items, config, "beehiiv");
  if (profile === "all" || profile === "mailchimp") {
    addPlatformArtifacts(artifacts, rows, items, config, "mailchimp");
  }
  if (profile === "all" || profile === "constant-contact") {
    addPlatformArtifacts(artifacts, rows, items, config, "constant-contact");
  }
  if (profile === "all" || profile === "email-clients") addClientArtifacts(artifacts, rows, items, config);
  if (profile === "all" || profile === "generic") addGenericArtifacts(artifacts, rows, items, config);

  return artifacts;
}

export async function writeDeliveryExport(items, config, { profile = "all" } = {}) {
  ensureDir(config.outputDir);
  assertSupportedProfile(profile);
  const artifacts = buildDeliveryArtifacts(items, config, { profile });
  const filePath = uniquePath(config.outputDir, `delivery-${profile}.zip`);
  const output = fs.createWriteStream(filePath);
  const archive = archiver("zip", { zlib: { level: 9 } });
  const finished = new Promise((resolve, reject) => {
    output.on("close", resolve);
    output.on("error", reject);
  });
  archive.pipe(output);
  for (const artifact of artifacts) {
    archive.append(artifact.content, { name: artifact.name });
  }
  await archive.finalize();
  await finished;
  return {
    filePath,
    filename: path.basename(filePath),
    profile,
    itemCount: items.length,
    files: artifacts.map((artifact) => artifact.name)
  };
}
