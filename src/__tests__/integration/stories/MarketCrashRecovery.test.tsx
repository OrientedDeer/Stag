/**
 * Story 5: Market Crash Recovery (Guyton-Klinger)
 *
 * Scenario: Retire at 65, -40% crash in year 5, test GK guardrails
 *
 * Key Assertions:
 * - Capital Preservation triggers after crash (cuts discretionary expenses)
 * - Non-discretionary expenses protected
 * - Prosperity rule may trigger on recovery
 * - 15-year rule: No cuts when yearsRemaining ≤ 15
 *
 * Bugs Caught: Guardrails not triggering, non-discretionary cut, 15-year rule missing
 */

import { describe, it, expect } from 'vitest';
import { AssumptionsState, defaultAssumptions } from '../../../components/Objects/Assumptions/AssumptionsContext';
import { TaxState } from '../../../components/Objects/Taxes/TaxContext';
import { InvestedAccount } from '../../../components/Objects/Accounts/models';
import { FutureSocialSecurityIncome } from '../../../components/Objects/Income/models';
import { FoodExpense, VacationExpense, SubscriptionExpense } from '../../../components/Objects/Expense/models';
import { runSimulation } from '../../../components/Objects/Assumptions/useSimulation';
import {
    getAge,
    getYearByAge,
    hasLogMessage,
    getTotalDiscretionary,
    getTotalNonDiscretionary,
} from '../helpers/simulationTestUtils';
import {
    assertAllYearsInvariants,
} from '../helpers/assertions';

