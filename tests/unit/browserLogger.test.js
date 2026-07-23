import { afterEach, describe, expect, it, vi } from "vitest";
import { createBrowserLogger } from "../../public/modules/logger.js";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("browser logger", () => {
  it("redacts sensitive metadata and persists entries without crashing", async () => {
    const puts = [];
    const logger = createBrowserLogger(
      {
        put: async (_store, value) => {
          puts.push(value);
          return value;
        }
      },
      async () => ({ ok: true })
    );
    vi.spyOn(console, "info").mockImplementation(() => {});

    await logger.info("editor_panel_resize_end", {
      apiKey: "sk-secret-12345678",
      html: "<div>safe</div>",
      nested: { authorization: "Bearer hidden-token" }
    });

    expect(puts).toHaveLength(1);
    expect(puts[0]).toHaveProperty("severity", "info");
    expect(JSON.stringify(puts[0].metadata)).toContain("[REDACTED]");
    expect(JSON.stringify(puts[0].metadata)).not.toContain("hidden-token");
    expect(JSON.stringify(puts[0].metadata)).toContain("<div>safe</div>");
  });

  it("warns and keeps running when repository or flush persistence fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const logger = createBrowserLogger(
      {
        put: async () => {
          throw new Error("db offline");
        }
      },
      async () => {
        throw new Error("network offline");
      }
    );
    vi.spyOn(console, "info").mockImplementation(() => {});

    for (let index = 0; index < 10; index += 1) {
      await logger.info("editor_panel_resize_move", { index });
    }
    await logger.flush();

    expect(warn).toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls.map((call) => call[0])).toEqual(
      expect.arrayContaining(["[browser_log_repository_failed]", "[browser_log_flush_failed]"])
    );
  });

  it("suppresses recursive api logging and backs off transient flush retries", async () => {
    vi.useFakeTimers();
    const api = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error("slow down"), { status: 429, retryAfterMs: 2_000 }))
      .mockResolvedValue({ ok: true });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    const logger = createBrowserLogger(
      {
        put: async (_store, value) => value
      },
      api
    );

    for (let index = 0; index < 10; index += 1) {
      await logger.info("browser_record_processing_completed", { index });
    }

    expect(api).toHaveBeenCalledTimes(1);
    expect(api).toHaveBeenCalledWith(
      "/api/client-logs",
      expect.objectContaining({
        method: "POST",
        logErrors: false
      })
    );

    await logger.flush();
    expect(api).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      "[browser_log_flush_failed]",
      expect.objectContaining({
        message: "slow down",
        metadata: expect.objectContaining({ count: 10, retryAfterMs: 2_000 })
      })
    );

    await vi.advanceTimersByTimeAsync(2_000);
    expect(api).toHaveBeenCalledTimes(2);
  });
});
