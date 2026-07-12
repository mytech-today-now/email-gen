import { describe, expect, it } from "vitest";
import { sanitizeEmailHtml } from "../../src/output/sanitizer.js";
import { redactSecrets } from "../../src/utils/logger.js";
import { assertPublicHttpUrl } from "../../src/research/websiteFetcher.js";

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
});
