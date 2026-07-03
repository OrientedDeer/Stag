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
 *     plans, then a golden-section refine on h for the precise peak between bracket tops;
 *   • when a SEED wins, scaled variants of it (×0.8/0.9/1.1/1.2, with one recursive pass) —
 *     so a winning seed ships as a verified local scaling peak instead of unexplored (F8).
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
import { FilingStatus } from '../../data/TaxData';
import type { ResolvedIRMAASchedule } from '../../data/IRMAAData';
import { AnyAccount, SavedAccount, InvestedAccount, ESPPAccount, RSUAccount } from '../../components/Objects/Accounts/models';
// Single source of truth for "can the drawdown liquidate this?" — defined alongside the
// #111 fallback tier so the tax-opt optimizer and the manual-order safety net can't diverge.
// taxableTierRank is likewise shared (#156) so the candidate-order generator and the manual
// Auto sort rank ESPP/RSU by the same lot-level gain character.
import { isSellableAccount, taxableTierRank } from './WithdrawalPlanner';

export interface WithdrawalOrderItem { id: string; name: string; accountId: string; }

/**
 * Augment a withdrawal order so it covers EVERY sellable account, not just the ones the user listed.
 *
 * Under Tax Optimization the algorithm OWNS the withdrawal order (the UI disables the manual editor),
 * so the user's manual order is a starting point, not a constraint — and any account the user EXCLUDED
 * from the order must still be a first-class participant the optimizer can place and score. This returns
 * `baseStrategy` with the user's relative order preserved, followed by SYNTHESIZED entries for any
 * sellable account not already present. The append position is incidental: `generateCandidateWithdrawalOrders`
 * sorts the result by tax bucket for the two tax-aware sequences, so the omitted accounts land in their
 * tax-correct slot there; in the user's-order candidate (#0) they trail the user's listed accounts.
 *
 * No-op (returns `baseStrategy` unchanged) when the order already lists every sellable account — the
 * common case, so this never perturbs scenarios that fully specify their order.
 */
export function withAllSellableAccounts<T extends WithdrawalOrderItem>(
    accounts: AnyAccount[],
    baseStrategy: T[],
    makeItem: (account: AnyAccount) => T,
): T[] {
    const listed = new Set(baseStrategy.map(w => w.accountId));
    const omitted = accounts.filter(a => isSellableAccount(a) && !listed.has(a.id));
    if (omitted.length === 0) return baseStrategy;
    return [...baseStrategy, ...omitted.map(makeItem)];
}

/**
 * Classify an account into a drawdown "tax bucket" for candidate-order generation.
 *
 * NOT a duplicate of `classifyAccountTaxCategory` (helpers.ts): that one is a 3-way tax-treatment
 * split ('tax-deferred' | 'tax-free' | 'taxable') used for the conversion-cost math. Order
 * generation needs a finer bucketing — it must separate CASH from ROTH (both 'tax-free'
 * there) and BROKERAGE from CASH, because the candidate sequences hinge on the relative drawdown
 * position of cash, taxable, Traditional, and Roth. The tax-category classifier can't express that,
 * so a dedicated bucketer is required here.
 *
 * ESPP/RSU (#156) are taxable but their tax cost is lot-dependent, so they're bucketed by
 * `taxableTierRank` at `saleDate`: rank 1 (favourable gain character — qualifying-heavy ESPP,
 * long-term-heavy or near-zero-gain RSU) joins the 'brokerage' bucket; rank 1.5 lands in
 * 'taxable-late' — after brokerage but before the tax-advantaged buckets, so unseasoned lots
 * are still spent ahead of Traditional/Roth, just not first among taxable assets.
 */
