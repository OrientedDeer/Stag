/**
 * Story: Long-Term Goal Sinking Fund (Phase 6)
 *
 * Scenario: A recurring big-ticket goal (e.g. replace the roof every 3 years)
 * funded by a monthly set-aside into a reserved sinking-fund SavedAccount.
 *
 * Key Assertions:
 * - The goal itself adds nothing to living expenses (goals return 0 from
 *   getAnnualAmount).
 * - The sinking-fund account accrues the set-aside year over year.
 * - In the goal's due year the lump is spent from the fund (balance drops
 *   sharply), then it starts accruing again toward the next cycle.
 */

import { describe, it, expect } from 'vitest';
import { AssumptionsState, defaultAssumptions, createBuiltinMilestones } from '../../../components/Objects/Assumptions/AssumptionsContext';
import { TaxState } from '../../../components/Objects/Taxes/TaxContext';
import { SavedAccount } from '../../../components/Objects/Accounts/models';
import { WorkIncome } from '../../../components/Objects/Income/models';
import { FoodExpense, OtherExpense } from '../../../components/Objects/Expense/models';
import { runSimulation } from '../../../components/Objects/Assumptions/useSimulation';

describe('Story: Long-Term Goal Sinking Fund', () => {
    const startYear = new Date().getFullYear();
    const goalCost = 36000; // set-aside = 36000 / (3*12) = $1,000/mo = $12,000/yr

    const taxState: TaxState = {
        filingStatus: 'Single', stateResidency: 'DC', deductionMethod: 'Standard',
        fedOverride: null, ficaOverride: null, stateOverride: null, year: startYear,
    };

    const assumptions: AssumptionsState = {
        ...defaultAssumptions,
        demographics: {},
        milestones: createBuiltinMilestones(1990, 65, 90),
        income: { ...defaultAssumptions.income, salaryGrowth: 0 },
        macro: { ...defaultAssumptions.macro, inflationRate: 0, inflationAdjusted: false },
        investments: { ...defaultAssumptions.investments, returnRates: { ror: 0 }, autoRothConversions: false },
        withdrawalStrategy: [],
        // Fund the roof goal with a fixed $1,000/mo savings priority.
        priorities: [
            { id: 'pri-roof', name: 'Roof fund', type: 'SAVINGS', accountId: 'acc-roof-fund', capType: 'FIXED', capValue: 1000 },
        ],
    };

    const roofFund = new SavedAccount('acc-roof-fund', 'Roof (fund)', 0, 0);
    const income = new WorkIncome(
        'inc-work', 'Salary', 90000, 'Annually', 'Yes',
        0, 0, 0, 0, '', null, 'FIXED',
        new Date(`${startYear}-01-01`), new Date(`${startYear + 40}-12-31`)
    );
    const living = new FoodExpense('exp-living', 'Living', 20000, 'Annually', new Date(`${startYear}-01-01`));

    const roofGoal = new OtherExpense('exp-roof', 'Roof', goalCost, 'Monthly', new Date(`${startYear - 1}-01-01`));
    roofGoal.goalType = 'recurring';
    roofGoal.intervalYears = 3;
    roofGoal.goalAccountId = 'acc-roof-fund';

    // End-of-year projection points duplicate calendar years; drop them so each
    // year appears once and balances reflect real year-end state.
    const realYears = () =>
        runSimulation(12, [roofFund], [income], [living, roofGoal], assumptions, taxState)
            .filter(s => !s.isEndOfYearProjection);

    it('accrues the set-aside, then spends the lump on the purchase cycle', () => {
        const sim = realYears();
        const fundSeries = sim.map(s => s.accounts.find(a => a.id === 'acc-roof-fund')?.amount ?? 0);

        // The fund builds up over the funding years (well past one year's set-aside).
        expect(Math.max(...fundSeries)).toBeGreaterThan(20000);

        // At least one year the balance drops sharply — the lump purchase (a drop
        // far larger than the $12k annual set-aside could explain on its own).
        const biggestDrop = Math.max(
            ...fundSeries.slice(1).map((v, i) => fundSeries[i] - v)
        );
        expect(biggestDrop).toBeGreaterThan(20000);
    });

    it('does not let the goal inflate ordinary living expenses', () => {
        const sim = realYears();
        // Living expense is $20k; the $36k goal cost must not be counted as spending.
        for (const s of sim) {
            expect(s.cashflow.livingExpenses).toBeLessThan(30000);
        }
    });
});

