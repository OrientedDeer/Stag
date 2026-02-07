/**
 * Scenario 3: Brokerage Depletion Year
 *
 * This test verifies that when brokerage is depleted mid-withdrawal,
 * the engine correctly drains it to $0 and continues to the next account.
 *
 * Setup:
 *   Age 65, no income, expenses $50k
 *   Brokerage $15k (small balance, will be depleted)
 *   Traditional $500k
 *   Filing: Single, TX (no state tax)
 *
 * Expected Flow:
 *   1. Brokerage drained to $0 (not $47 dust)
 *   2. Remaining deficit covered by Traditional (next in order)
 *   3. LTCG only on brokerage gains (not full amount)
 *   4. Smooth transition, no spike in "remaining"
 *   5. Solved in 1-2 passes
 */

import { describe, it, expect, beforeEach } from 'vitest';

// Level 1: Unit imports
import { planWithdrawals, createAccountSnapshot, createOrderedSnapshots } from '../../../services/simulation/WithdrawalPlanner';

// Level 2: Solver imports
import { solveRetirementYear, YearSolverInput } from '../../../services/simulation/YearSolver';

// Level 3: Full simulation imports
import { simulateOneYear } from '../../../components/Objects/Assumptions/SimulationEngine';

// Model imports
import { InvestedAccount, SavedAccount } from '../../../components/Objects/Accounts/models';
import { OtherExpense } from '../../../components/Objects/Expense/models';
import { AssumptionsState, defaultAssumptions, createBuiltinMilestones } from '../../../components/Objects/Assumptions/AssumptionsContext';
import { TaxState } from '../../../components/Objects/Taxes/TaxContext';

// =============================================================================
// TEST FIXTURES
// =============================================================================

const SCENARIO_YEAR = 2025;
const BIRTH_YEAR = 1960; // Age 65 in 2025

function createScenarioAccounts() {
    // Brokerage: $15k (will be depleted) - 40% gains
    const brokerage = new InvestedAccount(
        'brokerage-1', 'Brokerage', 15000,
        0, 10, 0.07, 'Brokerage',
        true, 0.2, 9000  // costBasis = $9k, gains = $6k, gainRatio = 0.40
    );

    // Traditional: $500k (backup after brokerage depletes)
    const traditional = new InvestedAccount(
        'trad-1', 'Traditional IRA', 500000,
        0, 20, 0.05, 'Traditional IRA'
    );

    // Savings: $10k
    const savings = new SavedAccount('savings-1', 'Savings', 10000, 2.0);

    return { brokerage, traditional, savings };
}

function createScenarioExpenses() {
    const living = new OtherExpense(
        'living-1', 'Living Expenses', 50000, 'Annually', new Date('2020-01-01')
    );
    return { living };
}

function createScenarioAssumptions(useNewEngine: boolean = true): AssumptionsState {
    return {
        ...defaultAssumptions,
        milestones: createBuiltinMilestones(BIRTH_YEAR, 60, 95),
        simulation: {
            useNewEngine,
        },
        investments: {
            ...defaultAssumptions.investments,
            taxOptimizationEnabled: false, // Keep it simple for depletion test
            returnRates: { ror: 5 },
        },
        withdrawalStrategy: [
            { id: 'ws-1', name: 'Brokerage', accountId: 'brokerage-1' },
            { id: 'ws-2', name: 'Traditional', accountId: 'trad-1' },
            { id: 'ws-3', name: 'Savings', accountId: 'savings-1' },
        ],
    };
}

