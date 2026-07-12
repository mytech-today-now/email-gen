import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestHarness } from "../helpers/appTestHarness.js";

let harness;
let previousEnv;
const envKeys = ["AI_MOCK", "ENABLED_AI_PROVIDERS"];

beforeEach(() => {
  previousEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  process.env.AI_MOCK = "true";
  process.env.ENABLED_AI_PROVIDERS = "openai,anthropic,xai,venice,lumaai,custom,mock";
  harness = createTestHarness();
});

afterEach(() => {
  harness.cleanup();
  for (const key of envKeys) {
    if (previousEnv[key] === undefined) delete process.env[key];
    else process.env[key] = previousEnv[key];
  }
});

describe("HTTP error regressions", () => {
  it("serves favicon requests without converting them to 500 errors", async () => {
    await harness.request.get("/favicon.ico").expect(204);
    await harness.request.get("/.well-known/appspecific/com.chrome.devtools.json").expect(204);
    const missing = await harness.request.get("/does-not-exist").expect(404);
    expect(missing.body.error.code).toBe("ROUTE_NOT_FOUND");
  });

  it("turns malformed imports into safe client errors", async () => {
    const response = await harness.request
      .post("/api/records/import")
      .attach("file", Buffer.from('id,name\n1,"unterminated'), "bad.csv")
      .expect(400);
    expect(response.body.error.code).toBe("IMPORT_PARSE_FAILED");
    expect(response.body.error.message).toMatch(/could not parse/i);
  });
});
