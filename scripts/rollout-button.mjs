#!/usr/bin/env node
// Layer 3 rollout: convert standard <button> action elements to <Button>.
// Only static-className buttons matching the standard signature (a solid
// variant bg + rounded-lg + font-medium). Buttons can't nest, so the matching
// </button> is simply the next one. Open-tag end is found with a brace/quote
// aware scanner (so onClick={() => ...} doesn't fool it). Padding maps to size;
// odd paddings use size="none" (kept in className). tsc + tests are the net.
// Run with --apply (default: dry run); --file=PATH to limit.
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";

const APPLY = process.argv.includes("--apply");
const ONLY = process.argv.find((a) => a.startsWith("--file="))?.slice(7);
const EXCLUDE = /\/(tabs\/Budget|components\/Objects\/Budget|components\/Objects\/Expense)\/|ExpenseTab\.tsx$|\.test\.|__tests__|\/Primitives\/|\/Theme\//;

function tagEnd(s, lt) {
  let inStr = null, brace = 0;
  for (let i = lt + 1; i < s.length; i++) {
    const c = s[i];
    if (inStr) { if (c === inStr) inStr = null; continue; }
    if (c === '"' || c === "'" || c === "`") { inStr = c; continue; }
    if (c === "{") brace++;
    else if (c === "}") brace--;
    else if (c === ">" && brace === 0) return i;
  }
  return -1;
}

// classes each variant provides (stripped from the call-site className)
const PROVIDED = {
  primary: ["bg-accent", "hover:bg-accent-hover", "text-accent-contrast"],
  positive: ["bg-positive-solid", "text-white"],
  negative: ["bg-negative-solid", "text-white"],
  warning: ["bg-warning-solid", "text-white"],
  secondary: ["bg-surface-input", "text-white"],
  ghost: ["text-content-muted", "hover:text-white"],
};
const COMMON = ["rounded-lg", "font-medium", "transition-colors", "disabled:opacity-50", "disabled:cursor-not-allowed"];
const SOLID = ["bg-accent", "bg-positive-solid", "bg-negative-solid", "bg-warning-solid"];

function btnProps(cls) {
  const toks = cls.split(/\s+/).filter(Boolean);
  const set = new Set(toks);
  const hasSolid = SOLID.some((b) => set.has(b));
  let variant = set.has("bg-accent") ? "primary"
    : set.has("bg-positive-solid") ? "positive"
    : set.has("bg-negative-solid") ? "negative"
    : set.has("bg-warning-solid") ? "warning"
    : (set.has("bg-surface-input") && set.has("hover:bg-surface-hover") && set.has("text-white")) ? "secondary"
    : (!hasSolid && set.has("text-content-muted") && set.has("hover:bg-surface-overlay")) ? "ghost"
    : null;
  if (!variant) return null;
  if (!set.has("rounded-lg")) return null; // standard button shape only
  let size = set.has("px-5") && set.has("py-2.5") ? "lg"
    : set.has("px-4") && set.has("py-2") ? "md"
    : set.has("px-3") && set.has("py-1.5") ? "sm" : null;
  const strip = new Set([...COMMON, ...PROVIDED[variant]]);
  const sizeToks = {
    lg: ["px-5", "py-2.5"], md: ["px-4", "py-2", "text-sm"], sm: ["px-3", "py-1.5", "text-sm"],
  };
  const keep = [];
  for (const t of toks) {
    if (strip.has(t)) continue;
    if (t.startsWith("hover:bg-")) continue;
    if (size && sizeToks[size].includes(t)) continue;
    keep.push(t);
  }
  if (!size) size = "none";
  let attrs = `variant="${variant}"`;
  if (size !== "md") attrs += ` size="${size}"`;
  if (keep.length) attrs += ` className="${keep.join(" ")}"`;
  return attrs;
}

const files = execSync('git ls-files "src/*.tsx"', { encoding: "utf8" })
  .split("\n").filter(Boolean).filter((f) => !EXCLUDE.test("/" + f)).filter((f) => !ONLY || f === ONLY);

let total = 0, filesChanged = 0;
for (const file of files) {
  let s = readFileSync(file, "utf8");
  // collect conversions, apply in reverse so indices stay valid
  const edits = [];
  const openRe = /<button\b/g;
  let m;
  while ((m = openRe.exec(s))) {
    const lt = m.index;
    const end = tagEnd(s, lt);
    if (end === -1) continue;
    const open = s.slice(lt, end + 1);
    const cm = open.match(/\sclassName="([^"]*)"/);
    if (!cm) continue; // dynamic or no className
    const props = btnProps(cm[1]);
    if (!props) continue;
    const close = s.indexOf("</button>", end);
    if (close === -1) continue;
    const newOpen = "<Button" + open.slice(7).replace(cm[0], " " + props);
    edits.push({ lt, end, close, newOpen });
  }
  if (!edits.length) continue;
  for (const e of edits.reverse()) {
    s = s.slice(0, e.close) + "</Button>" + s.slice(e.close + 9);
    s = s.slice(0, e.lt) + e.newOpen + s.slice(e.end + 1);
  }
  // import
  if (/from ["'][^"']*Layout\/Primitives["']/.test(s)) {
    s = s.replace(/import \{([^}]*)\} from (["'][^"']*Layout\/Primitives["'])/, (mm, names, src) =>
      names.includes("Button") ? mm : `import {${names.replace(/\s*$/, "")}, Button } from ${src}`);
  } else {
    const rel = path.relative(path.dirname(file), "src/components/Layout/Primitives").replace(/\\/g, "/");
    const imp = `import { Button } from "${rel.startsWith(".") ? rel : "./" + rel}";`;
    // insert after the last COMPLETE import (its `from "...";` line), so a
    // multiline `import { ... } from "..."` isn't split.
    const last = [...s.matchAll(/^.*\bfrom\s+["'][^"']+["'];?\s*$/gm)].pop();
    const at = last.index + last[0].length;
    s = s.slice(0, at) + "\n" + imp + s.slice(at);
  }
  filesChanged++; total += edits.length;
  if (APPLY) writeFileSync(file, s);
}
console.log(APPLY ? "APPLIED" : "DRY RUN", `files: ${filesChanged}, buttons converted: ${total}`);
