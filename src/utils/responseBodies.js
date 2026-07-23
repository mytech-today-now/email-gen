import { AppError } from "./errors.js";

function toUint8Array(value) {
  if (value instanceof Uint8Array) return value;
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return new Uint8Array(value);
}

function concatBytes(chunks, totalBytes) {
  if (!chunks.length) return new Uint8Array(0);
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function parseContentType(value) {
  const raw = String(value ?? "")
    .trim()
    .toLowerCase();
  if (!raw) return "";
  return raw.split(";", 1)[0].trim();
}

function contentTypeMatches(actual, expected) {
  if (!expected?.length) return true;
  const type = parseContentType(actual);
  if (!type) return false;
  for (const item of expected) {
    const candidate = String(item ?? "")
      .trim()
      .toLowerCase();
    if (!candidate) continue;
    if (candidate === "*/*") return true;
    if (candidate.endsWith("/*")) {
      if (type.startsWith(`${candidate.slice(0, -2)}/`)) return true;
      continue;
    }
    if (candidate.endsWith("+json") && type.endsWith("+json")) {
      if (candidate === "application/*+json" || candidate === type) return true;
      if (candidate === "application/json" && type.startsWith("application/")) return true;
    }
    if (
      candidate === "application/json" &&
      (type === "application/json" || type.endsWith("+json") || type === "text/json")
    ) {
      return true;
    }
    if (candidate === type) return true;
  }
  return false;
}

function boundedResponseError(
  code,
  message,
  status,
  details = {},
  { publicDetails = true, retryAfter = null } = {}
) {
  const error = new AppError(code, message, status, details, { publicDetails });
  if (retryAfter != null) error.retryAfter = retryAfter;
  return error;
}

export async function readBoundedResponseBytes(
  response,
  {
    maxBytes,
    maxEncodedBytes = null,
    expectedContentTypes = null,
    allowMissingContentType = false,
    deadlineMs = null,
    idleTimeoutMs = null,
    collectText = false,
    signal,
    code = "RESPONSE_TOO_LARGE",
    message = "Response exceeded the configured size limit.",
    status = 413,
    details = {},
    publicDetails = true,
    lengthInvalidCode = "RESPONSE_LENGTH_INVALID",
    lengthMismatchCode = "RESPONSE_LENGTH_MISMATCH",
    invalidContentTypeCode = "RESPONSE_INVALID_CONTENT_TYPE",
    deadlineCode = "RESPONSE_DEADLINE_EXCEEDED",
    idleCode = "RESPONSE_IDLE_TIMEOUT"
  } = {}
) {
  const body = response?.body ?? null;
  if (!body) {
    return { bytes: new Uint8Array(0), transferredBytes: 0 };
  }

  const headers = response.headers;
  const declaredLengthRaw = headers?.get?.("content-length");
  const contentType = headers?.get?.("content-type") ?? "";
  const contentEncoding = headers?.get?.("content-encoding") ?? "";
  const declaredLength = (() => {
    if (declaredLengthRaw == null || declaredLengthRaw === "") return null;
    if (!/^\d+$/.test(String(declaredLengthRaw).trim())) {
      throw boundedResponseError(
        lengthInvalidCode,
        "Response returned malformed Content-Length metadata.",
        502,
        { ...details, contentLength: String(declaredLengthRaw) },
        { publicDetails }
      );
    }
    const parsed = Number.parseInt(String(declaredLengthRaw), 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  })();

  if (!allowMissingContentType && expectedContentTypes?.length && !contentType) {
    throw boundedResponseError(
      invalidContentTypeCode,
      "Response returned an unsupported content type.",
      502,
      { ...details, contentType: null, expectedContentTypes },
      { publicDetails }
    );
  }
  if (expectedContentTypes?.length && !contentTypeMatches(contentType, expectedContentTypes)) {
    throw boundedResponseError(
      invalidContentTypeCode,
      "Response returned an unsupported content type.",
      502,
      { ...details, contentType, expectedContentTypes },
      { publicDetails }
    );
  }
  const contentTypeIsCompressed = /\b(?:gzip|br|deflate)\b/i.test(contentEncoding);
  if (Number.isFinite(maxEncodedBytes) && declaredLength != null) {
    if (declaredLength > maxEncodedBytes) {
      throw boundedResponseError(
        code,
        message,
        status,
        {
          ...details,
          limitType: "encodedResponseBytes",
          declaredBytes: declaredLength,
          limit: maxEncodedBytes,
          contentType,
          contentEncoding
        },
        { publicDetails, retryAfter: headers?.get?.("retry-after") ?? null }
      );
    }
  } else if (
    !contentTypeIsCompressed &&
    Number.isFinite(maxBytes) &&
    declaredLength != null &&
    declaredLength > maxBytes
  ) {
    throw boundedResponseError(
      code,
      message,
      status,
      {
        ...details,
        limitType: "responseBytes",
        declaredBytes: declaredLength,
        limit: maxBytes,
        contentType,
        contentEncoding
      },
      { publicDetails, retryAfter: headers?.get?.("retry-after") ?? null }
    );
  }

  const reader = typeof body.getReader === "function" ? body.getReader() : null;
  if (!reader) {
    throw boundedResponseError(
      "RESPONSE_STREAM_UNAVAILABLE",
      "Response body stream is unavailable.",
      502,
      { ...details, contentType, contentEncoding },
      { publicDetails }
    );
  }
  const chunks = [];
  const decoder = collectText ? new TextDecoder() : null;
  const textChunks = collectText ? [] : null;
  let transferredBytes = 0;
  let deadlineTimer = null;
  let idleTimer = null;
  let settled = false;
  let released = false;
  let pendingError = null;
  let abortHandler = null;

  const clearTimers = () => {
    if (deadlineTimer) clearTimeout(deadlineTimer);
    if (idleTimer) clearTimeout(idleTimer);
    deadlineTimer = null;
    idleTimer = null;
  };

  const releaseReader = () => {
    if (released) return;
    released = true;
    try {
      reader.releaseLock();
    } catch {
      // ignore cleanup failures
    }
  };

  const abortReader = (error) => {
    if (settled) return;
    settled = true;
    pendingError = error;
    clearTimers();
    try {
      reader.cancel(error ?? new DOMException("Aborted", "AbortError")).catch(() => {});
    } catch {
      // ignore cancellation failures
    }
  };

  const resetIdleTimer = () => {
    if (!Number.isFinite(idleTimeoutMs) || idleTimeoutMs <= 0) return;
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      abortReader(
        boundedResponseError(
          idleCode,
          "Response body stalled before the configured idle timeout elapsed.",
          408,
          { ...details, idleTimeoutMs, transferredBytes, contentType, contentEncoding },
          { publicDetails }
        )
      );
    }, idleTimeoutMs);
    idleTimer.unref?.();
  };

  if (Number.isFinite(deadlineMs) && deadlineMs > 0) {
    deadlineTimer = setTimeout(() => {
      abortReader(
        boundedResponseError(
          deadlineCode,
          "Response body exceeded the configured deadline.",
          408,
          { ...details, deadlineMs, transferredBytes, contentType, contentEncoding },
          { publicDetails }
        )
      );
    }, deadlineMs);
    deadlineTimer.unref?.();
  }

  if (signal) {
    if (signal.aborted) {
      abortReader(signal.reason ?? new DOMException("Aborted", "AbortError"));
      throw signal.reason ?? new DOMException("Aborted", "AbortError");
    }
    abortHandler = () => {
      abortReader(signal.reason ?? new DOMException("Aborted", "AbortError"));
    };
    signal.addEventListener("abort", abortHandler, { once: true });
  }

  try {
    resetIdleTimer();
    while (true) {
      const { done, value } = await reader.read().catch((error) => {
        if (pendingError) throw pendingError;
        throw error;
      });
      if (pendingError) throw pendingError;
      if (done) break;
      resetIdleTimer();
      const chunk = toUint8Array(value);
      transferredBytes += chunk.byteLength;
      if (Number.isFinite(maxBytes) && transferredBytes > maxBytes) {
        throw boundedResponseError(
          code,
          message,
          status,
          {
            ...details,
            limitType: "responseBytes",
            transferredBytes,
            limit: maxBytes,
            contentType,
            contentEncoding
          },
          { publicDetails, retryAfter: headers?.get?.("retry-after") ?? null }
        );
      }
      chunks.push(chunk);
      if (decoder) textChunks.push(decoder.decode(chunk, { stream: true }));
      if (maxEncodedBytes != null && transferredBytes > maxEncodedBytes && contentTypeIsCompressed) {
        throw boundedResponseError(
          code,
          message,
          status,
          {
            ...details,
            limitType: "encodedResponseBytes",
            transferredBytes,
            limit: maxEncodedBytes,
            contentType,
            contentEncoding
          },
          { publicDetails, retryAfter: headers?.get?.("retry-after") ?? null }
        );
      }
    }
    clearTimers();
    if (pendingError) throw pendingError;
    const bytes = concatBytes(chunks, transferredBytes);
    const text = decoder ? `${textChunks.join("")}${decoder.decode()}` : null;
    if (declaredLength != null && !contentTypeIsCompressed && bytes.byteLength !== declaredLength) {
      throw boundedResponseError(
        lengthMismatchCode,
        "Response body length did not match the declared Content-Length.",
        502,
        {
          ...details,
          declaredBytes: declaredLength,
          actualBytes: bytes.byteLength,
          contentType,
          contentEncoding
        },
        { publicDetails }
      );
    }
    return { bytes, text, transferredBytes, declaredBytes: declaredLength, contentType, contentEncoding };
  } finally {
    settled = true;
    clearTimers();
    if (signal && abortHandler) signal.removeEventListener("abort", abortHandler);
    releaseReader();
  }
}

