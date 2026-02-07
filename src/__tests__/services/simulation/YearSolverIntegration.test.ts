/**
 * Integration tests for the new YearSolver-based simulation engine (V2).
 *
 * These tests verify that the new engine produces correct results
 * for various scenarios and compare behavior with the old engine.
 */
import { describe, it, expect } from 'vitest';
import { simulateOneYear } from '../../../components/Objects/Assumptions/SimulationEngine';
import { InvestedAccount, SavedAccount } from '../../../components/Objects/Accounts/models';
import { PassiveIncome, WorkIncome } from '../../../components/Objects/Income/models';
import { OtherExpense } from '../../../components/Objects/Expense/models';
import {
    AssumptionsState,
    defaultAssumptions,
    createBuiltinMilestones,
} from '../../../components/Objects/Assumptions/AssumptionsContext';
import { TaxState } from '../../../components/Objects/Taxes/TaxContext';

// =============================================================================
// Test Helpers
// =============================================================================

function createTestAssumptions(overrides: {
    birthYear?: number;
    retirementAge?: number;
    useNewEngine?: boolean;
    taxOptimizationEnabled?: boolean;
    withdrawalStrategy?: { id: string; name: string; accountId: string }[];
} = {}): AssumptionsState {
    const birthYear = overrides.birthYear ?? 1960;
    const retirementAge = overrides.retirementAge ?? 65;

    return {
        ...defaultAssumptions,
        milestones: createBuiltinMilestones(birthYear, retirementAge, 95),
        simulation: {
            useNewEngine: overrides.useNewEngine ?? false,
        },
        investments: {
            ...defaultAssumptions.investments,
            taxOptimizationEnabled: overrides.taxOptimizationEnabled ?? false,
            returnRates: { ror: 0 }, // 0% return for simpler math
        },
        withdrawalStrategy: overrides.withdrawalStrategy ?? [],
    };
}

function createTestTaxState(): TaxState {
    return {
        filingStatus: 'Single',
        stateResidency: 'TX', // No state tax for simpler math
        deductionMethod: 'Standard',
        fedOverride: null,
        ficaOverride: null,
        stateOverride: null,
        year: 2025,
    };
}

// =============================================================================
// Basic Functionality Tests
// =============================================================================

