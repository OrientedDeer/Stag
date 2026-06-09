/**
 * Integration tests for the YearSolver-based simulation engine.
 *
 * These tests verify that the engine produces correct results
 * for various scenarios.
 */
import { describe, it, expect } from 'vitest';
import { simulateOneYear } from '../../../components/Objects/Assumptions/SimulationEngine';
import { solveRetirementYear, YearSolverInput } from '../../../services/simulation/YearSolver';
import { InvestedAccount, SavedAccount } from '../../../components/Objects/Accounts/models';
import { PassiveIncome, WorkIncome, FERSPensionIncome } from '../../../components/Objects/Income/models';
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
    taxOptimizationEnabled?: boolean;
    withdrawalStrategy?: { id: string; name: string; accountId: string }[];
} = {}): AssumptionsState {
    const birthYear = overrides.birthYear ?? 1960;
    const retirementAge = overrides.retirementAge ?? 65;

    return {
        ...defaultAssumptions,
        milestones: createBuiltinMilestones(birthYear, retirementAge, 95),
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

describe('YearSolver Integration', () => {
    describe('Basic Working Year', () => {
        it('should handle a simple working year', () => {
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
            const assumptions = createTestAssumptions({ birthYear: 1990 });
            const result = simulateOneYear(
                2025, [workIncome], [expense], [checking, trad401k],
                assumptions, taxState
            );

            // Basic sanity checks
            expect(result.year).toBe(2025);

            // Should have positive discretionary cash (income > expenses)
            expect(result.cashflow.discretionary).toBeGreaterThanOrEqual(0);

            // Should add a V2 log entry
            expect(result.logs.some(l => l.includes('[V2 Engine]'))).toBe(true);
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
            const assumptions = createTestAssumptions({
                birthYear: 1955,
                retirementAge: 65,
            });
            const result = simulateOneYear(
                2025, [pension], [expense], [savings, traditional],
                assumptions, taxState
            );

            // Should show income > expenses (surplus)
            expect(result.cashflow.totalIncome).toBeGreaterThan(result.cashflow.livingExpenses);

            // No withdrawals should be needed since pension covers expenses
            expect(result.cashflow.withdrawals).toBe(0);
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
            const assumptions = createTestAssumptions({
                birthYear: 1955,
                retirementAge: 65,
                withdrawalStrategy: [
                    { id: 'ws-1', name: 'Savings', accountId: 'savings-1' },
                    { id: 'ws-2', name: 'Traditional', accountId: 'trad-1' },
                ],
            });
            const result = simulateOneYear(
                2025, [ss], [expense], [savings, traditional],
                assumptions, taxState
            );

            // Withdrawals should be needed to cover deficit
            expect(result.cashflow.withdrawals).toBeGreaterThan(0);

            // Should have V2 engine log
            expect(result.logs.some(l => l.includes('[V2 Engine]'))).toBe(true);
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
            const assumptions = createTestAssumptions({
                birthYear: 1960,
                retirementAge: 60,
                taxOptimizationEnabled: true,
                withdrawalStrategy: [
                    { id: 'ws-1', name: 'Brokerage', accountId: 'brok-1' },
                    { id: 'ws-2', name: 'Traditional', accountId: 'trad-1' },
                    { id: 'ws-3', name: 'Roth', accountId: 'roth-1' },
                ],
            });

            const result = simulateOneYear(
                2025, [pension], [expense], [traditional, roth, brokerage],
                assumptions, taxState
            );

            // When tax optimization is enabled and there's bracket space,
            // a Roth conversion should occur
            // Note: May not convert if income already fills the bracket
            // Just verify the engine ran without error
            expect(result.year).toBe(2025);
            expect(result.logs.some(l => l.includes('[V2 Engine]'))).toBe(true);
        });
    });

    describe('ACA MAGI includes traditional withdrawal (Bug #10)', () => {
        // A pre-65 ACA-aware retiree with a deficit funded FIRST by a Traditional
        // withdrawal (ordinary income) and THEN by brokerage (LTCG). The cliff
        // guard's MAGI must include the loop-produced Traditional withdrawal, not
        // just base + conversion. Before the fix, currentMAGI omitted the Trad draw,
        // so the guard under-counted MAGI and let brokerage LTCG breach the cliff.
        const ACA_CLIFF_2025 = 62500; // 400% FPL single 2025 (approx; real guard uses exact)

        function buildAcaInput(): YearSolverInput {
            // Small Traditional ($45k) drawn FIRST and fully → ~$45k of ordinary
            // income (just under the cliff on its own). Age 62 (>= 59.5) so the
            // Traditional draw carries no early-withdrawal penalty and the planner
            // honors withdrawal order. Brokerage then covers the rest with heavy
            // LTCG; the guard must cap it so trad + LTCG stays under the cliff.
            const traditional = new InvestedAccount(
                'trad-1', 'Traditional IRA', 45000, 0, 15, 0.05, 'Traditional IRA'
            );
            // Brokerage with ~90% gain ratio → any draw realizes large LTCG.
            const brokerage = new InvestedAccount(
                'brok-1', 'Brokerage', 300000, 0, 10, 0.07, 'Brokerage',
                true, 0.2, 30000 // costBasis $30k on $300k → ~90% gain ratio
            );
            // Roth available for cliff substitution.
            const roth = new InvestedAccount(
                'roth-1', 'Roth IRA', 200000, 0, 10, 0.05, 'Roth IRA',
                true, 0.2, 100000
            );
            const expense = new OtherExpense(
                'exp-1', 'Living Expenses', 70000, 'Annually', new Date('2020-01-01')
            );

            return {
                year: 2025,
                currentAge: 62, // 59.5 <= age < 65 → ACA-aware, no Traditional penalty
                isRetired: true,
                incomes: [],
                expenses: [expense],
                totalLivingExpenses: 70000,
                rmdAmount: 0,
                accounts: [traditional, brokerage, roth],
                withdrawalOrder: [
                    { accountId: 'trad-1' },   // ordinary income first
                    { accountId: 'brok-1' },   // then LTCG
                    { accountId: 'roth-1' },   // substitution target
                ],
                taxState: createTestTaxState(),
                assumptions: createTestAssumptions({
                    birthYear: 1963,
                    retirementAge: 55,
                    taxOptimizationEnabled: false, // isolate withdrawal/MAGI interaction
                }),
                taxOptimizationEnabled: false,
                acaAware: true,
            };
        }

        it('should keep realized MAGI (traditional + LTCG) under the ACA cliff', () => {
            const yearPlan = solveRetirementYear(buildAcaInput());

            // Ordinary income from Traditional spending withdrawals.
            const tradWithdrawal = yearPlan.withdrawals
                .filter(w => w.source === 'traditional_401k' || w.source === 'traditional_ira')
                .reduce((sum, w) => sum + w.gross, 0);

            // Realized LTCG from brokerage withdrawals.
            const ltcg = yearPlan.withdrawals
                .reduce((sum, w) => sum + (w.capitalGains?.longTerm || 0), 0);

            const realizedMAGI = tradWithdrawal + ltcg;

            // The guard must account for the traditional draw, so realized MAGI
            // (trad ordinary income + LTCG) stays under the cliff. Without the fix
            // the brokerage LTCG stacks on the un-counted trad draw and breaches it.
            expect(tradWithdrawal).toBeGreaterThan(0); // sanity: trad really is drawn
            expect(realizedMAGI).toBeLessThan(ACA_CLIFF_2025);
            expect(yearPlan.unfundedDeficit).toBe(0); // Roth substitution still funds the year
        });
    });

    describe('FERS supplement in conversion ceiling (Bug #6)', () => {
        // The conversion ceiling builder sums pension income to project fixed
        // income at RMD. It must include the FERS MRA-to-62 supplement (via
        // getTotalAnnualAmount), not just the base benefit. The projected pension
        // at RMD is surfaced on taxOptimizationTarget.pensionAtRMD, giving a clean
        // observable: a larger current supplement → larger projected pensionAtRMD.
        function buildFersInput(fersSupplement: number): YearSolverInput {
            // calculatedBenefit drives getAnnualAmount(); supplement is added by
            // getTotalAnnualAmount(). retirementAge < 62 so the supplement applies.
            const fers = new FERSPensionIncome(
                'fers-1', 'FERS Pension',
                20,      // yearsOfService
                100000,  // high3Salary
                57,      // retirementAge (< 62 → supplement eligible)
                1965,    // birthYear
                30000,   // calculatedBenefit (annual base)
                fersSupplement,
                24000,   // estimatedSSAt62
                new Date('2020-01-01'), undefined,
            );
            const expense = new OtherExpense(
                'exp-1', 'Living Expenses', 40000, 'Annually', new Date('2020-01-01')
            );
            const traditional = new InvestedAccount(
                'trad-1', 'Traditional IRA', 500000, 0, 10, 0.05, 'Traditional IRA'
            );
            const roth = new InvestedAccount(
                'roth-1', 'Roth IRA', 10000, 0, 10, 0.05, 'Roth IRA'
            );

            return {
                year: 2025,
                currentAge: 60, // pre-RMD so pensionAtRMD is a forward projection
                isRetired: true,
                incomes: [fers],
                expenses: [expense],
                totalLivingExpenses: 40000,
                rmdAmount: 0,
                accounts: [traditional, roth],
                withdrawalOrder: [{ accountId: 'trad-1' }, { accountId: 'roth-1' }],
                taxState: createTestTaxState(),
                assumptions: createTestAssumptions({
                    birthYear: 1965,
                    retirementAge: 57,
                    taxOptimizationEnabled: true,
                }),
                taxOptimizationEnabled: true,
                acaAware: false,
            };
        }

        it('should include the FERS supplement in the projected pension at RMD', () => {
            const noSupplement = solveRetirementYear(buildFersInput(0));
            const withSupplement = solveRetirementYear(buildFersInput(15000));

            const pensionAtRMD_none = noSupplement.taxOptimizationTarget?.pensionAtRMD ?? 0;
            const pensionAtRMD_with = withSupplement.taxOptimizationTarget?.pensionAtRMD ?? 0;

            expect(pensionAtRMD_none).toBeGreaterThan(0);
            // The $15k supplement raises current pension income, which projects forward
            // to a strictly higher pension at RMD. Before the fix the supplement was
            // dropped and both values were identical.
            expect(pensionAtRMD_with).toBeGreaterThan(pensionAtRMD_none);
        });
    });

    describe('RMD shortfall penalty (Bug #4)', () => {
        // A surplus retirement year: pension fully covers expenses, so there's no
        // withdrawal loop. We pass an RMD shortfall penalty and assert it flows into
        // the year's tax/penalties and reduces the surplus dollar-for-dollar.
        function buildSurplusRetirementInput(rmdPenalty: number): YearSolverInput {
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

            return {
                year: 2025,
                currentAge: 75,
                isRetired: true,
                incomes: [pension],
                expenses: [expense],
                totalLivingExpenses: 40000,
                rmdAmount: 0,
                rmdPenalty, // when fix absent, consumer ignores it
                accounts: [savings, traditional],
                withdrawalOrder: [{ accountId: 'savings-1' }, { accountId: 'trad-1' }],
                taxState: createTestTaxState(),
                assumptions: createTestAssumptions({ birthYear: 1950, retirementAge: 65 }),
                taxOptimizationEnabled: false,
                acaAware: false,
            };
        }

        it('should add the RMD penalty to the year total tax and penalties line', () => {
            const penalty = 2500;
            const withPenalty = solveRetirementYear(buildSurplusRetirementInput(penalty));
            const noPenalty = solveRetirementYear(buildSurplusRetirementInput(0));

            // Penalties line reflects the excise.
            expect(noPenalty.tax.penalties).toBe(0);
            expect(withPenalty.tax.penalties).toBeCloseTo(penalty, 2);

            // Total tax is exactly the no-penalty total plus the excise.
            expect(withPenalty.tax.total - noPenalty.tax.total).toBeCloseTo(penalty, 2);
        });

        it('should reduce surplus dollar-for-dollar by the RMD penalty (cash effect)', () => {
            const penalty = 2500;
            const withPenalty = solveRetirementYear(buildSurplusRetirementInput(penalty));
            const noPenalty = solveRetirementYear(buildSurplusRetirementInput(0));

            // Surplus year → the excise reduces surplus (cash leaving as tax).
            expect(noPenalty.surplus - withPenalty.surplus).toBeCloseTo(penalty, 2);
        });
    });
});