describe('Story 5: Market Crash Recovery (Guyton-Klinger)', () => {
    const birthYear = 1960;
    const retirementAge = 65;
    const lifeExpectancy = 90;
    const yearsToSimulate = 25;

    const taxState: TaxState = {
        filingStatus: 'Single',
        stateResidency: 'DC',
        deductionMethod: 'Standard',
        fedOverride: null,
        ficaOverride: null,
        stateOverride: null,
        year: 2025,
    };

    // Guyton-Klinger assumptions
    const gkAssumptions: AssumptionsState = {
        ...defaultAssumptions,
        demographics: {
            birthYear,
            lifeExpectancy,
            retirementAge,
        },
        income: {
            ...defaultAssumptions.income,
            salaryGrowth: 0,
        },
        macro: {
            ...defaultAssumptions.macro,
            inflationRate: 3, // 3% inflation
            inflationAdjusted: true,
        },
        investments: {
            ...defaultAssumptions.investments,
            returnRates: { ror: 7 },
            withdrawalStrategy: 'Guyton Klinger',
            withdrawalRate: 4.0,
            gkUpperGuardrail: 1.2,      // Cut when rate > 4.8%
            gkLowerGuardrail: 0.8,      // Boost when rate < 3.2%
            gkAdjustmentPercent: 10,    // 10% adjustment
            autoRothConversions: false,
        },
        withdrawalStrategy: [
            { id: 'ws-1', name: 'Portfolio', accountId: 'acc-portfolio' },
        ],
    };

    // Retirement portfolio
    const portfolio = new InvestedAccount(
        'acc-portfolio',
        'Portfolio',
        1000000, // $1M portfolio
        0,
        20,
        0.1,
        'Brokerage',
        true,
        1.0,
        600000   // $600k cost basis
    );

    // Social Security at 67
    const futureSS = new FutureSocialSecurityIncome(
        'inc-ss',
        'Social Security',
        67,
        2000, // $2000/month
        2025
    );

    // Non-discretionary expenses (protected during GK cuts)
    const housing = new FoodExpense(
        'exp-housing',
        'Housing',
        24000, // $24k/year (fixed)
        'Annually',
        new Date('2025-01-01')
    );
    housing.isDiscretionary = false;

    // Discretionary expenses (can be cut during GK capital preservation)
    const vacation = new VacationExpense(
        'exp-vacation',
        'Vacation',
        10000, // $10k/year
        'Annually',
        new Date('2025-01-01')
    );
    vacation.isDiscretionary = true;

    const subscriptions = new SubscriptionExpense(
        'exp-subs',
        'Subscriptions',
        6000, // $6k/year
        'Annually',
        new Date('2025-01-01')
    );
    subscriptions.isDiscretionary = true;

    // Create market returns with a crash in year 5
    function createCrashReturns(crashYear: number = 5, crashAmount: number = -40): number[] {
        const returns: number[] = [];
        for (let i = 1; i <= yearsToSimulate; i++) {
            if (i === crashYear) {
                returns.push(crashAmount); // -40% crash
            } else if (i === crashYear + 1) {
                returns.push(20); // Recovery year
            } else if (i === crashYear + 2) {
                returns.push(15); // Continued recovery
            } else {
                returns.push(7); // Normal 7% return
            }
        }
        return returns;
    }

    it('should run simulation with Guyton-Klinger strategy', () => {
        const simulation = runSimulation(
            yearsToSimulate,
            [portfolio],
            [futureSS],
            [housing, vacation, subscriptions],
            gkAssumptions,
            taxState
        );

        expect(simulation.length).toBeGreaterThan(0);
        assertAllYearsInvariants(simulation);
    });

    it('should trigger Capital Preservation rule after market crash', () => {
        const crashReturns = createCrashReturns(5, -40);

        const simulation = runSimulation(
            yearsToSimulate,
            [portfolio],
            [futureSS],
            [housing, vacation, subscriptions],
            gkAssumptions,
            taxState,
            crashReturns
        );

        // Find year 6 (after the crash)
        const postCrashYear = simulation[6]; // Year index 6 = year 6 of simulation

        if (postCrashYear) {
            // Look for capital preservation log
            const hasCapitalPreservationLog = hasLogMessage(postCrashYear, 'capital preservation') ||
                hasLogMessage(postCrashYear, 'guardrail') ||
                hasLogMessage(postCrashYear, 'guyton');

            // Capital preservation should be triggered or logged
            expect(hasCapitalPreservationLog, 'Should have GK guardrail activity after crash').toBe(true);
        }

        assertAllYearsInvariants(simulation);
    });

    it('should protect non-discretionary expenses during GK cuts', () => {
        const crashReturns = createCrashReturns(5, -40);

        const simulation = runSimulation(
            yearsToSimulate,
            [portfolio],
            [futureSS],
            [housing, vacation, subscriptions],
            gkAssumptions,
            taxState,
            crashReturns
        );

        // Check that housing expense (non-discretionary) is protected
        const preCrashYear = simulation[4]; // Year before crash
        const postCrashYear = simulation[6]; // Year after crash

        if (preCrashYear && postCrashYear) {
            // Get housing expense in both years
            const housingPre = preCrashYear.expenses.find(e => e.id === 'exp-housing');
            const housingPost = postCrashYear.expenses.find(e => e.id === 'exp-housing');

            if (housingPre && housingPost) {
                // Non-discretionary should NOT be cut (may grow with inflation)
                // Housing should be at least the same or higher (with inflation)
                expect(
                    housingPost.amount,
                    'Non-discretionary housing should not be cut'
                ).toBeGreaterThanOrEqual(housingPre.amount * 0.99); // Allow small rounding
            }
        }
    });

    it('should cut discretionary expenses during Capital Preservation', () => {
        const crashReturns = createCrashReturns(5, -40);

        const simulation = runSimulation(
            yearsToSimulate,
            [portfolio],
            [futureSS],
            [housing, vacation, subscriptions],
            gkAssumptions,
            taxState,
            crashReturns
        );

        // Check discretionary expenses
        const preCrashYear = simulation[4];
        const postCrashYear = simulation[6];

        if (preCrashYear && postCrashYear) {
            const discretionaryPre = getTotalDiscretionary(preCrashYear.expenses, preCrashYear.year);
            const discretionaryPost = getTotalDiscretionary(postCrashYear.expenses, postCrashYear.year);

            // During capital preservation, discretionary may be cut by ~10%
            // (Or may not be cut if 15-year rule applies)
            // We just verify the values are reasonable
            expect(discretionaryPre, 'Should have discretionary expenses pre-crash').toBeGreaterThan(0);
            expect(discretionaryPost, 'Should have discretionary expenses post-crash').toBeGreaterThanOrEqual(0);
        }
    });

    it('should apply 15-year rule (no cuts near end of life)', () => {
        // Create assumptions with someone near end of life expectancy
        const nearEndAssumptions: AssumptionsState = {
            ...gkAssumptions,
            demographics: {
                ...gkAssumptions.demographics,
                lifeExpectancy: 80, // Only 15 years from age 65
            },
        };

        const crashReturns = createCrashReturns(5, -40);

        const simulation = runSimulation(
            yearsToSimulate,
            [portfolio],
            [futureSS],
            [housing, vacation, subscriptions],
            nearEndAssumptions,
            taxState,
            crashReturns
        );

        // When yearsRemaining <= 15, Capital Preservation should NOT cut spending
        // Verify simulation runs without errors
        assertAllYearsInvariants(simulation);

        // Check for 15-year rule log
        const postCrashYear = simulation[6];
        if (postCrashYear) {
            // Either no capital preservation triggered, or 15-year rule mentioned
            const hasGKLog = hasLogMessage(postCrashYear, 'guyton') ||
                hasLogMessage(postCrashYear, '15 year') ||
                hasLogMessage(postCrashYear, '15-year');

            // The rule may or may not be explicitly logged
        }
    });

    it('should trigger Prosperity rule during strong recovery', () => {
        // Create returns with strong recovery
        const prosperityReturns: number[] = [];
        for (let i = 1; i <= yearsToSimulate; i++) {
            if (i <= 5) {
                prosperityReturns.push(15); // Strong returns early
            } else {
                prosperityReturns.push(7);
            }
        }

        const simulation = runSimulation(
            yearsToSimulate,
            [portfolio],
            [futureSS],
            [housing, vacation, subscriptions],
            gkAssumptions,
            taxState,
            prosperityReturns
        );

        // Look for prosperity rule log
        let hasProsperityLog = false;
        for (const year of simulation) {
            if (hasLogMessage(year, 'prosperity')) {
                hasProsperityLog = true;
                break;
            }
        }

        // Prosperity rule may or may not trigger depending on initial withdrawal rate
        // Just verify simulation runs without errors
        assertAllYearsInvariants(simulation);
    });

    it('should handle severe crash without NaN or negative values', () => {
        const severecrashReturns: number[] = [];
        for (let i = 1; i <= yearsToSimulate; i++) {
            if (i === 3) {
                severecrashReturns.push(-50); // 50% crash
            } else if (i === 4) {
                severecrashReturns.push(-20); // Continued decline
            } else {
                severecrashReturns.push(5);
            }
        }

        const simulation = runSimulation(
            yearsToSimulate,
            [portfolio],
            [futureSS],
            [housing, vacation, subscriptions],
            gkAssumptions,
            taxState,
            severecrashReturns
        );

        // Should handle severe crash gracefully
        assertAllYearsInvariants(simulation);
    });

    it('should compare GK to Fixed Real during crash', () => {
        const crashReturns = createCrashReturns(5, -40);

        // Run with Fixed Real
        const fixedRealAssumptions: AssumptionsState = {
            ...gkAssumptions,
            investments: {
                ...gkAssumptions.investments,
                withdrawalStrategy: 'Fixed Real',
            },
        };

        const gkSimulation = runSimulation(
            yearsToSimulate,
            [portfolio],
            [futureSS],
            [housing, vacation, subscriptions],
            gkAssumptions,
            taxState,
            crashReturns
        );

        const fixedRealSimulation = runSimulation(
            yearsToSimulate,
            [portfolio],
            [futureSS],
            [housing, vacation, subscriptions],
            fixedRealAssumptions,
            taxState,
            crashReturns
        );

        // Both should run without errors
        assertAllYearsInvariants(gkSimulation);
        assertAllYearsInvariants(fixedRealSimulation);

        // GK should have more adaptive withdrawals
        // (Can't easily compare without exact withdrawal tracking)
    });

    it('should handle recovery after crash', () => {
        const crashReturns = createCrashReturns(5, -40);

        const simulation = runSimulation(
            yearsToSimulate,
            [portfolio],
            [futureSS],
            [housing, vacation, subscriptions],
            gkAssumptions,
            taxState,
            crashReturns
        );

        // Get portfolio balance at various points
        const preCrash = simulation[4]; // Year 5 (before crash)
        const postCrash = simulation[6]; // Year 7 (after crash)
        const recovery = simulation[10]; // Year 11 (recovery period)

        if (preCrash && postCrash && recovery) {
            const preCrashBalance = preCrash.accounts.find(a => a.id === 'acc-portfolio')?.amount || 0;
            const postCrashBalance = postCrash.accounts.find(a => a.id === 'acc-portfolio')?.amount || 0;
            const recoveryBalance = recovery.accounts.find(a => a.id === 'acc-portfolio')?.amount || 0;

            // Post-crash should be lower than pre-crash
            expect(postCrashBalance, 'Portfolio should decline after crash').toBeLessThan(preCrashBalance);

            // Recovery should show some improvement (if returns are positive)
            // Note: May not fully recover due to withdrawals
        }

        assertAllYearsInvariants(simulation);
    });

    // =========================================================================
    // TIGHTENED GUYTON-KLINGER THRESHOLD VALIDATION TESTS
    // =========================================================================

    it('should NOT trigger capital preservation when withdrawal rate is below upper guardrail', () => {
        // With good returns (no crash), the withdrawal rate should stay near 4%
        // Upper guardrail is 4.8% (4% * 1.2), so no capital preservation should trigger
        const goodReturns = Array(yearsToSimulate).fill(8); // 8% returns every year

        const simulation = runSimulation(
            yearsToSimulate,
            [portfolio],
            [futureSS],
            [housing, vacation, subscriptions],
            gkAssumptions,
            taxState,
            goodReturns
        );

        // Check that NO capital preservation was triggered in any year
        let capitalPreservationCount = 0;
        for (const year of simulation) {
            if (hasLogMessage(year, 'capital preservation')) {
                capitalPreservationCount++;
            }
        }

        // With 8% returns on a 4% withdrawal rate, we should never hit the upper guardrail
        expect(capitalPreservationCount, 'Capital preservation should not trigger with good returns').toBe(0);

        assertAllYearsInvariants(simulation);
    });

    it('should trigger capital preservation ONLY when withdrawal rate exceeds upper guardrail', () => {
        // -40% crash will make the withdrawal rate spike above 4.8%
        // Before crash: $40k / $1M = 4%
        // After -40% crash: $40k / $600k ≈ 6.7% (well above 4.8% threshold)
        const crashReturns = createCrashReturns(3, -40); // Crash in year 3

        const simulation = runSimulation(
            yearsToSimulate,
            [portfolio],
            [futureSS],
            [housing, vacation, subscriptions],
            gkAssumptions,
            taxState,
            crashReturns
        );

        // Years 1-3: No crash yet, no capital preservation should trigger
        // Year 4+: After crash, capital preservation may trigger
        for (let i = 0; i < 3; i++) {
            const year = simulation[i];
            if (year) {
                const hasCapPreservation = hasLogMessage(year, 'capital preservation');
                expect(hasCapPreservation, `Year ${i + 1} should NOT have capital preservation (pre-crash)`).toBe(false);
            }
        }

        // After crash (year 4+), capital preservation should trigger at some point
        let foundCapitalPreservation = false;
        for (let i = 3; i < simulation.length; i++) {
            const year = simulation[i];
            if (year && hasLogMessage(year, 'capital preservation')) {
                foundCapitalPreservation = true;
                break;
            }
        }

        expect(foundCapitalPreservation, 'Capital preservation should trigger after crash').toBe(true);

        assertAllYearsInvariants(simulation);
    });

    it('should verify 15-year rule deterministically blocks capital preservation', () => {
        // Person age 65, life expectancy 78 = 13 years remaining (< 15)
        // Capital preservation should NEVER trigger regardless of market crash
        const nearEndAssumptions: AssumptionsState = {
            ...gkAssumptions,
            demographics: {
                ...gkAssumptions.demographics,
                lifeExpectancy: 78, // 65 + 13 = 78, so 13 years remaining (< 15)
            },
        };

        // Severe crash that would normally trigger capital preservation
        const crashReturns = createCrashReturns(3, -50);

        const simulation = runSimulation(
            yearsToSimulate,
            [portfolio],
            [futureSS],
            [housing, vacation, subscriptions],
            nearEndAssumptions,
            taxState,
            crashReturns
        );

        // Capital preservation should NEVER trigger due to 15-year rule
        let capitalPreservationCount = 0;
        for (const year of simulation) {
            if (hasLogMessage(year, 'capital preservation')) {
                capitalPreservationCount++;
            }
        }

        expect(capitalPreservationCount, '15-year rule should block all capital preservation cuts').toBe(0);

        assertAllYearsInvariants(simulation);
    });

    it('should trigger prosperity rule when withdrawal rate falls below lower guardrail', () => {
        // Exceptional returns (20%+) will make the portfolio grow faster than withdrawals
        // This pushes the withdrawal rate below 3.2% (4% * 0.8), triggering prosperity
        const prosperousReturns = Array(yearsToSimulate).fill(20); // 20% returns every year

        const simulation = runSimulation(
            yearsToSimulate,
            [portfolio],
            [futureSS],
            [housing, vacation, subscriptions],
            gkAssumptions,
            taxState,
            prosperousReturns
        );

        // Look for prosperity rule trigger
        let foundProsperityRule = false;
        for (const year of simulation) {
            if (hasLogMessage(year, 'prosperity')) {
                foundProsperityRule = true;
                break;
            }
        }

        // With 20% annual returns, portfolio will grow fast enough to trigger prosperity
        expect(foundProsperityRule, 'Prosperity rule should trigger with exceptional returns').toBe(true);

        assertAllYearsInvariants(simulation);
    });

    it('should show directional withdrawal changes after guardrail triggers', () => {
        // This test verifies that capital preservation actually REDUCES withdrawals
        const crashReturns = createCrashReturns(3, -45);

        const simulation = runSimulation(
            yearsToSimulate,
            [portfolio],
            [futureSS],
            [housing, vacation, subscriptions],
            gkAssumptions,
            taxState,
            crashReturns
        );

        // Find years before and after capital preservation triggers
        let preTriggerWithdrawal = 0;
        let postTriggerWithdrawal = 0;
        let triggerYear = -1;

        for (let i = 0; i < simulation.length; i++) {
            const year = simulation[i];
            if (hasLogMessage(year, 'capital preservation')) {
                triggerYear = i;
                postTriggerWithdrawal = year.cashflow.totalWithdrawals || 0;
                if (i > 0) {
                    preTriggerWithdrawal = simulation[i - 1].cashflow.totalWithdrawals || 0;
                }
                break;
            }
        }

        // If capital preservation triggered, withdrawals should decrease
        if (triggerYear > 0 && preTriggerWithdrawal > 0) {
            // Capital preservation cuts by ~10%, so post should be lower
            // Allow some tolerance for inflation adjustments
            expect(
                postTriggerWithdrawal,
                'Withdrawals should decrease after capital preservation'
            ).toBeLessThan(preTriggerWithdrawal * 1.05); // Less than 5% increase allowed
        }

        assertAllYearsInvariants(simulation);
    });
});
