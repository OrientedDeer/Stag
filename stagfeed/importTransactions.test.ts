/**
 * Headless stag-feed importer — date round-trip + malformed-row + bump guards.
 *
 * Covers four regressions in the file-based (importTransactions.ts) and live
 * CouchDB (couchImport.ts) importers:
 *
 *   1/2. Re-serializing the merged blob with a bare JSON.stringify() (no
 *        jsonDateReplacer) shifts every transaction date a day earlier on a
 *        UTC+ runner — reintroducing issue #73. Both importers must serialize
 *        through the shared serializeBlob() (jsonDateReplacer) so the round-trip
 *        is an identity in every timezone.
 *   3.   csvToTransactions() must skip a row whose Date cell is missing (short
 *        row -> r[idx.date] is undefined -> .trim() throws and aborts the whole
 *        import) or blank (-> Invalid Date -> NaN-NaN month bucket), not crash
 *        or persist a corrupt transaction.
 *   4.   bumpLastImport() must advance the genuinely-newest saved CSV format even
 *        when some format carries a malformed/missing lastUsed (Invalid Date →
 *        NaN), instead of silently stamping the first element (#6).
 *
 * The TZ is pinned to UTC+10 (Australia/Sydney) so the off-by-one is
 * deterministic regardless of the host clock. Dates are constructed only after
 * the TZ is set (in beforeAll), since new Date('...T00:00:00') is interpreted in
 * the TZ active at construction time.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

import {
    csvToTransactions as csvToTransactionsFile,
    serializeBlob as serializeBlobFile,
} from './importTransactions';
import {
    csvToTransactions as csvToTransactionsCouch,
    serializeBlob as serializeBlobCouch,
    flagReasonCounts as flagReasonCountsCouch,
    bumpLastImport,
} from './couchImport';
import { flagReasonCounts as flagReasonCountsFile } from './importBalances';
import { csvToTransactions as csvToTransactionsShared } from './csvToTransactions';
import {
    flagReasonCounts as flagReasonCountsShared,
    serializeBlob as serializeBlobShared,
} from './importShared';
import { applyTransactions, type BalanceFlag, type MergeBlob } from '../src/services/backupMerge';
import { parseDate } from '../src/components/Objects/modelUtils';

const HEADER = 'Date,Description,Amount,Source,Id';

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

// Both importers must delegate to the ONE shared parser (csvToTransactions.ts) and
// the ONE shared serializer (importShared.ts) so a future rule change can't land on
// one path and miss the other. Identity (not just behavioral equivalence) proves a
// single implementation. flagReasonCounts is shared the same way across the two
// balance-writing importers.
it('both importers re-export the single shared csvToTransactions', () => {
    expect(csvToTransactionsFile).toBe(csvToTransactionsShared);
    expect(csvToTransactionsCouch).toBe(csvToTransactionsShared);
});

it('both importers re-export the single shared serializeBlob', () => {
    expect(serializeBlobFile).toBe(serializeBlobShared);
    expect(serializeBlobCouch).toBe(serializeBlobShared);
});

it('both balance importers re-export the single shared flagReasonCounts', () => {
    expect(flagReasonCountsFile).toBe(flagReasonCountsShared);
    expect(flagReasonCountsCouch).toBe(flagReasonCountsShared);
});

describe('serializeBlob — transaction date round-trip (issue #73)', () => {
    // A boundary date: local midnight 2026-06-03 in UTC+10 is 2026-06-02T14:00Z,
    // so the default UTC toISOString() reports the prior day — and the prior
    // budget MONTH when the date is the 1st.
    const csv = `${HEADER}\n2026-06-03,Coffee,-4.50,Card,tx-1\n2026-07-01,Rent,-2000,Card,tx-2`;

    it('serializeBlob (jsonDateReplacer) round-trips the calendar day with no shift', () => {
        const blob = emptyBlob();
        applyTransactions(blob, csvToTransactionsShared(csv), { dedup: 'id' });

        // Round-trip through the importer's real serialization (JSON only; the
        // encrypt() layer is a transparent passthrough for date semantics).
        const reloaded: MergeBlob = JSON.parse(serializeBlobShared(blob));
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
        applyTransactions(blob, csvToTransactionsShared(csv), { dedup: 'id' });

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

describe('csvToTransactions — malformed Date rows (issue #3)', () => {
    it('skips a short row missing the Date cell instead of throwing (Mode A)', () => {
        // This row ends before the Date column position — r[idx.date] is undefined.
        // Move Date to the last column so a truncated row omits exactly it.
        const csv = `Description,Amount,Source,Id,Date\nCoffee,-4.50,Card,tx-1`; // 4 cells, no Date
        let txns;
        expect(() => {
            txns = csvToTransactionsShared(csv);
        }).not.toThrow();
        expect(txns).toHaveLength(0);
    });

    it('skips a present-but-blank Date cell instead of bucketing under NaN-NaN (Mode B)', () => {
        const csv = `${HEADER}\n,Coffee,-4.50,Card,tx-1\n2026-06-03,Rent,-2000,Card,tx-2`;
        const txns = csvToTransactionsShared(csv);
        // Only the well-formed row survives; the blank-date row is dropped.
        expect(txns).toHaveLength(1);
        expect(txns[0].id).toBe('tx-2');
        // And no Invalid Date sneaks through.
        for (const t of txns) expect(Number.isNaN(new Date(t.date).getTime())).toBe(false);
    });

    it('a blank-date row never creates a NaN-NaN month bucket on merge', () => {
        const csv = `${HEADER}\n,Coffee,-4.50,Card,tx-1\n2026-06-03,Rent,-2000,Card,tx-2`;
        const blob = emptyBlob();
        applyTransactions(blob, csvToTransactionsShared(csv), { dedup: 'id' });
        const months = blob.budget?.months ?? [];
        for (const m of months) {
            expect(Number.isFinite(m.month)).toBe(true);
            expect(Number.isFinite(m.year)).toBe(true);
        }
        // Exactly the one valid June 2026 bucket.
        expect(months.map((m) => `${m.year}-${m.month}`)).toEqual(['2026-6']);
    });
});

// The shared flagReasonCounts summarizes flags as counts-by-reason for routine
// logs, so real account names / SimpleFIN keys (BalanceFlag.account) never reach
// stdout (journald/cron-mail/CI) in cleartext — only the non-sensitive reason enum
// and a count. Test the one shared implementation (both importers re-export it; the
// identity assertion above proves there's no second copy).
describe('flagReasonCounts is counts-only (no sensitive keys)', () => {
    it('tallies by reason and never surfaces the SimpleFIN account key', () => {
        const flagged: BalanceFlag[] = [
            { account: 'SECRET-KEY-Roth-IRA', reason: 'unmapped' },
            { account: 'SECRET-KEY-Checking', reason: 'unmapped' },
            { account: 'SECRET-KEY-Brokerage', reason: 'auto-matched' },
        ];
        const counts = flagReasonCountsShared(flagged);
        expect(counts).toEqual({ unmapped: 2, 'auto-matched': 1 });
        // The account keys must not leak into the summary (keys or values).
        const serialized = JSON.stringify(counts);
        expect(serialized).not.toContain('SECRET-KEY');
    });

    it('returns an empty tally for no flags', () => {
        expect(flagReasonCountsShared([])).toEqual({});
    });
});

// bumpLastImport advances the newest saved CSV format's lastUsed so the Budget tab's
// "Last import" indicator tracks the nightly headless run. A reduce with no initial
// value silently keeps the accumulator when comparisons are false — and a malformed
// lastUsed parses to Invalid Date (getTime() → NaN), making every NaN comparison
// false. So a bad lastUsed on any earlier-listed format used to leave the WRONG
// (first-listed) format stamped (#6). The fix coerces NaN to -Infinity so the
// genuinely-newest valid format always wins.
describe('bumpLastImport picks the newest valid saved format (issue #6)', () => {
    function blobWithFormats(formats: Array<{ name: string; lastUsed: unknown }>): MergeBlob {
        return {
            version: 2,
            budget: {
                importSettings: {
                    savedCSVFormats: formats.map((f, i) => ({
                        id: `fmt-${i}`,
                        name: f.name,
                        fingerprint: {},
                        mapping: {},
                        options: {},
                        lastUsed: f.lastUsed,
                        importCount: 0,
                        createdAt: new Date('2020-01-01'),
                    })),
                },
            },
        } as unknown as MergeBlob;
    }

    /** The format whose lastUsed was advanced to ~now is the one bumpLastImport chose. */
    function bumpedName(blob: MergeBlob): string | undefined {
        const formats = blob.budget!.importSettings!.savedCSVFormats!;
        const now = Date.now();
        const bumped = formats.filter((f) => Math.abs(new Date(f.lastUsed).getTime() - now) < 5000);
        expect(bumped).toHaveLength(1); // exactly one format was touched
        return bumped[0]?.name;
    }

    it('chooses the newest valid format when an EARLIER-listed format has a malformed lastUsed', () => {
        // "Old" is listed first (the reduce accumulator seed); "Bad" carries an
        // unparseable lastUsed; "New" is the genuinely-newest. Pre-fix, the NaN on
        // "Bad" made `New > Bad` false at that step and the first element stuck.
        const blob = blobWithFormats([
            { name: 'Old', lastUsed: '2024-01-01T00:00:00Z' },
            { name: 'Bad', lastUsed: 'not-a-date' },
            { name: 'New', lastUsed: '2026-06-20T00:00:00Z' },
        ]);
        bumpLastImport(blob);
        expect(bumpedName(blob)).toBe('New');
    });

    it('chooses the newest valid format when the FIRST-listed format has a malformed lastUsed', () => {
        const blob = blobWithFormats([
            { name: 'Bad', lastUsed: undefined },
            { name: 'Old', lastUsed: '2024-01-01T00:00:00Z' },
            { name: 'New', lastUsed: '2026-06-20T00:00:00Z' },
        ]);
        bumpLastImport(blob);
        expect(bumpedName(blob)).toBe('New');
    });

    it('no-ops cleanly when there are no saved formats', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        expect(() => bumpLastImport(emptyBlob())).not.toThrow();
        warn.mockRestore();
    });
});
