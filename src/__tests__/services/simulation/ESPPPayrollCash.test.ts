import { describe, it, expect } from 'vitest';

import { ESPPAccount, InvestedAccount } from '../../../components/Objects/Accounts/models';
import { WorkIncome } from '../../../components/Objects/Income/models';
import { FoodExpense } from '../../../components/Objects/Expense/models';
import { runSimulation } from '../../../components/Objects/Assumptions/useSimulation';
import {
    type AssumptionsState,
    defaultAssumptions,
    createBuiltinMilestones,
} from '../../../components/Objects/Assumptions/AssumptionsContext';
import { type TaxState } from '../../../components/Objects/Taxes/TaxContext';

describe('ESPP payroll contributions', () => {
    const START_YEAR = new Date().getFullYear();
    const taxState: TaxState = {
        filingStatus: 'Single',
        stateResidency: 'Texas',
        deductionMethod: 'Standard',
        fedOverride: null,
        ficaOverride: null,
        stateOverride: null,
        year: START_YEAR,
    };
    const assumptions: AssumptionsState = {
        ...defaultAssumptions,
        demographics: {},
        milestones: createBuiltinMilestones(1985, 65, 95),
        income: { ...defaultAssumptions.income, salaryGrowth: 0 },
        macro: { ...defaultAssumptions.macro, inflationRate: 0, inflationAdjusted: false },
        investments: {
            ...defaultAssumptions.investments,
            returnRates: { ror: 0 },
            taxOptimizationEnabled: false,
            autoRothConversions: false,
        },
        withdrawalStrategy: [],
        priorities: [],
    };

    function run(esppPerYear: number) {
        const inc = new WorkIncome(
            'job', 'Job', 120000, 'Annually', 'Yes',
            0, 0, 0, 0, '', null, 'FIXED',
            new Date(START_YEAR, 0, 1), undefined,
            0, 'custom',
            esppPerYear > 0 ? 'FIXED' : 'NONE', esppPerYear, 15, false, 6, 'espp', 0,
        );
        const accounts = [
            new ESPPAccount('espp', 'ESPP', 0, [], 'job', undefined, 'ACME', 100),
            new InvestedAccount('cash', 'Brokerage', 20000, 0, 10, 0, 'Brokerage', true, 1.0, 20000),
        ];
        const expenses = [new FoodExpense('food', 'Living', 40000, 'Annually', new Date(START_YEAR, 0, 1))];
        return runSimulation(4, accounts, [inc], expenses, assumptions, taxState);
    }

    const netWorth = (sim: ReturnType<typeof run>, year: number) =>
        sim.find(y => y.year === year)!.accounts.reduce((sum, acc) => sum + acc.amount, 0);

    // First full engine year (year 0 is the current-year snapshot).
    const YEAR = START_YEAR + 1;

    it('takes the ESPP purchase out of take-home cash — only the 15% discount is a gain', () => {
        const base = run(0);
        const espp = run(10000);
        // $10,000 buys shares at $85 that are worth $100: $11,764.71 of stock.
        const shares = espp.find(y => y.year === YEAR)!.accounts.find(a => a.id === 'espp')!.amount;
        expect(shares).toBeCloseTo(10000 / 0.85, 0);
        expect(netWorth(espp, YEAR) - netWorth(base, YEAR)).toBeCloseTo(10000 / 0.85 - 10000, 0);
        const [b, e] = [base, espp].map(sim => sim.find(y => y.year === YEAR)!.cashflow);
        expect(b.bucketAllocations - e.bucketAllocations).toBeCloseTo(10000, 0);
        expect(e.investedUser - b.investedUser).toBeCloseTo(10000, 0);
    });

    it('charges only the purchase the $25k §423 limit allows, not the refunded excess', () => {
        const base = run(0);
        const espp = run(30000);
        // $25,000 of FMV at a $85 price costs $21,250; the other $8,750 is refunded.
        expect(netWorth(espp, YEAR) - netWorth(base, YEAR)).toBeCloseTo(25000 - 21250, 0);
    });
});
