import { describe, it, expect } from 'vitest';
import { AssumptionsState, defaultAssumptions } from '../../../../components/Objects/Assumptions/AssumptionsContext';
import { TaxState } from '../../../../components/Objects/Taxes/TaxContext';
import { InvestedAccount, SavedAccount, DebtAccount, PropertyAccount } from '../../../../components/Objects/Accounts/models';
import { WorkIncome } from '../../../../components/Objects/Income/models';
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
        // Account balance after growth: 10000 * 1.10 = 11000.
        // Account balance after withdrawal: 11000 - 5555.56 = 5444.44.
        expect(result.accounts[0].amount).toBeCloseTo(5444.44, 2);
        expect(result.taxDetails.fed).toBeCloseTo(555.56, 2); // Early withdrawal penalty
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
        // Account grows from 1000 to 1100 (10% growth)
        // Withdrawal calculated on pre-growth balance: min(10000, 1000) = 1000
        // Final balance after growth and withdrawal: 1100 - 1000 = 100
        expect(result.accounts[0].amount).toBeCloseTo(100);

        // Gross withdrawal: 1000
        // Early withdrawal penalty (10%): 100
        // Taxes: ~0 (very small income)
        // Net received: ~900
        // Remaining deficit: 10000 - 900 = 9100
        expect(result.cashflow.discretionary).toBeCloseTo(-9100);
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
        // Account balance before growth: 10000 * 1.10 = 11000.
        // Account balance after 10% growth: 11000 - 5000 = 6000.
        expect(result.accounts[0].amount).toBeCloseTo(6000);
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

        // Verify property appreciated by its the default housing appreciation rate (3%)
        expect(resultAccount.amount).toBe(300000 * 1.03);

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
        // Account balance after 2.5% growth: 5000 * 1.025 = 5125
        // Account balance after withdrawal: 5125 - 2875 = 2250
        expect(result.accounts[0].amount).toBe(2250);
    });

    it('should handle employer match correctly', () => {
        const retirementAccount = new InvestedAccount('ret-1', '401k', 10000, 0, 3, 0.5, 'Traditional 401k', true, 0.2);
        const income = new WorkIncome('inc-1', 'Job', 100000, 'Annually', 'Yes', 5000, 500, 0, 2500, 'ret-1', 'Traditional 401k', 'FIXED');

        const result = simulateOneYear(2024, [income], [], [retirementAccount], cleanAssumptions, mockTaxState);

        // End amount = (start) * (1 + ror - expense_ratio) + contributions + match
        // Start = 10000, Contributions = 5000 (user) + 2500 (match) = 7500
        // Total before growth = 10000
        // Growth = 10000 * ((10 - 0.5) / 100) = 950
        // Amount after growth but before contributions = 10000 + 950 = 10950
        // Final amount = 10950 + 7500 = 18450
        expect(result.accounts[0].amount).toBeCloseTo(18450);

        // The cashflow investedMatch should be exactly the contribution for the year.
        expect(result.cashflow.investedMatch).toBe(2500);
    });

});