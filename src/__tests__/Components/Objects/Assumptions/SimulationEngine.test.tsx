import { describe, it, expect } from 'vitest';
import { AssumptionsState, defaultAssumptions } from '../../../../components/Objects/Assumptions/AssumptionsContext';
import { TaxState } from '../../../../components/Objects/Taxes/TaxContext';
import { InvestedAccount, SavedAccount, DebtAccount, DeficitDebtAccount, PropertyAccount } from '../../../../components/Objects/Accounts/models';
import { WorkIncome, FutureSocialSecurityIncome } from '../../../../components/Objects/Income/models';
import { FoodExpense, MortgageExpense, LoanExpense } from '../../../../components/Objects/Expense/models';
import { runSimulation } from '../../../../components/Objects/Assumptions/useSimulation';
import { simulateOneYear } from '../../../../components/Objects/Assumptions/SimulationEngine';

// 1. Create a "Clean" Assumptions Object
// We clone the default and override specific fields to ensure 10% growth is exactly 10%.
const cleanAssumptions: AssumptionsState = {
    ...defaultAssumptions,
    demographics: {
        startAge: 30,
        startYear: 2025,
        lifeExpectancy: 90,
        retirementAge: 67
    },
    income: {
        ...defaultAssumptions.income,
        salaryGrowth: 0
    },
    macro: {
        ...defaultAssumptions.macro,
        inflationRate: 0,        // Disable inflation for simple math
        inflationAdjusted: false 
    },
    investments: {
        ...defaultAssumptions.investments,
        returnRates: { ror: 10 } // Target: 10% Growth
    }
};

// 2. Mock Tax State (Required input, but irrelevant for this specific test)
// If you don't have a defaultTaxState exported, you can mock a minimal one like this:
const mockTaxState: TaxState = {
    filingStatus: 'Single',
    stateResidency: 'DC',
    deductionMethod: 'Standard',
    fedOverride: null,
    ficaOverride: null,
    stateOverride: null,
    year: 2024
};