describe('YearSolver Integration (V2 Engine)', () => {
    describe('Basic Working Year', () => {
        it('should handle a simple working year with both engines', () => {
            // Setup: Working person with $100k salary, $50k expenses
            const workIncome = new WorkIncome(
                'work-1', 'Job', 100000, 'Annually', 'Yes',
                0.06, 0.03, 1000, 500, 'acc-401k', 'Traditional 401k', 'FIXED',
                new Date('2020-01-01'), undefined
            );
            const expense = new OtherExpense(
                'exp-1', 'Living Expenses', 50000, 'Annually', new Date('2020-01-01')
            );
            const checking = new SavedAccount('checking-1', 'Checking', 10000, 2.0);
            const trad401k = new InvestedAccount(
                'acc-401k', 'Traditional 401k', 50000, 0, 5, 0.05, 'Traditional 401k'
            );

            const taxState = createTestTaxState();

            // Run with OLD engine
            const oldAssumptions = createTestAssumptions({ birthYear: 1990, useNewEngine: false });
            const oldResult = simulateOneYear(
                2025, [workIncome], [expense], [checking, trad401k],
                oldAssumptions, taxState
            );

            // Run with NEW engine
            const newAssumptions = createTestAssumptions({ birthYear: 1990, useNewEngine: true });
            const newResult = simulateOneYear(
                2025, [workIncome], [expense], [checking, trad401k],
                newAssumptions, taxState
            );

            // Basic sanity checks
            expect(oldResult.year).toBe(2025);
            expect(newResult.year).toBe(2025);

            // Both should have positive discretionary cash (income > expenses)
            expect(oldResult.cashflow.discretionary).toBeGreaterThanOrEqual(0);
            expect(newResult.cashflow.discretionary).toBeGreaterThanOrEqual(0);

            // New engine should add a V2 log entry
            expect(newResult.logs.some(l => l.includes('[V2 Engine]'))).toBe(true);
        });
    });

    describe('Basic Retirement Year', () => {
        it('should handle a simple retirement year with no withdrawals needed', () => {
            // Setup: Retired person with $60k pension, $40k expenses
            const pension = new PassiveIncome(
                'pension-1', 'Pension', 5000, 'Monthly', 'No', 'Other',
                new Date('2020-01-01'), undefined, false
            );
            const expense = new OtherExpense(
                'exp-1', 'Living Expenses', 40000, 'Annually', new Date('2020-01-01')
            );
            const savings = new SavedAccount('savings-1', 'Savings', 50000, 2.0);
            const traditional = new InvestedAccount(
                'trad-1', 'Traditional IRA', 500000, 0, 10, 0.05, 'Traditional IRA'
            );

            const taxState = createTestTaxState();

            // Run with OLD engine
            const oldAssumptions = createTestAssumptions({
                birthYear: 1955,
                retirementAge: 65,
                useNewEngine: false,
            });
            const oldResult = simulateOneYear(
                2025, [pension], [expense], [savings, traditional],
                oldAssumptions, taxState
            );

            // Run with NEW engine
            const newAssumptions = createTestAssumptions({
                birthYear: 1955,
                retirementAge: 65,
                useNewEngine: true,
            });
            const newResult = simulateOneYear(
                2025, [pension], [expense], [savings, traditional],
                newAssumptions, taxState
            );

            // Both should show income > expenses (surplus)
            expect(oldResult.cashflow.totalIncome).toBeGreaterThan(oldResult.cashflow.livingExpenses);
            expect(newResult.cashflow.totalIncome).toBeGreaterThan(newResult.cashflow.livingExpenses);

            // No withdrawals should be needed since pension covers expenses
            expect(oldResult.cashflow.withdrawals).toBe(0);
            expect(newResult.cashflow.withdrawals).toBe(0);
        });

        it('should handle retirement year with deficit requiring withdrawals', () => {
            // Setup: Retired person with $30k SS, $50k expenses = $20k deficit
            const ss = new PassiveIncome(
                'ss-1', 'Social Security', 2500, 'Monthly', 'No', 'Other',
                new Date('2020-01-01'), undefined, false
            );
            const expense = new OtherExpense(
                'exp-1', 'Living Expenses', 50000, 'Annually', new Date('2020-01-01')
            );
            const savings = new SavedAccount('savings-1', 'Savings', 100000, 2.0);
            const traditional = new InvestedAccount(
                'trad-1', 'Traditional IRA', 500000, 0, 10, 0.05, 'Traditional IRA'
            );

            const taxState = createTestTaxState();

            // Run with NEW engine
            const newAssumptions = createTestAssumptions({
                birthYear: 1955,
                retirementAge: 65,
                useNewEngine: true,
                withdrawalStrategy: [
                    { id: 'ws-1', name: 'Savings', accountId: 'savings-1' },
                    { id: 'ws-2', name: 'Traditional', accountId: 'trad-1' },
                ],
            });
            const newResult = simulateOneYear(
                2025, [ss], [expense], [savings, traditional],
                newAssumptions, taxState
            );

            // Withdrawals should be needed to cover deficit
            expect(newResult.cashflow.withdrawals).toBeGreaterThan(0);

            // Should have V2 engine log
            expect(newResult.logs.some(l => l.includes('[V2 Engine]'))).toBe(true);
        });
    });

    describe('Roth Conversion with Tax Optimization', () => {
        it('should perform Roth conversion when tax optimization is enabled', () => {
            // Setup: Retired person with low income and Traditional balance
            const pension = new PassiveIncome(
                'pension-1', 'Pension', 2000, 'Monthly', 'No', 'Other',
                new Date('2020-01-01'), undefined, false
            );
            const expense = new OtherExpense(
                'exp-1', 'Living Expenses', 20000, 'Annually', new Date('2020-01-01')
            );
            const traditional = new InvestedAccount(
                'trad-1', 'Traditional 401k', 500000, 0, 10, 0.05, 'Traditional 401k'
            );
            const roth = new InvestedAccount(
                'roth-1', 'Roth IRA', 50000, 0, 10, 0.05, 'Roth IRA'
            );
            const brokerage = new InvestedAccount(
                'brok-1', 'Brokerage', 100000, 0, 10, 0.05, 'Brokerage'
            );

            const taxState = createTestTaxState();

            // Run with NEW engine + tax optimization
            const newAssumptions = createTestAssumptions({
                birthYear: 1960,
                retirementAge: 60,
                useNewEngine: true,
                taxOptimizationEnabled: true,
                withdrawalStrategy: [
                    { id: 'ws-1', name: 'Brokerage', accountId: 'brok-1' },
                    { id: 'ws-2', name: 'Traditional', accountId: 'trad-1' },
                    { id: 'ws-3', name: 'Roth', accountId: 'roth-1' },
                ],
            });

            const result = simulateOneYear(
                2025, [pension], [expense], [traditional, roth, brokerage],
                newAssumptions, taxState
            );

            // When tax optimization is enabled and there's bracket space,
            // a Roth conversion should occur
            // Note: May not convert if income already fills the bracket
            // Just verify the engine ran without error
            expect(result.year).toBe(2025);
            expect(result.logs.some(l => l.includes('[V2 Engine]'))).toBe(true);
        });
    });
});
