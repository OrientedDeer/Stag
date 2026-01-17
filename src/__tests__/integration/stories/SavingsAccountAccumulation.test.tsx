/**
 * Story: Savings Account with Interest Income
 *
 * Scenario: Person with high-yield savings accounts earning interest over multiple years
 *
 * Key Assertions:
 * - Interest income calculated correctly each year (APR * prior balance)
 * - NO carryover pollution (interest not double-counted year over year)
 * - Interest is taxable but not spendable (reinvested into account)
 * - Account grows at exactly APR rate each year
 * - Tax on interest income calculated correctly (no FICA, yes federal)
 * - Zero balance edge case: no interest when account is drained
 * - Multiple accounts: interest tracked independently
 *
 * Bugs Caught:
 * - Interest income carryover (double-counting)
 * - Exponential instead of linear interest growth
 * - Tax treatment errors (FICA on interest)
 */

import { describe, it, expect } from 'vitest';
import { AssumptionsState, defaultAssumptions } from '../../../components/Objects/Assumptions/AssumptionsContext';
import { TaxState } from '../../../components/Objects/Taxes/TaxContext';
import { SavedAccount } from '../../../components/Objects/Accounts/models';
import { WorkIncome, PassiveIncome } from '../../../components/Objects/Income/models';
import { FoodExpense } from '../../../components/Objects/Expense/models';
import { runSimulation } from '../../../components/Objects/Assumptions/useSimulation';
import {
    getAccountById,
} from '../helpers/simulationTestUtils';
import {
    assertAllYearsInvariants,
    assertNoIncomeCarryover,
    assertInterestGrowsLinearly,
    assertNoValueExplosion,
} from '../helpers/assertions';

