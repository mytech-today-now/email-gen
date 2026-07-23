import fs from "node:fs";
import { describe, expect, it } from "vitest";

const indexHtml = fs.readFileSync("public/index.html", "utf8");
const styles = fs.readFileSync("public/styles.css", "utf8");
const appJs = fs.readFileSync("public/app.js", "utf8");
const visualEditorCss = fs.readFileSync("public/visual-editor.css", "utf8");

describe("editor panel UX regressions", () => {
  it("keeps distinct raw and rendered HTML panel controls with full-width resize handles", () => {
    expect(indexHtml).toContain('id="rawCollapseButton"');
    expect(indexHtml).toContain('id="rawFitButton"');
    expect(indexHtml).toContain('id="rawExpandButton"');
    expect(indexHtml).toContain('id="visualCollapseButton"');
    expect(indexHtml).toContain('id="visualFitButton"');
    expect(indexHtml).toContain('id="visualExpandButton"');
    expect(indexHtml).toContain('id="rawResizeHandle"');
    expect(indexHtml).toContain('id="visualResizeHandle"');
    expect(indexHtml).toContain('data-testid="raw-resize-handle"');
    expect(indexHtml).toContain('data-testid="visual-resize-handle"');
    expect(indexHtml).toContain('aria-label="Resize raw HTML panel"');
    expect(indexHtml).toContain('aria-label="Resize rendered HTML panel"');
    expect(indexHtml).toContain('id="editorPanelMessage"');
    expect(indexHtml).toContain('id="rawEditorPane"');
    expect(indexHtml).toContain('id="visualEditorPane"');
    expect(indexHtml).not.toContain('id="editorCollapseButton"');
    expect(indexHtml).not.toContain('id="editorExpandButton"');
    expect(indexHtml).not.toContain('id="rawModeButton"');
    expect(indexHtml).not.toContain('id="visualModeButton"');
  });

  it("uses managed panel resizing instead of native textarea shell resizing", () => {
    expect(styles).toMatch(/\.panel-resize-handle\s*{[^}]*cursor:\s*ns-resize;/);
    expect(styles).toMatch(/\.panel-resize-handle\s*{[^}]*background:\s*transparent;/);
    expect(styles).toMatch(/\.panel-resize-text\s*{[^}]*clip:\s*rect\(0,\s*0,\s*0,\s*0\);/);
    expect(styles).toMatch(/\.editor-panel\s*{[^}]*height:\s*var\(--editor-panel-height\)/);
    expect(styles).not.toMatch(/\.email-editor\s*{[^}]*resize:\s*vertical;/);
    expect(appJs).toContain("beginEditorPanelResize");
    expect(appJs).toContain("editor_panel_resize_start");
    expect(appJs).toContain("editor_panel_state_recovered");
  });

  it("keeps rendered preview content constrained to its container", () => {
    expect(visualEditorCss).toContain(".canvas table");
    expect(visualEditorCss).toContain("max-width: 100%");
    expect(visualEditorCss).toContain("overflow-wrap: anywhere");
  });

  it("loads GitHub Dark highlighting assets for the raw HTML panel", () => {
    expect(indexHtml).toContain("/vendor/highlight-github-dark.css");
    expect(indexHtml).toContain("/vendor/highlight-html.js");
    expect(appJs).toContain("globalThis.hljs?.highlight?.");
    expect(appJs).toContain('language: "xml"');
    expect(appJs).not.toContain("color:#8bd5ca");
    expect(styles).toContain("--code-surface: #0d1117");
    expect(styles).toContain(".syntax-preview .hljs");
  });
});
