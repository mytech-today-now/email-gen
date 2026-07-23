import http from "node:http";
import https from "node:https";
import { PassThrough, Transform, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import zlib from "node:zlib";
import { AppError } from "../utils/errors.js";
import {
  canonicalHostHeader,
  canonicalOrigin,
  canonicalizeAddress,
  normalizeResearchUrl,
  resolvePublicAddresses
} from "./networkPolicy.js";

const DEFAULT_ACCEPT = "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5";
const DEFAULT_ACCEPT_ENCODING = "gzip, deflate, br";
const REDIRECT_STATUSES = new Set([300, 301, 302, 303, 307, 308]);
const ALLOWED_CONTENT_TYPES = /^(?:text\/html|text\/plain|application\/xhtml\+xml)\b/i;
const ATTACHMENT_PATTERN = /\battachment\b/i;

function normalizeHeaders(headers) {
  return Object.fromEntries(
    Object.entries(headers ?? {}).map(([key, value]) => [
      key.toLowerCase(),
      Array.isArray(value) ? value.join(", ") : String(value)
    ])
  );
}

function parseContentLength(value) {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === undefined || raw === null || raw === "") return null;
  const length = Number.parseInt(String(raw), 10);
  return Number.isFinite(length) && length >= 0 ? length : null;
}

function isRedirectStatus(statusCode) {
  return REDIRECT_STATUSES.has(Number(statusCode));
}

function contentTypeAllowed(value, pattern = ALLOWED_CONTENT_TYPES) {
  return pattern.test(String(value ?? ""));
}

function isAttachmentDisposition(value) {
  return ATTACHMENT_PATTERN.test(String(value ?? ""));
}

function createDecoder(contentEncoding) {
  const normalized = String(contentEncoding ?? "")
    .trim()
    .toLowerCase();
  if (!normalized || normalized === "identity") return new PassThrough();
  if (normalized === "gzip") return zlib.createGunzip();
  if (normalized === "deflate") return zlib.createInflate();
  if (normalized === "br") return zlib.createBrotliDecompress();
  throw new AppError(
    "RESEARCH_UNSUPPORTED_ENCODING",
    `Website research does not support ${normalized || "unknown"} content encoding.`,
    415
  );
}

function combinedSignal(signal, timeoutMs) {
  const signals = [];
  if (signal) signals.push(signal);
  if (Number.isFinite(timeoutMs) && timeoutMs > 0) signals.push(AbortSignal.timeout(timeoutMs));
  if (signals.length === 0) return undefined;
  if (signals.length === 1) return signals[0];
  return AbortSignal.any(signals);
}

function defaultRequestFactory(requestOptions, onResponse) {
  const module = requestOptions.protocol === "https:" ? https : http;
  return module.request(requestOptions, onResponse);
}

async function openRequest(
  url,
  {
    resolver,
    requestFactory = defaultRequestFactory,
    headers = {},
    signal,
    timeoutMs = 8000,
    maxHeaderBytes = 16 * 1024,
    logger
  } = {}
) {
  const approvedAddresses = await resolvePublicAddresses(url.hostname, { resolver });
  const approvedAddress = approvedAddresses[0];
  const requestSignal = combinedSignal(signal, timeoutMs);
  const requestHeaders = {
    accept: DEFAULT_ACCEPT,
    "accept-encoding": DEFAULT_ACCEPT_ENCODING,
    "accept-language": "en-US,en;q=0.9",
    "cache-control": "no-cache",
    pragma: "no-cache",
    "user-agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
    ...headers
  };

  const requestOptions = {
    protocol: url.protocol,
    hostname: approvedAddress.address,
    port: url.port ? Number.parseInt(url.port, 10) : undefined,
    method: "GET",
    path: `${url.pathname || "/"}${url.search || ""}`,
    headers: {
      ...requestHeaders,
      host: canonicalHostHeader(url)
    },
    servername: url.hostname,
    maxHeaderSize: maxHeaderBytes,
    rejectUnauthorized: true,
    agent: false,
    signal: requestSignal
  };

  return await new Promise((resolve, reject) => {
    let request;
    let settled = false;
    const rejectOnce = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    const resolveOnce = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    try {
      request = requestFactory(requestOptions, (response) => {
        let connectedAddress;
        try {
          connectedAddress = canonicalizeAddress(
            response?.socket?.remoteAddress ?? request?.socket?.remoteAddress ?? ""
          );
        } catch {
          rejectOnce(
            new AppError(
              "RESEARCH_CONNECTED_ADDRESS_INVALID",
              "Website research could not verify the connected remote address.",
              502,
              { approvedAddress: approvedAddress.address },
              { publicDetails: true }
            )
          );
          return;
        }
        if (connectedAddress !== approvedAddress.address) {
          rejectOnce(
            new AppError(
              "RESEARCH_CONNECTED_ADDRESS_MISMATCH",
              "Website research connected to an unexpected remote address.",
              502,
              {
                approvedAddress: approvedAddress.address,
                connectedAddress
              },
              { publicDetails: true }
            )
          );
          return;
        }
        resolveOnce({
          request,
          response,
          approvedAddress,
          connectedAddress
        });
      });
    } catch (error) {
      rejectOnce(error);
      return;
    }

    request.on("error", rejectOnce);
    if (requestSignal) {
      if (requestSignal.aborted) {
        request.destroy(requestSignal.reason);
        return;
      }
      requestSignal.addEventListener(
        "abort",
        () => {
          request.destroy(requestSignal.reason);
        },
        { once: true }
      );
    }
    request.end();
    logger?.debug?.(
      {
        url: canonicalOrigin(url),
        approvedAddress: approvedAddress.address,
        connectedAddress: null,
        family: approvedAddress.family
      },
      "Secure document request opened"
    );
  });
}

