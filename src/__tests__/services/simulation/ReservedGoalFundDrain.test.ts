/**
 * Reserved goal sinking-fund accounts must NOT be drained for general
 * retirement spending.
 *
 * Regression for the 2026-06-24 deep-review HIGH finding: in the non-tax-opt
 * MANUAL-order retirement path, createOrderedSnapshots(..., includeUnorderedSellable=true)
 * appends every sellable account the withdrawal ORDER omits to a fallback
 * withdrawal tier. A goal sinking-fund SavedAccount that the user deliberately
 * left out of the order (it's reserved for a future goal) was being tapped to
 * cover a living-expense deficit — so the goal could no longer be funded at its
 * due year. input.reservedAccountIds reaches the surplus allocator but was never
 * forwarded to the snapshot builder, so the fallback tier ignored the reservation.
 */
import { describe, it, expect } from 'vitest';
import { solveRetirementYear, YearSolverInput } from '../../../services/simulation/YearSolver';
import { InvestedAccount, SavedAccount } from '../../../components/Objects/Accounts/models';
import { PassiveIncome } from '../../../components/Objects/Income/models';
import { OtherExpense } from '../../../components/Objects/Expense/models';
import { AssumptionsState, defaultAssumptions, createBuiltinMilestones } from '../../../components/Objects/Assumptions/AssumptionsContext';
import { TaxState } from '../../../components/Objects/Taxes/TaxContext';

const BIRTH_YEAR = 1960; // Age 70 in 2030 (no RMD, no early-withdrawal penalty)

describe('Reserved goal-fund accounts are not drained for living expenses', () => {
    it('preserves a reserved goal SavedAccount that the manual order omits, even on a deficit year', () => {
        // Ordered drawdown source: a Traditional balance too small to cover the
        // full living-expense deficit on its own, so the deficit loop reaches
        // past the configured order into the fallback tier.
        const traditional = new InvestedAccount(
            'trad-1', 'Traditional IRA', 20000,
            0, 20, 0.05, 'Traditional IRA'
        );
        // Reserved goal sinking fund — NOT in the withdrawal order. Holds enough
        // to look like an attractive cash source to the fallback tier.
        const goalFund = new SavedAccount('goal-fund-1', 'House Down Payment', 80000, 2.0);

        const pension = new PassiveIncome(
            'pension-1', 'Pension', 12000, 'Annually', 'No', 'Other', new Date('2020-01-01'), undefined, false
        );

        const expenses = [new OtherExpense('exp-1', 'Living', 60000, 'Annually', new Date('2020-01-01'))];

        const assumptions: AssumptionsState = {
            ...defaultAssumptions,
            milestones: createBuiltinMilestones(BIRTH_YEAR, 60, 95),
            investments: {
                ...defaultAssumptions.investments,
                taxOptimizationEnabled: false, // non-tax-opt: user's manual order binds
                returnRates: { ror: 5 },
            },
            withdrawalStrategy: [
                { id: 'ws-1', name: 'Traditional', accountId: 'trad-1' },
            ],
        };

        const taxState: TaxState = {
            filingStatus: 'Single', stateResidency: 'Texas', deductionMethod: 'Standard',
            fedOverride: null, ficaOverride: null, stateOverride: null, year: 2030,
        };

        const input: YearSolverInput = {
            year: 2030,
            currentAge: 70,
            isRetired: true,
            incomes: [pension],
            expenses,
            totalLivingExpenses: 60000,
            rmdAmount: 0,
            accounts: [traditional, goalFund],
            withdrawalOrder: [
                { accountId: 'trad-1' }, // goal-fund-1 deliberately omitted
            ],
            reservedAccountIds: ['goal-fund-1'],
            taxState,
            assumptions,
            taxOptimizationEnabled: false,
            acaAware: false,
        };

        const yearPlan = solveRetirementYear(input);

        // The deficit must genuinely exceed income + the ordered Traditional
        // balance, otherwise the fallback tier never engages and the test proves
        // nothing.
        const tradWithdrawn = yearPlan.withdrawals
            .filter(w => w.accountId === 'trad-1')
            .reduce((s, w) => s + w.gross, 0);
        expect(tradWithdrawn).toBeGreaterThan(0);

        // The reserved goal fund must NOT be drawn down for living expenses.
        const goalFundWithdrawn = yearPlan.withdrawals
            .filter(w => w.accountId === 'goal-fund-1')
            .reduce((s, w) => s + w.gross, 0);
        expect(goalFundWithdrawn).toBe(0);
    });
});
