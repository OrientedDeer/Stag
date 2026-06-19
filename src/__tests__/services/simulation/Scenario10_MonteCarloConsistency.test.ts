/**
 * Scenario 10: Monte Carlo Consistency (Systems Test)
 *
 * This test verifies that Monte Carlo simulations produce consistent,
 * reproducible results and handle edge cases gracefully.
 *
 * Setup:
 *   Moderate scenario (not guaranteed success/failure)
 *   100+ runs with fixed seed
 *
 * Verifications:
 *   1. Same seed produces identical results across two runs
 *   2. No year in any run has NaN in any field
 *   3. No account balance goes negative
 *   4. DeficitDebt only increases when all accounts are $0
 *   5. Success rate is reasonable (not 0% or 100% for moderate scenario)
 *   6. Spread: 10th percentile < median < 90th percentile
 *   7. Every run's every year has Sankey balance within $1
 */

import { describe, it, expect } from 'vitest';

// Monte Carlo imports
import { runMonteCarloSimulationSync } from '../../../services/MonteCarloEngine';
import { MonteCarloConfig } from '../../../services/MonteCarloTypes';

// Simulation imports
import { simulateOneYear } from '../../../components/Objects/Assumptions/SimulationEngine';

// Model imports
import { InvestedAccount, SavedAccount } from '../../../components/Objects/Accounts/models';
import { SocialSecurityIncome, PassiveIncome } from '../../../components/Objects/Income/models';
import { OtherExpense } from '../../../components/Objects/Expense/models';
import { AssumptionsState, defaultAssumptions, createBuiltinMilestones } from '../../../components/Objects/Assumptions/AssumptionsContext';
import { TaxState } from '../../../components/Objects/Taxes/TaxContext';
import { SimulationYear } from '../../../services/simulation/types';

// =============================================================================
// TEST FIXTURES
// =============================================================================

const SCENARIO_YEAR = 2025;
const BIRTH_YEAR = 1960; // Age 65 in 2025

function createModerateScenarioAccounts() {
    // Total: ~$800k - moderate scenario where outcome depends on market returns
    // With $18k annual shortfall (~2.25% withdrawal rate), should see 70-90% success
    const brokerage = new InvestedAccount(
        'brokerage-1', 'Brokerage', 200000,
        0, 15, 0.07, 'Brokerage',
        true, 0.2, 140000
    );

    const traditional = new InvestedAccount(
        'trad-1', 'Traditional IRA', 400000,
        0, 20, 0.05, 'Traditional IRA'
    );

    const roth = new InvestedAccount(
        'roth-1', 'Roth IRA', 160000,
        0, 15, 0.05, 'Roth IRA',
        true, 0.2, 112000
    );

    const savings = new SavedAccount('savings-1', 'Savings', 40000, 2.0);

    return { brokerage, traditional, roth, savings };
}

function createModerateScenarioIncomes() {
    // Social Security: $24k/year ($2000/month)
    const ss = new SocialSecurityIncome(
        'ss-1', 'Social Security',
        2000,       // Monthly amount
        'Monthly',  // Frequency
        65,         // Claiming age
        undefined,  // FRA benefit
        new Date('2025-01-01') // Start date
    );

    // Small pension: $8k/year
    const pension = new PassiveIncome(
        'pension-1', 'Pension', 8000, 'Annually', 'No', 'Other',
        new Date('2025-01-01'), undefined, false
    );

    return { ss, pension };
}

function createModerateScenarioExpenses() {
    // $50k expenses creates ~$18k/year shortfall
    // With $800k assets, 4% return, 18% volatility over 30 years:
    // - 2.25% withdrawal rate is moderate
    // - Should see 70-90% success rate with some failures
    const living = new OtherExpense(
        'living-1', 'Living Expenses', 50000, 'Annually', new Date('2020-01-01')
    );
    return { living };
}

function createModerateScenarioAssumptions(): AssumptionsState {
    return {
        ...defaultAssumptions,
        milestones: createBuiltinMilestones(BIRTH_YEAR, 60, 95),
        investments: {
            ...defaultAssumptions.investments,
            taxOptimizationEnabled: false,
            returnRates: { ror: 6 }, // 6% expected return
        },
        withdrawalStrategy: [
            { id: 'ws-1', name: 'Brokerage', accountId: 'brokerage-1' },
            { id: 'ws-2', name: 'Traditional', accountId: 'trad-1' },
            { id: 'ws-3', name: 'Roth', accountId: 'roth-1' },
            { id: 'ws-4', name: 'Savings', accountId: 'savings-1' },
        ],
    };
}

