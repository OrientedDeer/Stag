/**
 * Scenario 11: LTCG Bracket Stacking - Sankey Balance
 *
 * This scenario specifically tests the fix for a bug introduced in commit 9b5d647
 * ("Fix LTCG double-counting"): when the withdrawal planner uses 0% LTCG rate but
 * the authoritative calculateTotalFederalTax returns non-zero LTCG via bracket
 * stacking, the old code incorrectly subtracted auth LTCG from totalCashAvailable,
 * creating a false negative totalInvested equal to -authLTCGTax.
 *
 * Setup:
 *   Age 40, FIRE retiree
 *   Passive income: $40k/year (below 15% LTCG threshold of ~$47k → planner uses 0%)
 *   Brokerage: $500k balance, $100k costBasis (80% unrealized gains)
 *   Expenses: $100k/year
 *   Single, Texas, 2025
 *
 * Bug trigger:
 *   allOrdinaryIncome ≈ $40k < $47,025 LTCG threshold → planner uses 0% rate
 *   Brokerage withdrawal ≈ $68k → LTCG ≈ $54k stacks into 15% bracket
 *   Auth LTCG tax ≈ $4,800 (bracket stacking in calculateTotalFederalTax)
 *   Old code: totalCashAvailable -= $4,800 → totalInvested = -$4,800 (bug!)
 *   Fixed code: totalCashAvailable unchanged → totalInvested ≈ $0
 *
 * Expected:
 *   1. Auth LTCG > $1,000 (bracket stacking confirmed)
 *   2. cashflow.totalInvested >= -$10 (no false deficit)
 *   3. Sankey balanced within $10
 */

import { describe, it, expect, beforeEach } from 'vitest';

import { classifyIncome } from '../../../services/simulation/IncomeClassifier';
import { planWithdrawals, createOrderedSnapshots } from '../../../services/simulation/WithdrawalPlanner';
import { solveRetirementYear, YearSolverInput } from '../../../services/simulation/YearSolver';
import { simulateOneYear } from '../../../components/Objects/Assumptions/SimulationEngine';

import { InvestedAccount } from '../../../components/Objects/Accounts/models';
import { PassiveIncome } from '../../../components/Objects/Income/models';
import { OtherExpense } from '../../../components/Objects/Expense/models';
import { AssumptionsState, defaultAssumptions, createBuiltinMilestones } from '../../../components/Objects/Assumptions/AssumptionsContext';
import { TaxState } from '../../../components/Objects/Taxes/TaxContext';

// =============================================================================
// TEST FIXTURES
// =============================================================================

const SCENARIO_YEAR = 2025;
const BIRTH_YEAR = 1985; // Age 40 in 2025

function createScenarioAccounts() {
    // Brokerage: $500k balance, $100k costBasis → 80% unrealized gains
    const brokerage = new InvestedAccount(
        'brokerage-1', 'Brokerage', 500000,
        0,          // employerBalance
        0,          // tenureYears
        0.001,      // expenseRatio (near 0 for test predictability)
        'Brokerage',
        false,      // isContributionEligible (retired, no more contributions)
        0.0,        // vestedPerYear
        100000,     // costBasis → gainRatio = (500k - 100k) / 500k = 0.8
    );
    return { brokerage };
}

function createScenarioIncomes() {
    // Passive income: $40k/year. Below the ~$47k LTCG 0% threshold → planner uses 0% rate.
    const pension = new PassiveIncome(
        'pension-1', 'Pension Income',
        40000,
        'Annually',
        'No',       // not earned income
        'Other',
        new Date('2020-01-01'),
    );
    return { pension };
}

function createScenarioExpenses() {
    const living = new OtherExpense(
        'living-1', 'Living Expenses', 100000, 'Annually', new Date('2020-01-01')
    );
    return { living };
}

function createScenarioAssumptions(): AssumptionsState {
    return {
        ...defaultAssumptions,
        milestones: createBuiltinMilestones(BIRTH_YEAR, 40, 100), // FIRE at 40
        investments: {
            ...defaultAssumptions.investments,
            taxOptimizationEnabled: false,
            acaAware: false, // Disable ACA cliff so we exercise the LTCG path, not ACA cap
            returnRates: { ror: 0 }, // Zero growth for predictability
        },
        withdrawalStrategy: [
            { id: 'ws-1', name: 'Brokerage', accountId: 'brokerage-1' },
        ],
    };
}

function createScenarioTaxState(): TaxState {
    return {
        filingStatus: 'Single',
        stateResidency: 'Texas',
        deductionMethod: 'Standard',
        fedOverride: null,
        ficaOverride: null,
        stateOverride: null,
        year: SCENARIO_YEAR,
    };
}

// =============================================================================
// LEVEL 1: UNIT TESTS - Withdrawal Planner Rate Verification
// =============================================================================

