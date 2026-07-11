/**
 * Story: Long-Term Goal Sinking Fund (Phase 6)
 *
 * Scenario: A recurring big-ticket goal (e.g. replace the roof every 3 years)
 * funded by a monthly set-aside into a reserved sinking-fund SavedAccount.
 *
 * Goal funding is COMMITTED: the engine counts the set-aside with living
 * expenses (like any bill) and credits the fund directly — it is NOT a
 * surplus-allocation priority, so it doesn't depend on bucket order or
 * surplus availability.
 *
 * Key Assertions:
 * - The set-aside is committed spending; the full goal cost (the lump) never
 *   inflates living expenses — it's paid from the fund.
 * - The sinking-fund account accrues the set-aside year over year.
 * - In the goal's due year the lump is spent from the fund (balance drops
 *   sharply), then it starts accruing again toward the next cycle.
 */

import { describe, it, expect } from 'vitest';
import { type AssumptionsState, defaultAssumptions, createBuiltinMilestones } from '../../../components/Objects/Assumptions/AssumptionsContext';
import { type TaxState } from '../../../components/Objects/Taxes/TaxContext';
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
        // Legacy-shaped data: goals used to create a savings priority. The
        // engine must zero this bucket (funding is committed now) — keeping it
        // here guards against double-funding pre-migration data.
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

    it('counts the committed set-aside with living expenses — never the full goal cost', () => {
        const sim = realYears();
        // $20k living + $12k/yr committed set-aside ≈ $32k. The $36k lump must
        // never be counted as spending (it's paid from the reserved fund), and
        // exactly one set-aside must be counted (legacy bucket zeroed — no
        // double-funding). The first row is the current-year baseline (not a
        // projected year), so assert from the first projected year onward.
        for (const s of sim.filter(s => s.year > startYear)) {
            expect(s.cashflow.livingExpenses).toBeGreaterThan(30000);
            expect(s.cashflow.livingExpenses).toBeLessThan(36000);
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

    it('funds at the goal-derived rate even when a legacy bucket holds a stale capValue', () => {
        // Pre-migration data: the bucket created at goal-creation still holds a
        // stale capValue snapshot ($10/mo). Funding is committed and derived
        // from the goal itself, and the legacy bucket is zeroed — exactly one
        // goal-rate set-aside lands in the fund (no $10/mo on top).
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

        // $10/mo would accrue only ~$120/yr; the derived set-aside accrues ~$18k/yr.
        expect(fundAt(startYear + 1)).toBeGreaterThan(5000);
        expect(sim.some(s => s.logs.some(l => l.includes('came due')))).toBe(true);
    });

    it('funds the goal with a REMAINDER sweep and no goal bucket at all (committed funding)', () => {
        // The new world: goals create NO priority bucket. Even with an
        // "everything remaining" sweep swallowing all surplus, the committed
        // set-aside still lands in the fund and the purchase fires.
        const sweepAcct = new SavedAccount('acc-sweep', 'Sweep', 0, 0);
        const withSweep: AssumptionsState = {
            ...assumptions,
            priorities: [
                { id: 'pri-sweep', name: 'Sweep (REMAINDER)', type: 'SAVINGS', accountId: 'acc-sweep', capType: 'REMAINDER' },
            ],
        };
        const sim = runSimulation(8, [carFund, sweepAcct], [income], [living, carGoal], withSweep, taxState)
            .filter(s => !s.isEndOfYearProjection);
        const fundAt = (y: number) =>
            sim.find(s => s.year === y)?.accounts.find(a => a.id === 'acc-car-fund')?.amount ?? 0;

        expect(fundAt(startYear + 1)).toBeGreaterThan(5000);
        expect(sim.some(s => s.logs.some(l => l.includes('came due')))).toBe(true);
    });

    it('with no priorities, the smart-default allocator must not stuff surplus into the reserved fund', () => {
        // The goal fund is the ONLY SavedAccount here — without the reservation
        // the allocator's no-priorities smart-default would treat it as "the
        // emergency fund" and pile general surplus on top of the committed
        // set-aside. The fund must receive exactly the goal-derived amount
        // (36000 over 24 months = $18k/yr; first projected year is startYear+1).
        const noPriorities: AssumptionsState = { ...assumptions, priorities: [] };
        const sim = runSimulation(8, [carFund], [income], [living, carGoal], noPriorities, taxState)
            .filter(s => !s.isEndOfYearProjection);
        const fundAt = (y: number) =>
            sim.find(s => s.year === y)?.accounts.find(a => a.id === 'acc-car-fund')?.amount ?? 0;

        expect(fundAt(startYear + 1)).toBeGreaterThan(17000);
        expect(fundAt(startYear + 1)).toBeLessThan(19000);
    });
});
