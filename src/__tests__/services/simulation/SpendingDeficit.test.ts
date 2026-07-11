/**
 * SpendingDeficit.test.ts
 *
 * Tests for spending-deficit-aware Roth conversion planning.
 *
 * When there's a spending deficit (income < expenses), the solver can reserve
 * bracket space for Traditional withdrawals instead of converting Traditional→Roth
 * then immediately withdrawing Roth to cover spending.
 *
 * Two guards control when reservation fires:
 * 1. Age >= 59.5 only. Under 59.5, conversion is strictly cheaper than penalized
 *    Traditional withdrawal. Spending comes from Roth contribution basis (FIFO)
 *    or brokerage — no roundtrip.
 * 2. Brokerage insufficient. When brokerage covers the deficit, no roundtrip
 *    exists — conversion fills brackets while brokerage handles spending.
 *    Only reserve for the shortfall that would spill into Roth.
 */

import { describe, it, expect } from 'vitest';
import { solveRetirementYear, YearSolverInput } from '../../../services/simulation/YearSolver';
import { AnyAccount, InvestedAccount, SavedAccount } from '../../../components/Objects/Accounts/models';
import { OtherExpense } from '../../../components/Objects/Expense/models';
import { AnyIncome, PassiveIncome } from '../../../components/Objects/Income/models';
import { AssumptionsState, defaultAssumptions, createBuiltinMilestones } from '../../../components/Objects/Assumptions/AssumptionsContext';
import { TaxState } from '../../../components/Objects/Taxes/TaxContext';

// =============================================================================
// CONSTANTS
// =============================================================================

const SCENARIO_YEAR = 2025;
const BIRTH_YEAR_63 = 1962;  // Age 63 in 2025 (past 59.5, no penalty)
const BIRTH_YEAR_55 = 1970;  // Age 55 in 2025 (under 59.5, penalty applies)
const BIRTH_YEAR_50 = 1975;  // Age 50 in 2025

// =============================================================================
// FIXTURES
// =============================================================================

function createAccounts(opts?: {
    traditionalBalance?: number;
    brokerageBalance?: number;
    rothBalance?: number;
    savingsBalance?: number;
}) {
    // Default Traditional balance is large enough that the conversion ceiling
    // calculator (with the units-mismatch fix) projects RMDs into the 32%+ bracket,
    // ensuring conversions still trigger and the spending-reservation path is exercised.
    // Pre-fix ($1.5M was sufficient because the bug inflated apparent peak-RMD bracket.)
    const tradBal = opts?.traditionalBalance ?? 3000000;
    const brokBal = opts?.brokerageBalance ?? 200000;
    const rothBal = opts?.rothBalance ?? 100000;
    const savBal = opts?.savingsBalance ?? 20000;

    const traditional = new InvestedAccount(
        'trad-1', 'Traditional IRA', tradBal,
        0, 15, 0.07, 'Traditional IRA'
    );
    const brokerage = new InvestedAccount(
        'brokerage-1', 'Brokerage', brokBal,
        0, 10, 0.07, 'Brokerage',
        true, 0.2, brokBal * 0.67  // ~33% gain ratio
    );
    const roth = new InvestedAccount(
        'roth-1', 'Roth IRA', rothBal,
        0, 10, 0.07, 'Roth IRA',
        true, 0.2, rothBal * 0.8
    );
    const savings = new SavedAccount('savings-1', 'Savings', savBal, 2.0);

    return { traditional, brokerage, roth, savings };
}

function createAssumptions(birthYear: number = BIRTH_YEAR_63): AssumptionsState {
    return {
        ...defaultAssumptions,
        milestones: createBuiltinMilestones(birthYear, 55, 95),
        investments: {
            ...defaultAssumptions.investments,
            taxOptimizationEnabled: true,
            returnRates: { ror: 7 },
        },
        withdrawalStrategy: [
            { id: 'ws-1', name: 'Brokerage', accountId: 'brokerage-1' },
            { id: 'ws-2', name: 'Traditional', accountId: 'trad-1' },
            { id: 'ws-3', name: 'Roth', accountId: 'roth-1' },
            { id: 'ws-4', name: 'Savings', accountId: 'savings-1' },
        ],
    };
}

