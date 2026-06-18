/**
 * Engine-direct Roth-conversion search (#89 ROOT FIX; cookbook synthesis §5).
 *
 * Instead of TRUSTING the DP's internal 2-D terminal valuation — which over-values
 * draining the residual on low/no-Social-Security, large-Traditional profiles drawn
 * down trad-first, and so converts PAST the wealth peak — this picks the conversion
 * plan by SCORING CANDIDATE PLANS ON THE REAL ENGINE: the cookbook's "consistent
 * ruler" turned into the optimizer ("the strategy scored is the strategy executed").
 *
 * The DP is demoted from "the optimizer" to ONE candidate among several, scored on the
 * real engine like the rest and overridden whenever a better-scoring plan exists. The
 * candidate set is:
 *   • the std-ded baseline (passed in pre-scored — guarantees the result is ≥ the
 *     baseline by construction, so over-conversion is impossible and the downstream
 *     feasibility floor never fires);
 *   • the legacy DP plan (a seed — guarantees the result is ≥ the DP);
 *   • a bracket-aligned grid of "fill ordinary income to (standard deduction + headroom h)"
 *     plans, then a golden-section refine on h for the precise peak between bracket tops.
 *
 * Fill-to-h is automatically year-adaptive from one scalar — it converts more in low-income
 * gap years and less once Social Security / RMDs raise the income floor, the gap-year shape
 * the cookbook calls for:
 *     conversion_y = max(0, stdDed_y + h − otherOrdinaryIncome_y)   (engine clamps to avail. Trad)
 *
 * Scoring is INJECTED (`scorePlan`) so this module stays free of the runSimulation /
 * FutureUtils import cycle; production passes a closure over runSimulation +
 * terminalAfterTaxNetWorth (the same after-tax ruler the baseline + floor use).
 */
import { DPYearContext } from './RothConversionDP';
import { SimulationYear } from './types';

export type ConversionPlanScore = { afterTaxNW: number; timeline: SimulationYear[] };
/** Run a candidate conversion plan through the real engine and return its after-tax terminal NW + timeline. */
export type ConversionPlanScorer = (plan: Map<number, number>) => ConversionPlanScore;

export interface EngineSearchOptions {
    /**
     * The std-ded baseline, already executed and scored with the SAME ruler. Seeded as a
     * candidate with its TRUE score (not re-scored), so when it wins the search returns the
     * baseline timeline itself — guaranteeing the result is ≥ the baseline exactly.
     */
    baseline: { afterTaxNW: number; timeline: SimulationYear[]; plan: Map<number, number> };
    /** Extra seed candidate plans (e.g. the legacy DP plan), scored alongside the grid. */
    seedPlans?: { label: string; plan: Map<number, number> }[];
}

export interface EngineSearchDiagnostics {
    /** Number of full forward sims the search consumed (excludes the pre-scored baseline). */
    sims: number;
    bestHeadroom: number | null;
    bestLabel: string;
    /** Scored grid/seed candidates (refine evaluations omitted), for the debug screen. */
    candidates: { label: string; headroom: number | null; total: number; afterTaxNW: number }[];
}

export interface EngineSearchResult {
    conversionsByYear: Map<number, number>;
    /** The winning candidate's already-computed timeline — reuse it, don't re-sim. */
    winningTimeline: SimulationYear[];
    diagnostics: EngineSearchDiagnostics;
}

const planTotal = (p: Map<number, number>): number => [...p.values()].reduce((s, v) => s + v, 0);

/** Extract a year→conversion$ plan from an executed timeline (e.g. the std-ded baseline). */
export function extractConversionPlan(timeline: SimulationYear[]): Map<number, number> {
    const plan = new Map<number, number>();
    for (const y of timeline) {
        const amt = y.rothConversion?.amount ?? 0;
        if (amt > 0) plan.set(y.year, amt);
    }
    return plan;
}

/**
 * Build a "fill ordinary income to (stdDed + headroom)" plan from the per-year contexts.
 * otherOrdinaryIncome = non-SS ordinary (excl. conversion) + the baseline RMD. SS is left out
 * of the ceiling math (its taxable interaction is non-linear); the real-engine score handles the
 * exact effect, so the family only needs to span aggressiveness monotonically.
 */
function fillToHeadroomPlan(contexts: DPYearContext[], headroom: number): Map<number, number> {
    const plan = new Map<number, number>();
    for (const ctx of contexts) {
        const baselineRMD = ctx.rmdDivisor > 0 ? (ctx.baselineTradBalance ?? 0) / ctx.rmdDivisor : 0;
        const otherOrdinary = ctx.nonSSOrdinaryIncomeExclRMD + baselineRMD;
        const ceiling = ctx.fedParams.standardDeduction + headroom;
        const conv = Math.max(0, ceiling - otherOrdinary);
        if (conv > 0.5) plan.set(ctx.year, conv);
    }
    return plan;
}

