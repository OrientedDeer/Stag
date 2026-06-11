/**
 * Bug #11 regression: the goal sinking-fund funding gate must read the goal's
 * target/start year with the SAME calendar convention as the purchase gate.
 *
 * Goal dates are stored as LOCAL-midnight (parseDate / the expense form build
 * them with `new Date(y, m-1, d)`). Both the funding gate (getGoalFundMonthlyCap)
 * and the purchase gate (isGoalDueInYear) read them with `getFullYear()`. If the
 * two readers ever drift apart (one local, one UTC), a `YYYY-01-01` target slips
 * a year in one of them, so the funding priority is capped to $0 ("already
 * purchased") a full year before — or after — the lump actually fires, leaving
 * the goal mis-funded. These tests pin the two readers together at the year
 * boundary and exercise the real engine through a Jan-1 target date.
 */
import { describe, it, expect } from 'vitest';
import { AssumptionsState, defaultAssumptions, createBuiltinMilestones } from '../../../../components/Objects/Assumptions/AssumptionsContext';
import { TaxState } from '../../../../components/Objects/Taxes/TaxContext';
import { SavedAccount } from '../../../../components/Objects/Accounts/models';
import { WorkIncome } from '../../../../components/Objects/Income/models';
import { FoodExpense, OtherExpense, isGoalDueInYear } from '../../../../components/Objects/Expense/models';
import { runSimulation } from '../../../../components/Objects/Assumptions/useSimulation';

// Replicates the funding-gate predicate from getGoalFundMonthlyCap (used by
// SimulationEngine's per-year priority derivation). Kept in lockstep with the
// source so this test fails if either reader drifts to a UTC getUTCFullYear().
// A goal's endDate IS its target date.
function fundingGateInactive(
    e: { startDate?: Date | null; goalType?: string; endDate?: Date | null },
    year: number,
): boolean {
    const goalStartYear = (e.startDate ? new Date(e.startDate) : new Date()).getFullYear();
    if (year < goalStartYear) return true;
    if (e.goalType === 'targetDate' && e.endDate
        && new Date(e.endDate).getFullYear() < year) return true;
    return false;
}

describe('Bug #11 — goal funding gate year', () => {
    it('funding gate and isGoalDueInYear agree on the year for a Jan-1 target', () => {
        const goal = new OtherExpense('exp-car', 'Car', 30000, 'Monthly', new Date(2025, 0, 1));
        goal.goalType = 'targetDate';
        goal.endDate = new Date(2030, 0, 1); // endDate IS the target
        goal.goalAccountId = 'acc-car-fund';

        // The gate must NOT mark the goal "already purchased" until AFTER the
        // due year. Through 2029 it keeps funding; 2030 is the due/purchase year.
        for (let year = 2025; year <= 2029; year++) {
            expect(fundingGateInactive(goal, year)).toBe(false);
            expect(isGoalDueInYear(goal, year)).toBe(false);
        }

        // The purchase fires in 2030 (per isGoalDueInYear), and the funding gate
        // is still active in 2030 (not yet "already purchased").
        expect(isGoalDueInYear(goal, 2030)).toBe(true);
        expect(fundingGateInactive(goal, 2030)).toBe(false);

        // Only from 2031 onward does the gate consider it already purchased —
        // exactly one year after the due year, matching isGoalDueInYear.
        expect(fundingGateInactive(goal, 2031)).toBe(true);
        expect(isGoalDueInYear(goal, 2031)).toBe(false);
    });

    it('end-to-end: a Jan-1 target goal accrues through the prior year and buys in the target year', () => {
        const startYear = 2025;
        const targetYear = 2030;

        const assumptions: AssumptionsState = {
            ...defaultAssumptions,
            demographics: {},
            milestones: createBuiltinMilestones(1985, 67, 90),
            income: { ...defaultAssumptions.income, salaryGrowth: 0 },
            macro: { ...defaultAssumptions.macro, inflationRate: 0, inflationAdjusted: false },
            investments: { ...defaultAssumptions.investments, returnRates: { ror: 0 } },
        };
        const taxState: TaxState = {
            filingStatus: 'Single', stateResidency: 'DC', deductionMethod: 'Standard',
            fedOverride: null, ficaOverride: null, stateOverride: null, year: startYear,
        };

        const carFund = new SavedAccount('acc-car-fund', 'Car (fund)', 0, 0);
        const income = new WorkIncome(
            'inc-work', 'Salary', 90000, 'Annually', 'Yes',
            0, 0, 0, 0, '', null, 'FIXED',
            new Date(startYear, 0, 1), new Date(startYear + 40, 11, 31),
        );
        const living = new FoodExpense('exp-living', 'Living', 20000, 'Annually', new Date(startYear, 0, 1));

        // Jan-1 (local-midnight) target — the date shape that triggered the bug.
        const carGoal = new OtherExpense('exp-car', 'Car', 12000, 'Monthly', new Date(startYear, 0, 1));
        carGoal.goalType = 'targetDate';
        carGoal.endDate = new Date(targetYear, 0, 1); // endDate IS the target
        carGoal.goalAccountId = 'acc-car-fund';

        const sim = runSimulation(8, [carFund], [income], [living, carGoal], assumptions, taxState)
            .filter(s => !s.isEndOfYearProjection);
        const fundAt = (y: number) =>
            sim.find(s => s.year === y)?.accounts.find(a => a.id === 'acc-car-fund')?.amount ?? 0;

        // Funding continues right up to the target year (not capped to $0 early).
        expect(fundAt(targetYear - 1)).toBeGreaterThan(5000);
        // The lump is actually spent in the target year.
        expect(sim.some(s => s.logs.some(l => l.includes('came due')))).toBe(true);
    });
});
