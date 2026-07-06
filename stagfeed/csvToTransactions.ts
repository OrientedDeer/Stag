/**
 * Shared stag-feed CSV → Stag Transactions parser.
 *
 * Both headless importers (importTransactions.ts, the file-based step-2 path, and
 * couchImport.ts, the live CouchDB step-4 path) convert stag-feed's
 * transactions.csv into Stag Transactions with the exact same date/amount/id
 * parse-and-skip rules. This module is the single source of that logic so the next
 * parsing-rule change lands on both paths at once — miss one and the headless vs
 * Couch importers would silently drop different rows.
 *
 * CRITICAL: keep this module free of TOP-LEVEL SIDE EFFECTS. importTransactions.ts
 * and couchImport.ts each fire a live run() at import time under vite-node; they're
 * imported by the test runner only for their pure helpers, so the shared logic must
 * NOT live in either of them. Importing this file must do nothing but define
 * functions.
 */
import { parseCSV } from '../src/services/CSVImportService';
import { makeTransaction } from '../src/services/backupMerge';
import type { Transaction } from '../src/components/Objects/Budget/BudgetTypes';

/** Locate a column by header name (case-insensitive, trimmed). */
function col(headers: string[], name: string): number {
    return headers.findIndex((h) => h.trim().toLowerCase() === name.toLowerCase());
}

/** Parse stag-feed's transactions.csv into Stag Transactions (id = SimpleFIN id). */
export function csvToTransactions(csvText: string): Transaction[] {
    const { headers, rows } = parseCSV(csvText);
    const idx = {
        date: col(headers, 'Date'),
        description: col(headers, 'Description'),
        amount: col(headers, 'Amount'),
        source: col(headers, 'Source'),
        id: col(headers, 'Id'),
        posted: col(headers, 'Posted'),
    };
    for (const [k, v] of Object.entries(idx)) {
        if (k === 'source' || k === 'posted') continue; // optional — older feeds omit these trailers
        if (v === -1) throw new Error(`transactions.csv is missing the "${k}" column`);
    }

    const out: Transaction[] = [];
    let skipped = 0;
    for (const r of rows) {
        // A blank Amount cell must be treated as unparseable, NOT $0: Number('')
        // is 0 (finite), so a blank would import as a real $0 transaction and the
        // id-dedup would then lock it in even when the feed re-sends the real
        // amount under the same id (#182). Guard the raw cell before Number().
        const rawAmount = (r[idx.amount] ?? '').trim();
        const amount = rawAmount === '' ? NaN : Number(rawAmount);
        const id = (r[idx.id] ?? '').trim();
        // Read date defensively: a short row (fewer cells than the Date column)
        // would make r[idx.date] undefined and .trim() throw — aborting the whole
        // import; a present-but-blank cell would build an Invalid Date and bucket
        // under 'NaN-NaN'. Guard before constructing.
        const date = (r[idx.date] ?? '').trim();
        if (!Number.isFinite(amount) || !id || !date) {
            skipped++;
            continue; // no stable id / unparseable amount / missing date — skip & report
        }
        // #163: the feed emits an empty Posted cell when the bank supplied no
        // separate posted date (Date already IS the posted date then); coerce
        // blank → undefined so makeTransaction stores nothing.
        const posted = idx.posted >= 0 ? (r[idx.posted] ?? '').trim() : '';
        out.push(
            makeTransaction({
                id, // SimpleFIN's stable txn id → exact dedup on re-fetch
                date, // 'YYYY-MM-DD' → local-midnight Date in makeTransaction
                description: r[idx.description] ?? '',
                amount,
                source: idx.source >= 0 ? r[idx.source] : undefined, // optional per-row card/account label
                postedDate: posted || undefined,
            }),
        );
    }
    if (skipped) console.warn(`  skipped ${skipped} row(s) with no id / unparseable amount`);
    return out;
}
