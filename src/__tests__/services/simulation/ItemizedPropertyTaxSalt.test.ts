/**
 * Real-property taxes on an itemized mortgage are deductible state/local taxes
 * (IRC §164(a)(1)) and share the SALT cap with state income tax (§164(b)(6)).
 * The itemized path used to count only mortgage interest + capped state INCOME
 * tax, so a homeowner who itemizes lost the property-tax deduction entirely —
 * most visibly in a no-income-tax state like Texas, where SALT came out $0.
 */
import { describe, it, expect } from 'vitest';

import {
    calculateFederalTaxFromIncomes,
    getItemizedDeductions,
    getItemizedPropertyTaxes,
    getSALTCap,
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

const assumptions: AssumptionsState = {
    ...defaultAssumptions,
    milestones: createBuiltinMilestones(YEAR - 45, 65, 90),
    macro: { ...defaultAssumptions.macro, inflationRate: 0, inflationAdjusted: false },
};

const taxState = (deductionMethod: TaxState['deductionMethod']): TaxState => ({
    filingStatus: 'Single',
    stateResidency: 'Texas',
    deductionMethod,
    fedOverride: null,
    ficaOverride: null,
    stateOverride: null,
    year: YEAR,
});

const salary = (amount = 150_000) =>
    new WorkIncome('w1', 'Job', amount, 'Annually', 'Yes', 0, 0, 0, 0, '', null, 'FIXED', new Date(2020, 0, 1));

// $600k home, $400k loan @ 6.5%, property tax rate as given (percent of valuation).
function mortgage(propertyTaxPct: number, startDate = new Date(2020, 0, 1)): MortgageExpense {
    return new MortgageExpense(
        'm1', 'Home', 'Monthly', 600_000, 400_000, 400_000, 6.5, 30,
        propertyTaxPct, 0, 0, 0, 0, 0, 0, 'Itemized', 0, 'a1', startDate,
    );
}

describe('itemized SALT includes mortgage property taxes', () => {
    it('sums annual property tax for itemized mortgages, prorated in the purchase year', () => {
        expect(getItemizedPropertyTaxes([mortgage(2)], YEAR)).toBeCloseTo(12_000, 6);
        // Bought in October ⇒ 3 months of property tax that year, none the year before.
        expect(getItemizedPropertyTaxes([mortgage(2, new Date(YEAR, 9, 1))], YEAR)).toBeCloseTo(3_000, 6);
        expect(getItemizedPropertyTaxes([mortgage(2, new Date(YEAR + 1, 0, 1))], YEAR)).toBe(0);
    });

    it('deducts $12k of property tax for a Texas itemizer (24% bracket ⇒ $2,880 less tax)', () => {
        const withPropTax = calculateFederalTaxFromIncomes(
            taxState('Itemized'), [salary()], [mortgage(2)], 0, YEAR, assumptions,
        );
        const withoutPropTax = calculateFederalTaxFromIncomes(
            taxState('Itemized'), [salary()], [mortgage(0)], 0, YEAR, assumptions,
        );
        // Taxable income stays inside the 2025 Single 24% bracket either way.
        expect(withoutPropTax - withPropTax).toBeCloseTo(12_000 * 0.24, 2);
    });

    it('caps property tax at the SALT limit', () => {
        const cap = getSALTCap(YEAR, 'Single');
        // 10% of $600k = $60k property tax, above the $40k cap.
        const capped = calculateFederalTaxFromIncomes(
            taxState('Itemized'), [salary(200_000)], [mortgage(10)], 0, YEAR, assumptions,
        );
        const none = calculateFederalTaxFromIncomes(
            taxState('Itemized'), [salary(200_000)], [mortgage(0)], 0, YEAR, assumptions,
        );
        // Both taxable incomes stay inside the 2025 Single 24% bracket ($103,350–$197,300).
        const interest = getItemizedDeductions([mortgage(0)], YEAR);
        expect(200_000 - interest - cap).toBeGreaterThan(103_350);
        expect(none - capped).toBeCloseTo(cap * 0.24, 2);
    });
});
