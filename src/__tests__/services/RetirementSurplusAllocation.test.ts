import { describe, it, expect } from 'vitest';
import { simulateOneYear } from '../../components/Objects/Assumptions/SimulationEngine';
import { defaultAssumptions, createBuiltinMilestones, BUILTIN_MILESTONE_IDS } from '../../components/Objects/Assumptions/AssumptionsContext';
import { defaultTaxState } from '../../components/Objects/Taxes/TaxContext';
import { SavedAccount, InvestedAccount } from '../../components/Objects/Accounts/models';
import { FoodExpense, OtherExpense } from '../../components/Objects/Expense/models';
import { type AnyIncome, PassiveIncome } from '../../components/Objects/Income/models';

describe('Fixed Real Withdrawal Strategy', () => {
    it('should only withdraw what is needed for expenses, not force 4% target', () => {
        // Fixed Real should act as a SPENDING CAP, not a forced withdrawal target.
        // If expenses are $57k and 4% target is $68k, only withdraw ~$57k (plus taxes).
        // Don't over-withdraw just to hit the 4% target.
        //
        // Expected behavior:
        // - Withdraw enough to cover expenses + taxes
        // - Do NOT withdraw extra just to hit 4% target
        // - Discretionary cash should be near zero (no surplus from over-withdrawal)

        const birthYear = 2001;  // Age 39 in 2040
        const year = 2040;

        const milestones = createBuiltinMilestones(birthYear, 39, 90);

        const assumptions = {
            ...defaultAssumptions,
            milestones,
            macro: { ...defaultAssumptions.macro, inflationRate: 3 },
            investments: {
                ...defaultAssumptions.investments,
                withdrawalStrategy: 'Fixed Real' as const,
                withdrawalRate: 4,  // 4% = $68k on $1.7M portfolio
                returnRates: { ror: 8, standardDeviation: 12 },
                taxOptimizationEnabled: false,
            },
            withdrawalStrategy: [
                { id: 'w-1', name: 'Checking', accountId: 'acc-capone' },
                { id: 'w-2', name: 'Group', accountId: 'acc-group' },
                { id: 'w-3', name: 'Brokerage', accountId: 'acc-brokerage' },
            ],
            priorities: [
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

        // Accounts - total portfolio ~$1.7M, so 4% = ~$68k
        const savings = new SavedAccount('acc-savings', 'Savings', 55000, 4.0);
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

        // Interest income (reinvested - doesn't add to spendable cash)
        const savingsInterest = new PassiveIncome(
            'inc-interest', 'Savings Interest', 1782, 'Annually',
            'No', 'Interest', new Date('2040-01-01'), undefined, true
        );

        const incomes = [savingsInterest];

        // Living expenses: $57k (less than 4% target of $68k)
        const expense = new FoodExpense(
            'exp-living', 'Living Expenses', 57389, 'Annually', new Date('2040-01-01')
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

        const totalWithdrawals = result.cashflow.withdrawals;
        const discretionaryCash = result.cashflow.discretionary;
        const livingExpenses = result.cashflow.livingExpenses;
        const capitalGainsTax = result.taxDetails.capitalGains;
        const bucketAllocations = result.cashflow.bucketAllocations || 0;

        // NET withdrawals = gross withdrawals - reinvestments
        // This is what actually left the portfolio
        const netWithdrawals = totalWithdrawals - bucketAllocations;

        // Calculate what net withdrawals SHOULD be: expenses + taxes - income
        // Income is reinvested so doesn't contribute to spendable cash
        const expectedNetWithdrawals = livingExpenses + capitalGainsTax;

        // Key assertion: NET withdrawals should be close to expenses + taxes
        // NOT the full 4% target (~$68k)
        // Over-withdrawals are corrected by reinvesting surplus
        expect(
            netWithdrawals,
            `NET withdrawals (gross - reinvested) should match expenses + taxes (~$${expectedNetWithdrawals.toFixed(0)}). ` +
            `Gross: $${totalWithdrawals.toFixed(0)}, Reinvested: $${bucketAllocations.toFixed(0)}, Net: $${netWithdrawals.toFixed(0)}`
        ).toBeLessThan(65000);  // Should be ~$58-60k, not $68k+

        // Discretionary cash should be near zero - surplus was reinvested
        expect(
            Math.abs(discretionaryCash),
            `Discretionary cash should be near zero (surplus reinvested). ` +
            `Got $${discretionaryCash.toFixed(0)}`
        ).toBeLessThan(500);  // Allow for small rounding/tax adjustments
    });

    it('should cap spending at 4% when expenses exceed the target', () => {
        // When expenses exceed 4% target, Fixed Real should cap them
        // This is the existing spending cap behavior - verify it still works

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
                withdrawalRate: 4,  // 4% = $68k on $1.7M portfolio
                returnRates: { ror: 8, standardDeviation: 12 },
                taxOptimizationEnabled: false,
            },
            withdrawalStrategy: [
                { id: 'w-1', name: 'Brokerage', accountId: 'acc-brokerage' },
            ],
            priorities: []
        };

        const taxState = {
            ...defaultTaxState,
            filingStatus: 'Single' as const,
            stateOfResidence: 'Virginia'
        };

        const brokerage = new InvestedAccount(
            'acc-brokerage', 'Brokerage', 1700000,
            500000, 8, 0, 'Brokerage', false, 1.0
        );

        const accounts = [brokerage];
        const incomes: AnyIncome[] = [];

        // Expenses EXCEED 4% target ($80k > $68k)
        // Split into fixed ($30k) and discretionary ($50k) so the cap can trim discretionary
        const fixedExpense = new FoodExpense(
            'exp-fixed', 'Fixed Expenses', 30000, 'Annually', new Date('2040-01-01')
        );
        const discretionaryExpense = new OtherExpense(
            'exp-disc', 'Discretionary', 50000, 'Annually', new Date('2040-01-01')
        );
        discretionaryExpense.isDiscretionary = true;
        const expenses = [fixedExpense, discretionaryExpense];

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

        // When expenses ($80k) exceed the 4% target (~$68k), spending should be capped.
        // V2 caps via the GK budget mechanism — verify expenses were actually reduced.
        const actualLivingExpenses = result.cashflow.livingExpenses;
        const portfolioValue = 1700000;
        const withdrawalRate = 4 / 100;
        const target = portfolioValue * withdrawalRate; // $68,000

        expect(
            actualLivingExpenses,
            `Living expenses ($${actualLivingExpenses.toFixed(0)}) should be capped at ~4% target ($${target.toFixed(0)}), not full $80k`
        ).toBeLessThan(80000);

        // Should be close to the 4% target
        expect(actualLivingExpenses).toBeGreaterThanOrEqual(target * 0.95);
    });
});
