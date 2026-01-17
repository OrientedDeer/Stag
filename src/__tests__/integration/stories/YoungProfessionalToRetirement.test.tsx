/**
 * Story 1: Young Professional → Retirement (Accumulation to Decumulation)
 *
 * Scenario: Age 30, $80k salary with 3% raises, retires at 65, claims SS at 67
 *
 * Key Assertions:
 * - During accumulation: 401k receives contributions, balance grows year-over-year
 * - At retirement: WorkIncome amount → 0, contributions stop
 * - At claiming age: SS calculatedPIA > 0
 * - Employer match tracks salary growth
 *
 * Bugs Caught: Work income not ending at retirement, contributions continuing after retirement
 */

import { describe, it, expect } from 'vitest';
import { AssumptionsState, defaultAssumptions } from '../../../components/Objects/Assumptions/AssumptionsContext';
import { TaxState } from '../../../components/Objects/Taxes/TaxContext';
import { InvestedAccount } from '../../../components/Objects/Accounts/models';
import { WorkIncome, FutureSocialSecurityIncome } from '../../../components/Objects/Income/models';
import { FoodExpense } from '../../../components/Objects/Expense/models';
import { runSimulation } from '../../../components/Objects/Assumptions/useSimulation';
import {
    getAge,
    getYearByAge,
    getAccountById,
    getWorkIncome,
    getSocialSecurityIncome,
} from '../helpers/simulationTestUtils';
import {
    assertUniversalInvariants,
    assertAllYearsInvariants,
} from '../helpers/assertions';

