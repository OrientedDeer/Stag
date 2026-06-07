#!/usr/bin/env node
// Phase 1 theme migration — Pass 3: semantic STATE colors -> tokens.
//   green, emerald      -> positive
//   red                 -> negative
//   yellow, amber       -> warning
//   blue (solid)        -> accent / accent-hover   (actions/focus)
//   blue (text/translucent) -> info                 (informational)
//
// Tier map (shade -> token suffix) preserves the exact value for both solid
// and translucent uses, so the default theme stays 1:1 AND button base/hover
// shades stay distinct (600=solid, 700=strong). Opacity modifiers preserved.
// Categorical colors (orange/cyan/purple/...) are NOT touched here.
// Run with --apply to write; default is a dry run.

import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const APPLY = process.argv.includes("--apply");
const B = "(?<![\\w-])";
const PREFIXES = ["bg", "text", "border", "ring", "divide", "from", "to", "via", "fill", "stroke"];

// shade -> token suffix
function suffix(shade) {
  if (shade <= 300) return "-bright";
  if (shade === 400) return "";
  if (shade === 500) return "-soft";
  if (shade === 600) return "-solid";
  if (shade <= 800) return "-strong"; // 700, 800
  return "-tint"; // 900+
}

// blue solid -> accent scale (preserves base/hover: 500 soft, 600 base, 700 hover)
function accentSuffix(shade) {
  if (shade === 500) return "-soft";
  if (shade >= 700) return "-hover";
  return ""; // 600 (and rare <=400)
}

const rules = []; // [RegExp, fn(match, shade, op) -> string]

// Non-blue families: pure tier map across all prefixes.
for (const [color, role] of [
  ["green", "positive"],
  ["emerald", "positive"],
  ["red", "negative"],
  ["yellow", "warning"],
  ["amber", "warning"],
]) {
  for (const p of PREFIXES) {
    rules.push([
      new RegExp(`${B}${p}-${color}-(\\d{2,3})(\\/\\d+)?`, "g"),
      (_m, shade, op) => `${p}-${role}${suffix(+shade)}${op ?? ""}`,
    ]);
  }
}

// Blue: solid -> accent (action), text/translucent -> info.
rules.push(
  [new RegExp(`${B}text-blue-(\\d{2,3})(\\/\\d+)?`, "g"),
    (_m, s, op) => `text-info${+s <= 300 ? "-bright" : ""}${op ?? ""}`],
  // any translucent blue bg -> info-tint; solid -> accent / accent-hover
  [new RegExp(`${B}bg-blue-(\\d{2,3})\\/(\\d+)`, "g"),
    (_m, _s, o) => `bg-info-tint/${o}`],
  [new RegExp(`${B}bg-blue-(\\d{2,3})(?![\\d/])`, "g"),
    (_m, s) => `bg-accent${accentSuffix(+s)}`],
  [new RegExp(`${B}ring-blue-(\\d{2,3})(\\/\\d+)?`, "g"),
    (_m, s, op) => `ring-accent${accentSuffix(+s)}${op ?? ""}`],
  // translucent blue border -> info-strong; solid focus border -> accent scale
  [new RegExp(`${B}border-blue-(\\d{2,3})\\/(\\d+)`, "g"),
    (_m, _s, o) => `border-info-strong/${o}`],
  [new RegExp(`${B}border-blue-(\\d{2,3})(?![\\d/])`, "g"),
    (_m, s) => (+s >= 700 ? "border-info-strong" : `border-accent${accentSuffix(+s)}`)],
  [new RegExp(`${B}(fill|stroke)-blue-(\\d{2,3})(\\/\\d+)?`, "g"),
    (_m, p, _s, op) => `${p}-info${op ?? ""}`],
);

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
  for (const [re, fn] of rules) {
    src = src.replace(re, (...a) => { total++; return fn(...a); });
  }
  if (src !== before) { filesTouched++; if (APPLY) writeFileSync(file, src); }
}
console.log(APPLY ? "APPLIED" : "DRY RUN");
console.log(`files changed: ${filesTouched}, total replacements: ${total}`);

if (APPLY) {
  const residual = {};
  for (const file of files) {
    for (const m of readFileSync(file, "utf8").matchAll(
      /(?<![\w-])(?:bg|text|border|ring|divide|from|to|via|fill|stroke)-(green|emerald|red|yellow|amber|blue)-\d+(?:\/\d+)?/g,
    )) residual[m[0]] = (residual[m[0]] ?? 0) + 1;
  }
  const keys = Object.keys(residual);
  console.log(`residual state-color utilities: ${keys.length}`);
  for (const k of keys.sort((a, b) => residual[b] - residual[a])) console.log(`  ${residual[k]}  ${k}`);
}