async function consumeResponse(
  response,
  { keepBody = true, maxResponseBytes, remainingPageBytes, decodedByteLimit, signal } = {}
) {
  const headers = normalizeHeaders(response.headers);
  const contentEncoding = headers["content-encoding"] ?? "";
  const rawLimit = Math.min(
    Number.isFinite(maxResponseBytes) ? maxResponseBytes : Number.POSITIVE_INFINITY,
    Number.isFinite(remainingPageBytes) ? remainingPageBytes : Number.POSITIVE_INFINITY
  );
  const declaredLength = parseContentLength(headers["content-length"]);
  if (declaredLength !== null) {
    if (declaredLength > rawLimit) {
      throw new AppError(
        "RESEARCH_RESPONSE_TOO_LARGE",
        "Website response exceeded the configured size limit.",
        413,
        { contentLength: declaredLength, limit: rawLimit },
        { publicDetails: true }
      );
    }
  }

  const rawCounter = new Transform({
    transform(chunk, _encoding, callback) {
      try {
        rawCounter.bytes += chunk.length;
        if (rawCounter.bytes > rawLimit) {
          callback(
            new AppError(
              "RESEARCH_RESPONSE_TOO_LARGE",
              "Website response exceeded the configured size limit.",
              413,
              { transferredBytes: rawCounter.bytes, limit: rawLimit },
              { publicDetails: true }
            )
          );
          return;
        }
        callback(null, chunk);
      } catch (error) {
        callback(error);
      }
    }
  });
  rawCounter.bytes = 0;

  if (!keepBody) {
    await pipeline(
      response,
      rawCounter,
      new Writable({
        write(_chunk, _encoding, callback) {
          callback();
        }
      })
    );
    return {
      body: "",
      transferredBytes: rawCounter.bytes,
      decodedBytes: 0
    };
  }

  const decoder = createDecoder(contentEncoding);
  const decodedLimit = Number.isFinite(decodedByteLimit) ? decodedByteLimit : maxResponseBytes;
  const chunks = [];
  const decodedCounter = new Transform({
    transform(chunk, _encoding, callback) {
      try {
        decodedCounter.bytes += chunk.length;
        if (decodedCounter.bytes > decodedLimit) {
          callback(
            new AppError(
              "RESEARCH_RESPONSE_TOO_LARGE",
              "Decoded website content exceeded the configured size limit.",
              413,
              { decodedBytes: decodedCounter.bytes, limit: decodedLimit },
              { publicDetails: true }
            )
          );
          return;
        }
        chunks.push(Buffer.from(chunk));
        callback(null, chunk);
      } catch (error) {
        callback(error);
      }
    }
  });
  decodedCounter.bytes = 0;

  const abortHandler = signal
    ? () => {
        response.destroy(signal.reason);
      }
    : null;
  if (signal) {
    if (signal.aborted) {
      response.destroy(signal.reason);
      throw signal.reason;
    }
    signal.addEventListener("abort", abortHandler, { once: true });
  }

  try {
    await pipeline(
      response,
      rawCounter,
      decoder,
      decodedCounter,
      new Writable({
        write(_chunk, _encoding, callback) {
          callback();
        }
      })
    );
  } catch (error) {
    response.destroy(error);
    throw error;
  } finally {
    if (signal && abortHandler) {
      signal.removeEventListener("abort", abortHandler);
    }
  }

  return {
    body: Buffer.concat(chunks).toString("utf8"),
    transferredBytes: rawCounter.bytes,
    decodedBytes: decodedCounter.bytes
  };
}