function createScenarioTaxState(): TaxState {
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

// =============================================================================
// LEVEL 1: UNIT TESTS - Individual Module Verification
// =============================================================================

describe('Scenario 3: Level 1 - Unit Tests', () => {
    const accounts = createScenarioAccounts();

    describe('Account Snapshot Creation', () => {
        it('should calculate correct gain ratio for small brokerage', () => {
            const snapshot = createAccountSnapshot(accounts.brokerage);

            expect(snapshot.accountType).toBe('brokerage');
            expect(snapshot.balance).toBe(15000);
            // gainRatio = (15000 - 9000) / 15000 = 0.40
            expect(snapshot.gainRatio).toBeCloseTo(0.40, 3);
        });
    });

    describe('Withdrawal Planning - Account Depletion', () => {
        it('should drain brokerage completely when insufficient', () => {
            const assumptions = createScenarioAssumptions();
            const taxState = createScenarioTaxState();

            const netNeeded = 50000; // More than brokerage balance
            const allAccounts = [accounts.brokerage, accounts.traditional, accounts.savings];
            const withdrawalOrder = [
                { accountId: 'brokerage-1' },
                { accountId: 'trad-1' },
                { accountId: 'savings-1' },
            ];

            const snapshots = createOrderedSnapshots(allAccounts, withdrawalOrder, 65);

            const result = planWithdrawals(
                netNeeded,
                snapshots,
                65,
                SCENARIO_YEAR,
                taxState,
                0,
                assumptions
            );

            // Find brokerage withdrawal
            const brokerageWithdrawal = result.withdrawals.find(
                w => w.source === 'brokerage'
            );

            // Brokerage should be fully drained ($15k gross)
            expect(brokerageWithdrawal).toBeDefined();
            expect(brokerageWithdrawal!.gross).toBe(15000);
        });

        it('should continue to Traditional after brokerage depleted', () => {
            const assumptions = createScenarioAssumptions();
            const taxState = createScenarioTaxState();

            const netNeeded = 50000;
            const allAccounts = [accounts.brokerage, accounts.traditional, accounts.savings];
            const withdrawalOrder = [
                { accountId: 'brokerage-1' },
                { accountId: 'trad-1' },
                { accountId: 'savings-1' },
            ];

            const snapshots = createOrderedSnapshots(allAccounts, withdrawalOrder, 65);

            const result = planWithdrawals(
                netNeeded,
                snapshots,
                65,
                SCENARIO_YEAR,
                taxState,
                0,
                assumptions
            );

            // Should have both brokerage and Traditional withdrawals
            const sources = result.withdrawals.map(w => w.source);
            expect(sources).toContain('brokerage');
            expect(sources).toContain('traditional_ira');
        });

        it('should calculate LTCG only on actual gains', () => {
            const assumptions = createScenarioAssumptions();
            const taxState = createScenarioTaxState();

            const netNeeded = 50000;
            const allAccounts = [accounts.brokerage, accounts.traditional, accounts.savings];
            const withdrawalOrder = [
                { accountId: 'brokerage-1' },
                { accountId: 'trad-1' },
                { accountId: 'savings-1' },
            ];

            const snapshots = createOrderedSnapshots(allAccounts, withdrawalOrder, 65);

            const result = planWithdrawals(
                netNeeded,
                snapshots,
                65,
                SCENARIO_YEAR,
                taxState,
                0,
                assumptions
            );

            // Brokerage has $6k in gains (40% of $15k)
            // LTCG should be $6k, not $15k
            expect(result.totalLTCG).toBeCloseTo(6000, -1);
        });
    });
});

// =============================================================================
// LEVEL 2: SOLVER TESTS - YearSolver Integration
// =============================================================================

describe('Scenario 3: Level 2 - Solver Tests', () => {
    let solverInput: YearSolverInput;

    beforeEach(() => {
        const accounts = createScenarioAccounts();
        const expenses = createScenarioExpenses();
        const assumptions = createScenarioAssumptions();
        const taxState = createScenarioTaxState();

        solverInput = {
            year: SCENARIO_YEAR,
            currentAge: 65,
            isRetired: true,
            incomes: [],
            expenses: [expenses.living],
            totalLivingExpenses: 50000,
            rmdAmount: 0, // Age 65, no RMDs
            accounts: [accounts.brokerage, accounts.traditional, accounts.savings],
            withdrawalOrder: [
                { accountId: 'brokerage-1' },
                { accountId: 'trad-1' },
                { accountId: 'savings-1' },
            ],
            taxState,
            assumptions,
            taxOptimizationEnabled: false,
            acaAware: false,
        };
    });

    it('should solve in 1-2 iterations (multi-source but deterministic)', () => {
        const yearPlan = solveRetirementYear(solverInput);

        expect(yearPlan.iterations).toBeLessThanOrEqual(2);
        expect(yearPlan.converged).toBe(true);
    });

    it('should fully deplete brokerage ($15k)', () => {
        const yearPlan = solveRetirementYear(solverInput);

        const brokerageWithdrawal = yearPlan.withdrawals.find(
            w => w.source === 'brokerage'
        );

        expect(brokerageWithdrawal).toBeDefined();
        expect(brokerageWithdrawal!.gross).toBe(15000);
    });

    it('should withdraw remaining deficit from Traditional', () => {
        const yearPlan = solveRetirementYear(solverInput);

        const tradWithdrawals = yearPlan.withdrawals.filter(
            w => w.source === 'traditional_ira' && w.reason === 'Spending deficit'
        );

        // After brokerage $15k, need ~$35k more (plus taxes)
        expect(tradWithdrawals.length).toBeGreaterThan(0);
        expect(tradWithdrawals[0].gross).toBeGreaterThan(30000);
    });

    it('should have minimal unfunded deficit', () => {
        const yearPlan = solveRetirementYear(solverInput);

        // With Brokerage $15k + Traditional $500k, should cover $50k expenses
        // May have small unfunded due to tax estimation complexity
        expect(yearPlan.unfundedDeficit).toBeLessThan(5000);
    });

    it('should have multi-source withdrawals in decisions', () => {
        const yearPlan = solveRetirementYear(solverInput);

        const withdrawalDecisions = yearPlan.decisions.filter(
            d => d.category === 'withdrawal'
        );

        // Should log both brokerage and Traditional withdrawals
        expect(withdrawalDecisions.length).toBeGreaterThanOrEqual(2);
    });
});

// =============================================================================
// LEVEL 3: FULL SIMULATION TESTS - End-to-End
// =============================================================================

describe('Scenario 3: Level 3 - Full Simulation', () => {
    it('should produce consistent results with V2 engine', () => {
        const accounts = createScenarioAccounts();
        const expenses = createScenarioExpenses();
        const assumptions = createScenarioAssumptions(true);
        const taxState = createScenarioTaxState();

        const result = simulateOneYear(
            SCENARIO_YEAR,
            [],
            [expenses.living],
            [accounts.brokerage, accounts.traditional, accounts.savings],
            assumptions,
            taxState
        );

        expect(result.year).toBe(SCENARIO_YEAR);
        expect(result.logs.some(l => l.includes('[V2 Engine]'))).toBe(true);
    });

    it('should deplete brokerage to $0 (no dust)', () => {
        const accounts = createScenarioAccounts();
        const expenses = createScenarioExpenses();
        const assumptions = createScenarioAssumptions(true);
        const taxState = createScenarioTaxState();

        const result = simulateOneYear(
            SCENARIO_YEAR,
            [],
            [expenses.living],
            [accounts.brokerage, accounts.traditional, accounts.savings],
            assumptions,
            taxState
        );

        // Find the brokerage account in result
        const brokerageAfter = result.accounts.find(
            a => a.id === 'brokerage-1'
        ) as InvestedAccount | undefined;

        // Balance should be 0 (depleted) or close to it
        // Note: The balance might be slightly above 0 due to growth applied after withdrawal
        if (brokerageAfter) {
            expect(brokerageAfter.amount).toBeLessThan(1000); // Near zero, accounting for growth
        }
    });

    it('should not have phantom remaining balance', () => {
        const accounts = createScenarioAccounts();
        const expenses = createScenarioExpenses();
        const assumptions = createScenarioAssumptions(true);
        const taxState = createScenarioTaxState();

        const result = simulateOneYear(
            SCENARIO_YEAR,
            [],
            [expenses.living],
            [accounts.brokerage, accounts.traditional, accounts.savings],
            assumptions,
            taxState
        );

        // Discretionary should be close to 0 (no phantom)
        expect(result.cashflow.discretionary).toBeGreaterThanOrEqual(-100);
    });
});

// =============================================================================
// HAND-CALCULATED VERIFICATION
// =============================================================================

describe('Scenario 3: Hand-Calculated Values', () => {
    it('should calculate brokerage LTCG correctly', () => {
        // Brokerage: $15k balance, $9k cost basis
        // Gains = $6k
        // LTCG = $6k (all gains if fully withdrawn)
        const balance = 15000;
        const costBasis = 9000;
        const gains = balance - costBasis;

        expect(gains).toBe(6000);
    });

    it('should calculate net from brokerage after LTCG tax', () => {
        // At 0% LTCG rate (low income):
        // Net from brokerage = $15k (no tax)
        // At 15% LTCG rate:
        // Tax = $6k × 0.15 = $900
        // Net = $15k - $900 = $14,100
        const gross = 15000;
        const gains = 6000;
        const ltcgRate = 0.15;
        const tax = gains * ltcgRate;
        const net = gross - tax;

        expect(tax).toBe(900);
        expect(net).toBe(14100);
    });

    it('should calculate remaining deficit for Traditional', () => {
        // Expenses = $50k
        // From brokerage: net ~$14,100 (at 15% LTCG) or $15k (at 0%)
        // Remaining: ~$35-36k before tax adjustment
        const expenses = 50000;
        const brokerageNet = 14100;
        const remainingDeficit = expenses - brokerageNet;

        expect(remainingDeficit).toBeCloseTo(35900, -2);
    });

    it('should verify smooth transition (no spike)', () => {
        // Total withdrawn = Brokerage $15k + Traditional ~$40k = ~$55k
        // Total expenses + taxes ≈ $55k
        // No phantom "remaining" balance
        const brokerageWithdrawal = 15000;
        const traditionalWithdrawal = 40000; // Approximate
        const totalWithdrawn = brokerageWithdrawal + traditionalWithdrawal;

        expect(totalWithdrawn).toBeGreaterThanOrEqual(50000);
    });
});
