/**
 * Headless stag-feed importer — date round-trip + malformed-row guards.
 *
 * Covers three regressions in the file-based (importTransactions.ts) and live
 * CouchDB (couchImport.ts) importers:
 *
 *   1/2. Re-serializing the merged blob with a bare JSON.stringify() (no
 *        jsonDateReplacer) shifts every transaction date a day earlier on a
 *        UTC+ runner — reintroducing issue #73. Both importers must serialize
 *        through serializeBlob() (jsonDateReplacer) so the round-trip is an
 *        identity in every timezone.
 *   3.   csvToTransactions() must skip a row whose Date cell is missing (short
 *        row -> r[idx.date] is undefined -> .trim() throws and aborts the whole
 *        import) or blank (-> Invalid Date -> NaN-NaN month bucket), not crash
 *        or persist a corrupt transaction.
 *
 * The TZ is pinned to UTC+10 (Australia/Sydney) so the off-by-one is
 * deterministic regardless of the host clock. Dates are constructed only after
 * the TZ is set (in beforeAll), since new Date('...T00:00:00') is interpreted in
 * the TZ active at construction time.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import {
    csvToTransactions as csvToTransactionsFile,
    serializeBlob as serializeBlobFile,
} from './importTransactions';
import {
    csvToTransactions as csvToTransactionsCouch,
    serializeBlob as serializeBlobCouch,
    flagReasonCounts as flagReasonCountsCouch,
} from './couchImport';
import { flagReasonCounts as flagReasonCountsFile } from './importBalances';
import { csvToTransactions as csvToTransactionsShared } from './csvToTransactions';
import { applyTransactions, type BalanceFlag, type MergeBlob } from '../src/services/backupMerge';
import { parseDate } from '../src/components/Objects/modelUtils';

const HEADER = 'Date,Description,Amount,Source,Id';

/** Both importers ship an identical csvToTransactions; run every case on both. */
const variants = [
    { name: 'importTransactions.ts', csvToTransactions: csvToTransactionsFile, serializeBlob: serializeBlobFile },
    { name: 'couchImport.ts', csvToTransactions: csvToTransactionsCouch, serializeBlob: serializeBlobCouch },
];

let originalTZ: string | undefined;

beforeAll(() => {
    originalTZ = process.env.TZ;
    process.env.TZ = 'Australia/Sydney'; // UTC+10, no DST relevance for these dates
});

afterAll(() => {
    if (originalTZ === undefined) delete process.env.TZ;
    else process.env.TZ = originalTZ;
});

/** Minimal blob the merge helpers accept; applyTransactions creates months lazily. */
function emptyBlob(): MergeBlob {
    return { version: 2 } as MergeBlob;
}

// Both importers must delegate to the ONE shared parser (csvToTransactions.ts) so a
// future parsing-rule change can't land on one path and miss the other. Identity
// (not just behavioral equivalence) proves there's a single implementation.
it('both importers re-export the single shared csvToTransactions', () => {
    expect(csvToTransactionsFile).toBe(csvToTransactionsShared);
    expect(csvToTransactionsCouch).toBe(csvToTransactionsShared);
});

describe.each(variants)('$name — transaction date round-trip (issue #73)', ({ csvToTransactions, serializeBlob }) => {
    // A boundary date: local midnight 2026-06-03 in UTC+10 is 2026-06-02T14:00Z,
    // so the default UTC toISOString() reports the prior day — and the prior
    // budget MONTH when the date is the 1st.
    const csv = `${HEADER}\n2026-06-03,Coffee,-4.50,Card,tx-1\n2026-07-01,Rent,-2000,Card,tx-2`;

    it('serializeBlob (jsonDateReplacer) round-trips the calendar day with no shift', () => {
        const blob = emptyBlob();
        applyTransactions(blob, csvToTransactions(csv), { dedup: 'id' });

        // Round-trip through the importer's real serialization (JSON only; the
        // encrypt() layer is a transparent passthrough for date semantics).
        const reloaded: MergeBlob = JSON.parse(serializeBlob(blob));
        const txns = (reloaded.budget?.months ?? []).flatMap((m) => m.transactions ?? []);
        expect(txns).toHaveLength(2);

        const byId = Object.fromEntries(txns.map((t) => [t.id, parseDate(t.date)!]));
        // parseDate reads 'YYYY-MM-DD' locally — must match the source calendar day.
        expect(byId['tx-1'].getFullYear()).toBe(2026);
        expect(byId['tx-1'].getMonth()).toBe(5); // June (0-based)
        expect(byId['tx-1'].getDate()).toBe(3);
        // The boundary case: the 1st must stay in July, not slip to June 30.
        expect(byId['tx-2'].getMonth()).toBe(6); // July
        expect(byId['tx-2'].getDate()).toBe(1);
    });

    it('control: a bare JSON.stringify (no replacer) DOES shift the day — proving the bug serializeBlob fixes', () => {
        const blob = emptyBlob();
        applyTransactions(blob, csvToTransactions(csv), { dedup: 'id' });

        const reloaded: MergeBlob = JSON.parse(JSON.stringify(blob));
        const txns = (reloaded.budget?.months ?? []).flatMap((m) => m.transactions ?? []);
        const byId = Object.fromEntries(txns.map((t) => [t.id, parseDate(t.date)!]));
        // Without the replacer, the UTC ISO ('2026-06-02T14:00:00.000Z') reloads
        // as June 2 — the wrong day. (Documents the failure mode.)
        expect(byId['tx-1'].getDate()).toBe(2);
        expect(byId['tx-2'].getMonth()).toBe(5); // July 1 slipped back into June
        expect(byId['tx-2'].getDate()).toBe(30);
    });
});

