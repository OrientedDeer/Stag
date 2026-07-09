/**
 * A reserved goal sinking-fund account must stay untouchable for living expenses
 * even when the withdrawal order does NOT list it — the shape a SAVED SCENARIO
 * supplies.
 *
 * Regression for the 2026-07-06 deep-review follow-up (#174): commit 633ee9b
 * replaced the hard exclusion of reserved goal-fund accounts from the drawdown
 * with a move-to-END reorder, conceding in its own comment that "a genuine total
 * shortfall can still reach them". That reopened a leak the app-level order
 * reconciler cannot close: ScenarioContext.runScenario feeds the scenario blob's
 * OWN withdrawalStrategy straight to the engine, so a scenario whose order predates
 * a goal sinking-fund account never lists that account. On the retirement drawdown
 * `createOrderedSnapshots(..., includeUnorderedSellable=true)` appends the omitted
 * sellable fund as a #111 last-resort tier — and the move-to-end code then drained
 * it for living expenses once the non-reserved balance exhausted, silently spending
 * (e.g.) the house-down-payment fund so the goal could not be funded at its due
 * year.
 *
 * The airtight fix caps the reserved account out of the drawdown entirely, so a
 * genuine shortfall surfaces as an unfunded deficit (the honest signal) instead of
 * raiding the fund. This test builds the leaky shape — order OMITS the reserved
 * fund and the non-reserved balance is DELIBERATELY too small to cover the deficit
 * — and asserts the fund stays whole and the shortfall shows up as deficit.
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
    // A taxed Traditional balance DELIBERATELY too small to cover the whole
    // living-expense deficit — so the drawdown exhausts it and, without the
    // reservation, would spill into the goal fund as a last resort.
    const traditional = new InvestedAccount(
        'trad-1', 'Traditional IRA', 20000,
        0, 20, 0.05, 'Traditional IRA'
    );
    // Reserved goal sinking fund — large enough to cover the residual shortfall if
    // the drawdown were allowed to reach it. It must stay untouched.
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
        // STALE SAVED-SCENARIO shape: the withdrawal order predates the goal fund,
        // so it lists ONLY the Traditional account. The app-level reconciler that
        // normally syncs every eligible account into the order never runs on a
        // scenario blob — ScenarioContext.runScenario feeds this straight through.
        withdrawalStrategy: [
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
        // Scenario-supplied order OMITS the reserved goal fund entirely.
        withdrawalOrder: [
            { accountId: 'trad-1' },
        ],
        reservedAccountIds: ['goal-fund-1'],
        taxState,
        assumptions,
        taxOptimizationEnabled,
        acaAware: false,
    };
}

describe('Reserved goal fund survives a scenario order that omits it (#174)', () => {
    for (const taxOpt of [false, true]) {
        it(`stays untouched and surfaces the shortfall as deficit (taxOpt=${taxOpt})`, () => {
            const yearPlan = solveRetirementYear(buildInput(taxOpt));

            // The Traditional balance is drawn — the drawdown genuinely runs.
            const tradWithdrawn = yearPlan.withdrawals
                .filter(w => w.accountId === 'trad-1')
                .reduce((s, w) => s + w.gross, 0);
            expect(tradWithdrawn).toBeGreaterThan(0);

            // The reserved goal fund must NOT be raided for living expenses even
            // though it is the only balance left that could cover the residual. Under
            // the move-to-end reorder this drained ~$28k+ from the house fund.
            const goalFundWithdrawn = yearPlan.withdrawals
                .filter(w => w.accountId === 'goal-fund-1')
                .reduce((s, w) => s + w.gross, 0);
            expect(goalFundWithdrawn).toBe(0);

            // The genuine shortfall must surface as an unfunded deficit (the honest
            // signal the plan doesn't work while preserving the goal) rather than
            // vanishing because the fund was silently spent.
            expect(yearPlan.unfundedDeficit).toBeGreaterThan(1000);
        });
    }
});
