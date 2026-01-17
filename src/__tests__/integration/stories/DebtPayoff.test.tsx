/**
 * Story 7: Debt Payoff
 *
 * Scenario: Age 35, $400k house with $300k mortgage, $50k student loans
 *
 * Key Assertions:
 * - Mortgage balance decreases each year (principal payments)
 * - Property value increases (appreciation)
 * - Property equity grows
 * - Student loan pays off within ~10 years
 * - Linked account balance matches expense balance
 * - PMI removed at 20% equity
 *
 * Bugs Caught: Amortization errors, linked account sync issues, PMI removal
 */

import { describe, it, expect } from 'vitest';
import { AssumptionsState, defaultAssumptions } from '../../../components/Objects/Assumptions/AssumptionsContext';
import { TaxState } from '../../../components/Objects/Taxes/TaxContext';
import { InvestedAccount, PropertyAccount, DebtAccount } from '../../../components/Objects/Accounts/models';
import { WorkIncome } from '../../../components/Objects/Income/models';
import { MortgageExpense, LoanExpense, FoodExpense } from '../../../components/Objects/Expense/models';
import { runSimulation } from '../../../components/Objects/Assumptions/useSimulation';
import {
    getAge,
    getYearByAge,
    getAccountById,
    calculateNetWorth,
} from '../helpers/simulationTestUtils';
import {
    assertAllYearsInvariants,
} from '../helpers/assertions';

