#!/usr/bin/env node
// Phase 1 — Pass 5b: hardcoded SERIES/data hex -> themeable tokens.
// Most chart palettes are semantic (income=green, expense=red, tax=amber),
// so hexes map to semantic/cat tokens (sharing within a chart is correct).
// Keyed category maps that need all-distinct colors are handled separately.
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const APPLY = process.argv.includes("--apply");
const MAP = {
  "#10b981": "var(--color-chart-money)",
  "#6ee7b7": "var(--c-positive-bright)",
  "#a7f3d0": "var(--c-positive-bright)",
  "#22c55e": "var(--c-positive-soft)",
  "#4ade80": "var(--c-positive)",
  "#34d399": "var(--c-positive)",
  "#ef4444": "var(--c-negative-soft)",
  "#f87171": "var(--c-negative)",
  "#f43f5e": "var(--c-cat-fuchsia)",
  "#3b82f6": "var(--c-accent-soft)",
  "#60a5fa": "var(--c-info)",
  "#6366f1": "var(--c-cat-purple-soft)",
  "#8b5cf6": "var(--c-cat-purple-soft)",
  "#a855f7": "var(--c-cat-purple-soft)",
  "#a78bfa": "var(--c-cat-purple)",
  "#c084fc": "var(--c-cat-purple)",
  "#ec4899": "var(--c-cat-fuchsia-soft)",
  "#f472b6": "var(--c-cat-fuchsia)",
  "#fb7185": "var(--c-cat-fuchsia)",
  "#06b6d4": "var(--c-cat-cyan-soft)",
  "#22d3ee": "var(--c-cat-cyan)",
  "#2dd4bf": "var(--c-cat-cyan)",
  "#14b8a6": "var(--c-cat-cyan-soft)",
  "#f59e0b": "var(--c-warning-soft)",
  "#fbbf24": "var(--c-warning)",
  "#facc15": "var(--c-warning)",
  "#ca8a04": "var(--c-warning-solid)",
  "#d97706": "var(--c-warning-solid)",
  "#b45309": "var(--c-warning-strong)",
  "#f97316": "var(--c-cat-orange-soft)",
  "#fb923c": "var(--c-cat-orange)",
  "#a3e635": "var(--c-cat-lime)",
  "#a3a3a3": "var(--c-content-muted)",
  "#a0aec0": "var(--c-content-muted)",
  "#888888": "var(--c-content-subtle)",
};
const EXCLUDE = [
  /\/tabs\/Budget\//, /\/components\/Objects\/Budget\//, /\/components\/Objects\/Expense\//,
  /\/tabs\/Current\/ExpenseTab\.tsx$/, /\.test\.(t|j)sx?$/, /\/__tests__\//,
  /\/components\/Objects\/Theme\//,
];
const files = execSync('git ls-files "src/*.tsx" "src/*.ts"', { encoding: "utf8" })
  .split("\n").filter(Boolean).filter((f) => !EXCLUDE.some((re) => re.test("/" + f)));
const counts = {}; let touched = 0;
for (const file of files) {
  let src = readFileSync(file, "utf8");
  const before = src;
  for (const [hex, tok] of Object.entries(MAP)) {
    src = src.replace(new RegExp(hex, "gi"), () => { counts[hex] = (counts[hex] ?? 0) + 1; return tok; });
  }
  if (src !== before) { touched++; if (APPLY) writeFileSync(file, src); }
}
console.log(APPLY ? "APPLIED" : "DRY RUN", `files changed: ${touched}, total: ${Object.values(counts).reduce((a,b)=>a+b,0)}`);
