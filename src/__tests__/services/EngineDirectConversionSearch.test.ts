/**
 * Unit tests for the engine-direct conversion search MECHANICS (fp-review 2026-07-02, F8/F9).
 *
 * The search module takes DP contexts + an injected `scorePlan` closure, so its candidate
 * generation and selection logic is testable with a SYNTHETIC scorer — no engine replays.
 * (The economics — that the search hits the wealth peak on real profiles — are covered by
 * the certification panel in RothConversionFeasibilityFloor.test.ts; these tests pin the
 * search-structure invariants that panel cannot see:)
 *
 *   F8 — when a SEED plan wins, scaled variants (×0.8/0.9/1.1/1.2) are scored as candidates
 *        (production-invariant "the shipped seed plan is a local scaling peak"), a winning
 *        scaled variant becomes the result, one recursive pass extends around the new winner,
 *        and the returned timeline is the scored replay of the exact returned plan.
 *   F9 — the coarse h-grid probes IRMAA tier thresholds and the ACA 400%-FPL cliff (mapped
 *        into h-space, threshold − ε) when the contexts carry those cliffs.
 */
import { describe, it, expect } from 'vitest';
import {
    searchConversionPlanByEngine,
    computeCliffHeadroomProbes,
    ConversionPlanScore,
} from '../../services/simulation/EngineDirectConversionSearch';
import { DPYearContext } from '../../services/simulation/RothConversionDP';
import { TaxParameters } from '../../data/TaxData';
import { SimulationYear } from '../../services/simulation/types';

const YEAR1 = 2031;
const YEAR2 = 2032;
const STD_DED = 15_000;

const fedParams: TaxParameters = {
    standardDeduction: STD_DED,
    brackets: [
        { threshold: 0, rate: 0.10 },
        { threshold: 20_000, rate: 0.12 },
        { threshold: 80_000, rate: 0.22 },
        { threshold: 100_000, rate: 0.24 },
        { threshold: 200_000, rate: 0.32 },
        { threshold: 250_000, rate: 0.35 }, // grid cap — tops ≤ 250k are grid points
        { threshold: 600_000, rate: 0.37 },
    ],
    socialSecurityTaxRate: 0.062,
    socialSecurityWageBase: 160_000,
    medicareTaxRate: 0.0145,
};

function makeCtx(year: number, overrides: Partial<DPYearContext> = {}): DPYearContext {
    return {
        year,
        age: 60 + (year - YEAR1),
        nonSSOrdinaryIncomeExclRMD: 0,
        ssBenefits: 0,
        ltcgIncome: 0,
        filingStatus: 'Single',
        fedParams,
        stateParams: null,
        baselineTradWithdrawal: 0,
        spendingNeed: 0,
        baselineBrokerageAvailable: 0,
        rothGrowthRate: 0.05,
        growthRate: 0.05,
        rmdDivisor: 0,
        ...overrides,
    };
}

// Year 1 has income far above stdDed + any grid h, so NO fill-to-h plan can convert in year 1.
// A seed that converts in year 1 therefore has a SHAPE outside the fill-to-h family — the exact
// regime F8 targets (the flat-h rivals cannot express the seed's shape at another magnitude).
const contexts = () => [
    makeCtx(YEAR1, { nonSSOrdinaryIncomeExclRMD: 900_000 }),
    makeCtx(YEAR2, { nonSSOrdinaryIncomeExclRMD: 0 }),
];
const GRID_SIZE = 6;   // {0} ∪ 5 bracket tops ≤ the 35% threshold
const GOLDEN_SIMS = 6; // 2 probes + 4 iterations

const planKey = (p: Map<number, number>) =>
    JSON.stringify([...p.entries()].sort((a, b) => a[0] - b[0]).map(([y, v]) => [y, Math.round(v)]));
const total = (p: Map<number, number>) => [...p.values()].reduce((s, v) => s + v, 0);

/** Synthetic scorer harness: records every scored plan and mints a unique timeline per call. */
function makeScorer(scoreOf: (plan: Map<number, number>) => number) {
    const scored: Map<number, number>[] = [];
    const timelines = new Map<string, SimulationYear[]>();
    const scorePlan = (plan: Map<number, number>): ConversionPlanScore => {
        scored.push(new Map(plan));
        const timeline = [{ year: YEAR2, marker: planKey(plan) }] as unknown as SimulationYear[];
        timelines.set(planKey(plan), timeline);
        return { afterTaxNW: scoreOf(plan), timeline };
    };
    return { scorePlan, scored, timelines };
}

