import { describe, it, expect } from 'vitest';
import { type AssumptionsState, defaultAssumptions, createBuiltinMilestones } from '../../../components/Objects/Assumptions/AssumptionsContext';
import { type TaxState } from '../../../components/Objects/Taxes/TaxContext';
import { InvestedAccount } from '../../../components/Objects/Accounts/models';
import { PassiveIncome, WorkIncome } from '../../../components/Objects/Income/models';
import { FoodExpense } from '../../../components/Objects/Expense/models';
import { simulateOneYear } from '../../../components/Objects/Assumptions/SimulationEngine';
import { calculateStateTax, getTaxParameters, calculateTax } from '../../../components/Objects/Taxes/TaxService';

// Virginia's age deduction (Va. Code §58.1-322.03(5)): $12,000 per filer 65+,
// reduced $1-for-$1 by AFAGI over $50k single / $75k married. The Taxes tab
// (calculateStateTax) applies it; the projection engine must too.

const assumptionsFor = (birthYear: number, retirementAge: number): AssumptionsState => ({
    ...defaultAssumptions,
    demographics: {},
    milestones: createBuiltinMilestones(birthYear, retirementAge, 95),
    income: { ...defaultAssumptions.income, salaryGrowth: 0 },
    macro: { ...defaultAssumptions.macro, inflationRate: 0, inflationAdjusted: false },
    investments: {
        ...defaultAssumptions.investments,
        returnRates: { ror: 0 },
        autoRothConversions: false,
    },
});

const vaTax = (filingStatus: TaxState['filingStatus']): TaxState => ({
    filingStatus,
    stateResidency: 'Virginia',
    deductionMethod: 'Standard',
    fedOverride: null,
    ficaOverride: null,
    stateOverride: null,
    year: 2026,
});

const brokerage = () => new InvestedAccount('acc-brk', 'Brokerage', 500000, 0, 10, 0, 'Brokerage', true, 1.0, 500000);

const pension = (annual: number) => new PassiveIncome(
    'inc-pension', 'Pension', annual, 'Annually', 'No', 'Other', new Date('2020-01-01'), undefined, false,
);

describe('Virginia age deduction in projected years', () => {
    it('retired single VA filer age 70 gets the $12k age deduction (matches Taxes tab)', () => {
        const assumptions = assumptionsFor(1956, 65);
        const taxState = vaTax('Single');
        const incomes = [pension(30000)];
        const expenses = [new FoodExpense('exp', 'Living', 20000, 'Annually', new Date('2020-01-01'))];

        const result = simulateOneYear(2026, incomes, expenses, [brokerage()], assumptions, taxState);

        const expected = calculateStateTax(taxState, incomes, expenses, 2026, assumptions);
        const params = getTaxParameters(2026, 'Single', 'state', 'Virginia', assumptions)!;
        const withoutAgeDeduction = calculateTax(30000, 0, params);

        expect(expected).toBeLessThan(withoutAgeDeduction - 600);
        expect(result.taxDetails.state).toBeCloseTo(expected, 0);
    });

    it('phases out once AFAGI (incl. Traditional withdrawals) passes $50k', () => {
        const assumptions = {
            ...assumptionsFor(1956, 65),
            withdrawalStrategy: [{ id: 'ws-trad', name: 'Traditional', accountId: 'acc-trad' }],
        };
        const taxState = vaTax('Single');
        const incomes = [pension(30000)];
        const expenses = [new FoodExpense('exp', 'Living', 80000, 'Annually', new Date('2020-01-01'))];
        const trad = new InvestedAccount('acc-trad', 'Trad', 2000000, 0, 10, 0, 'Traditional 401k', true, 1.0, 0);

        const result = simulateOneYear(2026, incomes, expenses, [trad], assumptions, taxState);

        const tradWithdrawal = result.cashflow.withdrawalDetail['acc-trad'] ?? 0;
        expect(tradWithdrawal).toBeGreaterThan(40000);
        // AFAGI = $30k pension + > $40k withdrawal > $62k, so the deduction is fully
        // phased out and the base state tax is the plain standard-deduction figure.
        const params = getTaxParameters(2026, 'Single', 'state', 'Virginia', assumptions)!;
        expect(result.taxDetails.state).toBeCloseTo(calculateTax(30000, 0, params), 0);
    });

    it('still-working VA filer age 66 gets the age deduction on the working path', () => {
        const assumptions = assumptionsFor(1960, 70);
        const taxState = vaTax('Single');
        const incomes = [new WorkIncome('w1', 'Job', 35000, 'Annually', 'Yes', 0, 0, 0, 0, '', 'Traditional 401k', 'FIXED', new Date('2020-01-01'))];
        const expenses = [new FoodExpense('exp', 'Living', 10000, 'Annually', new Date('2020-01-01'))];

        const result = simulateOneYear(2026, incomes, expenses, [brokerage()], assumptions, taxState);

        const expected = calculateStateTax(taxState, incomes, expenses, 2026, assumptions);
        expect(result.taxDetails.state).toBeCloseTo(expected, 0);
    });
});