/**
 * Story: One-Time Goal (target date)
 *
 * A `targetDate` goal is funded by a monthly set-aside until its target year,
 * when the lump is spent. Unlike a recurring goal, it must NOT keep being funded
 * afterward — otherwise its savings priority would divert cashflow into a
 * drained, reserved account forever. This is the regression guard for that stop.
 */
describe('Story: One-Time Goal (target date)', () => {
    const startYear = new Date().getFullYear();
    const targetYear = startYear + 2;
    const goalCost = 36000; // ~$12k/yr of funding fully drains the fund in the target year

    const taxState: TaxState = {
        filingStatus: 'Single', stateResidency: 'DC', deductionMethod: 'Standard',
        fedOverride: null, ficaOverride: null, stateOverride: null, year: startYear,
    };

    const assumptions: AssumptionsState = {
        ...defaultAssumptions,
        demographics: {},
        milestones: createBuiltinMilestones(1990, 65, 90),
        income: { ...defaultAssumptions.income, salaryGrowth: 0 },
        macro: { ...defaultAssumptions.macro, inflationRate: 0, inflationAdjusted: false },
        investments: { ...defaultAssumptions.investments, returnRates: { ror: 0 }, autoRothConversions: false },
        withdrawalStrategy: [],
        priorities: [
            { id: 'pri-car', name: 'Car fund', type: 'SAVINGS', accountId: 'acc-car-fund', capType: 'FIXED', capValue: 1000 },
        ],
    };

    const carFund = new SavedAccount('acc-car-fund', 'Car (fund)', 0, 0);
    // Dates are built with new Date(y, 0, 1) (local midnight) rather than an ISO
    // string so getFullYear() can't slip to the prior year in negative-offset
    // timezones — the goal due-year math is year-based.
    const income = new WorkIncome(
        'inc-work', 'Salary', 90000, 'Annually', 'Yes',
        0, 0, 0, 0, '', null, 'FIXED',
        new Date(startYear, 0, 1), new Date(startYear + 40, 11, 31)
    );
    const living = new FoodExpense('exp-living', 'Living', 20000, 'Annually', new Date(startYear, 0, 1));

    // Mirror how the modal creates a one-time goal: endDate IS the target date
    // (single source of truth — no separate goalTargetDate field).
    const carGoal = new OtherExpense('exp-car', 'Car', goalCost, 'Monthly', new Date(startYear, 0, 1));
    carGoal.goalType = 'targetDate';
    carGoal.endDate = new Date(targetYear, 0, 1);
    carGoal.goalAccountId = 'acc-car-fund';

    it('funds the goal, buys it in the target year, then stops funding', () => {
        const sim = runSimulation(8, [carFund], [income], [living, carGoal], assumptions, taxState)
            .filter(s => !s.isEndOfYearProjection);
        const fundAt = (y: number) =>
            sim.find(s => s.year === y)?.accounts.find(a => a.id === 'acc-car-fund')?.amount ?? 0;

        // The set-aside accrues into the fund before the purchase...
        expect(fundAt(startYear + 1)).toBeGreaterThan(5000);
        // ...the lump is actually spent in the target year...
        expect(sim.some(s => s.logs.some(l => l.includes('came due')))).toBe(true);
        // ...and afterward the fund is NOT refilled: a one-time goal's priority
        // stops, so the balance stays drained instead of growing ~$12k/yr again.
        expect(fundAt(targetYear + 1)).toBeLessThan(1000);
        expect(fundAt(targetYear + 3)).toBeLessThan(1000);
    });

    it('derives funding from the goal, ignoring a stale stored capValue (post-edit state)', () => {
        // Simulate the state after a user edits a goal: the priority created at
        // goal-creation still holds the old capValue snapshot ($10/mo here), but
        // the sim must fund at the rate derived from the goal itself (~$1000/mo).
        const staleAssumptions: AssumptionsState = {
            ...assumptions,
            priorities: [
                { id: 'pri-car', name: 'Car fund', type: 'SAVINGS', accountId: 'acc-car-fund', capType: 'FIXED', capValue: 10 },
            ],
        };
        const sim = runSimulation(8, [carFund], [income], [living, carGoal], staleAssumptions, taxState)
            .filter(s => !s.isEndOfYearProjection);
        const fundAt = (y: number) =>
            sim.find(s => s.year === y)?.accounts.find(a => a.id === 'acc-car-fund')?.amount ?? 0;

        // $10/mo would accrue only ~$120/yr; the derived set-aside accrues ~$12k/yr.
        expect(fundAt(startYear + 1)).toBeGreaterThan(5000);
        expect(sim.some(s => s.logs.some(l => l.includes('came due')))).toBe(true);
    });
});
