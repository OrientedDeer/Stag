/**
 * Reserved goal sinking-fund accounts must NOT be drained for general
 * retirement spending while any non-reserved balance remains.
 *
 * Regression for the 2026-07-06 deep-review HIGH finding (#174): the reserved
 * goal-fund guard only dropped a reserved account when it was NOT a member of the
 * user's withdrawal order — but the app-wide reconciler syncs EVERY eligible
 * account into withdrawalStrategy (the withdrawal-order UI is reorder-only; an
 * account can never be removed), so a reserved goal fund is ALWAYS in the order
 * and the guard never fired. Result: the drawdown drained the goal fund (often
 * FIRST, since a SavedAccount is untaxed) while a taxed Traditional balance sat
 * untouched, and the goal could no longer be funded at its due year.
 *
 * The fix moves reserved accounts to the END of the drawdown (last-resort) so
 * every non-reserved account is exhausted first. The prior test used an order
 * shape (goal fund omitted from the order) the reconciler never produces; this
 * rebuild uses the REAL reconciled shape — the goal fund IS in the order, even
 * listed first — and proves the reservation still holds.
 */
import { describe, it, expect } from 'vitest';
import { solveRetirementYear, YearSolverInput } from '../../../services/simulation/YearSolver';
import { InvestedAccount, SavedAccount } from '../../../components/Objects/Accounts/models';
import { PassiveIncome } from '../../../components/Objects/Income/models';
import { OtherExpense } from '../../../components/Objects/Expense/models';
import { AssumptionsState, defaultAssumptions, createBuiltinMilestones } from '../../../components/Objects/Assumptions/AssumptionsContext';
import { TaxState } from '../../../components/Objects/Taxes/TaxContext';

const BIRTH_YEAR = 1960; // Age 70 in 2030 (no RMD, no early-withdrawal penalty)

function buildInput(taxOptimizationEnabled: boolean): YearSolverInput {
    // A taxed Traditional balance large enough to cover the whole living-expense
    // deficit on its own — so a correctly-ordered drawdown never needs the goal fund.
    const traditional = new InvestedAccount(
        'trad-1', 'Traditional IRA', 100000,
        0, 20, 0.05, 'Traditional IRA'
    );
    // Reserved goal sinking fund — an untaxed SavedAccount the drawdown would
    // otherwise prefer. Listed FIRST in the reconciled order to prove ordering
    // doesn't matter: the reservation must move it last regardless.
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
            taxOptimizationEnabled,
            returnRates: { ror: 5 },
        },
        // Reconciled shape: EVERY eligible account is synced into the order,
        // including the reserved goal fund — here even ahead of the Traditional.
        withdrawalStrategy: [
            { id: 'ws-1', name: 'House Down Payment', accountId: 'goal-fund-1' },
            { id: 'ws-2', name: 'Traditional', accountId: 'trad-1' },
        ],
    };

    const taxState: TaxState = {
        filingStatus: 'Single', stateResidency: 'Texas', deductionMethod: 'Standard',
        fedOverride: null, ficaOverride: null, stateOverride: null, year: 2030,
    };

    return {
        year: 2030,
        currentAge: 70,
        isRetired: true,
        incomes: [pension],
        expenses,
        totalLivingExpenses: 60000,
        rmdAmount: 0,
        accounts: [traditional, goalFund],
        // Reconciled: goal fund IS a member of the order (listed first).
        withdrawalOrder: [
            { accountId: 'goal-fund-1' },
            { accountId: 'trad-1' },
        ],
        reservedAccountIds: ['goal-fund-1'],
        taxState,
        assumptions,
        taxOptimizationEnabled,
        acaAware: false,
    };
}

describe('Reserved goal-fund accounts are not drained for living expenses (#174)', () => {
    for (const taxOpt of [false, true]) {
        it(`preserves a reserved goal fund that the reconciled order includes (taxOpt=${taxOpt})`, () => {
            const yearPlan = solveRetirementYear(buildInput(taxOpt));

            // The deficit ($60k expenses − $12k pension ≈ $48k+) genuinely needs a
            // withdrawal, so the drawdown DOES tap accounts — otherwise the test
            // proves nothing.
            const tradWithdrawn = yearPlan.withdrawals
                .filter(w => w.accountId === 'trad-1')
                .reduce((s, w) => s + w.gross, 0);
            expect(tradWithdrawn).toBeGreaterThan(0);

            // The reserved goal fund must NOT be drawn down for living expenses AT
            // ALL: the Traditional balance covers the deficit, and the reservation is
            // a hard cap (the fund is excluded from the drawdown snapshots entirely),
            // so not even sub-dollar gross-up dust reaches it. The old move-to-end
            // reorder let dust leak out of it every deficit year (toBeLessThan(1)); the
            // airtight cap restores the exact toBe(0) guarantee.
            const goalFundWithdrawn = yearPlan.withdrawals
                .filter(w => w.accountId === 'goal-fund-1')
                .reduce((s, w) => s + w.gross, 0);
            expect(goalFundWithdrawn).toBe(0);
        });
    }
});
