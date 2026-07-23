const PANEL_ORDER = ["raw", "preview"];

export const EDITOR_PANEL_CONFIG = Object.freeze({
  raw: Object.freeze({
    label: "Raw HTML",
    defaultHeight: 540,
    minHeight: 320,
    maxHeight: 980,
    collapsedHeight: 220,
    fitPadding: 120,
    viewportOffset: 280
  }),
  preview: Object.freeze({
    label: "Rendered HTML",
    defaultHeight: 560,
    minHeight: 320,
    maxHeight: 980,
    collapsedHeight: 240,
    fitPadding: 120,
    viewportOffset: 280
  })
});

function fallbackConfig(panel) {
  return EDITOR_PANEL_CONFIG[panel] ?? EDITOR_PANEL_CONFIG.raw;
}

export function summarizeHtml(value) {
  const source = String(value ?? "");
  let hash = 0;
  for (let index = 0; index < source.length; index += 1) {
    hash = (hash * 31 + source.charCodeAt(index)) >>> 0;
  }
  return {
    characters: source.length,
    lines: source ? source.split(/\r?\n/).length : 0,
    hash: hash.toString(16).padStart(8, "0")
  };
}

export function viewportHeightLimit(panel, viewportHeight = 0) {
  const config = fallbackConfig(panel);
  if (!Number.isFinite(viewportHeight) || viewportHeight <= 0) return config.maxHeight;
  return Math.max(config.minHeight, Math.min(config.maxHeight, viewportHeight + config.viewportOffset));
}

export function clampEditorPanelHeight(panel, value, options = {}) {
  const config = fallbackConfig(panel);
  const numeric = Number(value);
  const minimum = config.minHeight;
  const maximum = viewportHeightLimit(panel, options.viewportHeight);
  if (!Number.isFinite(numeric)) return config.defaultHeight;
  return Math.min(maximum, Math.max(minimum, Math.round(numeric)));
}

export function fitEditorPanelHeight(panel, measuredHeight, options = {}) {
  const config = fallbackConfig(panel);
  return clampEditorPanelHeight(panel, Number(measuredHeight) + config.fitPadding, options);
}

export function resizeStep(panel, direction = 1, currentHeight, options = {}) {
  const step = Number(options.step) || 72;
  return clampEditorPanelHeight(panel, Number(currentHeight) + step * direction, options);
}

export function collapsedEditorPanelHeight(panel, options = {}) {
  const config = fallbackConfig(panel);
  return clampEditorPanelHeight(panel, config.collapsedHeight, options);
}

export function normalizeEditorPanelState(value, options = {}) {
  const legacyHeight = Number(options.legacyHeight);
  const normalized = {};
  const recovered = [];
  for (const panel of PANEL_ORDER) {
    const candidate =
      value && typeof value === "object" && value[panel] !== undefined
        ? value[panel]
        : Number.isFinite(legacyHeight)
          ? legacyHeight
          : fallbackConfig(panel).defaultHeight;
    const clamped = clampEditorPanelHeight(panel, candidate, options);
    normalized[panel] = clamped;
    if (!Number.isFinite(Number(candidate)) || Math.round(Number(candidate)) !== clamped) {
      recovered.push({ panel, received: candidate, applied: clamped });
    }
  }
  return { panels: normalized, recovered };
}
