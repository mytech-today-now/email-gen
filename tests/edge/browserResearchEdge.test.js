import { describe, expect, it, vi } from "vitest";
import { gzipSync } from "node:zlib";
import { loadAppConfig } from "../../config/app.config.js";
import { collectResearch } from "../../src/research/researchService.js";
import { fetchWebsite } from "../../src/research/websiteFetcher.js";
import {
  closeServer,
  createHttpServer,
  createHttpsServer,
  createMappedRequestFactory,
  createSequenceResolver
} from "../helpers/secureResearchFixtures.js";

function researchConfig(overrides = {}) {
  const base = loadAppConfig();
  return loadAppConfig({
    research: {
      ...base.research,
      enabled: true,
      timeoutMs: 3000,
      responseBytes: 256,
      maxHeaderBytes: 4096,
      maxPageBytes: 512,
      maxJobBytes: 1024,
      maxJobMs: 6000,
      maxRedirects: 3,
      maxContactPages: 3,
      maxConcurrentPages: 1,
      maxUrlLength: 2048,
      cacheSeconds: 60,
      renderDelayMs: 0,
      ...overrides
    }
  });
}

function logger() {
  return { info: vi.fn(), warn: vi.fn(), debug: vi.fn() };
}

describe("secure research network boundary", () => {
  it("rejects private URLs before any network request is opened", async () => {
    const calls = [];
    const requestFactory = createMappedRequestFactory({}, calls);
    await expect(
      fetchWebsite("http://127.0.0.1:3000/menu", {
        config: researchConfig(),
        requestFactory
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN_DESTINATION" });
    expect(calls).toHaveLength(0);
  });

  it("rejects DNS rebinding and never contacts the private listener", async () => {
    const publicHits = [];
    const privateHits = [];
    const publicServer = await createHttpServer((req, res) => {
      publicHits.push(req.url);
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(
        '<html><head><title>Rebind</title></head><body><a href="/contact">Contact</a><p>Main</p></body></html>'
      );
    });
    const privateServer = await createHttpServer((req, res) => {
      privateHits.push(req.url);
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end("<html><body>Private</body></html>");
    });
    const calls = [];
    const requestFactory = createMappedRequestFactory(
      {
        "1.1.1.1": { hostname: "127.0.0.1", port: publicServer.port }
      },
      calls
    );
    const resolver = createSequenceResolver({
      "rebind.example": [
        [{ address: "1.1.1.1", family: 4 }],
        [{ address: "1.1.1.1", family: 4 }],
        [{ address: "127.0.0.1", family: 4 }]
      ]
    });
    const log = logger();

    try {
      const result = await collectResearch(
        { normalized: { website: "http://rebind.example/" } },
        {
          config: researchConfig(),
          resolver,
          requestFactory,
          logger: log,
          enabled: true
        }
      );

      expect(result).toMatchObject({
        status: "degraded",
        error: { code: "RESEARCH_DEGRADED" }
      });
      expect(publicHits).toEqual(["/"]);
      expect(privateHits).toHaveLength(0);
      expect(calls).toHaveLength(1);
    } finally {
      await closeServer(publicServer.server);
      await closeServer(privateServer.server);
    }
  });

  it("rejects redirects to a private target before the private socket opens", async () => {
    const publicHits = [];
    const privateHits = [];
    const privateServer = await createHttpServer((req, res) => {
      privateHits.push(req.url);
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end("<html><body>Private</body></html>");
    });
    const publicServer = await createHttpServer((req, res) => {
      publicHits.push(req.url);
      res.writeHead(302, {
        location: `http://127.0.0.1:${privateServer.port}/secret`,
        "content-type": "text/html; charset=utf-8"
      });
      res.end("redirecting");
    });
    const calls = [];
    const requestFactory = createMappedRequestFactory(
      {
        "1.1.1.1": { hostname: "127.0.0.1", port: publicServer.port }
      },
      calls
    );
    const resolver = createSequenceResolver({
      "redirect.example": [[{ address: "1.1.1.1", family: 4 }]]
    });

    try {
      await expect(
        fetchWebsite("http://redirect.example/", {
          config: researchConfig(),
          resolver,
          requestFactory
        })
      ).rejects.toMatchObject({ code: "FORBIDDEN_DESTINATION" });
      expect(publicHits).toEqual(["/"]);
      expect(privateHits).toHaveLength(0);
      expect(calls).toHaveLength(1);
    } finally {
      await closeServer(publicServer.server);
      await closeServer(privateServer.server);
    }
  });

  it.each([
    {
      name: "declared Content-Length",
      setup: async () =>
        createHttpServer((req, res) => {
          res.writeHead(200, {
            "content-type": "text/html; charset=utf-8",
            "content-length": "2048"
          });
          res.end("<html><body>too large</body></html>");
        })
    },
    {
      name: "chunked endless stream",
      setup: async () => {
        const state = { chunks: 0, closed: false };
        const server = await createHttpServer((req, res) => {
          res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
          const interval = setInterval(() => {
            state.chunks += 1;
            res.write(`<p>${"x".repeat(64)}</p>`);
          }, 5);
          res.on("close", () => {
            state.closed = true;
            clearInterval(interval);
          });
        });
        return { ...server, state };
      }
    },
    {
      name: "compressed decoded bomb",
      setup: async () =>
        createHttpServer((req, res) => {
          const body = gzipSync(Buffer.from("<html><body>" + "x".repeat(4000) + "</body></html>"));
          res.writeHead(200, {
            "content-type": "text/html; charset=utf-8",
            "content-encoding": "gzip",
            "content-length": String(body.length)
          });
          res.end(body);
        })
    }
  ])("aborts oversized $name responses during streaming", async ({ setup }) => {
    const server = await setup();
    const calls = [];
    const requestFactory = createMappedRequestFactory(
      {
        "1.1.1.1": { hostname: "127.0.0.1", port: server.port }
      },
      calls
    );
    const resolver = createSequenceResolver({
      "oversized.example": [[{ address: "1.1.1.1", family: 4 }]]
    });

    try {
      await expect(
        fetchWebsite("http://oversized.example/", {
          config: researchConfig({ responseBytes: 128, maxPageBytes: 256 }),
          resolver,
          requestFactory
        })
      ).rejects.toMatchObject({ code: "RESEARCH_RESPONSE_TOO_LARGE" });
      expect(calls).toHaveLength(1);
      if (server.state) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(server.state.closed).toBe(true);
      }
    } finally {
      await closeServer(server.server);
    }
  });

  it("ignores hostile script, service-worker, websocket, download, and iframe attempts because no JavaScript executes", async () => {
    const counts = {
      sw: 0,
      socket: 0,
      download: 0,
      frame: 0,
      worker: 0,
      popup: 0,
      loop: 0
    };
    const server = await createHttpServer((req, res) => {
      if (req.url === "/sw.js") counts.sw += 1;
      else if (req.url === "/socket") counts.socket += 1;
      else if (req.url === "/download") counts.download += 1;
      else if (req.url === "/frame") counts.frame += 1;
      else if (req.url === "/worker.js") counts.worker += 1;
      else if (req.url === "/popup") counts.popup += 1;
      else if (req.url === "/loop") counts.loop += 1;
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(`
        <html>
          <head>
            <title>Hostile Page</title>
            <script>
              while (true) {}
              navigator.serviceWorker.register("/sw.js");
              new WebSocket("ws://127.0.0.1:${server?.port}/socket");
              const a = document.createElement("a");
              a.href = "/download";
              a.download = "bad.bin";
              a.click();
              window.open("/popup");
              location.href = "/loop";
              new Worker("/worker.js");
            </script>
          </head>
          <body>
            <iframe src="/frame"></iframe>
            <p>Safe text</p>
          </body>
        </html>`);
    });
    const calls = [];
    const requestFactory = createMappedRequestFactory(
      {
        "1.1.1.1": { hostname: "127.0.0.1", port: server.port }
      },
      calls
    );
    const resolver = createSequenceResolver({
      "hostile.example": [[{ address: "1.1.1.1", family: 4 }]]
    });

    try {
      const result = await fetchWebsite("http://hostile.example/", {
        config: researchConfig({ responseBytes: 8192, maxPageBytes: 16384 }),
        resolver,
        requestFactory
      });
      expect(result.body).toContain("Safe text");
      expect(counts).toEqual({
        sw: 0,
        socket: 0,
        download: 0,
        frame: 0,
        worker: 0,
        popup: 0,
        loop: 0
      });
      expect(calls).toHaveLength(1);
    } finally {
      await closeServer(server.server);
    }
  });

  it("rejects invalid TLS certificates without retrying insecurely", async () => {
    const tlsServer = await createHttpsServer(
      (req, res) => {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end("<html><body>TLS</body></html>");
      },
      { commonName: "wrong.example" }
    );
    const calls = [];
    const requestFactory = createMappedRequestFactory(
      {
        "1.1.1.1": { hostname: "127.0.0.1", port: tlsServer.port, protocol: "https:" }
      },
      calls
    );
    const resolver = createSequenceResolver({
      "secure.example": [[{ address: "1.1.1.1", family: 4 }]]
    });

    try {
      await expect(
        fetchWebsite("https://secure.example/", {
          config: researchConfig(),
          resolver,
          requestFactory
        })
      ).rejects.toMatchObject({ code: "TLS_VALIDATION_FAILURE" });
      expect(calls).toHaveLength(1);
    } finally {
      await closeServer(tlsServer.server);
    }
  });

  it("fails closed when cumulative page bytes exceed the job budget", async () => {
    const mainServer = await createHttpServer((req, res) => {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(
        `<html><head><title>Budget</title></head><body><a href="/contact">Contact</a><p>${"a".repeat(180)}</p></body></html>`
      );
    });
    const contactServer = await createHttpServer((req, res) => {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(`<html><body><p>${"b".repeat(180)}</p></body></html>`);
    });
    const calls = [];
    const requestFactory = createMappedRequestFactory(
      {
        "1.1.1.1": { hostname: "127.0.0.1", port: mainServer.port },
        "2.2.2.2": { hostname: "127.0.0.1", port: contactServer.port }
      },
      calls
    );
    const resolver = createSequenceResolver({
      "budget.example": [[{ address: "1.1.1.1", family: 4 }], [{ address: "2.2.2.2", family: 4 }]]
    });
    const log = logger();

    try {
      const result = await collectResearch(
        { normalized: { website: "http://budget.example/" } },
        {
          config: researchConfig({ maxJobBytes: 320, responseBytes: 256 }),
          resolver,
          requestFactory,
          logger: log,
          enabled: true
        }
      );

      expect(result).toMatchObject({
        status: "degraded",
        error: { code: "RESEARCH_DEGRADED" }
      });
      expect(calls).toHaveLength(4);
    } finally {
      await closeServer(mainServer.server);
      await closeServer(contactServer.server);
    }
  });
});
