#!/usr/bin/env node
// Naive dumper: print every cell of operations[0] with its index, then mark
// known string IDs and fiber IDs we care about so the structure can be
// reverse-engineered by eye.

const fs = require('fs');
const path = process.argv[2];
const commitIndex = parseInt(process.argv[3] || '0', 10);
const data = JSON.parse(fs.readFileSync(path, 'utf8'));
const root = data.dataForRoots[0];
const ops = root.operations[commitIndex];

console.log(`Commit ${commitIndex}: total cells ${ops.length}`);

const rendererID = ops[0];
const rootID = ops[1];
const stringTableLen = ops[2];
console.log(`rendererID=${rendererID} rootID=${rootID} stringTableLen=${stringTableLen}`);

// Decode strings
const strings = [];
let i = 3;
const stringEnd = 3 + stringTableLen;
while (i < stringEnd) {
    const len = ops[i++];
    let s = '';
    for (let k = 0; k < len; k++) s += String.fromCharCode(ops[i++]);
    strings.push(s);
}
console.log(`Strings: ${strings.length}`);

// Now dump operations cell-by-cell with annotations
console.log(`\nRaw cells from index ${stringEnd}:\n`);
const annotate = (v) => {
    // Could be a fiber ID, a string ID, or a number
    const s = (v > 0 && v <= strings.length) ? `"${strings[v - 1]}"` : '';
    return `${v}${s ? ' ' + s : ''}`;
};

// Print 1 op + args per line, advancing by guessing
let j = stringEnd;
let opIdx = 0;
while (j < ops.length && opIdx < 200) {
    const opcode = ops[j];
    // Print this cell + next 9 with annotations
    let line = `[${j}] op=${opcode} | `;
    for (let k = 1; k <= 9 && j + k < ops.length; k++) {
        line += `[+${k}]=${annotate(ops[j + k])} `;
    }
    console.log(line);
    opIdx++;
    // Try various advance amounts based on opcode
    if (opcode === 1) {
        // ADD - try 8 cells in React 19 with env
        // Look at +1 to see id, +2 type
        const type = ops[j + 2];
        if (type === 11) j += 5; // root: id, type, supportsStrictMode, supportsTimeline?, supportsProfiling?
        else j += 8; // child: id, type, parent, owner, nameSID, keySID, envSID? + maybe more
    } else if (opcode === 4) {
        j += 3; // id, duration
    } else if (opcode === 2) {
        // REMOVE: count + ids — variable. Just step by 2 to keep things moving
        j += 2;
    } else if (opcode === 8) {
        j += 8;
    } else if (opcode === 7) {
        // errors/warnings: id + errors + warnings
        j += 4;
    } else if (opcode === 6) {
        j += 3;
    } else if (opcode === 3) {
        j += 3;
    } else if (opcode === 5) {
        j += 2;
    } else {
        // unknown — step by 1
        j += 1;
    }
}
