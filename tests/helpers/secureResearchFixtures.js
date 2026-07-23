import http from "node:http";
import https from "node:https";
import { PassThrough } from "node:stream";
import selfsigned from "selfsigned";

export async function createHttpServer(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address();
  return {
    server,
    port,
    url: `http://127.0.0.1:${port}`
  };
}

export async function createHttpsServer(handler, { commonName = "example.test" } = {}) {
  const pems = selfsigned.generate([{ name: "commonName", value: commonName }], {
    algorithm: "sha256",
    days: 1,
    keySize: 2048,
    extensions: [
      {
        name: "subjectAltName",
        altNames: [{ type: 2, value: commonName }]
      }
    ]
  });
  const server = https.createServer({ key: pems.private, cert: pems.cert }, handler);
  await new Promise((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address();
  return {
    server,
    port,
    url: `https://${commonName}:${port}`
  };
}

export function createSequenceResolver(sequenceByHost = {}) {
  const counts = new Map();
  return async (hostname) => {
    const sequence = sequenceByHost[hostname] ?? sequenceByHost["*"] ?? [];
    const index = counts.get(hostname) ?? 0;
    counts.set(hostname, index + 1);
    const next = sequence[Math.min(index, sequence.length - 1)] ?? sequence[0] ?? [];
    const records = Array.isArray(next) ? next : [next];
    return records.map((record) => {
      if (typeof record === "string") {
        return {
          address: record,
          family: record.includes(":") ? 6 : 4
        };
      }
      return record;
    });
  };
}

export function createMappedRequestFactory(mapping = {}, calls = []) {
  return (options, onResponse) => {
    calls.push({
      ...options,
      headers: { ...(options.headers ?? {}) }
    });
    const target = mapping[options.hostname];
    const routedOptions = target
      ? {
          ...options,
          protocol: target.protocol ?? options.protocol,
          hostname: target.hostname ?? options.hostname,
          port: target.port ?? options.port
        }
      : options;
    const module = routedOptions.protocol === "https:" ? https : http;
    return module.request(routedOptions, (response) => {
      try {
        if (response?.socket && options?.hostname) {
          Object.defineProperty(response.socket, "remoteAddress", {
            value: options.hostname,
            configurable: true
          });
          Object.defineProperty(response.socket, "remoteFamily", {
            value: String(options.hostname).includes(":") ? "IPv6" : "IPv4",
            configurable: true
          });
        }
      } catch {
        // If the socket properties are not configurable, leave the real values in place.
      }
      onResponse(response);
    });
  };
}

export function createSpoofedRequestFactory(
  {
    remoteAddress = "127.0.0.1",
    remoteFamily = "IPv4",
    statusCode = 200,
    headers = { "content-type": "text/html; charset=utf-8" },
    body = "<html><body>ok</body></html>"
  } = {},
  calls = []
) {
  return (options, onResponse) => {
    calls.push({
      ...options,
      headers: { ...(options.headers ?? {}) }
    });
    const request = new PassThrough();
    queueMicrotask(() => {
      const response = new PassThrough();
      response.statusCode = statusCode;
      response.headers = headers;
      response.socket = { remoteAddress, remoteFamily };
      onResponse(response);
      response.end(body);
    });
    return request;
  };
}

export async function closeServer(server) {
  if (!server) return;
  await new Promise((resolve) => server.close(resolve));
}

export async function collectBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}
