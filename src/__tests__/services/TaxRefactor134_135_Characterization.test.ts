import { describe, it, expect } from 'vitest';
import { TaxState } from '../../components/Objects/Taxes/TaxContext';
import {
    AssumptionsState,
    defaultAssumptions,
    createBuiltinMilestones,
} from '../../components/Objects/Assumptions/AssumptionsContext';
import {
    calculateStateTax,
    calculateUnifiedStateTax,
    calculateFederalTaxFromIncomes,
} from '../../components/Objects/Taxes/TaxService';
import { calculateTotalFederalTax } from '../../components/Objects/Taxes/taxService/bracketTax';
import { WorkIncome, CurrentSocialSecurityIncome } from '../../components/Objects/Income/models';
import { MortgageExpense } from '../../components/Objects/Expense/models';

/**
 * CHARACTERIZATION tests for the #134 (shared senior-deduction helper) and #135
 * (reuse bracketTax's taxable-SS in federalTax's MAGI proxy) behavior-preserving
 * refactors.
 *
 * These pin the EXACT numeric outputs across the reuse boundaries:
 *  - #134: the regular 65+ additional standard deduction on BOTH the federal
 *    standard path and the state senior-deduction path (incl. MFJ doubling).
 *  - #135: the OBBBA senior-bonus MAGI-proxy phaseout, which depends on a
 *    taxable-SS computation that must stay numerically identical to the one
 *    bracketTax.ts already performs.
 *
 * They MUST pass on the original code (they characterize current behavior) and
 * remain byte-identical after each refactor.
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

const assumptionsForBirthYear = (birthYear: number): AssumptionsState => ({
    ...noInflationAssumptions,
    milestones: createBuiltinMilestones(birthYear, 1, 15),
});

const work = (amount: number) =>
    new WorkIncome('w1', 'Job', amount, 'Annually', 'No', 0, 0, 0, 0, 'acc1', 'Traditional 401k', 'FIXED', new Date('2020-01-01'));

const ss = (annual: number) =>
    new CurrentSocialSecurityIncome('ss1', 'SS', annual, 'Annually', new Date('2020-01-01'));

const itemizedMortgage = () => {
    const m = new MortgageExpense('m1', 'Home', 'Monthly', 500000, 400000, 400000, 3, 30, 1.2, 0, 1, 100, 0.3, 0, 50, 'Itemized', 0.8, 'a1', new Date(2020, 0, 1));
    m.loan_balance = m.getBalanceAtDate('2026-01-02');
    return m;
};

// =============================================================================
// #134 — regular 65+ additional standard deduction, shared between federal &
// state. Pin the exact tax for representative filers on BOTH paths.
// =============================================================================
describe('#134 characterization: regular 65+ additional standard deduction', () => {
    // --- Federal regular 65+ add-on (standard path; bonus sunset year so ONLY
    //     the regular component is in play, isolating the shared helper) ---
    it('federal single 65+ regular add-on in 2029 (bonus sunset): $2,050 vs under-65', () => {
        const taxState = createTaxState({ deductionMethod: 'Standard' });
        const senior = calculateFederalTaxFromIncomes(taxState, [work(90000)], [], 0, 2029, assumptionsForBirthYear(1962)); // age 67
        const underAge = calculateFederalTaxFromIncomes(taxState, [work(90000)], [], 0, 2029, assumptionsForBirthYear(1985)); // age 44
        // Only the regular 65+ additional standard deduction ($2,050) differs.
        expect(senior).toBeCloseTo(10519, 0);
        expect(underAge).toBeCloseTo(10970, 0);
        // The gap is exactly the regular add-on at the 22% marginal bracket.
        expect(underAge - senior).toBeCloseTo(2050 * 0.22, 0);
    });

    it('federal MFJ 65+ regular add-on doubled in 2029 (bonus sunset): $1,650 x2', () => {
        const taxState = createTaxState({ filingStatus: 'Married Filing Jointly', deductionMethod: 'Standard' });
        const senior = calculateFederalTaxFromIncomes(taxState, [work(120000)], [], 0, 2029, assumptionsForBirthYear(1962));
        const underAge = calculateFederalTaxFromIncomes(taxState, [work(120000)], [], 0, 2029, assumptionsForBirthYear(1985));
        // Regular add-on doubled for MFJ: $1,650 x 2 = $3,300 difference in deduction.
        // After the 2029 standard deduction this $120k-MFJ filer's marginal bracket
        // is 12%, so the gap is $3,300 x 0.12.
        expect(senior).toBeCloseTo(9644, 0);
        expect(underAge).toBeCloseTo(10040, 0);
        expect(underAge - senior).toBeCloseTo(3300 * 0.12, 0);
    });

    // --- State regular 65+ add-on (Virginia, per-person doubling for MFJ) ---
    it('state Virginia single 65+ senior deduction (2024, Standard)', () => {
        const s = createTaxState({ stateResidency: 'Virginia' });
        // VA 2024 Single: standard $8,500 + senior $12,000 = $20,500.
        expect(calculateStateTax(s, [work(100000)], [], 2024, assumptionsForBirthYear(1959))).toBeCloseTo(4313.75, 2);
    });

    it('state Virginia MFJ 65+ senior deduction doubled (2024, Standard)', () => {
        const s = createTaxState({ stateResidency: 'Virginia', filingStatus: 'Married Filing Jointly' });
        // VA 2024 MFJ: standard $17,000 + senior $24,000 (2 x $12k) = $41,000.
        expect(calculateStateTax(s, [work(100000)], [], 2024, assumptionsForBirthYear(1959))).toBeCloseTo(3135, 2);
    });

    it('state Virginia MFS 65+ senior NOT doubled (single person)', () => {
        const s = createTaxState({ stateResidency: 'Virginia', filingStatus: 'Married Filing Separately' });
        // MFS: senior deduction is $12,000, NOT doubled.
        const mfs = calculateStateTax(s, [work(100000)], [], 2024, assumptionsForBirthYear(1959));
        const single = calculateStateTax(createTaxState({ stateResidency: 'Virginia' }), [work(100000)], [], 2024, assumptionsForBirthYear(1959));
        expect(mfs).toBeCloseTo(single, 2);
    });

    it('state Virginia under-65: NO senior deduction', () => {
        const s = createTaxState({ stateResidency: 'Virginia' });
        const senior = calculateStateTax(s, [work(100000)], [], 2024, assumptionsForBirthYear(1959));
        const underAge = calculateStateTax(s, [work(100000)], [], 2024, assumptionsForBirthYear(1985));
        // Under-65 forfeits the $12,000 senior deduction → strictly higher tax.
        expect(underAge).toBeGreaterThan(senior);
    });

    it('state Virginia senior deduction with additional ordinary income (unified path)', () => {
        const s = createTaxState({ stateResidency: 'Virginia' });
        // VA 2024 Single, $100k gross + $30k additional ordinary income ($130k):
        // standard $8,500 + senior $12,000. Pin the EXACT unified-path value so the
        // shared senior helper can't shift it.
        const senior = calculateUnifiedStateTax(s, [work(100000)], [], 30000, 2024, assumptionsForBirthYear(1959));
        const underAge = calculateUnifiedStateTax(s, [work(100000)], [], 30000, 2024, assumptionsForBirthYear(1985));
        expect(senior).toBeCloseTo(6038.75, 2);
        expect(underAge).toBeCloseTo(6728.75, 2);
        // Gap is the $12,000 senior deduction at VA's 5.75% top rate.
        expect(underAge - senior).toBeCloseTo(12000 * 0.0575, 2);
    });
});

// =============================================================================
// #135 — the OBBBA senior-bonus MAGI proxy reuses bracketTax's taxable-SS.
// Pin the exact federal tax for senior filers WITH SS near the phaseout, and
// independently pin bracketTax's taxableSS so the reused value can't drift.
// =============================================================================
describe('#135 characterization: MAGI-proxy taxable-SS reuse', () => {
    it('senior single with SS near phaseout (2026): exact federal tax pinned', () => {
        const taxState = createTaxState({ deductionMethod: 'Standard' });
        // Work $70k + SS $20k, age 67 in 2026. The taxable portion of SS feeds the
        // MAGI proxy that gates the OBBBA bonus phaseout. Pin the exact tax.
        const tax = calculateFederalTaxFromIncomes(taxState, [work(70000), ss(20000)], [], 0, 2026, assumptionsForBirthYear(1959));
        // Reference value (current code). Refactor must reproduce it exactly.
        expect(tax).toBeCloseTo(8697.4, 1);
    });

    it('senior MFJ with SS straddling the $150k MAGI phaseout threshold (2026)', () => {
        const taxState = createTaxState({ filingStatus: 'Married Filing Jointly', deductionMethod: 'Standard' });
        // Higher income so taxable-SS is at the 85% cap and MAGI crosses $150k,
        // exercising the bonus phaseout that depends on the reused taxable-SS.
        const tax = calculateFederalTaxFromIncomes(taxState, [work(140000), ss(40000)], [], 0, 2026, assumptionsForBirthYear(1959));
        expect(tax).toBeCloseTo(17570.8, 1);
    });

    it('senior itemizer with SS (2026): bonus applies, regular add-on does NOT', () => {
        const taxState = createTaxState({ deductionMethod: 'Itemized' });
        const seniorItemized = calculateFederalTaxFromIncomes(taxState, [work(90000), ss(20000)], [itemizedMortgage()], 0, 2026, assumptionsForBirthYear(1959));
        const underItemized = calculateFederalTaxFromIncomes(taxState, [work(90000), ss(20000)], [itemizedMortgage()], 0, 2026, assumptionsForBirthYear(1985));
        // Itemizer still gets the OBBBA bonus → senior strictly lower.
        expect(seniorItemized).toBeLessThan(underItemized);
    });

    it('bracketTax taxableSS equals the federalTax MAGI-proxy provisional base inputs', () => {
        // Lock the value federalTax.ts reuses: bracketTax's taxableSS computed
        // with the SAME provisional base = max(0, ordinary+stcg+ltcg-preTax).
        const ordinaryIncome = 70000;
        const ss = 20000;
        const preTax = 0;
        const result = calculateTotalFederalTax(ordinaryIncome, ss, 0, 0, preTax, 'Single', {
            standardDeduction: 16550,
            brackets: [
                { threshold: 0, rate: 0.1 },
                { threshold: 11600, rate: 0.12 },
                { threshold: 47150, rate: 0.22 },
            ],
            capitalGainsBrackets: [{ threshold: 0, rate: 0 }],
            socialSecurityTaxRate: 0,
            socialSecurityWageBase: 0,
            medicareTaxRate: 0,
        });
        // bracketTax's taxableSS for these inputs (85% cap region).
        expect(result.taxableSS).toBeCloseTo(17000, 0);
    });

    it('non-senior baseline with SS (2026): MAGI proxy never built, tax unchanged', () => {
        const taxState = createTaxState({ deductionMethod: 'Standard' });
        const tax = calculateFederalTaxFromIncomes(taxState, [work(70000), ss(20000)], [], 0, 2026, assumptionsForBirthYear(1985)); // age 41
        expect(tax).toBeCloseTo(10310, 0);
    });
});
