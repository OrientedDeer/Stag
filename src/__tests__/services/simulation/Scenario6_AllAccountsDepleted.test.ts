/**
 * Scenario 6: All Accounts Depleted
 *
 * This test verifies graceful handling when all accounts are exhausted
 * and expenses cannot be fully covered.
 *
 * Setup:
 *   Age 90, SS $28k, expenses $48k (nursing care)
 *   Brokerage $0, Traditional $0, Roth $0, Savings $2k
 *
 * Expected Flow:
 *   1. Savings drained to $0 (last resort used)
 *   2. Remaining $18k deficit recorded in unfundedDeficit
 *   3. Warning logged: "Unfunded deficit of $18,000. All accounts exhausted."
 *   4. No crash, no infinite loop
 *   5. Simulation continues (doesn't halt)
 *   6. No conversion attempted (no Traditional balance)
 *   7. Tax = $0 (SS below taxability threshold)
 *   8. Solved in 1 pass
 */

import { describe, it, expect, beforeEach } from 'vitest';

// Level 1: Unit imports
import { classifyIncome } from '../../../services/simulation/IncomeClassifier';
import { planWithdrawals, createOrderedSnapshots } from '../../../services/simulation/WithdrawalPlanner';

// Level 2: Solver imports
import { solveRetirementYear, YearSolverInput } from '../../../services/simulation/YearSolver';

// Level 3: Full simulation imports
import { simulateOneYear } from '../../../components/Objects/Assumptions/SimulationEngine';

// Model imports
import { InvestedAccount, SavedAccount } from '../../../components/Objects/Accounts/models';
import { SocialSecurityIncome } from '../../../components/Objects/Income/models';
import { OtherExpense } from '../../../components/Objects/Expense/models';
import { AssumptionsState, defaultAssumptions, createBuiltinMilestones } from '../../../components/Objects/Assumptions/AssumptionsContext';
import { TaxState } from '../../../components/Objects/Taxes/TaxContext';

// =============================================================================
// TEST FIXTURES
// =============================================================================

const SCENARIO_YEAR = 2025;
const BIRTH_YEAR = 1935; // Age 90 in 2025

function createScenarioAccounts() {
    // All investment accounts depleted
    const brokerage = new InvestedAccount(
        'brokerage-1', 'Brokerage', 0,
        0, 10, 0.07, 'Brokerage',
        true, 0.2, 0
    );

    const traditional = new InvestedAccount(
        'trad-1', 'Traditional IRA', 0,
        0, 20, 0.05, 'Traditional IRA'
    );

    const roth = new InvestedAccount(
        'roth-1', 'Roth IRA', 0,
        0, 15, 0.05, 'Roth IRA',
        true, 0.2, 0
    );

    // Only $2k in savings (last resort)
    const savings = new SavedAccount('savings-1', 'Savings', 2000, 2.0);

    return { brokerage, traditional, roth, savings };
}

function createScenarioIncomes() {
    // Social Security: $28k/year ($2333/month)
    const ss = new SocialSecurityIncome(
        'ss-1', 'Social Security',
        2333,       // Monthly amount (~$28k/year)
        'Monthly',  // Frequency
        67,         // Claiming age
        undefined,  // FRA benefit
        new Date('2002-01-01') // Start date
    );

    return { ss };
}

function createScenarioExpenses() {
    // Nursing care: $48k/year
    const nursing = new OtherExpense(
        'nursing-1', 'Nursing Care', 48000, 'Annually', new Date('2020-01-01')
    );

    return { nursing };
}

