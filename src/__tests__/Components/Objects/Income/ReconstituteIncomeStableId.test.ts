/**
 * Producer-side root-cause fix: reconstituteIncome must mint a STABLE, UNIQUE id
 * when the deserialized income lacks one.
 *
 * QR/JSON imports (and very old backups) can carry incomes with no `id` field, so
 * extractBaseFields returns id="". Before the fix EVERY such income shared id="",
 * which corrupts every inc.id-keyed consumer:
 *   - CashflowDetailBuilder's per-income deferral map (userContributionsByIncome)
 *     is keyed by inc.id → a 401k feeder and a matchless side gig both id="" make
 *     the per-income loop read the feeder's split for BOTH, double-counting.
 *   - RSU/ESPP lot ids (RSU-LOT-{year}-{inc.id}-{idx}, LOT-{year}-{n}-{inc.id})
 *     collide across grants.
 *
 * Constraints the minted id must satisfy:
 *   (1) DETERMINISTIC across reconstitutions of the SAME data, so
 *       getSimulationInputHash (which serializes income.id) is identical across
 *       reloads — a random id would trip a spurious staleness banner.
 *   (2) UNIQUE across DISTINCT imported incomes.
 *   (3) Must not break QR/JSON round-trips or clobber a real provided id.
 */
import { describe, it, expect } from 'vitest';
import {
    reconstituteIncome,
    WorkIncome,
    type AnyIncome,
} from '../../../../components/Objects/Income/models';
import { getSimulationInputHash } from '../../../../services/simulationHash';
import { defaultAssumptions } from '../../../../components/Objects/Assumptions/AssumptionsContext';
import { defaultTaxState } from '../../../../components/Objects/Taxes/TaxContext';

// A serialized WorkIncome with NO id field (the QR/JSON-import / old-backup shape).
function serializedWork(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        className: 'WorkIncome',
        name: 'Engineer',
        amount: 200000,
        frequency: 'Annually',
        earned_income: 'Yes',
        preTax401k: 20000,
        matchAccountId: 'trad',
        startDate: '2020-01-01',
        ...overrides,
    };
}

describe('reconstituteIncome — stable unique id for id-less imports', () => {
    it('mints a non-empty id when the deserialized income has no id', () => {
        const inc = reconstituteIncome(serializedWork()) as WorkIncome;
        expect(inc).toBeInstanceOf(WorkIncome);
        expect(inc.id).toBeTruthy();
        expect(inc.id).not.toBe('');
    });

    it('is DETERMINISTIC: the same id-less data reconstitutes to the same id', () => {
        const a = reconstituteIncome(serializedWork())!;
        const b = reconstituteIncome(serializedWork())!;
        expect(a.id).toBe(b.id);
    });

    it('is UNIQUE: distinct id-less incomes (a 401k feeder + a matchless side gig) get different ids', () => {
        // The headline #1 case: a 401k job and a matchless side gig both imported
        // without an id. They must NOT collapse to the same id.
        const feeder = reconstituteIncome(serializedWork({ name: 'Main Job' }))!;
        const sideGig = reconstituteIncome(serializedWork({
            name: 'Side Gig',
            amount: 40000,
            matchAccountId: undefined, // matchless — no 401k destination
            preTax401k: 0,
        }))!;
        expect(feeder.id).not.toBe(sideGig.id);
        expect(feeder.id).toBeTruthy();
        expect(sideGig.id).toBeTruthy();
    });

    it('does NOT overwrite a real provided id', () => {
        const inc = reconstituteIncome(serializedWork({ id: 'INC-real-123' }))!;
        expect(inc.id).toBe('INC-real-123');
    });

    it('getSimulationInputHash is identical across two reconstitutions of the same imported data', () => {
        // Two distinct id-less incomes in one dataset; reconstitute the SAME bytes
        // twice (as two separate reloads would) and confirm the simulation-input
        // hash is byte-identical — the minted ids did not churn the hash.
        const raw = [
            serializedWork({ name: 'Main Job' }),
            serializedWork({ name: 'Side Gig', amount: 40000, matchAccountId: undefined, preTax401k: 0 }),
        ];

        const load = (): AnyIncome[] =>
            raw.map(reconstituteIncome).filter((x): x is AnyIncome => x !== null);

        const hashA = getSimulationInputHash([], load(), [], defaultAssumptions, defaultTaxState);
        const hashB = getSimulationInputHash([], load(), [], defaultAssumptions, defaultTaxState);
        expect(hashA).toBe(hashB);
    });

    it('round-trips a WorkIncome that already has an id unchanged (no regression)', () => {
        const inc = reconstituteIncome(serializedWork({ id: 'work-1' })) as WorkIncome;
        expect(inc.id).toBe('work-1');
        expect(inc.preTax401k).toBe(20000);
        expect(inc.matchAccountId).toBe('trad');
    });

    it('RSU/ESPP lot ids built from inc.id become unique as a consequence (distinct grants)', () => {
        // Two id-less RSU jobs → their minted ids differ, so RSU-LOT-{year}-{inc.id}-{idx}
        // no longer collides across the two grants.
        const a = reconstituteIncome(serializedWork({
            name: 'RSU Job A', rsuVestingSchedule: 'cliff-1yr', rsuGrantShares: 100, rsuAccountId: 'rsu',
        }))!;
        const b = reconstituteIncome(serializedWork({
            name: 'RSU Job B', amount: 150000, rsuVestingSchedule: 'cliff-1yr', rsuGrantShares: 200, rsuAccountId: 'rsu',
        }))!;
        expect(a.id).not.toBe(b.id);
    });
});
