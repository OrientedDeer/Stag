/**
 * Milestone-started RSU grants vest off the milestone-resolved start year (#131).
 *
 * A WorkIncome can start either via a fixed `startDate` OR via a milestone
 * (`startMilestoneId`, with `startDate` left undefined). Before #131, salary
 * projected for a milestone-started job once the milestone fired, but its RSUs
 * NEVER vested: both `processRSUVesting` and `WorkIncome.getRSUVestEventsForYear`
 * hard-bailed on `!startDate`, and nothing materialized a concrete grant date.
 *
 * The fix anchors the vest schedule to **Jan 1 of the milestone-resolved start
 * year** (no new model field): the year the milestone fires in a given path.
 * Each tranche's vest date is then grant-date (the anchor) + yearOffset, exactly
 * as for a fixed-startDate grant.
 *
 * Decision (settled): anchor = Jan 1 of the resolved year. In Monte Carlo a
 * net-worth-type milestone fires in different years on different paths, so the
 * schedule re-anchors per path — that is accepted and consistent with how the
 * same milestone already gates the salary in/out per path.
 *
 * These tests pin: (1) the model-level anchorDate param on
 * getRSUVestEventsForYear, (2) the service resolving a milestone start to Jan 1
 * of the reached year, (3) the engine end-to-end vesting a milestone-started
 * grant the year after the milestone fires, and (4) the edges (never fires →
 * no vest; fires near horizon → truncated, no crash).
 */
import { describe, it, expect } from 'vitest';

import { RSUAccount } from '../../../components/Objects/Accounts/models';
import { WorkIncome } from '../../../components/Objects/Income/models';
import { processRSUVesting } from '../../../services/simulation/RSUVesting';
import { simulateOneYear } from '../../../components/Objects/Assumptions/SimulationEngine';
import {
    type AssumptionsState,
    defaultAssumptions,
    createBuiltinMilestones,
} from '../../../components/Objects/Assumptions/AssumptionsContext';
import { type TaxState } from '../../../components/Objects/Taxes/TaxContext';
import { OtherExpense } from '../../../components/Objects/Expense/models';
import { type CustomMilestone } from '../../../services/simulation/types';

const BIRTH_YEAR = 1985; // age 40 in 2025 — well before retirement, so working years.

// A custom milestone that fires once YEAR >= the given year.
function yearMilestone(id: string, year: number): CustomMilestone {
    return { id, name: id, conditions: [{ type: 'YEAR', operator: '>=', value: year }] };
}

