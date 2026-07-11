/**
 * #161 — dead-cash deployment regression.
 *
 * Under Tax Optimization the planner used to re-bucket every withdrawal order so ALL
 * SavedAccounts landed BEHIND all non-penalized invested accounts (a legacy "emergency
 * fund preservation" principle from the Feb-2026 engine rewrite) — contradicting
 * Auto-sort's WITHDRAWAL_TAX_RANK (savings first: $0 tax, $0 MAGI) and the joint
 * optimizer's candidate sequences (all cash-first). Because no engine mechanism ever
 * deploys an existing cash balance otherwise, cash idled for the entire horizon on any
 * household whose deficits a growing brokerage could cover — until a big-tax year (an
 * ACA-cliff-crossing conversion) capped brokerage sales and the funding cascade finally
 * spent it. That deployment was a funding-path WINDFALL credited to whichever plan
 * caused it: on this fixture, a +$100k cliff-crossing conversion appeared to GAIN
 * +$68,481 of terminal after-tax net worth (the engine-direct conversion search scores
 * plans on this same engine, so it could recommend a conversion whose "gain" was mostly
 * the forced deployment of dead cash).
 *
 * With #161 fixed (savings leads the non-penalized tier on the optimizer-owned path):
 *   1. the floor arm's cash deploys for ordinary living expenses within the first
 *      retirement years (measured: $60k → $5k → $0 over 2026-2028), so nothing is left
 *      for a big-tax year to "discover";
 *   2. the floor-vs-(floor+$100k) gap flips NEGATIVE — the conversion is taxed at
 *      12-22% plus the real pre-65 ACA cliff cost against a ~0-10% exit, a genuine
 *      loss once the funding-path windfall is gone (measured ≈ −$188k at the horizon;
 *      the assertions pin sign + a generous band, not the exact number).
 *
 * Both arms score HIGHER post-fix than pre-fix (floor +$381k, +100k arm +$124k) —
 * cash-first is the cheapest possible funding source, so the fix is weakly better for
 * every tax-opt scenario; only the artificial GAP collapses.
 */
import { describe, it, expect } from 'vitest';
import {
    makeLowBracketBrokerageScenario,
    stdDedOnlyPlan,
    scorePlan,
    realYears,
    type ConversionPlan,
} from './harness';
import { runSimulation } from '../../components/Objects/Assumptions/useSimulation';
import { SavedAccount } from '../../components/Objects/Accounts/models';

describe('#161 — tax-opt deploys idle cash instead of hoarding it for a big-tax year', () => {
    const sc = makeLowBracketBrokerageScenario();
    const floorPlan = stdDedOnlyPlan(sc);

    // ONE shared ruler from the floor arm's timeline (mirrors feasibilityFloor) so the
    // two plans are scored apples-to-apples.
    const floorTimeline = runSimulation(
        sc.yearsToRun, sc.accounts, sc.incomes, sc.expenses,
        sc.assumptions, sc.taxState, undefined, { dpConversionPlan: floorPlan },
    );

    it('the floor arm spends its savings for living expenses within the first retirement years', () => {
        const reals = realYears(floorTimeline);
        const cashAt = (i: number) =>
            reals[i].accounts.find(a => a instanceof SavedAccount)?.amount ?? NaN;

        // Starts at the fixture's $60k...
        expect(cashAt(0)).toBeGreaterThan(50_000);
        // ...and is essentially GONE by the third real year (pre-fix it sat at $60k for
        // all 37 years). 10% of the starting balance is a generous ceiling; measured $0.
        expect(cashAt(2)).toBeLessThan(6_000);
    });

    it('a +$100k ACA-cliff-crossing conversion now scores a genuine LOSS, not a windfall', () => {
        const floor = scorePlan(sc, floorPlan, floorTimeline);

        // Second gap year (conversions never execute in the first simulated year — see
        // RothRulerInvariances). On this pre-65 household the +$100k crosses the ACA
        // cliff, which is exactly the big-tax year that used to force the dead cash out.
        const years = [...floorPlan.keys()].sort((a, b) => a - b);
        const plus: ConversionPlan = new Map(floorPlan);
        plus.set(years[1], (plus.get(years[1]) ?? 0) + 100_000);
        const candidate = scorePlan(sc, plus, floorTimeline);

        const gap = candidate.terminalAfterTaxNW - floor.terminalAfterTaxNW;
        // Sign is the claim: converting $100k at 12-22% + the ACA cliff against a
        // ~0-10% exit must HURT. Pre-fix this gap was +$68,481 (pure funding-path
        // artifact). Measured post-fix ≈ −$187,744; the band is deliberately generous
        // (−$800k .. −$50k) — it pins direction and order of magnitude only.
        expect(gap).toBeLessThan(-50_000);
        expect(gap).toBeGreaterThan(-800_000);
    });
});
