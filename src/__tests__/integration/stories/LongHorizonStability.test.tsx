/**
 * Long-Horizon Stability Tests
 *
 * Minimal-assertion tests that run 40-50 years to ensure stability
 * over time and catch slow compounding or state-drift bugs.
 *
 * These tests focus on:
 * - No NaN or Infinity values over long periods
 * - No negative balances (except allowed deficit debt)
 * - No value explosion
 * - Reasonable tax rates
 * - Stable cashflow algebra
 */

import { describe, it, expect } from 'vitest';
import { AssumptionsState, defaultAssumptions } from '../../../components/Objects/Assumptions/AssumptionsContext';
import { TaxState } from '../../../components/Objects/Taxes/TaxContext';
import { InvestedAccount, PropertyAccount, DebtAccount, SavedAccount } from '../../../components/Objects/Accounts/models';
import { WorkIncome, FutureSocialSecurityIncome } from '../../../components/Objects/Income/models';
import { FoodExpense, MortgageExpense, LoanExpense } from '../../../components/Objects/Expense/models';
import { runSimulation } from '../../../components/Objects/Assumptions/useSimulation';
import { calculateNetWorth, getAccountById } from '../helpers/simulationTestUtils';
import {
    assertLongHorizonStability,
    assertNoValueExplosion,
    assertAllYearsInvariants,
    assertLifetimeCashFlowReconciliation,
} from '../helpers/assertions';

describe('Long-Horizon Stability: 50-Year Lifecycle', () => {
    const birthYear = 1980;
    const retirementAge = 65;
    const yearsToSimulate = 50; // Age 45 to 95

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
            lifeExpectancy: 95,
            retirementAge,
        },
        income: {
            ...defaultAssumptions.income,
            salaryGrowth: 2.0,
        },
        macro: {
            ...defaultAssumptions.macro,
            inflationRate: 2.5,
            inflationAdjusted: true,
        },
        investments: {
            ...defaultAssumptions.investments,
            returnRates: { ror: 7 },
            withdrawalStrategy: 'Fixed Real',
            withdrawalRate: 4.0,
            autoRothConversions: false,
        },
        withdrawalStrategy: [
            { id: 'ws-brokerage', name: 'Brokerage', accountId: 'acc-brokerage' },
            { id: 'ws-401k', name: '401k', accountId: 'acc-401k' },
        ],
    };

    // Realistic mid-career portfolio
    const brokerage = new InvestedAccount(
        'acc-brokerage', 'Brokerage', 200000, 0, 15, 0.05, 'Brokerage', true, 1.0, 150000
    );
    const traditional401k = new InvestedAccount(
        'acc-401k', '401k', 300000, 20000, 15, 0.1, 'Traditional 401k', true, 0.2, 250000
    );

    const workIncome = new WorkIncome(
        'inc-work', 'Job', 100000, 'Annually', 'Yes',
        15000, 3000, 0, 7500, 'acc-401k', 'Traditional 401k', 'GROW_WITH_SALARY',
        new Date('2010-01-01'),
        new Date(`${birthYear + retirementAge - 1}-12-31`)
    );

    const futureSS = new FutureSocialSecurityIncome('inc-ss', 'Social Security', 67, 0, 0);

    const livingExpenses = new FoodExpense(
        'exp-living', 'Living Expenses', 50000, 'Annually', new Date('2025-01-01')
    );

    it('should run 50 years without NaN, Infinity, or negative balances', () => {
        const simulation = runSimulation(
            yearsToSimulate,
            [brokerage, traditional401k],
            [workIncome, futureSS],
            [livingExpenses],
            assumptions,
            taxState
        );

        expect(simulation.length, 'Simulation should run for 50 years').toBeGreaterThanOrEqual(45);

        // Run comprehensive stability checks
        assertLongHorizonStability(simulation);
    });

    it('should maintain reasonable net worth trajectory over 50 years', () => {
        const simulation = runSimulation(
            yearsToSimulate,
            [brokerage, traditional401k],
            [workIncome, futureSS],
            [livingExpenses],
            assumptions,
            taxState
        );

        const startNetWorth = calculateNetWorth(simulation[0].accounts);
        const peakNetWorth = Math.max(...simulation.map(y => calculateNetWorth(y.accounts)));
        const finalNetWorth = calculateNetWorth(simulation[simulation.length - 1].accounts);

        // Net worth should peak sometime during the simulation
        expect(peakNetWorth, 'Peak net worth should exceed starting').toBeGreaterThan(startNetWorth);

        // Final net worth should not be wildly negative (allow some deficit debt)
        expect(finalNetWorth, 'Final net worth should not be catastrophically negative').toBeGreaterThan(-500000);

        // No single year should have unreasonable growth
        assertNoValueExplosion(simulation);

        // Verify lifetime cash-flow reconciliation
        // cumulative income − expenses − taxes + returns ≈ change in net worth
        assertLifetimeCashFlowReconciliation(simulation);
    });
});

