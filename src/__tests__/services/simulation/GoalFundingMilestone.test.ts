/**
 * Goal Funding: milestone gating + shared-account double-count reconciliation
 * (FINDING 4 + #8)
 *
 * Verifies two engine-level behaviors of long-term goal sinking-fund funding in
 * simulateOneYear:
 *
 *  (a) Milestone gating — a goal whose startMilestoneId is NOT active this year
 *      is neither funded (its fund account balance does not grow) nor purchased.
 *      Once its milestone becomes active, it funds normally.
 *
 *  (b) Shared account — two goals that share one goalAccountId credit the fund
 *      with the SUM of both set-asides exactly ONCE per year (not 2x). This is
 *      the regression guard for the double-count that existed when the funding
 *      loop accumulated the (now per-account-total) helper result per-goal.
 *
 * Also exercises the date-only straggler fix: a targetDate goal whose endDate is
 * Jan 1 2030 (built local-midnight) must resolve to year 2030 even under a
 * positive-UTC timezone (run the suite with TZ=Australia/Sydney to confirm).
 */

import { describe, it, expect } from 'vitest';

import { simulateOneYear } from '../../../components/Objects/Assumptions/SimulationEngine';
import { InvestedAccount, SavedAccount } from '../../../components/Objects/Accounts/models';
import {
    AssumptionsState,
    defaultAssumptions,
    createBuiltinMilestones,
} from '../../../components/Objects/Assumptions/AssumptionsContext';
import { TaxState } from '../../../components/Objects/Taxes/TaxContext';
import { OtherExpense, getGoalFundAnnualSetAside } from '../../../components/Objects/Expense/models';
import { CustomMilestone } from '../../../services/simulation/types';

// =============================================================================
// FIXTURES
// =============================================================================

const BIRTH_YEAR = 1985; // Age 40 in 2025

function makeAssumptions(extraMilestones: CustomMilestone[] = []): AssumptionsState {
    return {
        ...defaultAssumptions,
        // Retire far in the future so these years are working years (income > expenses).
        milestones: [...createBuiltinMilestones(BIRTH_YEAR, 65, 95), ...extraMilestones],
        macro: {
            ...defaultAssumptions.macro,
            inflationAdjusted: false, // keep numbers static for clean assertions
            inflationRate: 0,
        },
        investments: {
            ...defaultAssumptions.investments,
            returnRates: { ror: 0 }, // no growth so fund deltas == set-asides exactly
        },
        withdrawalStrategy: [
            { id: 'ws-1', name: 'Brokerage', accountId: 'brokerage-1' },
        ],
    };
}

function makeTaxState(year: number): TaxState {
    return {
        filingStatus: 'Single',
        stateResidency: 'Texas',
        deductionMethod: 'Standard',
        fedOverride: null,
        ficaOverride: null,
        stateOverride: null,
        year,
    };
}

// A long-term targetDate goal: $36,000 saved from start over 3 years (Jan 2027 →
// Jan 2030) = $1,000/month = $12,000/year while active.
function makeTargetDateGoal(
    id: string,
    goalAccountId: string,
    opts: { startMilestoneId?: string } = {},
): OtherExpense {
    const g = new OtherExpense(
        id, `Goal ${id}`, 36000, 'Annually', new Date(2027, 0, 1), new Date(2030, 0, 1),
    );
    g.goalType = 'targetDate';
    g.goalAccountId = goalAccountId;
    if (opts.startMilestoneId) g.startMilestoneId = opts.startMilestoneId;
    return g;
}

function makeAccounts(funds: { id: string; amount: number }[]) {
    const brokerage = new InvestedAccount(
        'brokerage-1', 'Brokerage', 1_000_000, 0, 5, 0.0, 'Brokerage', true, 0.2, 1_000_000,
    );
    const fundAccounts = funds.map(f => new SavedAccount(f.id, `Fund ${f.id}`, f.amount, 0));
    return [brokerage, ...fundAccounts];
}

function fundBalance(result: { accounts: { id: string; amount: number }[] }, id: string): number {
    const acc = result.accounts.find(a => a.id === id);
    if (!acc) throw new Error(`fund ${id} not found in result`);
    return acc.amount;
}

// =============================================================================
// (a) MILESTONE GATING
// =============================================================================