/**
 * Bracket-aligned coarse grid of taxable-income headrooms above the standard deduction.
 * Each bracket threshold is a natural "fill to the top of the bracket below it" target.
 * Capped at the 32% bracket — draining a solvent household past that never wins, and it keeps
 * the sim count down.
 */
function headroomGrid(contexts: DPYearContext[]): number[] {
    const fed = contexts[0].fedParams;
    const cap = fed.brackets.find(b => b.rate >= 0.35)?.threshold ?? Number.POSITIVE_INFINITY;
    const tops = fed.brackets.map(b => b.threshold).filter(t => t > 0 && t <= cap);
    return [0, ...tops];
}

export function searchConversionPlanByEngine(
    contexts: DPYearContext[],
    scorePlan: ConversionPlanScorer,
    opts: EngineSearchOptions,
): EngineSearchResult {
    const { baseline, seedPlans = [] } = opts;

    let sims = 0;
    const diag: EngineSearchDiagnostics['candidates'] = [];
    // Seed with the pre-scored std-ded baseline (its TRUE score + timeline) — the result is
    // ≥ the baseline by construction, so the downstream feasibility floor never fires.
    let best: { headroom: number | null; plan: Map<number, number>; score: ConversionPlanScore; label: string } =
        { headroom: null, plan: baseline.plan, score: { afterTaxNW: baseline.afterTaxNW, timeline: baseline.timeline }, label: 'std-ded-baseline' };
    diag.push({ label: best.label, headroom: null, total: planTotal(baseline.plan), afterTaxNW: baseline.afterTaxNW });

    const consider = (label: string, headroom: number | null, plan: Map<number, number>, record: boolean): ConversionPlanScore => {
        const score = scorePlan(plan);
        sims++;
        if (record) diag.push({ label, headroom, total: planTotal(plan), afterTaxNW: score.afterTaxNW });
        if (score.afterTaxNW > best.score.afterTaxNW) best = { headroom, plan, score, label };
        return score;
    };

    // Seed candidates (e.g. the legacy DP plan) — guarantees the result is ≥ each of them.
    for (const s of seedPlans) consider(s.label, null, s.plan, true);

    // Nothing to vary year-over-year → baseline / seeds are the whole search.
    if (contexts.length === 0) {
        return {
            conversionsByYear: best.plan,
            winningTimeline: best.score.timeline,
            diagnostics: { sims, bestHeadroom: best.headroom, bestLabel: best.label, candidates: diag },
        };
    }

    // Bracket-aligned fill-to-headroom grid.
    const grid = headroomGrid(contexts);
    for (const h of grid) consider(`h=${Math.round(h).toLocaleString()}`, h, fillToHeadroomPlan(contexts, h), true);

    // Golden-section refine over the continuous headroom, in the interval bracketing the best
    // grid point — finds the precise peak between two bracket tops. Skipped if a non-grid
    // candidate (baseline / a seed) is winning.
    if (best.headroom !== null && best.headroom > 0) {
        const idx = grid.indexOf(best.headroom);
        const lo = idx > 0 ? grid[idx - 1] : 0;
        const hi = idx >= 0 && idx < grid.length - 1 ? grid[idx + 1] : best.headroom * 1.5;
        const phi = (Math.sqrt(5) - 1) / 2;
        let a = lo, c = hi;
        let x1 = c - phi * (c - a), x2 = a + phi * (c - a);
        let f1 = consider(`h=${Math.round(x1).toLocaleString()}`, x1, fillToHeadroomPlan(contexts, x1), false).afterTaxNW;
        let f2 = consider(`h=${Math.round(x2).toLocaleString()}`, x2, fillToHeadroomPlan(contexts, x2), false).afterTaxNW;
        for (let i = 0; i < 4; i++) {
            if (f1 >= f2) {
                c = x2; x2 = x1; f2 = f1;
                x1 = c - phi * (c - a);
                f1 = consider(`h=${Math.round(x1).toLocaleString()}`, x1, fillToHeadroomPlan(contexts, x1), false).afterTaxNW;
            } else {
                a = x1; x1 = x2; f1 = f2;
                x2 = a + phi * (c - a);
                f2 = consider(`h=${Math.round(x2).toLocaleString()}`, x2, fillToHeadroomPlan(contexts, x2), false).afterTaxNW;
            }
        }
    }

    return {
        conversionsByYear: best.plan,
        winningTimeline: best.score.timeline,
        diagnostics: { sims, bestHeadroom: best.headroom, bestLabel: best.label, candidates: diag },
    };
}