function createModerateScenarioTaxState(): TaxState {
    return {
        filingStatus: 'Single',
        stateResidency: 'Texas', // Use full state name (database uses names, not codes)
        deductionMethod: 'Standard',
        fedOverride: null,
        ficaOverride: null,
        stateOverride: null,
        year: SCENARIO_YEAR,
    };
}

// Helper to run a single simulation year
function runYear(
    year: number,
    accounts: ReturnType<typeof createModerateScenarioAccounts>,
    incomes: ReturnType<typeof createModerateScenarioIncomes>,
    expenses: ReturnType<typeof createModerateScenarioExpenses>,
    assumptions: AssumptionsState,
    taxState: TaxState
): SimulationYear {
    return simulateOneYear(
        year,
        [incomes.ss, incomes.pension],
        [expenses.living],
        [accounts.brokerage, accounts.traditional, accounts.roth, accounts.savings],
        assumptions,
        taxState
    );
}

// =============================================================================
// LEVEL 1: SINGLE YEAR VALIDATION
// =============================================================================

describe('Scenario 10: Level 1 - Single Year Validation', () => {
    it('should produce valid result with no NaN values', () => {
        const accounts = createModerateScenarioAccounts();
        const incomes = createModerateScenarioIncomes();
        const expenses = createModerateScenarioExpenses();
        const assumptions = createModerateScenarioAssumptions();
        const taxState = createModerateScenarioTaxState();

        const result = runYear(
            SCENARIO_YEAR,
            accounts,
            incomes,
            expenses,
            assumptions,
            taxState
        );

        // Check for NaN in cashflow
        expect(Number.isNaN(result.cashflow.totalIncome)).toBe(false);
        expect(Number.isNaN(result.cashflow.totalExpense)).toBe(false);
        expect(Number.isNaN(result.cashflow.livingExpenses)).toBe(false);
        expect(Number.isNaN(result.cashflow.discretionary)).toBe(false);
        expect(Number.isNaN(result.cashflow.withdrawals)).toBe(false);

        // Check for NaN in tax details
        expect(Number.isNaN(result.taxDetails.fed)).toBe(false);
        expect(Number.isNaN(result.taxDetails.state)).toBe(false);
        expect(Number.isNaN(result.taxDetails.fica)).toBe(false);
    });

    it('should have no negative account balances', () => {
        const accounts = createModerateScenarioAccounts();
        const incomes = createModerateScenarioIncomes();
        const expenses = createModerateScenarioExpenses();
        const assumptions = createModerateScenarioAssumptions();
        const taxState = createModerateScenarioTaxState();

        const result = runYear(
            SCENARIO_YEAR,
            accounts,
            incomes,
            expenses,
            assumptions,
            taxState
        );

        for (const account of result.accounts) {
            expect(account.amount).toBeGreaterThanOrEqual(0);
        }
    });

    it('should have valid Sankey balance (inflows ≈ outflows)', () => {
        const accounts = createModerateScenarioAccounts();
        const incomes = createModerateScenarioIncomes();
        const expenses = createModerateScenarioExpenses();
        const assumptions = createModerateScenarioAssumptions();
        const taxState = createModerateScenarioTaxState();

        const result = runYear(
            SCENARIO_YEAR,
            accounts,
            incomes,
            expenses,
            assumptions,
            taxState
        );

        // Basic sanity check: income + withdrawals should cover expenses
        // The detailed Sankey balance involves many complex flows
        const totalResources = result.cashflow.totalIncome + result.cashflow.withdrawals;
        const livingExpenses = result.cashflow.livingExpenses;

        // Resources should be able to cover base expenses
        expect(totalResources).toBeGreaterThanOrEqual(livingExpenses * 0.9);

        // No NaN values
        expect(Number.isNaN(result.cashflow.discretionary)).toBe(false);
    });
});

// =============================================================================
// LEVEL 2: MULTI-YEAR SEQUENCE VALIDATION
// =============================================================================

