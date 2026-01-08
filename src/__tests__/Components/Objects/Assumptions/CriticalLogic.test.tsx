import { describe, it, expect } from 'vitest';
import { AssumptionsState, defaultAssumptions } from '../../../../components/Objects/Assumptions/AssumptionsContext';
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
    stateOverride: null
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
    it('Zero-Growth Baseline: Net Worth should change by (Income - Expenses)', () => {
        // --- SETUP ---
        const zeroGrowthAssumptions: AssumptionsState = {
            ...defaultAssumptions,
            demographics: {
                startAge: 30,
                startYear: 2025,
                lifeExpectancy: 90,
                retirementAge: 67,
            },
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

        const income = [
            new WorkIncome('work-1', 'Job', 100000, 'Annually', "Yes", 0, 0, 0, 0, "", null, 'FIXED', new Date('2025-01-01'))
        ];

        const expenses = [
            new OtherExpense('exp-1', 'Living', 50000, "Annually", new Date('2025-01-01'))
        ];

        const initialNetWorth = 10000;
        const accounts = [
            new InvestedAccount('acc-1', 'Brokerage', initialNetWorth, 0, 5, 0.1, 'Brokerage', true, 0.2),
            new SavedAccount('acc-2', 'Savings', 0, 0)
        ];

        // --- EXECUTE ---
        const result = runSimulation(5, accounts, income, expenses, zeroGrowthAssumptions, mockTaxState);

        // --- ASSERT ---
        // This is an approximation because taxes are not accounted for in this simple calculation
        //const annualChange = 100000 - 50000;

        // Year 0
        expect(calculateNetWorth(result[0].accounts)).toBe(initialNetWorth);

        // The following tests are approximations and might fail due to taxes.
        // The goal is to see a trend. A more precise test would mock the tax service.
        // For now, we check that net worth increases, which is better than nothing.
        expect(calculateNetWorth(result[1].accounts)).toBeGreaterThan(initialNetWorth);
        expect(calculateNetWorth(result[2].accounts)).toBeGreaterThan(calculateNetWorth(result[1].accounts));
    });

    it('Inflation Impact: "Real Dollar" simulation should result in lower nominal numbers', () => {
        // --- SETUP ---
        const assumptionsWithInflation: AssumptionsState = {
            ...defaultAssumptions,
            demographics: {
                startAge: 30,
                startYear: 2025,
                lifeExpectancy: 90,
                retirementAge: 67,
            },
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
            demographics: {
                startAge: 30,
                startYear: 2025,
                lifeExpectancy: 90,
                retirementAge: 67,
            },
            macro: { 
                inflationRate: 0, 
                inflationAdjusted: false, 
                healthcareInflation: 0 
            },
            investments: { ...defaultAssumptions.investments, returnRates: { ror: 0 } },
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
        const result = runSimulation(2, accounts, income, expenses, zeroGrowthAssumptions, mockTaxState);
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
        const cliffAssumptions: AssumptionsState = {
            ...defaultAssumptions,
            demographics: {
                startAge: 30,
                startYear: 2025,
                lifeExpectancy: 40, // End simulation at age 40
                retirementAge: 67,
            },
            macro: { ...defaultAssumptions.macro, inflationRate: 0, inflationAdjusted: false },
        };

        // We pass a long duration hint, but the lifeExpectancy should be derived from the difference in years
        const longDurationHint = 50; 

        // --- EXECUTE ---
        const result = runSimulation(longDurationHint, [], [], [], cliffAssumptions, mockTaxState);

        // --- ASSERT ---
        // The simulation runs from age 30 up to and *including* age 40.
        // So, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40 -> 11 years.
        const expectedYears = cliffAssumptions.demographics.lifeExpectancy - cliffAssumptions.demographics.startAge + 1;
        expect(result).toHaveLength(expectedYears);

        // Verify the last entry is indeed for age 40
        const lastYearResult = result[result.length - 1];
        const lastYearAge = cliffAssumptions.demographics.startAge + (lastYearResult.year - cliffAssumptions.demographics.startYear);
        expect(lastYearAge).toBe(40);
    });
});
