import { describe, it, expect } from 'vitest';
import { evaluateMilestone, type MilestoneContext } from '../../services/simulation/MilestoneEvaluator';
import { InvestedAccount } from '../../components/Objects/Accounts/models';
import { OtherExpense } from '../../components/Objects/Expense/models';
import { type CustomMilestone } from '../../services/simulation/types';
import { defaultAssumptions } from '../../components/Objects/Assumptions/AssumptionsContext';
import { getTaxParameters, calculateTotalFederalTax } from '../../components/Objects/Taxes/TaxService';

// The simulation inflates expenses AND indexes the federal brackets / standard
// deduction for years past the latest tax table. The "× Expenses (w/ tax)"
// milestone target must gross up with the same indexed brackets, otherwise a
// nominal future-year expense is taxed against frozen 2026 brackets and the
// FI target is overstated (the milestone fires years late).
function grossUp2026(net: number): number {
    const params = getTaxParameters(2026, 'Single', 'federal')!;
    let gross = net;
    for (let i = 0; i < 50; i++) {
        gross = net + calculateTotalFederalTax(gross, 0, 0, 0, 0, 'Single', params).totalTax;
    }
    return gross;
}

describe('EXPENSES_GROSSED_UP uses inflation-indexed brackets for future years', () => {
    const year = 2050;
    const realExpense = 60_000;
    const inflation = defaultAssumptions.macro.inflationRate / 100;
    const multiplier = Math.pow(1 + inflation, year - 2026);
    const nominalExpense = realExpense * multiplier;
    // Same purchasing power as the 2026 gross-up, expressed in 2050 dollars.
    const expectedTarget = 25 * grossUp2026(realExpense) * multiplier;

    const milestone: CustomMilestone = {
        id: 'fi',
        name: 'FI',
        conditions: [{ type: 'NET_WORTH', operator: '>=', value: 25, valueType: 'EXPENSES_GROSSED_UP' }],
    };

    const contextWithNetWorth = (netWorth: number): MilestoneContext => ({
        accounts: [new InvestedAccount('brok', 'Brokerage', netWorth, 0, 0, 0.1, 'Brokerage')],
        expenses: [new OtherExpense('living', 'Living', nominalExpense, 'Annually', new Date(2020, 0, 1), new Date(2100, 0, 1))],
        year,
        age: 60,
        filingStatus: 'Single',
        assumptions: defaultAssumptions,
    });

    it('is reached when net worth covers the real-terms grossed-up target', () => {
        expect(evaluateMilestone(milestone, contextWithNetWorth(expectedTarget * 1.005))).toBe(true);
    });

    it('is not reached just below the real-terms grossed-up target', () => {
        expect(evaluateMilestone(milestone, contextWithNetWorth(expectedTarget * 0.995))).toBe(false);
    });
});
