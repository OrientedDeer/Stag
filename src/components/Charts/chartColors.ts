/**
 * Themeable chart colors. These are CSS `var()` strings that resolve at render
 * time (SVG fill/stroke and Nivo theme values accept them), so every chart that
 * uses them recolors automatically with the active theme. Token values live in
 * src/index.css (default + [data-theme="elite"]).
 */

/** Canonical categorical series palette (12 distinct, themeable slots). */
export const CHART_SERIES: string[] = Array.from(
  { length: 12 },
  (_, i) => `var(--color-chart-series-${i + 1})`,
);

/** Primary "money"/net-worth series color. */
export const CHART_MONEY = "var(--color-chart-money)";

/** Map an array of keys to stable series colors. */
export function colorMapForKeys(keys: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  keys.forEach((key, i) => {
    map[key] = CHART_SERIES[i % CHART_SERIES.length];
  });
  return map;
}

/** Parse a concrete color (hex or rgb/rgba) to [r, g, b] 0–255; null if unparseable. */
function parseColorChannels(color: string): [number, number, number] | null {
  const hex = color.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const h = hex[1];
    const full = h.length === 3 ? h.split("").map(c => c + c).join("") : h;
    return [
      parseInt(full.slice(0, 2), 16),
      parseInt(full.slice(2, 4), 16),
      parseInt(full.slice(4, 6), 16),
    ];
  }
  const rgb = color.match(/^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  return null;
}

/** Lighten a resolved color toward white by `t` (0..1). Pass-through if unparseable. */
export function lightenColor(color: string, t: number): string {
  const channels = parseColorChannels(color);
  if (!channels) return color;
  const [r, g, b] = channels.map(c => Math.round(c + (255 - c) * t));
  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * Shade for the i-th of `count` sibling arcs in a sunburst outer ring: a ramp
 * of progressively lighter tints of the parent category color, so adjacent
 * siblings stay distinguishable (a single uniform "brighter" modifier renders
 * every sibling the exact same color). Largest-first data order keeps the
 * biggest slice closest to the category's own color.
 */
export function sunburstItemShade(base: string, index: number, count: number): string {
  const step = Math.min(0.45 / Math.max(count - 1, 1), 0.18);
  return lightenColor(base, 0.1 + index * step);
}

/**
 * Readable label ink for text drawn ON a colored mark: near-black on light
 * marks, white on dark ones (WCAG relative-luminance crossover ~0.2). Keeps
 * arc labels legible on pale slices (cream/amber) where hardcoded #fff fails.
 */
export function contrastInk(color: string): string {
  const channels = parseColorChannels(color);
  if (!channels) return "#ffffff";
  const [r, g, b] = channels.map(c => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.2 ? "#0b1220" : "#ffffff";
}

/**
 * Resolve a CSS `var(--x)` color string to a concrete `rgb(...)` value.
 *
 * Nivo runs series colors through d3-color (gradients via `color: 'inherit'`,
 * `darker`/`brighter` modifiers, contrast labels). d3-color cannot parse
 * `var(...)`, so those features render black. We resolve to a real color by
 * reading it back off a hidden probe element. Pass-through for plain hex/rgb.
 */
let probe: HTMLSpanElement | null = null;
let normalizeCtx: CanvasRenderingContext2D | null | undefined;

/** Gamma-encode a linear-sRGB channel (0..1) to an 8-bit value. */
function srgb8(c: number): number {
  const v = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  return Math.round(Math.min(1, Math.max(0, v)) * 255);
}

/**
 * Convert an `oklch(L C H[ / A])` string to `rgb()`/`rgba()`, returning null if
 * it isn't oklch. Done in JS (not via <canvas>) on purpose: d3-color v3 — which
 * Nivo uses for the brighter/darker childColor modifiers and contrast labels —
 * cannot parse oklch, and neither can <canvas> in browser versions that DO
 * render oklch in CSS (e.g. Chrome 111–118), so a canvas round-trip silently
 * no-ops there. The DEFAULT theme authors its tokens in oklch(), so without this
 * the outer-ring/derived arcs render black.
 */
function oklchToRgb(value: string): string | null {
  const m = value.match(
    /oklch\(\s*([\d.]+%?)\s+([\d.]+%?)\s+([\d.]+)(?:deg)?\s*(?:\/\s*([\d.]+%?))?\s*\)/i,
  );
  if (!m) return null;
  let L = parseFloat(m[1]); if (m[1].endsWith("%")) L /= 100;
  let C = parseFloat(m[2]); if (m[2].endsWith("%")) C = (C / 100) * 0.4;
  const H = (parseFloat(m[3]) * Math.PI) / 180;
  const a = C * Math.cos(H);
  const b = C * Math.sin(H);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ * l_ * l_, mm = m_ * m_ * m_, s = s_ * s_ * s_;
  const r = 4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * s;
  const g = -1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * s;
  const bl = -0.0041960863 * l - 0.7034186147 * mm + 1.707614701 * s;
  const rgb = `${srgb8(r)}, ${srgb8(g)}, ${srgb8(bl)}`;
  if (m[4] == null) return `rgb(${rgb})`;
  const alpha = m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
  return `rgba(${rgb}, ${alpha})`;
}

/** Last-resort normalize for color spaces we don't hand-convert (color(), lab…). */
function canvasNormalize(color: string): string {
  if (typeof document === "undefined") return color;
  if (normalizeCtx === undefined) {
    normalizeCtx = document.createElement("canvas").getContext("2d");
  }
  if (!normalizeCtx) return color;
  const sentinel = "#010203";
  normalizeCtx.fillStyle = sentinel;
  normalizeCtx.fillStyle = color;
  return normalizeCtx.fillStyle === sentinel ? color : normalizeCtx.fillStyle;
}

export function resolveColor(value: string | undefined): string {
  if (!value) return "#888888";
  if (typeof window === "undefined") return value;
  let resolved = value;
  if (value.includes("var(")) {
    if (!probe) {
      probe = document.createElement("span");
      probe.style.cssText = "display:none;position:absolute";
      document.body.appendChild(probe);
    }
    probe.style.color = "";
    probe.style.color = value;
    resolved = getComputedStyle(probe).color || value;
  }
  // rgb/hsl/hex/named are already d3-parseable; oklch() (default theme) is not —
  // convert it so d3-color (childColor brighter/darker, contrast labels) works.
  if (/^(#|rgb|hsl)/i.test(resolved)) return resolved;
  return oklchToRgb(resolved) ?? canvasNormalize(resolved);
}

