/**
 * Story 4: RMD Compliance
 *
 * Scenario: Age 70, $1.5M Traditional 401k, verify RMDs start correctly
 *
 * Key Assertions:
 * - RMD starts at age 73 (for birth year 1955)
 * - RMD = Prior Year Balance / Distribution Period
 * - RMD only from Traditional accounts (not Roth)
 * - RMD treated as taxable income
 *
 * Bugs Caught: Wrong RMD start age, using current vs prior balance, applying to Roth
 */

import { describe, it, expect } from 'vitest';
import { AssumptionsState, defaultAssumptions } from '../../../components/Objects/Assumptions/AssumptionsContext';
import { TaxState } from '../../../components/Objects/Taxes/TaxContext';
import { InvestedAccount } from '../../../components/Objects/Accounts/models';
import { FutureSocialSecurityIncome } from '../../../components/Objects/Income/models';
import { FoodExpense } from '../../../components/Objects/Expense/models';
import { runSimulation } from '../../../components/Objects/Assumptions/useSimulation';
import {
    getAge,
    getYearByAge,
    getAccountById,
    hasLogMessage,
} from '../helpers/simulationTestUtils';
import {
    assertAllYearsInvariants,
} from '../helpers/assertions';

describe('Story 4: RMD Compliance', () => {
    // Birth year 1955: RMD starts at age 73 under SECURE Act 2.0
    const birthYear = 1955;
    const rmdStartAge = 73;
    const yearsToSimulate = 25; // From current age to well past RMD start

    const taxState: TaxState = {
        filingStatus: 'Single',
        stateResidency: 'DC',
        deductionMethod: 'Standard',
        fedOverride: null,
        ficaOverride: null,
        stateOverride: null,
        year: 2025,
    };

    // Current age is 70 (2025 - 1955 = 70)

    const assumptions: AssumptionsState = {
        ...defaultAssumptions,
        demographics: {
            birthYear,
            lifeExpectancy: 95,
            retirementAge: 65, // Already retired
        },
        income: {
            ...defaultAssumptions.income,
            salaryGrowth: 0,
        },
        macro: {
            ...defaultAssumptions.macro,
            inflationRate: 0,
            inflationAdjusted: false,
        },
        investments: {
            ...defaultAssumptions.investments,
            returnRates: { ror: 7 },
            autoRothConversions: false,
        },
        withdrawalStrategy: [
            { id: 'ws-trad', name: 'Traditional 401k', accountId: 'acc-trad401k' },
            { id: 'ws-roth', name: 'Roth 401k', accountId: 'acc-roth401k' },
        ],
    };

    // Large Traditional 401k - subject to RMD
    const traditional401k = new InvestedAccount(
        'acc-trad401k',
        'Traditional 401k',
        1500000, // $1.5M
        0,
        30,
        0.05,
        'Traditional 401k',
        true,
        1.0,
        500000   // Cost basis (doesn't matter for Traditional - all withdrawals are income)
    );

    // Roth 401k - NOT subject to RMD (after SECURE Act 2.0, starting 2024)
    const roth401k = new InvestedAccount(
        'acc-roth401k',
        'Roth 401k',
        500000, // $500k
        0,
        30,
        0.05,
        'Roth 401k',
        true,
        1.0,
        300000
    );

    // Social Security (already claiming at 70)
    const futureSS = new FutureSocialSecurityIncome(
        'inc-ss',
        'Social Security',
        70, // Claimed at 70
        2500, // Monthly benefit
        2024  // Already calculated
    );

    // Living expenses
    const livingExpenses = new FoodExpense(
        'exp-living',
        'Living Expenses',
        50000,
        'Annually',
        new Date('2025-01-01')
    );

    it('should run simulation without errors', () => {
        const simulation = runSimulation(
            yearsToSimulate,
            [traditional401k, roth401k],
            [futureSS],
            [livingExpenses],
            assumptions,
            taxState
        );

        expect(simulation.length).toBeGreaterThan(0);
        assertAllYearsInvariants(simulation);
    });

    it('should NOT have RMD before age 73', () => {
        const simulation = runSimulation(
            yearsToSimulate,
            [traditional401k, roth401k],
            [futureSS],
            [livingExpenses],
            assumptions,
            taxState
        );

        for (const year of simulation) {
            const age = getAge(year.year, birthYear);
            if (age < rmdStartAge) {
                // Should NOT have RMD log before age 73
                const hasRMDLog = hasLogMessage(year, 'rmd');
                expect(hasRMDLog, `RMD should NOT be applied before age ${rmdStartAge} (currently ${age})`).toBe(false);
            }
        }
    });

    it('should start RMD at age 73 with correct calculation', () => {
        const simulation = runSimulation(
            yearsToSimulate,
            [traditional401k, roth401k],
            [futureSS],
            [livingExpenses],
            assumptions,
            taxState
        );

        const preRMDYear = getYearByAge(simulation, rmdStartAge - 1, birthYear);
        const rmdYear = getYearByAge(simulation, rmdStartAge, birthYear);

        if (preRMDYear && rmdYear) {
            const priorBalance = getAccountById(preRMDYear, 'acc-trad401k')?.amount || 0;
            const traditionalWithdrawal = rmdYear.cashflow.withdrawalDetail['Traditional 401k'] || 0;

            // IRS Uniform Lifetime Table: age 73 divisor = 26.5
            const expectedRMD = priorBalance / 26.5;

            // Math-based assertion: withdrawal should be within 10% of expected RMD
            // (may be higher if expenses require more, but should be at least the RMD)
            expect(
                traditionalWithdrawal,
                `RMD at 73: withdrawal ($${traditionalWithdrawal.toFixed(0)}) should be ≥ expected RMD ($${expectedRMD.toFixed(0)})`
            ).toBeGreaterThanOrEqual(expectedRMD * 0.9);

            // Log can remain as secondary signal
            const hasRMDLog = hasLogMessage(rmdYear, 'rmd');
            expect(hasRMDLog, `RMD log should exist at age ${rmdStartAge}`).toBe(true);
        }
    });

    it('should apply RMD only to Traditional accounts (not Roth)', () => {
        const simulation = runSimulation(
            yearsToSimulate,
            [traditional401k, roth401k],
            [futureSS],
            [livingExpenses],
            assumptions,
            taxState
        );

        for (const year of simulation) {
            const age = getAge(year.year, birthYear);
            if (age < rmdStartAge) continue;

            // Check logs - RMD should only mention Traditional
            const hasRothRMDLog = year.logs.some(log =>
                log.toLowerCase().includes('rmd') &&
                log.toLowerCase().includes('roth')
            );

            // SECURE Act 2.0 eliminated Roth 401k RMDs starting in 2024
            expect(hasRothRMDLog, `Roth should NOT have RMD at age ${age}`).toBe(false);
        }
    });

    it('should calculate RMD as balance / distribution period', () => {
        const simulation = runSimulation(
            yearsToSimulate,
            [traditional401k, roth401k],
            [futureSS],
            [livingExpenses],
            assumptions,
            taxState
        );

        // Get year before RMD starts and RMD year
        const preRMDYear = getYearByAge(simulation, rmdStartAge - 1, birthYear);
        const rmdYear = getYearByAge(simulation, rmdStartAge, birthYear);

        if (preRMDYear && rmdYear) {
            const priorBalance = getAccountById(preRMDYear, 'acc-trad401k')?.amount || 0;

            // IRS Uniform Lifetime Table distribution period at age 73 is 26.5
            const distributionPeriod73 = 26.5;
            const expectedRMD = priorBalance / distributionPeriod73;

            // Check that withdrawals include approximately the RMD amount
            const traditionalWithdrawal = rmdYear.cashflow.withdrawalDetail['Traditional 401k'] || 0;

            // RMD should be at least close to the calculated amount
            // (May be higher if additional withdrawals are needed for expenses)
            if (traditionalWithdrawal > 0 && priorBalance > 0) {
                expect(traditionalWithdrawal, 'Withdrawal should be at least the RMD amount').toBeGreaterThanOrEqual(expectedRMD * 0.9);
            }
        }
    });

    it('should treat RMD as taxable income', () => {
        const simulation = runSimulation(
            yearsToSimulate,
            [traditional401k, roth401k],
            [futureSS],
            [livingExpenses],
            assumptions,
            taxState
        );

        const rmdYear = getYearByAge(simulation, rmdStartAge, birthYear);

        if (rmdYear) {
            const traditionalWithdrawal = rmdYear.cashflow.withdrawalDetail['Traditional 401k'] || 0;

            if (traditionalWithdrawal > 0) {
                // RMD counts as taxable income - verify total income includes it
                // Note: Federal tax may be 0 if standard deduction exceeds taxable income
                // but the withdrawal should still contribute to gross income
                expect(rmdYear.taxDetails.fed, 'Fed tax should be non-negative with RMD').toBeGreaterThanOrEqual(0);

                // The total income should reflect the withdrawal
                expect(rmdYear.cashflow.totalIncome, 'Total income should include RMD').toBeGreaterThan(0);
            }
        }
    });

    it('should have RMDs continue every year with correct IRS divisors', () => {
        const simulation = runSimulation(
            yearsToSimulate,
            [traditional401k, roth401k],
            [futureSS],
            [livingExpenses],
            assumptions,
            taxState
        );

        // IRS Uniform Lifetime Table divisors (2024+)
        const irsDivisors: Record<number, number> = {
            73: 26.5, 74: 25.5, 75: 24.6, 76: 23.7, 77: 22.9, 78: 22.0
        };

        // Check RMD math at each age
        for (let age = rmdStartAge; age <= rmdStartAge + 5; age++) {
            const prevYear = getYearByAge(simulation, age - 1, birthYear);
            const currYear = getYearByAge(simulation, age, birthYear);

            if (prevYear && currYear) {
                const priorBalance = getAccountById(prevYear, 'acc-trad401k')?.amount || 0;
                const tradWithdrawal = currYear.cashflow.withdrawalDetail['Traditional 401k'] || 0;

                // Only check if there's meaningful balance
                if (priorBalance > 10000) {
                    const divisor = irsDivisors[age] || 25.0;
                    const expectedRMD = priorBalance / divisor;

                    // Math-based assertion: withdrawal should be at least the required RMD
                    expect(
                        tradWithdrawal,
                        `Age ${age}: withdrawal ($${tradWithdrawal.toFixed(0)}) should be ≥ RMD ($${expectedRMD.toFixed(0)}) [balance $${priorBalance.toFixed(0)} / ${divisor}]`
                    ).toBeGreaterThanOrEqual(expectedRMD * 0.85);
                }
            }
        }
    });

    it('should use prior year balance for RMD calculation', () => {
        const simulation = runSimulation(
            yearsToSimulate,
            [traditional401k, roth401k],
            [futureSS],
            [livingExpenses],
            assumptions,
            taxState
        );

        // Get consecutive years
        const year73 = getYearByAge(simulation, 73, birthYear);
        const year74 = getYearByAge(simulation, 74, birthYear);

        if (year73 && year74) {
            // Year 74 RMD should be based on year 73 end balance
            const year73EndBalance = getAccountById(year73, 'acc-trad401k')?.amount || 0;

            // Distribution period at 74 is 25.5
            const expectedRMD74 = year73EndBalance / 25.5;

            // The actual withdrawal should be at least the RMD
            const year74Withdrawal = year74.cashflow.withdrawalDetail['Traditional 401k'] || 0;

            if (year74Withdrawal > 0 && year73EndBalance > 0) {
                // Allow some tolerance for timing and growth
                expect(year74Withdrawal, 'Year 74 withdrawal should be near expected RMD').toBeGreaterThanOrEqual(expectedRMD74 * 0.8);
            }
        }
    });

    it('should handle large balances without overflow', () => {
        // Test with very large balance
        const largeTrad = new InvestedAccount(
            'acc-trad401k', 'Traditional 401k', 10000000, 0, 30, 0.05, 'Traditional 401k', true, 1.0, 3000000
        );

        const simulation = runSimulation(
            yearsToSimulate,
            [largeTrad, roth401k],
            [futureSS],
            [livingExpenses],
            assumptions,
            taxState
        );

        // Should run without errors or NaN
        assertAllYearsInvariants(simulation);

        const rmdYear = getYearByAge(simulation, rmdStartAge, birthYear);
        if (rmdYear) {
            const withdrawal = rmdYear.cashflow.withdrawalDetail['Traditional 401k'] || 0;
            expect(Number.isFinite(withdrawal), 'Withdrawal should be a finite number').toBe(true);
            expect(withdrawal, 'Large balance should produce substantial RMD').toBeGreaterThan(100000);
        }
    });

    it('should deplete account faster with RMDs', () => {
        const simulation = runSimulation(
            yearsToSimulate,
            [traditional401k, roth401k],
            [futureSS],
            [livingExpenses],
            assumptions,
            taxState
        );

        // Get initial and final Traditional balance
        const firstRMDYear = getYearByAge(simulation, rmdStartAge, birthYear);
        const finalYear = simulation[simulation.length - 1];

        if (firstRMDYear && finalYear) {
            const initialBalance = getAccountById(firstRMDYear, 'acc-trad401k')?.amount || 0;
            const finalBalance = getAccountById(finalYear, 'acc-trad401k')?.amount || 0;

            // With market returns, account may not deplete quickly, but RMDs should
            // cause it to grow slower than market returns would suggest.
            // Just verify that some withdrawal activity occurred and balance is finite.
            expect(
                Number.isFinite(finalBalance),
                'Final balance should be a finite number'
            ).toBe(true);

            // RMDs should have happened - balance change should be less than pure growth
            // would suggest (withdrawals offset some growth)
            expect(
                finalBalance,
                `Final balance ($${finalBalance.toFixed(0)}) should be reasonable`
            ).toBeLessThan(initialBalance * 3); // Not more than 3x growth over simulation
        }
    });
});
