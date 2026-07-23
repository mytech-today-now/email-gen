import { describe, expect, it } from "vitest";
import { sanitizeEmailHtml } from "../../src/output/sanitizer.js";
import { redactSecrets } from "../../src/utils/logger.js";
import { assertPublicHttpUrl } from "../../src/research/websiteFetcher.js";
import { fetchDocument } from "../../src/research/secureDocumentFetcher.js";
import { createSequenceResolver, createSpoofedRequestFactory } from "../helpers/secureResearchFixtures.js";

describe("security behavior", () => {
  it("sanitizes malicious markup", () => {
    const clean = sanitizeEmailHtml('<svg onload="alert(1)"></svg><p onclick="x()">Hi</p>');
    expect(clean).not.toContain("svg");
    expect(clean).not.toContain("onclick");
    expect(clean).toContain("<p>Hi</p>");
  });

  it("redacts common secret patterns", () => {
    expect(redactSecrets("XAI_API_KEY=xai-123456789abcdef")).not.toContain("123456789abcdef");
  });

  it("blocks private network research URLs", async () => {
    await expect(assertPublicHttpUrl("http://127.0.0.1:1234")).rejects.toThrow(/blocked|Localhost|Private/i);
  });

  it("normalizes trailing dots and rejects mixed or disguised destinations", async () => {
    const publicResolver = createSequenceResolver({
      "example.com": [[{ address: "1.1.1.1", family: 4 }]]
    });
    await expect(assertPublicHttpUrl("http://example.com.", { resolver: publicResolver })).resolves.toBe(
      "http://example.com/"
    );
    await expect(assertPublicHttpUrl("http://user:pass@example.com")).rejects.toMatchObject({
      code: "INVALID_URL"
    });
    await expect(assertPublicHttpUrl("data:text/plain,hello")).rejects.toMatchObject({
      code: "INVALID_URL"
    });
    await expect(assertPublicHttpUrl("http://2130706433")).rejects.toMatchObject({
      code: "FORBIDDEN_DESTINATION"
    });
    await expect(assertPublicHttpUrl("http://0x7f000001")).rejects.toMatchObject({
      code: "FORBIDDEN_DESTINATION"
    });
    await expect(assertPublicHttpUrl("http://0177.0.0.1")).rejects.toMatchObject({
      code: "FORBIDDEN_DESTINATION"
    });
    await expect(assertPublicHttpUrl("http://LOCALHOST.")).rejects.toMatchObject({
      code: "FORBIDDEN_DESTINATION"
    });
    await expect(assertPublicHttpUrl("http://[::ffff:127.0.0.1]/")).rejects.toMatchObject({
      code: "FORBIDDEN_DESTINATION"
    });
    await expect(
      assertPublicHttpUrl("http://mixed.example/", {
        resolver: async () => [
          { address: "1.1.1.1", family: 4 },
          { address: "127.0.0.1", family: 4 }
        ]
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN_DESTINATION" });
  });

  it("rejects a spoofed connected address before consuming the body", async () => {
    const calls = [];
    const resolver = createSequenceResolver({
      "spoof.example": [[{ address: "1.1.1.1", family: 4 }]]
    });
    const requestFactory = createSpoofedRequestFactory(
      {
        remoteAddress: "127.0.0.1",
        remoteFamily: "IPv4",
        body: "<html><body>spoofed</body></html>"
      },
      calls
    );

    await expect(
      fetchDocument("http://spoof.example/", {
        resolver,
        requestFactory,
        maxResponseBytes: 128,
        maxPageBytes: 256
      })
    ).rejects.toMatchObject({ code: "RESEARCH_CONNECTED_ADDRESS_MISMATCH" });
    expect(calls).toHaveLength(1);
  });
});