describe('Long-Horizon Stability: Complex Scenario with Debt', () => {
    const birthYear = 1985;
    const retirementAge = 60;
    const yearsToSimulate = 45;

    const taxState: TaxState = {
        filingStatus: 'Married Filing Jointly',
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
            lifeExpectancy: 95,
            retirementAge,
        },
        income: {
            ...defaultAssumptions.income,
            salaryGrowth: 3.0,
        },
        macro: {
            ...defaultAssumptions.macro,
            inflationRate: 3.0,
            inflationAdjusted: true,
            healthcareInflation: 5.0,
        },
        expenses: {
            ...defaultAssumptions.expenses,
            housingAppreciation: 3.0,
        },
        investments: {
            ...defaultAssumptions.investments,
            returnRates: { ror: 6 },
            withdrawalStrategy: 'Guyton Klinger',
            withdrawalRate: 4.0,
            autoRothConversions: true,
        },
        priorities: [{
          id: 'p-1',
          name: 'p1', // e.g., "Max out 401k"
          type: 'INVESTMENT',
          accountId: 'acc-brokerage', // Link to your actual Account IDs
          capType: 'REMAINDER',
          capValue: 0 // e.g., 23000 for 401k, or 500 for monthly savings
        }],
        withdrawalStrategy: [
            { id: 'ws-1', name: 'Brokerage', accountId: 'acc-brokerage' },
            { id: 'ws-2', name: 'Traditional 401k', accountId: 'acc-401k' },
            { id: 'ws-3', name: 'Roth IRA', accountId: 'acc-roth' },
        ],
    };

    const brokerage = new InvestedAccount(
        'acc-brokerage', 'Brokerage', 100000, 0, 10, 0.05, 'Brokerage', true, 1.0, 80000
    );
    const traditional401k = new InvestedAccount(
        'acc-401k', 'Traditional 401k', 200000, 10000, 10, 0.1, 'Traditional 401k', true, 0.2, 180000
    );
    const rothIRA = new InvestedAccount(
        'acc-roth', 'Roth IRA', 50000, 0, 10, 0.05, 'Roth IRA', true, 1.0, 40000
    );
    const property = new PropertyAccount(
        'acc-property', 'Home', 500000, 'Financed', 400000, 400000, 'exp-mortgage'
    );
    const studentLoan = new DebtAccount(
        'acc-studentloan', 'Student Loan', 30000, 'exp-studentloan', 5.0
    );

    const workIncome = new WorkIncome(
        'inc-work', 'Job', 120000, 'Annually', 'Yes',
        18000, 5000, 5000, 9000, 'acc-401k', 'Traditional 401k', 'GROW_WITH_SALARY',
        new Date('2015-01-01'),
        new Date(`${birthYear + retirementAge - 1}-12-31`)
    );

    const futureSS = new FutureSocialSecurityIncome('inc-ss', 'Social Security', 67, 0, 0);

    const mortgage = new MortgageExpense(
        'exp-mortgage', 'Mortgage', 'Monthly',
        500000, 400000, 400000,
        6.5, 30, 1.2, 0, 1.0, 250, 0.4, 0.3, 150,
        'Itemized', 0, 'acc-property', new Date('2025-01-01')
    );

    const studentLoanExpense = new LoanExpense(
        'exp-studentloan', 'Student Loan', 30000, 'Monthly',
        5.0, 'Compounding', 320, 'No', 0, 'acc-studentloan',
        new Date('2025-01-01'), new Date('2035-01-01')
    );

    const livingExpenses = new FoodExpense(
        'exp-living', 'Living', 40000, 'Annually', new Date('2025-01-01')
    );

    it('should handle complex scenario with debt for 45 years', () => {
        const simulation = runSimulation(
            yearsToSimulate,
            [brokerage, traditional401k, rothIRA, property, studentLoan],
            [workIncome, futureSS],
            [mortgage, studentLoanExpense, livingExpenses],
            assumptions,
            taxState
        );

        expect(simulation.length, 'Simulation should run').toBeGreaterThan(30);

        // Run comprehensive stability checks
        assertLongHorizonStability(simulation);
        assertAllYearsInvariants(simulation);

        // Verify lifetime cash-flow reconciliation for complex scenario with debt
        // This catches accounting bugs in mortgage/loan principal tracking
        assertLifetimeCashFlowReconciliation(simulation, 10); // Allow 10% tolerance for complex debt scenarios
    });

    it('should pay off student loan within expected timeframe', () => {
        const simulation = runSimulation(
            yearsToSimulate,
            [brokerage, traditional401k, rothIRA, property, studentLoan],
            [workIncome, futureSS],
            [mortgage, studentLoanExpense, livingExpenses],
            assumptions,
            taxState
        );

        // Student loan should be paid off within ~10 years
        let paidOff = false;
        for (const year of simulation) {
            const loan = year.accounts.find(a => a.id === 'acc-studentloan');
            if (loan && loan.amount < 100) {
                paidOff = true;
                break;
            }
        }

        expect(paidOff, 'Student loan should be paid off during simulation').toBe(true);
    });

    it('should have property appreciate over time', () => {
        const simulation = runSimulation(
            yearsToSimulate,
            [brokerage, traditional401k, rothIRA, property, studentLoan],
            [workIncome, futureSS],
            [mortgage, studentLoanExpense, livingExpenses],
            assumptions,
            taxState
        );

        const startProperty = getAccountById(simulation[0], 'acc-property') as PropertyAccount;
        const endProperty = getAccountById(simulation[simulation.length - 1], 'acc-property') as PropertyAccount;

        if (startProperty && endProperty) {
            expect(
                endProperty.amount,
                'Property should appreciate over 45 years'
            ).toBeGreaterThan(startProperty.amount);
        }
    });
});

