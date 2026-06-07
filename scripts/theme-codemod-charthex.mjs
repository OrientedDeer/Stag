#!/usr/bin/env node
// Phase 1 theme migration — Pass 5a: hardcoded NEUTRAL hex (chart chrome:
// axis text, gridlines, tooltip bg, etc.) -> CSS var tokens. SVG/Nivo theme
// values resolve var() at render time. Exact-value maps -> default look 1:1.
// Series-color hexes are handled separately. Run with --apply (default: dry).

import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const APPLY = process.argv.includes("--apply");

// neutral/gray hex -> token (exact Tailwind values)
const MAP = {
  "#f9fafb": "var(--c-content-strong)",
  "#f3f4f6": "var(--c-content-bright)",
  "#e5e7eb": "var(--c-content-emphasis)",
  "#d1d5db": "var(--c-content-default)",
  "#9ca3af": "var(--c-content-muted)",
  "#6b7280": "var(--c-content-subtle)",
  "#4b5563": "var(--c-border-strong)",
  "#374151": "var(--c-border-default)",
  "#1f2937": "var(--c-surface-overlay)",
  "#111827": "var(--c-surface-raised)",
  "#030712": "var(--c-surface-base)",
  // near-black slates/zincs used for tooltip bg -> closest surface
  "#18181b": "var(--c-surface-raised)",
  "#1a202c": "var(--c-surface-raised)",
  // slate variants used as light text -> closest content
  "#cbd5e1": "var(--c-content-default)",
  "#e2e8f0": "var(--c-content-emphasis)",
};

const EXCLUDE = [
  /\/tabs\/Budget\//, /\/components\/Objects\/Budget\//, /\/components\/Objects\/Expense\//,
  /\/tabs\/Current\/ExpenseTab\.tsx$/, /\.test\.(t|j)sx?$/, /\/__tests__\//,
  /\/components\/Objects\/Theme\//, /\/index\.css$/,
];

const files = execSync('git ls-files "src/*.tsx" "src/*.ts"', { encoding: "utf8" })
  .split("\n").filter(Boolean).filter((f) => !EXCLUDE.some((re) => re.test("/" + f)));

const counts = {};
let filesTouched = 0;
for (const file of files) {
  let src = readFileSync(file, "utf8");
  const before = src;
  for (const [hex, tok] of Object.entries(MAP)) {
    const re = new RegExp(hex, "gi");
    src = src.replace(re, () => { counts[hex] = (counts[hex] ?? 0) + 1; return tok; });
  }
  if (src !== before) { filesTouched++; if (APPLY) writeFileSync(file, src); }
}
console.log(APPLY ? "APPLIED" : "DRY RUN");
console.log(`files changed: ${filesTouched}`);
for (const [h, t] of Object.entries(MAP)) if (counts[h]) console.log(`  ${counts[h]}  ${h} -> ${t}`);
console.log(`  total: ${Object.values(counts).reduce((a, b) => a + b, 0)}`);
