import { timingSafeEqual } from "node:crypto";
import { AppError } from "../utils/errors.js";

const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1"]);
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function policyError(code, message, status = 403, details = undefined) {
  return new AppError(code, message, status, details, { publicDetails: true });
}

function normalizeAuthorityInput(value) {
  return String(value ?? "").trim();
}

function hasDuplicateHeaderValues(values) {
  return Array.isArray(values) && values.length > 1;
}

export function isUnsafeMethod(method) {
  return !SAFE_METHODS.has(String(method ?? "").toUpperCase());
}

export function headerValues(req, name) {
  const key = String(name ?? "").toLowerCase();
  const distinct = req?.headersDistinct?.[key];
  if (Array.isArray(distinct)) return distinct.map((value) => String(value ?? ""));

  const rawHeaders = Array.isArray(req?.rawHeaders) ? req.rawHeaders : [];
  if (rawHeaders.length) {
    const values = [];
    for (let index = 0; index < rawHeaders.length; index += 2) {
      if (String(rawHeaders[index] ?? "").toLowerCase() === key) {
        values.push(String(rawHeaders[index + 1] ?? ""));
      }
    }
    if (values.length) return values;
  }

  const value = req?.headers?.[key];
  if (Array.isArray(value)) return value.map((item) => String(item ?? ""));
  return value === undefined ? [] : [String(value)];
}

export function constantTimeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left ?? ""), "utf8");
  const rightBuffer = Buffer.from(String(right ?? ""), "utf8");
  const size = Math.max(leftBuffer.length, rightBuffer.length, 1);
  const leftPadded = Buffer.alloc(size);
  const rightPadded = Buffer.alloc(size);
  leftBuffer.copy(leftPadded);
  rightBuffer.copy(rightPadded);
  return (
    leftBuffer.length > 0 &&
    rightBuffer.length > 0 &&
    timingSafeEqual(leftPadded, rightPadded) &&
    leftBuffer.length === rightBuffer.length
  );
}

export function isLoopbackHostname(hostname) {
  return LOOPBACK_HOSTNAMES.has(String(hostname ?? "").toLowerCase());
}

export function parseLoopbackAuthority(value, { expectedPort = null, allowPortless = true } = {}) {
  const raw = normalizeAuthorityInput(value);
  if (!raw) {
    throw policyError("REQUEST_HOST_MISSING", "The Host header is required.");
  }
  if (/[\s,/@\\]/.test(raw) || raw.includes("://")) {
    throw policyError("REQUEST_HOST_INVALID", "The Host header is malformed.");
  }

  let hostname;
  let port;

  if (raw.startsWith("[")) {
    const match = raw.match(/^\[(?<host>[^\]]+)\](?::(?<port>\d+))?$/);
    if (!match?.groups?.host) {
      throw policyError("REQUEST_HOST_INVALID", "The Host header is malformed.");
    }
    hostname = match.groups.host.toLowerCase();
    port = match.groups.port ? Number.parseInt(match.groups.port, 10) : null;
  } else {
    const parts = raw.split(":");
    if (parts.length > 2) {
      throw policyError("REQUEST_HOST_INVALID", "The Host header is malformed.");
    }
    hostname = parts[0].toLowerCase();
    port = parts[1] ? Number.parseInt(parts[1], 10) : null;
  }

  if (hostname.endsWith(".")) {
    throw policyError("REQUEST_HOST_FORBIDDEN", "The request target must not use a trailing-dot host.");
  }
  if (
    raw.includes("@") ||
    raw.includes("://") ||
    raw.includes("/") ||
    raw.includes("\\") ||
    raw.includes(",")
  ) {
    throw policyError("REQUEST_HOST_INVALID", "The Host header is malformed.");
  }
  if (!isLoopbackHostname(hostname)) {
    throw policyError("REQUEST_HOST_FORBIDDEN", "The request target must use an approved loopback host.");
  }
  if (port !== null && (!Number.isInteger(port) || port < 1 || port > 65535)) {
    throw policyError("REQUEST_HOST_INVALID", "The Host header port is invalid.");
  }
  if (expectedPort !== null) {
    if (port === null && !allowPortless) {
      throw policyError("REQUEST_HOST_FORBIDDEN", "The request target port is required.");
    }
    if (port !== null && Number(expectedPort) !== port) {
      throw policyError("REQUEST_HOST_FORBIDDEN", "The request target port is not permitted.");
    }
  }

  return {
    raw,
    hostname,
    port,
    authority: port
      ? `${hostname === "::1" ? "[::1]" : hostname}:${port}`
      : hostname === "::1"
        ? "[::1]"
        : hostname
  };
}