describe('Long-Horizon Stability: Extreme Scenarios', () => {
    const taxState: TaxState = {
        filingStatus: 'Single',
        stateResidency: 'DC',
        deductionMethod: 'Standard',
        fedOverride: null,
        ficaOverride: null,
        stateOverride: null,
        year: 2025,
    };

    it('should handle very high return rate (15%) for 40 years', () => {
        const assumptions: AssumptionsState = {
            ...defaultAssumptions,
            demographics: {
                birthYear: 1985,
                lifeExpectancy: 95,
                retirementAge: 65,
            },
            macro: {
                ...defaultAssumptions.macro,
                inflationRate: 0,
                inflationAdjusted: false,
            },
            investments: {
                ...defaultAssumptions.investments,
                returnRates: { ror: 15 }, // Very high returns
                autoRothConversions: false,
            },
            withdrawalStrategy: [],
        };

        const portfolio = new InvestedAccount(
            'acc-portfolio', 'Portfolio', 100000, 0, 10, 0.1, 'Brokerage', true, 1.0, 100000
        );
        const workIncome = new WorkIncome(
            'inc-work', 'Job', 80000, 'Annually', 'Yes',
            0, 0, 0, 0, '', null, 'FIXED'
        );
        const futureSS = new FutureSocialSecurityIncome('inc-ss', 'SS', 67, 0, 0);
        const living = new FoodExpense('exp-living', 'Living', 40000, 'Annually', new Date('2025-01-01'));

        const simulation = runSimulation(
            40,
            [portfolio],
            [workIncome, futureSS],
            [living],
            assumptions,
            taxState
        );

        // Should run without NaN or Infinity despite high returns
        assertLongHorizonStability(simulation);

        // Final balance should be large but finite
        const finalPortfolio = getAccountById(simulation[simulation.length - 1], 'acc-portfolio');
        expect(Number.isFinite(finalPortfolio?.amount), 'Final balance should be finite').toBe(true);
    });

    it('should handle very low return rate (1%) for 40 years', () => {
        const birthYear = 1985;
        const retirementAge = 65;
        const assumptions: AssumptionsState = {
            ...defaultAssumptions,
            demographics: {
                birthYear,
                lifeExpectancy: 95,
                retirementAge,
            },
            macro: {
                ...defaultAssumptions.macro,
                inflationRate: 0,
                inflationAdjusted: false,
            },
            investments: {
                ...defaultAssumptions.investments,
                returnRates: { ror: 1 }, // Very low returns
                autoRothConversions: false,
            },
            withdrawalStrategy: [
                { id: 'ws-1', name: 'Portfolio', accountId: 'acc-portfolio' },
            ],
        };

        const portfolio = new InvestedAccount(
            'acc-portfolio', 'Portfolio', 1000000, 0, 20, 0.1, 'Brokerage', true, 1.0, 600000
        );
        const workIncome = new WorkIncome(
            'inc-work', 'Job', 60000, 'Annually', 'Yes',
            0, 0, 0, 0, '', null, 'FIXED',
            new Date('2010-01-01'),
            new Date(`${birthYear + retirementAge - 1}-12-31`)
        );
        const futureSS = new FutureSocialSecurityIncome('inc-ss', 'SS', 67, 0, 0);
        const living = new FoodExpense('exp-living', 'Living', 40000, 'Annually', new Date('2025-01-01'));

        const simulation = runSimulation(
            40,
            [portfolio],
            [workIncome, futureSS],
            [living],
            assumptions,
            taxState
        );

        // Should run without errors
        assertLongHorizonStability(simulation);
    });

    it('should handle high inflation (8%) for 40 years', () => {
        const assumptions: AssumptionsState = {
            ...defaultAssumptions,
            demographics: {
                birthYear: 1985,
                lifeExpectancy: 95,
                retirementAge: 65,
            },
            macro: {
                ...defaultAssumptions.macro,
                inflationRate: 8, // High inflation
                inflationAdjusted: true,
            },
            investments: {
                ...defaultAssumptions.investments,
                returnRates: { ror: 10 },
                autoRothConversions: false,
            },
            withdrawalStrategy: [
                { id: 'ws-1', name: 'Portfolio', accountId: 'acc-portfolio' },
            ],
        };

        const portfolio = new InvestedAccount(
            'acc-portfolio', 'Portfolio', 500000, 0, 15, 0.1, 'Brokerage', true, 1.0, 300000
        );
        const workIncome = new WorkIncome(
            'inc-work', 'Job', 80000, 'Annually', 'Yes',
            0, 0, 0, 0, '', null, 'FIXED',
            new Date('2010-01-01'),
            new Date('2049-12-31')
        );
        const futureSS = new FutureSocialSecurityIncome('inc-ss', 'SS', 67, 0, 0);
        const living = new FoodExpense('exp-living', 'Living', 40000, 'Annually', new Date('2025-01-01'));

        const simulation = runSimulation(
            40,
            [portfolio],
            [workIncome, futureSS],
            [living],
            assumptions,
            taxState
        );

        // Should run without errors despite high inflation
        assertLongHorizonStability(simulation);
    });
});

