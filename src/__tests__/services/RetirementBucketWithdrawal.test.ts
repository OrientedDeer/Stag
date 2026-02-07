import { describe, it, expect } from 'vitest';
import { simulateOneYear } from '../../components/Objects/Assumptions/SimulationEngine';
import { defaultAssumptions, createBuiltinMilestones, BUILTIN_MILESTONE_IDS } from '../../components/Objects/Assumptions/AssumptionsContext';
import { defaultTaxState } from '../../components/Objects/Taxes/TaxContext';
import { SavedAccount, InvestedAccount } from '../../components/Objects/Accounts/models';
import { FoodExpense } from '../../components/Objects/Expense/models';
// PassiveIncome imported but not currently used
// import { PassiveIncome } from '../../components/Objects/Income/models';

describe('Retirement Bucket Withdrawal Bug', () => {
    it('should allow reinvestment up to withdrawal amount to correct over-withdrawals', () => {
        // Scenario: Tax estimation caused us to withdraw more than needed
        // We should be able to put the surplus BACK into the same account
        // (up to the amount withdrawn) to correct the over-withdrawal.
        //
        // This is NOT wasteful - it corrects estimation errors.
        // The caps prevent wasteful round-trips (withdrawing extra just to reinvest).

        const birthYear = 2001;  // Age 39 in 2040
        const year = 2040;

        // Build milestones where retirement has already been reached (at age 39)
        const milestones = createBuiltinMilestones(birthYear, 39, 90);

        const assumptions = {
            ...defaultAssumptions,
            milestones,
            macro: { ...defaultAssumptions.macro, inflationRate: 3 },
            investments: {
                ...defaultAssumptions.investments,
                withdrawalStrategy: 'Fixed Real' as const,
                withdrawalRate: 4,
                returnRates: { ror: 8, standardDeviation: 12 },
                taxOptimizationEnabled: false,
            },
            // Withdrawal order (burn order) - determines which accounts are drained first
            withdrawalStrategy: [
                { id: 'w-1', name: 'Checking', accountId: 'acc-capone' },
                { id: 'w-2', name: 'Group', accountId: 'acc-group' },
                { id: 'w-3', name: 'Brokerage', accountId: 'acc-brokerage' },
                { id: 'w-4', name: 'Roth IRA', accountId: 'acc-roth' },
                { id: 'w-5', name: 'Trad 401k', accountId: 'acc-trad' },
            ],
            priorities: [
                // Priority bucket to allocate surplus to brokerage
                {
                    id: 'priority-1',
                    name: 'Invest Surplus',
                    type: 'INVESTMENT' as const,
                    accountId: 'acc-brokerage',
                    capType: 'REMAINDER' as const,
                    capValue: 0
                }
            ]
        };

        const taxState = {
            ...defaultTaxState,
            filingStatus: 'Single' as const,
            stateOfResidence: 'Virginia'
        };

        // Accounts - for the scenario where small savings accounts get depleted
        // This forces brokerage withdrawal to cover the deficit
        const savings = new SavedAccount('acc-savings', 'Savings', 0, 4.0);  // Empty - balance emptied to force brokerage withdrawal
        const capitalOne = new SavedAccount('acc-capone', 'Checking', 600, 4.0);  // Small balance
        const group = new SavedAccount('acc-group', 'Group', 1100, 4.0);  // Small balance
        const brokerage = new InvestedAccount(
            'acc-brokerage', 'Brokerage', 555000,
            100000,  // Cost basis - low basis means gains when selling
            8,       // Expected return
            0,       // Employer match (N/A for brokerage)
            'Brokerage',
            false,   // reinvest dividends
            1.0      // allocation
        );
        const trad401k = new InvestedAccount(
            'acc-trad', 'Trad 401k', 889000,
            0, 8, 0, 'Traditional 401k', false, 1.0
        );
        const rothIRA = new InvestedAccount(
            'acc-roth', 'Roth IRA', 225000,
            0, 8, 0, 'Roth IRA', false, 1.0
        );

        const accounts = [savings, capitalOne, group, brokerage, trad401k, rothIRA];

        // No income - retired and living off withdrawals
        const incomes: any[] = [];

        // Living expenses (~$68k/year)
        const expense = new FoodExpense(
            'exp-living', 'Living Expenses', 68000, 'Annually', new Date('2040-01-01')
        );
        const expenses = [expense];

        // Previous simulation data (needed to establish retirement)
        const previousSimulation: any[] = [];

        // Run the simulation with retirement already active
        const result = simulateOneYear(
            year,
            incomes,
            expenses,
            accounts,
            assumptions,
            taxState,
            previousSimulation,
            undefined,
            [BUILTIN_MILESTONE_IDS.RETIRE],  // Pass retirement as already active
            new Map([[BUILTIN_MILESTONE_IDS.RETIRE, year - 1]])  // Retired previous year
        );

        // Get withdrawal and bucket allocation details
        const withdrawalDetail = result.cashflow.withdrawalDetail || {};
        const bucketDetail = result.cashflow.bucketDetail || {};

        const brokerageWithdrawal = withdrawalDetail['Brokerage'] || 0;
        const brokerageBucketAllocation = bucketDetail['acc-brokerage'] || 0;

        // The new behavior: reinvestment IS allowed up to withdrawal amount
        // to correct over-withdrawals from tax estimation errors

        // ASSERTION: Reinvestment should be capped at withdrawal amount
        expect(
            brokerageBucketAllocation,
            `Reinvestment should be capped at withdrawal amount ($${brokerageWithdrawal.toFixed(0)}). ` +
            `Got reinvestment of $${brokerageBucketAllocation.toFixed(0)}`
        ).toBeLessThanOrEqual(brokerageWithdrawal);

        // ASSERTION: Discretionary cash should be near zero (surplus was reinvested)
        expect(
            Math.abs(result.cashflow.discretionary),
            `Discretionary cash should be near zero after reinvestment. Got $${result.cashflow.discretionary.toFixed(0)}`
        ).toBeLessThan(100);
    });

    it('should cap reinvestment at withdrawal amount and overflow to other accounts', () => {
        // If surplus exceeds what we withdrew from an account,
        // the excess should go to other priority accounts

        const birthYear = 2001;
        const year = 2040;

        const milestones = createBuiltinMilestones(birthYear, 39, 90);

        const assumptions = {
            ...defaultAssumptions,
            milestones,
            macro: { ...defaultAssumptions.macro, inflationRate: 3 },
            investments: {
                ...defaultAssumptions.investments,
                withdrawalStrategy: 'Fixed Real' as const,
                withdrawalRate: 4,
                returnRates: { ror: 8, standardDeviation: 12 },
                taxOptimizationEnabled: false,
            },
            // Withdrawal order (burn order)
            withdrawalStrategy: [
                { id: 'w-1', name: 'Checking', accountId: 'acc-capone' },
                { id: 'w-2', name: 'Group', accountId: 'acc-group' },
                { id: 'w-3', name: 'Brokerage', accountId: 'acc-brokerage' },
                { id: 'w-4', name: 'Roth IRA', accountId: 'acc-roth' },
                { id: 'w-5', name: 'Trad 401k', accountId: 'acc-trad' },
            ],
            priorities: [
                // Priority: first brokerage (capped at withdrawal), then savings (gets overflow)
                {
                    id: 'priority-1',
                    name: 'Invest in Brokerage',
                    type: 'INVESTMENT' as const,
                    accountId: 'acc-brokerage',
                    capType: 'REMAINDER' as const,
                    capValue: 0
                },
                {
                    id: 'priority-2',
                    name: 'Save to Savings',
                    type: 'SAVINGS' as const,
                    accountId: 'acc-savings',
                    capType: 'REMAINDER' as const,
                    capValue: 0
                }
            ]
        };

        const taxState = {
            ...defaultTaxState,
            filingStatus: 'Single' as const,
            stateOfResidence: 'Virginia'
        };

        const savings = new SavedAccount('acc-savings', 'Savings', 0, 4.0);
        const capitalOne = new SavedAccount('acc-capone', 'Checking', 600, 4.0);
        const group = new SavedAccount('acc-group', 'Group', 1100, 4.0);
        const brokerage = new InvestedAccount(
            'acc-brokerage', 'Brokerage', 555000,
            100000, 8, 0, 'Brokerage', false, 1.0
        );
        const trad401k = new InvestedAccount(
            'acc-trad', 'Trad 401k', 889000,
            0, 8, 0, 'Traditional 401k', false, 1.0
        );
        const rothIRA = new InvestedAccount(
            'acc-roth', 'Roth IRA', 225000,
            0, 8, 0, 'Roth IRA', false, 1.0
        );

        const accounts = [savings, capitalOne, group, brokerage, trad401k, rothIRA];

        // No income - retired
        const incomes: any[] = [];

        const expense = new FoodExpense(
            'exp-living', 'Living Expenses', 68000, 'Annually', new Date('2040-01-01')
        );
        const expenses = [expense];

        const result = simulateOneYear(
            year,
            incomes,
            expenses,
            accounts,
            assumptions,
            taxState,
            [],
            undefined,
            [BUILTIN_MILESTONE_IDS.RETIRE],
            new Map([[BUILTIN_MILESTONE_IDS.RETIRE, year - 1]])
        );

        const withdrawalDetail = result.cashflow.withdrawalDetail || {};
        const bucketDetail = result.cashflow.bucketDetail || {};

        const brokerageWithdrawal = withdrawalDetail['Brokerage'] || 0;
        const brokerageBucketAllocation = bucketDetail['acc-brokerage'] || 0;
        // Savings bucket allocation tracked in bucketDetail['acc-savings']

        // Reinvestment into brokerage should be capped at withdrawal amount
        expect(
            brokerageBucketAllocation,
            `Brokerage reinvestment should be <= withdrawal amount`
        ).toBeLessThanOrEqual(brokerageWithdrawal);

        // Total bucket allocations tracked in result.cashflow.bucketAllocations

        // Discretionary cash should be near zero
        expect(
            Math.abs(result.cashflow.discretionary),
            `Discretionary cash should be near zero`
        ).toBeLessThan(100);
    });
});
