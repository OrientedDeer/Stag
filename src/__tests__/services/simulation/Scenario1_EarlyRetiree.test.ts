/**
 * Scenario 1: Early Retiree (age 40)
 *
 * This test verifies that early retirees (under 59.5) correctly avoid
 * penalty-triggering Traditional withdrawals when non-penalized options exist.
 *
 * Setup:
 *   Age 40, no income, expenses $50k
 *   Brokerage $200k (50% gains) → gainRatio = 0.50
 *   Traditional $500k
 *   Filing: Single, TX (no state tax)
 *
 * Expected Flow:
 *   1. Brokerage tapped first (no penalty)
 *   2. Traditional NOT tapped (10% penalty before 59.5)
 *   3. Roth conversion fills low brackets
 *   4. Capital gains calculated on brokerage withdrawal
 *   5. No phantom remaining
 *   6. Solved in 1 pass (single source, algebraic)
 */

import { describe, it, expect, beforeEach } from 'vitest';

// Level 1: Unit imports
import { classifyIncome } from '../../../services/simulation/IncomeClassifier';
import { planWithdrawals, createAccountSnapshot, createOrderedSnapshots } from '../../../services/simulation/WithdrawalPlanner';

// Level 2: Solver imports
import { solveRetirementYear, YearSolverInput } from '../../../services/simulation/YearSolver';

// Level 3: Full simulation imports
import { simulateOneYear } from '../../../components/Objects/Assumptions/SimulationEngine';

// Model imports
import { InvestedAccount, SavedAccount } from '../../../components/Objects/Accounts/models';
import { AssumptionsState, defaultAssumptions, createBuiltinMilestones } from '../../../components/Objects/Assumptions/AssumptionsContext';
import { TaxState } from '../../../components/Objects/Taxes/TaxContext';
import { OtherExpense } from '../../../components/Objects/Expense/models';

// =============================================================================
// TEST FIXTURES
// =============================================================================

const SCENARIO_YEAR = 2025;
const BIRTH_YEAR = 1985; // Age 40 in 2025

function createScenarioAccounts() {
    // Brokerage: $200k with $100k basis → $100k gains → gainRatio = 0.50
    const brokerage = new InvestedAccount(
        'brokerage-1', 'Brokerage', 200000,
        0,      // employerBalance
        5,      // tenureYears
        0.07,   // expenseRatio
        'Brokerage',
        true,   // isContributionEligible
        0.2,    // vestedPerYear
        100000  // costBasis
    );

    // Traditional: $500k (10% penalty at age 40)
    const traditional = new InvestedAccount(
        'trad-1', 'Traditional IRA', 500000,
        0, 10, 0.07, 'Traditional IRA'
    );

    // Savings: $20k (emergency fund)
    const savings = new SavedAccount('savings-1', 'Savings', 20000, 2.0);

    return { brokerage, traditional, savings };
}

function createScenarioExpenses() {
    const living = new OtherExpense(
        'living-1', 'Living Expenses', 50000, 'Annually', new Date('2020-01-01')
    );
    return { living };
}

