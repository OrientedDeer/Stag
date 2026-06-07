#!/usr/bin/env node
// Phase 1 theme migration — Pass 1: gray scale -> semantic tokens.
// Exact-shade mappings only, so the DEFAULT theme stays visually identical.
// Run with --apply to write; default is a dry run (counts only).
// Budget/Expense domains are excluded to avoid conflicts with the other
// in-progress branch.

import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const APPLY = process.argv.includes("--apply");

// prefix-of-longer-number trap: text-gray-50 vs text-gray-500 -> lookahead (?![0-9])
// leading (?<![\w-]) keeps us at a class-token boundary
const MAP = [
  ["bg-gray-950", "bg-surface-base"],
  ["bg-gray-900", "bg-surface-raised"],
  ["bg-gray-800", "bg-surface-overlay"],
  ["bg-gray-700", "bg-surface-input"],
  ["bg-gray-600", "bg-surface-hover"],
  ["text-gray-50", "text-content-strong"],
  ["text-gray-400", "text-content-muted"],
  ["text-gray-300", "text-content-default"],
  ["text-gray-500", "text-content-subtle"],
  ["border-gray-800", "border-border-subtle"],
  ["border-gray-700", "border-border-default"],
  ["border-gray-600", "border-border-strong"],
  // Pass 2: off-scale shades -> dedicated tokens (still 1:1 in default theme).
  ["text-gray-100", "text-content-bright"],
  ["text-gray-200", "text-content-emphasis"],
  ["text-gray-600", "text-content-faint"],
  ["bg-gray-500", "bg-surface-muted"],
  ["border-gray-500", "border-border-faint"],
  ["border-gray-400", "border-border-muted"],
  ["ring-gray-500", "ring-border-faint"],
  ["divide-gray-800", "divide-border-subtle"],
  ["placeholder-gray-500", "placeholder-content-subtle"],
  ["placeholder-gray-600", "placeholder-content-faint"],
];

const EXCLUDE = [
  /\/tabs\/Budget\//,
  /\/components\/Objects\/Budget\//,
  /\/components\/Objects\/Expense\//,
  /\/tabs\/Current\/ExpenseTab\.tsx$/,
  /\.test\.(t|j)sx?$/,
  /\/__tests__\//,
  /\/components\/Objects\/Theme\//, // already token-based
];

const files = execSync('git ls-files "src/*.tsx" "src/*.ts"', {
  cwd: process.cwd(),
  encoding: "utf8",
})
  .split("\n")
  .filter(Boolean)
  .filter((f) => !EXCLUDE.some((re) => re.test("/" + f)));

const counts = Object.fromEntries(MAP.map(([f]) => [f, 0]));
let filesTouched = 0;

for (const file of files) {
  let src = readFileSync(file, "utf8");
  const before = src;
  for (const [from, to] of MAP) {
    const re = new RegExp(`(?<![\\w-])${from}(?![0-9])`, "g");
    src = src.replace(re, () => {
      counts[from]++;
      return to;
    });
  }
  if (src !== before) {
    filesTouched++;
    if (APPLY) writeFileSync(file, src);
  }
}

const total = Object.values(counts).reduce((a, b) => a + b, 0);
console.log(APPLY ? "APPLIED" : "DRY RUN");
console.log(`files scanned: ${files.length}, files changed: ${filesTouched}`);
for (const [from, to] of MAP) console.log(`  ${counts[from].toString().padStart(4)}  ${from} -> ${to}`);
console.log(`  total replacements: ${total}`);
