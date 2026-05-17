#!/usr/bin/env node
/**
 * Summarize a React DevTools profile JSON (exported from the Profiler tab).
 *
 * Usage: node scripts/analyze-profile.cjs docs/profiling-data.MM-DD-YYYY.HH-MM-SS.json
 *
 * Resolves fiber IDs to component names from two sources:
 *   1) `commitData[*].updaters` — authoritative; the backend supplies
 *      displayName directly for components that dispatched in that commit.
 *   2) Initial-mount alignment trick — during commit 0, the backend adds
 *      fibers to the tree in the same order it adds their names to the
 *      string table, so `fiber N` is named by `strings[N - 1]` for every
 *      fiber introduced during the initial mount. This catches passive
 *      ancestors (Routes, RenderedRoute, PerformanceProfiler, etc.) that
 *      never appear in updaters because they don't dispatch.
 *
 * Why not parse later-commit ADD ops too? The 8-cell ADD child format
 *   `[1, fiberID, type, parentID, ownerID, ?, ?, ?]` works for commit 0,
 *   but the layout of fields [+5..+7] drifts in later commits in a way I
 *   haven't reverse-engineered — so we don't try. Fibers added later
 *   (like the Draggable rows) stay anonymous unless they show up as
 *   updaters.
 *
 * Outputs: top commits by duration with per-fiber self times, and a total-
 * self-time leaderboard. Use the leaderboard to spot recurring hotspots.
 */
const fs = require('fs');

const path = process.argv[2];
if (!path) {
    console.error('Usage: node analyze-profile.js <profile.json>');
    process.exit(1);
}

const data = JSON.parse(fs.readFileSync(path, 'utf8'));
const root = data.dataForRoots[0];
const commits = root.commitData;

const idToName = {};

// 1) Names from updaters (authoritative — backend supplies displayName directly).
commits.forEach(c => {
    (c.updaters || []).forEach(u => {
        if (u.id != null && u.displayName) idToName[u.id] = u.displayName;
    });
});

// 2) Names from the initial-mount operations stream via fiber/string
//    alignment: during commit 0 the backend appends each newly mounted
//    fiber's displayName to the string table in the same order fibers are
//    introduced, so `fiber N` is named by `strings[N - 1]`. Verified
//    empirically against known updaters (SimulationProvider=8,
//    AssumptionsProvider=13, WithdrawalTab=37, etc.).
function parseInitialMountNames() {
    const opsPerCommit = root.operations || [];
    if (!opsPerCommit[0]) return;
    const ops = opsPerCommit[0];
    if (ops.length < 3) return;
    const strings = [];
    const stringTableLen = ops[2];
    let i = 3;
    const stringEnd = i + stringTableLen;
    while (i < stringEnd) {
        const len = ops[i++];
        let s = '';
        for (let k = 0; k < len; k++) s += String.fromCharCode(ops[i++]);
        strings.push(s);
    }
    strings.forEach((s, idx) => {
        const fiberID = idx + 1;
        if (!idToName[fiberID]) idToName[fiberID] = s;
    });
}
parseInitialMountNames();

const summary = commits.map((c, idx) => {
    const selfMap = {};
    if (c.fiberSelfDurations) {
        for (const [fid, dur] of c.fiberSelfDurations) selfMap[fid] = dur;
    }
    return { idx, duration: c.duration, selfMap };
});

console.log(`Profile: ${path}`);
console.log(`Total commits: ${summary.length}`);
console.log(`Root displayName: ${root.displayName}`);

const top = [...summary].sort((a, b) => b.duration - a.duration).slice(0, 10);
console.log('\n=== TOP 10 COMMITS BY DURATION ===');
top.forEach(c => {
    console.log(`\ncommit#${c.idx} dur=${c.duration.toFixed(1)}ms`);
    const entries = Object.entries(c.selfMap)
        .map(([fid, dur]) => ({ fid: +fid, dur, name: idToName[fid] || `?${fid}` }));
    entries.sort((a, b) => b.dur - a.dur);
    entries.slice(0, 8).forEach(e => console.log(`  self ${e.dur.toFixed(1)}ms  [${e.fid}] ${e.name}`));
});

const totals = {};
summary.forEach(c => {
    Object.entries(c.selfMap).forEach(([fid, dur]) => {
        const name = idToName[fid] || `?${fid}`;
        const key = `${name}#${fid}`;
        totals[key] = (totals[key] || 0) + dur;
    });
});
console.log('\n=== TOP 25 BY TOTAL SELF TIME ===');
Object.entries(totals)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 25)
    .forEach(([k, d]) => console.log(`  ${d.toFixed(1)}ms  ${k}`));

const buckets = { '0-2': 0, '2-5': 0, '5-10': 0, '10-16': 0, '16-30': 0, '30-50': 0, '50-100': 0, '100+': 0 };
summary.forEach(c => {
    const d = c.duration;
    if (d < 2) buckets['0-2']++;
    else if (d < 5) buckets['2-5']++;
    else if (d < 10) buckets['5-10']++;
    else if (d < 16) buckets['10-16']++;
    else if (d < 30) buckets['16-30']++;
    else if (d < 50) buckets['30-50']++;
    else if (d < 100) buckets['50-100']++;
    else buckets['100+']++;
});
console.log('\n=== COMMIT DURATION HISTOGRAM ===');
Object.entries(buckets).forEach(([b, c]) => console.log(`  ${b.padEnd(7)}ms: ${c}`));

console.log(`\nFibers named: ${Object.keys(idToName).length}`);
