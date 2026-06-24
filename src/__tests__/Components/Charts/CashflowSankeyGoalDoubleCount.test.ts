import { describe, it, expect } from 'vitest';
import { buildCashflowDetail } from '../../../services/simulation/CashflowDetailBuilder';
import {
    OtherExpense,
    getGoalFundAnnualSetAside,
} from '../../../components/Objects/Expense/models';

/**
 * Two active long-term goals that point at the SAME goal-fund account must
 * contribute their set-aside to the Sankey expense categories exactly ONCE in
 * aggregate — mirroring how SimulationEngine credits the shared fund once via
 * its per-fund `goalFundCredits` map (and counts it once in living expenses).
 *
 * Regression: CashflowDetailBuilder iterated per-goal and called
 * getGoalFundAnnualSetAside (which SUMS across every goal on the fund) for each,
 * writing the combined set-aside under BOTH goal category keys — double-counting
 * it. Two $3k goals showed $12k in categories vs the engine's $6k, so Net Pay
 * outflows exceeded the net-pay flow and the imbalance detector tripped.
 */
describe('CashflowDetailBuilder — shared goal fund double-count', () => {
    const YEAR = 2030;

    /**
     * Recurring goal: monthly set-aside = amount / (intervalYears * 12).
     * amount=3000, intervalYears=1 → $250/mo → $3000/yr over 12 active months.
     * (frequency is irrelevant for goals — the set-aside derives from amount.)
     * startDate a year before YEAR so all 12 months are active.
     */
    function makeGoal(id: string, name: string, fundId: string): OtherExpense {
        const goal = new OtherExpense(
            id,
            name,
            3000,
            'Monthly',
            new Date(YEAR - 1, 0, 1),
        );
        goal.goalType = 'recurring';
        goal.intervalYears = 1;
        goal.goalAccountId = fundId;
        return goal;
    }

    it('sums shared-fund goal categories to the engine set-aside (no double-count)', () => {
        const sharedFund = 'fund-shared';
        const goalCar = makeGoal('goal-car', 'Car', sharedFund);
        const goalBoat = makeGoal('goal-boat', 'Boat', sharedFund);
        const expenses = [goalCar, goalBoat];

        // The engine's view: one credit per fund. getGoalFundAnnualSetAside sums
        // across every goal on the fund, so this is the single, correct total.
        const engineSetAside = getGoalFundAnnualSetAside(expenses, sharedFund, YEAR)!;
        expect(engineSetAside).toBeCloseTo(6000, 5); // 2 × $3k

        const detail = buildCashflowDetail({
            incomes: [],
            expenses,
            accounts: [],
            insurance: 0,
            year: YEAR,
            brokerageLTCGFromGross: 0,
        });

        // The fund's whole set-aside is credited ONCE (to the first goal's label),
        // mirroring the engine's per-fund goalFundCredits map. The goal categories
        // must sum to the fund's single set-aside, NOT 2× it.
        const goalCategoryTotal = Object.entries(detail.expensesByCategory)
            .filter(([cat]) => cat.endsWith('(goal)'))
            .reduce((sum, [, amt]) => sum + amt, 0);

        expect(goalCategoryTotal).toBeCloseTo(engineSetAside, 5);
        // The bug emitted $12k here (each goal carried the full $6k fund sum).
        expect(goalCategoryTotal).not.toBeCloseTo(2 * engineSetAside, 1);

        // The shared fund is attributed to the first-encountered goal's label.
        expect(detail.expensesByCategory['Car (goal)']).toBeCloseTo(engineSetAside, 5);
        expect(detail.expensesByCategory['Boat (goal)']).toBeUndefined();
    });

    it('leaves a single goal on its own fund unchanged ($3k → $3k)', () => {
        const goalCar = makeGoal('goal-car', 'Car', 'fund-car');
        const detail = buildCashflowDetail({
            incomes: [],
            expenses: [goalCar],
            accounts: [],
            insurance: 0,
            year: YEAR,
            brokerageLTCGFromGross: 0,
        });
        expect(detail.expensesByCategory['Car (goal)']).toBeCloseTo(3000, 5);
    });

    it('keeps separate funds independent (no cross-contamination)', () => {
        const goalCar = makeGoal('goal-car', 'Car', 'fund-car');
        const goalBoat = makeGoal('goal-boat', 'Boat', 'fund-boat');
        const detail = buildCashflowDetail({
            incomes: [],
            expenses: [goalCar, goalBoat],
            accounts: [],
            insurance: 0,
            year: YEAR,
            brokerageLTCGFromGross: 0,
        });
        expect(detail.expensesByCategory['Car (goal)']).toBeCloseTo(3000, 5);
        expect(detail.expensesByCategory['Boat (goal)']).toBeCloseTo(3000, 5);
    });
});
