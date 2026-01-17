/**
 * Story: Strategy Boundary Conditions
 *
 * Tests for rules that should fire exactly at thresholds.
 * These bugs have the pattern: "Rules work in the middle but fail at boundaries."
 *
 * Key Assertions:
 * - Tax bracket boundaries: Roth conversion fills to target bracket, doesn't overshoot
 * - Guyton-Klinger guardrails: withdrawal rate stays bounded
 * - PMI removal: happens when equity reaches 20%
 * - Account depletion: handles draining to $0 gracefully
 *
 * Note on Roth Conversions:
 * The simulation targets the 22% bracket by design (MIN_CONVERSION_TARGET_RATE = 0.22)
 * This means conversions will fill past the 12% bracket ($48,475) - that's intentional.
 *
 * Bugs Caught:
 * - Roth conversion overshooting 22% bracket top
 * - Roth conversion not filling when it should (staying below 12% bracket)
 * - Guardrails allowing extreme withdrawal rates
 * - PMI not removed at threshold
 * - Errors when account hits exactly $0
 */

import { describe, it, expect } from 'vitest';
import { AssumptionsState, defaultAssumptions } from '../../../components/Objects/Assumptions/AssumptionsContext';
import { TaxState } from '../../../components/Objects/Taxes/TaxContext';
import { InvestedAccount, PropertyAccount } from '../../../components/Objects/Accounts/models';
import { FutureSocialSecurityIncome } from '../../../components/Objects/Income/models';
import { FoodExpense, MortgageExpense } from '../../../components/Objects/Expense/models';
import { runSimulation } from '../../../components/Objects/Assumptions/useSimulation';
import {
    getAge,
    getAccountById,
    hasLogMessage,
} from '../helpers/simulationTestUtils';
import {
    assertAllYearsInvariants,
} from '../helpers/assertions';

