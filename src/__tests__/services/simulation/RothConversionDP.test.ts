/**
 * Unit tests for RothConversionDP.
 *
 * Tests the solver against hand-crafted synthetic contexts so we can
 * validate algorithmic behavior (non-negativity, conversion bounds, δ effect
 * on back-loading) independent of the real simulation engine.
 */
import { describe, it, expect } from 'vitest';
import {
    planConversionsViaDP,
    type DPYearContext,
    DP_BACKLOAD_DELTA,
} from '../../../services/simulation/RothConversionDP';
import { TAX_DATABASE } from '../../../data/TaxData';
import { getIRMAASchedule } from '../../../data/IRMAAData';
import { defaultAssumptions } from '../../../components/Objects/Assumptions/AssumptionsContext';
import { makeDPContext } from './dpFixtures';

// ---------------------------------------------------------------------------
// Synthetic context builders
// ---------------------------------------------------------------------------

// This suite's profile: MFJ, 2024 federal params, modest fixed ordinary income,
// no other expenses (so DP optimizes against tax alone), no brokerage, Roth
// grows at the same 7% rate as trad. Built on the shared `makeDPContext` field
// list (src/__tests__/services/simulation/dpFixtures.ts) so a DPYearContext
// shape change updates one place. year/age default to 2030/65 here; the shared
// helper takes them positionally.
function makeContext(overrides: Partial<DPYearContext> = {}): DPYearContext {
    const { year = 2030, age = 65, ...rest } = overrides;
    return makeDPContext(year, age, {
        nonSSOrdinaryIncomeExclRMD: 30_000,
        filingStatus: 'Married Filing Jointly',
        fedParams: TAX_DATABASE.federal[2024]['Married Filing Jointly'],
        acaOptions: undefined,
        rothGrowthRate: 0.07,
        growthRate: 0.07,
        ...rest,
    });
}