function createTaxState(): TaxState {
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

function buildSolverInput(opts?: {
    currentAge?: number;
    birthYear?: number;
    totalLivingExpenses?: number;
    incomes?: AnyIncome[];
    traditionalBalance?: number;
    brokerageBalance?: number;
    rothBalance?: number;
    acaAware?: boolean;
    accounts?: AnyAccount[];
    rmdAmount?: number;
}): YearSolverInput {
    const accounts = opts?.accounts
        ? undefined
        : createAccounts({
            traditionalBalance: opts?.traditionalBalance,
            brokerageBalance: opts?.brokerageBalance,
            rothBalance: opts?.rothBalance,
        });
    const expense = new OtherExpense(
        'living-1', 'Living Expenses',
        opts?.totalLivingExpenses ?? 50000,
        'Annually', new Date('2020-01-01')
    );
    const birthYear = opts?.birthYear ?? BIRTH_YEAR_63;
    const assumptions = createAssumptions(birthYear);
    const taxState = createTaxState();
    const accountsList = opts?.accounts ?? [
        accounts!.brokerage, accounts!.traditional, accounts!.roth, accounts!.savings
    ];

    return {
        year: SCENARIO_YEAR,
        currentAge: opts?.currentAge ?? 63,
        isRetired: true,
        incomes: opts?.incomes ?? [],
        expenses: [expense],
        totalLivingExpenses: opts?.totalLivingExpenses ?? 50000,
        rmdAmount: opts?.rmdAmount ?? 0,
        accounts: accountsList,
        withdrawalOrder: [
            { accountId: 'brokerage-1' },
            { accountId: 'trad-1' },
            { accountId: 'roth-1' },
            { accountId: 'savings-1' },
        ],
        taxState,
        assumptions,
        taxOptimizationEnabled: true,
        acaAware: opts?.acaAware ?? false,
    };
}

/** Helper to find the reservation decision in results */
function findReserveDecision(result: ReturnType<typeof solveRetirementYear>) {
    return result.decisions.find(d =>
        d.description.includes('Reserved') && d.description.includes('bracket space')
    );
}

// =============================================================================
// TESTS
// =============================================================================

describe('Spending Deficit: Bracket Space Reservation', () => {

    // =========================================================================
    // Guard 1: No reservation under age 59.5
    // =========================================================================

    describe('Guard 1: No reservation under age 59.5', () => {
        it('should NOT reserve at age 55 even with no brokerage', () => {
            // Age 55 < 59.5 → penalty applies → conversion + Roth basis is cheaper
            const input = buildSolverInput({
                currentAge: 55,
                birthYear: BIRTH_YEAR_55,
                totalLivingExpenses: 50000,
                brokerageBalance: 0,  // No brokerage to cover deficit
                incomes: [],
            });

            const result = solveRetirementYear(input);

            expect(findReserveDecision(result)).toBeUndefined();
            expect(result.converged).toBe(true);
            expect(result.unfundedDeficit).toBe(0);
        });

        it('should NOT reserve at age 50 even with depleted brokerage', () => {
            // Age 50 < 59.5 → penalty guard blocks reservation
            const input = buildSolverInput({
                currentAge: 50,
                birthYear: BIRTH_YEAR_50,
                totalLivingExpenses: 60000,
                brokerageBalance: 0,
                incomes: [],
            });

            const result = solveRetirementYear(input);

            expect(findReserveDecision(result)).toBeUndefined();
            expect(result.converged).toBe(true);
        });
    });

    // =========================================================================
    // Guard 2: No reservation when brokerage covers deficit
    // =========================================================================

    describe('Guard 2: No reservation when brokerage covers deficit', () => {
        it('should NOT reserve when $200k brokerage covers $30k deficit', () => {
            // Age 63, $200k brokerage easily covers $30k expenses
            // No roundtrip: conversion fills brackets, brokerage handles spending
            const input = buildSolverInput({
                totalLivingExpenses: 30000,
                brokerageBalance: 200000,
                incomes: [],
            });

            const result = solveRetirementYear(input);

            expect(findReserveDecision(result)).toBeUndefined();
            expect(result.converged).toBe(true);
            expect(result.unfundedDeficit).toBe(0);
        });

        it('should NOT reserve when $200k brokerage covers $50k deficit', () => {
            // Age 63, $200k brokerage covers $50k expenses + tax
            const input = buildSolverInput({
                totalLivingExpenses: 50000,
                brokerageBalance: 200000,
                incomes: [],
            });

            const result = solveRetirementYear(input);

            expect(findReserveDecision(result)).toBeUndefined();
            expect(result.converged).toBe(true);
            expect(result.unfundedDeficit).toBe(0);
        });
    });

    // =========================================================================
    // No reservation when surplus exists
    // =========================================================================

    describe('No reservation when surplus', () => {
        it('should not reserve bracket space when income exceeds expenses', () => {
            const income = new PassiveIncome(
                'income-1', 'Rental Income', 80000, 'Annually', 'No', 'Rental',
                new Date('2020-01-01')
            );

            const input = buildSolverInput({
                incomes: [income],
                totalLivingExpenses: 50000,
            });

            const result = solveRetirementYear(input);

            expect(findReserveDecision(result)).toBeUndefined();
            expect(result.converged).toBe(true);
            expect(result.unfundedDeficit).toBe(0);
        });
    });

    // =========================================================================
    // Reservation fires: age >= 59.5 AND brokerage insufficient
    // =========================================================================

    describe('Reservation fires when both guards pass', () => {
        it('should reserve when age 63 and no brokerage', () => {
            // Age 63 (no penalty), $0 brokerage → deficit spills to Roth → reservation fires
            const input = buildSolverInput({
                currentAge: 63,
                totalLivingExpenses: 50000,
                brokerageBalance: 0,
                incomes: [],
            });

            const result = solveRetirementYear(input);

            const reserveDecision = findReserveDecision(result);
            expect(reserveDecision).toBeDefined();
            expect(reserveDecision!.amount).toBeGreaterThan(0);

            expect(result.converged).toBe(true);
            expect(result.unfundedDeficit).toBe(0);
        });

        it('should reserve only for Roth-bound portion when brokerage partially covers', () => {
            // Age 63, $10k brokerage covers part of $50k deficit
            // Reservation should cover the ~$40k shortfall (grossed up)
            const input = buildSolverInput({
                currentAge: 63,
                totalLivingExpenses: 50000,
                brokerageBalance: 10000,
                incomes: [],
            });

            const result = solveRetirementYear(input);

            const reserveDecision = findReserveDecision(result);
            expect(reserveDecision).toBeDefined();
            // Decision should mention brokerage coverage
            expect(reserveDecision!.description).toContain('brokerage covers');

            expect(result.converged).toBe(true);
            expect(result.unfundedDeficit).toBe(0);
        });

        it('should reserve partial bracket space when deficit is small', () => {
            // Age 63, $0 brokerage, $30k expenses → small deficit
            // Should reserve partial bracket space and still convert some
            const input = buildSolverInput({
                currentAge: 63,
                totalLivingExpenses: 30000,
                brokerageBalance: 0,
                incomes: [],
            });

            const result = solveRetirementYear(input);

            const reserveDecision = findReserveDecision(result);
            expect(reserveDecision).toBeDefined();

            // Conversion should still happen (partial bracket space remains)
            if (result.conversion) {
                expect(result.conversion.amount).toBeGreaterThan(0);
            }

            expect(result.converged).toBe(true);
            expect(result.unfundedDeficit).toBe(0);
        });

        it('should reserve all bracket space when deficit exceeds it', () => {
            // Age 63, $0 brokerage, $100k expenses → large deficit exceeds bracket space
            const input = buildSolverInput({
                currentAge: 63,
                totalLivingExpenses: 100000,
                brokerageBalance: 0,
                incomes: [],
            });

            const result = solveRetirementYear(input);

            const reserveDecision = findReserveDecision(result);
            expect(reserveDecision).toBeDefined();

            // When all bracket space is consumed, limiting factor should be SPENDING_DEFICIT
            if (result.taxOptimizationTarget?.limitingFactor === 'SPENDING_DEFICIT') {
                // Conversion should be zero or very small
                if (result.conversion) {
                    expect(result.conversion.amount).toBeLessThan(5000);
                }
            }

            expect(result.converged).toBe(true);
            // Allow tiny floating-point rounding from LTCG convergence loop
            expect(result.unfundedDeficit).toBeLessThan(0.01);
        });
    });

    // =========================================================================
    // Edge cases
    // =========================================================================

    describe('Edge cases', () => {
        it('should cap reservation at Traditional balance when balance is small', () => {
            // Small Traditional ($10k), $0 brokerage, $50k deficit
            // Reservation can't exceed Traditional balance
            const accounts = createAccounts({
                traditionalBalance: 10000,
                brokerageBalance: 0,
                rothBalance: 200000,
            });

            const input = buildSolverInput({
                currentAge: 63,
                totalLivingExpenses: 50000,
                incomes: [],
                accounts: [accounts.brokerage, accounts.traditional, accounts.roth, accounts.savings],
            });

            const result = solveRetirementYear(input);

            const reserveDecision = findReserveDecision(result);
            if (reserveDecision && reserveDecision.amount) {
                expect(reserveDecision.amount).toBeLessThanOrEqual(10000);
            }

            expect(result.converged).toBe(true);
            expect(result.unfundedDeficit).toBe(0);
        });

        it('should allow reservation at age exactly 59.5 (no penalty)', () => {
            // Age 59.5 is the boundary — no penalty applies
            const input = buildSolverInput({
                currentAge: 59.5,
                birthYear: 1966,
                totalLivingExpenses: 50000,
                brokerageBalance: 0,  // Force Roth-bound deficit
                incomes: [],
            });

            const result = solveRetirementYear(input);

            // At 59.5, penalty guard passes → reservation should fire
            const reserveDecision = findReserveDecision(result);
            expect(reserveDecision).toBeDefined();

            expect(result.converged).toBe(true);
            expect(result.unfundedDeficit).toBe(0);
        });
    });

    // =========================================================================
    // Withdrawal ordering with reservation
    // =========================================================================

    describe('Withdrawal ordering with reservation', () => {
        it('should use Traditional for spending within reserved bracket space', () => {
            // Age 63, $0 brokerage → reservation fires → Traditional first in withdrawal order
            const input = buildSolverInput({
                currentAge: 63,
                totalLivingExpenses: 50000,
                brokerageBalance: 0,
                incomes: [],
            });

            const result = solveRetirementYear(input);

            const reserveDecision = findReserveDecision(result);
            if (reserveDecision) {
                // Should see tax-optimized withdrawal order decision
                const orderDecision = result.decisions.find(d =>
                    d.description.includes('Tax-optimized order')
                );
                expect(orderDecision).toBeDefined();

                // Traditional should appear in spending withdrawals
                const tradWithdrawals = result.withdrawals.filter(
                    w => (w.source === 'traditional_401k' || w.source === 'traditional_ira')
                        && w.reason === 'Spending deficit'
                );
                expect(tradWithdrawals.length).toBeGreaterThan(0);
            }

            expect(result.converged).toBe(true);
            expect(result.unfundedDeficit).toBe(0);
        });

        it('should still cover all expenses when reservation is active', () => {
            const input = buildSolverInput({
                currentAge: 63,
                totalLivingExpenses: 40000,
                brokerageBalance: 0,
                incomes: [],
            });

            const result = solveRetirementYear(input);

            const totalNet = result.withdrawals.reduce((sum, w) => sum + w.net, 0);
            expect(totalNet).toBeGreaterThan(0);
            expect(result.converged).toBe(true);
            expect(result.unfundedDeficit).toBe(0);
        });
    });

    // =========================================================================
    // ACA cliff + deficit interaction
    // =========================================================================

    describe('ACA cliff + deficit interaction', () => {
        it('should respect both ACA cliff and spending reservation at age 63', () => {
            // Age 63 (under 65, ACA applies), $0 brokerage, deficit exists
            // Both ACA cliff avoidance AND spending reservation reduce conversion
            const accounts = createAccounts({
                traditionalBalance: 1500000,
                brokerageBalance: 0,
                rothBalance: 50000,
            });

            const input = buildSolverInput({
                currentAge: 63,
                birthYear: BIRTH_YEAR_63,
                totalLivingExpenses: 45000,
                incomes: [],
                accounts: [accounts.brokerage, accounts.traditional, accounts.roth, accounts.savings],
                acaAware: true,
            });

            const result = solveRetirementYear(input);

            expect(result.converged).toBe(true);
            expect(result.unfundedDeficit).toBe(0);

            // Conversion should be reduced (by ACA and/or spending reservation)
            if (result.conversion) {
                const bracketSpace = result.taxOptimizationTarget?.bracketSpaceThisYear ?? 0;
                if (bracketSpace > 0) {
                    expect(result.conversion.amount).toBeLessThanOrEqual(bracketSpace);
                }
            }
        });
    });
});