function makeAssumptions(extraMilestones: CustomMilestone[] = []): AssumptionsState {
    return {
        ...defaultAssumptions,
        milestones: [...createBuiltinMilestones(BIRTH_YEAR, 65, 95), ...extraMilestones],
        macro: { ...defaultAssumptions.macro, inflationAdjusted: false, inflationRate: 0 },
        investments: { ...defaultAssumptions.investments, taxOptimizationEnabled: false, returnRates: { ror: 0 } },
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

// A milestone-started WorkIncome with a fully-configured RSU grant: NO startDate,
// a startMilestoneId instead. Cliff-1yr / 100 shares, $100/share, 0% growth so a
// vest is exactly 100 × $100 = $10,000 gross. Built by field assignment (not the
// long positional constructor) to keep the fixture robust.
function makeMilestoneRSUWork(startMilestoneId: string): WorkIncome {
    const inc = new WorkIncome(
        'work-1', 'Job', 100000, 'Annually', 'Yes',
        0, 0, 0, 0, '', null, 'FIXED', undefined, undefined,
    );
    inc.rsuVestingSchedule = 'cliff-1yr';
    inc.rsuGrantShares = 100;
    inc.rsuVestFrequency = 'quarterly';
    inc.rsuExpectedStockGrowth = 0;
    inc.rsuAccountId = 'rsu-1';
    inc.rsuWithholdingRate = 37;
    inc.startMilestoneId = startMilestoneId;
    return inc;
}

function makeRSUAccount(currentSharePrice: number | undefined = 100): RSUAccount {
    return new RSUAccount('rsu-1', 'My RSU', 0, [], 'work-1', undefined, 'TICK', currentSharePrice);
}

// ===========================================================================
// (1) Model-level: getRSUVestEventsForYear accepts an anchor date
// ===========================================================================
describe('WorkIncome.getRSUVestEventsForYear — anchorDate (milestone start)', () => {
    it('vests off the supplied anchor date when there is no fixed startDate', () => {
        const inc = makeMilestoneRSUWork('M');
        expect(inc.startDate).toBeUndefined();

        // No anchor and no startDate → nothing vests (cannot schedule).
        expect(inc.getRSUVestEventsForYear(2031).length).toBe(0);

        // Anchor at Jan 1 2030 → a cliff-1yr grant vests in 2031.
        const anchor = new Date(2030, 0, 1);
        expect(inc.getRSUVestEventsForYear(2030, anchor).length).toBe(0); // grant year, not yet
        const events = inc.getRSUVestEventsForYear(2031, anchor);
        expect(events.length).toBe(1);
        expect(events[0].shares).toBeCloseTo(100, 4);
        // Vest date is Jan 1 2031 (anchor Jan 1 2030 + 1yr).
        expect(events[0].vestDate.getFullYear()).toBe(2031);
        expect(events[0].vestDate.getMonth()).toBe(0);
    });

    it('still honors a fixed startDate when no anchor is passed (unchanged behavior)', () => {
        const inc = new WorkIncome(
            'work-1', 'Job', 100000, 'Annually', 'Yes',
            0, 0, 0, 0, '', null, 'FIXED', new Date(2025, 0, 1), undefined,
        );
        inc.rsuVestingSchedule = 'cliff-1yr';
        inc.rsuGrantShares = 100;
        inc.rsuAccountId = 'rsu-1';
        // cliff-1yr off a 2025 start vests in 2026, untouched by the new param.
        expect(inc.getRSUVestEventsForYear(2026).length).toBe(1);
        expect(inc.getRSUVestEventsForYear(2025).length).toBe(0);
    });
});

// ===========================================================================
// (2) Service-level: processRSUVesting resolves a milestone start to Jan 1
// ===========================================================================
describe('processRSUVesting — milestone-started grant', () => {
    it('vests a milestone-started grant anchored to Jan 1 of the resolved year', () => {
        const inc = makeMilestoneRSUWork('M');
        const acc = makeRSUAccount(100);
        const logs: string[] = [];

        // Milestone resolved to start year 2030. Cliff vests in 2031.
        const resolve = (id: string) => (id === 'M' ? 2030 : undefined);
        const result = processRSUVesting([inc], [acc], 2031, 2025, logs, resolve);

        expect(result.vestIncomes.length).toBe(1);
        // 100 shares × $100 = $10,000 gross (compounded 0% growth).
        expect(result.vestIncomes[0].amount).toBeCloseTo(10000, 2);
        expect(result.vestIncomes[0].sourceType).toBe('RSU');
        // Net lot: 100 × (1 - 0.37) = 63 shares, grantDate = the anchor (Jan 1 2030).
        const lot = result.rsuLots['rsu-1'][0];
        expect(lot.shares).toBeCloseTo(63, 4);
        expect(lot.grantDate.getFullYear()).toBe(2030);
        expect(lot.grantDate.getMonth()).toBe(0);
    });

    it('does NOT vest a milestone-started grant before the milestone resolves', () => {
        const inc = makeMilestoneRSUWork('M');
        const acc = makeRSUAccount(100);
        const logs: string[] = [];
        // Milestone has not fired → resolver returns undefined → no anchor → no vest.
        const resolve = () => undefined;
        const result = processRSUVesting([inc], [acc], 2031, 2025, logs, resolve);
        expect(result.vestIncomes.length).toBe(0);
        expect(result.totalWithholding).toBe(0);
        expect(result.rsuLots['rsu-1']).toBeUndefined();
    });

    it('does NOT vest in the milestone-resolved year itself (cliff is a year later)', () => {
        const inc = makeMilestoneRSUWork('M');
        const acc = makeRSUAccount(100);
        const logs: string[] = [];
        const resolve = (id: string) => (id === 'M' ? 2030 : undefined);
        // Year 2030 is the anchor year; cliff-1yr vests in 2031, not 2030.
        const result = processRSUVesting([inc], [acc], 2030, 2025, logs, resolve);
        expect(result.vestIncomes.length).toBe(0);
    });
});

// ===========================================================================
// (3) Engine end-to-end: a milestone-started grant vests after the milestone
// ===========================================================================
describe('simulateOneYear — milestone-started RSU grant vests (#131)', () => {
    // Engine-level: a vest deposits net-share lots into the RSU account, so the
    // account's balance / share count goes positive in the vest year. (RSU vest
    // income is synthetic and surfaced via allIncomes, not the persisted incomes
    // array — the durable, observable signal is the RSU account growth, the same
    // way the existing RSU end-to-end test asserts.)
    function rsuAccountOf(result: { accounts: { id: string }[] }): RSUAccount {
        const acc = result.accounts.find(a => a instanceof RSUAccount) as RSUAccount | undefined;
        if (!acc) throw new Error('RSU account missing from result');
        return acc;
    }

    it('vests the year after a milestone fires (resolved year carried via reach map)', () => {
        const milestone = yearMilestone('M', 2030); // fires once YEAR >= 2030
        const inc = makeMilestoneRSUWork('M');
        const acc = makeRSUAccount(100);
        // A trivial expense keeps the engine on its normal path.
        const expense = new OtherExpense('e1', 'none', 0, 'Annually', new Date(2020, 0, 1));

        // Simulate 2031. The milestone fired in 2030 (a prior loop iteration), so
        // its reached year is supplied via previousMilestoneReachYears. The grant
        // is anchored to Jan 1 2030; the cliff vests in 2031.
        const reachYears = new Map<string, number>([['M', 2030]]);
        const result = simulateOneYear(
            2031, [inc], [expense], [acc],
            makeAssumptions([milestone]), makeTaxState(2031),
            [], undefined,
            ['M'],         // previously-active milestones (already reached)
            reachYears,    // previousMilestoneReachYears: M reached in 2030
        );

        // The cliff vested: net shares (100 × (1 - 0.37) = 63) landed in the RSU
        // account, so it now holds value and shares.
        const rsu = rsuAccountOf(result);
        expect(rsu.totalShares).toBeGreaterThan(0);
        expect(rsu.totalShares).toBeCloseTo(63, 4);
        expect(rsu.amount).toBeGreaterThan(0);
    });

    it('does NOT vest when the milestone has never fired (no anchor → $0 RSU)', () => {
        const milestone = yearMilestone('M', 9999); // never fires in-horizon
        const inc = makeMilestoneRSUWork('M');
        const acc = makeRSUAccount(100);
        const expense = new OtherExpense('e1', 'none', 0, 'Annually', new Date(2020, 0, 1));

        const result = simulateOneYear(
            2031, [inc], [expense], [acc],
            makeAssumptions([milestone]), makeTaxState(2031),
            [], undefined,
            [],                 // no milestones active
            new Map(),          // none reached
        );

        // No anchor → no vest → the RSU account stays empty.
        const rsu = rsuAccountOf(result);
        expect(rsu.totalShares).toBe(0);
        expect(rsu.amount).toBe(0);
    });
});

// ===========================================================================
// (4) Edges
// ===========================================================================
describe('processRSUVesting — milestone-start edges', () => {
    it('truncates tranches that fall past the requested year (no crash near horizon)', () => {
        // graded-4yr quarterly off a late anchor: ask for a year that has no
        // tranche → empty, no throw.
        const inc = makeMilestoneRSUWork('M');
        inc.rsuVestingSchedule = 'graded-4yr';
        inc.rsuGrantShares = 160;
        const acc = makeRSUAccount(100);
        const logs: string[] = [];
        const resolve = (id: string) => (id === 'M' ? 2090 : undefined);

        // Year 2089 (before the anchor) → no events, no crash.
        expect(() =>
            processRSUVesting([inc], [acc], 2089, 2025, logs, resolve),
        ).not.toThrow();
        const before = processRSUVesting([inc], [acc], 2089, 2025, logs, resolve);
        expect(before.vestIncomes.length).toBe(0);

        // Year 2091 → the first graded tranches land (within the 4-year window).
        const within = processRSUVesting([inc], [acc], 2091, 2025, logs, resolve);
        expect(within.vestIncomes.length).toBe(1);
    });

    it('leaves a fixed-startDate grant unaffected by the resolver', () => {
        // A grant WITH a fixed startDate ignores the resolver entirely.
        const inc = new WorkIncome(
            'work-1', 'Job', 100000, 'Annually', 'Yes',
            0, 0, 0, 0, '', null, 'FIXED', new Date(2025, 0, 1), undefined,
        );
        inc.rsuVestingSchedule = 'cliff-1yr';
        inc.rsuGrantShares = 100;
        inc.rsuAccountId = 'rsu-1';
        const acc = makeRSUAccount(100);
        const logs: string[] = [];
        // Resolver would say 2050, but the fixed startDate (2025) wins → vest 2026.
        const resolve = () => 2050;
        const result = processRSUVesting([inc], [acc], 2026, 2025, logs, resolve);
        expect(result.vestIncomes.length).toBe(1);
    });
});