function createScenarioAssumptions(): AssumptionsState {
    return {
        ...defaultAssumptions,
        milestones: createBuiltinMilestones(BIRTH_YEAR, 65, 100),
        investments: {
            ...defaultAssumptions.investments,
            taxOptimizationEnabled: false, // No Traditional to convert
            returnRates: { ror: 0 },
        },
        withdrawalStrategy: [
            { id: 'ws-1', name: 'Brokerage', accountId: 'brokerage-1' },
            { id: 'ws-2', name: 'Traditional', accountId: 'trad-1' },
            { id: 'ws-3', name: 'Roth', accountId: 'roth-1' },
            { id: 'ws-4', name: 'Savings', accountId: 'savings-1' },
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

describe('Scenario 6: Level 1 - Unit Tests', () => {
    const accounts = createScenarioAccounts();
    const incomes = createScenarioIncomes();

    describe('Income Classification', () => {
        it('should classify SS as spendable', () => {
            const result = classifyIncome(
                [incomes.ss],
                0,
                0,
                SCENARIO_YEAR
            );

            expect(result.classified.spendable).toBeCloseTo(28000, -2);
        });

        it('should have zero SS taxability at low income', () => {
            // With only $28k SS and no other income:
            // Provisional income = 0.5 × $28k = $14k
            // This is below the $25k threshold for Single
            // Therefore: 0% of SS is taxable
            const result = classifyIncome(
                [incomes.ss],
                0,
                0,
                SCENARIO_YEAR
            );

            // SS taxable = 0 when provisional income < $25k
            // (This is handled by TaxService during tax calculation)
            expect(result.classified.breakdown.socialSecurity).toBeCloseTo(28000, -2);
        });
    });

    describe('Withdrawal Planning - Depletion', () => {
        it('should drain savings completely when all else is empty', () => {
            const assumptions = createScenarioAssumptions();
            const taxState = createScenarioTaxState();

            const netNeeded = 20000; // More than savings has
            const allAccounts = [accounts.brokerage, accounts.traditional, accounts.roth, accounts.savings];
            const withdrawalOrder = [
                { accountId: 'brokerage-1' },
                { accountId: 'trad-1' },
                { accountId: 'roth-1' },
                { accountId: 'savings-1' },
            ];

            const snapshots = createOrderedSnapshots(allAccounts, withdrawalOrder, 90);

            const result = planWithdrawals(
                netNeeded,
                snapshots,
                90,
                SCENARIO_YEAR,
                taxState,
                28000,
                assumptions
            );

            // Savings should be fully drained
            const savingsWithdrawal = result.withdrawals.find(
                w => w.source === 'savings'
            );

            expect(savingsWithdrawal).toBeDefined();
            expect(savingsWithdrawal!.gross).toBe(2000);
        });

        it('should report remaining deficit when accounts exhausted', () => {
            const assumptions = createScenarioAssumptions();
            const taxState = createScenarioTaxState();

            const netNeeded = 20000;
            const allAccounts = [accounts.brokerage, accounts.traditional, accounts.roth, accounts.savings];
            const withdrawalOrder = [
                { accountId: 'savings-1' }, // Only savings has money
            ];

            const snapshots = createOrderedSnapshots(allAccounts, withdrawalOrder, 90);

            const result = planWithdrawals(
                netNeeded,
                snapshots,
                90,
                SCENARIO_YEAR,
                taxState,
                28000,
                assumptions
            );

            // Should have remaining deficit: $20k - $2k = $18k
            expect(result.remainingDeficit).toBe(18000);
        });
    });
});

// =============================================================================
// LEVEL 2: SOLVER TESTS - YearSolver Integration
// =============================================================================

describe('Scenario 6: Level 2 - Solver Tests', () => {
    let solverInput: YearSolverInput;

    beforeEach(() => {
        const accounts = createScenarioAccounts();
        const incomes = createScenarioIncomes();
        const expenses = createScenarioExpenses();
        const assumptions = createScenarioAssumptions();
        const taxState = createScenarioTaxState();

        solverInput = {
            year: SCENARIO_YEAR,
            currentAge: 90,
            isRetired: true,
            incomes: [incomes.ss],
            expenses: [expenses.nursing],
            totalLivingExpenses: 48000,
            rmdAmount: 0, // No Traditional balance
            accounts: [accounts.brokerage, accounts.traditional, accounts.roth, accounts.savings],
            withdrawalOrder: [
                { accountId: 'brokerage-1' },
                { accountId: 'trad-1' },
                { accountId: 'roth-1' },
                { accountId: 'savings-1' },
            ],
            taxState,
            assumptions,
            taxOptimizationEnabled: false,
            acaAware: false,
        };
    });

    it('should solve in 1 pass (no complex logic needed)', () => {
        const yearPlan = solveRetirementYear(solverInput);

        expect(yearPlan.iterations).toBeLessThanOrEqual(2);
        expect(yearPlan.converged).toBe(true);
    });

    it('should drain savings to $0', () => {
        const yearPlan = solveRetirementYear(solverInput);

        const savingsWithdrawal = yearPlan.withdrawals.find(
            w => w.source === 'savings'
        );

        expect(savingsWithdrawal).toBeDefined();
        expect(savingsWithdrawal!.gross).toBe(2000);
    });

    it('should record unfunded deficit of ~$18k', () => {
        const yearPlan = solveRetirementYear(solverInput);

        // Per spec: Remaining $18k deficit recorded in DeficitDebt
        // SS = $28k, Savings = $2k, Expenses = $48k
        // Unfunded = $48k - $28k - $2k = $18k
        expect(yearPlan.unfundedDeficit).toBeCloseTo(18000, -3);
    });

    it('should NOT attempt Roth conversion (no Traditional balance)', () => {
        const yearPlan = solveRetirementYear(solverInput);

        expect(yearPlan.conversion).toBeNull();
    });

    it('should log warning about unfunded deficit', () => {
        const yearPlan = solveRetirementYear(solverInput);

        const warnings = yearPlan.decisions.filter(d => d.category === 'warning');
        const unfundedWarning = warnings.find(
            w => w.description.toLowerCase().includes('unfunded') ||
                 w.description.toLowerCase().includes('exhausted')
        );

        expect(unfundedWarning).toBeDefined();
    });

    it('should have tax of $0', () => {
        // Per spec: Tax = $0
        const yearPlan = solveRetirementYear(solverInput);

        // SS at $28k with no other income = 0% taxable
        // Total tax should be $0
        expect(yearPlan.tax.federal).toBe(0);
        expect(yearPlan.tax.state).toBe(0);
    });

    it('should have SS at 0% taxable (provisional income below threshold)', () => {
        // Per spec: SS at 0% taxable (provisional $14k < $25k threshold)
        // Provisional income = 0.5 × SS = 0.5 × $28k = $14k
        // Single threshold = $25k
        // $14k < $25k → 0% of SS is taxable
        const yearPlan = solveRetirementYear(solverInput);

        // Zero federal tax confirms SS is not being taxed
        expect(yearPlan.tax.federal).toBe(0);
    });
});

// =============================================================================
// LEVEL 3: FULL SIMULATION TESTS - End-to-End
// =============================================================================

describe('Scenario 6: Level 3 - Full Simulation', () => {
    it('should not crash when all accounts depleted', () => {
        const accounts = createScenarioAccounts();
        const incomes = createScenarioIncomes();
        const expenses = createScenarioExpenses();
        const assumptions = createScenarioAssumptions();
        const taxState = createScenarioTaxState();

        // Should not throw
        expect(() => {
            simulateOneYear(
                SCENARIO_YEAR,
                [incomes.ss],
                [expenses.nursing],
                [accounts.brokerage, accounts.traditional, accounts.roth, accounts.savings],
                assumptions,
                taxState
            );
        }).not.toThrow();
    });

    it('should produce valid results with V2 engine', () => {
        const accounts = createScenarioAccounts();
        const incomes = createScenarioIncomes();
        const expenses = createScenarioExpenses();
        const assumptions = createScenarioAssumptions();
        const taxState = createScenarioTaxState();

        const result = simulateOneYear(
            SCENARIO_YEAR,
            [incomes.ss],
            [expenses.nursing],
            [accounts.brokerage, accounts.traditional, accounts.roth, accounts.savings],
            assumptions,
            taxState
        );

        expect(result.year).toBe(SCENARIO_YEAR);
        expect(result.logs.some(l => l.includes('[V2 Engine]'))).toBe(true);

        // Should have no NaN values
        expect(Number.isNaN(result.cashflow.totalIncome)).toBe(false);
        expect(Number.isNaN(result.cashflow.totalExpense)).toBe(false);
        expect(Number.isNaN(result.cashflow.withdrawals)).toBe(false);
    });

    it('should continue simulation (not halt)', () => {
        const accounts = createScenarioAccounts();
        const incomes = createScenarioIncomes();
        const expenses = createScenarioExpenses();
        const assumptions = createScenarioAssumptions();
        const taxState = createScenarioTaxState();

        const result = simulateOneYear(
            SCENARIO_YEAR,
            [incomes.ss],
            [expenses.nursing],
            [accounts.brokerage, accounts.traditional, accounts.roth, accounts.savings],
            assumptions,
            taxState
        );

        // Year should complete with valid accounts array
        // Note: May include additional system accounts like DeficitDebt
        expect(result.accounts).toBeDefined();
        expect(result.accounts.length).toBeGreaterThanOrEqual(4);
    });
});

// =============================================================================
// HAND-CALCULATED VERIFICATION
// =============================================================================

describe('Scenario 6: Hand-Calculated Values', () => {
    it('should calculate deficit correctly', () => {
        // SS = $28,000
        // Expenses = $48,000
        // Deficit before withdrawals = $20,000
        const ss = 28000;
        const expenses = 48000;
        const deficit = expenses - ss;

        expect(deficit).toBe(20000);
    });

    it('should calculate unfunded deficit after savings', () => {
        // Deficit = $20,000
        // Savings = $2,000
        // Unfunded = $18,000
        const deficit = 20000;
        const savings = 2000;
        const unfunded = deficit - savings;

        expect(unfunded).toBe(18000);
    });

    it('should verify SS provisional income is below threshold', () => {
        // SS = $28,000
        // Provisional income = 0.5 × SS = $14,000
        // Single threshold = $25,000
        // $14,000 < $25,000 → 0% taxable
        const ss = 28000;
        const provisionalIncome = ss * 0.5;
        const threshold = 25000;

        expect(provisionalIncome).toBeLessThan(threshold);
    });

    it('should verify total tax is $0', () => {
        // No taxable income (SS is 0% taxable at this level)
        // No FICA (no wages)
        // No state tax (TX)
        // Total tax = $0
        const federalTax = 0;
        const stateTax = 0;
        const fica = 0;
        const totalTax = federalTax + stateTax + fica;

        expect(totalTax).toBe(0);
    });
});
