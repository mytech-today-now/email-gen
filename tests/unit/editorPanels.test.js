import { describe, expect, it } from "vitest";
import {
  clampEditorPanelHeight,
  fitEditorPanelHeight,
  normalizeEditorPanelState,
  summarizeHtml,
  viewportHeightLimit
} from "../../public/modules/editorPanels.js";

describe("editor panel sizing utilities", () => {
  it("clamps raw and preview panel heights to sensible viewport-aware bounds", () => {
    expect(clampEditorPanelHeight("raw", 10, { viewportHeight: 900 })).toBe(320);
    expect(clampEditorPanelHeight("preview", 10_000, { viewportHeight: 900 })).toBe(
      viewportHeightLimit("preview", 900)
    );
  });

  it("recovers invalid or legacy persisted panel heights safely", () => {
    const normalized = normalizeEditorPanelState({ raw: "bad", preview: 1200 }, { viewportHeight: 920 });
    expect(normalized.panels.raw).toBe(540);
    expect(normalized.panels.preview).toBe(viewportHeightLimit("preview", 920));
    expect(normalized.recovered).toHaveLength(2);

    const legacy = normalizeEditorPanelState(undefined, { legacyHeight: 480, viewportHeight: 920 });
    expect(legacy.panels).toEqual({ raw: 480, preview: 480 });
  });

  it("fits content height and summarizes HTML without exposing the full payload", () => {
    expect(fitEditorPanelHeight("raw", 100, { viewportHeight: 900 })).toBe(320);
    expect(fitEditorPanelHeight("preview", 700, { viewportHeight: 900 })).toBe(820);
    expect(summarizeHtml("<table>\n<tr><td>Hello</td></tr>\n</table>")).toEqual({
      characters: 40,
      lines: 3,
      hash: expect.any(String)
    });
  });

  it("allows editor panels to grow beyond the visible viewport inside the scrolling result pane", () => {
    expect(viewportHeightLimit("raw", 785)).toBe(980);
    expect(viewportHeightLimit("preview", 640)).toBe(920);
  });
});