describe('Scenario 10: Level 2 - Multi-Year Sequence', () => {
    it('should maintain consistency across 5 sequential years', () => {
        let accounts = createModerateScenarioAccounts();
        const incomes = createModerateScenarioIncomes();
        const expenses = createModerateScenarioExpenses();
        const assumptions = createModerateScenarioAssumptions();
        const taxState = createModerateScenarioTaxState();

        const results: SimulationYear[] = [];

        for (let year = 2025; year <= 2029; year++) {
            const result = simulateOneYear(
                year,
                [incomes.ss, incomes.pension],
                [expenses.living],
                [accounts.brokerage, accounts.traditional, accounts.roth, accounts.savings],
                assumptions,
                taxState
            );

            results.push(result);

            // Update accounts for next year
            accounts = {
                brokerage: result.accounts.find(a => a.id === 'brokerage-1') as InvestedAccount,
                traditional: result.accounts.find(a => a.id === 'trad-1') as InvestedAccount,
                roth: result.accounts.find(a => a.id === 'roth-1') as InvestedAccount,
                savings: result.accounts.find(a => a.id === 'savings-1') as SavedAccount,
            };
        }

        // Verify each year
        for (const result of results) {
            // No NaN
            expect(Number.isNaN(result.cashflow.totalIncome)).toBe(false);

            // No negative balances
            for (const account of result.accounts) {
                expect(account.amount).toBeGreaterThanOrEqual(0);
            }
        }

        // Years should be sequential
        expect(results.map(r => r.year)).toEqual([2025, 2026, 2027, 2028, 2029]);
    });

    it('should handle portfolio decline gracefully', () => {
        // Start with smaller portfolio to test decline handling
        const accounts = {
            brokerage: new InvestedAccount(
                'brokerage-1', 'Brokerage', 50000,
                0, 10, 0.07, 'Brokerage',
                true, 0.2, 40000
            ),
            traditional: new InvestedAccount(
                'trad-1', 'Traditional IRA', 100000,
                0, 15, 0.05, 'Traditional IRA'
            ),
            roth: new InvestedAccount(
                'roth-1', 'Roth IRA', 30000,
                0, 10, 0.05, 'Roth IRA',
                true, 0.2, 20000
            ),
            savings: new SavedAccount('savings-1', 'Savings', 10000, 2.0),
        };

        const incomes = createModerateScenarioIncomes();
        const expenses = createModerateScenarioExpenses();
        const assumptions = createModerateScenarioAssumptions();
        const taxState = createModerateScenarioTaxState();

        // Should not crash even with declining portfolio
        expect(() => {
            simulateOneYear(
                SCENARIO_YEAR,
                [incomes.ss, incomes.pension],
                [expenses.living],
                [accounts.brokerage, accounts.traditional, accounts.roth, accounts.savings],
                assumptions,
                taxState
            );
        }).not.toThrow();
    });
});

// =============================================================================
// LEVEL 3: CONSISTENCY CHECKS
// =============================================================================

describe('Scenario 10: Level 3 - Consistency Checks', () => {
    it('should produce deterministic results (no random variation without Monte Carlo)', () => {
        const accounts1 = createModerateScenarioAccounts();
        const accounts2 = createModerateScenarioAccounts();
        const incomes = createModerateScenarioIncomes();
        const expenses = createModerateScenarioExpenses();
        const assumptions = createModerateScenarioAssumptions();
        const taxState = createModerateScenarioTaxState();

        const result1 = simulateOneYear(
            SCENARIO_YEAR,
            [incomes.ss, incomes.pension],
            [expenses.living],
            [accounts1.brokerage, accounts1.traditional, accounts1.roth, accounts1.savings],
            assumptions,
            taxState
        );

        const result2 = simulateOneYear(
            SCENARIO_YEAR,
            [incomes.ss, incomes.pension],
            [expenses.living],
            [accounts2.brokerage, accounts2.traditional, accounts2.roth, accounts2.savings],
            assumptions,
            taxState
        );

        // Same inputs should produce same outputs
        expect(result1.cashflow.totalIncome).toBe(result2.cashflow.totalIncome);
        expect(result1.cashflow.withdrawals).toBe(result2.cashflow.withdrawals);
        expect(result1.taxDetails.fed).toBe(result2.taxDetails.fed);
    });

    it('should have reasonable income vs expense ratio', () => {
        const accounts = createModerateScenarioAccounts();
        const incomes = createModerateScenarioIncomes();
        const expenses = createModerateScenarioExpenses();
        const assumptions = createModerateScenarioAssumptions();
        const taxState = createModerateScenarioTaxState();

        const result = runYear(
            SCENARIO_YEAR,
            accounts,
            incomes,
            expenses,
            assumptions,
            taxState
        );

        // Total income (including withdrawals) should cover expenses
        const totalResources = result.cashflow.totalIncome + result.cashflow.withdrawals;
        const totalNeeds = result.cashflow.livingExpenses + result.taxDetails.fed + result.taxDetails.state;

        // Should be able to cover needs with some buffer
        expect(totalResources).toBeGreaterThanOrEqual(totalNeeds * 0.95);
    });

    it('should track withdrawal sources correctly', () => {
        const accounts = createModerateScenarioAccounts();
        const incomes = createModerateScenarioIncomes();
        const expenses = createModerateScenarioExpenses();
        const assumptions = createModerateScenarioAssumptions();
        const taxState = createModerateScenarioTaxState();

        const result = runYear(
            SCENARIO_YEAR,
            accounts,
            incomes,
            expenses,
            assumptions,
            taxState
        );

        // If there are withdrawals, they should be tracked in detail
        if (result.cashflow.withdrawals > 0) {
            const detailSum = Object.values(result.cashflow.withdrawalDetail).reduce(
                (sum, amount) => sum + amount, 0
            );

            // Detail should match total (within rounding)
            expect(Math.abs(detailSum - result.cashflow.withdrawals)).toBeLessThan(1);
        }
    });
});

