#!/usr/bin/env node
// Phase 1 theme migration — Pass 4: categorical colors -> cat-* tokens.
// orange/cyan/purple/fuchsia/lime/sky keep their distinct identity (each maps
// to its own cat-<color> token) but become themeable. Same value-preserving
// tier map as the semantic pass. Run with --apply (default: dry run).

import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const APPLY = process.argv.includes("--apply");
const B = "(?<![\\w-])";
const PREFIXES = ["bg", "text", "border", "ring", "divide", "from", "to", "via", "fill", "stroke"];
const COLORS = ["orange", "cyan", "purple", "fuchsia", "lime", "sky"];

function suffix(shade) {
  if (shade <= 300) return "-bright";
  if (shade === 400) return "";
  if (shade === 500) return "-soft";
  if (shade === 600) return "-solid";
  if (shade <= 800) return "-strong";
  return "-tint";
}

const rules = [];
for (const color of COLORS) {
  for (const p of PREFIXES) {
    rules.push([
      new RegExp(`${B}${p}-${color}-(\\d{2,3})(\\/\\d+)?`, "g"),
      (_m, shade, op) => `${p}-cat-${color}${suffix(+shade)}${op ?? ""}`,
    ]);
  }
}

const EXCLUDE = [
  /\/tabs\/Budget\//, /\/components\/Objects\/Budget\//, /\/components\/Objects\/Expense\//,
  /\/tabs\/Current\/ExpenseTab\.tsx$/, /\.test\.(t|j)sx?$/, /\/__tests__\//,
  /\/components\/Objects\/Theme\//,
];

const files = execSync('git ls-files "src/*.tsx" "src/*.ts"', { encoding: "utf8" })
  .split("\n").filter(Boolean).filter((f) => !EXCLUDE.some((re) => re.test("/" + f)));

let total = 0, filesTouched = 0;
for (const file of files) {
  let src = readFileSync(file, "utf8");
  const before = src;
  for (const [re, fn] of rules) src = src.replace(re, (...a) => { total++; return fn(...a); });
  if (src !== before) { filesTouched++; if (APPLY) writeFileSync(file, src); }
}
console.log(APPLY ? "APPLIED" : "DRY RUN");
console.log(`files changed: ${filesTouched}, total replacements: ${total}`);

if (APPLY) {
  const residual = {};
  for (const file of files) {
    for (const m of readFileSync(file, "utf8").matchAll(
      new RegExp(`(?<![\\w-])(?:${PREFIXES.join("|")})-(${COLORS.join("|")})-\\d+(?:\\/\\d+)?`, "g"),
    )) residual[m[0]] = (residual[m[0]] ?? 0) + 1;
  }
  console.log(`residual categorical utilities: ${Object.keys(residual).length}`);
  for (const k of Object.keys(residual)) console.log(`  ${residual[k]}  ${k}`);
}
