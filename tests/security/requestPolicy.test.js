import fs from "node:fs";
import { createHmac, randomBytes } from "node:crypto";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  constantTimeEqual,
  parseLoopbackAuthority,
  parseLoopbackOrigin,
  validateConfiguredHostBinding,
  validateUnsafeRequestHeaders
} from "../../src/security/requestPolicy.js";
import { createTestHarness } from "../helpers/appTestHarness.js";

const config = {
  port: 3000,
  limits: {
    requestBytes: 1024
  }
};

function makeRequest({
  method = "POST",
  originalUrl = "/api/client-logs",
  host = "127.0.0.1:3000",
  origin = null,
  csrfToken = "csrf-token",
  contentType = "application/json",
  contentLength = "2",
  body = undefined,
  rawHeaders = null
} = {}) {
  const headers = {
    host,
    "x-email-gen-csrf": csrfToken,
    ...(origin ? { origin } : {}),
    ...(contentType ? { "content-type": contentType } : {}),
    ...(contentLength ? { "content-length": contentLength } : {})
  };
  return {
    method,
    originalUrl,
    url: originalUrl,
    headers,
    rawHeaders:
      rawHeaders ??
      Object.entries(headers).flatMap(([name, value]) => {
        if (value == null) return [];
        return [name, String(value)];
      }),
    query: {},
    body
  };
}

function routePathFromDefinition(routePath) {
  return routePath.replace(/:([A-Za-z0-9_]+)/g, (_, name) => {
    const samples = {
      id: "sample-id",
      filename: "sample.html",
      name: "sample",
      provider: "openai",
      operationId: "sample-operation",
      projectId: "sample-project",
      recordId: "1",
      resultId: "result-1",
      chunkId: "chunk-1"
    };
    return samples[name] ?? name;
  });
}