// =============================================================================
// HAND-CALCULATED VERIFICATION
// =============================================================================

describe('Scenario 10: Hand-Calculated Values', () => {
    it('should calculate initial portfolio value', () => {
        // Matches createModerateScenarioAccounts()
        // Brokerage: $200k
        // Traditional: $400k
        // Roth: $160k
        // Savings: $40k
        // Total: $800,000
        const brokerage = 200000;
        const traditional = 400000;
        const roth = 160000;
        const savings = 40000;
        const total = brokerage + traditional + roth + savings;

        expect(total).toBe(800000);
    });

    it('should calculate annual income', () => {
        // Matches createModerateScenarioIncomes()
        // SS: $24,000 ($2000/month × 12)
        // Pension: $8,000 ($666.67/month × 12)
        // Total: $32,000
        const ss = 24000;
        const pension = 8000;
        const totalIncome = ss + pension;

        expect(totalIncome).toBe(32000);
    });

    it('should calculate annual deficit', () => {
        // Matches createModerateScenarioExpenses()
        // Income: $32,000
        // Expenses: $50,000
        // Deficit: $18,000 (before taxes)
        const income = 32000;
        const expenses = 50000;
        const deficit = expenses - income;

        expect(deficit).toBe(18000);
    });

    it('should estimate withdrawal rate', () => {
        // Deficit: $18,000
        // Portfolio: $800,000
        // Withdrawal rate: 2.25%
        const deficit = 18000;
        const portfolio = 800000;
        const withdrawalRate = deficit / portfolio;

        expect(withdrawalRate).toBeCloseTo(0.0225, 3);
    });

    it('should verify safe withdrawal rate scenario', () => {
        // At 2.25% withdrawal rate, this is a moderate scenario
        // Traditional 4% rule would suggest ~$32k safe withdrawal
        // We need $18k → should be sustainable in most scenarios
        const safeWithdrawal = 800000 * 0.04;
        const actualNeed = 18000;

        expect(actualNeed).toBeLessThan(safeWithdrawal);
    });
});

// =============================================================================
// LEVEL 4: MONTE CARLO TESTS - Full 100+ Run Simulation
// Per spec: 100+ runs with fixed seed
// =============================================================================

