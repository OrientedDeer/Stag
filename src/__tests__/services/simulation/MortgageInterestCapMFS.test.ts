/**
 * IRC §163(h)(3)(F)(i)(II): for loans after Dec 15, 2017 the acquisition-debt
 * limit is $750,000, "($375,000 in the case of a married individual filing a
 * separate return)". IRS Pub 936 Part II repeats the $375k MFS figure. The
 * itemized mortgage-interest proration used the $750k limit for every filing
 * status, so an MFS filer with a $600k mortgage deducted interest on all of it.
 */
import { describe, it, expect } from 'vitest';

import {
    calculateFederalTaxFromIncomes,
    getItemizedDeductions,
} from '../../../components/Objects/Taxes/TaxService';
import { type TaxState } from '../../../components/Objects/Taxes/TaxContext';
import {
    type AssumptionsState,
    defaultAssumptions,
    createBuiltinMilestones,
} from '../../../components/Objects/Assumptions/AssumptionsContext';
import { WorkIncome } from '../../../components/Objects/Income/models';
import { MortgageExpense } from '../../../components/Objects/Expense/models';

const YEAR = 2025;
const MFS_LIMIT = 375_000;

const assumptions: AssumptionsState = {
    ...defaultAssumptions,
    milestones: createBuiltinMilestones(YEAR - 45, 65, 90),
    macro: { ...defaultAssumptions.macro, inflationRate: 0, inflationAdjusted: false },
};

function mortgage(loan: number): MortgageExpense {
    return new MortgageExpense(
        'm1', 'Home', 'Monthly', loan * 1.25, loan, loan, 6.5, 30,
        0, 0, 0, 0, 0, 0, 0, 'Itemized', 0, 'a1', new Date(2020, 0, 1),
    );
}

function cappedInterest(m: MortgageExpense, limit: number): number {
    const { totalInterest, totalPrincipal } = m.calculateAnnualAmortization(YEAR);
    const avg = m.loan_balance - totalPrincipal / 2;
    return totalInterest * Math.min(1, limit / avg);
}

describe('mortgage-interest acquisition-debt cap for Married Filing Separately', () => {
    it('prorates a $600k MFS mortgage to interest on the first $375k', () => {
        const m = mortgage(600_000);
        const full = m.calculateAnnualAmortization(YEAR).totalInterest;
        const expected = cappedInterest(m, MFS_LIMIT);
        expect(expected).toBeLessThan(full * 0.65);
        expect(getItemizedDeductions([m], YEAR, 'Married Filing Separately')).toBeCloseTo(expected, 2);
    });

    it('keeps the $750k limit for Single and MFJ', () => {
        const m = mortgage(600_000);
        const full = m.calculateAnnualAmortization(YEAR).totalInterest;
        expect(getItemizedDeductions([m], YEAR, 'Single')).toBe(full);
        expect(getItemizedDeductions([m], YEAR, 'Married Filing Jointly')).toBe(full);
    });

    it('applies the $375k limit in the federal itemized tax computation', () => {
        const m = mortgage(600_000);
        const state: TaxState = {
            filingStatus: 'Married Filing Separately',
            stateResidency: 'Texas',
            deductionMethod: 'Itemized',
            fedOverride: null,
            ficaOverride: null,
            stateOverride: null,
            year: YEAR,
        };
        const salary = new WorkIncome('w1', 'Job', 150_000, 'Annually', 'Yes', 0, 0, 0, 0, '', null, 'FIXED', new Date(2020, 0, 1));
        const withMortgage = calculateFederalTaxFromIncomes(state, [salary], [m], 0, YEAR, assumptions);
        const noMortgage = calculateFederalTaxFromIncomes(
            { ...state, deductionMethod: 'Standard' }, [salary], [], 0, YEAR, assumptions,
        );
        // 2025 MFS: $15,750 standard deduction (OBBBA); taxable income stays in the 24% bracket
        // ($103,350–$197,300) on both paths, and Texas has no state income tax.
        const deduction = cappedInterest(m, MFS_LIMIT);
        expect(noMortgage - withMortgage).toBeCloseTo((deduction - 15_750) * 0.24, 2);
    });
});
