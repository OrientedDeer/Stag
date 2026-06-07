/**
 * Themeable chart colors. These are CSS `var()` strings that resolve at render
 * time (SVG fill/stroke and Nivo theme values accept them), so every chart that
 * uses them recolors automatically with the active theme. Token values live in
 * src/index.css (default + [data-theme="elite"]). See docs/THEMING_PLAN.md.
 */

/** Canonical categorical series palette (12 distinct, themeable slots). */
export const CHART_SERIES: string[] = Array.from(
  { length: 12 },
  (_, i) => `var(--color-chart-series-${i + 1})`,
);

/** Primary "money"/net-worth series color. */
export const CHART_MONEY = "var(--color-chart-money)";

/** Semantic chart colors (reuse the app's state tokens). */
export const CHART_POSITIVE = "var(--c-positive)";
export const CHART_NEGATIVE = "var(--c-negative)";
export const CHART_WARNING = "var(--c-warning)";
export const CHART_ACCENT = "var(--c-accent-soft)";
export const CHART_NEUTRAL = "var(--c-content-muted)";

/** Pick `count` evenly distributed series colors (wraps if count > 12). */
export function seriesColors(count: number): string[] {
  return Array.from({ length: count }, (_, i) => CHART_SERIES[i % CHART_SERIES.length]);
}

/** Map an array of keys to stable series colors. */
export function colorMapForKeys(keys: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  keys.forEach((key, i) => {
    map[key] = CHART_SERIES[i % CHART_SERIES.length];
  });
  return map;
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
export function resolveColor(value: string | undefined): string {
  if (!value) return "#888888";
  if (typeof window === "undefined" || !value.includes("var(")) return value;
  if (!probe) {
    probe = document.createElement("span");
    probe.style.cssText = "display:none;position:absolute";
    document.body.appendChild(probe);
  }
  probe.style.color = "";
  probe.style.color = value;
  const resolved = getComputedStyle(probe).color;
  return resolved || value;
}