/** 30-year retirement, age 65 → 94. RMDs from 73 onward. */
function buildHorizonContexts(): DPYearContext[] {
    const ctxs: DPYearContext[] = [];
    for (let i = 0; i < 30; i++) {
        const age = 65 + i;
        const year = 2030 + i;
        // Distribution-period divisors approximate Uniform Lifetime Table
        const rmdDivisor =
            age >= 73 ? Math.max(8.0, 26.5 - (age - 73) * 0.9) : 0;
        ctxs.push(makeContext({
            year,
            age,
            // Modest baseline: SS at 67, pension flat
            ssBenefits: age >= 67 ? 30_000 : 0,
            nonSSOrdinaryIncomeExclRMD: 30_000,
            rmdDivisor,
        }));
    }
    return ctxs;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

// 2D-state DP backward sweep is materially more expensive than the prior 1D
// solver — typical synthetic-context run is several seconds. Per-describe
// timeout kept generous so individual tests don't trip vitest's 5s default.
describe('planConversionsViaDP', { timeout: 30_000 }, () => {
    it('returns empty plan for empty horizon', () => {
        const plan = planConversionsViaDP({
            contexts: [],
            currentTradBalance: 0,
            currentRothBalance: 0,
        });
        expect(plan.conversionsByYear.size).toBe(0);
        expect(plan.diagnostics.horizonYears).toBe(0);
    });

    it('produces non-negative conversion amounts each year', () => {
        const contexts = buildHorizonContexts();
        const plan = planConversionsViaDP({
            contexts,
            currentTradBalance: 1_500_000,
            currentRothBalance: 100_000,
        });
        for (const amount of plan.conversionsByYear.values()) {
            expect(amount).toBeGreaterThanOrEqual(0);
        }
    });

    it('emits one entry per horizon year', () => {
        const contexts = buildHorizonContexts();
        const plan = planConversionsViaDP({
            contexts,
            currentTradBalance: 1_500_000,
            currentRothBalance: 100_000,
        });
        expect(plan.conversionsByYear.size).toBe(contexts.length);
        expect(plan.diagnostics.perYearAmounts.length).toBe(contexts.length);
    });

    it('proposes meaningful conversions for high-trad / low-current-bracket case', () => {
        const contexts = buildHorizonContexts();
        const plan = planConversionsViaDP({
            contexts,
            currentTradBalance: 2_000_000,
            currentRothBalance: 100_000,
        });
        // Some year should propose a meaningful conversion (>$5k) — otherwise
        // the algorithm is just doing nothing on a case where conversions
        // clearly help.
        const totalConverted = Array.from(plan.conversionsByYear.values())
            .reduce((s, a) => s + a, 0);
        expect(totalConverted).toBeGreaterThan(50_000);
    });

    it('does not propose conversions exceeding the starting trad balance', () => {
        const contexts = buildHorizonContexts();
        const startingTrad = 500_000;
        const plan = planConversionsViaDP({
            contexts,
            currentTradBalance: startingTrad,
            currentRothBalance: 100_000,
        });
        const totalConverted = Array.from(plan.conversionsByYear.values())
            .reduce((s, a) => s + a, 0);
        // Account for growth: total conversions can exceed starting balance
        // because the trad grows year-over-year. But individual years should
        // never exceed that year's available balance.
        for (const entry of plan.diagnostics.perYearAmounts) {
            expect(entry.amount).toBeLessThanOrEqual(entry.estimatedTradBalance + 1);
        }
        // Sanity: total over lifetime stays within reasonable multiple of starting.
        expect(totalConverted).toBeLessThan(startingTrad * 4);
    });

    it('fills bracket space even when no brokerage exists (regression: removed hard cap)', () => {
        // Setup: 30-year horizon with $2M trad. RMDs at 73 push the user
        // deep into the 22% federal bracket — converting now while they're
        // in a lower bracket is the textbook win. Pre-fix, the hard cap
        // (conversionTax ≤ brokerageSlack × 1.2) rejected every conversion
        // beyond the std-ded headroom, so DP picked tiny amounts and the
        // trad ballooned. Post-fix, DP should fill bracket space sized to
        // future RMD pressure.
        const contexts = buildHorizonContexts();
        const plan = planConversionsViaDP({
            contexts,
            currentTradBalance: 2_000_000,
            currentRothBalance: 100_000,
        });

        // At least one year should pick a conversion well above the std-ded
        // headroom (which is ~$29k MFJ). $50k+ exercises the cap-removal.
        const maxYearly = Math.max(...Array.from(plan.conversionsByYear.values()));
        expect(maxYearly).toBeGreaterThan(50_000);
    });

    it('higher δ produces a more back-loaded plan than δ = 0', () => {
        const contexts = buildHorizonContexts();
        const planNoDelta = planConversionsViaDP({
            contexts,
            currentTradBalance: 1_500_000,
            currentRothBalance: 100_000,
            backloadDelta: 0,
        });
        const planHighDelta = planConversionsViaDP({
            contexts,
            currentTradBalance: 1_500_000,
            currentRothBalance: 100_000,
            backloadDelta: 0.05, // exaggerated for test signal
        });

        // Compare share of conversions in the first half vs second half of
        // horizon. With δ = 0, optimizer mildly front-loads (Roth growth
        // arbitrage). With high δ, it should push more weight to later years.
        const halfIdx = Math.floor(contexts.length / 2);
        const sumFirstHalf = (plan: typeof planNoDelta) =>
            plan.diagnostics.perYearAmounts
                .slice(0, halfIdx)
                .reduce((s, e) => s + e.amount, 0);
        const sumSecondHalf = (plan: typeof planNoDelta) =>
            plan.diagnostics.perYearAmounts
                .slice(halfIdx)
                .reduce((s, e) => s + e.amount, 0);

        const noDeltaFront = sumFirstHalf(planNoDelta);
        const noDeltaBack = sumSecondHalf(planNoDelta);
        const highDeltaFront = sumFirstHalf(planHighDelta);
        const highDeltaBack = sumSecondHalf(planHighDelta);

        const noDeltaFrontShare =
            noDeltaFront / Math.max(1, noDeltaFront + noDeltaBack);
        const highDeltaFrontShare =
            highDeltaFront / Math.max(1, highDeltaFront + highDeltaBack);

        // High δ pushes weight toward back → smaller front share.
        expect(highDeltaFrontShare).toBeLessThan(noDeltaFrontShare + 0.01);
    });

    it('defaults backloadDelta to DP_BACKLOAD_DELTA constant', () => {
        const contexts = buildHorizonContexts();
        const plan = planConversionsViaDP({
            contexts,
            currentTradBalance: 1_000_000,
            currentRothBalance: 100_000,
        });
        expect(plan.diagnostics.backloadDelta).toBe(DP_BACKLOAD_DELTA);
    });

    it('completes within a reasonable bound on a realistic 30-year horizon', () => {
        const contexts = buildHorizonContexts();
        const plan = planConversionsViaDP({
            contexts,
            currentTradBalance: 2_000_000,
            currentRothBalance: 100_000,
        });
        // Generous bound — flagged if anything regresses badly. The 2D
        // (trad × roth) backward sweep is the dominant cost; current grid
        // (TRAD=100, ROTH=50, CONV=200) lands around 4-5s on a typical
        // 30-yr horizon. Threshold is 2× that to avoid flakes on slow CI.
        expect(plan.diagnostics.elapsedMs).toBeLessThan(15_000);
    });

    it('per-year conversion grid reaches above the year-0 ceiling in late years (frozen-dC fix)', () => {
        // Regression for the frozen-dC bug. Pre-fix, `dC` was a single scalar
        // computed once from the YEAR-0 trad balance:
        //   dC = min(startingTrad, $500k) / CONVERSION_BUCKETS
        // so the largest conversion candidate offered in EVERY year was the
        // frozen year-0 ceiling `200·dC = min(startingTrad, $500k)`. A
        // portfolio that starts below the $500k cap and then GROWS past it
        // could never have conversions between that frozen ceiling and a later
        // cell's true cMax evaluated — the backward sweep's V-table (and thus
        // the optimum) was silently truncated in late years.
        //
        // Post-fix, `dCByYear[t]` scales to year t's reachable trad balance
        // (same cap/floor, applied per year off the projected balance). For a
        // small-start, high-growth, long-horizon portfolio the late-year grid
        // ceiling must therefore exceed the year-0 ceiling — i.e. the late-year
        // band that was previously unreachable is now in the search space.
        const startingTrad = 400_000; // below the $500k cap
        const contexts: DPYearContext[] = [];
        for (let i = 0; i < 40; i++) {
            const age = 60 + i;
            const year = 2030 + i;
            const rmdDivisor =
                age >= 73 ? Math.max(8.0, 26.5 - (age - 73) * 0.9) : 0;
            contexts.push(makeContext({
                year,
                age,
                ssBenefits: age >= 67 ? 30_000 : 0,
                nonSSOrdinaryIncomeExclRMD: 30_000,
                rmdDivisor,
                // Aggressive net growth so the reachable trad balance compounds
                // well past the $400k year-0 ceiling within the horizon.
                growthRate: 0.10,
                rothGrowthRate: 0.10,
            }));
        }

        const plan = planConversionsViaDP({
            contexts,
            currentTradBalance: startingTrad,
            currentRothBalance: 50_000,
        });

        const dCByYear = plan.diagnostics.dCByYear;
        const convBuckets = plan.diagnostics.conversionBuckets;

        // Sanity: per-year conversion grid is plumbed through, one entry per
        // V-table slice (horizonYears + 1).
        expect(dCByYear.length).toBe(contexts.length + 1);

        // The OLD frozen ceiling: the single year-0 value the pre-fix code used
        // for every year. With a $400k start (< $500k cap) this is $400k.
        const oldFrozenCeiling = dCByYear[0] * convBuckets;
        expect(oldFrozenCeiling).toBeCloseTo(Math.min(startingTrad, 500_000), -2);

        // The fix: at least one LATE year (age ≥ 75) offers a conversion
        // candidate band that extends strictly above the old frozen ceiling —
        // exactly the region the pre-fix grid could never evaluate. (The grid
        // is capped at $500k, so the late ceiling lands between $400k and
        // $500k.) Map age → horizon index t (age 75 = index 15).
        const lateGridCeilings = dCByYear
            .map((dc, t) => ({ t, ceiling: dc * convBuckets }))
            // index t corresponds to age 60 + t (contexts start at age 60).
            .filter(({ t }) => 60 + t >= 75 && t < contexts.length);
        const aboveOld = lateGridCeilings.filter(
            ({ ceiling }) => ceiling > oldFrozenCeiling + 1,
        );
        expect(aboveOld.length).toBeGreaterThan(0);
        // And the widest late-year band reaches the cap, well above the old
        // frozen ceiling.
        const maxLateCeiling = Math.max(...lateGridCeilings.map(c => c.ceiling));
        expect(maxLateCeiling).toBeGreaterThan(oldFrozenCeiling);

        // Forward-plan invariant still holds: no chosen conversion exceeds its
        // year's reachable trad balance (the per-cell cMax bound is intact).
        for (const e of plan.diagnostics.perYearAmounts) {
            expect(e.amount).toBeLessThanOrEqual(e.estimatedTradBalance + 1);
        }
    });

    it('plumbs Roth grid scaffolding through diagnostics (Phase 1)', () => {
        const contexts = buildHorizonContexts();
        const plan = planConversionsViaDP({
            contexts,
            currentTradBalance: 1_500_000,
            currentRothBalance: 250_000,
        });
        // Phase 1 scaffolding for the 3D state extension. The solver does
        // not yet read these — this test guards against the wiring being
        // dropped before Phase 4 lands.
        expect(plan.diagnostics.rothBuckets).toBe(50);
        expect(plan.diagnostics.maxRoth).toBeGreaterThan(250_000);
        expect(plan.diagnostics.dRoth).toBeGreaterThan(0);
        expect(plan.diagnostics.dRoth).toBe(plan.diagnostics.maxRoth / 50);
    });

    // #76 — tail IRMAA skip. IRMAA bills on a 2-year lag, so a conversion that
    // spikes MAGI in one of the last two horizon years would bill its surcharge
    // two years out — past the simulated horizon — and the real engine never
    // charges it. The DP prices IRMAA same-year, which without this fix would
    // charge that phantom surcharge and over-penalize end-of-life conversions
    // (working against the back-load preference). The solver now drops the IRMAA
    // term for the last 2 horizon years.
    //
    // We build a long horizon where IRMAA genuinely bites (RMDs + conversions
    // push MAGI across the surcharge cliffs) and compare two solver runs that
    // differ ONLY in whether a steep IRMAA closure is attached to every Medicare
    // year. The tail-skip's signature: because the solver drops IRMAA for the
    // last 2 years in BOTH runs, the last-2-year conversions are IDENTICAL
    // across the two runs (the phantom surcharge can't touch them), while an
    // INTERIOR Medicare year — where the surcharge IS priced — is demonstrably
    // suppressed by it. That contrast proves the closure is capable of biting
    // AND that the tail is genuinely exempted, so end-of-life conversions look
    // at least as attractive as in the no-surcharge world.
    it('does not let a phantom (never-billed) IRMAA surcharge suppress the last 2 years (#76 tail skip)', () => {
        // Single filer: IRMAA tier-1 cliff at $109k MAGI, with a $1k+/yr jump —
        // steep enough to swing a conversion decision when it applies.
        const irmaaSchedule = getIRMAASchedule('Single', 2030, {
            ...defaultAssumptions,
            macro: { ...defaultAssumptions.macro, inflationAdjusted: false, inflationRate: 0 },
        });
        const fedParams = TAX_DATABASE.federal[2024]['Single'];

        // 30-year horizon, ages 65-94. Ordinary income sits a touch under the
        // IRMAA tier-1 cliff, so any conversion that's priced same-year trips it.
        // Large trad balance + RMDs from 73 give the DP a clear (front-loaded
        // here, but tail-relevant) conversion incentive; an exaggerated δ adds a
        // back-load pull so the tail-vs-interior contrast is sharp.
        const buildIrmaaHorizon = (withIrmaa: boolean): DPYearContext[] => {
            const ctxs: DPYearContext[] = [];
            for (let i = 0; i < 30; i++) {
                const age = 65 + i;
                const year = 2030 + i;
                const rmdDivisor =
                    age >= 73 ? Math.max(8.0, 26.5 - (age - 73) * 0.9) : 0;
                ctxs.push(makeContext({
                    year,
                    age,
                    filingStatus: 'Single',
                    fedParams,
                    // Sit just under the $109k tier-1 cliff so even a modest
                    // conversion trips it when IRMAA is priced this year.
                    nonSSOrdinaryIncomeExclRMD: 100_000,
                    ssBenefits: 0,
                    rmdDivisor,
                    irmaaSurchargeForMAGI: withIrmaa
                        ? (magi: number) => irmaaSchedule.annualSurcharge(magi)
                        : undefined,
                }));
            }
            return ctxs;
        };

        const common = {
            currentTradBalance: 1_500_000,
            currentRothBalance: 100_000,
            backloadDelta: 0.05, // exaggerate the back-load pull toward the tail
        };

        const withIrmaa = planConversionsViaDP({ ...common, contexts: buildIrmaaHorizon(true) });
        const noIrmaa = planConversionsViaDP({ ...common, contexts: buildIrmaaHorizon(false) });

        const lastYear = 2030 + 29;
        const secondLastYear = 2030 + 28;
        // An interior Medicare year where the surcharge demonstrably bites (the
        // diagnosed scenario suppresses ages 75-79 hard; age 77 is comfortably
        // interior, far from the tail-skip window).
        const interiorBittenYear = 2030 + 12; // age 77

        const convAt = (p: typeof withIrmaa, yr: number) =>
            p.conversionsByYear.get(yr) ?? 0;

        // Tail (last 2 years): the solver drops the IRMAA term, so attaching the
        // surcharge closure must not change the chosen conversion at all — the
        // two runs agree to the dollar. This is the core anti-phantom assertion:
        // the never-billed surcharge does NOT alter end-of-life conversions.
        expect(convAt(withIrmaa, lastYear)).toBeCloseTo(convAt(noIrmaa, lastYear), 2);
        expect(convAt(withIrmaa, secondLastYear)).toBeCloseTo(convAt(noIrmaa, secondLastYear), 2);

        // Stated directly: the tail conversions look AT LEAST as attractive with
        // the phantom surcharge removed as without it (equality is the achieved
        // case; this guards against any future regression that would re-penalize
        // the tail and shrink these below the no-surcharge baseline).
        const tailTotal = (p: typeof withIrmaa) =>
            convAt(p, lastYear) + convAt(p, secondLastYear);
        expect(tailTotal(withIrmaa)).toBeGreaterThanOrEqual(tailTotal(noIrmaa) - 1);

        // Non-vacuousness: the same surcharge closure genuinely SUPPRESSES an
        // interior Medicare year's conversion (where IRMAA is NOT skipped). If
        // this failed, the tail equality above would be meaningless (IRMAA never
        // mattering anywhere). This is the contrast that demonstrates the tail
        // is being deliberately exempted from a penalty that bites elsewhere.
        expect(convAt(withIrmaa, interiorBittenYear))
            .toBeLessThan(convAt(noIrmaa, interiorBittenYear));
    });
});