const baselineOpts = (afterTaxNW: number) => ({
    baseline: {
        afterTaxNW,
        timeline: [{ year: YEAR2, marker: 'baseline' }] as unknown as SimulationYear[],
        plan: new Map<number, number>(),
    },
    startingTradBalance: 1_000_000,
});

describe('F8 — seed-scaling pass when a seed wins the search', () => {
    const seed = new Map([[YEAR1, 50_000], [YEAR2, 25_000]]); // total 75k, year-1 shape unreachable by fill-to-h

    it('a ×1.1 scaled variant beats the raw seed and becomes the result (with one recursive pass)', () => {
        // Plans without a year-1 conversion (baseline + every fill-to-h) score low; seed-shaped
        // plans peak at total = 82,500 = 1.1 × the raw seed — a magnitude error at a correct shape.
        const { scorePlan, scored, timelines } = makeScorer(plan =>
            (plan.get(YEAR1) ?? 0) > 0 ? 1_000_000 - Math.abs(total(plan) - 82_500) : 5_000);
        const res = searchConversionPlanByEngine(contexts(), scorePlan, {
            ...baselineOpts(1_000),
            seedPlans: [{ label: 'legacy-dp', plan: seed }],
        });

        // The ×1.1 variant wins: per-year dollars are the seed's × 1.1.
        expect(res.diagnostics.bestLabel).toBe('legacy-dp×1.1');
        expect(res.conversionsByYear.get(YEAR1)).toBeCloseTo(55_000, 6);
        expect(res.conversionsByYear.get(YEAR2)).toBeCloseTo(27_500, 6);
        expect(res.diagnostics.bestHeadroom).toBeNull();

        // All four first-pass multipliers were scored, PLUS a recursive pass around the ×1.1 winner.
        const scaledTotals = scored
            .filter(p => (p.get(YEAR1) ?? 0) > 0 && planKey(p) !== planKey(seed))
            .map(p => Math.round(total(p)));
        for (const t of [60_000, 67_500, 82_500, 90_000]) expect(scaledTotals).toContain(t); // pass 1: seed × k
        for (const t of [66_000, 74_250, 90_750, 99_000]) expect(scaledTotals).toContain(t); // pass 2: (seed × 1.1) × k
        // Budget: 1 seed + 6 grid + 2×4 scale sims, golden-section skipped (a non-grid candidate won).
        expect(res.diagnostics.sims).toBe(1 + GRID_SIZE + 8);

        // Byte-identical-replay invariant at the search level: the returned timeline is the one
        // the scorer produced for exactly the returned plan.
        expect(res.winningTimeline).toBe(timelines.get(planKey(res.conversionsByYear)));
    });

    it('when the raw seed IS the scaling peak, it stays the winner and the sweep costs exactly +4 sims', () => {
        const { scorePlan } = makeScorer(plan =>
            (plan.get(YEAR1) ?? 0) > 0 ? 1_000_000 - Math.abs(total(plan) - 75_000) : 5_000);
        const res = searchConversionPlanByEngine(contexts(), scorePlan, {
            ...baselineOpts(1_000),
            seedPlans: [{ label: 'legacy-dp', plan: seed }],
        });
        expect(res.diagnostics.bestLabel).toBe('legacy-dp');
        expect(res.conversionsByYear).toBe(seed); // the raw seed plan ships unchanged
        // 1 seed + 6 grid + 4 scale probes (none won → no recursive pass), no golden.
        expect(res.diagnostics.sims).toBe(1 + GRID_SIZE + 4);
    });

    it('no scaling pass when a fill-to-h grid candidate wins (headroom path unchanged)', () => {
        // Fill-to-h plans (no year-1 conversion) peak at a year-2 total of 95k = stdDed + 80k.
        const { scorePlan, scored } = makeScorer(plan =>
            (plan.get(YEAR1) ?? 0) > 0 ? 10_000 : 500_000 - Math.abs(total(plan) - (STD_DED + 80_000)));
        const res = searchConversionPlanByEngine(contexts(), scorePlan, {
            ...baselineOpts(1_000),
            seedPlans: [{ label: 'legacy-dp', plan: seed }],
        });
        expect(res.diagnostics.bestHeadroom).not.toBeNull();
        // Exactly ONE scored plan carried a year-1 conversion: the raw seed. No scaled variants.
        expect(scored.filter(p => (p.get(YEAR1) ?? 0) > 0)).toHaveLength(1);
        expect(res.diagnostics.sims).toBe(1 + GRID_SIZE + GOLDEN_SIMS);
    });

    it('no scaling pass when the std-ded baseline wins, or when the winning seed plan is empty', () => {
        // Baseline wins: everything else scores below it.
        const a = makeScorer(() => -1);
        const resA = searchConversionPlanByEngine(contexts(), a.scorePlan, {
            ...baselineOpts(1_000),
            seedPlans: [{ label: 'legacy-dp', plan: seed }],
        });
        expect(resA.diagnostics.bestLabel).toBe('std-ded-baseline');
        expect(resA.diagnostics.sims).toBe(1 + GRID_SIZE); // no golden, no scaling

        // An EMPTY seed plan wins: nothing to scale (×k of {} is {}), sweep skipped.
        const empty = new Map<number, number>();
        const b = makeScorer(plan => (plan.size === 0 ? 100 : 10));
        const resB = searchConversionPlanByEngine(contexts(), b.scorePlan, {
            ...baselineOpts(1), // baseline below the empty seed
            seedPlans: [{ label: 'legacy-dp', plan: empty }],
        });
        expect(resB.diagnostics.bestLabel).toBe('legacy-dp');
        expect(resB.diagnostics.sims).toBe(1 + GRID_SIZE);
    });
});

