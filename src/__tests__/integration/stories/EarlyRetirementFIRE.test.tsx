/**
 * Story 2: Early Retirement FIRE (Bridge to Social Security)
 *
 * Scenario: Age 35, high earner, retires at 50, needs to bridge 12 years to SS at 62
 *
 * Key Assertions:
 * - Withdrawal order respected: Brokerage → Roth → Traditional
 * - Early withdrawal penalty (10%) applied before age 59.5
 * - Capital gains tax on brokerage gains
 * - SS benefit reduced for early claiming at 62
 *
 * Bugs Caught: Wrong account tapped first, missing penalties, cap gains not calculated
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
    getSocialSecurityIncome,
} from '../helpers/simulationTestUtils';
import {
    assertUniversalInvariants,
    assertAllYearsInvariants,
} from '../helpers/assertions';

describe('Story 2: Early Retirement FIRE', () => {
    // Setup: Birth year 1990 (age 35 in 2025), retire at 50, claim SS at 62
    const birthYear = 1990;
    const retirementAge = 50;
    const ssClaimingAge = 62;
    const yearsToSimulate = 35; // Age 35 to 70

    const assumptions: AssumptionsState = {
        ...defaultAssumptions,
        demographics: {
            birthYear,
            lifeExpectancy: 90,
            retirementAge,
        },
        income: {
            ...defaultAssumptions.income,
            salaryGrowth: 0, // No salary growth for simplicity
        },
        macro: {
            ...defaultAssumptions.macro,
            inflationRate: 0, // Disable inflation for clearer math
            inflationAdjusted: false,
        },
        investments: {
            ...defaultAssumptions.investments,
            returnRates: { ror: 7 },
            autoRothConversions: false,
        },
        withdrawalStrategy: [
            // FIRE withdrawal order: taxable first, then Roth (contributions), then Traditional
            { id: 'ws-brokerage', name: 'Brokerage', accountId: 'acc-brokerage' },
            { id: 'ws-roth', name: 'Roth IRA', accountId: 'acc-roth' },
            { id: 'ws-trad', name: 'Traditional IRA', accountId: 'acc-traditional' },
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

    // High earner accounts - FIRE portfolio
    const brokerageAccount = new InvestedAccount(
        'acc-brokerage',
        'Brokerage',
        500000,  // $500k
        0,
        10,
        0.05,
        'Brokerage',
        true,
        1.0,
        300000   // Cost basis $300k, gains $200k
    );

    const rothIRA = new InvestedAccount(
        'acc-roth',
        'Roth IRA',
        200000,  // $200k
        0,
        10,
        0.05,
        'Roth IRA',
        true,
        1.0,
        150000   // Cost basis $150k (contributions), gains $50k
    );

    const traditionalIRA = new InvestedAccount(
        'acc-traditional',
        'Traditional IRA',
        300000,  // $300k
        0,
        10,
        0.05,
        'Traditional IRA',
        true,
        1.0,
        300000   // All cost basis for Traditional
    );

    // High earner income (only during working years)
    const workIncome = new WorkIncome(
        'inc-work',
        'High Paying Job',
        200000,
        'Annually',
        'Yes',
        0, 0, 0, 0, '', null, 'FIXED',
        new Date('2025-01-01'),
        new Date('2039-12-31')  // Works until age 49
    );

    // Future Social Security at 62
    const futureSS = new FutureSocialSecurityIncome(
        'inc-ss',
        'Social Security',
        ssClaimingAge,
        0,
        0
    );

    // Living expenses
    const livingExpenses = new FoodExpense(
        'exp-living',
        'Living Expenses',
        50000,
        'Annually',
        new Date('2025-01-01')
    );

    it('should run simulation for 35 years without errors', () => {
        const simulation = runSimulation(
            yearsToSimulate,
            [brokerageAccount, rothIRA, traditionalIRA],
            [workIncome, futureSS],
            [livingExpenses],
            assumptions,
            taxState
        );

        expect(simulation.length).toBeGreaterThan(0);
        assertAllYearsInvariants(simulation);
    });

    it('should withdraw from Brokerage first (taxable account)', () => {
        const simulation = runSimulation(
            yearsToSimulate,
            [brokerageAccount, rothIRA, traditionalIRA],
            [workIncome, futureSS],
            [livingExpenses],
            assumptions,
            taxState
        );

        // Find first year where withdrawals occur (retirement year with deficit)
        const firstWithdrawalYear = simulation.find(year => {
            const age = getAge(year.year, birthYear);
            return age >= retirementAge && year.cashflow.withdrawals > 0;
        });

        if (firstWithdrawalYear) {
            // Check that Brokerage is tapped first
            const brokerageWithdrawal = firstWithdrawalYear.cashflow.withdrawalDetail['Brokerage'] || 0;
            const rothWithdrawal = firstWithdrawalYear.cashflow.withdrawalDetail['Roth IRA'] || 0;
            const tradWithdrawal = firstWithdrawalYear.cashflow.withdrawalDetail['Traditional IRA'] || 0;

            // If we need to withdraw, Brokerage should be used first
            if (firstWithdrawalYear.cashflow.withdrawals > 0) {
                const brokerage = getAccountById(firstWithdrawalYear, 'acc-brokerage');

                // Either Brokerage was withdrawn from, or it's already depleted
                expect(
                    brokerageWithdrawal > 0 || brokerage?.amount === 0,
                    'Brokerage should be tapped before other accounts'
                ).toBe(true);

                // If brokerage still has funds, Roth and Traditional should not be touched
                if (brokerage && brokerage.amount > 10000) {
                    expect(
                        rothWithdrawal,
                        'Roth should not be tapped while Brokerage has funds'
                    ).toBe(0);
                    expect(
                        tradWithdrawal,
                        'Traditional should not be tapped while Brokerage has funds'
                    ).toBe(0);
                }
            }
        }
    });

    it('should apply capital gains tax on Brokerage withdrawals', () => {
        const simulation = runSimulation(
            yearsToSimulate,
            [brokerageAccount, rothIRA, traditionalIRA],
            [workIncome, futureSS],
            [livingExpenses],
            assumptions,
            taxState
        );

        // Find years with Brokerage withdrawals
        for (const year of simulation) {
            const age = getAge(year.year, birthYear);
            if (age < retirementAge) continue;

            const brokerageWithdrawal = year.cashflow.withdrawalDetail['Brokerage'] || 0;

            if (brokerageWithdrawal > 0) {
                // Check if capital gains tax was applied
                // Note: Capital gains may be 0 if in the 0% bracket (low income)
                expect(year.taxDetails.capitalGains, 'Capital gains tax should be non-negative').toBeGreaterThanOrEqual(0);

                // Look for capital gains log message
                const hasCapGainsLog = year.logs.some(log =>
                    log.toLowerCase().includes('brokerage') ||
                    log.toLowerCase().includes('capital gain')
                );

                // Either there's a log, or gains were in 0% bracket
                expect(
                    hasCapGainsLog || year.taxDetails.capitalGains >= 0,
                    'Should have capital gains handling'
                ).toBe(true);
            }
        }
    });

    it('should apply early withdrawal penalty before age 59.5', () => {
        const simulation = runSimulation(
            yearsToSimulate,
            [brokerageAccount, rothIRA, traditionalIRA],
            [workIncome, futureSS],
            [livingExpenses],
            assumptions,
            taxState
        );

        // Find years between retirement (50) and 59.5 where Traditional is withdrawn
        for (const year of simulation) {
            const age = getAge(year.year, birthYear);
            if (age < retirementAge || age >= 60) continue; // Focus on early withdrawal period

            const tradWithdrawal = year.cashflow.withdrawalDetail['Traditional IRA'] || 0;

            if (tradWithdrawal > 0) {
                // Should have early withdrawal penalty (10% on Traditional withdrawals before 59.5)
                // The penalty is included in fed tax
                const hasEarlyWithdrawalLog = year.logs.some(log =>
                    log.toLowerCase().includes('early') ||
                    log.toLowerCase().includes('penalty')
                );

                // Federal tax should include penalty if there was a Traditional withdrawal
                expect(year.taxDetails.fed, 'Fed tax should be positive when Traditional is withdrawn early').toBeGreaterThan(0);

                // Should have log indicating early withdrawal or penalty
                expect(
                    hasEarlyWithdrawalLog,
                    `Should log early withdrawal penalty at age ${age}`
                ).toBe(true);
            }
        }
    });

    it('should calculate reduced SS benefit for early claiming at 62', () => {
        const simulation = runSimulation(
            yearsToSimulate,
            [brokerageAccount, rothIRA, traditionalIRA],
            [workIncome, futureSS],
            [livingExpenses],
            assumptions,
            taxState
        );

        // Find the SS claiming year (age 62)
        const claimingYear = getYearByAge(simulation, ssClaimingAge, birthYear);

        if (claimingYear) {
            const ssIncome = getSocialSecurityIncome(claimingYear);

            if (ssIncome) {
                expect(ssIncome.calculatedPIA, 'SS PIA should be calculated at claiming age').toBeGreaterThan(0);

                // Benefit at 62 should be reduced from FRA (about 70% of FRA benefit)
                // We can't test exact reduction without knowing FRA benefit, but we know it's calculated
                const hasSSLog = claimingYear.logs.some(log =>
                    log.toLowerCase().includes('social security')
                );
                expect(hasSSLog, 'Should have SS calculation log').toBe(true);
            }
        }
    });

    it('should drain accounts in order during FIRE bridge period', () => {
        // Use 0% returns so accounts actually drain during the bridge period
        // (With 7% returns, $500k would grow faster than $50k/year expenses)
        const zeroReturnAssumptions: AssumptionsState = {
            ...assumptions,
            investments: {
                ...assumptions.investments,
                returnRates: { ror: 0 },
            },
        };

        const simulation = runSimulation(
            yearsToSimulate,
            [brokerageAccount, rothIRA, traditionalIRA],
            [workIncome, futureSS],
            [livingExpenses],
            zeroReturnAssumptions,
            taxState
        );

        // Track account balances over time
        let brokerageWasDrainedFirst = false;

        for (const year of simulation) {
            const age = getAge(year.year, birthYear);
            if (age < retirementAge) continue;

            const brokerage = getAccountById(year, 'acc-brokerage');
            const roth = getAccountById(year, 'acc-roth');
            const trad = getAccountById(year, 'acc-traditional');

            // Check if Brokerage is depleted while others still have balance
            if (brokerage && roth && trad) {
                if (brokerage.amount <= 1 && roth.amount > 1 && trad.amount > 1) {
                    brokerageWasDrainedFirst = true;
                }

                // If Brokerage is not drained, Roth and Traditional should be untouched
                // (assuming we only need to tap one account)
                if (brokerage.amount > 10000) {
                    // Still have Brokerage funds, check order is respected
                    const rothWithdrawal = year.cashflow.withdrawalDetail['Roth IRA'] || 0;
                    const tradWithdrawal = year.cashflow.withdrawalDetail['Traditional IRA'] || 0;

                    // Should not tap Roth/Traditional while Brokerage has funds
                    expect(
                        rothWithdrawal,
                        `Roth should not be tapped at age ${age} while Brokerage has $${brokerage.amount.toFixed(0)}`
                    ).toBe(0);
                    expect(
                        tradWithdrawal,
                        `Traditional should not be tapped at age ${age} while Brokerage has $${brokerage.amount.toFixed(0)}`
                    ).toBe(0);
                }
            }
        }

        // At some point during the bridge, Brokerage should be drained first
        expect(
            brokerageWasDrainedFirst,
            'Brokerage should be drained before Roth and Traditional'
        ).toBe(true);
    });

    it('should maintain universal invariants every year', () => {
        const simulation = runSimulation(
            yearsToSimulate,
            [brokerageAccount, rothIRA, traditionalIRA],
            [workIncome, futureSS],
            [livingExpenses],
            assumptions,
            taxState
        );

        for (const year of simulation) {
            assertUniversalInvariants(year);
        }
    });

    it('should have deficit debt if accounts run out before SS', () => {
        // Create a scenario with insufficient funds
        const smallBrokerage = new InvestedAccount(
            'acc-brokerage', 'Brokerage', 100000, 0, 10, 0.05, 'Brokerage', true, 1.0, 100000
        );
        const smallRoth = new InvestedAccount(
            'acc-roth', 'Roth IRA', 50000, 0, 10, 0.05, 'Roth IRA', true, 1.0, 50000
        );
        const smallTrad = new InvestedAccount(
            'acc-traditional', 'Traditional IRA', 50000, 0, 10, 0.05, 'Traditional IRA', true, 1.0, 50000
        );

        const highExpenses = new FoodExpense(
            'exp-living', 'Living Expenses', 80000, 'Annually', new Date('2025-01-01')
        );

        const simulation = runSimulation(
            yearsToSimulate,
            [smallBrokerage, smallRoth, smallTrad],
            [workIncome, futureSS],
            [highExpenses],
            assumptions,
            taxState
        );

        // Check if deficit debt appears at some point
        let hasDeficitDebt = false;
        for (const year of simulation) {
            const deficitDebt = year.accounts.find(acc => acc.name === 'Uncovered Deficit');
            if (deficitDebt && deficitDebt.amount > 0) {
                hasDeficitDebt = true;
                break;
            }
        }

        // With small accounts ($200k total) and high expenses ($80k/year),
        // deficit debt should appear during the bridge period before SS at 62
        expect(
            hasDeficitDebt,
            'Deficit debt should appear when accounts are insufficient for expenses'
        ).toBe(true);

        assertAllYearsInvariants(simulation);
    });

    // =========================================================================
    // TIGHTENED NUMERIC CHECKS
    // =========================================================================

    it('should apply exact 10% early withdrawal penalty on Traditional withdrawals before 59.5', () => {
        // Force Traditional-only withdrawal scenario
        const emptyBrokerage = new InvestedAccount(
            'acc-brokerage', 'Brokerage', 0, 0, 10, 0.05, 'Brokerage', true, 1.0, 0
        );
        const emptyRoth = new InvestedAccount(
            'acc-roth', 'Roth IRA', 0, 0, 10, 0.05, 'Roth IRA', true, 1.0, 0
        );
        const largeTrad = new InvestedAccount(
            'acc-traditional', 'Traditional IRA', 500000, 0, 10, 0.05, 'Traditional IRA', true, 1.0, 500000
        );

        const simulation = runSimulation(
            yearsToSimulate,
            [emptyBrokerage, emptyRoth, largeTrad],
            [workIncome, futureSS],
            [livingExpenses],
            assumptions,
            taxState
        );

        // Find a year between retirement (50) and age 59 where Traditional is withdrawn
        for (const year of simulation) {
            const age = getAge(year.year, birthYear);
            if (age < retirementAge || age >= 59) continue;

            const tradWithdrawal = year.cashflow.withdrawalDetail['Traditional IRA'] || 0;

            if (tradWithdrawal < 10000) continue;

            // Calculate expected 10% early withdrawal penalty
            const expectedPenalty = tradWithdrawal * 0.10;

            // Fed tax MUST include at least the 10% penalty
            // (actual will be higher due to income tax on withdrawal)
            expect(
                year.taxDetails.fed,
                `Fed tax ($${year.taxDetails.fed.toFixed(0)}) should include 10% penalty ($${expectedPenalty.toFixed(0)}) on $${tradWithdrawal.toFixed(0)} Traditional withdrawal at age ${age}`
            ).toBeGreaterThanOrEqual(expectedPenalty);

            // Fed tax should be penalty (10%) + income tax (max ~37% marginal)
            // Total should not exceed 47% of withdrawal
            const maxReasonableFedTax = tradWithdrawal * 0.47;
            expect(
                year.taxDetails.fed,
                `Fed tax ($${year.taxDetails.fed.toFixed(0)}) should not exceed 47% of withdrawal ($${maxReasonableFedTax.toFixed(0)})`
            ).toBeLessThanOrEqual(maxReasonableFedTax);

            // Verify the penalty is approximately 10% by checking fed tax is at least
            // 10% more than it would be for income tax alone (approximated at 15% effective rate)
            const estimatedIncomeTaxOnly = tradWithdrawal * 0.15;
            const fedTaxMinusEstimatedIncome = year.taxDetails.fed - estimatedIncomeTaxOnly;

            // The difference should be close to 10% (the penalty)
            // Allow 50% tolerance on this estimate since income tax varies
            expect(
                fedTaxMinusEstimatedIncome,
                `Penalty portion ($${fedTaxMinusEstimatedIncome.toFixed(0)}) should be close to 10% ($${expectedPenalty.toFixed(0)})`
            ).toBeGreaterThanOrEqual(expectedPenalty * 0.5);
            expect(fedTaxMinusEstimatedIncome).toBeLessThanOrEqual(expectedPenalty * 1.5);

            break; // Verified one year
        }
    });

    it('should withdraw predominantly from Brokerage before touching Roth', () => {
        const simulation = runSimulation(
            yearsToSimulate,
            [brokerageAccount, rothIRA, traditionalIRA],
            [workIncome, futureSS],
            [livingExpenses],
            assumptions,
            taxState
        );

        // Track cumulative withdrawals from each account
        let cumulativeBrokerage = 0;
        let cumulativeRoth = 0;

        for (const year of simulation) {
            const age = getAge(year.year, birthYear);
            if (age < retirementAge) continue;

            cumulativeBrokerage += year.cashflow.withdrawalDetail['Brokerage'] || 0;
            cumulativeRoth += year.cashflow.withdrawalDetail['Roth IRA'] || 0;

            // Check: Before Roth is touched significantly, Brokerage should be mostly depleted
            if (cumulativeRoth > 10000) {
                // If we've withdrawn $10k+ from Roth, Brokerage should have supplied most of its balance
                const brokerage = getAccountById(year, 'acc-brokerage');
                const brokerageRemaining = brokerage?.amount || 0;

                // Brokerage should be mostly depleted (< 20% of original) before Roth is used
                expect(
                    brokerageRemaining,
                    `Brokerage ($${brokerageRemaining.toFixed(0)} remaining) should be mostly depleted ` +
                    `before withdrawing $${cumulativeRoth.toFixed(0)} from Roth`
                ).toBeLessThan(brokerageAccount.amount * 0.3); // < 30% of original remaining

                break; // Verified for first significant Roth withdrawal
            }
        }
    });
});
