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
 * its per-fund `goalFundCredits` map (and counts it once in living expenses) —
 * while EACH goal keeps its own labeled node so a goal the user created never
 * disappears from the chart.
 *
 * Regression (double-count, wave 1): CashflowDetailBuilder iterated per-goal and
 * called getGoalFundAnnualSetAside (which SUMS across every goal on the fund) for
 * each, writing the combined set-aside under BOTH goal keys — two $3k goals
 * showed $12k vs the engine's $6k and the imbalance detector tripped.
 *
 * Regression (breakdown, wave 2): the wave-1 dedup fixed the total by emitting
 * ONLY the first goal's node, so "Boat (goal)" vanished from the chart. The fix
 * splits the fund's single total across the sharing goals so BOTH nodes exist
 * AND the goal-category sum still equals the engine's single fund credit.
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

    it('keeps both shared-fund goal nodes AND sums them to the engine set-aside (no double-count, no dropped node)', () => {
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

        // The fund's single set-aside is SPLIT across the goals that share it,
        // mirroring the engine's per-fund goalFundCredits map. The goal categories
        // must sum to the fund's single set-aside, NOT 2× it.
        const goalCategoryTotal = Object.entries(detail.expensesByCategory)
            .filter(([cat]) => cat.endsWith('(goal)'))
            .reduce((sum, [, amt]) => sum + amt, 0);

        expect(goalCategoryTotal).toBeCloseTo(engineSetAside, 5);
        // The double-count bug emitted $12k here (each goal carried the full $6k
        // fund sum); the dropped-node fix must not bring it back.
        expect(goalCategoryTotal).not.toBeCloseTo(2 * engineSetAside, 1);

        // BOTH goals the user created keep their own labeled node — neither is
        // dropped. With equal weights the $6k fund total splits $3k / $3k.
        expect(detail.expensesByCategory['Car (goal)']).toBeCloseTo(3000, 5);
        expect(detail.expensesByCategory['Boat (goal)']).toBeCloseTo(3000, 5);
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

    it('weights each shared-fund goal node by its OWN months-active window (corner)', () => {
        // Two goals share one fund but have DIFFERENT active windows this year:
        //  - Car: active all 12 months → $3000 set-aside this year.
        //  - Boat: a targetDate goal whose target is THIS January, so it has 0 active
        //    saving months this year (the lump is due, nothing more is set aside).
        // The fund total counts Car's $3000 only. The per-goal split must give Car the
        // whole $3000 and Boat $0 — NOT a monthly-weighted slice to the inactive Boat.
        const sharedFund = 'fund-shared';
        const goalCar = makeGoal('goal-car', 'Car', sharedFund); // recurring, 12 mo active

        // Boat: targetDate with the target in January of YEAR → 0 active months this year.
        const goalBoat = new OtherExpense(
            'goal-boat',
            'Boat',
            6000,
            'Monthly',
            new Date(YEAR - 1, 0, 1),     // started a year ago
        );
        goalBoat.goalType = 'targetDate';
        goalBoat.endDate = new Date(YEAR, 0, 1); // target January of YEAR → 0 months active
        goalBoat.goalAccountId = sharedFund;

        const expenses = [goalCar, goalBoat];

        const engineSetAside = getGoalFundAnnualSetAside(expenses, sharedFund, YEAR)!;
        expect(engineSetAside).toBeCloseTo(3000, 5); // Car's $3000 only; Boat contributes 0

        const detail = buildCashflowDetail({
            incomes: [],
            expenses,
            accounts: [],
            insurance: 0,
            year: YEAR,
            brokerageLTCGFromGross: 0,
        });

        // Car gets its exact own set-aside ($3000); the inactive Boat gets $0 and its
        // (zero) node is dropped. The per-goal nodes sum to the engine total exactly.
        expect(detail.expensesByCategory['Car (goal)']).toBeCloseTo(3000, 5);
        expect(detail.expensesByCategory['Boat (goal)']).toBeUndefined();

        const goalCategoryTotal = Object.entries(detail.expensesByCategory)
            .filter(([cat]) => cat.endsWith('(goal)'))
            .reduce((sum, [, amt]) => sum + amt, 0);
        expect(goalCategoryTotal).toBeCloseTo(engineSetAside, 5);
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
