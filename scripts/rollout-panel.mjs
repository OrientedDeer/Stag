#!/usr/bin/env node
// Layer 3 rollout: convert static panel divs to <Panel>.
// Only touches `<div className="...bg-surface-raised...border-border-subtle...">`
// (className-only, static string). Dynamic/multi-attr panels are left for manual
// conversion. Matching close tag found by <div> depth counting. tsc + tests are
// the safety net. Run with --apply (default: dry run).
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";

const APPLY = process.argv.includes("--apply");
const ONLY = process.argv.find((a) => a.startsWith("--file="))?.slice(7);

const EXCLUDE = /\/(tabs\/Budget|components\/Objects\/Budget|components\/Objects\/Expense)\/|ExpenseTab\.tsx$|\.test\.|__tests__|\/Primitives\/|\/Theme\//;

function transformClass(cls) {
  let tokens = cls.split(/\s+/).filter(Boolean);
  let interactive = false;
  let padding = "md"; // p-4 is Panel's default
  const keep = [];
  for (const t of tokens) {
    if (t === "bg-surface-raised" || t === "border" || t === "border-border-subtle") continue;
    if (t === "rounded-xl" || t === "rounded-2xl") continue;
    if (t === "p-3") { padding = "sm"; continue; }
    if (t === "p-4") { padding = "md"; continue; }
    if (t === "p-6") { padding = "lg"; continue; }
    if (t === "hover:border-border-strong") { interactive = true; continue; }
    keep.push(t);
  }
  // if no base padding token was present, the panel had none
  if (!tokens.includes("p-3") && !tokens.includes("p-4") && !tokens.includes("p-6")) {
    padding = "none";
  }
  let props = "";
  if (padding !== "md") props += ` padding="${padding}"`;
  if (interactive) props += " interactive";
  if (keep.length) props += ` className="${keep.join(" ")}"`;
  return props;
}

// find index of </div> matching the open tag whose '>' is at openEnd-1
function matchClose(s, openEnd) {
  const re = /<div\b[^>]*?>|<\/div>/g;
  re.lastIndex = openEnd;
  let depth = 1, m;
  while ((m = re.exec(s))) {
    if (m[0] === "</div>") { if (--depth === 0) return m.index; }
    else if (!m[0].endsWith("/>")) depth++;
  }
  return -1;
}

const files = execSync('git ls-files "src/*.tsx"', { encoding: "utf8" })
  .split("\n").filter(Boolean).filter((f) => !EXCLUDE.test("/" + f))
  .filter((f) => !ONLY || f === ONLY);

let totalPanels = 0, filesChanged = 0;
const openRe = /<div className="([^"]*)">/g;

for (const file of files) {
  let s = readFileSync(file, "utf8");
  let changed = 0;
  // iterate: each pass converts the first remaining panel div
  for (;;) {
    openRe.lastIndex = 0;
    let m, found = null;
    while ((m = openRe.exec(s))) {
      const cls = m[1];
      if (cls.includes("bg-surface-raised") && cls.includes("border-border-subtle")) { found = m; break; }
    }
    if (!found) break;
    const openStart = found.index;
    const openEnd = found.index + found[0].length;
    const close = matchClose(s, openEnd);
    if (close === -1) break; // unbalanced; bail this file
    const props = transformClass(found[1]);
    s = s.slice(0, openStart) + `<Panel${props}>` + s.slice(openEnd, close) + "</Panel>" + s.slice(close + 6);
    changed++;
  }
  if (changed) {
    // inject import if missing
    if (!/from ["'][^"']*Layout\/Primitives["']/.test(s)) {
      const rel = path.relative(path.dirname(file), "src/components/Layout/Primitives").replace(/\\/g, "/");
      const imp = `import { Panel } from "${rel.startsWith(".") ? rel : "./" + rel}";\n`;
      const lastImport = [...s.matchAll(/^import .*$/gm)].pop();
      const at = lastImport.index + lastImport[0].length;
      s = s.slice(0, at) + "\n" + imp.trimEnd() + s.slice(at);
    } else {
      // add Panel to existing Primitives import if not present
      s = s.replace(/import \{([^}]*)\} from (["'][^"']*Layout\/Primitives["'])/, (mm, names, src) =>
        names.includes("Panel") ? mm : `import {${names.replace(/\s*$/, "")}, Panel } from ${src}`);
    }
    filesChanged++; totalPanels += changed;
    if (APPLY) writeFileSync(file, s);
  }
}
console.log(APPLY ? "APPLIED" : "DRY RUN", `files: ${filesChanged}, panels converted: ${totalPanels}`);
