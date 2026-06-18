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
import { AnyAccount, SavedAccount, InvestedAccount } from '../../components/Objects/Accounts/models';

export interface WithdrawalOrderItem { id: string; name: string; accountId: string; }

/**
 * Classify an account into a drawdown "tax bucket" for candidate-order generation.
 *
 * NOT a duplicate of `classifyAccountTaxCategory` (helpers.ts): that one is a 3-way tax-treatment
 * split ('tax-deferred' | 'tax-free' | 'taxable') used for the conversion-cost math. Order
 * generation needs a finer 4-way bucketing — it must separate CASH from ROTH (both 'tax-free'
 * there) and BROKERAGE from CASH, because the candidate sequences hinge on the relative drawdown
 * position of cash, taxable, Traditional, and Roth. The tax-category classifier can't express that,
 * so a dedicated bucketer is required here.
 */
function withdrawalBucketOf(account: AnyAccount | undefined): 'cash' | 'brokerage' | 'traditional' | 'roth' | 'other' {
    if (account instanceof SavedAccount) return 'cash';
    if (account instanceof InvestedAccount) {
        if (account.taxType === 'Brokerage') return 'brokerage';
        if (account.taxType.startsWith('Traditional')) return 'traditional';
        if (account.taxType.startsWith('Roth')) return 'roth';
    }
    return 'other';
}

/**
 * Candidate withdrawal orders for the joint conversion + drawdown-order optimizer.
 *
 * Tax Optimization's UI promises it picks the best withdrawal order, but the engine used to
 * always run the user's stored order — silently wasting, on some profiles, the cheap post-SS
 * standard-deduction conversion band (a large Traditional spent for living before it can be
 * converted at 0%). This reorders the user's withdrawalStrategy entries by tax bucket along a
 * few tax-aware sequences. The user's OWN order is always included first, so the optimizer can
 * never do worse than the manual order. The engine scores each candidate on the real engine and
 * picks the best PER scenario — the optimum is scenario-specific (Roth-before-Traditional wins
 * for high-SS/large-Traditional/long-horizon profiles, the conventional order for others), so
 * nothing is hardcoded.
 */
