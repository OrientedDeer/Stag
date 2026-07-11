import { describe, it, expect } from 'vitest';
import { type TaxState } from '../../components/Objects/Taxes/TaxContext';
import {
    type AssumptionsState,
    defaultAssumptions,
    createBuiltinMilestones,
} from '../../components/Objects/Assumptions/AssumptionsContext';
import {
    calculateStateTax,
    calculateUnifiedStateTax,
    calculateFederalTaxFromIncomes,
} from '../../components/Objects/Taxes/TaxService';
import { WorkIncome, CurrentSocialSecurityIncome, type AnyIncome } from '../../components/Objects/Income/models';
import { MortgageExpense, type AnyExpense } from '../../components/Objects/Expense/models';

/**
 * CHARACTERIZATION tests for PR #55 review fixes #7, #8, #11.
 *
 * These pin the EXACT numeric outputs of calculateStateTax /
 * calculateUnifiedStateTax / calculateFederalTaxFromIncomes for a spread of
 * states, ages, filing statuses, deduction methods, and SS presence. They must
 * pass BEFORE the refactor (against the original code) and remain green AFTER —
 * the refactor must be behavior-preserving (byte-identical numbers).
 */

// --- HELPERS (mirror the existing tax test fixtures) ---

const createTaxState = (overrides: Partial<TaxState> = {}): TaxState => ({
    filingStatus: 'Single',
    stateResidency: 'Texas',
    deductionMethod: 'Standard',
    fedOverride: null,
    ficaOverride: null,
    stateOverride: null,
    year: 2024,
    ...overrides,
});

const noInflationAssumptions: AssumptionsState = {
    ...defaultAssumptions,
    macro: {
        ...defaultAssumptions.macro,
        inflationAdjusted: false,
        inflationRate: 0,
    },
};

// Born 1959 -> age 65 in tax year 2024 (exercises senior-deduction doubling for MFJ)
const seniorAssumptions: AssumptionsState = {
    ...noInflationAssumptions,
    milestones: createBuiltinMilestones(1959, 1, 15),
};

const work = (amount: number) =>
    new WorkIncome('w1', 'Job', amount, 'Annually', 'Yes', 0, 0, 0, 0, 'acc1', 'Traditional 401k', 'FIXED', new Date('2020-01-01'));

const ss = (annual: number) =>
    new CurrentSocialSecurityIncome('ss1', 'SS', annual, 'Annually', new Date('2020-01-01'));

const itemizedMortgage = () => {
    const m = new MortgageExpense('m1', 'Home', 'Monthly', 500000, 400000, 400000, 3, 30, 1.2, 0, 1, 100, 0.3, 0, 50, 'Itemized', 0.8, 'a1', new Date(2020, 0, 1));
    m.loan_balance = m.getBalanceAtDate('2024-01-02');
    return m;
};