function withdrawalBucketOf(
    account: AnyAccount | undefined,
    saleDate: Date,
): 'cash' | 'brokerage' | 'taxable-late' | 'traditional' | 'roth' | 'other' {
    if (account instanceof SavedAccount) return 'cash';
    if (account instanceof ESPPAccount || account instanceof RSUAccount) {
        return taxableTierRank(account, saleDate) === 1 ? 'brokerage' : 'taxable-late';
    }
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
 *
 * ESPP/RSU accounts (#156) are placed by lot-level gain character at `saleDate` (defaults to
 * now): favourable ones share the brokerage slot, unfavourable ones follow in 'taxable-late'.
 * Scenarios without ESPP/RSU accounts are unaffected — the bucketer only reads lots for those
 * two types.
 */
export function generateCandidateWithdrawalOrders<T extends WithdrawalOrderItem>(
    accounts: AnyAccount[],
    baseStrategy: T[],
    saleDate: Date = new Date(),
): T[][] {
    const byId = new Map(accounts.map(a => [a.id, a]));
    const rankIn = (accountId: string, seq: string[]): number => {
        const i = seq.indexOf(withdrawalBucketOf(byId.get(accountId), saleDate));
        return i < 0 ? seq.length : i; // unknown buckets sort to the end
    };
    // Candidates always spend CASH first and TAXABLE (brokerage, then taxable-late ESPP/RSU) before
    // either tax-advantaged bucket — spending tax-free/deferred money ahead of taxable assets forfeits
    // shielded growth and is essentially never optimal. The lever that matters for conversion
    // optimization is the RELATIVE order of Roth vs Traditional: spending Roth first PRESERVES
    // Traditional so it can be converted cheaply (e.g. the post-SS 0% band); the conventional order
    // spends Traditional first. We do NOT emit a "Roth before brokerage" order — it isn't economically
    // sound, and under aggressive conversions in a no-SS regime a brokerage-heavy terminal makes
    // orders mis-compare on the ruler.
    const TYPE_SEQUENCES: string[][] = [
        ['cash', 'brokerage', 'taxable-late', 'traditional', 'roth'], // conventional: taxable → tax-deferred → tax-free
        ['cash', 'brokerage', 'taxable-late', 'roth', 'traditional'], // Traditional-preserving: spend Roth before Trad to free the post-SS 0% conversion band
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
 *
 * The optimizer's chosen order can also include sellable accounts the user OMITTED from
 * `withdrawalStrategy` — `withAllSellableAccounts` synthesizes those upstream with the REAL
 * `accountId`, and they persist into `chosenWithdrawalOrder`. Without `validAccountIds` such ids
 * have no item in `byId` and were silently dropped, so MC drained only the user-listed accounts
 * (the omitted account then resurfaced at the #111 fallback-tier TAIL, not the chosen position) —
 * desyncing the MC bands from the deterministic chart they're meant to match. Pass `validAccountIds`
 * (the set of currently-existing account ids) to re-synthesize a stub for any chosen id that maps to
 * a real account, preserving its chosen position end-to-end. Genuinely STALE ids (accounts since
 * deleted) are absent from the set and stay dropped, as do all callers that omit the set.
 */
export function applyChosenWithdrawalOrder<
    W extends { accountId: string },
    A extends { withdrawalStrategy: W[] },
>(
    assumptions: A,
    chosenOrder: ReadonlyArray<{ accountId: string; name?: string }> | undefined,
    validAccountIds?: ReadonlySet<string>,
): A {
    if (!chosenOrder || chosenOrder.length === 0) return assumptions;
    const byId = new Map(assumptions.withdrawalStrategy.map(w => [w.accountId, w]));
    const picked = chosenOrder
        .map(c => {
            const existing = byId.get(c.accountId);
            if (existing) return existing;
            // Re-synthesize an omitted-but-real account (matches withAllSellableAccounts's shape) so it
            // keeps its chosen position; only when the caller vouches the id is a current account.
            if (validAccountIds?.has(c.accountId)) {
                return { id: `synth-${c.accountId}`, name: c.name ?? '', accountId: c.accountId } as unknown as W;
            }
            return undefined;
        })
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
    /**
     * Resolve the IRMAA schedule (tier floors + surcharge) for a year + filing status (F9) —
     * production passes `(year, fs) => getIRMAASchedule(fs, year, assumptions)`. This module
     * can't call getIRMAASchedule itself: the schedule's inflation indexing needs `assumptions`,
     * which the search deliberately doesn't know about. When provided AND the contexts price
     * IRMAA, tier thresholds are appended to the coarse grid as h-space cliff probes; omitted
     * (e.g. unit tests) → the bracket-top grid is unchanged.
     */
    irmaaScheduleForYear?: (year: number, filingStatus: FilingStatus) => ResolvedIRMAASchedule;
    /**
     * Observability hook: invoked once per scored candidate with its label, after-tax NW,
     * and the exact plan scored. Purely observational (diagnostics / tests) — never affects
     * the search. Production leaves it unset.
     */
    onCandidate?: (label: string, afterTaxNW: number, plan: Map<number, number>) => void;
}

export interface EngineSearchDiagnostics {
    /** Number of full forward sims the search consumed (excludes the pre-scored baseline). */
    sims: number;
    bestHeadroom: number | null;
    bestLabel: string;
    /**
     * Set ONLY when a tail-trim composite wins (#165): the label/headroom of the ANCHOR the
     * trim was built from (the pre-trim best). A trim keeps its anchor's plan through the
     * cutover and shrinks only the tail, so scalar-summary consumers — the #89 MC
     * capHeadroom derivation — should classify the winner by its anchor's family: a trim of
     * a fill-to-h winner still wants the cap at h; a trim of the DP seed still wants no cap.
     */
    trimAnchorLabel?: string;
    trimAnchorHeadroom?: number | null;
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

/** Land cliff probes just UNDER the modeled threshold; the h→MAGI mapping is approximate anyway. */
const CLIFF_PROBE_EPSILON = 1_000;

/**
 * h-space probes for the REAL cash cliffs the bracket-top grid cannot see (F9, fp-review
 * 2026-07-02): IRMAA tier thresholds ($2,297+/yr MFJ tier-1, charged by the engine with its
 * 2-year lookback — real money in the scored replay) and the ACA 400%-FPL subsidy cliff. Both
 * sit MID-INTERVAL between federal bracket tops, making J(h) non-unimodal — golden-section can
 * settle on the wrong shelf. A threshold−ε grid probe pins the just-under-the-cliff candidate
 * explicitly, the cliff-awareness the legacy rate-match search always had (helpers.ts
 * nextThresholdAbove) and the default path dropped. The ACA probe is added ahead of the engine
 * pricing the cliff as real cash (F1): harmless before that lands (just one more fill-to-h
 * candidate), necessary after.
 *
 * h→MAGI mapping (approximate, year-dependent): a fill-to-h plan targets total non-SS ordinary
 * income = stdDed_y + h, while IRMAA MAGI ≈ ordinary + TAXABLE SS + LTCG and ACA MAGI ≈
 * ordinary + GROSS SS + LTCG. Each cliff is mapped at the FIRST context that prices it, with
 * taxable SS approximated at the 85% cap (accurate at IRMAA-level MAGIs). Later years' stdDed /
 * SS / threshold drift and the torpedo's nonlinearity make the mapping approximate — the probe
 * REDUCES the wrong-shelf failure mode rather than eliminating it, which is all a grid point
 * needs to do (the engine score stays exact).
 */
export function computeCliffHeadroomProbes(
    contexts: DPYearContext[],
    irmaaScheduleForYear?: (year: number, filingStatus: FilingStatus) => ResolvedIRMAASchedule,
): number[] {
    const probes: number[] = [];
    // IRMAA: the first context that prices IRMAA (a Medicare year, or the DP-controlled
    // age-63/64 lookback year for early retirees — see DPYearContext.irmaaSurchargeForMAGI).
    const irmaaCtx = contexts.find(c => c.irmaaSurchargeForMAGI);
    if (irmaaCtx && irmaaScheduleForYear) {
        const sched = irmaaScheduleForYear(irmaaCtx.year, irmaaCtx.filingStatus);
        const offset = irmaaCtx.fedParams.standardDeduction + 0.85 * irmaaCtx.ssBenefits + irmaaCtx.ltcgIncome;
        let magi = 0;
        for (let tier = 0; tier < 8; tier++) { // walk the tier floors upward (≤ 6 in the schedule)
            const next = sched.nextThreshold(magi);
            if (next === null) break;
            probes.push(next - offset - CLIFF_PROBE_EPSILON);
            magi = next;
        }
    }
    // ACA 400%-FPL cliff (pre-65 subsidized years). ACA MAGI uses GROSS SS, unlike IRMAA's taxable SS.
    const acaCtx = contexts.find(c => c.acaOptions?.acaSubsidyAware && (c.acaOptions.acaCliffThreshold ?? 0) > 0);
    if (acaCtx?.acaOptions) {
        const offset = acaCtx.fedParams.standardDeduction + acaCtx.ssBenefits + acaCtx.ltcgIncome;
        probes.push(acaCtx.acaOptions.acaCliffThreshold - offset - CLIFF_PROBE_EPSILON);
    }
    return probes;
}

/**
 * Bracket-aligned coarse grid of taxable-income headrooms above the standard deduction.
 * Each bracket threshold is a natural "fill to the top of the bracket below it" target.
 * Capped at the 32% bracket — draining a solvent household past that never wins, and it keeps
 * the sim count down. Cliff probes (F9) ride the same cap, and the grid stays SORTED — the
 * golden-section bracketing indexes a winner's neighbors by position.
 */
function headroomGrid(contexts: DPYearContext[], cliffProbes: number[] = []): number[] {
    const fed = contexts[0].fedParams;
    const cap = fed.brackets.find(b => b.rate >= 0.35)?.threshold ?? Number.POSITIVE_INFINITY;
    const tops = fed.brackets.map(b => b.threshold).filter(t => t > 0 && t <= cap);
    const merged = [0, ...tops, ...cliffProbes.filter(p => p > 0 && p <= cap)].sort((a, b) => a - b);
    // Drop near-coincident points (a probe landing on a bracket top adds nothing but a sim).
    return merged.filter((h, i) => i === 0 || h - merged[i - 1] > 1);
}

export function searchConversionPlanByEngine(
    contexts: DPYearContext[],
    scorePlan: ConversionPlanScorer,
    opts: EngineSearchOptions,
): EngineSearchResult {
    const { baseline, seedPlans = [], startingTradBalance, irmaaScheduleForYear, onCandidate } = opts;
    // Fill-to-headroom with the engine's prior-year-end RMD basis baked in (#5).
    const fillPlan = (h: number): Map<number, number> => fillToHeadroomPlan(contexts, h, startingTradBalance);

    let sims = 0;
    // `kind` tags where the winner came from: 'baseline' (the pre-scored std-ded plan),
    // 'seed' (a passed-in seed plan or a scaled variant of one), 'grid' (fill-to-h), or
    // 'trim' (a tail-trimmed composite of the winner, #165).
    // The golden-section refine keys off `headroom`; the seed-scaling pass keys off `kind`.
    type CandidateKind = 'baseline' | 'seed' | 'grid' | 'trim';
    // Seed with the pre-scored std-ded baseline (its TRUE score + timeline) — the result is
    // ≥ the baseline by construction, so the downstream feasibility floor never fires.
    let best: { headroom: number | null; plan: Map<number, number>; score: ConversionPlanScore; label: string; kind: CandidateKind } =
        { headroom: null, plan: baseline.plan, score: { afterTaxNW: baseline.afterTaxNW, timeline: baseline.timeline }, label: 'std-ded-baseline', kind: 'baseline' };

    const consider = (label: string, headroom: number | null, plan: Map<number, number>, kind: CandidateKind): ConversionPlanScore => {
        const score = scorePlan(plan);
        sims++;
        onCandidate?.(label, score.afterTaxNW, plan);
        if (score.afterTaxNW > best.score.afterTaxNW) best = { headroom, plan, score, label, kind };
        return score;
    };

    // Seed candidates (e.g. the legacy DP plan) — guarantees the result is ≥ each of them.
    for (const s of seedPlans) consider(s.label, null, s.plan, 'seed');

    // Nothing to vary year-over-year → baseline / seeds are the whole search.
    if (contexts.length === 0) {
        return {
            conversionsByYear: best.plan,
            winningTimeline: best.score.timeline,
            diagnostics: { sims, bestHeadroom: best.headroom, bestLabel: best.label },
        };
    }

    // Bracket-aligned fill-to-headroom grid, plus IRMAA/ACA cliff probes (F9).
    const grid = headroomGrid(contexts, computeCliffHeadroomProbes(contexts, irmaaScheduleForYear));
    for (const h of grid) consider(`h=${Math.round(h).toLocaleString()}`, h, fillPlan(h), 'grid');

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
        let f1 = consider(`h=${Math.round(x1).toLocaleString()}`, x1, fillPlan(x1), 'grid').afterTaxNW;
        let f2 = consider(`h=${Math.round(x2).toLocaleString()}`, x2, fillPlan(x2), 'grid').afterTaxNW;
        for (let i = 0; i < 4; i++) {
            if (f1 >= f2) {
                c = x2; x2 = x1; f2 = f1;
                x1 = c - phi * (c - a);
                f1 = consider(`h=${Math.round(x1).toLocaleString()}`, x1, fillPlan(x1), 'grid').afterTaxNW;
            } else {
                a = x1; x1 = x2; f1 = f2;
                x2 = a + phi * (c - a);
                f2 = consider(`h=${Math.round(x2).toLocaleString()}`, x2, fillPlan(x2), 'grid').afterTaxNW;
            }
        }
    }

    // SEED-SCALING PASS (F8, fp-review 2026-07-02): local scaling exploration around a WINNING seed.
    // Seed plans score once with headroom=null, so the golden-section gate above never refines
    // around them — a winning seed (the legacy DP on most real-SS profiles) used to ship with ZERO
    // local exploration. The known #89 failure class was a MAGNITUDE error at a correct SHAPE
    // (~$131k on the cookbook corner), exactly what the ~8 flat-h rivals cannot express — so score
    // seedPlan × {0.8, 0.9, 1.1, 1.2} as candidates, making "the shipped seed plan is a local
    // scaling peak" a PRODUCTION invariant rather than a certification-panel-fixture-only test.
    //
    // Scaling happens in plan-space only: like every other candidate, the engine clamps each
    // year's request to the available Traditional, and the returned timeline is the scored replay
    // of the exact returned plan (the byte-identical-replay invariant is preserved because
    // `consider` stores the timeline produced by scoring that plan).
    //
    // Recursion decision: if a scaled variant wins the first pass, ONE more pass rescales around
    // the new winner (reach ×0.64…×1.44 of the raw seed), then stops — bounded at +8 replays
    // worst case. Deeper recursion buys little: interior multipliers are already bracketed, and
    // the certification sweep's own tolerance is coarser than a ×1.1² step.
    const SEED_SCALES = [0.8, 0.9, 1.1, 1.2];
    const scalePlan = (plan: Map<number, number>, k: number): Map<number, number> => {
        const scaled = new Map<number, number>();
        for (const [year, amt] of plan) {
            const v = amt * k;
            if (v > 0.5) scaled.set(year, v); // same materiality floor as fillToHeadroomPlan
        }
        return scaled;
    };
    for (let pass = 0; pass < 2; pass++) {
        if (best.kind !== 'seed' || best.plan.size === 0) break; // only a winning non-empty seed gets the sweep
        const anchor = best;
        for (const k of SEED_SCALES) {
            consider(`${anchor.label}×${k}`, null, scalePlan(anchor.plan, k), 'seed');
        }
        if (best === anchor) break; // the anchor is a local scaling peak — certified, done
    }

    // TAIL-TRIM PASS (#165): every family above moves ALL years together — flat-h fills,
    // the DP seed, and PROPORTIONAL seed scaling can't keep a plan's early (cheap)
    // conversions while shrinking only its tail. The DP is known to over-convert its final
    // years on profiles where the after-tax ruler exits a modest residual Traditional at
    // ~0% (post-plan RMDs fit under the standard deduction even torpedo-taxed): the last
    // conversion dollars pay a real marginal rate to avoid a ~free exit, and ×0.8/×0.9
    // scaling never corrects it because shrinking the early years loses more than the tail
    // trim gains (measured +0.45% of terminal after-tax NW left on the table on a real
    // profile — the recurring "it drained my Traditional early" report).
    //
    // Candidates: keep the winner's conversions strictly before a cutover year C, and from
    // C on convert `frac × fill-to-headroom(0)` (the std-ded fill — frac spans the SS-torpedo
    // shrinkage of the truly-free headroom empirically; the engine score prices the exact
    // interaction). C sweeps the winner's last TRIM_TAIL_YEARS conversion years; frac=0 is
    // pure truncation (hold the residual for the ruler exit). A short frac probe around the
    // coarse winner then sharpens the level. Bounded: ≤ TRIM_TAIL_YEARS×2 + 2 extra sims.
    let trimAnchor: typeof best | null = null;
    if (best.plan.size > 0) {
        const anchor = best;
        trimAnchor = anchor;
        // Trim against what the anchor ACTUALLY converted, not what it scheduled: a seed
        // plan (the DP) keeps scheduling conversions past the year its own execution drains
        // Traditional — those phantom tail years execute as $0, so cutting there changes
        // nothing. The executed schedule's last conversion years are the real tail.
        const executed = extractConversionPlan(anchor.score.timeline);
        // Tail trickle: fill-to-std-ded WITHOUT the baseline-RMD term of fillToHeadroomPlan.
        // The baseline world never trims, so its Traditional balloons and its RMDs swallow
        // the whole deduction from RMD age on — computing the trickle against them silences
        // it exactly where the trim holds a residual. The residual's true (small) RMDs and
        // the SS torpedo are priced by the engine score; the frac axis absorbs overshoot.
        const tailFill = new Map<number, number>();
        for (const ctx of contexts) {
            const room = ctx.fedParams.standardDeduction - ctx.nonSSOrdinaryIncomeExclRMD;
            if (room > 0.5) tailFill.set(ctx.year, room);
        }
        const composite = (cutover: number, frac: number): Map<number, number> => {
            const p = new Map<number, number>();
            for (const [year, amt] of executed) if (year < cutover) p.set(year, amt);
            if (frac > 0) {
                for (const [year, amt] of tailFill) {
                    if (year >= cutover && amt * frac > 0.5) p.set(year, amt * frac);
                }
            }
            return p;
        };
        const TRIM_TAIL_YEARS = 6;
        const convYears = [...executed.keys()].sort((a, b) => a - b).slice(-TRIM_TAIL_YEARS);
        let bestTrim: { cutover: number; frac: number } | null = null;
        const trial = (cutover: number, frac: number): void => {
            const before = best;
            consider(`trim(C=${cutover},f=${frac.toFixed(2)})`, null, composite(cutover, frac), 'trim');
            if (best !== before) bestTrim = { cutover, frac };
        };
        for (const cutover of convYears) {
            for (const frac of [0, 0.3]) trial(cutover, frac);
        }
        // Refine the trickle level at the winning cutover (the frac axis is the sharper one).
        if (bestTrim !== null) {
            const { cutover, frac } = bestTrim;
            for (const f of [frac - 0.15, frac + 0.15]) {
                if (f > 0.009 && f <= 1) trial(cutover, f);
            }
        }
    }

    const diagnostics: EngineSearchDiagnostics = { sims, bestHeadroom: best.headroom, bestLabel: best.label };
    if (best.kind === 'trim' && trimAnchor !== null) {
        diagnostics.trimAnchorLabel = trimAnchor.label;
        diagnostics.trimAnchorHeadroom = trimAnchor.headroom;
    }
    return {
        conversionsByYear: best.plan,
        winningTimeline: best.score.timeline,
        diagnostics,
    };
}
