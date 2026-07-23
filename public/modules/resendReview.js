import { digestCanonical } from "./operationIdentity.js";

export const RESEND_BATCH_LIMIT = 100;
export const RESEND_REVIEW_TTL_MS = 15 * 60 * 1000;

function cleanHeader(value, max = 320) {
  return String(value ?? "")
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function validEmail(value) {
  const email = cleanHeader(value).toLowerCase();
  return /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(email) ? email : "";
}

function validHttpUrl(value) {
  const candidate = cleanHeader(value, 2000);
  try {
    const url = new URL(candidate);
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : "";
  } catch {
    return "";
  }
}

function normalizeSuppressionList(suppressions = []) {
  return [...new Set(suppressions.map((value) => validEmail(value)).filter(Boolean))].sort((left, right) =>
    left.localeCompare(right)
  );
}

function normalizeComparable(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function resendContentError(code, message, details = null) {
  return Object.assign(new Error(message), {
    code,
    status: 400,
    details
  });
}

export function validateResendComplianceContent(item, sender = {}, { bulk = false } = {}) {
  const companyAddress = cleanHeader(sender.companyAddress, 500);
  const unsubscribeUrl = validHttpUrl(sender.unsubscribeUrl);
  const normalizedHtml = normalizeComparable(item?.html);
  const normalizedText = normalizeComparable(item?.text);

  if (bulk && !companyAddress) {
    throw resendContentError(
      "RESEND_COMPANY_ADDRESS_REQUIRED",
      "Bulk sending requires a non-empty postal identification in the reviewed email content."
    );
  }
  if (bulk && !unsubscribeUrl) {
    throw resendContentError(
      "RESEND_UNSUBSCRIBE_URL_REQUIRED",
      "Bulk sending requires a valid visible unsubscribe target in the reviewed email content."
    );
  }
  if (companyAddress) {
    const normalizedCompanyAddress = normalizeComparable(companyAddress);
    if (
      !normalizedHtml.includes(normalizedCompanyAddress) &&
      !normalizedText.includes(normalizedCompanyAddress)
    ) {
      throw resendContentError(
        "RESEND_COMPANY_ADDRESS_MISSING",
        "The reviewed email content does not contain the configured postal identification."
      );
    }
  }
  if (unsubscribeUrl) {
    const normalizedUnsubscribeUrl = normalizeComparable(unsubscribeUrl);
    if (
      !normalizedHtml.includes(normalizedUnsubscribeUrl) &&
      !normalizedText.includes(normalizedUnsubscribeUrl)
    ) {
      throw resendContentError(
        "RESEND_UNSUBSCRIBE_URL_MISSING",
        "The reviewed email content does not contain the configured unsubscribe target."
      );
    }
  }
}

function normalizeSender(sender = {}) {
  return {
    fromName: cleanHeader(sender.fromName, 120),
    fromAddress: validEmail(sender.fromAddress),
    replyTo: validEmail(sender.replyTo),
    unsubscribeUrl: validHttpUrl(sender.unsubscribeUrl),
    companyAddress: cleanHeader(sender.companyAddress, 500)
  };
}

export function resendEligibility(item, { suppressions = [] } = {}) {
  const email = validEmail(item.primaryEmail);
  const reasons = [];
  if (!email) reasons.push("A valid primary email is required.");
  if (item.consentStatus !== "opted-in") reasons.push("Explicit opt-in consent is required.");
  if (!cleanHeader(item.consentSource)) reasons.push("A verifiable consent source is required.");
  if (!item.consentTimestamp || Number.isNaN(Date.parse(item.consentTimestamp))) {
    reasons.push("A valid consent timestamp is required.");
  }
  if (item.contactSource === "external-search" || item.contactSource === "scraped") {
    if (item.consentStatus !== "opted-in") {
      reasons.push("Discovered addresses cannot be sent without independent opt-in evidence.");
    }
  }
  if (normalizeSuppressionList(suppressions).includes(email)) reasons.push("Recipient is suppressed.");
  return { eligible: reasons.length === 0, email, reasons };
}

export function buildResendPreflight(items, config = {}) {
  const seen = new Set();
  const eligible = [];
  const excluded = [];
  for (const item of items) {
    const assessment = resendEligibility(item, config);
    if (!assessment.eligible) {
      excluded.push({ id: item.id, email: assessment.email, reasons: assessment.reasons });
      continue;
    }
    if (seen.has(assessment.email)) {
      excluded.push({
        id: item.id,
        email: assessment.email,
        reasons: ["Duplicate recipient in this send scope."]
      });
      continue;
    }
    seen.add(assessment.email);
    eligible.push({ ...item, primaryEmail: assessment.email });
  }
  const batchSize = Math.max(1, Math.min(RESEND_BATCH_LIMIT, Number(config.batchSize) || RESEND_BATCH_LIMIT));
  return {
    eligible,
    excluded,
    recipientCount: eligible.length,
    excludedCount: excluded.length,
    estimatedBatches: Math.ceil(eligible.length / batchSize)
  };
}

export function splitResendChunks(items, batchSize = RESEND_BATCH_LIMIT) {
  const size = Math.max(1, Math.min(RESEND_BATCH_LIMIT, Number(batchSize) || RESEND_BATCH_LIMIT));
  const chunks = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}

export function canonicalResendMessage(item, sender = {}) {
  const normalizedSender = normalizeSender(sender);
  const email = validEmail(item.primaryEmail);
  if (!email) throw new Error("A valid primary email is required.");
  if (!normalizedSender.fromAddress) throw new Error("A valid verified From address is required.");
  const unsubscribeUrl = normalizedSender.unsubscribeUrl;
  const message = {
    resultId: item.id ?? null,
    to: [email],
    from: normalizedSender.fromName
      ? `${normalizedSender.fromName} <${normalizedSender.fromAddress}>`
      : normalizedSender.fromAddress,
    subject: cleanHeader(item.subject, 160),
    html: String(item.html ?? ""),
    text: String(item.text ?? ""),
    ...(normalizedSender.replyTo ? { reply_to: normalizedSender.replyTo } : {}),
    ...(unsubscribeUrl
      ? {
          headers: {
            "List-Unsubscribe": `<${unsubscribeUrl}>`,
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click"
          }
        }
      : {}),
    consent: {
      status: cleanHeader(item.consentStatus, 40),
      source: cleanHeader(item.consentSource, 200),
      timestamp: cleanHeader(item.consentTimestamp, 40)
    }
  };
  return message;
}

export async function buildResendReviewFingerprint({
  reviewId,
  reviewedAt,
  expiresAt,
  projectId = null,
  sender = {},
  items = [],
  suppressions = [],
  batchSize = RESEND_BATCH_LIMIT,
  testRecipient = null
} = {}) {
  if (!reviewId) throw new Error("A reviewed resend operation ID is required.");
  const normalizedSender = normalizeSender(sender);
  const normalizedSuppressions = normalizeSuppressionList(suppressions);
  const canonicalItems = items.map((item) => {
    const message = canonicalResendMessage(item, normalizedSender);
    return {
      id: item.id ?? null,
      primaryEmail: validEmail(item.primaryEmail),
      subject: cleanHeader(item.subject, 160),
      html: String(item.html ?? ""),
      text: String(item.text ?? ""),
      consentStatus: cleanHeader(item.consentStatus, 40),
      consentSource: cleanHeader(item.consentSource, 200),
      consentTimestamp: cleanHeader(item.consentTimestamp, 40),
      contactSource: cleanHeader(item.contactSource, 80),
      message
    };
  });

  const requireComplianceContent = canonicalItems.length > 1;
  for (const item of canonicalItems) {
    validateResendComplianceContent(item, normalizedSender, { bulk: requireComplianceContent });
  }

  const messageEntries = [];
  for (const [index, item] of canonicalItems.entries()) {
    const message = {
      ...item.message,
      index,
      messageDigest: await digestCanonical(item.message, "resend-message")
    };
    messageEntries.push(message);
  }

  const normalizedBatchSize = Math.max(
    1,
    Math.min(RESEND_BATCH_LIMIT, Number(batchSize) || RESEND_BATCH_LIMIT)
  );
  const chunkEntries = [];
  for (const [chunkIndex, chunk] of splitResendChunks(messageEntries, normalizedBatchSize).entries()) {
    chunkEntries.push({
      chunkIndex,
      messageDigests: chunk.map((message) => message.messageDigest),
      chunkDigest: await digestCanonical(
        {
          reviewId,
          chunkIndex,
          messages: chunk.map((message) => message.messageDigest)
        },
        "resend-chunk"
      )
    });
  }
  const fingerprint = {
    kind: "resend",
    reviewId,
    reviewedAt: reviewedAt ?? null,
    expiresAt: expiresAt ?? null,
    projectId,
    sender: normalizedSender,
    batchSize: normalizedBatchSize,
    testRecipient: validEmail(testRecipient),
    suppressions: normalizedSuppressions,
    messages: messageEntries.map((message) => ({
      messageDigest: message.messageDigest,
      resultId: message.resultId,
      to: message.to[0],
      subject: message.subject,
      consent: message.consent
    }))
  };
  return {
    reviewId,
    reviewedAt: reviewedAt ?? null,
    expiresAt: expiresAt ?? null,
    projectId,
    sender: normalizedSender,
    batchSize: normalizedBatchSize,
    testRecipient: validEmail(testRecipient),
    suppressions: normalizedSuppressions,
    items: canonicalItems.map(({ message: _message, ...item }) => item),
    messages: messageEntries,
    chunks: chunkEntries,
    payloadDigest: await digestCanonical(fingerprint, "resend"),
    suppressionDigest: await digestCanonical(normalizedSuppressions, "resend-suppression")
  };
}