// =============================================================================
// calculateStateTax — pinned outputs across the matrix
// =============================================================================
describe('PR55 #7/#11: calculateStateTax characterization', () => {
    it('California, no SS, Standard (2025)', () => {
        const s = createTaxState({ stateResidency: 'California' });
        // #192: re-pinned 5,327 -> 5,207.98 when the CA "2025" row was corrected
        // from CA's 2024 schedule to FTB's real 2025 figures ($5,706 std ded).
        expect(calculateStateTax(s, [work(100000)], [], 2025, noInflationAssumptions)).toBeCloseTo(5207.98, 0);
    });

    it('DC, no SS, Standard', () => {
        const s = createTaxState({ stateResidency: 'DC' });
        expect(calculateStateTax(s, [work(100000)], [], 2024, noInflationAssumptions)).toBeCloseTo(5659, 4);
    });

    it('Texas, no SS, Standard (no income tax)', () => {
        const s = createTaxState({ stateResidency: 'Texas' });
        expect(calculateStateTax(s, [work(100000)], [], 2024, noInflationAssumptions)).toBe(0);
    });

    it('Virginia, age 66 MFJ senior doubling, no SS, Standard', () => {
        const s = createTaxState({ stateResidency: 'Virginia', filingStatus: 'Married Filing Jointly' });
        // #192: re-pinned 3,135 -> 4,515 — VA's age deduction phases out
        // $1-for-$1 above $75k married AFAGI; at $100k it is fully phased out
        // (24,000 - 25,000 < 0), so only the $17k standard deduction applies.
        expect(calculateStateTax(s, [work(100000)], [], 2024, seniorAssumptions)).toBeCloseTo(4515, 4);
    });

    it('Virginia, age 66 Single senior, no SS, Standard', () => {
        const s = createTaxState({ stateResidency: 'Virginia' });
        // #192: re-pinned 4,313.75 -> 5,003.75 — the $12k age deduction is fully
        // phased out at $100k AFAGI ($0 from $62k up for a single filer).
        expect(calculateStateTax(s, [work(100000)], [], 2024, seniorAssumptions)).toBeCloseTo(5003.75, 4);
    });

    it('Virginia, with SS (exempt), Standard', () => {
        const s = createTaxState({ stateResidency: 'Virginia' });
        expect(calculateStateTax(s, [work(50000), ss(30000)], [], 2024, noInflationAssumptions)).toBeCloseTo(2128.75, 4);
    });

    it('DC, with SS (exempt) === DC taxed on work-only base', () => {
        const s = createTaxState({ stateResidency: 'DC' });
        const ref = calculateStateTax(createTaxState({ stateResidency: 'DC' }), [work(60000)], [], 2024, noInflationAssumptions);
        expect(calculateStateTax(s, [work(60000), ss(30000)], [], 2024, noInflationAssumptions)).toBeCloseTo(ref, 6);
    });

    it('DC, no SS, Itemized vs Standard vs Auto', () => {
        const m = [itemizedMortgage()];
        const std = calculateStateTax(createTaxState({ stateResidency: 'DC', deductionMethod: 'Standard' }), [work(100000)], m, 2024, noInflationAssumptions);
        const item = calculateStateTax(createTaxState({ stateResidency: 'DC', deductionMethod: 'Itemized' }), [work(100000)], m, 2024, noInflationAssumptions);
        const auto = calculateStateTax(createTaxState({ stateResidency: 'DC', deductionMethod: 'Auto' }), [work(100000)], m, 2024, noInflationAssumptions);
        expect(auto).toBe(Math.min(std, item));
        expect(std).toBeCloseTo(5659, 4);
    });
});

// =============================================================================
// calculateUnifiedStateTax(..., additionalOrdinaryIncome=0, ...) must equal
// calculateStateTax for the same inputs (the #7 delegation contract).
// =============================================================================
describe('PR55 #7: calculateUnifiedStateTax(...,0,...) === calculateStateTax', () => {
    const cases: Array<{ name: string; state: Partial<TaxState>; incomes: () => AnyIncome[]; expenses: () => AnyExpense[]; year: number; a: AssumptionsState }> = [
        { name: 'California Standard no SS', state: { stateResidency: 'California' }, incomes: () => [work(100000)], expenses: () => [], year: 2025, a: noInflationAssumptions },
        { name: 'DC Standard no SS', state: { stateResidency: 'DC' }, incomes: () => [work(100000)], expenses: () => [], year: 2024, a: noInflationAssumptions },
        { name: 'Texas no tax', state: { stateResidency: 'Texas' }, incomes: () => [work(100000)], expenses: () => [], year: 2024, a: noInflationAssumptions },
        { name: 'Virginia MFJ senior no SS', state: { stateResidency: 'Virginia', filingStatus: 'Married Filing Jointly' }, incomes: () => [work(100000)], expenses: () => [], year: 2024, a: seniorAssumptions },
        { name: 'Virginia Single senior with SS', state: { stateResidency: 'Virginia' }, incomes: () => [work(50000), ss(30000)], expenses: () => [], year: 2024, a: seniorAssumptions },
        { name: 'DC Auto with mortgage', state: { stateResidency: 'DC', deductionMethod: 'Auto' }, incomes: () => [work(100000)], expenses: () => [itemizedMortgage()], year: 2024, a: noInflationAssumptions },
        { name: 'DC Itemized with mortgage', state: { stateResidency: 'DC', deductionMethod: 'Itemized' }, incomes: () => [work(100000)], expenses: () => [itemizedMortgage()], year: 2024, a: noInflationAssumptions },
        { name: 'California with SS Standard', state: { stateResidency: 'California' }, incomes: () => [work(40000), ss(24000)], expenses: () => [], year: 2025, a: noInflationAssumptions },
    ];

    cases.forEach(({ name, state, incomes, expenses, year, a }) => {
        it(name, () => {
            const s = createTaxState(state);
            const direct = calculateStateTax(s, incomes(), expenses(), year, a);
            const unified = calculateUnifiedStateTax(s, incomes(), expenses(), 0, year, a);
            expect(unified).toBe(direct);
        });
    });

    it('state override short-circuits in both functions', () => {
        const s = createTaxState({ stateResidency: 'California', stateOverride: 3000 });
        expect(calculateStateTax(s, [work(100000)], [], 2024, noInflationAssumptions)).toBe(3000);
        expect(calculateUnifiedStateTax(s, [work(100000)], [], 0, 2024, noInflationAssumptions)).toBe(3000);
        expect(calculateUnifiedStateTax(s, [work(100000)], [], 50000, 2024, noInflationAssumptions)).toBe(3000);
    });

    it('additionalOrdinaryIncome folds into the base (DC)', () => {
        const s = createTaxState({ stateResidency: 'DC' });
        const unified = calculateUnifiedStateTax(s, [work(50000)], [], 50000, 2024, noInflationAssumptions);
        const direct = calculateStateTax(s, [work(100000)], [], 2024, noInflationAssumptions);
        expect(unified).toBeCloseTo(direct, 6);
    });
});

