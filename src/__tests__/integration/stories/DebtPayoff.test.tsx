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
import { type AssumptionsState, defaultAssumptions, createBuiltinMilestones } from '../../../components/Objects/Assumptions/AssumptionsContext';
import { type TaxState } from '../../../components/Objects/Taxes/TaxContext';
import { InvestedAccount, PropertyAccount, DebtAccount } from '../../../components/Objects/Accounts/models';
import { WorkIncome } from '../../../components/Objects/Income/models';
import { MortgageExpense, LoanExpense, FoodExpense } from '../../../components/Objects/Expense/models';
import { runSimulation } from '../../../components/Objects/Assumptions/useSimulation';
import {
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
        demographics: {},
        milestones: createBuiltinMilestones(birthYear, retirementAge, 90),
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

    // ---------------------------------------------------------------------
    // Phase-1 (#60): more complex debt repayment options
    // ---------------------------------------------------------------------

    it('B: LoanExpense extra_payment accelerates payoff vs. the baseline', () => {
        const findPayoffYear = (sim: typeof baselineSim): number | null => {
            for (const year of sim) {
                const loan = year.expenses.find(e => e.id === 'exp-studentloan') as LoanExpense;
                if (loan && loan.amount <= 1) return year.year;
            }
            return null;
        };

        // Baseline 10-year student loan (no extra payment).
        const baselineSim = runSimulation(
            yearsToSimulate,
            [propertyAccount, studentLoanAccount, savingsAccount],
            [workIncome],
            [mortgageExpense, studentLoanExpense, livingExpenses],
            assumptions,
            taxState
        );

        // Same loan, but $300/mo extra principal (trailing constructor arg).
        const acceleratedLoan = new LoanExpense(
            'exp-studentloan', 'Student Loan', 50000, 'Monthly', 5.0, 'Compounding',
            530, 'No', 0, 'acc-studentloan',
            new Date(2025, 0, 1), new Date(2035, 0, 1),
            undefined, undefined, 300
        );
        const acceleratedSim = runSimulation(
            yearsToSimulate,
            [propertyAccount, studentLoanAccount, savingsAccount],
            [workIncome],
            [mortgageExpense, acceleratedLoan, livingExpenses],
            assumptions,
            taxState
        );

        const basePayoff = findPayoffYear(baselineSim);
        const accelPayoff = findPayoffYear(acceleratedSim);

        expect(basePayoff).not.toBeNull();
        expect(accelPayoff).not.toBeNull();
        // Extra principal pays it off strictly sooner.
        expect(accelPayoff!).toBeLessThan(basePayoff!);
        assertAllYearsInvariants(acceleratedSim);
    });

    // #60 (linked-debt rework): surplus pays a LINKED debt by applying extra
    // principal to its LoanExpense; the DebtAccount mirror follows. The
    // student-loan pair (exp-studentloan ↔ acc-studentloan) is the fixture.
    const withStudentLoanPriority: AssumptionsState = {
        ...assumptions,
        priorities: [
            { id: 'p-loan', name: 'Pay down: Student Loan', type: 'DEBT', accountId: 'acc-studentloan', capType: 'REMAINDER' },
        ],
    };

    it('C: a flagged LINKED debt clears faster than the schedule-only baseline', () => {
        const payoffYear = (a: AssumptionsState): number | null => {
            const sim = runSimulation(
                yearsToSimulate,
                [propertyAccount, studentLoanAccount, savingsAccount],
                [workIncome],
                [mortgageExpense, studentLoanExpense, livingExpenses],
                a, taxState
            );
            for (const y of sim) {
                const loan = y.expenses.find(e => e.id === 'exp-studentloan') as LoanExpense;
                if (loan && loan.amount <= 1) return y.year;
            }
            return null;
        };

        const basePayoff = payoffYear(assumptions);          // schedule only
        const flaggedPayoff = payoffYear(withStudentLoanPriority); // + surplus principal

        expect(basePayoff).not.toBeNull();
        expect(flaggedPayoff).not.toBeNull();
        // Surplus extra-principal retires the loan strictly sooner.
        expect(flaggedPayoff!).toBeLessThan(basePayoff!);
    });

    it('C: the linked DebtAccount mirror equals the reduced LoanExpense each year (no double-drive)', () => {
        const sim = runSimulation(
            yearsToSimulate,
            [propertyAccount, studentLoanAccount, savingsAccount],
            [workIncome],
            [mortgageExpense, studentLoanExpense, livingExpenses],
            withStudentLoanPriority, taxState
        );

        // The account is a pure mirror of the (surplus-reduced) loan balance —
        // the paydown is NOT double-applied or overwritten.
        for (const year of sim) {
            const loan = year.expenses.find(e => e.id === 'exp-studentloan') as LoanExpense;
            const acct = year.accounts.find(a => a.id === 'acc-studentloan') as DebtAccount;
            if (loan && acct) {
                expect(
                    Math.abs(loan.amount - acct.amount),
                    `mirror should equal the reduced loan in ${year.year}`
                ).toBeLessThan(0.01);
            }
        }
        assertAllYearsInvariants(sim);
    });

    it('C: surplus beyond the loan balance flows to a lower bucket; the loan stops at $0', () => {
        // Debt ranked first, a brokerage REMAINDER second. Once the loan hits $0,
        // surplus must stop going to it and the brokerage keeps receiving it.
        const brokerage = new InvestedAccount('acc-brokerage', 'Brokerage', 0, 0, 10, 0.05, 'Brokerage', true, 1.0, 0);
        const withDebtThenBrokerage: AssumptionsState = {
            ...assumptions,
            priorities: [
                { id: 'p-loan', name: 'Pay down: Student Loan', type: 'DEBT', accountId: 'acc-studentloan', capType: 'REMAINDER' },
                { id: 'p-brok', name: 'Brokerage', type: 'INVESTMENT', accountId: 'acc-brokerage', capType: 'REMAINDER' },
            ],
        };

        const sim = runSimulation(
            yearsToSimulate,
            [propertyAccount, studentLoanAccount, savingsAccount, brokerage],
            [workIncome],
            [mortgageExpense, studentLoanExpense, livingExpenses],
            withDebtThenBrokerage, taxState
        );

        // Loan never goes negative and reaches $0; once cleared it stays cleared.
        let cleared = false;
        for (const year of sim) {
            const loan = year.expenses.find(e => e.id === 'exp-studentloan') as LoanExpense;
            if (!loan) continue;
            expect(loan.amount).toBeGreaterThanOrEqual(0);
            if (loan.amount <= 1) cleared = true;
            if (cleared) expect(loan.amount).toBeLessThanOrEqual(1);
        }
        expect(cleared, 'loan should reach $0').toBe(true);

        // After payoff, the brokerage is still accumulating surplus (excess flowed on).
        const lastBrok = sim[sim.length - 1]?.accounts.find(a => a.id === 'acc-brokerage');
        expect(lastBrok && lastBrok.amount).toBeGreaterThan(0);
        assertAllYearsInvariants(sim);
    });

    it('C: surplus paydown coexists with a fixed extra_payment (both apply)', () => {
        // Same student loan but with a $100/mo fixed extra_payment (feature B) AND
        // flagged for surplus paydown. It should clear even sooner than B alone.
        const loanWithExtra = new LoanExpense(
            'exp-studentloan', 'Student Loan', 50000, 'Monthly', 5.0, 'Compounding',
            530, 'No', 0, 'acc-studentloan',
            new Date(2025, 0, 1), new Date(2035, 0, 1),
            undefined, undefined, 100 // fixed extra_payment
        );

        const payoffYear = (priorities: AssumptionsState['priorities']): number | null => {
            const sim = runSimulation(
                yearsToSimulate,
                [propertyAccount, studentLoanAccount, savingsAccount],
                [workIncome],
                [mortgageExpense, loanWithExtra, livingExpenses],
                { ...assumptions, priorities }, taxState
            );
            for (const y of sim) {
                const loan = y.expenses.find(e => e.id === 'exp-studentloan') as LoanExpense;
                if (loan && loan.amount <= 1) return y.year;
            }
            return null;
        };

        const extraOnly = payoffYear([]); // feature B only
        const extraPlusSurplus = payoffYear(withStudentLoanPriority.priorities); // B + surplus

        expect(extraOnly).not.toBeNull();
        expect(extraPlusSurplus).not.toBeNull();
        // [9] Both levers stack and surplus GENUINELY accelerates beyond B alone —
        // strictly sooner (the large annual surplus shaves multiple years off).
        expect(extraPlusSurplus!).toBeLessThan(extraOnly!);
    });

    it('[0] the SAME debt in two priority buckets pays it down once, not twice', () => {
        // SMALL $2000 loan so ONE year's surplus clears it AND leaves room — that's
        // the case where a 2nd duplicate bucket would (buggy) produce a phantom
        // no-op allocation that double-counts in bucketDetail/investedUser. The fix
        // re-resolves the already-reduced loan ($0) so the 2nd allocation is empty.
        const makeSmallLoan = () => new LoanExpense(
            'exp-smallcard', 'Small Card', 2000, 'Monthly', 18.0, 'Compounding',
            200, 'No', 0, 'acc-smallcard',
            new Date(2025, 0, 1), new Date(2030, 0, 1)
        );
        const makeSmallDebt = () => new DebtAccount('acc-smallcard', 'Small Card Debt', 2000, 'exp-smallcard', 18.0);
        const brokerage = () => new InvestedAccount('acc-brokerage', 'Brokerage', 0, 0, 10, 0.05, 'Brokerage', true, 1.0, 0);

        const dup: AssumptionsState = {
            ...assumptions,
            priorities: [
                { id: 'p-card-1', name: 'Pay down: Small Card', type: 'DEBT', accountId: 'acc-smallcard', capType: 'REMAINDER' },
                { id: 'p-card-2', name: 'Pay down: Small Card (dup)', type: 'DEBT', accountId: 'acc-smallcard', capType: 'REMAINDER' },
                { id: 'p-brok', name: 'Brokerage', type: 'INVESTMENT', accountId: 'acc-brokerage', capType: 'REMAINDER' },
            ],
        };
        const single: AssumptionsState = {
            ...assumptions,
            priorities: [
                { id: 'p-card', name: 'Pay down: Small Card', type: 'DEBT', accountId: 'acc-smallcard', capType: 'REMAINDER' },
                { id: 'p-brok', name: 'Brokerage', type: 'INVESTMENT', accountId: 'acc-brokerage', capType: 'REMAINDER' },
            ],
        };

        const run = (a: AssumptionsState) => runSimulation(
            yearsToSimulate,
            [propertyAccount, makeSmallDebt(), savingsAccount, brokerage()],
            [workIncome],
            [mortgageExpense, makeSmallLoan(), livingExpenses],
            a, taxState
        );

        const dupSim = run(dup);
        const singleSim = run(single);

        for (let i = 0; i < singleSim.length; i++) {
            const d = dupSim[i]?.expenses.find(e => e.id === 'exp-smallcard') as LoanExpense;
            const s = singleSim[i]?.expenses.find(e => e.id === 'exp-smallcard') as LoanExpense;
            if (d && s) {
                // Loan balance path identical (2nd allocation pays the reduced balance).
                expect(d.amount).toBeGreaterThanOrEqual(0);
                expect(Math.abs(d.amount - s.amount), `dup loan must match single in ${singleSim[i].year}`).toBeLessThan(0.01);
            }
            // [0] CRUX: the Sankey/saved breakdown must NOT double-count the
            // paydown. bucketDetail for the debt and investedUser must match the
            // single-bucket run exactly (the bug inflated bucketDetail + deflated
            // investedUser on the 2nd, no-op allocation).
            const dDetail = dupSim[i]?.cashflow.bucketDetail['acc-smallcard'] ?? 0;
            const sDetail = singleSim[i]?.cashflow.bucketDetail['acc-smallcard'] ?? 0;
            expect(Math.abs(dDetail - sDetail), `bucketDetail must not double-count in ${singleSim[i].year}`).toBeLessThan(0.01);
            expect(
                Math.abs(dupSim[i].cashflow.investedUser - singleSim[i].cashflow.investedUser),
                `investedUser must not be deflated by a phantom paydown in ${singleSim[i].year}`
            ).toBeLessThan(0.01);
        }
        assertAllYearsInvariants(dupSim);
    });

    it('[5] a loan amortized to a sub-cent residual is not a fundable paydown', () => {
        // A nearly-paid-off loan ($0.001) flagged for paydown must be treated as
        // paid off (epsilon) — its balance path is IDENTICAL whether or not it's
        // in the priority list, i.e. surplus does NOT touch it.
        const makeTinyLoan = () => new LoanExpense(
            'exp-studentloan', 'Student Loan', 0.001, 'Monthly', 5.0, 'Compounding',
            530, 'No', 0, 'acc-studentloan',
            new Date(2025, 0, 1), new Date(2035, 0, 1)
        );
        const makeTinyAccount = () => new DebtAccount('acc-studentloan', 'Student Loan Debt', 0.001, 'exp-studentloan', 5.0);

        const run = (priorities: AssumptionsState['priorities']) => runSimulation(
            yearsToSimulate,
            [propertyAccount, makeTinyAccount(), savingsAccount],
            [workIncome],
            [mortgageExpense, makeTinyLoan(), livingExpenses],
            { ...assumptions, priorities }, taxState
        );

        const flagged = run([
            { id: 'p-loan', name: 'Pay down: Student Loan', type: 'DEBT', accountId: 'acc-studentloan', capType: 'REMAINDER' },
        ]);
        const notFlagged = run([]);

        // Sub-cent loan is treated as paid off — flagging it changes nothing.
        for (let i = 0; i < notFlagged.length; i++) {
            const a = flagged[i]?.expenses.find(e => e.id === 'exp-studentloan') as LoanExpense;
            const b = notFlagged[i]?.expenses.find(e => e.id === 'exp-studentloan') as LoanExpense;
            if (a && b) {
                expect(a.amount, `sub-cent loan must be untouched by the flag in ${notFlagged[i].year}`).toBe(b.amount);
            }
        }
        assertAllYearsInvariants(flagged);
    });

    it('C default-off: with no debt in priorities, a debt account tracks only its loan', () => {
        // No debt priority bucket → surplus must NOT touch the student-loan debt;
        // its balance path is driven solely by the linked loan's amortization.
        const sim = runSimulation(
            yearsToSimulate,
            [propertyAccount, studentLoanAccount, savingsAccount],
            [workIncome],
            [mortgageExpense, studentLoanExpense, livingExpenses],
            assumptions,
            taxState
        );

        for (const year of sim) {
            const loanExpense = year.expenses.find(e => e.id === 'exp-studentloan') as LoanExpense;
            const loanAccount = year.accounts.find(a => a.id === 'acc-studentloan') as DebtAccount;
            if (loanExpense && loanAccount) {
                expect(
                    Math.abs(loanExpense.amount - loanAccount.amount),
                    `Debt should track its loan exactly in ${year.year}`
                ).toBeLessThan(10);
            }
        }
    });

    it('C default-off is BYTE-IDENTICAL: an unflagged debt is unchanged vs. no priorities', () => {
        // The hard safety net: with no debt in any priority list, the linked-debt
        // surplus paydown must not mutate anything. A run with empty priorities and
        // a run with an UNRELATED priority (savings) must both leave the loan
        // balance on its pure scheduled-amortization path, every year.
        const run = (priorities: AssumptionsState['priorities']) => runSimulation(
            yearsToSimulate,
            [propertyAccount, studentLoanAccount, savingsAccount],
            [workIncome],
            [mortgageExpense, studentLoanExpense, livingExpenses],
            { ...assumptions, priorities },
            taxState
        );

        const empty = run([]);
        const unrelated = run([
            { id: 'p-sav', name: 'Savings', type: 'SAVINGS', accountId: 'acc-savings', capType: 'REMAINDER' },
        ]);

        // The student-loan balance path is identical to the bit (no debt bucket →
        // no extra principal → pure amortization in both runs).
        for (let i = 0; i < empty.length; i++) {
            const a = empty[i].expenses.find(e => e.id === 'exp-studentloan') as LoanExpense;
            const b = unrelated[i].expenses.find(e => e.id === 'exp-studentloan') as LoanExpense;
            if (a && b) {
                expect(a.amount, `loan balance must be unchanged by an unrelated priority in ${empty[i].year}`)
                    .toBe(b.amount);
            }
        }
    });

    it('[3] gates on the LOAN balance: a $0 mirror with an owing loan is still paid down', () => {
        // The DebtAccount MIRROR is $0 but its linked LoanExpense still owes $5000.
        // The engine must gate the paydown on the LOAN balance (authoritative), not
        // the mirror — otherwise the paydown is silently dropped. (Local dates per
        // the project's date-only rule.)
        const owingLoan = new LoanExpense(
            'exp-owing', 'Personal Loan', 5000, 'Monthly', 12.0, 'Compounding',
            120, 'No', 0, 'acc-owing',
            new Date(2025, 0, 1), new Date(2035, 0, 1)
        );
        const staleMirror = new DebtAccount('acc-owing', 'Personal Loan Debt', 0, 'exp-owing', 12.0); // mirror $0

        const flagged: AssumptionsState = {
            ...assumptions,
            priorities: [
                { id: 'p-owing', name: 'Pay down: Personal Loan', type: 'DEBT', accountId: 'acc-owing', capType: 'REMAINDER' },
            ],
        };

        const run = (a: AssumptionsState) => runSimulation(
            yearsToSimulate,
            [propertyAccount, staleMirror, savingsAccount],
            [workIncome],
            [mortgageExpense, owingLoan, livingExpenses],
            a, taxState
        );

        const flaggedSim = run(flagged);
        const baselineSim = run({ ...assumptions, priorities: [] });

        // The flagged loan clears strictly sooner than the schedule-only baseline —
        // proving the paydown WAS applied despite the $0 mirror.
        const payoffYear = (sim: typeof flaggedSim): number | null => {
            for (const y of sim) {
                const loan = y.expenses.find(e => e.id === 'exp-owing') as LoanExpense;
                if (loan && loan.amount <= 1) return y.year;
            }
            return null;
        };
        const flaggedPayoff = payoffYear(flaggedSim);
        const basePayoff = payoffYear(baselineSim);
        expect(flaggedPayoff).not.toBeNull();
        expect(basePayoff).not.toBeNull();
        expect(flaggedPayoff!).toBeLessThan(basePayoff!);
        assertAllYearsInvariants(flaggedSim);
    });
});
