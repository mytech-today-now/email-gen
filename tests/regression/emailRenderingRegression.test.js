import fs from "node:fs";
import { describe, expect, it } from "vitest";

const renderer = fs.readFileSync("src/output/emailRenderer.js", "utf8");
const prompt = fs.readFileSync("prompts/restaurant-ai-sms.txt", "utf8");
const processor = fs.readFileSync("src/ai/processor.js", "utf8");

describe("email rendering regressions", () => {
  it("keeps renderer-owned signature and final link while suppressing duplicate body artifacts", () => {
    expect(renderer).toContain("stripAppendedEmailArtifacts");
    expect(processor).toContain("The application will append the signature");
    expect(renderer).not.toContain("Personalized for ${displayName}");
  });

  it("keeps the prompt from asking the model to render the sender signature or footer", () => {
    expect(prompt).toContain("Do not include any signature");
    expect(prompt).toContain("The application appends the canonical link");
    expect(prompt).not.toContain("End with this signature exactly");
  });
});
