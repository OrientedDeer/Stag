/**
 * Tax override scoping (#61 Stage 1a).
 *
 * Dollar tax overrides apply to the CURRENT year only. They used to be fed into
 * every projected year via the same TaxState; the projection's tax path only
 * actually honored the FICA override (federal/state in the sim come from
 * bracket math that ignores the overrides), so a FICA override pinned a flat
 * FICA across retirement years where earned income — and thus real FICA — is
 * ~$0. The engine now clears overrides for every future year; year 0 (the
 * snapshot) still reflects them.
 */
import { describe, it, expect } from 'vitest';
import { AssumptionsState, defaultAssumptions, createBuiltinMilestones } from '../../../components/Objects/Assumptions/AssumptionsContext';
import { TaxState } from '../../../components/Objects/Taxes/TaxContext';
import { SavedAccount } from '../../../components/Objects/Accounts/models';
import { WorkIncome } from '../../../components/Objects/Income/models';
import { FoodExpense } from '../../../components/Objects/Expense/models';
import { runSimulation } from '../../../components/Objects/Assumptions/useSimulation';

const START_YEAR = new Date().getFullYear();
const BIRTH_YEAR = START_YEAR - 40; // working, age 40

const assumptions: AssumptionsState = {
    ...defaultAssumptions,
    demographics: {},
    milestones: createBuiltinMilestones(BIRTH_YEAR, 67, 90),
    income: { ...defaultAssumptions.income, salaryGrowth: 0 },
    macro: { ...defaultAssumptions.macro, inflationRate: 0, inflationAdjusted: false },
    investments: { ...defaultAssumptions.investments, returnRates: { ror: 0 }, autoRothConversions: false },
    withdrawalStrategy: [],
};

const taxBase = (overrides: Partial<TaxState> = {}): TaxState => ({
    filingStatus: 'Single',
    stateResidency: 'Texas',
    deductionMethod: 'Standard',
    fedOverride: null,
    ficaOverride: null,
    stateOverride: null,
    year: START_YEAR,
    ...overrides,
});

function run(taxState: TaxState) {
    const account = new SavedAccount('acc-cash', 'Cash', 50000, 0);
    const income = new WorkIncome(
        'inc', 'Salary', 120000, 'Annually', 'Yes', 0, 0, 0, 0, '', null, 'FIXED',
        new Date(START_YEAR - 5, 0, 1), new Date(START_YEAR + 40, 11, 31),
    );
    const living = new FoodExpense('exp', 'Living', 40000, 'Annually', new Date(START_YEAR - 5, 0, 1));
    return runSimulation(6, [account], [income], [living], assumptions, taxState)
        .filter(s => !s.isEndOfYearProjection);
}

const ficaAt = (sim: ReturnType<typeof run>, year: number) =>
    sim.find(s => s.year === year)?.taxDetails?.fica ?? 0;

const FICA_OVERRIDE = 50000; // absurd for $120k earned income (~$8.5k real)

describe('tax override scoping', () => {
    it('future-year FICA is the computed amount, not the override (no flatten)', () => {
        const baseline = ficaAt(run(taxBase()), START_YEAR + 2);
        const withOverride = ficaAt(run(taxBase({ ficaOverride: FICA_OVERRIDE })), START_YEAR + 2);

        expect(baseline).toBeGreaterThan(5000);
        expect(baseline).toBeLessThan(15000); // ~$8.5k FICA on $120k
        // The override must NOT pin future FICA...
        expect(withOverride).toBeLessThan(15000);
        // ...future FICA equals the plain computed amount.
        expect(withOverride).toBeCloseTo(baseline, 0);
    });

    it('the current year (year 0) still reflects the FICA override', () => {
        const sim = run(taxBase({ ficaOverride: FICA_OVERRIDE }));
        expect(ficaAt(sim, START_YEAR)).toBe(FICA_OVERRIDE);
    });

    it('a federal override does not change the projection at all (it never reached it)', () => {
        // Documents the discovery: the sim computes federal from bracket math,
        // independent of fedOverride — so scoping it is a harmless no-op.
        const baseline = run(taxBase());
        const withFed = run(taxBase({ fedOverride: 99999 }));
        const fedAt = (s: ReturnType<typeof run>, y: number) => s.find(x => x.year === y)?.taxDetails?.fed ?? 0;
        expect(fedAt(withFed, START_YEAR + 2)).toBeCloseTo(fedAt(baseline, START_YEAR + 2), 0);
    });
});
