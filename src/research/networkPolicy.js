import dns from "node:dns/promises";
import net from "node:net";
import ipaddr from "ipaddr.js";
import { AppError } from "../utils/errors.js";

const PUBLIC_SCHEMES = new Set(["http:", "https:"]);
const DEFAULT_MAX_URL_LENGTH = 2048;

function normalizeHostForPolicy(hostname) {
  return String(hostname ?? "")
    .trim()
    .replace(/\.$/, "");
}

export function canonicalizeAddress(address) {
  const parsed = ipaddr.parse(String(address));
  return parsed.toNormalizedString().toLowerCase();
}

export function normalizeResearchUrl(value, { maxUrlLength = DEFAULT_MAX_URL_LENGTH } = {}) {
  const raw = String(value ?? "").trim();
  if (!raw) {
    throw new AppError("INVALID_URL", "A website URL is required.", 400);
  }
  if (raw.length > maxUrlLength) {
    throw new AppError("INVALID_URL", "Website URL exceeds the configured length limit.", 400);
  }

  try {
    const url = new URL(raw);
    if (!PUBLIC_SCHEMES.has(url.protocol)) {
      throw new Error("URL must use http or https.");
    }
    if (url.username || url.password) {
      throw new Error("URL credentials are not allowed.");
    }
    const normalizedHost = normalizeHostForPolicy(url.hostname);
    if (!normalizedHost) {
      throw new Error("URL host is required.");
    }
    if (normalizedHost !== url.hostname) {
      url.hostname = normalizedHost;
    }
    if (url.port) {
      const port = Number.parseInt(url.port, 10);
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error("URL port is invalid.");
      }
    }
    return url.toString();
  } catch (error) {
    throw new AppError("INVALID_URL", error.message, 400);
  }
}

export function classifyAddress(address) {
  const parsed = ipaddr.parse(String(address));
  const range = parsed.range();
  return {
    parsed,
    range,
    normalizedAddress: parsed.toNormalizedString().toLowerCase(),
    publicRouteable: range === "unicast"
  };
}

export function isPublicAddress(address) {
  try {
    return classifyAddress(address).publicRouteable;
  } catch {
    return false;
  }
}

export async function resolvePublicAddresses(hostname, { resolver = dns.lookup } = {}) {
  const normalizedHost = normalizeHostForPolicy(hostname);
  if (!normalizedHost) {
    throw new AppError("INVALID_URL", "URL host is required.", 400);
  }

  const directFamily = net.isIP(normalizedHost);
  if (directFamily) {
    const classification = classifyAddress(normalizedHost);
    if (!classification.publicRouteable) {
      throw new AppError(
        "FORBIDDEN_DESTINATION",
        "Private, loopback, link-local, multicast, reserved, and mapped addresses are blocked.",
        400,
        { host: normalizedHost, range: classification.range }
      );
    }
    return [
      {
        address: classification.normalizedAddress,
        family: directFamily
      }
    ];
  }

  let records;
  try {
    records = await resolver(normalizedHost, { all: true, verbatim: true });
  } catch (error) {
    throw new AppError(
      "DNS_RESOLUTION_FAILURE",
      "Website DNS resolution failed.",
      502,
      { host: normalizedHost, cause: error?.message ?? String(error) },
      { publicDetails: true }
    );
  }

  if (!Array.isArray(records) || records.length === 0) {
    throw new AppError(
      "DNS_RESOLUTION_FAILURE",
      "Website DNS resolution returned no usable addresses.",
      502,
      { host: normalizedHost },
      { publicDetails: true }
    );
  }

  const publicRecords = [];
  const forbiddenRecords = [];
  for (const record of records) {
    const address = String(record?.address ?? "").trim();
    if (!address) continue;
    try {
      const classification = classifyAddress(address);
      if (classification.publicRouteable) {
        publicRecords.push({
          address: classification.normalizedAddress,
          family: Number.isInteger(record?.family) ? record.family : net.isIP(address)
        });
      } else {
        forbiddenRecords.push({
          address: classification.normalizedAddress,
          range: classification.range
        });
      }
    } catch {
      forbiddenRecords.push({ address, range: "invalid" });
    }
  }

  if (!publicRecords.length || forbiddenRecords.length) {
    throw new AppError(
      "FORBIDDEN_DESTINATION",
      "Website resolved to a forbidden or ambiguous destination.",
      400,
      {
        host: normalizedHost,
        allowed: publicRecords.map((record) => record.address),
        forbidden: forbiddenRecords
      },
      { publicDetails: true }
    );
  }

  return publicRecords;
}

export function canonicalHostHeader(url) {
  const host = normalizeHostForPolicy(url.hostname);
  return url.port ? `${host}:${url.port}` : host;
}

export function canonicalOrigin(url) {
  return `${url.protocol}//${normalizeHostForPolicy(url.hostname)}${url.port ? `:${url.port}` : ""}`;
}
