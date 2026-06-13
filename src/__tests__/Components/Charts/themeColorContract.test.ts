/** @vitest-environment jsdom */
/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { color as d3color } from 'd3-color';
import { resolveColor } from '../../../components/Charts/chartColors';

/**
 * Theme/chart color contract test — prevents the "black chart arcs" bug class.
 *
 * Nivo runs every series color through d3-color v3 (childColor
 * brighter/darker, gradients, contrast labels). d3-color cannot parse
 * oklch()/color()/lab(), so any theme token that survives resolveColor()
 * (src/components/Charts/chartColors.ts) in a form d3 can't parse renders
 * charts BLACK with no error. This test reads the raw token declarations from
 * src/index.css and pushes each one through the production transformation
 * (resolveColor's oklch→rgb conversion; hex/rgb/hsl pass through), then uses
 * d3-color's `color()` as the oracle: post-transform `color(v) === null`
 * means that token would paint charts black.
 *
 * It deliberately bypasses DOM var() resolution (jsdom doesn't cascade custom
 * properties): var() references are resolved against the parsed token maps
 * before the value is handed to resolveColor, so resolveColor never takes its
 * getComputedStyle probe path here.
 *
 * If a token fails: FIX THE TOKEN in src/index.css (convert to hex/rgb).
 * Never loosen this test.
 */

// Token families consumed by the chart color path (see chartColors.ts and the
// CHART_SERIES / semantic chart usages across src/components/Charts).
const TOKEN_PATTERN =
  /^--(?:color-chart-|c-cat-|c-warning|c-negative|c-positive|c-accent|c-info)/;

interface CssBlock {
  /** Nested header path, e.g. ['@layer base', ':root'] */
  path: string[];
  /** Custom-property declarations found directly in this block. */
  decls: Map<string, string>;
}

/**
 * Minimal CSS walker: tracks brace nesting and collects custom-property
 * declarations per block. Good enough for token extraction (does not need to
 * understand full CSS) — selectors/at-rules are kept verbatim as the path.
 */
function parseCssBlocks(cssSource: string): CssBlock[] {
  const css = cssSource.replace(/\/\*[\s\S]*?\*\//g, ''); // strip comments
  const blocks: CssBlock[] = [];
  let i = 0;

  function takeDecl(raw: string, decls: Map<string, string>) {
    const m = raw.trim().match(/^(--[\w-]+)\s*:\s*([\s\S]+?)\s*$/);
    if (m) decls.set(m[1], m[2]);
  }

  function walk(parents: string[]) {
    const decls = new Map<string, string>();
    let buf = '';
    while (i < css.length) {
      const ch = css[i];
      if (ch === '{') {
        const header = buf.trim();
        buf = '';
        i++;
        walk([...parents, header]);
      } else if (ch === '}') {
        i++;
        break;
      } else if (ch === ';') {
        takeDecl(buf, decls);
        buf = '';
        i++;
      } else {
        buf += ch;
        i++;
      }
    }
    takeDecl(buf, decls); // last declaration may omit the trailing ';'
    if (decls.size > 0) blocks.push({ path: parents, decls });
  }

  walk([]);
  return blocks;
}

/** The selector(s) this block's declarations attach to (innermost non-at-rule). */
function effectiveSelectors(block: CssBlock): string[] {
  for (let i = block.path.length - 1; i >= 0; i--) {
    const header = block.path[i];
    if (!header.startsWith('@')) {
      return header.split(',').map((s) => s.trim());
    }
  }
  // Only at-rules above (e.g. Tailwind `@theme` / `@theme inline`): Tailwind
  // hoists those custom properties onto :root.
  return [':root'];
}

/** Resolve var(--x[, fallback]) references against the effective token map. */
function resolveVarRefs(
  value: string,
  env: Map<string, string>,
  depth = 0,
): string {
  if (depth > 16 || !value.includes('var(')) return value;
  const replaced = value.replace(
    /var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*))?\)/g,
    (whole, name: string, fallback?: string) => {
      const referenced = env.get(name);
      if (referenced != null) return referenced;
      if (fallback != null && fallback.trim() !== '') return fallback.trim();
      return whole; // unresolvable — leave in place so the d3 oracle fails loudly
    },
  );
  if (replaced === value) return value;
  return resolveVarRefs(replaced, env, depth + 1);
}

/**
 * The production constraint: after resolveColor's transformation (oklch→rgb
 * conversion, hex/rgb/hsl pass-through), d3-color must be able to parse the
 * value. Returns the post-transform value, or null if d3 rejects it.
 */