/**
 * Feedback Loop Prevention Tests
 *
 * These tests specifically target bugs where a variable indirectly amplifies itself,
 * causing exponential growth or other runaway behavior.
 *
 * Common feedback loop patterns:
 * - Interest counted as income, then taxed, then re-added as interest
 * - Taxes counted as income (double taxation)
 * - Expenses indexed to net worth (spending grows as wealth grows)
 * - Account growth exceeding theoretical maximum (APR/ROR + contributions)
 */
describe('Feedback Loop Prevention', () => {
    const taxState: TaxState = {
        filingStatus: 'Single',
        stateResidency: 'DC',
        deductionMethod: 'Standard',
        fedOverride: null,
        ficaOverride: null,
        stateOverride: null,
        year: 2025,
    };

    const birthYear = 1980;
    const retirementAge = 65;

    describe('Interest/Dividend Feedback Loops', () => {
        it('should not have exponential interest growth beyond compound rate', () => {
            // Setup: Savings account with known APR, NO surplus income to isolate interest growth
            // Expenses match income so no deposits occur - only interest accumulates
            const apr = 5; // 5% APR
            const initialBalance = 100000;

            const assumptions: AssumptionsState = {
                ...defaultAssumptions,
                demographics: { birthYear, lifeExpectancy: 90, retirementAge },
                macro: {
                    ...defaultAssumptions.macro,
                    inflationRate: 0,
                    inflationAdjusted: false,
                },
                investments: {
                    ...defaultAssumptions.investments,
                    returnRates: { ror: 0 }, // No market returns
                    autoRothConversions: false,
                },
                withdrawalStrategy: [],
            };

            const savingsAccount = new SavedAccount('acc-savings', 'HYSA', initialBalance, apr);
            // Income = $60k, after ~25% tax = ~$45k net
            // Expenses = $45k, so no surplus to deposit
            const workIncome = new WorkIncome(
                'inc-work', 'Job', 60000, 'Annually', 'Yes',
                0, 0, 0, 0, '', null, 'FIXED'
            );
            const futureSS = new FutureSocialSecurityIncome('inc-ss', 'SS', 70, 0, 0);
            const expenses = new FoodExpense('exp-living', 'Living', 45000, 'Annually', new Date('2025-01-01'));

            const simulation = runSimulation(
                20, // 20 years
                [savingsAccount],
                [workIncome, futureSS],
                [expenses],
                assumptions,
                taxState
            );

            // Calculate maximum theoretical balance with compound interest ONLY
            // Balance after n years = P * (1 + r)^n = $100k * 1.05^20 = $265,330
            const maxTheoreticalBalance = initialBalance * Math.pow(1 + apr / 100, 20);

            const finalAccount = getAccountById(simulation[simulation.length - 1], 'acc-savings');
            expect(
                finalAccount?.amount,
                `Savings balance ($${finalAccount?.amount.toFixed(0)}) should not exceed theoretical compound max ($${maxTheoreticalBalance.toFixed(0)}). ` +
                `If significantly higher, interest may be double-counted or feedback loop exists.`
            ).toBeLessThanOrEqual(maxTheoreticalBalance * 1.05); // 5% tolerance for rounding
        });
    });

    describe('Tax Feedback Loops', () => {
        it('should not count taxes as income', () => {
            // Simple scenario: fixed income, no investments, no withdrawals
            // This isolates income calculation from complex portfolio interactions
            const assumptions: AssumptionsState = {
                ...defaultAssumptions,
                demographics: { birthYear, lifeExpectancy: 90, retirementAge },
                income: {
                    ...defaultAssumptions.income,
                    salaryGrowth: 0, // Explicitly disable salary growth
                },
                macro: {
                    ...defaultAssumptions.macro,
                    inflationRate: 0,
                    inflationAdjusted: false,
                },
                investments: {
                    ...defaultAssumptions.investments,
                    returnRates: { ror: 0 }, // No returns to simplify
                    autoRothConversions: false,
                },
                withdrawalStrategy: [],
            };

            const workIncome = new WorkIncome(
                'inc-work', 'Job', 100000, 'Annually', 'Yes',
                0, 0, 0, 0, '', null, 'FIXED'
            );
            const futureSS = new FutureSocialSecurityIncome('inc-ss', 'SS', 70, 0, 0);
            const expenses = new FoodExpense('exp-living', 'Living', 50000, 'Annually', new Date('2025-01-01'));

            const simulation = runSimulation(
                10,
                [], // No accounts - just income and expenses
                [workIncome, futureSS],
                [expenses],
                assumptions,
                taxState
            );

            // With only work income of $100k, totalIncome should be exactly $100k
            // If taxes were counted as income, it would be higher
            for (const year of simulation) {
                const expectedIncome = 100000; // Fixed salary, no other sources
                const reportedTotal = year.cashflow.totalIncome;

                expect(
                    reportedTotal,
                    `Year ${year.year}: Total income ($${reportedTotal.toFixed(0)}) should equal expected ($${expectedIncome}). ` +
                    `If higher, taxes may be incorrectly counted as income.`
                ).toBeCloseTo(expectedIncome, -2); // Within $100
            }
        });

        it('should have taxes always less than income', () => {
            const assumptions: AssumptionsState = {
                ...defaultAssumptions,
                demographics: { birthYear, lifeExpectancy: 90, retirementAge },
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
                    { id: 'ws-1', name: 'Portfolio', accountId: 'acc-portfolio' },
                ],
            };

            const portfolio = new InvestedAccount(
                'acc-portfolio', 'Portfolio', 1000000, 0, 15, 0.05, 'Brokerage', true, 1.0, 600000
            );
            const workIncome = new WorkIncome(
                'inc-work', 'Job', 80000, 'Annually', 'Yes',
                0, 0, 0, 0, '', null, 'FIXED',
                new Date('2010-01-01'),
                new Date(`${birthYear + retirementAge - 1}-12-31`)
            );
            const futureSS = new FutureSocialSecurityIncome('inc-ss', 'SS', 67, 0, 0);
            const expenses = new FoodExpense('exp-living', 'Living', 60000, 'Annually', new Date('2025-01-01'));

            const simulation = runSimulation(
                30,
                [portfolio],
                [workIncome, futureSS],
                [expenses],
                assumptions,
                taxState
            );

            for (const year of simulation) {
                // Tax is stored in taxDetails, not cashflow
                const { fed, state, fica, capitalGains } = year.taxDetails;
                const totalTax = fed + state + fica + capitalGains;
                const totalIncome = year.cashflow.totalIncome;

                // First check: neither value should be NaN or Infinity
                expect(
                    Number.isFinite(totalTax),
                    `Year ${year.year}: totalTax (${totalTax}) is not finite - this indicates a calculation bug`
                ).toBe(true);

                expect(
                    Number.isFinite(totalIncome),
                    `Year ${year.year}: totalIncome (${totalIncome}) is not finite - this indicates a calculation bug`
                ).toBe(true);

                // Taxes should never exceed 100% of income (feedback loop indicator)
                if (totalIncome > 0) {
                    const taxRate = totalTax / totalIncome;

                    expect(
                        taxRate,
                        `Year ${year.year}: Tax rate (${(taxRate * 100).toFixed(1)}%) should not exceed 100%`
                    ).toBeLessThan(1.0);

                    // Realistic upper bound: even with high income, total tax rate shouldn't exceed 60%
                    expect(
                        taxRate,
                        `Year ${year.year}: Effective tax rate seems unreasonably high`
                    ).toBeLessThan(0.60);
                }
            }
        });
    });

    describe('Account Growth Bounds', () => {
        it('should limit SavedAccount growth to APR only (no contributions scenario)', () => {
            // Isolate APR growth by having expenses consume all income
            const apr = 5;
            const initialBalance = 50000;

            const assumptions: AssumptionsState = {
                ...defaultAssumptions,
                demographics: { birthYear, lifeExpectancy: 90, retirementAge },
                macro: {
                    ...defaultAssumptions.macro,
                    inflationRate: 0,
                    inflationAdjusted: false,
                },
                investments: {
                    ...defaultAssumptions.investments,
                    returnRates: { ror: 0 },
                    autoRothConversions: false,
                },
                withdrawalStrategy: [],
            };

            const savings = new SavedAccount('acc-savings', 'Savings', initialBalance, apr);
            // Income ~= expenses after tax, so no surplus contributions
            const workIncome = new WorkIncome(
                'inc-work', 'Job', 50000, 'Annually', 'Yes',
                0, 0, 0, 0, '', null, 'FIXED'
            );
            const futureSS = new FutureSocialSecurityIncome('inc-ss', 'SS', 70, 0, 0);
            const expenses = new FoodExpense('exp-living', 'Living', 40000, 'Annually', new Date('2025-01-01'));

            const simulation = runSimulation(
                15,
                [savings],
                [workIncome, futureSS],
                [expenses],
                assumptions,
                taxState
            );

            // Check year-over-year growth is bounded by APR
            for (let i = 1; i < simulation.length; i++) {
                const prevBalance = getAccountById(simulation[i - 1], 'acc-savings')?.amount || 0;
                const currBalance = getAccountById(simulation[i], 'acc-savings')?.amount || 0;

                if (prevBalance > 0) {
                    const growth = currBalance - prevBalance;
                    const maxInterest = prevBalance * (apr / 100);
                    // Small buffer for any minor surplus, but NOT $100k
                    const maxContribution = 15000;

                    expect(
                        growth,
                        `Year ${simulation[i].year}: Savings growth ($${growth.toFixed(0)}) exceeds APR ($${maxInterest.toFixed(0)}) + reasonable max contribution ($${maxContribution})`
                    ).toBeLessThanOrEqual(maxInterest + maxContribution);
                }
            }
        });

        it('should limit InvestedAccount growth to ROR only (no contributions scenario)', () => {
            // Isolate ROR growth by having expenses consume all income
            const ror = 10; // 10% returns
            const initialBalance = 200000;

            const assumptions: AssumptionsState = {
                ...defaultAssumptions,
                demographics: { birthYear, lifeExpectancy: 90, retirementAge },
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
                    returnRates: { ror },
                    autoRothConversions: false,
                },
                withdrawalStrategy: [],
            };

            const portfolio = new InvestedAccount(
                'acc-portfolio', 'Portfolio', initialBalance, 0, 10, 0.05, 'Brokerage', true, 1.0, 150000
            );
            // Income ~= expenses after tax, so minimal surplus
            const workIncome = new WorkIncome(
                'inc-work', 'Job', 60000, 'Annually', 'Yes',
                0, 0, 0, 0, '', null, 'FIXED'
            );
            const futureSS = new FutureSocialSecurityIncome('inc-ss', 'SS', 70, 0, 0);
            const expenses = new FoodExpense('exp-living', 'Living', 45000, 'Annually', new Date('2025-01-01'));

            const simulation = runSimulation(
                15,
                [portfolio],
                [workIncome, futureSS],
                [expenses],
                assumptions,
                taxState
            );

            // Check year-over-year growth is bounded by ROR + small buffer
            for (let i = 1; i < simulation.length; i++) {
                const prevBalance = getAccountById(simulation[i - 1], 'acc-portfolio')?.amount || 0;
                const currBalance = getAccountById(simulation[i], 'acc-portfolio')?.amount || 0;

                if (prevBalance > 0) {
                    const growth = currBalance - prevBalance;
                    const maxReturn = prevBalance * (ror / 100);
                    // Small buffer for minor surplus, but NOT $100k
                    const maxContribution = 20000;

                    expect(
                        growth,
                        `Year ${simulation[i].year}: Portfolio growth ($${growth.toFixed(0)}) exceeds ROR ($${maxReturn.toFixed(0)}) + reasonable max contribution ($${maxContribution})`
                    ).toBeLessThanOrEqual(maxReturn + maxContribution);
                }
            }
        });

        it('should limit PropertyAccount growth to appreciation rate', () => {
            const appreciationRate = 3; // 3% appreciation
            const initialValue = 400000;

            const assumptions: AssumptionsState = {
                ...defaultAssumptions,
                demographics: { birthYear, lifeExpectancy: 90, retirementAge },
                macro: {
                    ...defaultAssumptions.macro,
                    inflationRate: 0,
                    inflationAdjusted: false,
                },
                expenses: {
                    ...defaultAssumptions.expenses,
                    housingAppreciation: appreciationRate,
                },
                investments: {
                    ...defaultAssumptions.investments,
                    returnRates: { ror: 7 },
                    autoRothConversions: false,
                },
                withdrawalStrategy: [],
            };

            const property = new PropertyAccount(
                'acc-property', 'Home', initialValue, 'Financed', 300000, 300000, 'exp-mortgage'
            );
            const portfolio = new InvestedAccount(
                'acc-portfolio', 'Portfolio', 200000, 0, 10, 0.05, 'Brokerage', true, 1.0, 150000
            );

            const mortgage = new MortgageExpense(
                'exp-mortgage', 'Mortgage', 'Monthly',
                initialValue, 300000, 300000,
                6.0, 30, 1.2, 0, 1.0, 200, 0.4, 0, 100,
                'Itemized', 0, 'acc-property', new Date('2020-01-01')
            );

            const workIncome = new WorkIncome(
                'inc-work', 'Job', 120000, 'Annually', 'Yes',
                0, 0, 0, 0, '', null, 'FIXED'
            );
            const futureSS = new FutureSocialSecurityIncome('inc-ss', 'SS', 70, 0, 0);
            const expenses = new FoodExpense('exp-living', 'Living', 30000, 'Annually', new Date('2025-01-01'));

            const simulation = runSimulation(
                20,
                [property, portfolio],
                [workIncome, futureSS],
                [mortgage, expenses],
                assumptions,
                taxState
            );

            // Property value should grow at approximately the appreciation rate
            const finalProperty = getAccountById(simulation[simulation.length - 1], 'acc-property') as PropertyAccount;
            const maxTheoreticalValue = initialValue * Math.pow(1 + appreciationRate / 100, 20);

            if (finalProperty) {
                expect(
                    finalProperty.amount,
                    `Property value ($${finalProperty.amount.toFixed(0)}) should not exceed theoretical max ($${maxTheoreticalValue.toFixed(0)})`
                ).toBeLessThanOrEqual(maxTheoreticalValue * 1.10); // 10% tolerance
            }
        });
    });
});