export async function fetchDocument(
  url,
  {
    resolver,
    requestFactory,
    headers,
    signal,
    timeoutMs = 8000,
    maxHeaderBytes = 16 * 1024,
    maxResponseBytes = 500_000,
    maxPageBytes = 1_500_000,
    maxRedirects = 3,
    contentTypePattern = ALLOWED_CONTENT_TYPES,
    allowAttachmentDisposition = false,
    logger
  } = {}
) {
  const normalized = new URL(normalizeResearchUrl(url));
  let current = normalized;
  let redirectCount = 0;
  let transferredBytes = 0;

  while (true) {
    const remainingPageBytes = maxPageBytes - transferredBytes;
    if (remainingPageBytes <= 0) {
      throw new AppError(
        "RESEARCH_PAGE_SIZE_LIMIT_EXCEEDED",
        "Website response exceeded the configured page size limit.",
        413,
        { limit: maxPageBytes },
        { publicDetails: true }
      );
    }

    const { response, request } = await openRequest(current, {
      resolver,
      requestFactory,
      headers,
      signal,
      timeoutMs,
      maxHeaderBytes,
      logger
    });

    try {
      const responseHeaders = normalizeHeaders(response.headers);
      const statusCode = Number(response.statusCode ?? 0);
      const contentType = responseHeaders["content-type"] ?? "";
      const contentDisposition = responseHeaders["content-disposition"] ?? "";

      if (isRedirectStatus(statusCode)) {
        const { transferredBytes: rawBytes } = await consumeResponse(response, {
          keepBody: false,
          maxResponseBytes,
          remainingPageBytes,
          signal
        });
        transferredBytes += rawBytes;
        if (transferredBytes > maxPageBytes) {
          throw new AppError(
            "RESEARCH_PAGE_SIZE_LIMIT_EXCEEDED",
            "Website response exceeded the configured page size limit.",
            413,
            { limit: maxPageBytes, transferredBytes },
            { publicDetails: true }
          );
        }

        const location = responseHeaders.location;
        if (!location) {
          throw new AppError(
            "REDIRECT_POLICY_VIOLATION",
            "Redirect response did not include a target location.",
            400
          );
        }

        redirectCount += 1;
        if (redirectCount > maxRedirects) {
          throw new AppError(
            "REDIRECT_POLICY_VIOLATION",
            "Website research exceeded the redirect limit.",
            400,
            { maxRedirects },
            { publicDetails: true }
          );
        }

        try {
          current = new URL(location, current);
          current = new URL(normalizeResearchUrl(current.toString()));
        } catch (error) {
          throw new AppError(
            "REDIRECT_POLICY_VIOLATION",
            "Website research rejected a redirect target.",
            400,
            { cause: error?.message ?? String(error) },
            { publicDetails: true }
          );
        }
        continue;
      }

      if (statusCode < 200 || statusCode >= 400) {
        throw new AppError("RESEARCH_FETCH_FAILED", `Website research returned HTTP ${statusCode}.`, 502);
      }
      if (!allowAttachmentDisposition && isAttachmentDisposition(contentDisposition)) {
        throw new AppError("RESEARCH_DOWNLOAD_BLOCKED", "Website research blocked a file download.", 403);
      }
      if (!contentTypeAllowed(contentType, contentTypePattern)) {
        throw new AppError(
          "RESEARCH_UNSUPPORTED_CONTENT",
          "Website research supports only HTML and plain text responses.",
          415
        );
      }

      const { body, transferredBytes: rawBytes } = await consumeResponse(response, {
        keepBody: true,
        maxResponseBytes,
        remainingPageBytes,
        decodedByteLimit: maxResponseBytes,
        signal
      });
      transferredBytes += rawBytes;
      if (transferredBytes > maxPageBytes) {
        throw new AppError(
          "RESEARCH_PAGE_SIZE_LIMIT_EXCEEDED",
          "Website response exceeded the configured page size limit.",
          413,
          { limit: maxPageBytes, transferredBytes },
          { publicDetails: true }
        );
      }

      return {
        url: current.toString(),
        status: statusCode,
        contentType,
        headers: responseHeaders,
        body,
        transferredBytes,
        redirects: redirectCount,
        connectedAddress: response.connectedAddress ?? null,
        approvedAddress: response.approvedAddress?.address ?? null
      };
    } catch (error) {
      request.destroy?.(error);
      response.destroy?.(error);
      throw error;
    }
  }
}

export {
  ALLOWED_CONTENT_TYPES,
  DEFAULT_ACCEPT,
  DEFAULT_ACCEPT_ENCODING,
  defaultRequestFactory,
  isAttachmentDisposition,
  isRedirectStatus,
  normalizeHeaders,
  parseContentLength
};