describe('Scenario 11: Level 1 - Unit Tests', () => {
    const accounts = createScenarioAccounts();
    const incomes = createScenarioIncomes();
    const taxState = createScenarioTaxState();
    const assumptions = createScenarioAssumptions();

    describe('Income Classification', () => {
        it('should classify passive income as spendable at $40k', () => {
            const result = classifyIncome(
                [incomes.pension],
                0,
                0,
                SCENARIO_YEAR
            );
            expect(result.classified.spendable).toBeCloseTo(40000, -2);
        });
    });

    describe('Withdrawal Planner - 0% LTCG Rate', () => {
        it('should NOT gross up brokerage withdrawal when ordinary income is below LTCG threshold', () => {
            // With allOrdinaryIncome ≈ $40k < $47,025 (2025 threshold), the planner uses 0% LTCG rate.
            // At 0% rate: gross = deficit (no gross-up), w.tax = 0.
            const withdrawalOrder = [{ accountId: 'brokerage-1' }];
            const snapshots = createOrderedSnapshots(
                [accounts.brokerage], withdrawalOrder, 40
            );

            const netNeeded = 50000; // Arbitrary deficit to test gross-up behavior
            const ordinaryIncome = 40000; // Below LTCG threshold → planner uses 0%

            const result = planWithdrawals(
                netNeeded,
                snapshots,
                40,
                SCENARIO_YEAR,
                taxState,
                ordinaryIncome,
                assumptions,
                'Spending deficit'
            );

            const brokerageWithdrawal = result.withdrawals.find(
                w => w.accountId === 'brokerage-1'
            );

            expect(brokerageWithdrawal).toBeDefined();

            // At 0% LTCG rate: gross ≈ netNeeded (no gross-up)
            expect(brokerageWithdrawal!.gross).toBeCloseTo(netNeeded, -1);

            // Planner's LTCG tax estimate = 0 (0% rate)
            expect(brokerageWithdrawal!.tax).toBe(0);
        });
    });
});

// =============================================================================
// LEVEL 2: SOLVER TESTS - YearSolver Auth LTCG
// =============================================================================

describe('Scenario 11: Level 2 - Solver Tests', () => {
    let solverInput: YearSolverInput;

    beforeEach(() => {
        const accounts = createScenarioAccounts();
        const incomes = createScenarioIncomes();
        const expenses = createScenarioExpenses();
        const assumptions = createScenarioAssumptions();
        const taxState = createScenarioTaxState();

        solverInput = {
            year: SCENARIO_YEAR,
            currentAge: 40,
            isRetired: true,
            incomes: [incomes.pension],
            expenses: [expenses.living],
            totalLivingExpenses: 100000,
            rmdAmount: 0,
            accounts: [accounts.brokerage],
            withdrawalOrder: [{ accountId: 'brokerage-1' }],
            taxState,
            assumptions,
            taxOptimizationEnabled: false,
            acaAware: false,
        };
    });

    it('should produce non-zero auth LTCG via bracket stacking', () => {
        // The planner uses 0% rate (ordinaryIncome $40k < $47,025 threshold),
        // but calculateTotalFederalTax stacks ~$54k LTCG on top of $25k taxable ordinary,
        // pushing $32k of LTCG into the 15% bracket → auth LTCG ≈ $4,800.
        const yearPlan = solveRetirementYear(solverInput);

        expect(yearPlan.tax.capitalGainsLT).toBeGreaterThan(1000);
    });

    it('should converge and have no unfunded deficit', () => {
        const yearPlan = solveRetirementYear(solverInput);

        expect(yearPlan.converged).toBe(true);
        expect(yearPlan.unfundedDeficit).toBeLessThan(1);
    });

    it('should have non-negative surplus (planner 0% rate, no over-gross-up)', () => {
        // When planner uses 0% rate, gross = deficit (no gross-up).
        // The solver's Step F cashIn = spendable + deficit - 0 = cashOut.
        // surplus should be 0 or tiny rounding amount.
        const yearPlan = solveRetirementYear(solverInput);

        expect(yearPlan.surplus).toBeGreaterThanOrEqual(0);
        expect(yearPlan.surplus).toBeLessThan(10); // No phantom surplus
    });

    it('should withdraw from brokerage to cover deficit', () => {
        const yearPlan = solveRetirementYear(solverInput);

        const brokerageWithdrawal = yearPlan.withdrawals.find(
            w => w.accountId === 'brokerage-1'
        );

        expect(brokerageWithdrawal).toBeDefined();
        // Withdrawal covers expenses + tax - income ≈ $100k + $7k - $40k = $67k
        expect(brokerageWithdrawal!.gross).toBeGreaterThan(50000);
    });
});

// =============================================================================
// LEVEL 3: FULL SIMULATION TESTS - Regression for LTCG Bug
// =============================================================================

