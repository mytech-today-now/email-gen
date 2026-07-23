import { describe, expect, it } from "vitest";
import { parseGoogleSheetsCsvUrl, parseImportBuffer } from "../../src/data/importer.js";
import {
  closeServer,
  createHttpServer,
  createMappedRequestFactory,
  createSequenceResolver
} from "../helpers/secureResearchFixtures.js";

const limits = { uploadBytes: 100000, records: 100, fields: 20, fieldBytes: 1000 };

describe("import edge cases", () => {
  it("imports CSV and blank rows without crashing", () => {
    const parsed = parseImportBuffer({
      buffer: Buffer.from("id,name\n1,A\n,\n2,B\n"),
      filename: "x.csv",
      limits
    });
    expect(parsed.records).toHaveLength(2);
  });

  it("rejects executable JavaScript data files", () => {
    expect(() =>
      parseImportBuffer({
        buffer: Buffer.from("export default fetch('https://example.com')"),
        filename: "x.js",
        limits
      })
    ).toThrow(/static array or object/);
  });

  it("rejects Apple Numbers directly", () => {
    expect(() =>
      parseImportBuffer({ buffer: Buffer.from("not a numbers file"), filename: "x.numbers", limits })
    ).toThrow(/Apple Numbers/);
  });

  it("reports malformed JSON with an actionable line and column", () => {
    try {
      parseImportBuffer({
        buffer: Buffer.from('{"records":[{"id":176,"name":"712 Eat + Drink",}]}'),
        filename: "restaurants.json",
        limits
      });
      throw new Error("expected parse failure");
    } catch (error) {
      expect(error.code).toBe("IMPORT_JSON_INVALID");
      expect(error.message).toMatch(/line/i);
      expect(error.details).toMatchObject({
        line: expect.any(Number),
        column: expect.any(Number)
      });
    }
  });

  it("imports bounded Google Sheets CSV text through the hardened fetch path", async () => {
    const server = await createHttpServer((req, res) => {
      expect(req.url).toBe("/export?format=csv");
      res.writeHead(200, { "content-type": "text/csv; charset=utf-8" });
      res.end("id,name\n1,Alpha\n");
    });
    const calls = [];
    const resolver = createSequenceResolver({
      "sheet.example": [[{ address: "1.1.1.1", family: 4 }]]
    });
    const requestFactory = createMappedRequestFactory(
      { "1.1.1.1": { hostname: "127.0.0.1", port: server.port } },
      calls
    );

    try {
      const parsed = await parseGoogleSheetsCsvUrl("http://sheet.example/export?format=csv", {
        limits,
        resolver,
        requestFactory
      });
      expect(parsed.records).toHaveLength(1);
      expect(parsed.records[0].normalized.name).toBe("Alpha");
      expect(calls).toHaveLength(1);
    } finally {
      await closeServer(server.server);
    }
  });

  it("rejects private Google Sheets URLs before any request is opened", async () => {
    const calls = [];
    await expect(
      parseGoogleSheetsCsvUrl("http://127.0.0.1:31337/export?format=csv", {
        limits,
        requestFactory: createMappedRequestFactory({}, calls)
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN_DESTINATION" });
    expect(calls).toHaveLength(0);
  });

  it("rejects redirects from Google Sheets imports to private targets", async () => {
    const privateHits = [];
    const publicHits = [];
    const privateServer = await createHttpServer((req, res) => {
      privateHits.push(req.url);
      res.writeHead(200, { "content-type": "text/csv; charset=utf-8" });
      res.end("id,name\n2,Blocked\n");
    });
    const publicServer = await createHttpServer((req, res) => {
      publicHits.push(req.url);
      res.writeHead(302, {
        location: `http://127.0.0.1:${privateServer.port}/sheet.csv`,
        "content-type": "text/csv; charset=utf-8"
      });
      res.end("redirecting");
    });
    const calls = [];
    const resolver = createSequenceResolver({
      "sheet.example": [[{ address: "1.1.1.1", family: 4 }]]
    });
    const requestFactory = createMappedRequestFactory(
      { "1.1.1.1": { hostname: "127.0.0.1", port: publicServer.port } },
      calls
    );

    try {
      await expect(
        parseGoogleSheetsCsvUrl("http://sheet.example/export?format=csv", {
          limits,
          resolver,
          requestFactory
        })
      ).rejects.toMatchObject({ code: "FORBIDDEN_DESTINATION" });
      expect(publicHits).toEqual(["/export?format=csv"]);
      expect(privateHits).toHaveLength(0);
      expect(calls).toHaveLength(1);
    } finally {
      await closeServer(publicServer.server);
      await closeServer(privateServer.server);
    }
  });
});