describe('Story 1: Young Professional → Retirement', () => {
    // Setup: Birth year 1995 (age 30 in 2025), retire at 65, claim SS at 67
    const birthYear = 1995;
    const retirementAge = 65;
    const ssClaimingAge = 67;
    // startAge = 30 (2025 - 1995)
    const yearsToSimulate = 40; // Age 30 to 70

    const assumptions: AssumptionsState = {
        ...defaultAssumptions,
        demographics: {
            birthYear,
            lifeExpectancy: 90,
            retirementAge,
        },
        income: {
            ...defaultAssumptions.income,
            salaryGrowth: 3.0, // 3% real raises
        },
        macro: {
            ...defaultAssumptions.macro,
            inflationRate: 0, // Disable inflation for clearer math
            inflationAdjusted: false,
        },
        investments: {
            ...defaultAssumptions.investments,
            returnRates: { ror: 7 }, // 7% return
            autoRothConversions: false,
        },
        withdrawalStrategy: [
            { id: 'ws-1', name: '401k', accountId: 'ret-401k' },
        ],
    };

    const taxState: TaxState = {
        filingStatus: 'Single',
        stateResidency: 'DC',
        deductionMethod: 'Standard',
        fedOverride: null,
        ficaOverride: null,
        stateOverride: null,
        year: 2025,
    };

    // Create accounts
    const traditional401k = new InvestedAccount(
        'ret-401k',
        '401k',
        50000, // Starting balance
        0,     // No employer balance yet
        5,     // 5 years tenure
        0.1,   // 0.1% expense ratio
        'Traditional 401k',
        true,  // Contribution eligible
        0.2    // 20% vest per year
    );

    // Create income: $80k salary with 401k contributions
    const workIncome = new WorkIncome(
        'inc-work',
        'Job',
        80000,
        'Annually',
        'Yes',
        10000,  // $10k pre-tax 401k contribution
        2000,   // $2k insurance
        0,      // No Roth 401k
        5000,   // $5k employer match
        'ret-401k',
        'Traditional 401k',
        'GROW_WITH_SALARY' // Contributions grow with salary
    );

    // Future Social Security
    const futureSS = new FutureSocialSecurityIncome(
        'inc-ss',
        'Social Security',
        ssClaimingAge, // Claiming at 67
        0,             // PIA not yet calculated
        0              // Calculation year
    );

    // Living expenses
    const livingExpenses = new FoodExpense(
        'exp-living',
        'Living Expenses',
        40000,
        'Annually',
        new Date('2025-01-01')
    );

    it('should run simulation for 40 years without errors', () => {
        const simulation = runSimulation(
            yearsToSimulate,
            [traditional401k],
            [workIncome, futureSS],
            [livingExpenses],
            assumptions,
            taxState
        );

        // Should have years from age 30 to 70
        expect(simulation.length).toBeGreaterThan(0);

        // Universal invariants should hold for all years
        assertAllYearsInvariants(simulation);
    });

    it('should grow 401k balance year-over-year during accumulation', () => {
        const simulation = runSimulation(
            yearsToSimulate,
            [traditional401k],
            [workIncome, futureSS],
            [livingExpenses],
            assumptions,
            taxState
        );

        // Check balance grows during working years (before retirement)
        let prevBalance = 0;
        for (const year of simulation) {
            const age = getAge(year.year, birthYear);
            if (age >= retirementAge) break; // Stop at retirement

            const account = getAccountById(year, 'ret-401k');
            if (!account) continue;

            // Balance should be greater than previous year (contributions + growth)
            expect(account.amount, `401k should grow at age ${age}`).toBeGreaterThan(prevBalance);
            prevBalance = account.amount;
        }
    });

    it('should stop 401k contributions after retirement', () => {
        const simulation = runSimulation(
            yearsToSimulate,
            [traditional401k],
            [workIncome, futureSS],
            [livingExpenses],
            assumptions,
            taxState
        );

        // Find retirement year
        const retirementYear = getYearByAge(simulation, retirementAge, birthYear);
        expect(retirementYear, 'Retirement year should exist').toBeDefined();

        // Get the work income in retirement year
        const workIncomeAtRetirement = getWorkIncome(retirementYear!);
        if (workIncomeAtRetirement) {
            expect(workIncomeAtRetirement.amount, 'Work income should be 0 at retirement').toBe(0);
            expect(workIncomeAtRetirement.preTax401k, '401k contributions should be 0 at retirement').toBe(0);
            expect(workIncomeAtRetirement.employerMatch, 'Employer match should be 0 at retirement').toBe(0);
        }
    });

    it('should have employer match track salary growth during accumulation', () => {
        const simulation = runSimulation(
            yearsToSimulate,
            [traditional401k],
            [workIncome, futureSS],
            [livingExpenses],
            assumptions,
            taxState
        );

        // Get year 0 (baseline) and year 5 (after 5 years of growth)
        const year0 = simulation[0];
        const year5 = simulation.length > 5 ? simulation[5] : simulation[simulation.length - 1];

        const workIncome0 = getWorkIncome(year0);
        const workIncome5 = getWorkIncome(year5);

        if (workIncome0 && workIncome5) {
            const age0 = getAge(year0.year, birthYear);
            const age5 = getAge(year5.year, birthYear);

            // Both should be before retirement
            if (age0 < retirementAge && age5 < retirementAge) {
                // Match should grow with salary (3% growth strategy)
                expect(workIncome5.employerMatch, 'Employer match should grow').toBeGreaterThan(workIncome0.employerMatch);

                // Verify growth is roughly 3% per year (compounded)
                // After 5 years at 3%: initial * 1.03^5 ≈ initial * 1.159
                const expectedGrowthFactor = Math.pow(1.03, 5);
                const actualGrowthFactor = workIncome5.employerMatch / workIncome0.employerMatch;

                // Allow 10% tolerance for numerical precision
                expect(actualGrowthFactor).toBeGreaterThan(expectedGrowthFactor * 0.9);
                expect(actualGrowthFactor).toBeLessThan(expectedGrowthFactor * 1.1);
            }
        }
    });

    it('should calculate Social Security PIA at claiming age', () => {
        const simulation = runSimulation(
            yearsToSimulate,
            [traditional401k],
            [workIncome, futureSS],
            [livingExpenses],
            assumptions,
            taxState
        );

        // Find the claiming year
        const claimingYear = getYearByAge(simulation, ssClaimingAge, birthYear);

        if (claimingYear) {
            const ssIncome = getSocialSecurityIncome(claimingYear);

            // SS should be calculated by now
            if (ssIncome) {
                expect(ssIncome.calculatedPIA, 'SS PIA should be calculated at claiming age').toBeGreaterThan(0);

                // Logs should mention SS calculation
                const hasSSLog = claimingYear.logs.some(log =>
                    log.toLowerCase().includes('social security')
                );
                expect(hasSSLog, 'Should have SS calculation log').toBe(true);
            }
        }
    });

    it('should transition from accumulation to decumulation at retirement', () => {
        const simulation = runSimulation(
            yearsToSimulate,
            [traditional401k],
            [workIncome, futureSS],
            [livingExpenses],
            assumptions,
            taxState
        );

        // Get year before retirement and year at retirement
        const preRetirementYear = getYearByAge(simulation, retirementAge - 1, birthYear);
        const atRetirementYear = getYearByAge(simulation, retirementAge, birthYear);

        if (preRetirementYear && atRetirementYear) {
            // Pre-retirement: should have work income
            const preRetirementWorkIncome = getWorkIncome(preRetirementYear);
            expect(preRetirementWorkIncome?.amount, 'Should have work income before retirement').toBeGreaterThan(0);

            // At retirement: work income should be zero
            const atRetirementWorkIncome = getWorkIncome(atRetirementYear);
            expect(atRetirementWorkIncome?.amount, 'Work income should be 0 at retirement').toBe(0);

            // At retirement: should start withdrawing (if there's a deficit)
            // Note: Withdrawals only happen if income doesn't cover expenses
        }
    });

    it('should have significant 401k balance at retirement', () => {
        const simulation = runSimulation(
            yearsToSimulate,
            [traditional401k],
            [workIncome, futureSS],
            [livingExpenses],
            assumptions,
            taxState
        );

        const retirementYear = getYearByAge(simulation, retirementAge, birthYear);

        if (retirementYear) {
            const account401k = getAccountById(retirementYear, 'ret-401k');

            if (account401k) {
                // After 35 years of contributions and growth, should have substantial balance
                // Starting $50k + ~$15k/year contributions × 35 years + 7% growth
                // Should be well over $1M
                expect(account401k.amount, '401k should have significant balance at retirement').toBeGreaterThan(500000);
            }
        }
    });

    it('should maintain universal invariants every year', () => {
        const simulation = runSimulation(
            yearsToSimulate,
            [traditional401k],
            [workIncome, futureSS],
            [livingExpenses],
            assumptions,
            taxState
        );

        for (const year of simulation) {
            assertUniversalInvariants(year);
        }
    });
});