function throughProductionPath(rawValue: string): string | null {
  const transformed = resolveColor(rawValue);
  return d3color(transformed) === null ? null : transformed;
}

// ---------------------------------------------------------------------------

const cssPath = path.resolve(__dirname, '../../../index.css');
const cssSource = fs.readFileSync(cssPath, 'utf-8');
const blocks = parseCssBlocks(cssSource);

// Root token set: every matched custom property declared on :root (directly,
// via a `:root, [data-theme=...]` selector list, or hoisted from `@theme`).
// Later declarations win, like the cascade at equal specificity.
const rootTokens = new Map<string, string>();
// Per-theme overrides: tokens declared under each [data-theme="name"].
const themeTokens = new Map<string, Map<string, string>>();

for (const block of blocks) {
  const selectors = effectiveSelectors(block);
  const matched = [...block.decls].filter(([name]) => TOKEN_PATTERN.test(name));
  if (matched.length === 0) continue;
  for (const sel of selectors) {
    if (sel === ':root' || sel === 'html') {
      for (const [name, value] of matched) rootTokens.set(name, value);
    }
    const themeMatch = sel.match(/^\[data-theme="([^"]+)"\]$/);
    if (themeMatch) {
      const theme = themeMatch[1];
      if (!themeTokens.has(theme)) themeTokens.set(theme, new Map());
      const map = themeTokens.get(theme)!;
      for (const [name, value] of matched) map.set(name, value);
    }
  }
}

/** Effective env for var() resolution under a theme: override ?? root. */
function effectiveEnv(theme?: string): Map<string, string> {
  const env = new Map(rootTokens);
  if (theme) {
    for (const [name, value] of themeTokens.get(theme) ?? []) {
      env.set(name, value);
    }
  }
  return env;
}

describe('theme/chart color token contract (src/index.css)', () => {
  it('parses index.css into a non-trivial token set (harness sanity check)', () => {
    // Guard against the parser silently matching nothing after a refactor of
    // index.css — an empty scan would make every assertion below vacuous.
    expect(rootTokens.size).toBeGreaterThan(50);
    expect([...themeTokens.keys()]).toEqual(
      expect.arrayContaining(['default', 'elite']),
    );
    // Spot-check known tokens from each family/location.
    expect(rootTokens.has('--c-accent')).toBe(true); // :root,[data-theme="default"]
    expect(rootTokens.has('--color-chart-series-1')).toBe(true); // @layer base :root
    expect(rootTokens.has('--color-chart-money')).toBe(true);
    expect(rootTokens.has('--c-cat-orange')).toBe(true);
    expect(themeTokens.get('elite')!.has('--color-chart-series-1')).toBe(true);
  });

  it('every chart/semantic token declared in :root survives the production color path', () => {
    const env = effectiveEnv();
    const failures: string[] = [];
    for (const [name, raw] of rootTokens) {
      const value = resolveVarRefs(raw, env);
      if (throughProductionPath(value) === null) {
        failures.push(`${name}: "${raw}" -> resolveColor -> "${resolveColor(value)}" (d3-color cannot parse; charts render BLACK)`);
      }
    }
    expect(failures).toEqual([]);
  });

  for (const theme of [...themeTokens.keys()]) {
    describe(`[data-theme="${theme}"]`, () => {
      it('every token the theme declares survives the production color path', () => {
        const env = effectiveEnv(theme);
        const failures: string[] = [];
        for (const [name, raw] of themeTokens.get(theme)!) {
          const value = resolveVarRefs(raw, env);
          if (throughProductionPath(value) === null) {
            failures.push(`${name}: "${raw}" -> resolveColor -> "${resolveColor(value)}" (d3-color cannot parse; charts render BLACK)`);
          }
        }
        expect(failures).toEqual([]);
      });

      it('covers the full :root token set with a valid effective value (override or clean inheritance)', () => {
        // A theme may override a palette partially — that's fine as long as
        // every token's EFFECTIVE value (theme override ?? :root value) still
        // parses. This catches a theme overriding part of a palette with a
        // value the chart path can't handle.
        const overrides = themeTokens.get(theme)!;
        const env = effectiveEnv(theme);
        const failures: string[] = [];
        for (const [name, rootRaw] of rootTokens) {
          const raw = overrides.get(name) ?? rootRaw;
          const value = resolveVarRefs(raw, env);
          if (throughProductionPath(value) === null) {
            const source = overrides.has(name) ? 'theme override' : 'inherited from :root';
            failures.push(`${name} (${source}): "${raw}" -> "${resolveColor(value)}" is not d3-parseable`);
          }
        }
        expect(failures).toEqual([]);
      });
    });
  }
});
