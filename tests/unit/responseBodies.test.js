import { describe, expect, it } from "vitest";
import {
  readBoundedResponseBytes,
  readBoundedResponseJson,
  readBoundedResponseText
} from "../../src/utils/responseBodies.js";

const encoder = new TextEncoder();

function streamResponse(chunks, { headers = {}, delays = [] } = {}) {
  const encoded = chunks.map((chunk) =>
    chunk instanceof Uint8Array ? chunk : encoder.encode(String(chunk))
  );
  let index = 0;
  let cancelled = false;
  return new Response(
    new ReadableStream({
      async pull(controller) {
        if (index >= encoded.length) {
          controller.close();
          return;
        }
        const delay = delays[index] ?? 0;
        if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
        if (cancelled) return;
        controller.enqueue(encoded[index++]);
        if (index >= encoded.length) controller.close();
      },
      cancel() {
        cancelled = true;
      }
    }),
    { headers }
  );
}

describe("bounded response reader", () => {
  it("decodes multibyte chunks incrementally", async () => {
    const bytes = encoder.encode("A€B");
    const response = streamResponse([bytes.slice(0, 1), bytes.slice(1, 2), bytes.slice(2)], {
      headers: { "content-type": "application/json" }
    });

    const {
      text,
      bytes: outBytes,
      transferredBytes
    } = await readBoundedResponseText(response, {
      expectedContentTypes: ["application/json"]
    });

    expect(text).toBe("A€B");
    expect(Array.from(outBytes)).toEqual(Array.from(bytes));
    expect(transferredBytes).toBe(bytes.byteLength);
  });

  it("rejects unexpected content types", async () => {
    const response = new Response("{}", { headers: { "content-type": "text/html" } });

    await expect(
      readBoundedResponseText(response, { expectedContentTypes: ["application/json"] })
    ).rejects.toMatchObject({ code: "RESPONSE_INVALID_CONTENT_TYPE" });
  });

  it("enforces encoded byte caps", async () => {
    const response = new Response("abcd");

    await expect(readBoundedResponseBytes(response, { maxBytes: 3 })).rejects.toMatchObject({
      code: "RESPONSE_TOO_LARGE"
    });
  });

  it("accepts responses at the exact byte cap", async () => {
    const response = new Response("abc");

    const result = await readBoundedResponseBytes(response, { maxBytes: 3 });
    expect(result.bytes).toHaveLength(3);
    expect(result.transferredBytes).toBe(3);
  });

  it("rejects malformed content length metadata", async () => {
    const response = new Response("abc", { headers: { "content-length": "abc" } });

    await expect(readBoundedResponseBytes(response, { maxBytes: 10 })).rejects.toMatchObject({
      code: "RESPONSE_LENGTH_INVALID"
    });
  });

  it("rejects length mismatches", async () => {
    const response = new Response("abc", { headers: { "content-length": "5" } });

    await expect(readBoundedResponseBytes(response, { maxBytes: 10 })).rejects.toMatchObject({
      code: "RESPONSE_LENGTH_MISMATCH"
    });
  });

  it("rejects stalled streams after the idle timeout", async () => {
    const response = streamResponse(["hello"], { delays: [50] });

    await expect(
      readBoundedResponseText(response, { idleTimeoutMs: 10, deadlineMs: 100 })
    ).rejects.toMatchObject({ code: "RESPONSE_IDLE_TIMEOUT" });
  });

  it("rejects streams that exceed the deadline", async () => {
    const response = streamResponse(["hello", "world"], { delays: [0, 50] });

    await expect(
      readBoundedResponseText(response, { idleTimeoutMs: 100, deadlineMs: 20 })
    ).rejects.toMatchObject({ code: "RESPONSE_DEADLINE_EXCEEDED" });
  });

  it("rejects aborted reads", async () => {
    const controller = new AbortController();
    controller.abort(new DOMException("Aborted", "AbortError"));
    const response = new Response("hello");

    await expect(readBoundedResponseText(response, { signal: controller.signal })).rejects.toMatchObject({
      name: "AbortError"
    });
  });

  it("parses JSON payloads", async () => {
    const response = new Response('{"subject":"Hi"}', {
      headers: { "content-type": "application/json" }
    });

    const { payload } = await readBoundedResponseJson(response, {
      expectedContentTypes: ["application/json"]
    });

    expect(payload).toEqual({ subject: "Hi" });
  });

  it("rejects malformed JSON payloads", async () => {
    const response = new Response("{", { headers: { "content-type": "application/json" } });

    await expect(readBoundedResponseJson(response)).rejects.toMatchObject({
      code: "RESPONSE_INVALID_JSON"
    });
  });
});