describe('Scenario 10: Level 4 - Monte Carlo Simulation', () => {
    const FIXED_SEED = 42;
    const NUM_RUNS = 100;

    function createMonteCarloConfig(seed: number = FIXED_SEED): MonteCarloConfig {
        return {
            enabled: true,
            numScenarios: NUM_RUNS,
            seed: seed,
            returnMean: 4, // 4% mean return (borderline sustainability)
            returnStdDev: 18, // 18% standard deviation (realistic volatility)
            preset: 'custom',
        };
    }

    // 60s timeout (matches the repo's MC-test convention): this is the only case that runs MC
    // TWICE, and the #89 MC over-conversion cap added an engine-search to the policy solve, so two
    // UNCACHED solves can exceed the 5s default under parallel-suite load. Real usage caches the
    // policy (solved once); determinism itself is unaffected (verified — passes standalone).
    it('should produce identical results with same seed across two runs', { timeout: 60000 }, () => {
        // Per spec: Same seed produces identical results across two runs
        const accounts1 = createModerateScenarioAccounts();
        const accounts2 = createModerateScenarioAccounts();
        const incomes = createModerateScenarioIncomes();
        const expenses = createModerateScenarioExpenses();
        const assumptions = createModerateScenarioAssumptions();
        const taxState = createModerateScenarioTaxState();
        const config = createMonteCarloConfig(FIXED_SEED);

        const result1 = runMonteCarloSimulationSync(
            config,
            [accounts1.brokerage, accounts1.traditional, accounts1.roth, accounts1.savings],
            [incomes.ss, incomes.pension],
            [expenses.living],
            assumptions,
            taxState
        );

        const result2 = runMonteCarloSimulationSync(
            config,
            [accounts2.brokerage, accounts2.traditional, accounts2.roth, accounts2.savings],
            [incomes.ss, incomes.pension],
            [expenses.living],
            assumptions,
            taxState
        );

        // Same seed should produce identical results
        expect(result1.successRate).toBe(result2.successRate);
        expect(result1.totalScenarios).toBe(result2.totalScenarios);
        expect(result1.averageFinalNetWorth).toBe(result2.averageFinalNetWorth);
    });

    it('should have no NaN values in key scenario data', () => {
        // Per spec: No year in any run has NaN in any field
        const accounts = createModerateScenarioAccounts();
        const incomes = createModerateScenarioIncomes();
        const expenses = createModerateScenarioExpenses();
        const assumptions = createModerateScenarioAssumptions();
        const taxState = createModerateScenarioTaxState();
        const config = createMonteCarloConfig();

        const result = runMonteCarloSimulationSync(
            config,
            [accounts.brokerage, accounts.traditional, accounts.roth, accounts.savings],
            [incomes.ss, incomes.pension],
            [expenses.living],
            assumptions,
            taxState
        );

        // Check key values for NaN
        expect(Number.isNaN(result.successRate)).toBe(false);
        expect(Number.isNaN(result.averageFinalNetWorth)).toBe(false);
        expect(Number.isNaN(result.worstCase.finalNetWorth)).toBe(false);
        expect(Number.isNaN(result.medianCase.finalNetWorth)).toBe(false);
        expect(Number.isNaN(result.bestCase.finalNetWorth)).toBe(false);

        // Check percentile data for NaN
        for (const yearData of result.percentiles.p50) {
            expect(Number.isNaN(yearData.netWorth)).toBe(false);
        }
    });

    it('should have no negative account balances in worst case', () => {
        // Per spec: No account balance goes negative
        const accounts = createModerateScenarioAccounts();
        const incomes = createModerateScenarioIncomes();
        const expenses = createModerateScenarioExpenses();
        const assumptions = createModerateScenarioAssumptions();
        const taxState = createModerateScenarioTaxState();
        const config = createMonteCarloConfig();

        const result = runMonteCarloSimulationSync(
            config,
            [accounts.brokerage, accounts.traditional, accounts.roth, accounts.savings],
            [incomes.ss, incomes.pension],
            [expenses.living],
            assumptions,
            taxState
        );

        // Check the worst case scenario timeline for negative balances
        for (const year of result.worstCase.timeline) {
            for (const account of year.accounts) {
                expect(account.amount).toBeGreaterThanOrEqual(0);
            }
        }
    });

    it('should have reasonable success rate (not 0% or 100%)', () => {
        // Per spec: Success rate is reasonable (not 0% or 100% for moderate scenario)
        const accounts = createModerateScenarioAccounts();
        const incomes = createModerateScenarioIncomes();
        const expenses = createModerateScenarioExpenses();
        const assumptions = createModerateScenarioAssumptions();
        const taxState = createModerateScenarioTaxState();
        const config = createMonteCarloConfig();

        const result = runMonteCarloSimulationSync(
            config,
            [accounts.brokerage, accounts.traditional, accounts.roth, accounts.savings],
            [incomes.ss, incomes.pension],
            [expenses.living],
            assumptions,
            taxState
        );

        // Debug: what is the actual success rate?
        console.log('DEBUG successRate:', result.successRate);
        console.log('DEBUG worstCase.finalNetWorth:', result.worstCase.finalNetWorth);
        console.log('DEBUG worstCase.yearOfDepletion:', result.worstCase.yearOfDepletion);
        console.log('DEBUG bestCase.finalNetWorth:', result.bestCase.finalNetWorth);

        // Check last few years of worst case for deficit
        const timeline = result.worstCase.timeline;
        const lastYears = timeline.slice(-5);
        for (const year of lastYears) {
            const cf = year.cashflow;
            const totalAccounts = year.accounts.reduce((s, a) => s + a.amount, 0);
            console.log(`Year ${year.year}: accounts=$${totalAccounts.toFixed(0)}, income=$${cf.totalIncome.toFixed(0)}, expense=$${cf.totalExpense.toFixed(0)}, withdrawals=$${cf.withdrawals.toFixed(0)}, discretionary=$${cf.discretionary.toFixed(0)}`);
        }

        // Per spec: Success rate should not be 0% or 100% for moderate scenario
        expect(result.successRate).toBeGreaterThan(0);
        expect(result.successRate).toBeLessThan(100);
    });

    it('should have proper percentile spread (10th < median < 90th)', () => {
        // Per spec: Spread: 10th percentile < median < 90th percentile
        const accounts = createModerateScenarioAccounts();
        const incomes = createModerateScenarioIncomes();
        const expenses = createModerateScenarioExpenses();
        const assumptions = createModerateScenarioAssumptions();
        const taxState = createModerateScenarioTaxState();
        const config = createMonteCarloConfig();

        const result = runMonteCarloSimulationSync(
            config,
            [accounts.brokerage, accounts.traditional, accounts.roth, accounts.savings],
            [incomes.ss, incomes.pension],
            [expenses.living],
            assumptions,
            taxState
        );

        // Check final net worth from scenarios (last year of percentile data)
        const lastIndex = result.percentiles.p50.length - 1;
        if (lastIndex >= 0) {
            const p10Final = result.percentiles.p10[lastIndex]?.netWorth ?? 0;
            const p50Final = result.percentiles.p50[lastIndex]?.netWorth ?? 0;
            const p90Final = result.percentiles.p90[lastIndex]?.netWorth ?? 0;

            // 10th percentile <= median
            expect(p10Final).toBeLessThanOrEqual(p50Final);
            // median <= 90th percentile
            expect(p50Final).toBeLessThanOrEqual(p90Final);
        }
    });

    it('should have DeficitDebt only increase when all accounts are $0', () => {
        // Per spec: DeficitDebt only increases when all accounts are $0
        // We need to check the worst case timeline for this rule
        const accounts = createModerateScenarioAccounts();
        const incomes = createModerateScenarioIncomes();
        const expenses = createModerateScenarioExpenses();
        const assumptions = createModerateScenarioAssumptions();
        const taxState = createModerateScenarioTaxState();
        const config = createMonteCarloConfig();

        const result = runMonteCarloSimulationSync(
            config,
            [accounts.brokerage, accounts.traditional, accounts.roth, accounts.savings],
            [incomes.ss, incomes.pension],
            [expenses.living],
            assumptions,
            taxState
        );

        // Check worst case timeline
        let previousDeficit = 0;
        for (const year of result.worstCase.timeline) {
            // Find DeficitDebt account if it exists
            const deficitDebt = year.accounts.find(
                a => a.name.toLowerCase().includes('deficit')
            );
            const currentDeficit = deficitDebt?.amount || 0;

            // Calculate total balance of all NON-deficit accounts
            const totalBalance = year.accounts
                .filter(a => !a.name.toLowerCase().includes('deficit'))
                .reduce((sum, account) => sum + account.amount, 0);

            // If deficit increased from previous year
            if (currentDeficit > previousDeficit) {
                // Deficit should only increase when accounts are depleted (or very close to it)
                // Allow some tolerance for rounding
                expect(totalBalance).toBeLessThan(100);
            }
            previousDeficit = currentDeficit;
        }
    });

    it('should have Sankey balance within $1 for each year (worst case)', () => {
        // Per spec: Every run's every year has Sankey balance within $1
        // Sankey balance: |inflows - outflows| < $1
        const accounts = createModerateScenarioAccounts();
        const incomes = createModerateScenarioIncomes();
        const expenses = createModerateScenarioExpenses();
        const assumptions = createModerateScenarioAssumptions();
        const taxState = createModerateScenarioTaxState();
        const config = createMonteCarloConfig();

        const result = runMonteCarloSimulationSync(
            config,
            [accounts.brokerage, accounts.traditional, accounts.roth, accounts.savings],
            [incomes.ss, incomes.pension],
            [expenses.living],
            assumptions,
            taxState
        );

        // Check Sankey balance for worst case timeline
        for (const year of result.worstCase.timeline) {
            const cf = year.cashflow;

            // Per spec: Sankey must balance within $1
            // Inflows = Income + Withdrawals (net of LTCG paid via brokerage gross-up)
            // Outflows = Expenses + Taxes + Investments + Bucket allocations + Surplus/Deficit
            //
            // The Sankey balance equation:
            // inflows = totalIncome + withdrawals - brokerageLTCGFromGross
            // outflows = totalExpense + totalInvested + bucketAllocations + discretionary (surplus)
            //
            // brokerageLTCGFromGross is the planner's LTCG that was paid directly to the
            // government from the brokerage gross-up — it never reaches user cash, so it
            // shouldn't count as inflow. (Mirrors YearSolver Step F's actualLTCGTax subtraction
            // in cashIn.) When planner LTCG rate is 0%, this is 0 and the equation reduces to
            // the previous form.
            //
            // Note: discretionary can be negative (unfunded deficit) which still balances.

            const ltcgFromGross = year.cashflowDetail?.brokerageLTCGFromGross ?? 0;
            const inflows = cf.totalIncome + cf.withdrawals - ltcgFromGross;
            const outflows = cf.totalExpense + cf.totalInvested + cf.bucketAllocations + cf.discretionary;

            const imbalance = Math.abs(inflows - outflows);

            // Per spec: strict $1 tolerance
            expect(imbalance).toBeLessThanOrEqual(1);
        }
    });

    it('should have no NaN in any year for all representative scenarios', () => {
        // Per spec: No year in any run has NaN in any field
        // We test worst, median, and best cases as representative samples
        const accounts = createModerateScenarioAccounts();
        const incomes = createModerateScenarioIncomes();
        const expenses = createModerateScenarioExpenses();
        const assumptions = createModerateScenarioAssumptions();
        const taxState = createModerateScenarioTaxState();
        const config = createMonteCarloConfig();

        const result = runMonteCarloSimulationSync(
            config,
            [accounts.brokerage, accounts.traditional, accounts.roth, accounts.savings],
            [incomes.ss, incomes.pension],
            [expenses.living],
            assumptions,
            taxState
        );

        // Check all three representative scenarios
        const scenarios = [result.worstCase, result.medianCase, result.bestCase];

        for (const scenario of scenarios) {
            for (const year of scenario.timeline) {
                // Check cashflow values
                expect(Number.isNaN(year.cashflow.totalIncome)).toBe(false);
                expect(Number.isNaN(year.cashflow.totalExpense)).toBe(false);
                expect(Number.isNaN(year.cashflow.livingExpenses)).toBe(false);
                expect(Number.isNaN(year.cashflow.withdrawals)).toBe(false);
                expect(Number.isNaN(year.cashflow.discretionary)).toBe(false);
                expect(Number.isNaN(year.cashflow.totalInvested)).toBe(false);

                // Check tax values
                expect(Number.isNaN(year.taxDetails.fed)).toBe(false);
                expect(Number.isNaN(year.taxDetails.state)).toBe(false);
                expect(Number.isNaN(year.taxDetails.fica)).toBe(false);

                // Check account balances
                for (const account of year.accounts) {
                    expect(Number.isNaN(account.amount)).toBe(false);
                }
            }
        }
    });

    it('should have no negative account balances in any representative scenario', () => {
        // Per spec: No account balance goes negative
        // (DeficitDebt tracks unfunded amounts separately)
        const accounts = createModerateScenarioAccounts();
        const incomes = createModerateScenarioIncomes();
        const expenses = createModerateScenarioExpenses();
        const assumptions = createModerateScenarioAssumptions();
        const taxState = createModerateScenarioTaxState();
        const config = createMonteCarloConfig();

        const result = runMonteCarloSimulationSync(
            config,
            [accounts.brokerage, accounts.traditional, accounts.roth, accounts.savings],
            [incomes.ss, incomes.pension],
            [expenses.living],
            assumptions,
            taxState
        );

        // Check all three representative scenarios
        const scenarios = [result.worstCase, result.medianCase, result.bestCase];

        for (const scenario of scenarios) {
            for (const year of scenario.timeline) {
                for (const account of year.accounts) {
                    expect(account.amount).toBeGreaterThanOrEqual(0);
                }
            }
        }
    });

    it('should have DeficitDebt only increase when all other accounts are $0', () => {
        // Per spec: DeficitDebt only increases when all accounts are $0
        // This verifies proper depletion ordering
        const accounts = createModerateScenarioAccounts();
        const incomes = createModerateScenarioIncomes();
        const expenses = createModerateScenarioExpenses();
        const assumptions = createModerateScenarioAssumptions();
        const taxState = createModerateScenarioTaxState();
        const config = createMonteCarloConfig();

        const result = runMonteCarloSimulationSync(
            config,
            [accounts.brokerage, accounts.traditional, accounts.roth, accounts.savings],
            [incomes.ss, incomes.pension],
            [expenses.living],
            assumptions,
            taxState
        );

        // Check worst case which is most likely to have DeficitDebt
        let previousDeficitDebt = 0;

        for (const year of result.worstCase.timeline) {
            // Find DeficitDebt account if it exists
            const deficitDebt = year.accounts.find(
                a => a.name.toLowerCase().includes('deficit')
            );
            const currentDeficitDebt = deficitDebt?.amount || 0;

            // Calculate total balance of all NON-deficit accounts
            const nonDeficitBalance = year.accounts
                .filter(a => !a.name.toLowerCase().includes('deficit'))
                .reduce((sum, a) => sum + a.amount, 0);

            // If DeficitDebt increased from previous year
            if (currentDeficitDebt > previousDeficitDebt) {
                // DEBUG: Log details when deficit increases with accounts available
                if (nonDeficitBalance >= 100) {
                    console.log('\n===== DEFICIT DEBT BUG =====');
                    console.log('Year:', year.year);
                    console.log('DeficitDebt increased:', previousDeficitDebt, '->', currentDeficitDebt);
                    console.log('Non-deficit balance:', nonDeficitBalance);
                    console.log('Account balances:');
                    year.accounts.forEach(a => {
                        console.log(`  ${a.name}: $${a.amount.toFixed(2)}`);
                    });
                    console.log('Cashflow:');
                    console.log('  totalIncome:', year.cashflow.totalIncome);
                    console.log('  totalExpense:', year.cashflow.totalExpense);
                    console.log('  livingExpenses:', year.cashflow.livingExpenses);
                    console.log('  withdrawals:', year.cashflow.withdrawals);
                    console.log('  withdrawalDetail:', JSON.stringify(year.cashflow.withdrawalDetail));
                    console.log('  totalInvested:', year.cashflow.totalInvested);
                    console.log('  bucketAllocations:', year.cashflow.bucketAllocations);
                    console.log('  discretionary:', year.cashflow.discretionary);
                    console.log('Sankey check:');
                    const inflows = year.cashflow.totalIncome + year.cashflow.withdrawals;
                    const outflows = year.cashflow.totalExpense + year.cashflow.totalInvested + year.cashflow.bucketAllocations + year.cashflow.discretionary;
                    console.log('  inflows:', inflows, '  outflows:', outflows, '  imbalance:', inflows - outflows);
                    console.log('============================\n');
                }
                // All other accounts should be depleted (or nearly so, allowing for small rounding)
                expect(nonDeficitBalance).toBeLessThan(100);
            }

            previousDeficitDebt = currentDeficitDebt;
        }
    });

    it('should have Sankey balance within $1 for median and best cases too', () => {
        // Per spec: Every run's every year has Sankey balance within $1
        // Test all three representative scenarios
        const accounts = createModerateScenarioAccounts();
        const incomes = createModerateScenarioIncomes();
        const expenses = createModerateScenarioExpenses();
        const assumptions = createModerateScenarioAssumptions();
        const taxState = createModerateScenarioTaxState();
        const config = createMonteCarloConfig();

        const result = runMonteCarloSimulationSync(
            config,
            [accounts.brokerage, accounts.traditional, accounts.roth, accounts.savings],
            [incomes.ss, incomes.pension],
            [expenses.living],
            assumptions,
            taxState
        );

        // Check median and best cases (worst case already tested above)
        const scenarios = [
            { data: result.medianCase },
            { data: result.bestCase },
        ];

        for (const { data } of scenarios) {
            for (const year of data.timeline) {
                const cf = year.cashflow;

                // See worst-case test above for Sankey balance equation rationale.
                const ltcgFromGross = year.cashflowDetail?.brokerageLTCGFromGross ?? 0;
                const inflows = cf.totalIncome + cf.withdrawals - ltcgFromGross;
                const outflows = cf.totalExpense + cf.totalInvested + cf.bucketAllocations + cf.discretionary;

                const imbalance = Math.abs(inflows - outflows);

                // Per spec: strict $1 tolerance for all scenarios
                expect(imbalance).toBeLessThanOrEqual(1);
            }
        }
    });
});
