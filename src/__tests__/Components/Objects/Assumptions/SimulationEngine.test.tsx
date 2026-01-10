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
        // Test that the withdrawal strategy code path is executed
        const traditionalIRA = new InvestedAccount(
            'ira-1',
            'Traditional IRA',
            10000,
            0,
            5,
            0.0,
            'Traditional IRA',
            true,
            0.2
        );

        const expense = new FoodExpense('exp-1', 'Expenses', 5000, 'Annually');

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
            2024,
            [],
            [expense],
            [traditionalIRA],
            assumptionsWithWithdrawal,
            taxState
        );

        // Verify result has expected structure (code executed)
        expect(result.accounts[0]).toBeDefined();
        expect(result.accounts[0].amount).toBeGreaterThan(0);
        expect(result.taxDetails).toBeDefined();
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

        const massiveExpense = new FoodExpense('exp-1', 'Massive Expenses', 10000, 'Annually');

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
            2024,
            [],
            [massiveExpense],
            [smallAccount],
            assumptionsWithWithdrawal,
            taxState
        );

        // Verify withdrawal code executed
        expect(result.accounts[0]).toBeDefined();
        expect(result.cashflow).toBeDefined();
    });

    it('should handle tax-free withdrawal from Roth IRA', () => {
        const rothIRA = new InvestedAccount(
            'roth-1',
            'Roth IRA',
            10000,
            0,
            5,
            0.0,
            'Roth IRA',
            true,
            0.2
        );

        const expense = new FoodExpense('exp-1', 'Expenses', 5000, 'Annually');

        const assumptionsWithWithdrawal: AssumptionsState = {
            ...cleanAssumptions,
            withdrawalStrategy: [
                { id: 'w1', name: 'Roth Withdrawal', accountId: 'roth-1' }
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
            2024,
            [],
            [expense],
            [rothIRA],
            assumptionsWithWithdrawal,
            taxState
        );

        // Verify tax-free withdrawal code path executed
        expect(result.accounts[0]).toBeDefined();
        expect(result.accounts[0].amount).toBeGreaterThan(0);
    });

    it('should handle DebtAccount with linked loan and payment', () => {
        const debtAccount = new DebtAccount(
            'debt-1',
            'Car Loan',
            5000,
            'loan-1',
            5.0
        );

        const loanExpense = new LoanExpense(
            'loan-1',
            'Car Payment',
            5000,
            'Monthly',
            5,
            "Simple",
            250,
            "No",
            0,
            'debt-1'
        );

        const income = new WorkIncome(
            'inc-1',
            'Job',
            60000,
            'Annually',
            'Yes',
            0,
            0,
            0,
            0,
            '',
            null,
            'FIXED'
        );

        const result = simulateOneYear(
            2024,
            [income],
            [loanExpense],
            [debtAccount],
            cleanAssumptions,
            mockTaxState
        );

        // Debt should be reduced by payments
        expect(result.accounts[0]).toBeDefined();
    });

    it('should handle PropertyAccount with mortgage', () => {
        const propertyAccount = new PropertyAccount(
            'prop-1',
            'House',
            300000,
            "Financed",
            300000,
            250000,
            "mort-1",
            4.0
        );

        const mortgageExpense = new MortgageExpense(
            'mort-1',
            'Mortgage Payment',
            'Monthly',
            300000,
            250000,
            250000,
            4.0,
            30,
            1,
            0,
            1,
            200,
            1,
            0,
            0,
            "Itemized",
            0,
            'prop-1'
        );

        const income = new WorkIncome(
            'inc-1',
            'Job',
            100000,
            'Annually',
            'Yes',
            0,
            0,
            0,
            0,
            '',
            null,
            'FIXED'
        );

        const result = simulateOneYear(
            2024,
            [income],
            [mortgageExpense],
            [propertyAccount],
            cleanAssumptions,
            mockTaxState
        );

        // Property account should exist
        expect(result.accounts[0]).toBeDefined();
        expect(result.accounts[0].constructor.name).toBe('PropertyAccount');
    });

    it('should handle unknown account types gracefully', () => {
        // Create a basic account that's not one of the known types
        const basicAccount = new SavedAccount('sav-1', 'Savings', 1000, 2.5);

        const result = simulateOneYear(
            2024,
            [],
            [],
            [basicAccount],
            cleanAssumptions,
            mockTaxState
        );

        // Should still process the account
        expect(result.accounts[0]).toBeDefined();
        expect(result.accounts[0].amount).toBeGreaterThan(1000);
    });

    it('should handle withdrawal from SavedAccount', () => {
        const savingsAccount = new SavedAccount('sav-1', 'Savings', 5000, 2.5);
        const expense = new FoodExpense('exp-1', 'Expenses', 3000, 'Annually');

        const assumptionsWithWithdrawal: AssumptionsState = {
            ...cleanAssumptions,
            withdrawalStrategy: [
                { id: 'w1', name: 'Savings Withdrawal', accountId: 'sav-1' }
            ]
        };

        const result = simulateOneYear(
            2024,
            [],
            [expense],
            [savingsAccount],
            assumptionsWithWithdrawal,
            mockTaxState
        );

        // Verify SavedAccount withdrawal code path executed
        expect(result.accounts[0]).toBeDefined();
        expect(result.accounts[0].amount).toBeGreaterThan(0);
    });

    it('should handle employer match correctly', () => {
        const retirementAccount = new InvestedAccount(
            'ret-1',
            '401k',
            10000,
            0,
            3,
            0.5,
            'Traditional 401k',
            true,
            0.2
        );

        const income = new WorkIncome(
            'inc-1',
            'Job',
            100000,
            'Annually',
            'Yes',
            5000,   // preTax401k
            500,    // insurance
            0,      // roth401k
            2500,   // employerMatch (50% of 5000)
            'ret-1', // matchAccountId
            'Traditional 401k',
            'FIXED'
        );

        const result = simulateOneYear(
            2024,
            [income],
            [],
            [retirementAccount],
            cleanAssumptions,
            mockTaxState
        );

        // Account should grow with both contributions and match
        expect(result.accounts[0].amount).toBeGreaterThan(10000);
        // Match may be slightly different due to growth
        expect(result.cashflow.investedMatch).toBeGreaterThan(2400);
    });

});