describe.each(variants)('$name — malformed Date rows (issue #3)', ({ csvToTransactions }) => {
    it('skips a short row missing the Date cell instead of throwing (Mode A)', () => {
        // This row ends before the Date column position — r[idx.date] is undefined.
        // Move Date to the last column so a truncated row omits exactly it.
        const csv = `Description,Amount,Source,Id,Date\nCoffee,-4.50,Card,tx-1`; // 4 cells, no Date
        let txns;
        expect(() => {
            txns = csvToTransactions(csv);
        }).not.toThrow();
        expect(txns).toHaveLength(0);
    });

    it('skips a present-but-blank Date cell instead of bucketing under NaN-NaN (Mode B)', () => {
        const csv = `${HEADER}\n,Coffee,-4.50,Card,tx-1\n2026-06-03,Rent,-2000,Card,tx-2`;
        const txns = csvToTransactions(csv);
        // Only the well-formed row survives; the blank-date row is dropped.
        expect(txns).toHaveLength(1);
        expect(txns[0].id).toBe('tx-2');
        // And no Invalid Date sneaks through.
        for (const t of txns) expect(Number.isNaN(new Date(t.date).getTime())).toBe(false);
    });

    it('a blank-date row never creates a NaN-NaN month bucket on merge', () => {
        const csv = `${HEADER}\n,Coffee,-4.50,Card,tx-1\n2026-06-03,Rent,-2000,Card,tx-2`;
        const blob = emptyBlob();
        applyTransactions(blob, csvToTransactions(csv), { dedup: 'id' });
        const months = blob.budget?.months ?? [];
        for (const m of months) {
            expect(Number.isFinite(m.month)).toBe(true);
            expect(Number.isFinite(m.year)).toBe(true);
        }
        // Exactly the one valid June 2026 bucket.
        expect(months.map((m) => `${m.year}-${m.month}`)).toEqual(['2026-6']);
    });
});

// Both balance importers summarize flags as counts-by-reason for routine logs, so
// real account names / SimpleFIN keys (BalanceFlag.account) never reach stdout
// (journald/cron-mail/CI) in cleartext — only the non-sensitive reason enum and a
// count. Run the assertion on both copies of the helper (file + Couch path).
const flagReasonVariants = [
    { name: 'importBalances.ts', flagReasonCounts: flagReasonCountsFile },
    { name: 'couchImport.ts', flagReasonCounts: flagReasonCountsCouch },
];

describe.each(flagReasonVariants)('$name — flagReasonCounts is counts-only (no sensitive keys)', ({ flagReasonCounts }) => {
    it('tallies by reason and never surfaces the SimpleFIN account key', () => {
        const flagged: BalanceFlag[] = [
            { account: 'SECRET-KEY-Roth-IRA', reason: 'unmapped' },
            { account: 'SECRET-KEY-Checking', reason: 'unmapped' },
            { account: 'SECRET-KEY-Brokerage', reason: 'auto-matched' },
        ];
        const counts = flagReasonCounts(flagged);
        expect(counts).toEqual({ unmapped: 2, 'auto-matched': 1 });
        // The account keys must not leak into the summary (keys or values).
        const serialized = JSON.stringify(counts);
        expect(serialized).not.toContain('SECRET-KEY');
    });

    it('returns an empty tally for no flags', () => {
        expect(flagReasonCounts([])).toEqual({});
    });
});