describe('F9 — IRMAA/ACA cliff probes in the coarse h-grid', () => {
    const EPS = 1_000; // CLIFF_PROBE_EPSILON — probes land threshold − ε in h-space

    // A synthetic single-filer IRMAA schedule (floors chosen mid-interval between bracket tops).
    const irmaaFloors = [109_000, 137_000, 171_000, 205_000, 500_000];
    const irmaaScheduleForYear = () => ({
        annualSurcharge: () => 0,
        nextThreshold: (magi: number) => irmaaFloors.find(f => f > magi) ?? null,
    });

    it('maps IRMAA tier floors into h-space at the first IRMAA-bearing context (85% taxable-SS offset)', () => {
        const ssBenefits = 40_000;
        const ctxs = [
            makeCtx(YEAR1), // no IRMAA here — the probe must anchor on the NEXT context
            makeCtx(YEAR2, { ssBenefits, irmaaSurchargeForMAGI: () => 0 }),
        ];
        const probes = computeCliffHeadroomProbes(ctxs, irmaaScheduleForYear);
        // offset = stdDed + 0.85·SS + LTCG; h = floor − offset − ε, one probe per tier floor.
        const offset = STD_DED + 0.85 * ssBenefits;
        expect(probes).toEqual(irmaaFloors.map(f => f - offset - EPS));
    });

    it('maps the ACA 400%-FPL cliff with GROSS SS, and returns nothing without cliff-bearing contexts', () => {
        const acaCtxs = [makeCtx(YEAR1, {
            ssBenefits: 10_000,
            ltcgIncome: 5_000,
            acaOptions: { currentAge: 60, acaSubsidyAware: true, acaCliffThreshold: 84_600, estimatedSubsidyLoss: 12_000 },
        })];
        // ACA MAGI uses gross SS (not the 85% taxable approximation) → offset = stdDed + SS + LTCG.
        expect(computeCliffHeadroomProbes(acaCtxs, irmaaScheduleForYear))
            .toEqual([84_600 - (STD_DED + 10_000 + 5_000) - EPS]);

        // No IRMAA-bearing or ACA-bearing context → no probes (grid unchanged for such profiles).
        expect(computeCliffHeadroomProbes(contexts(), irmaaScheduleForYear)).toEqual([]);
        // IRMAA-bearing context but no schedule resolver (unit-test callers) → no IRMAA probes.
        expect(computeCliffHeadroomProbes([makeCtx(YEAR1, { irmaaSurchargeForMAGI: () => 0 })])).toEqual([]);
    });

    it('the search actually SCORES fill-to-h candidates at the in-range cliff probes', () => {
        const ctxs = [
            makeCtx(YEAR1, { nonSSOrdinaryIncomeExclRMD: 900_000 }),
            makeCtx(YEAR2, { irmaaSurchargeForMAGI: () => 0 }),
        ];
        const { scorePlan, scored } = makeScorer(() => 10);
        searchConversionPlanByEngine(ctxs, scorePlan, { ...baselineOpts(1_000_000), irmaaScheduleForYear });
        // Year-2 fill amount = stdDed + h (year-2 other income is 0), so a probe at h is visible
        // as a scored plan converting stdDed + h in YEAR2. In-range floors (≤ the 250k grid cap
        // after the offset): 109k/137k/171k/205k → h = floor − stdDed − ε; 500k maps above cap.
        const year2Amounts = scored.map(p => Math.round(p.get(YEAR2) ?? 0));
        for (const floor of [109_000, 137_000, 171_000, 205_000]) {
            const h = floor - STD_DED - EPS;
            expect(year2Amounts).toContain(STD_DED + h); // = floor − ε
        }
    });

    it('a cliff probe can WIN and golden-section then refines around it (grid stays sorted)', () => {
        const ctxs = [
            makeCtx(YEAR1, { nonSSOrdinaryIncomeExclRMD: 900_000 }),
            makeCtx(YEAR2, { irmaaSurchargeForMAGI: () => 0 }),
        ];
        // J(h) rewards staying just under the 137k "cliff" (in year-2-conversion space:
        // conversion = stdDed + h, cliff at MAGI 137k → conversion 137k): a step penalty above.
        const cliffConv = 137_000;
        const { scorePlan } = makeScorer(plan => {
            const conv = plan.get(YEAR2) ?? 0;
            return conv >= cliffConv ? 20_000 : conv; // crossing drops J to a flat low shelf
        });
        const res = searchConversionPlanByEngine(ctxs, scorePlan, { ...baselineOpts(0), irmaaScheduleForYear });
        // The winner sits just under the cliff — at or above the probe (golden may inch closer),
        // strictly below the cliff itself.
        const winner = res.conversionsByYear.get(YEAR2)!;
        expect(winner).toBeGreaterThanOrEqual(cliffConv - EPS);
        expect(winner).toBeLessThan(cliffConv);
        expect(res.diagnostics.bestHeadroom).not.toBeNull();
    });
});