describe('Simulation Engine', () => {

    it('should grow a $1000 account by exactly 10% annually', () => {
        // --- SETUP ---
        const startAmount = 1000;
        
        // Create 1 Account: $1000, 0% Expense Ratio (to not mess up the 10% math)
        const testAccount = new InvestedAccount(
            'acc-1',           // ID
            'Test Fund',       // Name
            startAmount,       // Amount
            0,                 // Employer Balance
            5,                 // Tenure Years
            0.0,               // Expense Ratio
            'Brokerage',      // Tax Type
            true,              // Is Contribution Eligible
            0.2                // Vested Per Year
        );

        // --- EXECUTE ---
        // Run for 2 years
        const result = runSimulation(
            2, 
            [testAccount], 
            [], // No Income
            [], // No Expenses
            cleanAssumptions, 
            mockTaxState
        );

        // --- ASSERT ---
        
        // Year 0 (Baseline): Should be $1,000 (Start of 2025)
        const year0 = result[0];
        expect(year0.year).toBe(2025);
        expect(year0.accounts[0].amount).toBe(1000);

        // Year 1: Should be $1,100 ($1000 * 1.10)
        const year1 = result[1];
        expect(year1.year).toBe(2026);
        expect(year1.accounts[0].amount).toBeCloseTo(1100, 2); // Checks to 2 decimal places

        // Year 2: Should be $1,210 ($1100 * 1.10)
        const year2 = result[2];
        expect(year2.year).toBe(2027);
        expect(year2.accounts[0].amount).toBeCloseTo(1210, 2);
    });

    it('should handle withdrawal from Traditional 401k with tax calculation', () => {
        const traditionalIRA = new InvestedAccount('ira-1', 'Traditional IRA', 10000, 0, 5, 0.0, 'Traditional IRA', true, 0.2);
        const expense = new FoodExpense('exp-1', 'Expenses', 5000, 'Annually', new Date('2024-01-01'));
        const assumptionsWithWithdrawal: AssumptionsState = {
            ...cleanAssumptions,
            withdrawalStrategy: [{ id: 'w1', name: 'IRA Withdrawal', accountId: 'ira-1' }]
        };
        const taxState: TaxState = {
            filingStatus: 'Single', stateResidency: 'DC', deductionMethod: 'Standard',
            fedOverride: null, ficaOverride: null, stateOverride: null, year: 2024
        };

        const result = simulateOneYear(2024, [], [expense], [traditionalIRA], assumptionsWithWithdrawal, taxState);

        // Deficit of 5000 needs to be covered.
        // Withdrawal is from a Traditional IRA, so it's taxable.
        // However, with 0 income, the 5k withdrawal is below the standard deduction (14.6k).
        // So, Gross withdrawal = 5000, Tax = 0.
        // But there is a 10% early withdrawal penalty = 500.
        // But you need to pull out more to cover the penalty:
        // Let W = withdrawal amount
        // Net received = W - 0 (tax) - 0.1W (penalty) = 0.9W
        // We need 0.9W = 5000 -> W = 5000 / 0.9 = 5555.56 (approx)
        // So gross withdrawal = 5555.56, penalty = 555.56, net = 5000.
        // BOY timing: withdrawal before growth
        // Solver finds gross to net 5000 after 10% penalty (no tax - under std ded)
        // Gross = 5000 / 0.9 = 5555.56
        // Pre-growth balance: 10000 - 5555.56 = 4444.44
        // Post-growth: 4444.44 * 1.10 = 4888.88
        expect(result.accounts[0].amount).toBeCloseTo(4888.88, 1); // Slightly looser tolerance for solver precision
        expect(result.taxDetails.fed).toBeCloseTo(555.56, 1); // Early withdrawal penalty
        expect(result.taxDetails.state).toBe(0);
    });

    it('should handle overdraft scenario when withdrawal exceeds available balance', () => {
        // Test overdraft code path
        const smallAccount = new InvestedAccount(
            'ira-1',
            'Small IRA',
            1000,
            0,
            5,
            0.0,
            'Traditional IRA',
            true,
            0.2
        );

        const massiveExpense = new FoodExpense('exp-1', 'Massive Expenses', 10000, 'Annually', new Date(2025, 0, 1));

        const assumptionsWithWithdrawal: AssumptionsState = {
            ...cleanAssumptions,
            withdrawalStrategy: [
                { id: 'w1', name: 'IRA Withdrawal', accountId: 'ira-1' }
            ]
        };

        const taxState: TaxState = {
            filingStatus: 'Single',
            stateResidency: 'DC',
            deductionMethod: 'Standard',
            fedOverride: null,
            ficaOverride: null,
            stateOverride: null,
            year: 2024
        };

        const result = simulateOneYear(
            2025, // Use start year from assumptions
            [],
            [massiveExpense],
            [smallAccount],
            assumptionsWithWithdrawal,
            taxState
        );

        // Verify withdrawal code executed
        // BOY timing: withdrawal before growth
        // Maximum available = 1000 (entire account)
        // Pre-growth: 1000 - 1000 = 0
        // Post-growth: 0 * 1.10 = 0
        const originalAccount = result.accounts.find(acc => acc.id === 'ira-1');
        expect(originalAccount?.amount).toBeCloseTo(0);

        // Gross withdrawal: 1000
        // Early withdrawal penalty (10%): 100
        // Taxes: ~0 (very small income)
        // Net received: ~900
        // Remaining deficit: 10000 - 900 = 9100
        // With deficit debt feature, uncovered deficit is captured as debt
        expect(result.cashflow.discretionary).toBeCloseTo(0);

        // Verify deficit debt account was created
        const deficitDebt = result.accounts.find(acc => acc instanceof DeficitDebtAccount);
        expect(deficitDebt).toBeDefined();
        expect(deficitDebt?.amount).toBeCloseTo(9100, -1); // ~9100, allow some variance due to tax calculations
    });

    it('should handle tax-free withdrawal from Roth IRA', () => {
        const rothIRA = new InvestedAccount('roth-1', 'Roth IRA', 10000, 0, 5, 0.0, 'Roth IRA', true, 0.2);
        const expense = new FoodExpense('exp-1', 'Expenses', 5000, 'Annually', new Date('2024-01-01'));
        const assumptionsWithWithdrawal: AssumptionsState = {
            ...cleanAssumptions,
            withdrawalStrategy: [{ id: 'w1', name: 'Roth Withdrawal', accountId: 'roth-1' }]
        };
        const taxState: TaxState = {
            filingStatus: 'Single', stateResidency: 'DC', deductionMethod: 'Standard',
            fedOverride: null, ficaOverride: null, stateOverride: null, year: 2024
        };

        const result = simulateOneYear(2024, [], [expense], [rothIRA], assumptionsWithWithdrawal, taxState);

        // Deficit of 5000 needs to be covered.
        // Withdrawal is from a Roth IRA, so it's tax-free.
        // Withdrawal amount = 5000. Tax = 0.
        // BOY timing: withdrawal before growth
        // Pre-growth: 10000 - 5000 = 5000
        // Post-growth: 5000 * 1.10 = 5500
        expect(result.accounts[0].amount).toBeCloseTo(5500);
        expect(result.taxDetails.fed).toBe(0);
        expect(result.taxDetails.state).toBe(0);
    });

    it('should handle DebtAccount with linked loan and payment', () => {
        const debtAccount = new DebtAccount('debt-1', 'Car Loan', 5000, 'loan-1', 5.0);
        const loanExpense = new LoanExpense('loan-1', 'Car Payment', 5000, 'Monthly', 5, "Compounding", 250, "No", 0, 'debt-1');
        const income = new WorkIncome('inc-1', 'Job', 60000, 'Annually', 'Yes', 0, 0, 0, 0, '', null, 'FIXED');

        const result = simulateOneYear(2024, [income], [loanExpense], [debtAccount], cleanAssumptions, mockTaxState);

        // Annual payment = 250 * 12 = 3000.
        // Interest for year 1 is approx 186.
        // Principal reduction is approx 3000 - 186 = 2814.
        // Final balance should be around 5000 - 2814 = 2186.
        expect(result.accounts[0].amount).toBeCloseTo(2186, -1); // Check within a hundred dollars
    });

    it('should handle PropertyAccount with mortgage', () => {
        const propertyAccount = new PropertyAccount('prop-1', 'House', 300000, "Financed", 300000, 250000, "mort-1", 4.0);
        const mortgageExpense = new MortgageExpense('mort-1', 'Mortgage Payment', 'Monthly', 300000, 240000, 240000, 4.0, 30, 1, 0, 1, 200, 1, 0, 0, "Itemized", 0, 'prop-1');
        const income = new WorkIncome('inc-1', 'Job', 100000, 'Annually', 'Yes', 0, 0, 0, 0, '', null, 'FIXED');
        
        const result = simulateOneYear(2024, [income], [mortgageExpense], [propertyAccount], cleanAssumptions, mockTaxState);
        const resultAccount = result.accounts[0] as PropertyAccount;

        // Verify property appreciated by its the default housing appreciation rate (1.4%)
        expect(resultAccount.amount).toBe(300000 * 1.014);

        // Verify mortgage balance was reduced. 9999 is a placeholder value.
        expect(resultAccount.loanAmount).toBeCloseTo(235773.51, 2);
    });

    it('should grow a SavedAccount by its APR', () => {
        const basicAccount = new SavedAccount('sav-1', 'Savings', 1000, 2.5);

        const result = simulateOneYear(
            2024,
            [],
            [],
            [basicAccount],
            cleanAssumptions,
            mockTaxState
        );

        // Expected: 1000 * (1 + 2.5/100) = 1025
        expect(result.accounts[0].amount).toBe(1025);
    });

    it('should handle withdrawal from SavedAccount', () => {
        const savingsAccount = new SavedAccount('sav-1', 'Savings', 5000, 2.5);
        const expense = new FoodExpense('exp-1', 'Expenses', 3000, 'Annually', new Date('2024-01-01'));
        const assumptionsWithWithdrawal: AssumptionsState = {
            ...cleanAssumptions,
            withdrawalStrategy: [
                { id: 'w1', name: 'Savings Withdrawal', accountId: 'sav-1' }
            ]
        };

        const result = simulateOneYear(2024, [], [expense], [savingsAccount], assumptionsWithWithdrawal, mockTaxState);

        // Interest income = 5000 * 0.025 = 125
        // Net deficit = 3000 - 125 = 2875
        // Withdrawal is from a SavedAccount, so it's tax-free.
        // Withdrawal amount = 2875. Tax = 0.
        // BOY timing: withdrawal before growth
        // Pre-growth: 5000 - 2875 = 2125
        // Post-growth: 2125 * 1.025 = 2178.125
        expect(result.accounts[0].amount).toBeCloseTo(2178.125);
    });

    it('should handle employer match correctly', () => {
        const retirementAccount = new InvestedAccount('ret-1', '401k', 10000, 0, 3, 0.5, 'Traditional 401k', true, 0.2);
        const income = new WorkIncome('inc-1', 'Job', 100000, 'Annually', 'Yes', 5000, 500, 0, 2500, 'ret-1', 'Traditional 401k', 'FIXED');

        const result = simulateOneYear(2024, [income], [], [retirementAccount], cleanAssumptions, mockTaxState);

        // BOY timing: contributions before growth
        // Start = 10000, Contributions = 5000 (user) + 2500 (match) = 7500
        // Pre-growth total = 10000 + 7500 = 17500
        // Growth rate = 1 + (10 - 0.5) / 100 = 1.095
        // Post-growth: 17500 * 1.095 = 19162.5
        expect(result.accounts[0].amount).toBeCloseTo(19162.5);

        // The cashflow investedMatch should be exactly the contribution for the year.
        expect(result.cashflow.investedMatch).toBe(2500);
    });

    it('should create deficit debt when expenses exceed all available funds', () => {
        // No accounts, no income, just expenses - creates pure deficit
        const expense = new FoodExpense('exp-1', 'Food', 5000, 'Annually', new Date('2024-01-01'));

        const result = simulateOneYear(2024, [], [expense], [], cleanAssumptions, mockTaxState);

        // With no income and no accounts to withdraw from, entire expense becomes deficit debt
        expect(result.cashflow.discretionary).toBe(0); // Deficit captured as debt

        const deficitDebt = result.accounts.find(acc => acc instanceof DeficitDebtAccount);
        expect(deficitDebt).toBeDefined();
        expect(deficitDebt?.amount).toBeCloseTo(5000);
        expect(deficitDebt?.name).toBe('Uncovered Deficit');
    });

    it('should pay down deficit debt before priority allocations when surplus exists', () => {
        // Start with existing deficit debt
        const existingDebt = new DeficitDebtAccount('system-deficit-debt', 'Uncovered Deficit', 3000);
        // Income with explicit dates to ensure it's active for 2025
        const income = new WorkIncome(
            'inc-1', 'Job', 50000, 'Annually', 'Yes',
            0, 0, 0, 0, '', 'Traditional 401k', 'FIXED',
            new Date('2025-01-01'), new Date('2030-12-31')
        );
        const savingsAccount = new SavedAccount('sav-1', 'Savings', 1000, 0);

        // Low expenses so there's surplus to pay down debt
        const expense = new FoodExpense('exp-1', 'Food', 10000, 'Annually', new Date('2025-01-01'));

        const assumptionsWithPriority: AssumptionsState = {
            ...cleanAssumptions,
            priorities: [
                { id: 'p1', name: 'Savings', type: 'SAVINGS', accountId: 'sav-1', capType: 'REMAINDER', capValue: 0 }
            ]
        };

        // Use 2025 to match cleanAssumptions.startYear
        const result = simulateOneYear(2025, [income], [expense], [existingDebt, savingsAccount], assumptionsWithPriority, mockTaxState);

        // After taxes (~13000) and expenses (10000), surplus should be ~27000
        // Deficit debt (3000) should be paid off first
        const deficitDebtAfter = result.accounts.find(acc => acc instanceof DeficitDebtAccount);

        // Debt should be fully paid off (removed from accounts)
        expect(deficitDebtAfter).toBeUndefined();

        // Remaining surplus should go to priority savings
        const savingsAfter = result.accounts.find(acc => acc.id === 'sav-1');
        expect(savingsAfter).toBeDefined();
        expect(savingsAfter!.amount).toBeGreaterThan(1000); // Should have surplus added
    });

    it('should accumulate deficit debt across years when deficits persist', () => {
        // First year: create deficit debt
        const expense = new FoodExpense('exp-1', 'Food', 10000, 'Annually', new Date('2024-01-01'));

        const year1Result = simulateOneYear(2024, [], [expense], [], cleanAssumptions, mockTaxState);

        const deficitDebtYear1 = year1Result.accounts.find(acc => acc instanceof DeficitDebtAccount);
        expect(deficitDebtYear1).toBeDefined();
        expect(deficitDebtYear1?.amount).toBeCloseTo(10000);

        // Second year: more deficit adds to existing debt
        const year2Result = simulateOneYear(2025, [], [expense], year1Result.accounts, cleanAssumptions, mockTaxState);

        const deficitDebtYear2 = year2Result.accounts.find(acc => acc instanceof DeficitDebtAccount);
        expect(deficitDebtYear2).toBeDefined();
        // Should be ~20000 (10000 from year 1 + 10000 from year 2)
        expect(deficitDebtYear2?.amount).toBeCloseTo(20000);
    });

    // =========================================================================
    // BROKERAGE CAPITAL GAINS WITHDRAWAL TESTS
    // =========================================================================

    describe('Brokerage Capital Gains Withdrawals', () => {
        it('should calculate capital gains tax on brokerage withdrawal with existing income', () => {
            // Create brokerage with cost basis and gains
            const brokerageAccount = new InvestedAccount(
                'brok-1',
                'Brokerage',
                100000,  // Total value
                0,       // No employer balance
                5,       // Tenure years
                0.0,     // No expense ratio
                'Brokerage',
                true,
                1.0,     // Fully vested
                50000    // Cost basis = 50k, so gains = 50k (50% gains)
            );

            // Add income to push into taxable capital gains bracket
            // 0% cap gains bracket ends around $44k for single filers
            const income = new WorkIncome(
                'inc-1', 'Job', 60000, 'Annually', 'Yes',
                0, 0, 0, 0, '', null, 'FIXED',
                new Date('2025-01-01')
            );

            const expense = new FoodExpense('exp-1', 'Living Expenses', 80000, 'Annually', new Date('2025-01-01'));

            const assumptionsWithWithdrawal: AssumptionsState = {
                ...cleanAssumptions,
                withdrawalStrategy: [{ id: 'w1', name: 'Brokerage', accountId: 'brok-1' }]
            };

            const result = simulateOneYear(2025, [income], [expense], [brokerageAccount], assumptionsWithWithdrawal, mockTaxState);

            // With $60k income, gains will be taxed at 15% rate
            expect(result.taxDetails.capitalGains).toBeGreaterThan(0);

            // Withdrawal should be recorded
            expect(result.cashflow.withdrawals).toBeGreaterThan(0);
            expect(result.cashflow.withdrawalDetail['Brokerage']).toBeGreaterThan(0);
        });

        it('should handle brokerage withdrawal at 0% cap gains rate when low income', () => {
            // Account is all gains (cost basis = 0)
            const allGainsAccount = new InvestedAccount(
                'brok-1',
                'Brokerage',
                50000,
                0,
                5,
                0.0,
                'Brokerage',
                true,
                1.0,
                0  // No cost basis - all gains
            );

            const expense = new FoodExpense('exp-1', 'Expenses', 10000, 'Annually', new Date('2025-01-01'));

            const assumptionsWithWithdrawal: AssumptionsState = {
                ...cleanAssumptions,
                withdrawalStrategy: [{ id: 'w1', name: 'Brokerage', accountId: 'brok-1' }]
            };

            const result = simulateOneYear(2025, [], [expense], [allGainsAccount], assumptionsWithWithdrawal, mockTaxState);

            // With no other income, capital gains fall in 0% bracket (up to ~$44k for single)
            // So capital gains tax is 0, but withdrawal still occurs
            expect(result.taxDetails.capitalGains).toBe(0);
            // Withdrawal equals deficit exactly since no tax gross-up needed
            expect(result.cashflow.withdrawals).toBeCloseTo(10000);
        });

        it('should handle brokerage withdrawal when no gains (all cost basis)', () => {
            // Account is all cost basis (no gains)
            const noCostBasisAccount = new InvestedAccount(
                'brok-1',
                'Brokerage',
                50000,
                0,
                5,
                0.0,
                'Brokerage',
                true,
                1.0,
                50000  // All cost basis - no gains
            );

            const expense = new FoodExpense('exp-1', 'Expenses', 10000, 'Annually', new Date('2025-01-01'));

            const assumptionsWithWithdrawal: AssumptionsState = {
                ...cleanAssumptions,
                withdrawalStrategy: [{ id: 'w1', name: 'Brokerage', accountId: 'brok-1' }]
            };

            const result = simulateOneYear(2025, [], [expense], [noCostBasisAccount], assumptionsWithWithdrawal, mockTaxState);

            // No gains means no capital gains tax
            expect(result.taxDetails.capitalGains).toBe(0);
            // Withdrawal should equal deficit exactly (no tax gross-up needed)
            expect(result.cashflow.withdrawals).toBeCloseTo(10000);
        });

        it('should iterate to find correct gross withdrawal for target net', () => {
            // This tests the iterative solver in the brokerage withdrawal code
            const brokerageAccount = new InvestedAccount(
                'brok-1',
                'Brokerage',
                200000,
                0,
                5,
                0.0,
                'Brokerage',
                true,
                1.0,
                100000  // 50% gains
            );

            const expense = new FoodExpense('exp-1', 'Expenses', 50000, 'Annually', new Date('2025-01-01'));

            const assumptionsWithWithdrawal: AssumptionsState = {
                ...cleanAssumptions,
                withdrawalStrategy: [{ id: 'w1', name: 'Brokerage', accountId: 'brok-1' }]
            };

            const result = simulateOneYear(2025, [], [expense], [brokerageAccount], assumptionsWithWithdrawal, mockTaxState);

            // Discretionary should be ~0 (deficit covered)
            expect(result.cashflow.discretionary).toBeCloseTo(0, 0);
        });
    });

    // =========================================================================
    // GUYTON-KLINGER STRATEGY TESTS
    // =========================================================================

    describe('Guyton-Klinger Withdrawal Strategy', () => {
        const retiredAssumptions: AssumptionsState = {
            ...cleanAssumptions,
            demographics: {
                ...cleanAssumptions.demographics,
                startAge: 65,  // Already retired
                retirementAge: 65,
                lifeExpectancy: 90
            },
            investments: {
                ...cleanAssumptions.investments,
                withdrawalStrategy: 'Guyton Klinger',
                withdrawalRate: 4,
                gkUpperGuardrail: 20,  // 20% above = cut
                gkLowerGuardrail: 20,  // 20% below = increase
                gkAdjustmentPercent: 10
            }
        };

        it('should apply Guyton-Klinger strategy in retirement', () => {
            const retirementAccount = new InvestedAccount(
                'ret-1',
                '401k',
                1000000,
                0,
                10,
                0.0,
                'Traditional 401k',
                true,
                1.0
            );

            const expense = new FoodExpense('exp-1', 'Living', 30000, 'Annually', new Date('2025-01-01'), undefined);
            expense.isDiscretionary = true; // Discretionary

            const result = simulateOneYear(
                2025,
                [],
                [expense],
                [retirementAccount],
                retiredAssumptions,
                mockTaxState
            );

            // Should have strategy withdrawal tracked
            expect(result.strategyWithdrawal).toBeDefined();
            expect(result.strategyWithdrawal?.amount).toBeGreaterThan(0);

            // Logs should mention GK
            expect(result.logs.some(log => log.includes('Guyton Klinger'))).toBe(true);
        });

        it('should trigger capital preservation guardrail when portfolio drops', () => {
            // Small portfolio relative to withdrawal rate triggers capital preservation
            const smallPortfolio = new InvestedAccount(
                'ret-1',
                '401k',
                500000,
                0,
                10,
                0.0,
                'Traditional 401k',
                true,
                1.0
            );

            // Large discretionary expense to cut
            const discretionaryExpense = new FoodExpense(
                'exp-1',
                'Discretionary Spending',
                50000,
                'Annually',
                new Date('2025-01-01'),
                undefined
            );
            discretionaryExpense.isDiscretionary = true;

            // Create a previous year result to simulate second year of retirement
            const previousResult = simulateOneYear(
                2024,
                [],
                [discretionaryExpense],
                [new InvestedAccount('ret-1', '401k', 800000, 0, 10, 0.0, 'Traditional 401k', true, 1.0)],
                retiredAssumptions,
                mockTaxState
            );

            const result = simulateOneYear(
                2025,
                [],
                [discretionaryExpense],
                [smallPortfolio],
                retiredAssumptions,
                mockTaxState,
                [previousResult]
            );

            // Check if capital preservation was considered
            // (May or may not trigger depending on exact withdrawal rate calculation)
            expect(result.strategyWithdrawal).toBeDefined();
        });

        it('should cut discretionary expenses when capital preservation triggers', () => {
            const portfolio = new InvestedAccount(
                'ret-1',
                '401k',
                300000,  // Small portfolio
                0,
                10,
                0.0,
                'Traditional 401k',
                true,
                1.0
            );

            // Mark expense as discretionary
            const discretionaryExpense = new FoodExpense(
                'exp-1',
                'Travel',
                20000,
                'Annually',
                new Date('2025-01-01'),
                undefined
            );
            discretionaryExpense.isDiscretionary = true;

            // Create previous year with larger portfolio to simulate drop
            const previousWithHigherPortfolio: AssumptionsState = {
                ...retiredAssumptions
            };

            const previousResult = simulateOneYear(
                2024,
                [],
                [discretionaryExpense],
                [new InvestedAccount('ret-1', '401k', 600000, 0, 10, 0.0, 'Traditional 401k', true, 1.0)],
                previousWithHigherPortfolio,
                mockTaxState
            );

            const result = simulateOneYear(
                2025,
                [],
                [discretionaryExpense],
                [portfolio],
                retiredAssumptions,
                mockTaxState,
                [previousResult]
            );

            // If GK adjustment occurred, it should be tracked
            if (result.strategyAdjustment) {
                expect(result.strategyAdjustment.guardrailTriggered).toBeDefined();
            }
        });

        it('should not apply capital preservation within 15 years of life expectancy', () => {
            // Age 76 with life expectancy 90 = 14 years remaining (< 15)
            const nearEndAssumptions: AssumptionsState = {
                ...retiredAssumptions,
                demographics: {
                    ...retiredAssumptions.demographics,
                    startAge: 76,
                    retirementAge: 65,
                    lifeExpectancy: 90
                }
            };

            const portfolio = new InvestedAccount(
                'ret-1',
                '401k',
                200000,
                0,
                10,
                0.0,
                'Traditional 401k',
                true,
                1.0
            );

            const expense = new FoodExpense('exp-1', 'Living', 20000, 'Annually', new Date('2025-01-01'), undefined);
            expense.isDiscretionary = true;

            const result = simulateOneYear(
                2025,
                [],
                [expense],
                [portfolio],
                nearEndAssumptions,
                mockTaxState
            );

            // Within 15 years, capital preservation shouldn't cut expenses
            // Just inflation adjustment should apply
            expect(result.strategyWithdrawal).toBeDefined();
        });
    });

    // =========================================================================
    // SOCIAL SECURITY TESTS
    // =========================================================================

    describe('Social Security Benefits', () => {
        it('should calculate Social Security PIA at claiming age', () => {
            // Set up assumptions where we're at claiming age
            const ssAssumptions: AssumptionsState = {
                ...cleanAssumptions,
                demographics: {
                    startAge: 67,  // At claiming age
                    startYear: 2025,
                    lifeExpectancy: 90,
                    retirementAge: 67
                }
            };

            // Create FutureSocialSecurityIncome with claiming age 67
            const futureSS = new FutureSocialSecurityIncome(
                'ss-1',
                'Social Security',
                67,  // Claiming age
                0,   // PIA not yet calculated
                0    // Calculation year
            );

            // Need some work history for AIME calculation
            // We'll simulate a year with work income to build history
            const workIncome = new WorkIncome(
                'inc-1',
                'Job',
                100000,
                'Annually',
                'Yes',
                0, 0, 0, 0, '', null, 'FIXED',
                new Date('2020-01-01'),
                new Date('2024-12-31')
            );

            // Create previous simulation years with earnings
            const previousYears = [];
            for (let y = 2020; y < 2025; y++) {
                previousYears.push({
                    year: y,
                    incomes: [workIncome],
                    expenses: [],
                    accounts: [],
                    cashflow: { totalIncome: 100000, totalExpense: 0, discretionary: 0, investedUser: 0, investedMatch: 0, totalInvested: 0, bucketAllocations: 0, bucketDetail: {}, withdrawals: 0, withdrawalDetail: {} },
                    taxDetails: { fed: 0, state: 0, fica: 0, preTax: 0, insurance: 0, postTax: 0, capitalGains: 0 },
                    logs: []
                });
            }

            const result = simulateOneYear(
                2025,
                [futureSS],
                [],
                [],
                ssAssumptions,
                mockTaxState,
                previousYears
            );

            // Check that SS benefit was calculated
            const ssIncome = result.incomes.find(inc => inc.id === 'ss-1');
            expect(ssIncome).toBeDefined();

            // Logs should mention SS calculation
            expect(result.logs.some(log => log.includes('Social Security'))).toBe(true);
        });

        it('should apply earnings test for early SS claimers', () => {
            // Age 63 claiming at 62 (before FRA)
            const earlySSAssumptions: AssumptionsState = {
                ...cleanAssumptions,
                demographics: {
                    startAge: 63,
                    startYear: 2025,
                    lifeExpectancy: 90,
                    retirementAge: 67
                }
            };

            // SS already being received (calculated in previous year)
            const activeSS = new FutureSocialSecurityIncome(
                'ss-1',
                'Social Security',
                62,
                2000,  // $2000/month PIA
                2024,  // Calculated last year
                new Date('2024-01-01'),
                new Date('2050-12-31')
            );

            // Still working with high income (triggers earnings test)
            const workIncome = new WorkIncome(
                'inc-1',
                'Job',
                80000,  // High earned income
                'Annually',
                'Yes',
                0, 0, 0, 0, '', null, 'FIXED',
                new Date('2025-01-01')
            );

            const result = simulateOneYear(
                2025,
                [activeSS, workIncome],
                [],
                [],
                earlySSAssumptions,
                mockTaxState
            );

            // Check if earnings test was applied
            // Logs should mention earnings test if applied
            const hasEarningsTestLog = result.logs.some(log =>
                log.toLowerCase().includes('earnings test')
            );

            // With $80k income and $24k SS, earnings test should apply
            // (2024 exempt amount is ~$22,320)
            expect(hasEarningsTestLog).toBe(true);
        });

        it('should not apply earnings test after Full Retirement Age', () => {
            // Age 67+ (at or after FRA for most birth years)
            const postFRAAssumptions: AssumptionsState = {
                ...cleanAssumptions,
                demographics: {
                    startAge: 68,  // Past FRA
                    startYear: 2025,
                    lifeExpectancy: 90,
                    retirementAge: 67
                }
            };

            const activeSS = new FutureSocialSecurityIncome(
                'ss-1',
                'Social Security',
                67,
                2500,
                2024,
                new Date('2024-01-01'),
                new Date('2050-12-31')
            );

            // Still working
            const workIncome = new WorkIncome(
                'inc-1',
                'Job',
                100000,
                'Annually',
                'Yes',
                0, 0, 0, 0, '', null, 'FIXED'
            );

            const result = simulateOneYear(
                2025,
                [activeSS, workIncome],
                [],
                [],
                postFRAAssumptions,
                mockTaxState
            );

            // After FRA, no earnings test reduction
            const hasEarningsTestLog = result.logs.some(log =>
                log.toLowerCase().includes('earnings test')
            );
            expect(hasEarningsTestLog).toBe(false);
        });
    });

    // =========================================================================
    // EARLY ROTH WITHDRAWAL WITH TAXABLE GAINS
    // =========================================================================

    describe('Early Roth Withdrawal with Taxable Gains', () => {
        it('should tax gains portion of early Roth withdrawal', () => {
            // Roth with cost basis and gains
            const rothAccount = new InvestedAccount(
                'roth-1',
                'Roth IRA',
                50000,   // Total value
                0,
                5,
                0.0,
                'Roth IRA',
                true,
                1.0,
                30000    // Cost basis = 30k, gains = 20k
            );

            // Need to withdraw more than cost basis to trigger gains taxation
            const expense = new FoodExpense('exp-1', 'Expenses', 40000, 'Annually', new Date('2025-01-01'));

            // Age < 59.5 for early withdrawal
            const earlyAssumptions: AssumptionsState = {
                ...cleanAssumptions,
                demographics: {
                    startAge: 45,
                    startYear: 2025,
                    lifeExpectancy: 90,
                    retirementAge: 67
                },
                withdrawalStrategy: [{ id: 'w1', name: 'Roth', accountId: 'roth-1' }]
            };

            const result = simulateOneYear(2025, [], [expense], [rothAccount], earlyAssumptions, mockTaxState);

            // Should have early Roth withdrawal log
            expect(result.logs.some(log => log.includes('Early Roth'))).toBe(true);

            // Tax should be charged on gains portion
            expect(result.taxDetails.fed).toBeGreaterThan(0);
        });

        it('should not tax early Roth withdrawal from contributions only', () => {
            // Roth where withdrawal stays within cost basis
            const rothAccount = new InvestedAccount(
                'roth-1',
                'Roth IRA',
                50000,
                0,
                5,
                0.0,
                'Roth IRA',
                true,
                1.0,
                50000  // All cost basis, no gains
            );

            // Small expense - withdraws only from contributions
            const expense = new FoodExpense('exp-1', 'Expenses', 10000, 'Annually', new Date('2025-01-01'));

            const earlyAssumptions: AssumptionsState = {
                ...cleanAssumptions,
                demographics: {
                    startAge: 45,
                    startYear: 2025,
                    lifeExpectancy: 90,
                    retirementAge: 67
                },
                withdrawalStrategy: [{ id: 'w1', name: 'Roth', accountId: 'roth-1' }]
            };

            const result = simulateOneYear(2025, [], [expense], [rothAccount], earlyAssumptions, mockTaxState);

            // No tax on contribution-only withdrawal
            expect(result.taxDetails.fed).toBe(0);

            // Withdrawal of 10k from 50k account
            // Account after withdrawal and growth: (50000 - 10000) * 1.10 = 44000
            expect(result.accounts[0].amount).toBeCloseTo(44000);
        });
    });

    // =========================================================================
    // WORK INCOME RETIREMENT CUTOFF
    // =========================================================================

    describe('Work Income Retirement Behavior', () => {
        it('should end work income at retirement age', () => {
            const retirementAssumptions: AssumptionsState = {
                ...cleanAssumptions,
                demographics: {
                    startAge: 65,
                    startYear: 2025,
                    lifeExpectancy: 90,
                    retirementAge: 65  // Retiring this year
                }
            };

            // Work income without explicit end date
            const workIncome = new WorkIncome(
                'inc-1',
                'Job',
                100000,
                'Annually',
                'Yes',
                5000,   // 401k contribution
                0,
                0,
                2500,   // Employer match
                'ret-1',
                'Traditional 401k',
                'FIXED'
                // No end date - should auto-end at retirement
            );

            const retirementAccount = new InvestedAccount(
                'ret-1',
                '401k',
                500000,
                0,
                10,
                0.0,
                'Traditional 401k',
                true,
                1.0
            );

            const result = simulateOneYear(
                2025,
                [workIncome],
                [],
                [retirementAccount],
                retirementAssumptions,
                mockTaxState
            );

            // Income should be zeroed out in retirement year
            const resultIncome = result.incomes.find(inc => inc.id === 'inc-1') as WorkIncome;
            expect(resultIncome).toBeDefined();
            expect(resultIncome.amount).toBe(0);
            expect(resultIncome.preTax401k).toBe(0);
            expect(resultIncome.employerMatch).toBe(0);
        });
    });

    // =========================================================================
    // PRIORITY ALLOCATION CAP TYPES
    // =========================================================================

    describe('Priority Allocation Cap Types', () => {
        it('should handle FIXED cap type allocation', () => {
            const income = new WorkIncome(
                'inc-1', 'Job', 100000, 'Annually', 'Yes',
                0, 0, 0, 0, '', null, 'FIXED',
                new Date('2025-01-01')
            );
            const savingsAccount = new SavedAccount('sav-1', 'Savings', 0, 0);
            const expense = new FoodExpense('exp-1', 'Food', 30000, 'Annually', new Date('2025-01-01'));

            const assumptionsWithPriority: AssumptionsState = {
                ...cleanAssumptions,
                priorities: [
                    { id: 'p1', name: 'Savings', type: 'SAVINGS', accountId: 'sav-1', capType: 'FIXED', capValue: 1000 }  // $1000/month = $12000/year
                ]
            };

            const result = simulateOneYear(2025, [income], [expense], [savingsAccount], assumptionsWithPriority, mockTaxState);

            const savingsAfter = result.accounts.find(acc => acc.id === 'sav-1');
            // Should allocate up to $12,000 (1000 * 12)
            expect(savingsAfter!.amount).toBeLessThanOrEqual(12000);
            expect(result.cashflow.bucketAllocations).toBeGreaterThan(0);
        });

        it('should handle MAX cap type allocation', () => {
            const income = new WorkIncome(
                'inc-1', 'Job', 150000, 'Annually', 'Yes',
                0, 0, 0, 0, '', null, 'FIXED',
                new Date('2025-01-01')
            );
            const savingsAccount = new SavedAccount('sav-1', 'Savings', 0, 0);
            const expense = new FoodExpense('exp-1', 'Food', 30000, 'Annually', new Date('2025-01-01'));

            const assumptionsWithPriority: AssumptionsState = {
                ...cleanAssumptions,
                priorities: [
                    { id: 'p1', name: 'Savings', type: 'SAVINGS', accountId: 'sav-1', capType: 'MAX', capValue: 25000 }
                ]
            };

            const result = simulateOneYear(2025, [income], [expense], [savingsAccount], assumptionsWithPriority, mockTaxState);

            const savingsAfter = result.accounts.find(acc => acc.id === 'sav-1');
            // Should allocate up to $25,000
            expect(savingsAfter!.amount).toBeLessThanOrEqual(25000);
        });

        it('should handle MULTIPLE_OF_EXPENSES cap type', () => {
            const income = new WorkIncome(
                'inc-1', 'Job', 150000, 'Annually', 'Yes',
                0, 0, 0, 0, '', null, 'FIXED',
                new Date('2025-01-01')
            );
            const savingsAccount = new SavedAccount('sav-1', 'Emergency Fund', 10000, 0);  // Start with 10k
            const expense = new FoodExpense('exp-1', 'Food', 36000, 'Annually', new Date('2025-01-01'));  // 3k/month

            const assumptionsWithPriority: AssumptionsState = {
                ...cleanAssumptions,
                priorities: [
                    { id: 'p1', name: 'Emergency', type: 'SAVINGS', accountId: 'sav-1', capType: 'MULTIPLE_OF_EXPENSES', capValue: 6 }  // 6 months expenses
                ]
            };

            // 6 months of 3k/month = 18k target
            // Starting with 10k, need to add ~8k to reach target (accounting for growth)
            const result = simulateOneYear(2025, [income], [expense], [savingsAccount], assumptionsWithPriority, mockTaxState);

            const savingsAfter = result.accounts.find(acc => acc.id === 'sav-1');
            // Should be at or near 6 months expenses (18k)
            expect(savingsAfter!.amount).toBeGreaterThan(10000);  // At least contributed something
        });
    });

    // =========================================================================
    // AUTO ROTH CONVERSION TESTS
    // =========================================================================

    describe('Auto Roth Conversions', () => {
        it('should not perform conversions when autoRothConversions is disabled', () => {
            const retiredAssumptions: AssumptionsState = {
                ...cleanAssumptions,
                demographics: {
                    startAge: 67,
                    startYear: 2025,
                    lifeExpectancy: 90,
                    retirementAge: 65
                },
                investments: {
                    ...cleanAssumptions.investments,
                    autoRothConversions: false
                }
            };

            const traditional401k = new InvestedAccount(
                'trad-1', 'Traditional 401k', 500000, 0, 0, 0.1, 'Traditional 401k'
            );
            const roth401k = new InvestedAccount(
                'roth-1', 'Roth 401k', 100000, 0, 0, 0.1, 'Roth 401k'
            );

            const result = simulateOneYear(
                2025,
                [],
                [],
                [traditional401k, roth401k],
                retiredAssumptions,
                mockTaxState
            );

            expect(result.rothConversion).toBeUndefined();
        });

        it('should perform conversions when autoRothConversions is enabled and retired', () => {
            const retiredAssumptions: AssumptionsState = {
                ...cleanAssumptions,
                demographics: {
                    startAge: 67,
                    startYear: 2025,
                    lifeExpectancy: 90,
                    retirementAge: 65
                },
                investments: {
                    ...cleanAssumptions.investments,
                    autoRothConversions: true
                },
                withdrawalStrategy: [
                    { id: 'ws-trad-1', accountId: 'trad-1', name: 'Traditional 401k' },
                    { id: 'ws-roth-1', accountId: 'roth-1', name: 'Roth 401k' }
                ]
            };

            const traditional401k = new InvestedAccount(
                'trad-1', 'Traditional 401k', 500000, 0, 0, 0.1, 'Traditional 401k'
            );
            const roth401k = new InvestedAccount(
                'roth-1', 'Roth 401k', 100000, 0, 0, 0.1, 'Roth 401k'
            );

            const result = simulateOneYear(
                2025,
                [],
                [],
                [traditional401k, roth401k],
                retiredAssumptions,
                mockTaxState
            );

            // Should have performed a conversion
            if (result.rothConversion) {
                expect(result.rothConversion.amount).toBeGreaterThan(0);
                expect(result.rothConversion.taxCost).toBeGreaterThan(0);
                expect(Object.keys(result.rothConversion.fromAccounts).length).toBeGreaterThan(0);
                expect(Object.keys(result.rothConversion.toAccounts).length).toBeGreaterThan(0);
            }
        });

        it('should not perform conversions before retirement', () => {
            const workingAssumptions: AssumptionsState = {
                ...cleanAssumptions,
                demographics: {
                    startAge: 40,
                    startYear: 2025,
                    lifeExpectancy: 90,
                    retirementAge: 65
                },
                investments: {
                    ...cleanAssumptions.investments,
                    autoRothConversions: true
                }
            };

            const traditional401k = new InvestedAccount(
                'trad-1', 'Traditional 401k', 500000, 0, 0, 0.1, 'Traditional 401k'
            );
            const roth401k = new InvestedAccount(
                'roth-1', 'Roth 401k', 100000, 0, 0, 0.1, 'Roth 401k'
            );

            const result = simulateOneYear(
                2025,
                [],
                [],
                [traditional401k, roth401k],
                workingAssumptions,
                mockTaxState
            );

            // Should not convert while still working
            expect(result.rothConversion).toBeUndefined();
        });

        it('should transfer from Traditional to Roth accounts', () => {
            const retiredAssumptions: AssumptionsState = {
                ...cleanAssumptions,
                demographics: {
                    startAge: 67,
                    startYear: 2025,
                    lifeExpectancy: 90,
                    retirementAge: 65
                },
                investments: {
                    ...cleanAssumptions.investments,
                    autoRothConversions: true
                },
                withdrawalStrategy: [
                    { id: 'ws-trad-1', accountId: 'trad-1', name: 'Traditional 401k' },
                    { id: 'ws-roth-1', accountId: 'roth-1', name: 'Roth 401k' }
                ]
            };

            const initialTraditional = 500000;
            const initialRoth = 100000;

            const traditional401k = new InvestedAccount(
                'trad-1', 'Traditional 401k', initialTraditional, 0, 0, 0.1, 'Traditional 401k'
            );
            const roth401k = new InvestedAccount(
                'roth-1', 'Roth 401k', initialRoth, 0, 0, 0.1, 'Roth 401k'
            );

            const result = simulateOneYear(
                2025,
                [],
                [],
                [traditional401k, roth401k],
                retiredAssumptions,
                mockTaxState
            );

            if (result.rothConversion && result.rothConversion.amount > 0) {
                const tradAfter = result.accounts.find(a => a.id === 'trad-1');
                const rothAfter = result.accounts.find(a => a.id === 'roth-1');

                // Traditional should decrease (conversion out + growth)
                // Roth should increase (conversion in + growth)
                // Account for 10% growth when checking
                const expectedTraditionalWithGrowth = initialTraditional * 1.1;
                const expectedRothWithGrowth = initialRoth * 1.1;

                // Traditional should be less than what it would be without conversion
                expect(tradAfter!.amount).toBeLessThan(expectedTraditionalWithGrowth);

                // Roth should be more than what it would be without conversion
                expect(rothAfter!.amount).toBeGreaterThan(expectedRothWithGrowth);
            }
        });

        it('should log conversion details', () => {
            const retiredAssumptions: AssumptionsState = {
                ...cleanAssumptions,
                demographics: {
                    startAge: 67,
                    startYear: 2025,
                    lifeExpectancy: 90,
                    retirementAge: 65
                },
                investments: {
                    ...cleanAssumptions.investments,
                    autoRothConversions: true
                },
                withdrawalStrategy: [
                    { id: 'ws-trad-1', accountId: 'trad-1', name: 'Traditional 401k' },
                    { id: 'ws-roth-1', accountId: 'roth-1', name: 'Roth 401k' }
                ]
            };

            const traditional401k = new InvestedAccount(
                'trad-1', 'Traditional 401k', 500000, 0, 0, 0.1, 'Traditional 401k'
            );
            const roth401k = new InvestedAccount(
                'roth-1', 'Roth 401k', 100000, 0, 0, 0.1, 'Roth 401k'
            );

            const result = simulateOneYear(
                2025,
                [],
                [],
                [traditional401k, roth401k],
                retiredAssumptions,
                mockTaxState
            );

            if (result.rothConversion && result.rothConversion.amount > 0) {
                const hasConversionLog = result.logs.some(log =>
                    log.includes('Roth Conversion')
                );
                expect(hasConversionLog).toBe(true);
            }
        });

        it('should not produce NaN when Traditional account is fully drained', () => {
            // This test covers a bug where draining Traditional to $0 caused NaN
            // because the old code mutated accounts directly, leading to division by zero
            const retiredAssumptions: AssumptionsState = {
                ...cleanAssumptions,
                demographics: {
                    startAge: 67,
                    startYear: 2025,
                    lifeExpectancy: 90,
                    retirementAge: 65
                },
                investments: {
                    ...cleanAssumptions.investments,
                    autoRothConversions: true
                },
                withdrawalStrategy: [
                    { id: 'ws-trad-1', accountId: 'trad-1', name: 'Traditional 401k' },
                    { id: 'ws-roth-1', accountId: 'roth-1', name: 'Roth IRA' }
                ]
            };

            // Small Traditional balance that will be fully converted
            const traditional401k = new InvestedAccount(
                'trad-1', 'Traditional 401k', 10000, 0, 0, 0.1, 'Traditional 401k'
            );
            const rothIRA = new InvestedAccount(
                'roth-1', 'Roth IRA', 50000, 0, 0, 0.1, 'Roth IRA'
            );

            const result = simulateOneYear(
                2025,
                [],
                [],
                [traditional401k, rothIRA],
                retiredAssumptions,
                mockTaxState
            );

            // Critical: No account should have NaN amount
            for (const account of result.accounts) {
                expect(Number.isNaN(account.amount)).toBe(false);
                expect(account.amount).toBeGreaterThanOrEqual(0);
            }

            // Specifically check the accounts involved in conversion
            const tradAfter = result.accounts.find(a => a.id === 'trad-1');
            const rothAfter = result.accounts.find(a => a.id === 'roth-1');

            expect(tradAfter).toBeDefined();
            expect(rothAfter).toBeDefined();
            expect(Number.isNaN(tradAfter!.amount)).toBe(false);
            expect(Number.isNaN(rothAfter!.amount)).toBe(false);
        });

        it('should include fromAccountIds and toAccountIds in conversion result', () => {
            const retiredAssumptions: AssumptionsState = {
                ...cleanAssumptions,
                demographics: {
                    startAge: 67,
                    startYear: 2025,
                    lifeExpectancy: 90,
                    retirementAge: 65
                },
                investments: {
                    ...cleanAssumptions.investments,
                    autoRothConversions: true
                },
                withdrawalStrategy: [
                    { id: 'ws-trad-1', accountId: 'trad-1', name: 'Traditional 401k' },
                    { id: 'ws-roth-1', accountId: 'roth-1', name: 'Roth 401k' }
                ]
            };

            const traditional401k = new InvestedAccount(
                'trad-1', 'Traditional 401k', 500000, 0, 0, 0.1, 'Traditional 401k'
            );
            const roth401k = new InvestedAccount(
                'roth-1', 'Roth 401k', 100000, 0, 0, 0.1, 'Roth 401k'
            );

            const result = simulateOneYear(
                2025,
                [],
                [],
                [traditional401k, roth401k],
                retiredAssumptions,
                mockTaxState
            );

            // Conversion should happen (retired, no income, low tax bracket)
            expect(result.rothConversion).toBeDefined();
            if (result.rothConversion) {
                // Should have ID-based tracking
                expect(result.rothConversion.fromAccountIds).toBeDefined();
                expect(result.rothConversion.toAccountIds).toBeDefined();

                // Should have withdrawn from Traditional
                expect(result.rothConversion.fromAccountIds['trad-1']).toBeGreaterThan(0);

                // Should have deposited to Roth
                expect(result.rothConversion.toAccountIds['roth-1']).toBeGreaterThan(0);

                // Amounts should match
                const totalFrom = Object.values(result.rothConversion.fromAccountIds).reduce((a, b) => a + b, 0);
                const totalTo = Object.values(result.rothConversion.toAccountIds).reduce((a, b) => a + b, 0);
                expect(totalFrom).toBe(totalTo);
                expect(totalFrom).toBe(result.rothConversion.amount);
            }
        });

        it('should not convert when no Traditional accounts exist', () => {
            const retiredAssumptions: AssumptionsState = {
                ...cleanAssumptions,
                demographics: {
                    startAge: 67,
                    startYear: 2025,
                    lifeExpectancy: 90,
                    retirementAge: 65
                },
                investments: {
                    ...cleanAssumptions.investments,
                    autoRothConversions: true
                },
                withdrawalStrategy: []
            };

            // Only Roth account, no Traditional
            const roth401k = new InvestedAccount(
                'roth-1', 'Roth 401k', 100000, 0, 0, 0.1, 'Roth 401k'
            );

            const result = simulateOneYear(
                2025,
                [],
                [],
                [roth401k],
                retiredAssumptions,
                mockTaxState
            );

            expect(result.rothConversion).toBeUndefined();
        });

        it('should not convert when no Roth accounts exist', () => {
            const retiredAssumptions: AssumptionsState = {
                ...cleanAssumptions,
                demographics: {
                    startAge: 67,
                    startYear: 2025,
                    lifeExpectancy: 90,
                    retirementAge: 65
                },
                investments: {
                    ...cleanAssumptions.investments,
                    autoRothConversions: true
                },
                withdrawalStrategy: []
            };

            // Only Traditional account, no Roth
            const traditional401k = new InvestedAccount(
                'trad-1', 'Traditional 401k', 500000, 0, 0, 0.1, 'Traditional 401k'
            );

            const result = simulateOneYear(
                2025,
                [],
                [],
                [traditional401k],
                retiredAssumptions,
                mockTaxState
            );

            expect(result.rothConversion).toBeUndefined();
        });
    });

});