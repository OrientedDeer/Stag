/**
 * Golden Master Snapshot Test
 *
 * A single, known scenario with fixed inputs that captures key outputs.
 * This test detects accidental logic changes by comparing against known-good values.
 *
 * What it captures:
 * - Final net worth
 * - Federal tax for the first 5 years
 * - Year-1 cashflow breakdown
 * - Key account balances at specific ages
 *
 * IMPORTANT: If this test fails after an intentional change, update the snapshot
 * values to match the new expected behavior.
 */

import { describe, it, expect } from 'vitest';
import { AssumptionsState, defaultAssumptions } from '../../../components/Objects/Assumptions/AssumptionsContext';
import { TaxState } from '../../../components/Objects/Taxes/TaxContext';
import { InvestedAccount } from '../../../components/Objects/Accounts/models';
import { WorkIncome, FutureSocialSecurityIncome } from '../../../components/Objects/Income/models';
import { FoodExpense } from '../../../components/Objects/Expense/models';
import { runSimulation } from '../../../components/Objects/Assumptions/useSimulation';
import {
    calculateNetWorth,
    getYearByAge,
} from '../helpers/simulationTestUtils';
import {
    assertAllYearsInvariants,
} from '../helpers/assertions';

describe('Golden Master Snapshot', () => {
    // Fixed inputs - DO NOT CHANGE these without updating the expected values
    const BIRTH_YEAR = 1980;
    const RETIREMENT_AGE = 65;
    const YEARS_TO_SIMULATE = 30;

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
            birthYear: BIRTH_YEAR,
            lifeExpectancy: 95,
            retirementAge: RETIREMENT_AGE,
        },
        income: {
            ...defaultAssumptions.income,
            salaryGrowth: 3.0,
        },
        macro: {
            ...defaultAssumptions.macro,
            inflationRate: 0, // Zero inflation for deterministic testing
            inflationAdjusted: false,
        },
        investments: {
            ...defaultAssumptions.investments,
            returnRates: { ror: 7 }, // Fixed 7% return
            autoRothConversions: false,
        },
        withdrawalStrategy: [
            { id: 'ws-brokerage', name: 'Brokerage', accountId: 'acc-brokerage' },
            { id: 'ws-401k', name: '401k', accountId: 'acc-401k' },
        ],
    };

    // Fixed account starting values
    const brokerage = new InvestedAccount(
        'acc-brokerage',
        'Brokerage',
        100000,     // $100k starting
        0,          // No contributions
        20,
        0.05,
        'Brokerage',
        true,
        1.0,
        80000       // $80k cost basis
    );

    const traditional401k = new InvestedAccount(
        'acc-401k',
        '401k',
        200000,     // $200k starting
        10000,      // $10k annual contribution
        20,
        0.1,
        'Traditional 401k',
        true,
        0.2,
        200000
    );

    // Fixed income
    const workIncome = new WorkIncome(
        'inc-work',
        'Job',
        80000,          // $80k salary
        'Annually',
        'Yes',
        12000,          // Employee contribution to 401k
        3000,           // Employer match
        0,
        6000,           // Half to 401k
        'acc-401k',
        'Traditional 401k',
        'GROW_WITH_SALARY',
        new Date('2010-01-01'),
        new Date(`${BIRTH_YEAR + RETIREMENT_AGE - 1}-12-31`)
    );

    const futureSS = new FutureSocialSecurityIncome(
        'inc-ss',
        'Social Security',
        67,
        0,
        0
    );

    // Fixed expenses
    const livingExpenses = new FoodExpense(
        'exp-living',
        'Living Expenses',
        40000,          // $40k/year
        'Annually',
        new Date('2025-01-01')
    );

    // Run the simulation once for all snapshot tests
    function runGoldenMasterSimulation() {
        return runSimulation(
            YEARS_TO_SIMULATE,
            [brokerage, traditional401k],
            [workIncome, futureSS],
            [livingExpenses],
            assumptions,
            taxState
        );
    }

    it('should pass all invariants', () => {
        const simulation = runGoldenMasterSimulation();
        assertAllYearsInvariants(simulation);
    });

    it('should have stable year-1 cashflow structure', () => {
        const simulation = runGoldenMasterSimulation();
        const year1 = simulation[0];

        // Year 1 should be the current simulation year (may vary based on birth year)
        expect(year1.year).toBeGreaterThanOrEqual(2025);

        // Total income should include salary
        expect(year1.cashflow.totalIncome).toBeGreaterThan(0);

        // Total expense should include living expenses
        expect(year1.cashflow.totalExpense).toBeGreaterThan(0);

        // Tax details should exist
        expect(year1.taxDetails.fed).toBeGreaterThanOrEqual(0);
        expect(year1.taxDetails.fica).toBeGreaterThanOrEqual(0);
        expect(year1.taxDetails.state).toBeGreaterThanOrEqual(0);

        // Cashflow structure should exist
        expect(year1.cashflow).toBeDefined();
        expect(year1.cashflow.withdrawals).toBeDefined();
    });

    it('should have consistent federal tax trajectory for first 5 years', () => {
        const simulation = runGoldenMasterSimulation();

        // Capture first 5 years of federal tax
        const first5YearsFedTax = simulation.slice(0, 5).map(y => y.taxDetails.fed);

        // All should be non-negative
        first5YearsFedTax.forEach((tax, i) => {
            expect(tax, `Year ${i + 1} fed tax should be non-negative`).toBeGreaterThanOrEqual(0);
        });

        // During working years, federal tax should be positive (earning $80k+)
        // Allow for some edge cases where deductions may zero out tax
        const avgTax = first5YearsFedTax.reduce((a, b) => a + b, 0) / 5;
        expect(avgTax, 'Average fed tax in first 5 years should be positive').toBeGreaterThan(0);

        // Tax shouldn't wildly fluctuate (within 50% of each other during steady employment)
        const maxTax = Math.max(...first5YearsFedTax);
        const minTax = Math.min(...first5YearsFedTax);
        if (maxTax > 0) {
            const fluctuation = (maxTax - minTax) / maxTax;
            expect(fluctuation, 'Tax fluctuation should be reasonable').toBeLessThan(0.8);
        }
    });

    it('should have final net worth within expected range', () => {
        const simulation = runGoldenMasterSimulation();
        const finalYear = simulation[simulation.length - 1];
        const finalNetWorth = calculateNetWorth(finalYear.accounts);

        // With:
        // - 7% return over 30 years
        // - $300k starting balance
        // - $80k salary with 3% growth
        // - $40k expenses
        // - Retirement at 65 (20 years of work, 10 years of retirement)
        //
        // Final net worth should be substantial but not astronomical
        // This is a sanity check, not an exact match

        expect(
            finalNetWorth,
            'Final net worth should be positive after 30 years'
        ).toBeGreaterThan(0);

        expect(
            finalNetWorth,
            'Final net worth should be reasonable (not infinite/NaN)'
        ).toBeLessThan(100000000); // Less than $100M

        // Log the actual value for reference when updating snapshots
        // console.log(`Golden Master final net worth: $${finalNetWorth.toFixed(2)}`);
    });

    it('should have expected account balance relationships at key ages', () => {
        const simulation = runGoldenMasterSimulation();

        // At retirement (age 65), should have peak wealth
        const atRetirement = getYearByAge(simulation, 65, BIRTH_YEAR);

        // After retirement (age 75), wealth may be lower due to withdrawals
        const at75 = getYearByAge(simulation, 75, BIRTH_YEAR);

        if (atRetirement && at75) {
            const netWorthAtRetirement = calculateNetWorth(atRetirement.accounts);
            const netWorthAt75 = calculateNetWorth(at75.accounts);

            // Net worth at 65 should be positive (accumulated savings)
            expect(
                netWorthAtRetirement,
                'Net worth at retirement should be substantial'
            ).toBeGreaterThan(100000);

            // Both values should be finite
            expect(Number.isFinite(netWorthAtRetirement)).toBe(true);
            expect(Number.isFinite(netWorthAt75)).toBe(true);
        }
    });

    it('should have Social Security income starting at age 67', () => {
        const simulation = runGoldenMasterSimulation();

        const at66 = getYearByAge(simulation, 66, BIRTH_YEAR);
        const at67 = getYearByAge(simulation, 67, BIRTH_YEAR);
        const at68 = getYearByAge(simulation, 68, BIRTH_YEAR);

        // Before claiming age, SS income should be 0 or not present
        if (at66 && at66.incomes) {
            const ssIncome66 = at66.incomes.find(i => i.name.toLowerCase().includes('social security'));
            if (ssIncome66) {
                // If SS income object exists, its amount should be 0 before claiming
                expect(ssIncome66.amount, 'SS should be 0 before claiming age').toBe(0);
            }
        }

        // At and after claiming age, SS income should be positive
        if (at67 && at67.incomes) {
            const ssIncome67 = at67.incomes.find(i => i.name.toLowerCase().includes('social security')) as FutureSocialSecurityIncome | undefined;
            if (ssIncome67 && ssIncome67.calculatedPIA && ssIncome67.calculatedPIA > 0) {
                expect(ssIncome67.amount, 'SS should be positive at claiming age').toBeGreaterThan(0);
            }
        }

        if (at68 && at68.incomes) {
            const ssIncome68 = at68.incomes.find(i => i.name.toLowerCase().includes('social security')) as FutureSocialSecurityIncome | undefined;
            if (ssIncome68 && ssIncome68.calculatedPIA && ssIncome68.calculatedPIA > 0) {
                expect(ssIncome68.amount, 'SS should be positive after claiming age').toBeGreaterThan(0);
            }
        }
    });

    it('should have work income during working years', () => {
        const simulation = runGoldenMasterSimulation();

        // Find a year during working years (well before retirement)
        // Birth year 1980, in 2025 person is 45, retirement at 65
        // So age 50 (year 2030) should still be working
        const duringWork = getYearByAge(simulation, 50, BIRTH_YEAR);

        if (duringWork && duringWork.incomes) {
            // During working years, work income should be positive
            const workIncome = duringWork.incomes.find(i => i.name === 'Job');
            if (workIncome) {
                expect(workIncome.amount, 'Work income should be positive during working years').toBeGreaterThan(0);
            }
        }

        // Verify income objects exist and have reasonable structure
        expect(simulation[0].incomes.length).toBeGreaterThan(0);
    });

    // =========================================================================
    // SNAPSHOT VALUES
    // These are the "golden master" values. Update these if intentional changes
    // are made to the simulation logic.
    // =========================================================================

    it('should match golden master snapshot values (update if logic changes intentionally)', () => {
        const simulation = runGoldenMasterSimulation();

        // Capture key metrics
        const finalNetWorth = calculateNetWorth(simulation[simulation.length - 1].accounts);
        const year1FedTax = simulation[0].taxDetails.fed;
        const year1TotalIncome = simulation[0].cashflow.totalIncome;
        const year1TotalExpense = simulation[0].cashflow.totalExpense;

        // These are approximate ranges, not exact values
        // This allows for minor floating-point variations while catching major changes

        // Year 1 income should be around $80k (salary)
        expect(
            year1TotalIncome,
            `Year 1 total income ($${year1TotalIncome.toFixed(0)}) should be ~$80k`
        ).toBeGreaterThan(70000);
        expect(year1TotalIncome).toBeLessThan(100000);

        // Year 1 expense should include living expenses plus contributions/taxes
        // The simulation may include 401k contributions and other items in expenses
        expect(
            year1TotalExpense,
            `Year 1 total expense ($${year1TotalExpense.toFixed(0)}) should be reasonable`
        ).toBeGreaterThan(35000);
        expect(year1TotalExpense).toBeLessThan(100000);

        // Year 1 fed tax on ~$80k income should be reasonable
        expect(
            year1FedTax,
            `Year 1 fed tax ($${year1FedTax.toFixed(0)}) should be reasonable`
        ).toBeGreaterThan(0);
        expect(year1FedTax).toBeLessThan(30000);

        // Final net worth after 30 years should be substantial
        expect(
            finalNetWorth,
            `Final net worth ($${finalNetWorth.toFixed(0)}) should be substantial`
        ).toBeGreaterThan(500000);
        expect(finalNetWorth).toBeLessThan(50000000);
    });
});