export function parseLoopbackOrigin(value, { expectedPort = null, expectedProtocol = "http:" } = {}) {
  const raw = normalizeAuthorityInput(value);
  if (!raw) return null;
  if (raw.toLowerCase() === "null") {
    throw policyError("REQUEST_ORIGIN_FORBIDDEN", "The Origin header value 'null' is not permitted.");
  }
  if (raw.includes(",")) {
    throw policyError("REQUEST_ORIGIN_FORBIDDEN", "Multiple Origin values are not permitted.");
  }

  let origin;
  try {
    origin = new URL(raw);
  } catch {
    throw policyError("REQUEST_ORIGIN_INVALID", "The Origin header is malformed.");
  }

  if (origin.username || origin.password) {
    throw policyError("REQUEST_ORIGIN_FORBIDDEN", "The Origin header must not include credentials.");
  }
  if (expectedProtocol && origin.protocol !== expectedProtocol) {
    throw policyError("REQUEST_ORIGIN_FORBIDDEN", "The Origin scheme is not permitted.");
  }

  let parsedAuthority;
  try {
    parsedAuthority = parseLoopbackAuthority(origin.host, {
      expectedPort,
      allowPortless: true
    });
  } catch (error) {
    if (error?.code === "REQUEST_HOST_FORBIDDEN" && /loopback host/i.test(error.message ?? "")) {
      throw policyError("REQUEST_ORIGIN_FORBIDDEN", "The Origin header must use an approved loopback host.");
    }
    throw error;
  }

  return {
    raw: origin.toString(),
    protocol: origin.protocol,
    hostname: parsedAuthority.hostname,
    port: parsedAuthority.port,
    origin: `${origin.protocol}//${parsedAuthority.authority}`
  };
}

export function validateConfiguredHostBinding(host, { allowUnsupportedPublicMode = false } = {}) {
  const normalized = normalizeAuthorityInput(host);
  if (!normalized) {
    throw new Error("Invalid application configuration: HOST is required.");
  }
  const lower = normalized.toLowerCase();
  if (lower === "localhost" || lower === "127.0.0.1" || lower === "::1" || lower === "[::1]") {
    return lower === "[::1]" ? "::1" : lower;
  }
  if (allowUnsupportedPublicMode) {
    throw new Error(
      "Invalid application configuration: unsupported public mode is not fully configured. Bind to a loopback host instead."
    );
  }
  throw new Error(
    "Invalid application configuration: HOST must bind to a loopback host (localhost, 127.0.0.1, or ::1)."
  );
}

export function validateBrowserToken(req, token, { headerName = "x-email-gen-csrf" } = {}) {
  const values = headerValues(req, headerName);
  if (!values.length) {
    throw policyError("REQUEST_TOKEN_MISSING", "The local request token is required.");
  }
  if (hasDuplicateHeaderValues(values)) {
    throw policyError("REQUEST_TOKEN_DUPLICATE", "Duplicate local request tokens are not permitted.");
  }
  const supplied = normalizeAuthorityInput(values[0]);
  if (!supplied) {
    throw policyError("REQUEST_TOKEN_MISSING", "The local request token is required.");
  }
  if (!constantTimeEqual(supplied, token)) {
    throw policyError("REQUEST_TOKEN_INVALID", "The local request token is missing or invalid.");
  }
  return true;
}