export async function readBoundedResponseText(response, options = {}) {
  const { bytes, text, transferredBytes, declaredBytes, contentType, contentEncoding } =
    await readBoundedResponseBytes(response, { ...options, collectText: true });
  return {
    text: text ?? new TextDecoder().decode(bytes),
    bytes,
    transferredBytes,
    declaredBytes,
    contentType,
    contentEncoding
  };
}

export async function readBoundedResponseJson(response, options = {}) {
  const {
    jsonCode = "RESPONSE_INVALID_JSON",
    jsonMessage = "Response returned malformed JSON.",
    jsonStatus = 502,
    text: rawText = null,
    ...textOptions
  } = options;
  const textBytes = new TextEncoder().encode(rawText ?? "");
  const { text, bytes, transferredBytes, declaredBytes, contentType, contentEncoding } =
    rawText === null
      ? await readBoundedResponseText(response, {
          ...textOptions,
          expectedContentTypes: textOptions.expectedContentTypes ?? [
            "application/json",
            "application/*+json",
            "text/json"
          ]
        })
      : {
          text: rawText,
          bytes: textBytes,
          transferredBytes: textBytes.byteLength,
          declaredBytes: null,
          contentType: response?.headers?.get?.("content-type") ?? "",
          contentEncoding: response?.headers?.get?.("content-encoding") ?? ""
        };

  if (!text) {
    return { payload: {}, text, bytes, transferredBytes, declaredBytes, contentType, contentEncoding };
  }

  try {
    return {
      payload: JSON.parse(text),
      text,
      bytes,
      transferredBytes,
      declaredBytes,
      contentType,
      contentEncoding
    };
  } catch (error) {
    throw boundedResponseError(jsonCode, jsonMessage, jsonStatus, {
      ...textOptions.details,
      parseError: error?.message ?? String(error),
      contentType,
      contentEncoding
    });
  }
}
