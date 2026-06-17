import { describe, it, expect } from 'vitest';
import { AssumptionsState, defaultAssumptions, createBuiltinMilestones, getLifeExpectancy, getBirthYear } from '../../../../components/Objects/Assumptions/AssumptionsContext';
import { TaxState } from '../../../../components/Objects/Taxes/TaxContext';
import { runSimulation } from '../../../../components/Objects/Assumptions/useSimulation';
import { AnyAccount, DebtAccount, InvestedAccount, PropertyAccount, SavedAccount } from '../../../../components/Objects/Accounts/models';
import { WorkIncome } from '../../../../components/Objects/Income/models';
import { OtherExpense } from '../../../../components/Objects/Expense/models';

const mockTaxState: TaxState = {
    filingStatus: 'Single',
    stateResidency: 'DC',
    deductionMethod: 'Standard',
    fedOverride: null,
    ficaOverride: null,
    stateOverride: null,
    year: 2024
};

const calculateNetWorth = (accounts: AnyAccount[]): number => {
    return accounts.reduce((total, account) => {
        if (account instanceof DebtAccount) {
            return total - account.amount;
        }
        if (account instanceof PropertyAccount) {
            return total + account.amount - account.loanAmount;
        }
        return total + account.amount;
    }, 0);
}

describe('Critical Simulation Logic', () => {
    it('Zero-Growth Baseline: Net Worth should not change with zero growth and no cashflows', () => {
        // --- SETUP ---
        // Pure zero-growth baseline: no income, no expenses, 0% returns.
        // Verifies the simulation engine doesn't phantom-create or destroy money.
        const zeroGrowthAssumptions: AssumptionsState = {
            ...defaultAssumptions,
            demographics: {},
            milestones: createBuiltinMilestones(1995, 67, 90),
            macro: {
                ...defaultAssumptions.macro,
                inflationRate: 0,
                inflationAdjusted: false,
            },
            investments: {
                ...defaultAssumptions.investments,
                returnRates: { ror: 0 }
            },
            income: {
                ...defaultAssumptions.income,
                salaryGrowth: 0,
            },
            priorities: []
        };

        const initialNetWorth = 10000;
        const accounts = [
            new InvestedAccount('acc-1', 'Brokerage', initialNetWorth, 0, 0, 0.0, 'Brokerage', true, 0),
        ];

        // --- EXECUTE ---
        const result = runSimulation(5, accounts, [], [], zeroGrowthAssumptions, mockTaxState);

        // --- ASSERT ---
        const year0NetWorth = calculateNetWorth(result[0].accounts);
        expect(year0NetWorth).toBe(initialNetWorth);

        // With no income, no expenses, and 0% growth, net worth should remain constant
        for (let i = 1; i < result.length; i++) {
            const yearNetWorth = calculateNetWorth(result[i].accounts);
            expect(yearNetWorth).toBeCloseTo(initialNetWorth);
        }
    });

    it('Inflation Impact: "Real Dollar" simulation should result in lower nominal numbers', () => {
        // --- SETUP ---
        const assumptionsWithInflation: AssumptionsState = {
            ...defaultAssumptions,
            demographics: {},
            milestones: createBuiltinMilestones(1995, 67, 90),
            macro: {
                ...defaultAssumptions.macro,
                inflationRate: 3, // 3% inflation
                inflationAdjusted: true, // Nominal dollars
            },
            investments: {
                ...defaultAssumptions.investments,
                returnRates: { ror: 7 } // 7% ROI
            },
            priorities: [
                {
                    id: 'prio-1',
                    name: 'Send remainder to savings',
                    type: 'SAVINGS',
                    accountId: 'acc-2',
                    capType: 'REMAINDER'
                }
            ]
        };

        const assumptionsWithInflationAdjusted = {
            ...assumptionsWithInflation,
            macro: {
                ...assumptionsWithInflation.macro,
                inflationAdjusted: false, // Real dollars
            }
        };

        const accounts = [
            new InvestedAccount('acc-1', 'Brokerage', 100000, 0, 5, 0.1, 'Brokerage', true, 0.2),
            new SavedAccount('acc-2', 'Savings', 0, 0)
        ];
        const income = [new WorkIncome('work-1', 'Job', 100000, 'Annually', "Yes", 0, 0, 0, 0, "", null, 'FIXED', new Date('2025-01-01'))];
        const expenses = [new OtherExpense('exp-1', 'Living', 50000, "Annually", new Date('2025-01-01'))];

        // --- EXECUTE ---
        const nominalResult = runSimulation(10, accounts, income, expenses, assumptionsWithInflation, mockTaxState);
        const realResult = runSimulation(10, accounts, income, expenses, assumptionsWithInflationAdjusted, mockTaxState);

        // --- ASSERT ---
        const finalNominalNetWorth = calculateNetWorth(nominalResult[nominalResult.length - 1].accounts);
        const finalRealNetWorth = calculateNetWorth(realResult[realResult.length - 1].accounts);

        // The 'real' dollar value should be less than the inflated nominal value
        expect(finalRealNetWorth).toBeLessThan(finalNominalNetWorth);

        // Spot check: The starting net worth should be identical
        expect(calculateNetWorth(realResult[0].accounts)).toBe(calculateNetWorth(nominalResult[0].accounts));
    });

    it('Deficit Handling: Should use withdrawal buckets to cover negative cashflow', () => {
        // --- SETUP ---
        const zeroGrowthAssumptions: AssumptionsState = {
            ...defaultAssumptions,
            demographics: {},
            milestones: createBuiltinMilestones(1995, 67, 90),
            macro: { 
                inflationRate: 0, 
                inflationAdjusted: false, 
                healthcareInflation: 0 
            },
            investments: { ...defaultAssumptions.investments, returnRates: { ror: 0 }, withdrawalStrategy: 'Needs Based' },
            income: { ...defaultAssumptions.income, salaryGrowth: 0 },
            // 1. Tell the simulation to pull from 'acc-1' when broke
            withdrawalStrategy: [
                {
                    id: 'wd-1',
                    name: 'Emergency Fund',
                    accountId: 'acc-1' 
                }
            ],
            priorities: [
                {
                    id: 'prio-1',
                    name: 'Send remainder to savings',
                    type: 'SAVINGS',
                    accountId: 'acc-2',
                    capType: 'REMAINDER'
                }
            ]
        };

        const income = [new WorkIncome('work-1', 'Job', 50000, 'Annually', "Yes", 0, 0, 0, 0, "", null, 'FIXED', new Date('2025-01-01'))];
        const expenses = [new OtherExpense('exp-1', 'Living', 80000, "Annually", new Date('2025-01-01'))];
        
        // 2. Use a SavedAccount (Cash) for acc-1 so we test simple 1:1 withdrawals first
        // (This ensures we don't trip over the "Brokerage" tax logic just yet)
        const accounts = [
            new SavedAccount('acc-1', 'Emergency Fund', 100000, 0),
            new SavedAccount('acc-2', 'Savings', 0, 0)
        ];

        // --- EXECUTE ---
        const result = runSimulation(2, accounts, income, expenses, zeroGrowthAssumptions, mockTaxState, undefined, { referenceDate: new Date(2025, 11, 31) });
        const year1 = result[1];

        // --- ASSERT ---
        
        // 1. Cashflow should NOT be negative anymore. 
        // The simulation should have pulled exactly enough to make it 0.
        expect(year1.cashflow.discretionary).toBeCloseTo(0);

        // 2. The money should be gone from the account
        const startBalance = 100000;
        const endBalance = year1.accounts.find(a => a.id === 'acc-1')?.amount || 0;
        
        // We expect the balance to drop by roughly the deficit
        // Deficit ≈ Expenses (80k) - AfterTaxIncome (~42k) = ~38k
        expect(endBalance).toBeLessThan(startBalance);
        expect(endBalance).toBeGreaterThan(50000); // Sanity check it didn't drain everything

        // 3. Net Worth should still decrease (Burning assets to pay for life)
        const year0NetWorth = calculateNetWorth(result[0].accounts);
        const year1NetWorth = calculateNetWorth(result[1].accounts);
        expect(year1NetWorth).toBeLessThan(year0NetWorth);
    });

    it('The "Cliff" Year: Simulation should stop exactly at lifeExpectancy', () => {
        // --- SETUP ---
        const currentYear = new Date().getFullYear();
        const cliffAssumptions: AssumptionsState = {
            ...defaultAssumptions,
            demographics: {},
            milestones: createBuiltinMilestones(currentYear - 30, 67, 40), // Birth year for age 30, end simulation at age 40
            macro: { ...defaultAssumptions.macro, inflationRate: 0, inflationAdjusted: false },
        };

        // We pass a long duration hint, but the lifeExpectancy should be derived from the difference in years
        const longDurationHint = 50;

        // --- EXECUTE ---
        const result = runSimulation(longDurationHint, [], [], [], cliffAssumptions, mockTaxState, undefined, { referenceDate: new Date(2025, 11, 31) });

        // --- ASSERT ---
        // The simulation runs from age 30 up to and *including* age 40.
        // So, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40 -> 11 years.
        const startAge = currentYear - getBirthYear(cliffAssumptions.milestones);
        const lifeExpectancy = getLifeExpectancy(cliffAssumptions.milestones);
        const expectedYears = lifeExpectancy - startAge + 1; // +1 to include both start and end ages
        expect(result).toHaveLength(expectedYears);

        // Verify the last entry is indeed for age 40
        const lastYearResult = result[result.length - 1];
        const lastYearAge = lastYearResult.year - getBirthYear(cliffAssumptions.milestones);
        expect(lastYearAge).toBe(40);
    });

    it("Priority Buckets: 'FIXED' cap should contribute a fixed amount annually", () => {
        // --- SETUP ---
        const fixedCapAssumptions: AssumptionsState = {
            ...defaultAssumptions,
            demographics: {},
            milestones: createBuiltinMilestones(1995, 67, 90),
            macro: { ...defaultAssumptions.macro, inflationRate: 0, inflationAdjusted: false },
            investments: { ...defaultAssumptions.investments, returnRates: { ror: 0 } },
            income: { ...defaultAssumptions.income, salaryGrowth: 0 },
            priorities: [
                {
                    id: 'prio-1',
                    name: 'Fixed Contribution',
                    type: 'SAVINGS',
                    accountId: 'acc-2',
                    capType: 'FIXED',
                    capValue: 100 // $100/month
                }
            ]
        };

        const income = [new WorkIncome('work-1', 'Job', 100000, 'Annually', "Yes", 0, 0, 0, 0, "", null, 'FIXED', new Date('2025-01-01'))];
        const expenses = [new OtherExpense('exp-1', 'Living', 50000, "Annually", new Date('2025-01-01'))];
        const accounts = [
            new InvestedAccount('acc-1', 'Brokerage', 10000, 0, 5, 0.0, 'Brokerage', true, 0.2),
            new SavedAccount('acc-2', 'Savings', 0, 0)
        ];

        // --- EXECUTE ---
        const result = runSimulation(2, accounts, income, expenses, fixedCapAssumptions, mockTaxState, undefined, { referenceDate: new Date(2025, 11, 31) });
        const year1 = result[1];

        // --- ASSERT ---
        // Expected annual contribution is $100/month * 12 months = $1200
        const expectedAnnualContribution = 100 * 12;

        // Total bucket allocations include both the FIXED contribution and
        // any catch-all surplus deposited into brokerage
        expect(year1.cashflow.bucketAllocations).toBeGreaterThanOrEqual(expectedAnnualContribution);

        // Check the detail for the specific account
        expect(year1.cashflow.bucketDetail['acc-2']).toBeCloseTo(expectedAnnualContribution);
        
        // Check the account balance
        const savingsAccount = year1.accounts.find(a => a.id === 'acc-2');
        expect(savingsAccount?.amount).toBeCloseTo(expectedAnnualContribution);
    });
});
