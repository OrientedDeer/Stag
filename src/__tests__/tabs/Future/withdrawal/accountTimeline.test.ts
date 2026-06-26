import { describe, it, expect } from 'vitest';
import { buildAccountTimeline } from '../../../../tabs/Future/withdrawal/accountTimeline';
import { InvestedAccount, AnyAccount } from '../../../../components/Objects/Accounts/models';
import { SimulationYear } from '../../../../services/simulation/types';
import { createBuiltinMilestones } from '../../../../components/Objects/Assumptions/AssumptionsContext';

// Birth in 2000 so age == year - 2000 (clean arithmetic in assertions).
const milestones = createBuiltinMilestones(2000);

/**
 * Build a minimal SimulationYear. `withdrawalDetail` is keyed by account NAME,
 * exactly as the simulation engine populates it (SimulationEngine writes
 * `withdrawalDetail[account.name]`). This is the crux of #142: the timeline
 * derivation must read the draw back out by NAME, not by id.
 */
function makeYear(
    year: number,
    accountSnapshots: { id: string; name: string; amount: number }[],
    withdrawalsByName: Record<string, number>,
): SimulationYear {
    return {
        year,
        accounts: accountSnapshots.map(s =>
            new InvestedAccount(s.id, s.name, s.amount, 0, 0, 0.1, 'Brokerage'),
        ) as AnyAccount[],
        cashflow: { withdrawalDetail: withdrawalsByName },
    } as unknown as SimulationYear;
}

describe('buildAccountTimeline (#142 regression — withdrawalDetail keyed by NAME)', () => {
    it('marks an account as tapped when it is drawn down (withdrawalDetail keyed by name)', () => {
        // id and name deliberately DIFFER so an id-keyed read would miss the draw.
        const acc = new InvestedAccount('acc-1', 'Brokerage', 100000, 0, 0, 0.1, 'Brokerage');

        const simulation: SimulationYear[] = [
            // 2040 (age 40): drawn but not yet empty.
            makeYear(2040, [{ id: 'acc-1', name: 'Brokerage', amount: 60000 }], { Brokerage: 40000 }),
            // 2041 (age 41): drawn and drained to ~$0 -> depleted here.
            makeYear(2041, [{ id: 'acc-1', name: 'Brokerage', amount: 0 }], { Brokerage: 60000 }),
        ];

        const timeline = buildAccountTimeline(simulation, [acc], milestones);
        const entry = timeline.get('acc-1');

        // Pre-fix (read by acc.id) the draw lookup returned undefined and these
        // were never set -> the UI showed "Not tapped within the plan".
        expect(entry?.tappedYear).toBe(2040);
        expect(entry?.tappedAge).toBe(40);
        expect(entry?.depletedYear).toBe(2041);
        expect(entry?.depletedAge).toBe(41);
        expect(entry?.depletedDrawAmount).toBe(60000);
        // Balance entering the depletion year (prior year's end-of-year balance).
        expect(entry?.depletedBalanceBefore).toBe(60000);
    });

    it('reports tapped-but-not-depleted when the account is drawn but never bottoms out', () => {
        const acc = new InvestedAccount('acc-2', 'Roth IRA', 200000, 0, 0, 0.1, 'Roth IRA');

        const simulation: SimulationYear[] = [
            makeYear(2050, [{ id: 'acc-2', name: 'Roth IRA', amount: 150000 }], { 'Roth IRA': 20000 }),
            makeYear(2051, [{ id: 'acc-2', name: 'Roth IRA', amount: 130000 }], { 'Roth IRA': 20000 }),
        ];

        const timeline = buildAccountTimeline(simulation, [acc], milestones);
        const entry = timeline.get('acc-2');

        expect(entry?.tappedYear).toBe(2050);
        expect(entry?.depletedYear).toBeUndefined();
    });

    it('leaves an untouched account untapped (no withdrawalDetail entry)', () => {
        const acc = new InvestedAccount('acc-3', 'Untouched', 50000, 0, 0, 0.1, 'Brokerage');

        const simulation: SimulationYear[] = [
            makeYear(2060, [{ id: 'acc-3', name: 'Untouched', amount: 50000 }], {}),
        ];

        const timeline = buildAccountTimeline(simulation, [acc], milestones);
        const entry = timeline.get('acc-3');

        expect(entry?.tappedYear).toBeUndefined();
        expect(entry?.depletedYear).toBeUndefined();
    });

    it('skips synthetic end-of-year projection rows', () => {
        const acc = new InvestedAccount('acc-4', 'Brokerage', 100000, 0, 0, 0.1, 'Brokerage');

        const realYear = makeYear(2070, [{ id: 'acc-4', name: 'Brokerage', amount: 80000 }], { Brokerage: 20000 });
        const projectionRow = {
            ...makeYear(2069, [{ id: 'acc-4', name: 'Brokerage', amount: 90000 }], { Brokerage: 10000 }),
            isEndOfYearProjection: true,
        } as SimulationYear;

        const timeline = buildAccountTimeline([projectionRow, realYear], [acc], milestones);
        const entry = timeline.get('acc-4');

        // The 2069 projection row is skipped, so the first real tap is 2070.
        expect(entry?.tappedYear).toBe(2070);
    });
});
