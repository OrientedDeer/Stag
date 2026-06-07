#!/usr/bin/env node
// Wrap each chart's Nivo <Responsive*> element in <ChartFrame> and drop the
// per-chart key={themeKey} (ChartFrame handles the remount). Self-closing
// element end found with a brace/quote-aware scanner. Run with --apply.
import { readFileSync, writeFileSync } from "node:fs";

const APPLY = process.argv.includes("--apply");
const FILES = [
  "src/components/Charts/AssetsStreamChart.tsx",
  "src/components/Charts/DebtStreamChart.tsx",
  "src/components/Charts/Networth.tsx",
  "src/components/Charts/FanChart.tsx",
  "src/components/Charts/ObjectsIcicleChart.tsx",
  "src/components/Charts/CashflowSankey.tsx",
  "src/components/Charts/AssetSunburst.tsx",
  "src/components/Charts/SpendingSunburst.tsx",
  "src/components/Charts/TaxBreakdownSunburst.tsx",
  "src/tabs/Future/tabs/OverviewTab.tsx",
  "src/tabs/Future/tabs/OverlaidChartView.tsx",
];

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

for (const file of FILES) {
  let s = readFileSync(file, "utf8");
  const before = s;

  // 1. import
  const rel = file.startsWith("src/components/Charts/")
    ? "./ChartFrame"
    : "../../../components/Charts/ChartFrame";
  if (!s.includes("ChartFrame")) {
    s = s.replace(
      /import \{ useChartTheme \} from ["'][^"']*useChartTheme["'];/,
      (m) => `${m}\nimport { ChartFrame } from "${rel}";`,
    );
  }

  // 2. destructure: drop themeKey
  s = s.replace("const { theme: themeKey, resolve } = useChartTheme();", "const { resolve } = useChartTheme();");

  // 3. find the Responsive element, wrap + clean key
  const m = s.match(/<Responsive[A-Za-z]+/);
  if (!m) { console.log(`SKIP (no Responsive): ${file}`); continue; }
  const start = m.index;
  const end = tagEnd(s, start);
  if (end === -1) { console.log(`SKIP (no end): ${file}`); continue; }
  let el = s.slice(start, end + 1);
  // direct key
  el = el.replace(/\n\s*key=\{themeKey\}/, "");
  // sunburst template key: drop the -${themeKey} segment
  el = el.replace(/-\$\{themeKey\}/, "");
  s = s.slice(0, start) + "<ChartFrame>" + el + "</ChartFrame>" + s.slice(end + 1);

  if (s !== before) {
    if (APPLY) writeFileSync(file, s);
    console.log(`${APPLY ? "wrote" : "would write"}: ${file}`);
  } else {
    console.log(`no change: ${file}`);
  }
}