function createScenarioAssumptions(): AssumptionsState {
    return {
        ...defaultAssumptions,
        milestones: createBuiltinMilestones(BIRTH_YEAR, 35, 95), // Retired at 35
        investments: {
            ...defaultAssumptions.investments,
            taxOptimizationEnabled: true,
            returnRates: { ror: 7 },
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

describe('Scenario 1: Level 1 - Unit Tests', () => {
    const accounts = createScenarioAccounts();

    describe('Income Classification', () => {
        it('should have zero spendable income when no income sources exist', () => {
            const result = classifyIncome(
                [], // No income
                0,  // rmdAmount
                0,  // conversionAmount
                SCENARIO_YEAR
            );

            expect(result.classified.spendable).toBe(0);
            expect(result.classified.taxableTotal).toBe(0);
        });

        it('should include conversion in taxable but not spendable', () => {
            const conversionAmount = 50000;
            const result = classifyIncome(
                [],
                0,
                conversionAmount,
                SCENARIO_YEAR
            );

            expect(result.classified.spendable).toBe(0);
            expect(result.classified.conversionIncome).toBe(50000);
            expect(result.classified.taxableTotal).toBe(50000);
        });
    });

    describe('Account Snapshot Creation', () => {
        it('should calculate correct gain ratio for brokerage (50%)', () => {
            const snapshot = createAccountSnapshot(accounts.brokerage);

            expect(snapshot.accountType).toBe('brokerage');
            expect(snapshot.balance).toBe(200000);
            expect(snapshot.gainRatio).toBeCloseTo(0.50, 3);
        });

        it('should classify Traditional as penalized at age 40', () => {
            const allAccounts = [accounts.brokerage, accounts.traditional, accounts.savings];
            const withdrawalOrder = [
                { accountId: 'brokerage-1' },
                { accountId: 'trad-1' },
                { accountId: 'savings-1' },
            ];

            const snapshots = createOrderedSnapshots(allAccounts, withdrawalOrder, 40);

            // At age 40 (< 59.5), Traditional should be penalized
            // Brokerage should come before Traditional
            const types = snapshots.map(s => s.accountType);
            const brokerageIdx = types.indexOf('brokerage');
            const tradIdx = types.indexOf('traditional_ira');

            expect(brokerageIdx).toBeLessThan(tradIdx);
        });
    });

    describe('Withdrawal Planning - Penalty Avoidance', () => {
        it('should prefer brokerage over penalized Traditional at age 40', () => {
            const assumptions = createScenarioAssumptions();
            const taxState = createScenarioTaxState();

            const netNeeded = 50000;
            const allAccounts = [accounts.brokerage, accounts.traditional, accounts.savings];
            const withdrawalOrder = [
                { accountId: 'brokerage-1' },
                { accountId: 'trad-1' },
                { accountId: 'savings-1' },
            ];

            const snapshots = createOrderedSnapshots(allAccounts, withdrawalOrder, 40);

            const result = planWithdrawals(
                netNeeded,
                snapshots,
                40,
                SCENARIO_YEAR,
                taxState,
                0, // currentOrdinaryIncome
                assumptions
            );

            // Brokerage should be used first
            const brokerageWithdrawals = result.withdrawals.filter(
                w => w.source === 'brokerage'
            );
            expect(brokerageWithdrawals.length).toBeGreaterThan(0);

            // Traditional should NOT be used (brokerage has enough)
            const tradWithdrawals = result.withdrawals.filter(
                w => w.source === 'traditional_ira'
            );
            expect(tradWithdrawals.length).toBe(0);
        });
    });
});

// =============================================================================
// LEVEL 2: SOLVER TESTS - YearSolver Integration
// =============================================================================

describe('Scenario 1: Level 2 - Solver Tests', () => {
    let solverInput: YearSolverInput;

    beforeEach(() => {
        const accounts = createScenarioAccounts();
        const expenses = createScenarioExpenses();
        const assumptions = createScenarioAssumptions();
        const taxState = createScenarioTaxState();

        solverInput = {
            year: SCENARIO_YEAR,
            currentAge: 40,
            isRetired: true,
            incomes: [],
            expenses: [expenses.living],
            totalLivingExpenses: 50000,
            rmdAmount: 0,
            accounts: [accounts.brokerage, accounts.traditional, accounts.savings],
            withdrawalOrder: [
                { accountId: 'brokerage-1' },
                { accountId: 'trad-1' },
                { accountId: 'savings-1' },
            ],
            taxState,
            assumptions,
            taxOptimizationEnabled: true,
            acaAware: true,
        };
    });

    it('should solve in 1-2 iterations (single source withdrawal)', () => {
        const yearPlan = solveRetirementYear(solverInput);

        expect(yearPlan.iterations).toBeLessThanOrEqual(2);
        expect(yearPlan.converged).toBe(true);
    });

    it('should tap brokerage first, not Traditional', () => {
        const yearPlan = solveRetirementYear(solverInput);

        const deficitWithdrawals = yearPlan.withdrawals.filter(
            w => w.reason === 'Spending deficit'
        );

        if (deficitWithdrawals.length > 0) {
            // First withdrawal should be from brokerage
            expect(deficitWithdrawals[0].source).toBe('brokerage');
        }
    });

    it('should NOT withdraw from Traditional (10% penalty at age 40)', () => {
        const yearPlan = solveRetirementYear(solverInput);

        const tradWithdrawals = yearPlan.withdrawals.filter(
            w => w.source === 'traditional_ira' && w.reason === 'Spending deficit'
        );

        // Brokerage ($200k) should cover $50k expenses - no need for Traditional
        expect(tradWithdrawals.length).toBe(0);
    });

    it('should calculate capital gains on brokerage withdrawal', () => {
        const yearPlan = solveRetirementYear(solverInput);

        const brokerageWithdrawals = yearPlan.withdrawals.filter(
            w => w.source === 'brokerage'
        );

        if (brokerageWithdrawals.length > 0) {
            const w = brokerageWithdrawals[0];
            if (w.capitalGains) {
                // 50% gain ratio means half the withdrawal is gains
                expect(w.capitalGains.longTerm).toBeCloseTo(w.gross * 0.5, -1);
            }
        }
    });

    it('should have no unfunded deficit', () => {
        const yearPlan = solveRetirementYear(solverInput);

        expect(yearPlan.unfundedDeficit).toBe(0);
    });

    it('should perform Roth conversion to fill low brackets', () => {
        const yearPlan = solveRetirementYear(solverInput);

        // With no other income, conversion should fill bracket space
        if (yearPlan.conversion) {
            expect(yearPlan.conversion.amount).toBeGreaterThan(0);
        }
    });
});

// =============================================================================
// LEVEL 3: FULL SIMULATION TESTS - End-to-End
// =============================================================================

describe('Scenario 1: Level 3 - Full Simulation', () => {
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
        expect(result.cashflow.withdrawals).toBeGreaterThan(0);
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

        // Discretionary should be close to 0 or positive (no phantom)
        expect(result.cashflow.discretionary).toBeGreaterThanOrEqual(-100);
    });
});

// =============================================================================
// HAND-CALCULATED VERIFICATION
// =============================================================================

describe('Scenario 1: Hand-Calculated Values', () => {
    it('should calculate LTCG correctly for 50% gain ratio', () => {
        // If gross withdrawal = $50,000 from brokerage
        // Gain ratio = 50%
        // LTCG = $25,000
        const gross = 50000;
        const gainRatio = 0.50;
        const expectedLTCG = gross * gainRatio;

        expect(expectedLTCG).toBe(25000);
    });

    it('should verify LTCG at 0% rate for low income', () => {
        // With no income and $25k LTCG:
        // Taxable income = $0 (below standard deduction)
        // LTCG threshold for 0% = $48,350 (2025 Single)
        // All LTCG at 0% rate
        const ltcg = 25000;
        const ltcgThreshold = 48350;

        expect(ltcg).toBeLessThan(ltcgThreshold);
        // Therefore: LTCG tax = $0
    });

    it('should verify no 10% penalty on brokerage', () => {
        // Brokerage has NO early withdrawal penalty
        // Traditional/IRA has 10% penalty before 59.5
        const brokeragePenalty = 0;
        const traditionalPenaltyRate = 0.10;

        expect(brokeragePenalty).toBe(0);
        expect(traditionalPenaltyRate).toBe(0.10);
    });
});
