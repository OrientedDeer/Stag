/**
 * A cash charitable gift is deductible in the amount actually given (IRC §170(a)),
 * so a CharityExpense's deductible amount must move with the gift: inflating the
 * gift year over year must inflate the deduction, and a Guyton-Klinger /
 * survivor cut (adjustAmount) must shrink it — otherwise the plan deducts more
 * than was donated.
 */
import { describe, it, expect } from 'vitest';
import { CharityExpense } from '../../../../components/Objects/Expense/models';
import { getYesDeductions, getItemizedDeductions } from '../../../../components/Objects/Taxes/taxService/deductions';
import { defaultAssumptions, type AssumptionsState } from '../../../../components/Objects/Assumptions/AssumptionsContext';

const assumptions: AssumptionsState = {
    ...defaultAssumptions,
    macro: { ...defaultAssumptions.macro, inflationRate: 3, inflationAdjusted: true },
};

describe('CharityExpense deductible amount tracks the gift', () => {
    it('inflates the deduction with the gift on increment', () => {
        const gift = new CharityExpense('c1', 'Donations', 10_000, 'Annually', 'Itemized', 10_000, new Date(2025, 0, 1));
        let current = gift;
        for (let i = 0; i < 20; i++) current = current.increment(assumptions);

        expect(current.amount).toBeCloseTo(10_000 * Math.pow(1.03, 20), 6);
        expect(current.tax_deductible).toBeCloseTo(current.amount, 6);
        expect(getItemizedDeductions([current], 2045)).toBeCloseTo(current.amount, 6);
    });

    it('never deducts more than was given after a spending cut', () => {
        const gift = new CharityExpense('c1', 'Donations', 10_000, 'Annually', 'Yes', 10_000, new Date(2025, 0, 1));
        const cut = gift.adjustAmount(0.9);

        expect(cut.amount).toBeCloseTo(9_000, 6);
        expect(cut.tax_deductible).toBeCloseTo(9_000, 6);
        expect(getYesDeductions([cut], 2025)).toBeLessThanOrEqual(cut.getAnnualAmount(2025) + 1e-9);
    });

    it('keeps a partial deductible share proportional', () => {
        const gift = new CharityExpense('c1', 'Donations', 1_000, 'Monthly', 'Itemized', 600, new Date(2025, 0, 1));
        const next = gift.increment(assumptions).adjustAmount(0.5);

        expect(next.tax_deductible / next.amount).toBeCloseTo(0.6, 9);
    });
});