export function detectMethodOverride(req) {
  const overrideHeaders = [
    headerValues(req, "x-http-method-override"),
    headerValues(req, "x-method-override"),
    headerValues(req, "x-http-method")
  ];
  if (overrideHeaders.some((values) => values.length > 0)) {
    throw policyError("METHOD_OVERRIDE_FORBIDDEN", "Method override headers are not permitted.");
  }

  const query = req?.query ?? {};
  if (
    Object.prototype.hasOwnProperty.call(query, "_method") ||
    Object.prototype.hasOwnProperty.call(query, "method")
  ) {
    throw policyError("METHOD_OVERRIDE_FORBIDDEN", "Method override query parameters are not permitted.");
  }

  const body = req?.body;
  if (body && typeof body === "object" && !Array.isArray(body)) {
    const overrideKeys = ["_method", "__method", "method", "httpMethod", "http_method"];
    if (overrideKeys.some((key) => Object.prototype.hasOwnProperty.call(body, key))) {
      throw policyError("METHOD_OVERRIDE_FORBIDDEN", "Method override body fields are not permitted.");
    }
  }

  return true;
}

export function validateUnsafeRequestHeaders(
  req,
  { config, csrfToken, allowWebhook = false, bodyParsed = false } = {}
) {
  const method = String(req?.method ?? "").toUpperCase();
  const unsafe = isUnsafeMethod(method);
  const requestPath = String(req?.originalUrl ?? req?.url ?? "");
  const isWebhook = requestPath === "/api/gateway/resend/webhook";
  const hostHeader = headerValues(req, "host");
  if (hasDuplicateHeaderValues(hostHeader)) {
    throw policyError("REQUEST_HOST_DUPLICATE", "Duplicate Host headers are not permitted.");
  }
  const originHeader = headerValues(req, "origin");
  if (hasDuplicateHeaderValues(originHeader)) {
    throw policyError("REQUEST_ORIGIN_FORBIDDEN", "Multiple Origin values are not permitted.");
  }

  const host = parseLoopbackAuthority(hostHeader[0], {
    expectedPort: config?.port ?? null,
    allowPortless: false
  });
  const origin =
    allowWebhook && isWebhook
      ? null
      : parseLoopbackOrigin(originHeader[0], {
          expectedPort: config?.port ?? null,
          expectedProtocol: "http:"
        });

  if (unsafe && !isWebhook) {
    validateBrowserToken(req, csrfToken);
  }

  if (unsafe) {
    const contentEncodingHeader = headerValues(req, "content-encoding");
    if (hasDuplicateHeaderValues(contentEncodingHeader)) {
      throw policyError(
        "CONTENT_ENCODING_FORBIDDEN",
        "Duplicate content encoding headers are not permitted."
      );
    }
    const contentEncoding = normalizeAuthorityInput(contentEncodingHeader[0]).toLowerCase();
    if (contentEncoding && contentEncoding !== "identity") {
      throw policyError("CONTENT_ENCODING_FORBIDDEN", "The request content encoding is not permitted.");
    }
    const contentTypeHeader = headerValues(req, "content-type");
    if (hasDuplicateHeaderValues(contentTypeHeader)) {
      throw policyError("CONTENT_TYPE_FORBIDDEN", "Duplicate content type headers are not permitted.");
    }
    const contentType = normalizeAuthorityInput(contentTypeHeader[0]).toLowerCase();
    const declaredLength = normalizeAuthorityInput(headerValues(req, "content-length")[0]);
    if (
      declaredLength &&
      Number.parseInt(declaredLength, 10) > Number(config?.limits?.requestBytes ?? Number.POSITIVE_INFINITY)
    ) {
      throw policyError("REQUEST_TOO_LARGE", "The request body exceeds the configured size limit.", 413);
    }
    const hasBody =
      Boolean(declaredLength && Number.parseInt(declaredLength, 10) > 0) ||
      Boolean(normalizeAuthorityInput(headerValues(req, "transfer-encoding")[0]));
    if (hasBody && !contentType) {
      throw policyError("CONTENT_TYPE_FORBIDDEN", "The request content type is required.");
    }
    if (
      contentType &&
      !/^(?:application\/json|application\/.+\+json|multipart\/form-data|application\/x-www-form-urlencoded)(?:\s*;|$)/i.test(
        contentType
      )
    ) {
      throw policyError("CONTENT_TYPE_FORBIDDEN", "The request content type is not permitted.");
    }
  }

  if (unsafe && bodyParsed) {
    detectMethodOverride(req);
  }

  return {
    host,
    origin,
    requestPath,
    isWebhook
  };
}