export function generateCandidateWithdrawalOrders<T extends WithdrawalOrderItem>(
    accounts: AnyAccount[],
    baseStrategy: T[],
): T[][] {
    const byId = new Map(accounts.map(a => [a.id, a]));
    const rankIn = (accountId: string, seq: string[]): number => {
        const i = seq.indexOf(withdrawalBucketOf(byId.get(accountId)));
        return i < 0 ? seq.length : i; // unknown buckets sort to the end
    };
    // Candidates always spend CASH first and TAXABLE (brokerage) before either tax-advantaged bucket —
    // spending tax-free/deferred money ahead of taxable assets forfeits shielded growth and is
    // essentially never optimal. The lever that matters for conversion optimization is the RELATIVE
    // order of Roth vs Traditional: spending Roth first PRESERVES Traditional so it can be converted
    // cheaply (e.g. the post-SS 0% band); the conventional order spends Traditional first. We do NOT
    // emit a "Roth before brokerage" order — it isn't economically sound, and under aggressive
    // conversions in a no-SS regime a brokerage-heavy terminal makes orders mis-compare on the ruler.
    const TYPE_SEQUENCES: string[][] = [
        ['cash', 'brokerage', 'traditional', 'roth'], // conventional: taxable → tax-deferred → tax-free
        ['cash', 'brokerage', 'roth', 'traditional'], // Traditional-preserving: spend Roth before Trad to free the post-SS 0% conversion band
    ];
    const candidates: T[][] = [baseStrategy]; // the user's own order — guarantees no regression
    for (const seq of TYPE_SEQUENCES) {
        // Explicit stable sort (decorate with original index) so equal buckets keep user order.
        const sorted = baseStrategy
            .map((item, idx) => ({ item, idx }))
            .sort((a, b) => (rankIn(a.item.accountId, seq) - rankIn(b.item.accountId, seq)) || (a.idx - b.idx))
            .map(x => x.item);
        candidates.push(sorted);
    }
    // Dedupe by accountId sequence (the user's order may already equal a generated one).
    const seen = new Set<string>();
    return candidates.filter(c => {
        const key = c.map(x => x.accountId).join('>');
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

/**
 * Reorder an assumptions object's `withdrawalStrategy` to the optimizer-CHOSEN order (#1) — e.g.
 * `SimulationYear.chosenWithdrawalOrder`, the order the deterministic projection actually ran.
 * Monte Carlo runs every path off the passed assumptions, so threading the chosen order through
 * here makes the MC bands drain in the SAME order as the deterministic chart instead of always the
 * user's stored order.
 *
 * `chosenOrder` is a lossy `{accountId, name}` projection, so we map its accountIds back to the
 * full strategy items; any item NOT named in the chosen order is appended in its original relative
 * position (defensive — the optimizer reorders, it never drops accounts). Returns the SAME object
 * reference when there is no chosen order or it already matches, so the Monte-Carlo policy cache
 * key (hashed off `assumptions`) is unchanged in the common user-order-wins case.
 */
export function applyChosenWithdrawalOrder<
    W extends { accountId: string },
    A extends { withdrawalStrategy: W[] },
>(assumptions: A, chosenOrder: ReadonlyArray<{ accountId: string }> | undefined): A {
    if (!chosenOrder || chosenOrder.length === 0) return assumptions;
    const byId = new Map(assumptions.withdrawalStrategy.map(w => [w.accountId, w]));
    const picked = chosenOrder
        .map(c => byId.get(c.accountId))
        .filter((w): w is W => w !== undefined);
    const remaining = assumptions.withdrawalStrategy.filter(
        w => !chosenOrder.some(c => c.accountId === w.accountId));
    const reordered = [...picked, ...remaining];
    const unchanged = reordered.length === assumptions.withdrawalStrategy.length
        && reordered.every((w, i) => w.accountId === assumptions.withdrawalStrategy[i].accountId);
    return unchanged ? assumptions : { ...assumptions, withdrawalStrategy: reordered };
}

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
    /**
     * Traditional balance entering the horizon (= dpInputs.currentTradBalance, the start-of-first-
     * context-year balance). Used as the prior-year-end RMD basis for the first context in the
     * fill-to-headroom family (#5), matching the engine's realized-RMD basis.
     */
    startingTradBalance: number;
}

export interface EngineSearchDiagnostics {
    /** Number of full forward sims the search consumed (excludes the pre-scored baseline). */
    sims: number;
    bestHeadroom: number | null;
    bestLabel: string;
}

export interface EngineSearchResult {
    conversionsByYear: Map<number, number>;
    /** The winning candidate's already-computed timeline — reuse it, don't re-sim. */
    winningTimeline: SimulationYear[];
    diagnostics: EngineSearchDiagnostics;
}

/** Extract a year→conversion$ plan from an executed timeline (e.g. the std-ded baseline). */
export function extractConversionPlan(timeline: SimulationYear[]): Map<number, number> {
    const plan = new Map<number, number>();
    for (const y of timeline) {
        if (y.isEndOfYearProjection) continue; // skip the synthetic end-of-year projection row
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
 *
 * RMD basis (#5): the engine computes year Y's RMD on the PRIOR-year-end Traditional balance
 * (Dec 31 of Y−1), so the calibration income here uses the previous context's baselineTradBalance
 * (= start of this year) — or `startingTradBalance` (the balance entering the horizon) for the
 * first context. This matches the realized non-SS ordinary income YearSolver applies the MC cap
 * against, so an on-track path reduces to the deterministic optimum h* rather than to a
 * one-year-of-growth mis-estimate of the RMD (which used this year's END balance before).
 */
function fillToHeadroomPlan(contexts: DPYearContext[], headroom: number, startingTradBalance: number): Map<number, number> {
    const plan = new Map<number, number>();
    for (let i = 0; i < contexts.length; i++) {
        const ctx = contexts[i];
        const priorYearEndTrad = i > 0 ? (contexts[i - 1].baselineTradBalance ?? 0) : startingTradBalance;
        const baselineRMD = ctx.rmdDivisor > 0 ? priorYearEndTrad / ctx.rmdDivisor : 0;
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
    const { baseline, seedPlans = [], startingTradBalance } = opts;
    // Fill-to-headroom with the engine's prior-year-end RMD basis baked in (#5).
    const fillPlan = (h: number): Map<number, number> => fillToHeadroomPlan(contexts, h, startingTradBalance);

    let sims = 0;
    // Seed with the pre-scored std-ded baseline (its TRUE score + timeline) — the result is
    // ≥ the baseline by construction, so the downstream feasibility floor never fires.
    let best: { headroom: number | null; plan: Map<number, number>; score: ConversionPlanScore; label: string } =
        { headroom: null, plan: baseline.plan, score: { afterTaxNW: baseline.afterTaxNW, timeline: baseline.timeline }, label: 'std-ded-baseline' };

    const consider = (label: string, headroom: number | null, plan: Map<number, number>): ConversionPlanScore => {
        const score = scorePlan(plan);
        sims++;
        if (score.afterTaxNW > best.score.afterTaxNW) best = { headroom, plan, score, label };
        return score;
    };

    // Seed candidates (e.g. the legacy DP plan) — guarantees the result is ≥ each of them.
    for (const s of seedPlans) consider(s.label, null, s.plan);

    // Nothing to vary year-over-year → baseline / seeds are the whole search.
    if (contexts.length === 0) {
        return {
            conversionsByYear: best.plan,
            winningTimeline: best.score.timeline,
            diagnostics: { sims, bestHeadroom: best.headroom, bestLabel: best.label },
        };
    }

    // Bracket-aligned fill-to-headroom grid.
    const grid = headroomGrid(contexts);
    for (const h of grid) consider(`h=${Math.round(h).toLocaleString()}`, h, fillPlan(h));

    // Golden-section refine over the continuous headroom, in the interval bracketing the best
    // grid point — finds the precise peak between two bracket tops. Skipped only if a non-grid
    // candidate (baseline / a seed) is winning. When the h=0 grid point wins we STILL refine over
    // (0, firstBracketTop): the peak between the standard deduction and the first bracket top lives
    // there, and gating on best.headroom > 0 would never probe it.
    if (best.headroom !== null) {
        const idx = grid.indexOf(best.headroom);
        const lo = idx > 0 ? grid[idx - 1] : 0;
        // Upper bound: the next grid top above the winner; for the h=0 case that's grid[1] (the first
        // positive bracket top). Fall back to a small positive width only when no higher top exists.
        const hi = idx >= 0 && idx < grid.length - 1 ? grid[idx + 1] : Math.max(best.headroom * 1.5, 1_000);
        const phi = (Math.sqrt(5) - 1) / 2;
        let a = lo, c = hi;
        let x1 = c - phi * (c - a), x2 = a + phi * (c - a);
        let f1 = consider(`h=${Math.round(x1).toLocaleString()}`, x1, fillPlan(x1)).afterTaxNW;
        let f2 = consider(`h=${Math.round(x2).toLocaleString()}`, x2, fillPlan(x2)).afterTaxNW;
        for (let i = 0; i < 4; i++) {
            if (f1 >= f2) {
                c = x2; x2 = x1; f2 = f1;
                x1 = c - phi * (c - a);
                f1 = consider(`h=${Math.round(x1).toLocaleString()}`, x1, fillPlan(x1)).afterTaxNW;
            } else {
                a = x1; x1 = x2; f1 = f2;
                x2 = a + phi * (c - a);
                f2 = consider(`h=${Math.round(x2).toLocaleString()}`, x2, fillPlan(x2)).afterTaxNW;
            }
        }
    }

    return {
        conversionsByYear: best.plan,
        winningTimeline: best.score.timeline,
        diagnostics: { sims, bestHeadroom: best.headroom, bestLabel: best.label },
    };
}
