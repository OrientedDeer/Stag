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
import {
    flagReasonCounts as flagReasonCountsFile,
    serializeBlob as serializeBlobBalances,
} from './importBalances';
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

it('all three blob-writing importers re-export the single shared serializeBlob', () => {
    expect(serializeBlobFile).toBe(serializeBlobShared);
    expect(serializeBlobCouch).toBe(serializeBlobShared);
    // The balances importer used to re-serialize with a bare JSON.stringify(blob).
    // Its blob is a pure JSON tree (no live Date), so that produced identical bytes
    // here — but routing through the shared serializeBlob keeps all importers in
    // lockstep with the in-app backup path, so a future change can't land on the
    // transaction/Couch paths and silently miss the balances one. This identity is
    // the real guard: reverting importBalances to a bare JSON.stringify breaks it.
    expect(serializeBlobBalances).toBe(serializeBlobShared);
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

describe('importBalances serializeBlob — string-date snapshots survive the re-encrypt', () => {
    // The balances importer re-encrypts the merged blob through its re-exported
    // serializeBlob(). Its blob is a pure JSON tree (JSON.parse of the decrypted
    // backup) mutated only by applyBalances, which writes string `{date,num}`
    // amountHistory snapshots and numeric amounts — it never creates a live Date.
    // So there's no Date for jsonDateReplacer to convert here, and serializeBlob is
    // byte-identical to JSON.stringify on this path. The genuine protection is the
    // identity assertion above (serializeBlobBalances === serializeBlobShared); this
    // block just confirms the string-date snapshots the importer actually produces
    // round-trip through that shared serializer with no day shift. (Fabricating a
    // `new Date()` field the importer never emits would assert nothing about the
    // real path — only re-exercise the helper.)

    // A boundary date: the 1st of a month is where any stray UTC shift would slip
    // into the prior month, so it's the strictest passthrough check.
    function blobWithBalanceSnapshot(): MergeBlob {
        return {
            version: 2,
            // The exact shape applyBalances writes: a date-only STRING + numeric num.
            amountHistory: {
                'acct-1': [{ date: '2026-06-01', num: 12345 }],
            },
        } as unknown as MergeBlob;
    }

    it('round-trips the snapshot string date unchanged through the shared serializer', () => {
        const reloaded = JSON.parse(serializeBlobBalances(blobWithBalanceSnapshot())) as MergeBlob;
        const point = reloaded.amountHistory!['acct-1'][0];
        // parseDate reads 'YYYY-MM-DD' locally — assert calendar components, not a
        // TZ-derived literal, so the test is offset-agnostic if the pinned TZ moves.
        const d = parseDate(point.date)!;
        expect(d.getFullYear()).toBe(2026);
        expect(d.getMonth()).toBe(5); // June (0-based) — never slips to May
        expect(d.getDate()).toBe(1);
        expect(point.num).toBe(12345);
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

// #163: the feed appends a trailing Posted column (bank posted/settled date)
// after Id. Statements cut on posting, so Stag stores it as
// Transaction.postedDate; the parser must tolerate the column being absent
// (older feed) and blank (bank sent no separate posted date — Date already IS
// the posted date then, and Stag's consumers fall back to `date`).
describe('csvToTransactions — trailing Posted column (#163)', () => {
    const HEADER_POSTED = `${HEADER},Posted`;

    it('parses Posted into postedDate; blank cell and posted==date store nothing', () => {
        const csv = `${HEADER_POSTED}\n`
            + `2026-06-30,Seat fee,-30,Card,tx-1,2026-07-02\n` // swipe/post straddle
            + `2026-07-03,Coffee,-4.50,Card,tx-2,\n`           // bank sent no posted
            + `2026-07-05,Lunch,-12,Card,tx-3,2026-07-05`;     // posted == date: no info
        const txns = csvToTransactionsShared(csv);
        expect(txns).toHaveLength(3);
        const [straddle, blank, same] = txns;
        expect((straddle.postedDate as Date).getMonth()).toBe(6); // July, local midnight
        expect((straddle.postedDate as Date).getDate()).toBe(2);
        expect(blank.postedDate).toBeUndefined();
        expect(same.postedDate).toBeUndefined();
    });

    it('tolerates an older feed CSV without the Posted column', () => {
        const csv = `${HEADER}\n2026-06-30,Seat fee,-30,Card,tx-1`;
        const txns = csvToTransactionsShared(csv);
        expect(txns).toHaveLength(1);
        expect(txns[0].postedDate).toBeUndefined();
    });

    it('a re-fetch backfills postedDate into a previously-merged blob row', () => {
        const blob = emptyBlob();
        // First fetch: not yet posted.
        applyTransactions(blob, csvToTransactionsShared(`${HEADER_POSTED}\n2026-06-30,Seat fee,-30,Card,tx-1,`), { dedup: 'id' });
        // Re-fetch a few days later: same id, posted date now known.
        const report = applyTransactions(blob, csvToTransactionsShared(`${HEADER_POSTED}\n2026-06-30,Seat fee,-30,Card,tx-1,2026-07-02`), { dedup: 'id' });
        expect(report.added).toBe(0);
        expect(report.postedDatesBackfilled).toBe(1);
        const row = blob.budget!.months.flatMap(m => m.transactions).find(t => t.id === 'tx-1')!;
        expect((row.postedDate as Date).getDate()).toBe(2);
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