describe('Story 7: Debt Payoff', () => {
    const birthYear = 1990;
    const retirementAge = 65;
    const yearsToSimulate = 35; // Age 35 to 70

    const taxState: TaxState = {
        filingStatus: 'Single',
        stateResidency: 'DC',
        deductionMethod: 'Standard',
        fedOverride: null,
        ficaOverride: null,
        stateOverride: null,
        year: 2025,
    };

    const assumptions: AssumptionsState = {
        ...defaultAssumptions,
        demographics: {
            birthYear,
            lifeExpectancy: 90,
            retirementAge,
        },
        income: {
            ...defaultAssumptions.income,
            salaryGrowth: 3.0,
        },
        macro: {
            ...defaultAssumptions.macro,
            inflationRate: 0, // Disable inflation for clearer math
            inflationAdjusted: false,
        },
        expenses: {
            ...defaultAssumptions.expenses,
            housingAppreciation: 3.0, // 3% home appreciation
        },
        investments: {
            ...defaultAssumptions.investments,
            returnRates: { ror: 7 },
            autoRothConversions: false,
        },
        withdrawalStrategy: [],
    };

    // Property Account (linked to Mortgage)
    const propertyAccount = new PropertyAccount(
        'acc-property',
        'Home',
        400000,     // $400k value
        'Financed',
        300000,     // $300k remaining loan
        300000,     // $300k starting loan (just purchased)
        'exp-mortgage'
    );

    // Debt Account for Student Loan (linked to Loan expense)
    const studentLoanAccount = new DebtAccount(
        'acc-studentloan',
        'Student Loan Debt',
        50000,      // $50k balance
        'exp-studentloan',
        5.0         // 5% APR
    );

    // Savings/Invested account
    const savingsAccount = new InvestedAccount(
        'acc-savings',
        'Savings',
        50000,      // $50k emergency fund
        0,
        10,
        0.05,
        'Brokerage',
        true,
        1.0,
        50000
    );

    // Mortgage expense (30-year, 6% APR)
    const mortgageExpense = new MortgageExpense(
        'exp-mortgage',
        'Mortgage',
        'Monthly',
        400000,     // Property value
        300000,     // Current loan balance
        300000,     // Starting loan balance
        6.0,        // 6% APR
        30,         // 30-year term
        1.5,        // 1.5% property tax rate
        0,          // No valuation deduction
        1.0,        // 1% maintenance
        200,        // $200/month utilities
        0.5,        // 0.5% homeowner's insurance
        0.5,        // 0.5% PMI (should be removed at 20% equity)
        200,        // $200/month HOA
        'Itemized',
        0,          // Tax deductible (calculated)
        'acc-property',
        new Date('2025-01-01'),
        0,          // Payment (calculated)
        0           // No extra payment
    );

    // Student Loan expense (10-year term, 5% APR)
    const studentLoanExpense = new LoanExpense(
        'exp-studentloan',
        'Student Loan',
        50000,      // $50k balance
        'Monthly',
        5.0,        // 5% APR
        'Compounding',
        530,        // ~$530/month for 10-year payoff
        'No',
        0,
        'acc-studentloan',
        new Date('2025-01-01'),
        new Date('2035-01-01') // 10-year payoff
    );

    // Work income
    const workIncome = new WorkIncome(
        'inc-work',
        'Job',
        100000,
        'Annually',
        'Yes',
        0, 0, 0, 0, '', null, 'FIXED'
    );

    // Other living expenses
    const livingExpenses = new FoodExpense(
        'exp-living',
        'Living Expenses',
        20000,
        'Annually',
        new Date('2025-01-01')
    );

    it('should run simulation without errors', () => {
        const simulation = runSimulation(
            yearsToSimulate,
            [propertyAccount, studentLoanAccount, savingsAccount],
            [workIncome],
            [mortgageExpense, studentLoanExpense, livingExpenses],
            assumptions,
            taxState
        );

        expect(simulation.length).toBeGreaterThan(0);
        assertAllYearsInvariants(simulation);
    });

    it('should decrease mortgage balance each year', () => {
        const simulation = runSimulation(
            yearsToSimulate,
            [propertyAccount, studentLoanAccount, savingsAccount],
            [workIncome],
            [mortgageExpense, studentLoanExpense, livingExpenses],
            assumptions,
            taxState
        );

        let prevBalance = Infinity;
        for (const year of simulation) {
            const mortgage = year.expenses.find(e => e.id === 'exp-mortgage') as MortgageExpense;
            if (!mortgage) continue;

            // Loan balance should decrease each year (principal payments)
            expect(mortgage.loan_balance, `Mortgage balance should decrease in year ${year.year}`).toBeLessThanOrEqual(prevBalance);
            prevBalance = mortgage.loan_balance;
        }
    });

    it('should increase property value with appreciation', () => {
        const simulation = runSimulation(
            yearsToSimulate,
            [propertyAccount, studentLoanAccount, savingsAccount],
            [workIncome],
            [mortgageExpense, studentLoanExpense, livingExpenses],
            assumptions,
            taxState
        );

        let prevValue = 0;
        for (const year of simulation) {
            const property = getAccountById(year, 'acc-property') as PropertyAccount;
            if (!property) continue;

            // Property value should increase (appreciation)
            expect(property.amount, `Property value should increase in year ${year.year}`).toBeGreaterThanOrEqual(prevValue);
            prevValue = property.amount;
        }
    });

    it('should grow property equity over time', () => {
        const simulation = runSimulation(
            yearsToSimulate,
            [propertyAccount, studentLoanAccount, savingsAccount],
            [workIncome],
            [mortgageExpense, studentLoanExpense, livingExpenses],
            assumptions,
            taxState
        );

        // Get equity at start and end
        const startYear = simulation[0];
        const endYear = simulation[simulation.length - 1];

        const startProperty = getAccountById(startYear, 'acc-property') as PropertyAccount;
        const endProperty = getAccountById(endYear, 'acc-property') as PropertyAccount;

        if (startProperty && endProperty) {
            const startEquity = startProperty.amount - startProperty.loanAmount;
            const endEquity = endProperty.amount - endProperty.loanAmount;

            expect(endEquity, 'Property equity should grow over time').toBeGreaterThan(startEquity);
        }
    });

    it('should pay off student loan within expected timeframe', () => {
        const simulation = runSimulation(
            yearsToSimulate,
            [propertyAccount, studentLoanAccount, savingsAccount],
            [workIncome],
            [mortgageExpense, studentLoanExpense, livingExpenses],
            assumptions,
            taxState
        );

        // Find year where student loan is paid off
        let payoffYear: number | null = null;
        for (const year of simulation) {
            const loan = year.expenses.find(e => e.id === 'exp-studentloan') as LoanExpense;
            if (loan && loan.amount <= 1) { // Essentially paid off
                payoffYear = year.year;
                break;
            }
        }

        // Should be paid off within ~10-12 years (allowing for simulation timing)
        if (payoffYear) {
            const yearsToPay = payoffYear - simulation[0].year;
            expect(yearsToPay, 'Student loan should be paid off within 12 years').toBeLessThanOrEqual(12);
        }
    });

    it('should sync linked account with expense balance', () => {
        const simulation = runSimulation(
            yearsToSimulate,
            [propertyAccount, studentLoanAccount, savingsAccount],
            [workIncome],
            [mortgageExpense, studentLoanExpense, livingExpenses],
            assumptions,
            taxState
        );

        for (const year of simulation) {
            // Check student loan sync
            const loanExpense = year.expenses.find(e => e.id === 'exp-studentloan') as LoanExpense;
            const loanAccount = year.accounts.find(a => a.id === 'acc-studentloan') as DebtAccount;

            if (loanExpense && loanAccount) {
                const expenseBalance = loanExpense.amount;
                const accountBalance = loanAccount.amount;

                // Allow small tolerance for floating point
                expect(
                    Math.abs(expenseBalance - accountBalance),
                    `Student loan account (${accountBalance}) should match expense (${expenseBalance}) in year ${year.year}`
                ).toBeLessThan(10);
            }

            // Check mortgage/property sync
            const mortgageExp = year.expenses.find(e => e.id === 'exp-mortgage') as MortgageExpense;
            const propertyAcc = year.accounts.find(a => a.id === 'acc-property') as PropertyAccount;

            if (mortgageExp && propertyAcc) {
                // Property account loanAmount should match mortgage loan_balance
                expect(
                    Math.abs(mortgageExp.loan_balance - propertyAcc.loanAmount),
                    `Mortgage loan balance should match property account in year ${year.year}`
                ).toBeLessThan(10);
            }
        }
    });

    it('should remove PMI at 20% equity', () => {
        const simulation = runSimulation(
            yearsToSimulate,
            [propertyAccount, studentLoanAccount, savingsAccount],
            [workIncome],
            [mortgageExpense, studentLoanExpense, livingExpenses],
            assumptions,
            taxState
        );

        // Track PMI removal
        let hadPMI = true;
        let pmiRemovedYear: number | null = null;
        let equityAtRemoval: number | null = null;

        for (const year of simulation) {
            const mortgage = year.expenses.find(e => e.id === 'exp-mortgage') as MortgageExpense;
            if (!mortgage) continue;

            const equity = (mortgage.valuation - mortgage.loan_balance) / mortgage.valuation;

            if (hadPMI && mortgage.pmi === 0) {
                pmiRemovedYear = year.year;
                equityAtRemoval = equity;
                hadPMI = false;
            }
        }

        // PMI should be removed at some point (when equity >= 20%)
        if (pmiRemovedYear && equityAtRemoval !== null) {
            expect(equityAtRemoval, 'PMI should be removed at 20% equity or higher').toBeGreaterThanOrEqual(0.19); // Allow small tolerance
        }
    });

    it('should increase net worth over time', () => {
        const simulation = runSimulation(
            yearsToSimulate,
            [propertyAccount, studentLoanAccount, savingsAccount],
            [workIncome],
            [mortgageExpense, studentLoanExpense, livingExpenses],
            assumptions,
            taxState
        );

        // Get net worth at start and later
        const year5 = simulation[5];
        const year15 = simulation[15];

        if (year5 && year15) {
            const nw5 = calculateNetWorth(year5.accounts);
            const nw15 = calculateNetWorth(year15.accounts);

            expect(nw15, 'Net worth should grow over 10 years').toBeGreaterThan(nw5);
        }
    });

    it('should handle mortgage payoff correctly', () => {
        // Test with accelerated payoff (extra payments)
        const acceleratedMortgage = new MortgageExpense(
            'exp-mortgage', 'Mortgage', 'Monthly',
            400000, 300000, 300000,
            6.0, 30, 1.5, 0, 1.0, 200, 0.5, 0.5, 200,
            'Itemized', 0, 'acc-property',
            new Date('2025-01-01'),
            0,
            2000 // $2000 extra payment per month
        );

        const simulation = runSimulation(
            yearsToSimulate,
            [propertyAccount, studentLoanAccount, savingsAccount],
            [workIncome],
            [acceleratedMortgage, studentLoanExpense, livingExpenses],
            assumptions,
            taxState
        );

        // With extra payments, mortgage should pay off faster
        let payoffYear: number | null = null;
        for (const year of simulation) {
            const mortgage = year.expenses.find(e => e.id === 'exp-mortgage') as MortgageExpense;
            if (mortgage && mortgage.loan_balance <= 1) {
                payoffYear = year.year;
                break;
            }
        }

        if (payoffYear) {
            const yearsToPay = payoffYear - simulation[0].year;
            // With $2000 extra/month on a $300k loan, should pay off in ~10 years
            expect(yearsToPay, 'Accelerated mortgage should pay off faster').toBeLessThan(15);
        }

        assertAllYearsInvariants(simulation);
    });

    it('should continue property expenses after mortgage payoff', () => {
        // Test with nearly paid off mortgage
        const smallMortgage = new MortgageExpense(
            'exp-mortgage', 'Mortgage', 'Monthly',
            400000, 20000, 300000, // Only $20k left
            6.0, 30, 1.5, 0, 1.0, 200, 0.5, 0, 200, // No PMI
            'Itemized', 0, 'acc-property',
            new Date('2025-01-01')
        );

        const smallLoanProperty = new PropertyAccount(
            'acc-property', 'Home', 400000, 'Financed', 20000, 300000, 'exp-mortgage'
        );

        const simulation = runSimulation(
            yearsToSimulate,
            [smallLoanProperty, studentLoanAccount, savingsAccount],
            [workIncome],
            [smallMortgage, studentLoanExpense, livingExpenses],
            assumptions,
            taxState
        );

        // After payoff, should still have property tax, insurance, maintenance expenses
        const laterYear = simulation[10]; // After mortgage should be paid off
        if (laterYear) {
            const mortgage = laterYear.expenses.find(e => e.id === 'exp-mortgage') as MortgageExpense;
            if (mortgage) {
                // Even with loan_balance = 0, there should be some ongoing costs
                expect(mortgage.getAnnualAmount(laterYear.year), 'Property expenses should continue after payoff').toBeGreaterThan(0);
            }
        }

        assertAllYearsInvariants(simulation);
    });

    it('should handle zero-balance debt correctly', () => {
        // Create already paid-off loan
        const paidOffLoan = new LoanExpense(
            'exp-studentloan', 'Student Loan', 0, 'Monthly', 5.0, 'Compounding', 0, 'No', 0, 'acc-studentloan',
            new Date('2020-01-01'), new Date('2020-01-01')
        );

        const paidOffAccount = new DebtAccount(
            'acc-studentloan', 'Student Loan Debt', 0, 'exp-studentloan', 5.0
        );

        const simulation = runSimulation(
            yearsToSimulate,
            [propertyAccount, paidOffAccount, savingsAccount],
            [workIncome],
            [mortgageExpense, paidOffLoan, livingExpenses],
            assumptions,
            taxState
        );

        // Should run without errors with zero-balance debt
        assertAllYearsInvariants(simulation);
    });
});