describe('Scenario 11: Level 3 - Full Simulation (LTCG Bug Regression)', () => {
    it('should use V2 engine', () => {
        const accounts = createScenarioAccounts();
        const incomes = createScenarioIncomes();
        const expenses = createScenarioExpenses();
        const assumptions = createScenarioAssumptions();
        const taxState = createScenarioTaxState();

        const result = simulateOneYear(
            SCENARIO_YEAR,
            [incomes.pension],
            [expenses.living],
            [accounts.brokerage],
            assumptions,
            taxState
        );

        expect(result.logs.some(l => l.includes('[V2 Engine]'))).toBe(true);
    });

    it('should confirm auth LTCG is non-zero (bracket stacking triggered)', () => {
        // This assertion confirms the test is actually exercising the bug scenario.
        // If this fails, the test setup is wrong (not hitting the bracket stacking case).
        const accounts = createScenarioAccounts();
        const incomes = createScenarioIncomes();
        const expenses = createScenarioExpenses();
        const assumptions = createScenarioAssumptions();
        const taxState = createScenarioTaxState();

        const result = simulateOneYear(
            SCENARIO_YEAR,
            [incomes.pension],
            [expenses.living],
            [accounts.brokerage],
            assumptions,
            taxState
        );

        // Auth LTCG > $1,000 confirms bracket stacking is in effect
        expect(result.taxDetails.capitalGains).toBeGreaterThan(1000);
    });

    it('should NOT produce negative totalInvested due to LTCG bracket stacking (regression)', () => {
        // This is the core regression test for the bug fixed in this PR.
        //
        // Before the fix (commit 9b5d647): SimulationEngine subtracted
        //   yearPlan.tax.capitalGainsLT (auth LTCG ≈ $4,800) from totalCashAvailable,
        //   making totalInvested = -$4,800 (negative!).
        //
        // After the fix: totalCashAvailable = spendable + gross_withdrawals (no subtraction).
        //   totalInvested ≈ $0 (no phantom deficit).
        const accounts = createScenarioAccounts();
        const incomes = createScenarioIncomes();
        const expenses = createScenarioExpenses();
        const assumptions = createScenarioAssumptions();
        const taxState = createScenarioTaxState();

        const result = simulateOneYear(
            SCENARIO_YEAR,
            [incomes.pension],
            [expenses.living],
            [accounts.brokerage],
            assumptions,
            taxState
        );

        // Allow $10 tolerance for convergence rounding, but NOT negative thousands
        expect(result.cashflow.totalInvested).toBeGreaterThanOrEqual(-10);
    });

    it('should have balanced Sankey (inflows ≈ outflows)', () => {
        const accounts = createScenarioAccounts();
        const incomes = createScenarioIncomes();
        const expenses = createScenarioExpenses();
        const assumptions = createScenarioAssumptions();
        const taxState = createScenarioTaxState();

        const result = simulateOneYear(
            SCENARIO_YEAR,
            [incomes.pension],
            [expenses.living],
            [accounts.brokerage],
            assumptions,
            taxState
        );

        // Sankey: inflows = income + withdrawals; outflows = expense + invested + buckets
        const inflows = result.cashflow.totalIncome + result.cashflow.withdrawals;
        const outflows = result.cashflow.totalExpense + result.cashflow.totalInvested + result.cashflow.bucketAllocations;

        expect(Math.abs(inflows - outflows)).toBeLessThanOrEqual(10);
    });
});

// =============================================================================
// HAND-CALCULATED VERIFICATION
// =============================================================================

describe('Scenario 11: Hand-Calculated Values', () => {
    it('should verify ordinary income is below LTCG 0% threshold', () => {
        // Ordinary income = $40k < $47,025 (2025 Single LTCG 0% threshold)
        // This means the planner uses 0% LTCG rate (no gross-up)
        const ordinaryIncome = 40000;
        const ltcgThreshold2025Single = 47025;

        expect(ordinaryIncome).toBeLessThan(ltcgThreshold2025Single);
    });

    it('should verify LTCG bracket stacking math', () => {
        // Ordinary taxable: $40k - $15k std deduction = $25k
        // LTCG from withdrawal ≈ $54k
        // 0% bracket up to $47,025: room = $47,025 - $25,000 = $22,025
        // 15% bracket: $54,000 - $22,025 = $31,975 at 15% = $4,796
        const ordinaryTaxable = 40000 - 15000; // $25k
        const ltcgThreshold = 47025;
        const ltcgAmount = 54000;            // Approximate from brokerage withdrawal

        const ltcgAt0pct = Math.max(0, ltcgThreshold - ordinaryTaxable);
        const ltcgAt15pct = Math.max(0, ltcgAmount - ltcgAt0pct);
        const authLtcgTax = ltcgAt15pct * 0.15;

        expect(ltcgAt15pct).toBeGreaterThan(0);
        expect(authLtcgTax).toBeGreaterThan(3000);
    });
});
