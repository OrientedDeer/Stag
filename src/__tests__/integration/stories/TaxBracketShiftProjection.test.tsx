/**
 * Bracket shift end-to-end: the projection's federal tax reflects
 * assumptions.macro.taxBracketShiftPct (a parameter change that flows through
 * getTaxParameters → the whole sim, including withdrawal gross-up sizing), and
 * the current year (year 0) stays current-law when the shift starts next year.
 */
import { describe, it, expect } from 'vitest';
import { AssumptionsState, defaultAssumptions, createBuiltinMilestones } from '../../../components/Objects/Assumptions/AssumptionsContext';
import { TaxState } from '../../../components/Objects/Taxes/TaxContext';
import { SavedAccount } from '../../../components/Objects/Accounts/models';
import { WorkIncome } from '../../../components/Objects/Income/models';
import { FoodExpense } from '../../../components/Objects/Expense/models';
import { runSimulation } from '../../../components/Objects/Assumptions/useSimulation';

const START_YEAR = new Date().getFullYear();
const BIRTH_YEAR = START_YEAR - 40;

const baseAssumptions: AssumptionsState = {
    ...defaultAssumptions,
    demographics: {},
    milestones: createBuiltinMilestones(BIRTH_YEAR, 67, 90),
    income: { ...defaultAssumptions.income, salaryGrowth: 0 },
    macro: { ...defaultAssumptions.macro, inflationRate: 0, inflationAdjusted: false, taxBracketShiftPct: 0, taxBracketShiftStartYear: 0 },
    investments: { ...defaultAssumptions.investments, returnRates: { ror: 0 }, autoRothConversions: false },
    withdrawalStrategy: [],
};

const taxState: TaxState = {
    filingStatus: 'Single', stateResidency: 'Texas', deductionMethod: 'Standard',
    fedOverride: null, ficaOverride: null, stateOverride: null, year: START_YEAR,
};

function run(assumptions: AssumptionsState) {
    const account = new SavedAccount('acc', 'Cash', 50000, 0);
    const income = new WorkIncome('inc', 'Salary', 120000, 'Annually', 'Yes', 0, 0, 0, 0, '', null, 'FIXED', new Date(START_YEAR - 5, 0, 1), new Date(START_YEAR + 40, 11, 31));
    const living = new FoodExpense('exp', 'Living', 40000, 'Annually', new Date(START_YEAR - 5, 0, 1));
    return runSimulation(6, [account], [income], [living], assumptions, taxState).filter(s => !s.isEndOfYearProjection);
}

const fedAt = (sim: ReturnType<typeof run>, year: number) => sim.find(s => s.year === year)?.taxDetails?.fed ?? 0;

describe('bracket shift in the projection', () => {
    it('raises future federal tax and leaves the current year current-law', () => {
        const baseline = run(baseAssumptions);
        const shifted = run({
            ...baseAssumptions,
            macro: { ...baseAssumptions.macro, taxBracketShiftPct: 10, taxBracketShiftStartYear: START_YEAR + 1 },
        });

        // Future federal tax is clearly higher under +10 points of rate.
        expect(fedAt(shifted, START_YEAR + 2)).toBeGreaterThan(fedAt(baseline, START_YEAR + 2) * 1.3);

        // The current year (year 0) is unchanged — the shift starts next year.
        expect(fedAt(shifted, START_YEAR)).toBeCloseTo(fedAt(baseline, START_YEAR), 0);
    });
});