describe('Story: Savings Account Accumulation', () => {
    const birthYear = 1990;
    const retirementAge = 65;
    const yearsToSimulate = 15; // 15 years is enough to catch accumulation bugs

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
            salaryGrowth: 0, // No salary growth for clearer math
        },
        macro: {
            ...defaultAssumptions.macro,
            inflationRate: 0, // Disable inflation for predictable math
            inflationAdjusted: false,
        },
        investments: {
            ...defaultAssumptions.investments,
            returnRates: { ror: 0 }, // No market returns, only APR interest
            autoRothConversions: false,
        },
        withdrawalStrategy: [],
    };

    // High-yield savings account with 5% APR
    const savingsAccount = new SavedAccount(
        'acc-hysa',
        'High Yield Savings',
        100000, // $100k initial balance
        5       // 5% APR
    );

    // Work income
    const workIncome = new WorkIncome(
        'inc-work',
        'Salary',
        80000,
        'Annually',
        'Yes',
        0, 0, 0, 0, '', null, 'FIXED',
        new Date('2025-01-01'),
        new Date('2054-12-31') // Works until age 64
    );

    // Living expenses
    const livingExpenses = new FoodExpense(
        'exp-living',
        'Living Expenses',
        40000,
        'Annually',
        new Date('2025-01-01')
    );

    // ==========================================================================
    // CORE INTEREST ACCUMULATION TESTS
    // ==========================================================================

    it('should run simulation with savings account for 15 years without errors', () => {
        const simulation = runSimulation(
            yearsToSimulate,
            [savingsAccount],
            [workIncome],
            [livingExpenses],
            assumptions,
            taxState
        );

        expect(simulation.length).toBeGreaterThan(0);
        assertAllYearsInvariants(simulation);
    });

    it('should NOT have carryover pollution for interest income', () => {
        const simulation = runSimulation(
            yearsToSimulate,
            [savingsAccount],
            [workIncome],
            [livingExpenses],
            assumptions,
            taxState
        );

        // With 1 savings account, there should be at most 1 interest income per year
        assertNoIncomeCarryover(simulation, 'Interest', 1);
    });

    it('should have exactly 1 interest income per savings account per year', () => {
        // Use 2 savings accounts
        const hysa1 = new SavedAccount('acc-hysa1', 'HYSA 1', 50000, 5);
        const hysa2 = new SavedAccount('acc-hysa2', 'HYSA 2', 30000, 4);

        const simulation = runSimulation(
            yearsToSimulate,
            [hysa1, hysa2],
            [workIncome],
            [livingExpenses],
            assumptions,
            taxState
        );

        // With 2 savings accounts, there should be at most 2 interest incomes per year
        assertNoIncomeCarryover(simulation, 'Interest', 2);

        // Verify each year has exactly 2 interest incomes (one per account)
        for (let i = 1; i < simulation.length; i++) {
            const year = simulation[i];
            const interestIncomes = year.incomes.filter(
                inc => inc instanceof PassiveIncome && inc.sourceType === 'Interest'
            );

            expect(
                interestIncomes.length,
                `Year ${year.year}: Should have exactly 2 interest incomes (one per account), found ${interestIncomes.length}`
            ).toBe(2);
        }
    });

    it('should calculate interest correctly as APR * prior balance', () => {
        const simulation = runSimulation(
            yearsToSimulate,
            [savingsAccount],
            [workIncome],
            [livingExpenses],
            assumptions,
            taxState
        );

        // Check interest calculation for each year
        assertInterestGrowsLinearly(simulation, 'acc-hysa', 5);
    });

    it('should grow account at exactly APR rate each year', () => {
        // Use only savings account with no expenses that could drain it
        const isolatedAssumptions = {
            ...assumptions,
        };

        // Very small expenses so account grows
        const tinyExpenses = new FoodExpense(
            'exp-tiny', 'Tiny Expenses', 1000, 'Annually', new Date('2025-01-01')
        );

        const simulation = runSimulation(
            10, // 10 years
            [savingsAccount],
            [workIncome],
            [tinyExpenses],
            isolatedAssumptions,
            taxState
        );

        // Check compound growth: each year balance = prev * 1.05
        for (let i = 1; i < simulation.length; i++) {
            const prevYear = simulation[i - 1];
            const currYear = simulation[i];

            const prevAccount = getAccountById(prevYear, 'acc-hysa');
            const currAccount = getAccountById(currYear, 'acc-hysa');

            if (!prevAccount || !currAccount) continue;

            // Expected balance = prior * (1 + APR/100)
            const expectedBalance = prevAccount.amount * 1.05;

            // Allow 1% tolerance for timing/rounding
            const tolerance = expectedBalance * 0.01;

            expect(
                Math.abs(currAccount.amount - expectedBalance),
                `Year ${currYear.year}: Account should grow by 5% APR. ` +
                `Expected ~$${expectedBalance.toFixed(0)}, got $${currAccount.amount.toFixed(0)}`
            ).toBeLessThan(tolerance);
        }
    });

    // ==========================================================================
    // TAX TREATMENT TESTS
    // ==========================================================================

    it('should include interest in taxable income (totalIncome)', () => {
        // Savings account only, no work income
        const simulation = runSimulation(
            5,
            [savingsAccount],
            [], // No other income
            [livingExpenses],
            { ...assumptions, demographics: { ...assumptions.demographics, retirementAge: 30 } },
            taxState
        );

        // Year 2 should have interest income in totalIncome
        const year2 = simulation[1];
        const expectedInterest = 100000 * 0.05; // $5,000

        expect(
            year2.cashflow.totalIncome,
            `Total income should include ~$5k interest`
        ).toBeGreaterThanOrEqual(expectedInterest * 0.95);
    });

    it('should NOT apply FICA tax to interest income', () => {
        // Only interest income (no work income)
        const retiredAssumptions = {
            ...assumptions,
            demographics: { ...assumptions.demographics, retirementAge: 30 },
        };

        const simulation = runSimulation(
            5,
            [savingsAccount],
            [], // No work income
            [livingExpenses],
            retiredAssumptions,
            taxState
        );

        // Check FICA is 0 when only income is interest
        for (const year of simulation) {
            expect(
                year.taxDetails.fica,
                `Year ${year.year}: FICA should be 0 with only interest income`
            ).toBe(0);
        }
    });

    it('should apply federal income tax to interest above standard deduction', () => {
        // Large savings account to generate interest above standard deduction
        const largeSavings = new SavedAccount('acc-large', 'Large Savings', 500000, 5);
        // Interest = $25,000 > $14,600 standard deduction

        const retiredAssumptions = {
            ...assumptions,
            demographics: { ...assumptions.demographics, retirementAge: 30 },
        };

        const simulation = runSimulation(
            3,
            [largeSavings],
            [], // No work income
            [livingExpenses],
            retiredAssumptions,
            taxState
        );

        // Year 2 should have federal tax > 0
        const year2 = simulation[1];

        expect(
            year2.taxDetails.fed,
            `Federal tax should be > 0 with $25k interest (above standard deduction)`
        ).toBeGreaterThan(0);
    });

    // ==========================================================================
    // EDGE CASES
    // ==========================================================================

    it('should generate no interest when account balance is zero', () => {
        // Start with zero balance
        const emptySavings = new SavedAccount('acc-empty', 'Empty Savings', 0, 5);

        const simulation = runSimulation(
            5,
            [emptySavings],
            [workIncome],
            [livingExpenses],
            assumptions,
            taxState
        );

        // Should have no interest income
        for (const year of simulation) {
            const interestIncomes = year.incomes.filter(
                inc => inc instanceof PassiveIncome && inc.sourceType === 'Interest'
            );

            expect(
                interestIncomes.length,
                `Year ${year.year}: Should have no interest income for empty account`
            ).toBe(0);
        }
    });

    it('should handle account being drained to zero gracefully', () => {
        // Small savings account that will be drained
        const smallSavings = new SavedAccount('acc-small', 'Small Savings', 10000, 5);

        // Very high expenses to drain the account
        const highExpenses = new FoodExpense(
            'exp-high', 'High Expenses', 100000, 'Annually', new Date('2025-01-01')
        );

        // No work income - will need withdrawals
        const retiredAssumptions = {
            ...assumptions,
            demographics: { ...assumptions.demographics, retirementAge: 30 },
            withdrawalStrategy: [
                { id: 'ws-savings', name: 'Small Savings', accountId: 'acc-small' },
            ],
        };

        const simulation = runSimulation(
            5,
            [smallSavings],
            [], // No income
            [highExpenses],
            retiredAssumptions,
            taxState
        );

        // Should run without errors
        assertAllYearsInvariants(simulation);
    });

    it('should track interest independently for multiple accounts', () => {
        const hysa1 = new SavedAccount('acc-hysa1', 'HYSA 1', 100000, 5); // $5k interest/year
        const hysa2 = new SavedAccount('acc-hysa2', 'HYSA 2', 50000, 4);  // $2k interest/year

        const simulation = runSimulation(
            10,
            [hysa1, hysa2],
            [workIncome],
            [livingExpenses],
            assumptions,
            taxState
        );

        // Check year 2 interest incomes
        const year2 = simulation[1];
        const interestIncomes = year2.incomes.filter(
            inc => inc instanceof PassiveIncome && inc.sourceType === 'Interest'
        ) as PassiveIncome[];

        expect(interestIncomes.length).toBe(2);

        const interest1 = interestIncomes.find(i => i.name.includes('HYSA 1'));
        const interest2 = interestIncomes.find(i => i.name.includes('HYSA 2'));

        expect(interest1?.amount).toBeCloseTo(5000, -2); // ~$5k
        expect(interest2?.amount).toBeCloseTo(2000, -2); // ~$2k
    });

    // ==========================================================================
    // ANTI-REGRESSION: DOUBLE-COUNTING BUG DETECTION
    // ==========================================================================

    it('should NOT have exponential interest growth (catches double-counting bug)', () => {
        const simulation = runSimulation(
            yearsToSimulate,
            [savingsAccount],
            [workIncome],
            [livingExpenses],
            assumptions,
            taxState
        );

        // Use existing assertion - should catch runaway growth
        assertNoValueExplosion(simulation, 0.10); // 10% max annual growth (5% APR + buffer)
    });

    it('should have total interest income match expected compound formula', () => {
        const simulation = runSimulation(
            10,
            [savingsAccount],
            [workIncome],
            [livingExpenses],
            assumptions,
            taxState
        );

        // Calculate expected total interest over 10 years with compound growth
        // Year 1: 100000 * 0.05 = 5000
        // Year 2: 105000 * 0.05 = 5250
        // etc.
        let expectedTotalInterest = 0;
        let balance = 100000;
        for (let i = 0; i < 10; i++) {
            const interest = balance * 0.05;
            expectedTotalInterest += interest;
            balance += interest;
        }

        // Sum actual interest incomes
        let actualTotalInterest = 0;
        for (const year of simulation) {
            const interestIncomes = year.incomes.filter(
                inc => inc instanceof PassiveIncome && inc.sourceType === 'Interest'
            ) as PassiveIncome[];
            actualTotalInterest += interestIncomes.reduce((sum, inc) => sum + inc.amount, 0);
        }

        // Allow 5% tolerance
        const tolerance = expectedTotalInterest * 0.05;

        expect(
            Math.abs(actualTotalInterest - expectedTotalInterest),
            `Total interest ($${actualTotalInterest.toFixed(0)}) should match expected compound formula ` +
            `($${expectedTotalInterest.toFixed(0)}). Large discrepancy suggests double-counting.`
        ).toBeLessThan(tolerance);
    });

    it('should maintain universal invariants every year', () => {
        const simulation = runSimulation(
            yearsToSimulate,
            [savingsAccount],
            [workIncome],
            [livingExpenses],
            assumptions,
            taxState
        );

        assertAllYearsInvariants(simulation);
    });
});