describe('Goal funding — milestone gating (FINDING 4)', () => {
    // Custom start milestone: becomes active once YEAR >= 2028.
    const startMilestone: CustomMilestone = {
        id: 'GOAL_START',
        name: 'Goal Start',
        conditions: [{ type: 'YEAR', operator: '>=', value: 2028 }],
    };

    it('does NOT fund a goal whose start milestone is inactive this year', () => {
        const year = 2027; // milestone not yet active (needs YEAR >= 2028)
        const accounts = makeAccounts([{ id: 'fund-1', amount: 0 }]);
        const goal = makeTargetDateGoal('A', 'fund-1', { startMilestoneId: 'GOAL_START' });

        const result = simulateOneYear(
            year, [], [goal], accounts, makeAssumptions([startMilestone]),
            makeTaxState(year),
        );

        // Fund balance must NOT increase — the goal is milestone-gated off.
        expect(fundBalance(result, 'fund-1')).toBe(0);
    });

    it('funds the goal normally once its start milestone is active', () => {
        const year = 2028; // milestone active (YEAR >= 2028)
        const accounts = makeAccounts([{ id: 'fund-1', amount: 0 }]);
        const goal = makeTargetDateGoal('A', 'fund-1', { startMilestoneId: 'GOAL_START' });

        // Sanity: the helper's per-account total for this year.
        const expected = getGoalFundAnnualSetAside([goal], 'fund-1', year) ?? 0;
        expect(expected).toBeGreaterThan(0);

        const result = simulateOneYear(
            year, [], [goal], accounts, makeAssumptions([startMilestone]),
            makeTaxState(year),
            [], undefined,
            ['GOAL_START'], // previously active milestones — milestone already reached
        );

        expect(fundBalance(result, 'fund-1')).toBeCloseTo(expected, 2);
    });

    it('does NOT purchase (spend the lump from) a milestone-gated goal in its due year', () => {
        const year = 2030; // targetDate due year, but milestone inactive (we omit it)
        const accounts = makeAccounts([{ id: 'fund-1', amount: 50000 }]); // pre-loaded fund
        const goal = makeTargetDateGoal('A', 'fund-1', { startMilestoneId: 'GOAL_START' });

        // Pass NO active milestones and a milestone that won't be met (YEAR >= 9999)
        const neverMilestone: CustomMilestone = {
            id: 'GOAL_START',
            name: 'Goal Start',
            conditions: [{ type: 'YEAR', operator: '>=', value: 9999 }],
        };

        const result = simulateOneYear(
            year, [], [goal], accounts, makeAssumptions([neverMilestone]),
            makeTaxState(year),
        );

        // Lump must NOT be spent: fund stays at its pre-loaded balance.
        expect(fundBalance(result, 'fund-1')).toBe(50000);
    });
});

// =============================================================================
// (b) SHARED ACCOUNT — no double-count
// =============================================================================

describe('Goal funding — shared account double-count guard (FINDING 8)', () => {
    it('credits the fund the SUM of both goals\' set-asides exactly once', () => {
        const year = 2028; // both goals active and saving (2027 → 2030)
        const accounts = makeAccounts([{ id: 'fund-shared', amount: 0 }]);
        const goalA = makeTargetDateGoal('A', 'fund-shared'); // $12k/yr
        const goalB = makeTargetDateGoal('B', 'fund-shared'); // $12k/yr
        const expenses = [goalA, goalB];

        // The helper already SUMS across both goals on this account.
        const expectedTotal = getGoalFundAnnualSetAside(expenses, 'fund-shared', year) ?? 0;

        // Cross-check it equals the sum of the two individual set-asides.
        const setAsideA = getGoalFundAnnualSetAside([goalA], 'fund-shared', year) ?? 0;
        const setAsideB = getGoalFundAnnualSetAside([goalB], 'fund-shared', year) ?? 0;
        expect(expectedTotal).toBeCloseTo(setAsideA + setAsideB, 2);
        expect(expectedTotal).toBeGreaterThan(0);

        const result = simulateOneYear(
            year, [], expenses, accounts, makeAssumptions(),
            makeTaxState(year),
        );

        const credited = fundBalance(result, 'fund-shared');

        // Must be the SUM (once), NOT double-counted (2x the per-account total).
        expect(credited).toBeCloseTo(expectedTotal, 2);
        expect(credited).not.toBeCloseTo(expectedTotal * 2, 2);
    });
});

// =============================================================================
// DATE-ONLY STRAGGLER (TZ-robust)
// =============================================================================

describe('Goal funding — local-midnight endDate resolves correctly under any TZ', () => {
    it('purchases a Jan 1 2030 targetDate goal in 2030 (not 2029) regardless of TZ', () => {
        const year = 2030;
        const accounts = makeAccounts([{ id: 'fund-1', amount: 36000 }]); // fully funded
        const goal = makeTargetDateGoal('A', 'fund-1'); // endDate Jan 1 2030 (local)

        const result = simulateOneYear(
            year, [], [goal], accounts, makeAssumptions(),
            makeTaxState(year),
        );

        // The lump comes due in 2030: the fund is spent down to 0.
        expect(fundBalance(result, 'fund-1')).toBe(0);
    });
});