// =============================================================================
// calculateFederalTaxFromIncomes — #8: Standard path must skip SALT/state work
// but return the SAME number; Itemized/Auto must still apply SALT.
// =============================================================================
describe('PR55 #8: calculateFederalTaxFromIncomes characterization', () => {
    it('Standard deduction path pins to 13841 (DC residency irrelevant on Standard)', () => {
        // Value moved +$0.10 with the PR#55 #3 fix (2024 Single brackets → breakpoint convention).
        const s = createTaxState({ deductionMethod: 'Standard', stateResidency: 'DC' });
        expect(calculateFederalTaxFromIncomes(s, [work(100000)], [], 0, 2024, noInflationAssumptions)).toBeCloseTo(13841, 4);
    });

    it('Standard path identical whether high-tax or no-tax state (SALT irrelevant)', () => {
        const dc = calculateFederalTaxFromIncomes(createTaxState({ deductionMethod: 'Standard', stateResidency: 'DC' }), [work(100000)], [], 0, 2024, noInflationAssumptions);
        const tx = calculateFederalTaxFromIncomes(createTaxState({ deductionMethod: 'Standard', stateResidency: 'Texas' }), [work(100000)], [], 0, 2024, noInflationAssumptions);
        expect(dc).toBe(tx);
    });

    it('Itemized path applies SALT (pins to 13356.44)', () => {
        // Value moved +$0.10 with the PR#55 #3 fix (2024 Single brackets → breakpoint convention).
        const s = createTaxState({ deductionMethod: 'Itemized', stateResidency: 'DC' });
        const m = [itemizedMortgage()];
        expect(calculateFederalTaxFromIncomes(s, [work(100000)], m, 0, 2024, noInflationAssumptions)).toBeCloseTo(13356.44, 2);
    });

    it('Auto path pins to its computed value (still applies SALT)', () => {
        // NOTE: Auto computes its own standard vs itemized branches internally and
        // returns the min of those; this is NOT identical to min of the standalone
        // Standard/Itemized calls. Pin the concrete value as a regression guard.
        const m = [itemizedMortgage()];
        const auto = calculateFederalTaxFromIncomes(createTaxState({ deductionMethod: 'Auto', stateResidency: 'DC' }), [work(100000)], m, 0, 2024, noInflationAssumptions);
        // Value moved +$0.10 with the PR#55 #3 fix (2024 Single brackets → breakpoint convention).
        expect(auto).toBeCloseTo(13427.080948654457, 4);
    });

    it('Itemized path with additionalOrdinaryIncome>0 uses unified state tax', () => {
        const s = createTaxState({ deductionMethod: 'Itemized', stateResidency: 'DC' });
        const m = [itemizedMortgage()];
        const v = calculateFederalTaxFromIncomes(s, [work(60000)], m, 40000, 2024, noInflationAssumptions);
        expect(v).toBeGreaterThan(0);
        const ref = calculateFederalTaxFromIncomes(s, [work(100000)], m, 0, 2024, noInflationAssumptions);
        expect(v).toBeCloseTo(ref, 6);
    });
});
