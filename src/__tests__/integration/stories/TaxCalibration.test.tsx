/**
 * Future-year tax calibration (#61 Stage 1b). Opt-in: the % by which a
 * current-year override differs from the engine's computed tax is carried into
 * every future projected year, implemented as a multiplicative scale on the
 * marginal rates (exact bill scale, cash-safe). FICA excluded; year 0 keeps the
 * dollar override.
 */
import { describe, it, expect } from 'vitest';
import { AssumptionsState, defaultAssumptions, createBuiltinMilestones } from '../../../components/Objects/Assumptions/AssumptionsContext';
import { TaxState } from '../../../components/Objects/Taxes/TaxContext';
import { SavedAccount } from '../../../components/Objects/Accounts/models';
import { WorkIncome } from '../../../components/Objects/Income/models';
import { FoodExpense } from '../../../components/Objects/Expense/models';
import { runSimulation } from '../../../components/Objects/Assumptions/useSimulation';
import { assertAllYearsInvariants } from '../helpers/assertions';

const START_YEAR = new Date().getFullYear();
const BIRTH_YEAR = START_YEAR - 40;

const assumptions: AssumptionsState = {
    ...defaultAssumptions,
    demographics: {},
    milestones: createBuiltinMilestones(BIRTH_YEAR, 67, 90),
    income: { ...defaultAssumptions.income, salaryGrowth: 0 },
    macro: { ...defaultAssumptions.macro, inflationRate: 0, inflationAdjusted: false, taxBracketShiftPct: 0, taxBracketShiftStartYear: 0 },
    investments: { ...defaultAssumptions.investments, returnRates: { ror: 0 }, autoRothConversions: false },
    withdrawalStrategy: [],
};

const taxBase = (overrides: Partial<TaxState> = {}): TaxState => ({
    filingStatus: 'Single', stateResidency: 'Texas', deductionMethod: 'Standard',
    fedOverride: null, ficaOverride: null, stateOverride: null, year: START_YEAR, ...overrides,
});

function run(taxState: TaxState) {
    const account = new SavedAccount('acc', 'Cash', 50000, 0);
    const income = new WorkIncome('inc', 'Salary', 120000, 'Annually', 'Yes', 0, 0, 0, 0, '', null, 'FIXED', new Date(START_YEAR - 5, 0, 1), new Date(START_YEAR + 40, 11, 31));
    const living = new FoodExpense('exp', 'Living', 40000, 'Annually', new Date(START_YEAR - 5, 0, 1));
    return runSimulation(6, [account], [income], [living], assumptions, taxState).filter(s => !s.isEndOfYearProjection);
}

const fedAt = (sim: ReturnType<typeof run>, year: number) => sim.find(s => s.year === year)?.taxDetails?.fed ?? 0;

describe('tax calibration', () => {
    it('off by default: a fed override does not change future years', () => {
        const baseline = fedAt(run(taxBase()), START_YEAR + 2);
        const withOverrideNoCal = fedAt(run(taxBase({ fedOverride: 50000 })), START_YEAR + 2);
        expect(withOverrideNoCal).toBeCloseTo(baseline, 0);
    });

    it('on: future federal tax is scaled by override ÷ computed (exact, via rate-scale)', () => {
        const computed = fedAt(run(taxBase()), START_YEAR + 2);
        // Override the current year to ~1.5× the computed federal tax.
        const override = Math.round(computed * 1.5);
        const calibrated = fedAt(run(taxBase({ fedOverride: override, calibrateFutureYears: true })), START_YEAR + 2);
        // Flat income → computed_future == computed_base, so the scale lands exactly.
        expect(calibrated).toBeCloseTo(computed * 1.5, -1); // within ~$10
        expect(calibrated).toBeGreaterThan(computed);
    });

    it('year 0 keeps the exact dollar override regardless of calibration', () => {
        const computed = fedAt(run(taxBase()), START_YEAR + 2);
        const override = Math.round(computed * 1.5);
        const sim = run(taxBase({ fedOverride: override, calibrateFutureYears: true }));
        // Year 0 federal is the override exactly (snapshot), not the scaled value.
        expect(fedAt(sim, START_YEAR)).toBe(override);
    });

    it('guards a near-zero computed base (no blow-up)', () => {
        // calibrateFutureYears with no override set → factor 1, no change.
        const baseline = fedAt(run(taxBase()), START_YEAR + 2);
        const calNoOverride = fedAt(run(taxBase({ calibrateFutureYears: true })), START_YEAR + 2);
        expect(calNoOverride).toBeCloseTo(baseline, 0);
    });

    it('keeps the cash accounting balanced (the reason for the rate-scale approach)', () => {
        const computed = fedAt(run(taxBase()), START_YEAR + 2);
        const sim = run(taxBase({ fedOverride: Math.round(computed * 1.5), calibrateFutureYears: true }));
        // Because calibration is a parameter change (scaled rates), the higher
        // tax flows through every cash calc — no Sankey/net-worth imbalance.
        assertAllYearsInvariants(sim);
    });
});
