/**
 * Scheduled state move end-to-end (#61 Stage 3): a "move to Texas in year Y"
 * tax event drops state tax to $0 from that year on, while earlier projected
 * years keep paying the origin state's tax.
 */
import { describe, it, expect } from 'vitest';
import { type AssumptionsState, defaultAssumptions, createBuiltinMilestones } from '../../../components/Objects/Assumptions/AssumptionsContext';
import { type TaxState } from '../../../components/Objects/Taxes/TaxContext';
import { SavedAccount } from '../../../components/Objects/Accounts/models';
import { WorkIncome } from '../../../components/Objects/Income/models';
import { FoodExpense } from '../../../components/Objects/Expense/models';
import { runSimulation } from '../../../components/Objects/Assumptions/useSimulation';

const START_YEAR = new Date().getFullYear();
const BIRTH_YEAR = START_YEAR - 40;
const MOVE_YEAR = START_YEAR + 3;

const assumptions: AssumptionsState = {
    ...defaultAssumptions,
    demographics: {},
    milestones: createBuiltinMilestones(BIRTH_YEAR, 67, 90),
    income: { ...defaultAssumptions.income, salaryGrowth: 0 },
    macro: { ...defaultAssumptions.macro, inflationRate: 0, inflationAdjusted: false },
    investments: { ...defaultAssumptions.investments, returnRates: { ror: 0 }, autoRothConversions: false },
    withdrawalStrategy: [],
};

const taxState: TaxState = {
    filingStatus: 'Single', stateResidency: 'California', deductionMethod: 'Standard',
    fedOverride: null, ficaOverride: null, stateOverride: null, year: START_YEAR,
    taxEvents: [{ id: 'move', kind: 'stateResidency', value: 'Texas', year: MOVE_YEAR }],
};

function run(ts: TaxState) {
    const account = new SavedAccount('acc', 'Cash', 50000, 0);
    const income = new WorkIncome('inc', 'Salary', 120000, 'Annually', 'Yes', 0, 0, 0, 0, '', null, 'FIXED', new Date(START_YEAR - 5, 0, 1), new Date(START_YEAR + 40, 11, 31));
    const living = new FoodExpense('exp', 'Living', 40000, 'Annually', new Date(START_YEAR - 5, 0, 1));
    return runSimulation(8, [account], [income], [living], assumptions, ts).filter(s => !s.isEndOfYearProjection);
}

const stateAt = (sim: ReturnType<typeof run>, year: number) => sim.find(s => s.year === year)?.taxDetails?.state ?? 0;

describe('scheduled state move', () => {
    it('pays origin-state tax before the move and $0 after', () => {
        const sim = run(taxState);
        // California taxes income — before the move there is state tax.
        expect(stateAt(sim, MOVE_YEAR - 1)).toBeGreaterThan(0);
        // From the move year, Texas → no state income tax.
        expect(stateAt(sim, MOVE_YEAR)).toBe(0);
        expect(stateAt(sim, MOVE_YEAR + 2)).toBe(0);
    });

    it('without the event, state tax persists every year', () => {
        const noMove: TaxState = { ...taxState, taxEvents: [] };
        const sim = run(noMove);
        expect(stateAt(sim, MOVE_YEAR)).toBeGreaterThan(0);
    });
});