function collectRoutes() {
  const routesDir = path.resolve("src/routes");
  const pattern = /router\.(get|post|put|patch|delete)\(\s*(["'`])([^"'`]+?)\2/g;
  return fs
    .readdirSync(routesDir)
    .filter((file) => file.endsWith(".js"))
    .flatMap((file) => {
      const source = fs.readFileSync(path.join(routesDir, file), "utf8");
      return [...source.matchAll(pattern)].map((match) => ({
        method: match[1].toUpperCase(),
        path: match[3],
        file
      }));
    });
}

describe("request policy", () => {
  it("compares browser tokens in constant time without accepting mismatched lengths", () => {
    expect(constantTimeEqual("secret", "secret")).toBe(true);
    expect(constantTimeEqual("secret", "secret!")).toBe(false);
    expect(constantTimeEqual("secret", "")).toBe(false);
  });

  it("accepts loopback authorities and rejects disguised host values", () => {
    expect(parseLoopbackAuthority("localhost:3000", { expectedPort: 3000 })).toMatchObject({
      hostname: "localhost",
      port: 3000
    });
    expect(parseLoopbackAuthority("[::1]:3000", { expectedPort: 3000 })).toMatchObject({
      hostname: "::1",
      port: 3000
    });
    expect(() => parseLoopbackAuthority("127.0.0.1.", { expectedPort: 3000 })).toThrow(
      /loopback|trailing-dot/i
    );
    expect(() => parseLoopbackAuthority("2130706433", { expectedPort: 3000 })).toThrow(/loopback/i);
    expect(() => parseLoopbackAuthority("http://127.0.0.1:3000", { expectedPort: 3000 })).toThrow(
      /malformed/i
    );
    expect(() => parseLoopbackAuthority("user@localhost:3000", { expectedPort: 3000 })).toThrow(/malformed/i);
  });

  it("accepts valid loopback origins and rejects null, malformed, and spoofed values", () => {
    expect(
      parseLoopbackOrigin("http://127.0.0.1:3000", {
        expectedPort: 3000,
        expectedProtocol: "http:"
      })
    ).toMatchObject({
      hostname: "127.0.0.1",
      port: 3000
    });
    expect(() =>
      parseLoopbackOrigin("null", {
        expectedPort: 3000,
        expectedProtocol: "http:"
      })
    ).toThrow(/null/i);
    expect(() =>
      parseLoopbackOrigin("http://localhost:4000", {
        expectedPort: 3000,
        expectedProtocol: "http:"
      })
    ).toThrow(/port/i);
    expect(() =>
      parseLoopbackOrigin("https://127.0.0.1:3000", {
        expectedPort: 3000,
        expectedProtocol: "http:"
      })
    ).toThrow(/scheme/i);
    expect(() =>
      parseLoopbackOrigin("http://127.0.0.1:3000, http://127.0.0.1:3000", {
        expectedPort: 3000,
        expectedProtocol: "http:"
      })
    ).toThrow(/multiple/i);
  });

  it("enforces host binding defaults and rejects unsupported public binds", () => {
    expect(validateConfiguredHostBinding("  LOCALHOST  ")).toBe("localhost");
    expect(validateConfiguredHostBinding("[::1]")).toBe("::1");
    expect(() => validateConfiguredHostBinding("0.0.0.0")).toThrow(/loopback/i);
    expect(() => validateConfiguredHostBinding("192.168.1.20")).toThrow(/loopback/i);
  });

  it("accepts CLI requests without Origin when the browser token and headers are valid", () => {
    const policy = validateUnsafeRequestHeaders(makeRequest(), {
      config,
      csrfToken: "csrf-token",
      bodyParsed: true
    });
    expect(policy.origin).toBeNull();
    expect(policy.host).toMatchObject({ hostname: "127.0.0.1", port: 3000 });
  });

  it("rejects missing, duplicate, malformed, and spoofed unsafe request headers", () => {
    expect(() =>
      validateUnsafeRequestHeaders(
        makeRequest({
          rawHeaders: [
            "host",
            "127.0.0.1:3000",
            "x-email-gen-csrf",
            "csrf-token",
            "x-email-gen-csrf",
            "csrf-token"
          ]
        }),
        {
          config,
          csrfToken: "csrf-token",
          bodyParsed: true
        }
      )
    ).toThrow(/duplicate local request tokens/i);

    expect(() =>
      validateUnsafeRequestHeaders(
        makeRequest({
          csrfToken: "",
          rawHeaders: ["host", "127.0.0.1:3000"]
        }),
        {
          config,
          csrfToken: "csrf-token",
          bodyParsed: true
        }
      )
    ).toThrow(/token/i);

    expect(() =>
      validateUnsafeRequestHeaders(
        makeRequest({
          origin: "http://evil.example:3000"
        }),
        {
          config,
          csrfToken: "csrf-token",
          bodyParsed: true
        }
      )
    ).toThrow(/origin/i);

    expect(() =>
      validateUnsafeRequestHeaders(
        makeRequest({
          rawHeaders: ["host", "127.0.0.1:3000", "host", "127.0.0.1:3000", "x-email-gen-csrf", "csrf-token"]
        }),
        {
          config,
          csrfToken: "csrf-token",
          bodyParsed: true
        }
      )
    ).toThrow(/duplicate host/i);
  });

  it("rejects method-override headers, query parameters, and body fields", () => {
    expect(() =>
      validateUnsafeRequestHeaders(
        makeRequest({
          rawHeaders: [
            "host",
            "127.0.0.1:3000",
            "x-email-gen-csrf",
            "csrf-token",
            "x-http-method-override",
            "DELETE"
          ]
        }),
        {
          config,
          csrfToken: "csrf-token",
          bodyParsed: true
        }
      )
    ).toThrow(/method override/i);

    expect(() =>
      validateUnsafeRequestHeaders(
        {
          ...makeRequest(),
          query: { _method: "DELETE" }
        },
        {
          config,
          csrfToken: "csrf-token",
          bodyParsed: true
        }
      )
    ).toThrow(/method override/i);

    expect(() =>
      validateUnsafeRequestHeaders(
        makeRequest({
          body: { _method: "DELETE" }
        }),
        {
          config,
          csrfToken: "csrf-token",
          bodyParsed: true
        }
      )
    ).toThrow(/method override/i);
  });

  it("rejects unsupported content types and encodings before body parsing", () => {
    expect(() =>
      validateUnsafeRequestHeaders(
        makeRequest({
          contentType: "text/plain"
        }),
        {
          config,
          csrfToken: "csrf-token",
          bodyParsed: false
        }
      )
    ).toThrow(/content type/i);

    expect(() =>
      validateUnsafeRequestHeaders(
        makeRequest({
          contentType: "application/json",
          rawHeaders: [
            "host",
            "127.0.0.1:3000",
            "x-email-gen-csrf",
            "csrf-token",
            "content-type",
            "application/json",
            "content-encoding",
            "gzip"
          ]
        }),
        {
          config,
          csrfToken: "csrf-token",
          bodyParsed: false
        }
      )
    ).toThrow(/content encoding/i);
  });

  it("requires every unsafe route to be protected by the canonical policy or the signed webhook exception", async () => {
    const harness = createTestHarness();
    const rawSecret = randomBytes(32);
    const webhookSecret = `whsec_${rawSecret.toString("base64")}`;
    harness.context.runtimeCredentials.set("resend-webhook", webhookSecret);
    try {
      const routes = collectRoutes().filter(({ method }) => method !== "GET" && method !== "HEAD");
      for (const route of routes) {
        const pathWithParams = routePathFromDefinition(route.path);
        const fullPath = `/api${pathWithParams}`;
        let response;
        if (route.path === "/gateway/resend/webhook") {
          const payload = JSON.stringify({
            type: "email.delivered",
            created_at: new Date().toISOString(),
            data: { email_id: "resend-route-test" }
          });
          const id = "msg_route_test";
          const timestamp = String(Math.floor(Date.now() / 1000));
          const signature = createHmac("sha256", rawSecret)
            .update(`${id}.${timestamp}.${payload}`)
            .digest("base64");
          response = await harness.rawRequest
            .post(fullPath)
            .set("svix-id", id)
            .set("svix-timestamp", timestamp)
            .set("svix-signature", `v1,${signature}`)
            .set("content-type", "application/json")
            .send(payload);
        } else {
          response = await harness.rawRequest[route.method.toLowerCase()](fullPath);
        }

        if (route.path === "/gateway/resend/webhook") {
          expect(response.status).not.toBe(403);
        } else {
          expect(response.status).toBe(403);
        }
      }
    } finally {
      harness.cleanup();
    }
  }, 60_000);
});
