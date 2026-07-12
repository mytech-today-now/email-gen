import dns from "node:dns/promises";
import ipaddr from "ipaddr.js";
import { chromium } from "playwright";
import { AppError } from "../utils/errors.js";
import { validateHttpUrl } from "../data/validators.js";

const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36";
const BLOCKED_RESOURCE_TYPES = new Set(["image", "media", "font", "stylesheet"]);

function isBlockedIp(address) {
  const parsed = ipaddr.parse(address);
  const range = parsed.range();
  return [
    "unspecified",
    "broadcast",
    "multicast",
    "linkLocal",
    "loopback",
    "private",
    "reserved",
    "uniqueLocal",
    "ipv4Mapped"
  ].includes(range);
}

export async function assertPublicHttpUrl(url) {
  const normalized = validateHttpUrl(url, { optional: false });
  const parsed = new URL(normalized);
  if (parsed.hostname === "localhost") {
    throw new AppError("SSRF_BLOCKED", "Localhost URLs are not allowed for research.", 400);
  }
  const records = await dns.lookup(parsed.hostname, { all: true, verbatim: true });
  if (!records.length || records.some((record) => isBlockedIp(record.address))) {
    throw new AppError(
      "SSRF_BLOCKED",
      "Private, loopback, link-local, multicast, and reserved IP ranges are blocked.",
      400
    );
  }
  return normalized;
}

function normalizeHeaders(headers) {
  return Object.fromEntries(
    Object.entries(headers ?? {}).map(([key, value]) => [key.toLowerCase(), String(value)])
  );
}

function redirectCount(request) {
  let count = 0;
  let current = request?.redirectedFrom?.();
  while (current) {
    count += 1;
    current = current.redirectedFrom?.();
  }
  return count;
}

function contentByteLength(body) {
  return Buffer.byteLength(body, "utf8");
}

async function assertBoundedBrowserContent(body, maxBytes) {
  if (contentByteLength(body) > maxBytes) {
    throw new AppError(
      "RESEARCH_RESPONSE_TOO_LARGE",
      "Website response exceeded the configured research size limit.",
      413
    );
  }
}

function shouldAbortResource(resourceType) {
  return BLOCKED_RESOURCE_TYPES.has(resourceType);
}

async function createSafeRouteHandler({ logger }) {
  const publicOriginChecks = new Map();
  return async function safeRoute(route) {
    const request = route.request();
    const requestUrl = request.url();
    const resourceType = request.resourceType();
    try {
      const parsed = new URL(requestUrl);
      if (!["http:", "https:"].includes(parsed.protocol) || shouldAbortResource(resourceType)) {
        await route.abort("blockedbyclient");
        return;
      }
      const origin = `${parsed.origin}/`;
      if (!publicOriginChecks.has(origin)) {
        publicOriginChecks.set(origin, assertPublicHttpUrl(origin));
      }
      await publicOriginChecks.get(origin);
      await route.continue();
    } catch (error) {
      logger?.warn(
        {
          err: error,
          requestUrl,
          resourceType
        },
        "Blocked unsafe browser research request"
      );
      await route.abort("blockedbyclient");
    }
  };
}

export async function fetchWebsite(
  url,
  { config, browserLauncher = chromium, logger, maxRedirects = 3 } = {}
) {
  const current = await assertPublicHttpUrl(url);
  let browser;
  let context;
  try {
    const launchOptions = {
      headless: true,
      args: ["--disable-dev-shm-usage", "--no-sandbox"]
    };
    if (config.research.browserChannel) launchOptions.channel = config.research.browserChannel;
    browser = await browserLauncher.launch(launchOptions);
    context = await browser.newContext({
      userAgent: BROWSER_USER_AGENT,
      javaScriptEnabled: true,
      ignoreHTTPSErrors: true,
      viewport: { width: 1366, height: 900 },
      extraHTTPHeaders: {
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.9"
      }
    });
    await context.route("**/*", await createSafeRouteHandler({ logger }));
    const page = await context.newPage();
    const response = await page.goto(current, {
      waitUntil: "domcontentloaded",
      timeout: config.research.timeoutMs
    });
    if (!response) {
      throw new AppError("RESEARCH_FETCH_FAILED", "Website research did not receive a response.", 502);
    }
    if (redirectCount(response.request()) > maxRedirects) {
      throw new AppError("RESEARCH_REDIRECT_LOOP", "Website research exceeded the redirect limit.", 400);
    }
    const finalUrl = await assertPublicHttpUrl(page.url());
    const status = response.status();
    if (status < 200 || status >= 400) {
      throw new AppError("RESEARCH_FETCH_FAILED", `Website research returned HTTP ${status}.`, 502);
    }
    const headers = normalizeHeaders(response.headers());
    const contentType = headers["content-type"] ?? "text/html";
    if (!/^text\/html\b|^text\/plain\b|application\/xhtml\+xml\b/i.test(contentType)) {
      throw new AppError(
        "RESEARCH_UNSUPPORTED_CONTENT",
        "Website research supports only HTML and plain text responses.",
        415
      );
    }
    if (config.research.renderDelayMs > 0) {
      await page.waitForTimeout(config.research.renderDelayMs);
    }
    const body = await page.content();
    await assertBoundedBrowserContent(body, config.research.responseBytes);
    return {
      url: finalUrl,
      contentType,
      body
    };
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (/timeout/i.test(error.message) || error.name === "TimeoutError") {
      throw new AppError("RESEARCH_TIMEOUT", "Website research timed out.", 408);
    }
    throw new AppError("RESEARCH_FETCH_FAILED", "Website research request failed.", 502);
  } finally {
    await context?.close().catch(() => {});
    await browser?.close().catch(() => {});
  }
}

export { createSafeRouteHandler };