describe('#165 — tail-trim pass (keep the head, shrink the tail)', () => {
    // A scorer whose timelines REFLECT EXECUTION: the trim pass anchors its cutover grid on
    // extractConversionPlan(anchor timeline), so these tests must mint timelines with real
    // rothConversion rows (the default makeScorer's marker timelines deliberately carry none,
    // which is exactly why the pass no-ops — and costs zero sims — in the F8/F9 tests above).
    // `executes` clamps execution (a year listed there executes $0 — the phantom-tail case).
    function makeExecutingScorer(
        scoreOf: (plan: Map<number, number>) => number,
        executesYear: (year: number) => boolean = () => true,
    ) {
        const scored: Map<number, number>[] = [];
        const timelines = new Map<string, SimulationYear[]>();
        const scorePlan = (plan: Map<number, number>): ConversionPlanScore => {
            scored.push(new Map(plan));
            const timeline = [...plan.entries()]
                .filter(([y, amt]) => executesYear(y) && amt > 0)
                .sort((a, b) => a[0] - b[0])
                .map(([y, amt]) => ({ year: y, rothConversion: { amount: amt } })) as unknown as SimulationYear[];
            timelines.set(planKey(plan), timeline);
            return { afterTaxNW: scoreOf(plan), timeline };
        };
        return { scorePlan, scored, timelines };
    }

    // Ten-year horizon: three "cheap" head years (2031-2033) and a tail (2034+). The head is
    // unreachable by fill-to-h (income 900k), so only seed-shaped plans can score it — and the
    // landscape pays for keeping the head at FULL size while shrinking the tail to a trickle:
    // exactly the shape no proportional scaling or flat-h plan can express.
    const TAIL_START = 2034;
    const LAST = 2040;
    const trimContexts = () => {
        const out: DPYearContext[] = [];
        for (let y = YEAR1; y <= LAST; y++) {
            out.push(makeCtx(y, { nonSSOrdinaryIncomeExclRMD: y <= 2033 ? 900_000 : 0 }));
        }
        return out;
    };
    const headTotal = (p: Map<number, number>) =>
        [...p.entries()].filter(([y]) => y < TAIL_START).reduce((s, [, v]) => s + Math.min(v, 100_000), 0);
    const landscape = (p: Map<number, number>) => {
        let v = headTotal(p) * 10; // full-size head conversions are precious
        for (const [y, amt] of p) {
            if (y >= TAIL_START) v += amt <= 20_000 ? amt * 2 : -amt * 2; // small tail trickle pays, big tail costs
        }
        return v;
    };
    const seed = new Map<number, number>();
    for (let y = YEAR1; y <= 2036; y++) seed.set(y, 100_000);

    it('a trimmed composite wins: head kept verbatim, tail replaced by a refined std-ded trickle', () => {
        const { scorePlan, timelines } = makeExecutingScorer(landscape);
        const res = searchConversionPlanByEngine(trimContexts(), scorePlan, {
            ...baselineOpts(1_000),
            seedPlans: [{ label: 'legacy-dp', plan: seed }],
        });

        // Coarse grid finds trim(C=2034, f=0.30); the refine probes f=0.45 and it wins
        // (trickle 0.45 × stdDed = 6,750 ≤ the 20k sweet spot, and more trickle pays more).
        expect(res.diagnostics.bestLabel).toBe('trim(C=2034,f=0.45)');
        expect(res.diagnostics.bestHeadroom).toBeNull();
        // The #89 MC capHeadroom derivation classifies a trim winner by its anchor's family.
        expect(res.diagnostics.trimAnchorLabel).toBe('legacy-dp');
        expect(res.diagnostics.trimAnchorHeadroom).toBeNull();
        for (const y of [YEAR1, 2032, 2033]) expect(res.conversionsByYear.get(y)).toBe(100_000);
        for (let y = TAIL_START; y <= LAST; y++) {
            expect(res.conversionsByYear.get(y)).toBeCloseTo(STD_DED * 0.45, 6);
        }
        // Replay invariant: the returned timeline is the scored replay of exactly the returned plan.
        expect(res.winningTimeline).toBe(timelines.get(planKey(res.conversionsByYear)));
    });

    it('anchors the cutover grid on EXECUTED years, not scheduled ones (phantom tail)', () => {
        // The seed also schedules 2037-2040, but those years execute $0 (drained Traditional).
        // Anchoring on the schedule would spend the whole cutover grid on phantom years
        // (every composite execution-identical to the anchor); anchoring on execution puts
        // C inside the real tail, so composites with a trimmed 2033/2034 must appear.
        const phantomSeed = new Map(seed);
        for (let y = 2037; y <= LAST; y++) phantomSeed.set(y, 100_000);
        const { scorePlan, scored } = makeExecutingScorer(landscape, y => y <= 2036);
        const res = searchConversionPlanByEngine(trimContexts(), scorePlan, {
            ...baselineOpts(1_000),
            seedPlans: [{ label: 'legacy-dp', plan: phantomSeed }],
        });
        expect(res.diagnostics.bestLabel).toMatch(/^trim\(C=2034/);
        const sawRealCut = scored.some(p =>
            (p.get(YEAR1) ?? 0) === 100_000 && (p.get(2034) ?? 0) > 0 && (p.get(2034) ?? 0) < 10_000);
        expect(sawRealCut).toBe(true);
    });

    it('the tail trickle ignores the BASELINE world\'s RMDs (they would silence it)', () => {
        // Tail contexts carry a huge baseline Traditional + RMD divisor: fill-to-headroom(0)
        // computes $0 there (baseline RMDs swallow the deduction), but the trimmed world holds
        // only a small residual — the trickle must still be offered at frac × stdDed.
        const ctxs = trimContexts().map(ctx => (ctx.year >= TAIL_START
            ? { ...ctx, rmdDivisor: 25, baselineTradBalance: 10_000_000 }
            : { ...ctx, baselineTradBalance: 10_000_000 }));
        const { scorePlan } = makeExecutingScorer(landscape);
        const res = searchConversionPlanByEngine(ctxs, scorePlan, {
            ...baselineOpts(1_000),
            seedPlans: [{ label: 'legacy-dp', plan: seed }],
        });
        expect(res.diagnostics.bestLabel).toMatch(/^trim\(C=2034/);
        for (let y = TAIL_START; y <= LAST; y++) {
            expect(res.conversionsByYear.get(y) ?? 0).toBeGreaterThan(0);
        }
    });
});