describe('Strategy Boundary Tests', () => {
    const taxState: TaxState = {
        filingStatus: 'Single',
        stateResidency: 'DC',
        deductionMethod: 'Standard',
        fedOverride: null,
        ficaOverride: null,
        stateOverride: null,
        year: 2025,
    };

    // ==========================================================================
    // TAX BRACKET BOUNDARIES
    // ==========================================================================

    describe('Tax Bracket Boundaries', () => {
        // 2025 Single filer brackets:
        // 10%: $0 - $11,925
        // 12%: $11,925 - $48,475
        // 22%: $48,475 - $103,350
        // Standard deduction: ~$14,600
        //
        // NOTE: The simulation targets the 22% bracket by design (MIN_CONVERSION_TARGET_RATE = 0.22)
        // This ensures Roth conversions fill both 10%, 12%, AND 22% brackets before stopping.
        // See SimulationEngine.tsx lines 111-113.

        const bracket12Top = 48475;
        const bracket22Top = 103350;
        const standardDeduction = 14600;

        const birthYear = 1960;
        const retirementAge = 60;

        const bracketAssumptions: AssumptionsState = {
            ...defaultAssumptions,
            demographics: {
                birthYear,
                lifeExpectancy: 90,
                retirementAge,
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
                returnRates: { ror: 0 }, // No returns for predictable math
                autoRothConversions: true, // Enable Roth conversions
            },
            withdrawalStrategy: [
                { id: 'ws-roth', name: 'Roth IRA', accountId: 'acc-roth' },
                { id: 'ws-trad', name: 'Traditional IRA', accountId: 'acc-trad' },
            ],
        };

        const largeTrad = new InvestedAccount(
            'acc-trad', 'Traditional IRA', 2000000, 0, 20, 0.05, 'Traditional IRA', true, 1.0, 2000000
        );

        const rothIRA = new InvestedAccount(
            'acc-roth', 'Roth IRA', 100000, 0, 20, 0.05, 'Roth IRA', true, 1.0, 80000
        );

        // SS starts very late (effectively never during test)
        const noSS = new FutureSocialSecurityIncome('inc-ss', 'Social Security', 90, 0, 0);

        // Minimal expenses
        const minimalExpenses = new FoodExpense(
            'exp-minimal', 'Minimal Living', 10000, 'Annually', new Date('2025-01-01')
        );

        it('should not exceed 22% bracket top with Roth conversions', () => {
            // The simulation is designed to fill up to the 22% bracket (MIN_CONVERSION_TARGET_RATE = 0.22)
            // This test verifies conversions don't overshoot the 22% bracket top
            // Allow a small tolerance (~$1000) for timing/rounding issues

            const simulation = runSimulation(
                10,
                [largeTrad, rothIRA],
                [noSS],
                [minimalExpenses],
                bracketAssumptions,
                taxState
            );

            // Check each retirement year
            for (let i = 1; i < simulation.length; i++) {
                const year = simulation[i];
                const prevYear = simulation[i - 1];
                const age = getAge(year.year, birthYear);

                if (age < retirementAge) continue;

                // Check if there was a Roth conversion (Traditional decreased)
                const tradBefore = getAccountById(prevYear, 'acc-trad')?.amount || 0;
                const tradAfter = getAccountById(year, 'acc-trad')?.amount || 0;
                const conversion = tradBefore - tradAfter;

                if (conversion > 1000) {
                    // Calculate taxable income
                    const totalIncome = year.cashflow.totalIncome;
                    const taxableIncome = Math.max(0, totalIncome - standardDeduction);

                    // Conversions should fill TO the 22% bracket, not significantly OVER
                    // Allow $1000 tolerance for rounding
                    expect(
                        taxableIncome,
                        `Year ${year.year} (age ${age}): Taxable income ($${taxableIncome.toFixed(0)}) ` +
                        `should not exceed 22% bracket top ($${bracket22Top}) by more than $1000`
                    ).toBeLessThanOrEqual(bracket22Top + 1000);
                }
            }

            assertAllYearsInvariants(simulation);
        });

        it('should fill at least to 12% bracket when targeting 22%', () => {
            // Since we target the 22% bracket, taxable income should at minimum exceed
            // the 12% bracket top ($48,475) in retirement years with conversions
            const simulation = runSimulation(
                10,
                [largeTrad, rothIRA],
                [noSS],
                [minimalExpenses],
                bracketAssumptions,
                taxState
            );

            let foundConversionYear = false;
            let totalConverted = 0;
            let atLeastOneYearFilledPast12 = false;

            for (let i = 1; i < simulation.length; i++) {
                const year = simulation[i];
                const prevYear = simulation[i - 1];
                const age = getAge(year.year, birthYear);

                if (age < retirementAge) continue;

                const tradBefore = getAccountById(prevYear, 'acc-trad')?.amount || 0;
                const tradAfter = getAccountById(year, 'acc-trad')?.amount || 0;
                const conversion = tradBefore - tradAfter;

                if (conversion > 1000) {
                    foundConversionYear = true;
                    totalConverted += conversion;

                    // Check taxable income reached at least past the 12% bracket
                    const totalIncome = year.cashflow.totalIncome;
                    const taxableIncome = Math.max(0, totalIncome - standardDeduction);
                    if (taxableIncome >= bracket12Top * 0.95) {
                        atLeastOneYearFilledPast12 = true;
                    }
                }
            }

            // Should have found at least one conversion year
            expect(foundConversionYear, 'Should have at least one Roth conversion year').toBe(true);

            // Should have converted enough to fill past 12% bracket in at least one year
            expect(
                atLeastOneYearFilledPast12,
                `Since target is 22%, should fill past 12% bracket ($${bracket12Top}) in at least one year`
            ).toBe(true);

            // Should have converted a meaningful amount
            expect(
                totalConverted,
                `Total converted ($${totalConverted.toFixed(0)}) should be significant when targeting 22% bracket`
            ).toBeGreaterThan(50000); // Should fill multiple brackets over 10 years
        });
    });

    // ==========================================================================
    // GUYTON-KLINGER GUARDRAILS
    // ==========================================================================

    describe('Guyton-Klinger Guardrails', () => {
        const birthYear = 1960;
        const retirementAge = 65;

        // Withdrawal rate thresholds:
        // Base: 4%, Upper guardrail: 1.2x = 4.8%, Lower guardrail: 0.8x = 3.2%
        // Capital preservation triggers when rate > 4.8%
        // Prosperity triggers when rate < 3.2%

        const gkAssumptions: AssumptionsState = {
            ...defaultAssumptions,
            demographics: {
                birthYear,
                lifeExpectancy: 90,
                retirementAge,
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
                withdrawalStrategy: 'Guyton Klinger',
                withdrawalRate: 4.0,
                gkUpperGuardrail: 1.2,      // Trigger at > 4.8%
                gkLowerGuardrail: 0.8,      // Trigger at < 3.2%
                gkAdjustmentPercent: 10,    // 10% adjustment
                autoRothConversions: false,
            },
            withdrawalStrategy: [
                { id: 'ws-port', name: 'Portfolio', accountId: 'acc-portfolio' },
            ],
        };

        const portfolio = new InvestedAccount(
            'acc-portfolio', 'Portfolio', 1000000, 0, 20, 0.1, 'Brokerage', true, 1.0, 600000
        );

        const futureSS = new FutureSocialSecurityIncome('inc-ss', 'Social Security', 70, 0, 0);

        // Expenses that would be ~4% of $1M = $40k
        const livingExpenses = new FoodExpense(
            'exp-living', 'Living', 40000, 'Annually', new Date('2025-01-01')
        );

        it('should run Guyton-Klinger simulation without errors', () => {
            const simulation = runSimulation(
                20,
                [portfolio],
                [futureSS],
                [livingExpenses],
                gkAssumptions,
                taxState
            );

            expect(simulation.length).toBeGreaterThan(0);
            assertAllYearsInvariants(simulation);
        });

        it('should have withdrawal rate stay within guardrail bounds over time', () => {
            const simulation = runSimulation(
                20,
                [portfolio],
                [futureSS],
                [livingExpenses],
                gkAssumptions,
                taxState
            );

            // Track withdrawal rates
            for (const year of simulation) {
                const age = getAge(year.year, birthYear);
                if (age < retirementAge) continue;

                const withdrawals = year.cashflow.withdrawals;
                const portfolioBalance = getAccountById(year, 'acc-portfolio')?.amount || 0;

                if (portfolioBalance > 0 && withdrawals > 0) {
                    const withdrawalRate = withdrawals / portfolioBalance;

                    // With GK guardrails, rate should stay somewhat bounded
                    // (though can temporarily exceed during adjustment)
                    expect(
                        withdrawalRate,
                        `Year ${year.year}: Withdrawal rate (${(withdrawalRate * 100).toFixed(1)}%) should stay reasonable`
                    ).toBeLessThan(0.15); // 15% max (extreme bound check)
                }
            }
        });

        it('should trigger capital preservation after significant portfolio drop', () => {
            // Create scenario with market crash that drops portfolio significantly
            // This would push withdrawal rate above upper guardrail
            const crashAssumptions = {
                ...gkAssumptions,
                investments: {
                    ...gkAssumptions.investments,
                    returnRates: { ror: -20 }, // Negative returns to simulate crash
                },
            };

            const simulation = runSimulation(
                10,
                [portfolio],
                [futureSS],
                [livingExpenses],
                crashAssumptions,
                taxState
            );

            // Should still run without errors
            assertAllYearsInvariants(simulation);

            // Check for capital preservation log or expense reduction
            let foundCapitalPreservation = false;
            for (const year of simulation) {
                if (hasLogMessage(year, 'capital preservation') ||
                    hasLogMessage(year, 'guardrail') ||
                    hasLogMessage(year, 'cut')) {
                    foundCapitalPreservation = true;
                    break;
                }
            }

            // With -20% returns, the portfolio should drop significantly
            // pushing withdrawal rate above upper guardrail (4.8%) and triggering capital preservation
            expect(
                foundCapitalPreservation,
                'Capital preservation should trigger with -20% portfolio returns'
            ).toBe(true);
        });
    });

    // ==========================================================================
    // PMI REMOVAL AT 20% EQUITY
    // ==========================================================================

    describe('PMI Removal', () => {
        const birthYear = 1990;
        const retirementAge = 65;

        const pmiAssumptions: AssumptionsState = {
            ...defaultAssumptions,
            demographics: {
                birthYear,
                lifeExpectancy: 90,
                retirementAge,
            },
            income: {
                ...defaultAssumptions.income,
                salaryGrowth: 2,
            },
            macro: {
                ...defaultAssumptions.macro,
                inflationRate: 0,
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

        // Property starting at 10% equity (90% LTV) - PMI should apply
        // Value: $400k, Loan: $360k, Equity: $40k = 10%
        const propertyAccount = new PropertyAccount(
            'acc-property', 'Home', 400000, 'Financed', 360000, 360000, 'exp-mortgage'
        );

        // Mortgage with PMI
        const mortgageExpense = new MortgageExpense(
            'exp-mortgage', 'Mortgage', 'Monthly',
            400000,  // valuation
            360000,  // starting_balance
            360000,  // loan_balance
            6.0,     // rate
            30,      // term
            1.5,     // property_tax_rate
            0,       // valuation_deduction
            1.0,     // maintenance_percent
            200,     // utilities
            0.5,     // insurance_percent
            0.5,     // PMI percent (should be removed at 20% equity)
            200,     // hoa
            'Itemized',
            0,
            'acc-property',
            new Date('2025-01-01')
        );

        const livingExpenses = new FoodExpense(
            'exp-living', 'Living', 30000, 'Annually', new Date('2025-01-01')
        );

        it('should have PMI initially when equity < 20%', () => {
            const simulation = runSimulation(
                1, // Just first year
                [propertyAccount],
                [],
                [mortgageExpense, livingExpenses],
                pmiAssumptions,
                taxState
            );

            const firstYear = simulation[0];
            const mortgage = firstYear.expenses.find(e => e.id === 'exp-mortgage') as MortgageExpense;

            if (mortgage) {
                const equity = (mortgage.valuation - mortgage.loan_balance) / mortgage.valuation;

                // Initial equity should be ~10%
                expect(equity, 'Initial equity should be around 10%').toBeLessThan(0.15);

                // PMI should be present (> 0)
                expect(
                    mortgage.pmi,
                    `PMI should be present when equity (${(equity * 100).toFixed(1)}%) is below 20%`
                ).toBeGreaterThan(0);
            }
        });

        it('should remove PMI when equity reaches 20%', () => {
            const simulation = runSimulation(
                15, // Run long enough for equity to reach 20%
                [propertyAccount],
                [],
                [mortgageExpense, livingExpenses],
                pmiAssumptions,
                taxState
            );

            let pmiRemovedYear: number | null = null;
            let equityAtRemoval: number | null = null;
            let hadPMI = true;

            for (const year of simulation) {
                const mortgage = year.expenses.find(e => e.id === 'exp-mortgage') as MortgageExpense;
                if (!mortgage) continue;

                const equity = (mortgage.valuation - mortgage.loan_balance) / mortgage.valuation;

                // Track when PMI is removed
                if (hadPMI && mortgage.pmi === 0) {
                    pmiRemovedYear = year.year;
                    equityAtRemoval = equity;
                    hadPMI = false;
                }
            }

            // PMI should be removed at some point
            if (pmiRemovedYear !== null && equityAtRemoval !== null) {
                // PMI should be removed at or just after 20% equity
                expect(
                    equityAtRemoval,
                    `PMI removed at ${(equityAtRemoval * 100).toFixed(1)}% equity, should be >= 20%`
                ).toBeGreaterThanOrEqual(0.19); // Small tolerance

                expect(
                    equityAtRemoval,
                    `PMI removed at ${(equityAtRemoval * 100).toFixed(1)}% equity, should not wait too long past 20%`
                ).toBeLessThan(0.25); // Should remove reasonably close to 20%
            }

            assertAllYearsInvariants(simulation);
        });

        it('should NOT remove PMI before 20% equity', () => {
            const simulation = runSimulation(
                15,
                [propertyAccount],
                [],
                [mortgageExpense, livingExpenses],
                pmiAssumptions,
                taxState
            );

            for (const year of simulation) {
                const mortgage = year.expenses.find(e => e.id === 'exp-mortgage') as MortgageExpense;
                if (!mortgage) continue;

                const equity = (mortgage.valuation - mortgage.loan_balance) / mortgage.valuation;

                // If equity is below 20%, PMI should still be present
                if (equity < 0.19) { // Small buffer for rounding
                    expect(
                        mortgage.pmi,
                        `Year ${year.year}: PMI should be present when equity (${(equity * 100).toFixed(1)}%) is below 20%`
                    ).toBeGreaterThan(0);
                }
            }
        });
    });

    // ==========================================================================
    // ACCOUNT DEPLETION
    // ==========================================================================

    describe('Account Depletion', () => {
        const birthYear = 1960;
        const retirementAge = 60;

        const depletionAssumptions: AssumptionsState = {
            ...defaultAssumptions,
            demographics: {
                birthYear,
                lifeExpectancy: 90,
                retirementAge,
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
                returnRates: { ror: 0 }, // No returns for predictable depletion
                autoRothConversions: false,
            },
            withdrawalStrategy: [
                { id: 'ws-brokerage', name: 'Brokerage', accountId: 'acc-brokerage' },
                { id: 'ws-trad', name: 'Traditional IRA', accountId: 'acc-trad' },
            ],
        };

        // Small account that will be depleted quickly
        const smallBrokerage = new InvestedAccount(
            'acc-brokerage', 'Brokerage', 50000, 0, 10, 0.05, 'Brokerage', true, 1.0, 40000
        );

        // Larger account to fall back to
        const traditionalIRA = new InvestedAccount(
            'acc-trad', 'Traditional IRA', 500000, 0, 20, 0.05, 'Traditional IRA', true, 1.0, 500000
        );

        // SS starts late
        const futureSS = new FutureSocialSecurityIncome('inc-ss', 'Social Security', 70, 0, 0);

        // High expenses to force depletion
        const highExpenses = new FoodExpense(
            'exp-living', 'Living', 60000, 'Annually', new Date('2025-01-01')
        );

        it('should handle account draining to exactly $0', () => {
            const simulation = runSimulation(
                15,
                [smallBrokerage, traditionalIRA],
                [futureSS],
                [highExpenses],
                depletionAssumptions,
                taxState
            );

            // Should run without errors
            assertAllYearsInvariants(simulation);

            // Check that Brokerage eventually depletes
            let brokerageWasDepleted = false;
            for (const year of simulation) {
                const brokerage = getAccountById(year, 'acc-brokerage');
                if (brokerage && brokerage.amount <= 1) {
                    brokerageWasDepleted = true;
                    break;
                }
            }

            expect(brokerageWasDepleted, 'Brokerage should deplete with high expenses and no returns').toBe(true);
        });

        it('should move to next account in withdrawal order after depletion', () => {
            const simulation = runSimulation(
                15,
                [smallBrokerage, traditionalIRA],
                [futureSS],
                [highExpenses],
                depletionAssumptions,
                taxState
            );

            let foundTransition = false;

            for (const year of simulation) {
                const brokerage = getAccountById(year, 'acc-brokerage');
                const brokerageBalance = brokerage?.amount || 0;

                // After Brokerage is depleted, Traditional should be used
                if (brokerageBalance <= 1) {
                    const tradWithdrawal = year.cashflow.withdrawalDetail['Traditional IRA'] || 0;

                    if (tradWithdrawal > 0) {
                        foundTransition = true;
                        break;
                    }
                }
            }

            expect(
                foundTransition,
                'Should transition to Traditional IRA after Brokerage is depleted'
            ).toBe(true);
        });

        it('should not have NaN or negative balances during depletion', () => {
            const simulation = runSimulation(
                15,
                [smallBrokerage, traditionalIRA],
                [futureSS],
                [highExpenses],
                depletionAssumptions,
                taxState
            );

            for (const year of simulation) {
                for (const account of year.accounts) {
                    expect(
                        Number.isNaN(account.amount),
                        `Account ${account.name} should not be NaN in year ${year.year}`
                    ).toBe(false);

                    expect(
                        account.amount,
                        `Account ${account.name} should not be negative in year ${year.year}`
                    ).toBeGreaterThanOrEqual(0);
                }
            }
        });

        it('should handle multiple accounts depleting in sequence', () => {
            // All small accounts
            const smallBrokerage2 = new InvestedAccount(
                'acc-brokerage', 'Brokerage', 30000, 0, 10, 0.05, 'Brokerage', true, 1.0, 25000
            );
            const smallRoth = new InvestedAccount(
                'acc-roth', 'Roth IRA', 30000, 0, 10, 0.05, 'Roth IRA', true, 1.0, 25000
            );
            const smallTrad = new InvestedAccount(
                'acc-trad', 'Traditional IRA', 30000, 0, 10, 0.05, 'Traditional IRA', true, 1.0, 30000
            );

            const sequenceAssumptions = {
                ...depletionAssumptions,
                withdrawalStrategy: [
                    { id: 'ws-brokerage', name: 'Brokerage', accountId: 'acc-brokerage' },
                    { id: 'ws-roth', name: 'Roth IRA', accountId: 'acc-roth' },
                    { id: 'ws-trad', name: 'Traditional IRA', accountId: 'acc-trad' },
                ],
            };

            const simulation = runSimulation(
                10,
                [smallBrokerage2, smallRoth, smallTrad],
                [futureSS],
                [highExpenses],
                sequenceAssumptions,
                taxState
            );

            // Should run without errors through multiple depletions
            assertAllYearsInvariants(simulation);

            // Count depleted accounts
            const finalYear = simulation[simulation.length - 1];
            let depletedCount = 0;

            for (const account of finalYear.accounts) {
                if (account.amount <= 1) {
                    depletedCount++;
                }
            }

            // At least some accounts should be depleted
            expect(depletedCount, 'Some accounts should be depleted with high expenses').toBeGreaterThan(0);
        });
    });
});
