/**
 * RothConversionDP.ts
 *
 * Backward-induction dynamic-programming Roth conversion planner.
 *
 * Solved once over the full retirement horizon, this module produces a
 * year-by-year conversion plan that minimizes lifetime tax under the
 * deterministic baseline, with a small back-load preference (δ) layered
 * on top. The result is a `Map<year, conversionAmount>` consumed by the
 * DP-precomputed conversion strategy in YearSolver.
 *
 * State (3D): `(year, traditional_balance, roth_balance)`. Decision:
 * this year's total Traditional → Roth conversion amount (including any
 * std-ded-headroom portion that the baseline would do for free — the
 * DP picks total).
 *
 * Cell evaluation: the year's spending need + this year's tax minus
 * cash supplied by ordinary income forms a `gap`, which flows through a
 * FIXED brokerage → roth → trad spending waterfall. Trad-spending
 * is endogenous (depends on roth state and conversion size) and feeds
 * back into ordinary income; we resolve via a small fixed-point
 * iteration. `yearTax` is the year's actual tax; the V-table sums
 * (yearTax + infeasibility-penalty × unmetNeed) across the horizon.
 * (#186) This waterfall is fixed brokerage → roth → trad — the app's
 * DEFAULT/tax-efficient order. Since the joint drawdown-order optimizer
 * shipped, the engine may CHOOSE a different roth-vs-trad relative order
 * for a given scenario (recorded on year-0's `chosenWithdrawalOrder`), so
 * this is an approximation, not the literal per-scenario engine order.
 * Any resulting error is confined to per-path MC conversions: every
 * deterministic plan is re-scored on the real engine by
 * EngineDirectConversionSearch, which prices the true order.
 *
 * V-table: `V[t]` is a flat `Float64Array` of size
 * `(TRAD_BUCKETS+1) × (ROTH_BUCKETS+1)`. Backward sweep is a triple
 * loop over `(t, tradIdx, rothIdx)` with an inner conversion loop;
 * future cost is looked up via bilinear interpolation in (trad, roth).
 * Forward extract walks `(trad, roth)` jointly from
 * `(currentTradBalance, currentRothBalance)`.
 *
 * Approximations:
 * - Brokerage is exogenous (per-year baseline cap, not state). Plans
 *   that drain brokerage harder than baseline see an inflated cap in
 *   later years — accepted to keep state at 3D.
 * - LTCG income comes from baseline; plans diverging materially in
 *   brokerage usage under-count LTCG tax. Same trade-off.
 * - 5-year Roth-conversion withdrawal rule: not modeled.
 * - IRMAA: not in the codebase yet; will flow through automatically
 *   once `calculateEffectiveConversionTax` learns about it.
 * - Monte-Carlo path divergence: the deterministic projection uses the
 *   open-loop schedule (`conversionsByYear`). Monte Carlo instead solves a
 *   STOCHASTIC version of this DP once (#98): pass `returnDistribution` in the
 *   objective options and the backward transition integrates the return
 *   distribution into the V-table (expectation over Gauss-Hermite quadrature
 *   nodes) instead of growing by a single deterministic rate. That solve emits
 *   a closed-loop POLICY (`DPPlan.policy`) — the argmax conversion per
 *   `(year, trad, roth)` cell — which each MC path looks up at its realized
 *   state (`lookupConversionPolicy`), re-optimizing per path with no re-solve.
 *   Omitting `returnDistribution` leaves the deterministic single-rate
 *   transition byte-for-byte unchanged.
 */

import { TaxParameters, FilingStatus } from "../../data/TaxData";
import { TaxState, resolveTaxEventsForYear } from "../../components/Objects/Taxes/TaxContext";
import { AssumptionsState, getBirthYear, ACA_SUBSIDY_LOSS_DEFAULT } from "../../components/Objects/Assumptions/AssumptionsContext";
import { SimulationYear, DPYearTrace } from "./types";
import * as TaxService from "../../components/Objects/Taxes/TaxService";
import { ACAOptions } from "./helpers";
import { getDistributionPeriod, getRMDStartAge } from "../../data/RMDData";
import { getAcaCliffThreshold } from "./TaxOptimizedWithdrawal";
import { getIRMAASchedule, computeIrmaaMAGI, MEDICARE_ELIGIBILITY_AGE, IRMAA_LOOKBACK_YEARS } from "../../data/IRMAAData";
import { InvestedAccount } from "../../components/Objects/Accounts/models";

// =============================================================================
// CONSTANTS
// =============================================================================

/**
 * Per-year back-load preference. Defined as:
 *   V(t, b) = min over c of [tax(c) + (1 / (1 + δ)) × V(t+1, b')]
 * δ > 0 makes future tax look slightly cheaper than present tax, biasing the
 * optimal plan toward later conversions at the cost of some lifetime-tax
 * efficiency. δ = 0 gives the lifetime-optimal (mildly front-loaded) plan.
 *
 * 0.015 = 1.5%/year — see project memory for rationale.
 */
export const DP_BACKLOAD_DELTA = 0.015;

/**
 * IRMAA bills on a 2-year lag (year N premiums ← year N-2 MAGI), but the DP
 * prices IRMAA same-year (it carries no MAGI history — see DPYearContext.
 * irmaaSurchargeForMAGI). The two agree in the interior and diverge only at
 * the two horizon edges, which this constant governs:
 *
 *  - TAIL: a conversion that spikes MAGI in one of the LAST two horizon years
 *    would bill its surcharge in N+2 — past the simulated horizon — so the
 *    real engine never charges it. Same-year pricing would charge it anyway,
 *    over-penalizing end-of-life conversions and fighting the back-load
 *    preference. The solver drops the IRMAA term for the last 2 years.
 *  - HEAD: the real surcharge for the first two Medicare years (ages 65-66)
 *    comes from pre-Medicare (ages 63-64) MAGI, which is typically lower
 *    (pre-RMD, and the year-65/66 conversion itself can't retroactively raise
 *    it). buildDPYearContexts seeds ages 65-66 with a FIXED surcharge from the
 *    baseline pre-65 MAGI instead of the Medicare year's own (post-RMD,
 *    conversion-sensitive) MAGI.
 *
 * Cheap-approximation note: this models the 2-year lag only at the edges, not
 * through the recursion (a maintainer decision — full-lag state would balloon
 * the DP). The interior is unchanged because same-year and lagged attribution
 * sum to the same lifetime IRMAA total there.
 */
const IRMAA_HORIZON_EDGE_YEARS = 2;

const TRAD_BUCKETS = 100;
/**
 * Roth-balance grid resolution for the 3D state extension. With
 * `determineMaxRoth`'s upper bound of `(roth + trad) × growth^horizon × 1.3`,
 * a typical 30-year retirement spans ~10× initial wealth, so 50 buckets
 * gives ~$320k resolution on a $16M maxRoth — coarse but adequate for
 * distinguishing "Roth depleted" from "Roth has cushion" (the dominant
 * decision the roth dim drives). Halving from 100 to 50 also halves the
 * 2D backward-sweep work, which dominates planConversionsViaDP runtime.
 * Bump if optimization decisions look noisy in late-horizon years.
 * Memory: (TRAD+1)*(ROTH+1)*horizon*8 = ~150 KB/year × 60yr ≈ 9 MB worst-case.
 */
const ROTH_BUCKETS = 50;
const CONVERSION_BUCKETS = 200;
const BALANCE_HEADROOM_FACTOR = 1.3;
const MIN_BALANCE_RANGE = 100_000;
const MIN_CONVERSION_RANGE = 10_000;
/**
 * Caps the per-year conversion grid. Without a cap, dC = currentTradBalance / 50,
 * so a $1.5M trad portfolio gets $30k buckets — too coarse to pick std-deduction
 * headroom (~$29k) precisely, and the DP rounds many years to $0. $500k easily
 * spans the top federal bracket from $0 income, so any optimum will land below it.
 */
const MAX_CONVERSION_CAP = 500_000;
/**
 * Early-withdrawal penalty on Traditional 401k/IRA distributions taken for
 * SPENDING before age 59.5. Mirrors WithdrawalPlanner's flat 10% (it grosses up
 * the withdrawal by `gross * 0.10` for penalized accounts under 59.5). Roth
 * CONVERSIONS are penalty-free and RMDs only start at 73, so only the
 * endogenous `tradSpending` portion of the year's ordinary income is penalized
 * here — never the conversion or RMD. NARROW: trad is last in the spending
 * waterfall (brokerage → roth → trad), reached only when both are depleted —
 * the early-FIRE corner — so this changes outputs only there.
 */
const EARLY_WITHDRAWAL_AGE = 59.5;
const EARLY_WITHDRAWAL_PENALTY_RATE = 0.10;
/**
 * Per-dollar penalty added to yearCost when a (year, trad, roth, conversion)
 * cell can't fund the year's totalNeed (= spendingNeed + yearTax) from the
 * waterfall. Without this, the DP would happily pick "drain trad to zero
 * early so RMDs are 0 forever" because no future tax dominates a real
 * lifetime — but that plan is bankrupt at age 70. Penalty makes infeasible
 * plans strictly dominated. Tunable: $10/$1 unmet is heavy enough relative to
 * the min-tax accumuland (yearly tax, thousands) that the solver will choose
 * any feasible alternative.
 */
const INFEASIBILITY_PENALTY_PER_DOLLAR = 10;
/**
 * Max-wealth accumuland is terminal WEALTH (hundreds of thousands to millions),
 * so the $10 min-tax penalty no longer dominates — an aggressive plan whose
 * terminal-wealth gain exceeds 10×unmet would be chosen with a year unfunded
 * (a ruin). This per-dollar penalty is sized to dwarf any within-cell wealth
 * difference (bounded by ~one year's conversion effect), so any cell with a real
 * shortfall is strictly worst. Gated by a $1 threshold so floating-point residue
 * on feasible cells isn't penalized.
 */
const MAX_WEALTH_INFEASIBILITY_PENALTY = 1e6;
const MAX_WEALTH_UNMET_THRESHOLD = 1; // dollars; below this = feasible (FP residue)

/**
 * #159: minimum standard-deduction headroom (dollars) for a PRE-retirement year
 * to qualify as a conversion-window "gap year" and receive a DP context. Work
 * income counts against the headroom, so any normal full-income working year is
 * far below the standard deduction's edge and builds NO context — a normal
 * career's contexts (and every plan derived from them) are unchanged. The $100
 * floor just keeps noise-level headrooms from growing the DP horizon for a
 * conversion worth less than the extra solve time.
 */
const GAP_YEAR_MIN_HEADROOM = 100;
/** Max-wealth ruin penalty: dominating above the $1 threshold, zero below it. */
const maxWealthUnmetPenalty = (unmet: number): number =>
    unmet > MAX_WEALTH_UNMET_THRESHOLD ? unmet * MAX_WEALTH_INFEASIBILITY_PENALTY : 0;

// =============================================================================
// TYPES
// =============================================================================

/**
 * Per-year exogenous context the DP needs: everything that does not change
 * with the conversion decision. Built once from the baseline simulation.
 */
export interface DPYearContext {
    year: number;
    age: number;

    /**
     * Ordinary income on this year's tax return EXCLUDING SS, EXCLUDING the
     * RMD (DP re-derives RMD from its own trad-balance state), and EXCLUDING
     * any Roth conversion (DP's `c` decision variable IS the total conversion
     * for the year — see evaluateCell, where it's added to ordIncomeBase).
     * Including baseline conversion here would force the DP to think only of
     * "extra above baseline," and the final sim — which executes whatever
     * amount the DP returns — would then never replay the baseline std-ded
     * portion.
     */
    nonSSOrdinaryIncomeExclRMD: number;
    /** Gross SS benefits (taxable portion is computed inside calculateTotalFederalTax). */
    ssBenefits: number;
    /** Realized LTCG + qualified dividends. */
    ltcgIncome: number;

    filingStatus: FilingStatus;
    fedParams: TaxParameters;
    stateParams: TaxParameters | null;
    acaOptions?: ACAOptions;
    /**
     * Medicare IRMAA surcharge as a function of this year's MAGI. Set for Medicare
     * years (age 65+) AND, for early retirees, the age-63/64 lookback years (see
     * HEAD below). The DP carries no MAGI history, so it generally attributes the
     * surcharge to the same year's MAGI (a conversion's surcharge actually lands
     * two years out; same-year attribution sums to the same lifetime total over
     * the interior horizon and makes the DP avoid IRMAA-tripping conversions).
     *
     * Two horizon-edge corrections approximate the real 2-year lag (#76):
     *  - HEAD: ages 65-66 (the first IRMAA_HORIZON_EDGE_YEARS Medicare years) are
     *    billed on pre-Medicare (year−2) MAGI the year-65/66 conversion can't
     *    affect. buildDPYearContexts handles two sub-cases:
     *      • lookback (age 63/64) PRE-retirement → pin this to a CONSTANT
     *        surcharge from the baseline (year−2) MAGI (ignores its `magi` arg).
     *      • lookback (age 63/64) POST-retirement (DP-controlled, early retiree) →
     *        pin the head year to 0 and instead attach a conversion-sensitive
     *        surcharge to the age-63/64 context, pricing the (year+2) Medicare
     *        schedule on that year's own MAGI (the conversion the DP picks there).
     *        So the surcharge is billed exactly once, where the decision is made —
     *        otherwise the DP sized 63-64 conversions blind to the 65-66 IRMAA
     *        they create and over-converted (Finding 2, 2026-06-24 review).
     *  - TAIL: for the last IRMAA_HORIZON_EDGE_YEARS horizon years, the solver
     *    nulls this field (its surcharge would bill past the horizon and never
     *    be charged by the real engine — also covers an age-63/64 lookback whose
     *    Medicare year falls past the horizon).
     */
    irmaaSurchargeForMAGI?: (magi: number) => number;

    /** Trad withdrawal for spending in baseline (excludes RMD; approximated as constant across DP plans). Phase 2: still consumed by the (in-flight 2D) solver. Phase 3 replaces this with endogenous trad-spending in evaluateCell. */
    baselineTradWithdrawal: number;

    /**
     * Pre-tax spending need for the year — `cashflow.totalExpense − (fed + state + fica)`.
     * Used by the 3D solver (Phase 3) as the cash demand the waterfall must cover.
     * Tax is excluded because the DP recomputes its own per-plan year-tax; including
     * baseline tax here would double-count.
     */
    spendingNeed: number;
    /**
     * Brokerage balance ENTERING the year (= end of prior year), used by
     * evaluateCell as the cap on `fromBrokerage` in the spending waterfall.
     * For the first context year (= retirementYear), this is
     * end-of-(retirementYear − 1) — pulled from baseline if available, else
     * from the `startingBrokerageBalance` passed into `buildDPYearContexts`.
     *
     * Approximation note: brokerage is exogenous in pure-3D state, so each
     * year's cap reflects baseline's brokerage trajectory, not the chosen
     * plan's. A DP plan that drains brokerage harder than baseline will
     * under-state the constraint in later years (cap = baseline's larger
     * entering balance, not plan's depleted reality). Accepted to keep
     * state at 3D; revisit if plans diverge materially from baseline
     * brokerage usage.
     */
    baselineBrokerageAvailable: number;
    /** Net growth rate for Roth accounts (mirrors `growthRate` for trad). */
    rothGrowthRate: number;

    /** Diagnostic only: baseline (std-ded-only sub-sim) Roth/brokerage/trad for this year. Not consumed by the solver — printed in per-year debug to make DP-vs-reality divergence visible. */
    baselineRothBalance?: number;
    baselineBrokerageBalance?: number;
    baselineTradBalance?: number;
    /** Diagnostic only: baseline sub-sim's actual conversion amount this year. */
    baselineConversionAmount?: number;
    /** Diagnostic only — set on the FIRST context: baseline trad at (retirementYear − 1). Used to detect off-by-one between DP starting balance and where real-sim's trad actually is at retirement-year start. */
    diagnosticPreRetirementBaselineTrad?: number;
    /**
     * Trad balance ENTERING the year (= engine baseline's end-of-prior-CALENDAR-year
     * balance, tracked across the years #159 gap gating skips). Unset only when the
     * year has no prior baseline row (the first context of an already-retired-today
     * run — covered by DPInputs.currentTradBalance there). #168: the fill-to-headroom
     * candidate family reads this as its RMD basis when consecutive contexts are
     * NON-contiguous (a #159 gap→retirement jump over full-income working years),
     * where the prior CONTEXT's end balance is years stale. For contiguous contexts
     * this equals the prior context's `baselineTradBalance` exactly.
     */
    baselineTradBalanceEnteringYear?: number;

    /** Net (RoR − weighted ER) growth rate for trad accounts. */
    growthRate: number;
    /** Distribution-period divisor for RMD (0 if age < RMD start age). */
    rmdDivisor: number;
}

/** Inputs to the DP solver. */
export interface DPInputs {
    contexts: DPYearContext[];
    /** Current Traditional balance — the DP's starting trad-balance state. */
    currentTradBalance: number;
    /**
     * Current Roth balance — the DP's starting roth-balance state for the
     * 3D extension. Phase 1 plumbs this through but the solver does not yet
     * branch on it (V-table is still 1D in trad). Phase 4 wires it in.
     */
    currentRothBalance: number;
    /**
     * Per-year back-load preference. Defaults to DP_BACKLOAD_DELTA.
     * Exposed as a parameter so tests can pin δ = 0 for deterministic checks.
     */
    backloadDelta?: number;
}

/** Diagnostic info surfaced to the debug page. */
export interface DPDiagnostics {
    backloadDelta: number;
    tradBuckets: number;
    rothBuckets: number;
    conversionBuckets: number;
    /**
     * Legacy max-of-horizon scalars (kept for backward compatibility with
     * existing diagnostic consumers and tests). The 3D solver actually
     * uses per-year scales `dBByYear` / `dRothByYear` below.
     */
    maxBalance: number;
    maxRoth: number;
    dB: number;
    dRoth: number;
    /**
     * Per-year V-table grid scales. Index `t` is the bucket width at the
     * START of year `t`; length is `horizonYears + 1`. Each year's grid
     * adapts to that year's reachable (trad, roth) range so early years
     * (where conversion decisions matter) get fine resolution and late
     * years (where roth has compounded) get coarser buckets.
     */
    dBByYear: number[];
    dRothByYear: number[];
    /**
     * Per-year conversion-grid bucket width. Index `t` is the conversion
     * bucket size for year `t`; the largest candidate that year is
     * `CONVERSION_BUCKETS × dCByYear[t]`. Sized to year `t`'s reachable
     * trad balance so late-year conversions above the year-0 ceiling are
     * still evaluated.
     */
    dCByYear: number[];
    dC: number;
    maxConversion: number;
    horizonYears: number;
    elapsedMs: number;
    /** Per-year (year → recommended conversion amount). Same data as conversionsByYear, kept for chart rendering. */
    perYearAmounts: Array<{ year: number; age: number; amount: number; estimatedTradBalance: number }>;
    /** Debug log lines summarizing solver setup, grid, and per-year forward-walk decisions. */
    summaryLogs: string[];
    /** Per-year debug strings keyed by simulation year. Consumed by planConversionDP and pushed into the year's decisions/logs. */
    perYearDebug: Map<number, string[]>;
    /**
     * Structured per-year traces (numeric form of [DEBUG DP …] logs). Consumed
     * by the Roth debug screen to render the cost curve, waterfall, and
     * balance-flow visualizations.
     */
    perYearTraces: Map<number, DPYearTrace>;
}

/**
 * Closed-loop conversion POLICY emitted by the stochastic solve (#98): the
 * argmax conversion as a function of `(year, trad, roth)` state. Each MC path
 * looks this up at its realized state via {@link lookupConversionPolicy} —
 * no per-path re-solve. Only populated when `returnDistribution` is passed.
 */
export interface DPPolicy {
    tradBuckets: number;
    rothBuckets: number;
    /**
     * Per simulation year: the conversion table (flat Float64Array, stride
     * `rothBuckets + 1`, indexed `tradIdx*(rothBuckets+1) + rothIdx`) holding the
     * optimal conversion $ for that cell, plus the year's grid bucket widths.
     */
    byYear: Map<number, { table: Float64Array; dB: number; dRoth: number }>;
    /**
     * #89 MC over-conversion cap. The deterministic engine-search optimum expressed as a
     * taxable-income headroom above the standard deduction (h*): each MC path caps its policy
     * conversion so realized taxable income ≤ stdDed + capHeadroom (see YearSolver.planConversionDP),
     * preventing the stochastic policy from over-converting past the validated peak on low/no-SS
     * large-Traditional profiles. `undefined` ⇒ NO cap — the legacy DP won the deterministic search,
     * so the policy is already at/under the optimum there (e.g. real-SS profiles) and capping would
     * neuter its #98 bull-path adaptivity.
     */
    capHeadroom?: number;
}

export interface DPPlan {
    conversionsByYear: Map<number, number>;
    diagnostics: DPDiagnostics;
    /** Closed-loop policy — only set when the solve integrated a return distribution (#98). */
    policy?: DPPolicy;
}

// =============================================================================
// CONTEXT EXTRACTION
// =============================================================================

/**
 * Sum brokerage balances for a SimulationYear. Diagnostic only.
 */
function sumBrokerageBalanceDiag(simYear: SimulationYear): number {
    return simYear.accounts
        .filter((acc): acc is InvestedAccount =>
            acc instanceof InvestedAccount && acc.taxType === 'Brokerage'
        )
        .reduce((sum, acc) => sum + acc.vestedAmount, 0);
}

/**
 * Sum Roth balances for a SimulationYear. Diagnostic only.
 */
function sumRothBalanceDiag(simYear: SimulationYear): number {
    return simYear.accounts
        .filter((acc): acc is InvestedAccount =>
            acc instanceof InvestedAccount && acc.taxType === 'Roth IRA'
        )
        .reduce((sum, acc) => sum + acc.vestedAmount, 0);
}

/**
 * Sum traditional balances for a SimulationYear. Diagnostic only.
 */
function sumTradBalanceDiag(simYear: SimulationYear): number {
    return simYear.accounts
        .filter((acc): acc is InvestedAccount =>
            acc instanceof InvestedAccount &&
            (acc.taxType === 'Traditional 401k' || acc.taxType === 'Traditional IRA')
        )
        .reduce((sum, acc) => sum + acc.vestedAmount, 0);
}

/**
 * Sum trad withdrawals from this year's withdrawalDetail. RMDs are no longer in
 * withdrawalDetail (they're surfaced as income), so this is already RMD-free.
 */
function sumTraditionalWithdrawals(simYear: SimulationYear): number {
    // withdrawalDetail is keyed by account id (#142); match trad accounts by id.
    const traditionalIds = new Set(
        simYear.accounts
            .filter((acc): acc is InvestedAccount =>
                acc instanceof InvestedAccount &&
                (acc.taxType === 'Traditional 401k' || acc.taxType === 'Traditional IRA')
            )
            .map(acc => acc.id)
    );
    let total = 0;
    for (const [id, amount] of Object.entries(simYear.cashflow.withdrawalDetail || {})) {
        if (traditionalIds.has(id)) total += amount;
    }
    return total;
}

/**
 * Compute the balance-weighted net growth rate for trad accounts in this
 * baseline year. Mirrors InvestedAccount.increment (models.tsx:199-201) so
 * DP's forward sweep tracks real-sim's actual trad evolution. Per-account
 * formula: (customROR ?? globalROR) + inflationAdjustment − expenseRatio.
 * Inflation is added when assumptions.macro.inflationAdjusted is true (the
 * sim runs in nominal dollars). Weighted by vested balance across trad
 * accounts.
 */
function getNetGrowthRate(simYear: SimulationYear, assumptions: AssumptionsState): number {
    const tradAccounts = simYear.accounts.filter((acc): acc is InvestedAccount =>
        acc instanceof InvestedAccount &&
        (acc.taxType === 'Traditional 401k' || acc.taxType === 'Traditional IRA')
    );
    const globalRoR = assumptions.investments.returnRates.ror ?? 7;
    const inflationAdjustment = assumptions.macro.inflationAdjusted
        ? assumptions.macro.inflationRate
        : 0;
    const totalBalance = tradAccounts.reduce((s, a) => s + a.vestedAmount, 0);
    if (totalBalance <= 0) {
        return (globalRoR + inflationAdjustment) / 100;
    }
    const weightedRatePct = tradAccounts.reduce((sum, a) => {
        const ror = a.customROR ?? globalRoR;
        const accountRatePct = ror + inflationAdjustment - a.expenseRatio;
        return sum + accountRatePct * a.vestedAmount;
    }, 0) / totalBalance;
    return weightedRatePct / 100;
}

/**
 * Same formula as `getNetGrowthRate` but filtering for Roth accounts. Used
 * by the 3D solver to project Roth-balance evolution year-over-year. When
 * a baseline year has no Roth balance, falls back to the global RoR (DP
 * may project a Roth balance even where baseline has none, e.g. via
 * conversions earlier in the plan).
 */
function getRothGrowthRate(simYear: SimulationYear, assumptions: AssumptionsState): number {
    const rothAccounts = simYear.accounts.filter((acc): acc is InvestedAccount =>
        acc instanceof InvestedAccount && acc.taxType === 'Roth IRA'
    );
    const globalRoR = assumptions.investments.returnRates.ror ?? 7;
    const inflationAdjustment = assumptions.macro.inflationAdjusted
        ? assumptions.macro.inflationRate
        : 0;
    const totalBalance = rothAccounts.reduce((s, a) => s + a.vestedAmount, 0);
    if (totalBalance <= 0) {
        return (globalRoR + inflationAdjustment) / 100;
    }
    const weightedRatePct = rothAccounts.reduce((sum, a) => {
        const ror = a.customROR ?? globalRoR;
        const accountRatePct = ror + inflationAdjustment - a.expenseRatio;
        return sum + accountRatePct * a.vestedAmount;
    }, 0) / totalBalance;
    return weightedRatePct / 100;
}

/**
 * Build per-year contexts from a baseline simulation timeline.
 *
 * The baseline should be a std-ded-only, no-extra-conversion full-horizon sim
 * (so its `nonSSOrdinaryIncome` does not include the conversion the DP is
 * deciding).
 *
 * Horizon (#159): retirement years always get contexts. Pre-retirement years are
 * skipped UNLESS they are income-GAP years — a modeled sabbatical / layoff /
 * income end-date leaving real standard-deduction headroom (work income is
 * included in `nonSSOrdinaryIncomeExclRMD`, so a normal full-income career
 * clears no headroom and builds EXACTLY the contexts it did before; the new
 * capability only activates when a gap exists). Gap years let the optimizer see
 * (and fill) the canonical pre-retirement conversion window; solveWorkingYear
 * executes the resulting plan entries.
 *
 * Gap-year approximations (all bounded by the engine-direct search scoring every
 * candidate plan on the REAL engine):
 *   • The context sequence can be NON-CONTIGUOUS (gap years, then retirement).
 *     The DP's forward sweep compounds one year of growth per context and models
 *     no working-year contributions, so its own seed plan mis-prices the span
 *     between a gap and retirement; it remains just one scored candidate.
 *   • Gap-year contexts carry NO acaOptions (the engine's working-year path
 *     assumes employer coverage and charges no ACA repayment) and NO
 *     irmaaSurchargeForMAGI (the #76 head/lookback seeding is keyed to
 *     retirement-controlled years; a 63/64 gap-year conversion's IRMAA effect is
 *     priced only by the engine score, not the candidate generators).
 */
export function buildDPYearContexts(
    baseline: SimulationYear[],
    assumptions: AssumptionsState,
    taxState: TaxState,
    retirementYear: number,
    /**
     * Brokerage balance entering the FIRST context year (= retirementYear).
     * Falls back to baseline lookup at (retirementYear − 1) when that year
     * is in the baseline; this param covers the already-retired-today case
     * where no prior baseline year exists. Subsequent contexts always use
     * baseline's prior-year ending balance.
     */
    startingBrokerageBalance: number,
): DPYearContext[] {
    const contexts: DPYearContext[] = [];
    const birthYear = getBirthYear(assumptions.milestones);
    const rmdStartAge = getRMDStartAge(birthYear);

    // Reconstruct the milestone-reach-year map from the baseline timeline so
    // milestone-triggered tax events (e.g. "file Single when I retire") resolve
    // to the same years they fired in the real run. First occurrence of each
    // milestone wins.
    //
    // One-year lag: in the main sim a milestone reached in year M only becomes
    // visible to the NEXT year's resolveTaxEventsForYear call — runSimulationLoop
    // records the reach year AFTER simulating year M, so a milestone-triggered
    // tax event takes effect in M+1, not M (see TaxLifeEvent docs). resolveTax-
    // EventsForYear has no lag of its own (it applies as soon as firedYear <=
    // year), so we encode the lag here by storing yearReached + 1. This keeps the
    // DP's per-year filing/state in lockstep with the executed sim. Year-triggered
    // events carry their own exact `year` and are unaffected.
    const reachYears = new Map<string, number>();
    for (const simYear of baseline) {
        simYear.milestoneEvents?.forEach(event => {
            if (!reachYears.has(event.milestoneId)) {
                reachYears.set(event.milestoneId, event.yearReached + 1);
            }
        });
    }

    // Head IRMAA seeding (#76): the first IRMAA_HORIZON_EDGE_YEARS Medicare
    // years (ages 65-66) are billed on the pre-Medicare (ages 63-64) MAGI under
    // the real 2-year lag. The DP carries no MAGI history, so we look that MAGI
    // up from the baseline timeline (which stores each year's AGI-equivalent
    // MAGI on `simYear.magi`) and, for ages 65-66, charge a FIXED surcharge from
    // it rather than letting the surcharge ride the Medicare year's own
    // (post-RMD, conversion-sensitive) MAGI. The pre-65 lookback years are
    // typically pre-retirement, so they carry no DP conversion — exactly the
    // basis the engine bills. We key by year so age-65 reads year−2 (age 63) and
    // age-66 reads year−2 (age 64).
    const baselineMagiByYear = new Map<number, number>();
    for (const simYear of baseline) {
        if (simYear.magi !== undefined) {
            baselineMagiByYear.set(simYear.year, simYear.magi);
        }
    }

    // Diagnostic: capture the baseline sub-sim's trad balance at the year
    // BEFORE retirement. If `currentTradBalance` (used by DP's forward sweep)
    // matches this value, it means the lookup is grabbing the end-of-(year
    // before retirement) record — which is the correct start-of-retirement
    // state. If `currentTradBalance` matches baselineTrad@retirementYear
    // (which is what the existing setup log compares), there's a one-year
    // off-by-one (DP is starting from end-of-retirement-year-1 baseline).
    const preRetirementSimYear = baseline.find(y => y.year === retirementYear - 1);
    const preRetirementBaselineTrad = preRetirementSimYear
        ? sumTradBalanceDiag(preRetirementSimYear)
        : undefined;

    // Track the previous sim year so each context can record the brokerage
    // balance ENTERING that year (= prior year's end). For the first context
    // (= retirementYear), prev = preRetirementSimYear; if that doesn't
    // exist (retiring in year 0 of the sim), fall back to startingBrokerageBalance.
    let prevSimYear: SimulationYear | undefined = preRetirementSimYear;

    for (const simYear of baseline) {
        const age = simYear.year - birthYear;

        const ssBenefits = TaxService.getSocialSecurityBenefits(simYear.incomes, simYear.year);
        const grossIncome = TaxService.getGrossIncome(simYear.incomes, simYear.year);

        // The stored `simYear.incomes` already EXCLUDES RMD-sourced PassiveIncome
        // (SimulationEngine filters it out of the returned year), so
        // getGrossIncome(incomes) is already RMD-free. It also excludes
        // conversions and non-RMD trad withdrawals. Subtracting SS leaves the
        // plan-INDEPENDENT ordinary-on-return — wages/pension/passive — EXCLUDING
        // RMD, SS, conversion, AND baseline trad withdrawals. RMD, conversion,
        // and trad-spending are added back inside evaluateCell using state-derived
        // amounts (Phase 3 makes trad-spending endogenous; Phase 2 leaves a
        // brief inconsistency where the 2D solver under-counts ordinary income
        // in trad-spending years). NOTE: do NOT subtract rmdDetails.totalRMD here
        // — that would remove RMD a second time and wrongly zero out ordinary
        // income in post-RMD years where RMD > wages/pension.
        //
        // #159: for a PRE-retirement year this includes WORK income, which is
        // exactly what makes a normal working year's headroom zero (no gap
        // context, no conversion candidates) while a modeled income gap leaves
        // real standard-deduction headroom.
        //
        // #186: net out pre-tax deferrals (401k / insurance / HSA) so this is the
        // real taxable ordinary base — the engine (YearSolver) taxes
        // grossIncome − getPreTaxExemptions, and computeYearTax below passes
        // preTaxDeductions=0 on the assumption that they're ALREADY netted here.
        // Reading the STORED per-period fields (useStoredValue=true) mirrors the
        // engine's post-increment tax path. Without this a partial-work gap year
        // (e.g. $25k gross / $18k deferred → $7k real taxable) looks like $25k of
        // ordinary income: the std-deduction headroom gate below wrongly skips it
        // (no context, no candidates), and any gap year that does pass gets every
        // conversion candidate undersized by the deferral amount. Post-retirement
        // years have no WorkIncome, so getPreTaxExemptions is 0 and they're
        // byte-for-byte unchanged.
        const preTaxExemptions = TaxService.getPreTaxExemptions(
            simYear.incomes, simYear.year, age, true,
        );
        // #198: net the above-the-line "Yes" expense deductions out of the ordinary
        // tax base too. computeYearTax passes preTaxDeductions=0 (they're assumed
        // already netted here, #186), so subtracting them here is how they lower the
        // DP's priced tax — matching the engine (YearSolver), which adds them to the
        // preTaxDeductions arg of its federal/state tax calls. Precomputed in
        // SimulationEngine from the ENTERING-balance expense list; undefined ⇒ 0, so
        // non-"Yes" plans are byte-for-byte unchanged.
        const expenseAboveLineDeductions = simYear.expenseAboveLineDeductions ?? 0;
        const nonSSOrdinaryIncomeExclRMD = Math.max(
            0,
            grossIncome - ssBenefits - preTaxExemptions - expenseAboveLineDeductions,
        );

        // Apply scheduled tax life events (state move / filing-status change)
        // that have fired by this year, so the DP sees the same per-year filing
        // status and state residency the main sim executes against (#3). Using
        // taxState.filingStatus / taxState.stateResidency directly would pin the
        // year-0 values across the whole horizon and miss e.g. a move to a
        // no-tax state at retirement.
        const effTax = resolveTaxEventsForYear(taxState, simYear.year, reachYears);

        const fedParams = TaxService.getTaxParameters(
            simYear.year, effTax.filingStatus, 'federal', undefined, assumptions
        );
        // Federal params resolve for every filing status in the table; a hole
        // here would throw in solveRetirementYear for the same year anyway.
        // Crash loudly rather than silently dropping a DP context year (the
        // old `continue` also skipped the prevSimYear update that #168's
        // entering-balance tracking relies on).
        if (!fedParams) {
            throw new Error(`No federal tax parameters for year ${simYear.year}`);
        }

        // #199: the baseline year 0 is already REALIZED when the projection
        // starts — runSimulationLoop begins at (startYear + 1) and NEVER
        // re-simulates year 0 — so a DP plan entry for it could never execute.
        // Exclude it UNCONDITIONALLY, before the retirement/gap gate below.
        // Previously this bound lived only inside the #159 gap-year branch, which
        // fires only for pre-retirement years; an already-retired scenario
        // (retirementYear <= startYear, so isGapYear is false for year 0) slipped
        // through and emitted a context for the unexecutable year 0 — in fact TWO,
        // because a partial-year run pushes a synthetic EOY-projection row with the
        // SAME year as yearZero (both == baseline[0].year). The DP then planned a
        // conversion the engine never ran and walked its internal Traditional
        // balance ~$57.5k below the realized walk (the argmax only coincided within
        // one $2.5k bucket before #191's senior-deduction shift). Skipping every
        // row at/below baseline[0].year drops both year-0 duplicates and seeds the
        // DP's forward sweep from the realized end-of-year-0 balances (the DP seed
        // in buildDpSolveInputs anchors on contexts[0].year − 1 = startYear).
        if (simYear.year <= baseline[0].year) {
            prevSimYear = simYear;
            continue;
        }

        // #159: pre-retirement years get a context ONLY when they are income-GAP
        // years with material standard-deduction headroom.
        const isGapYear = simYear.year < retirementYear;
        if (isGapYear) {
            const stdDedHeadroom = fedParams.standardDeduction - nonSSOrdinaryIncomeExclRMD;
            if (stdDedHeadroom < GAP_YEAR_MIN_HEADROOM) {
                prevSimYear = simYear;
                continue;
            }
        }

        // Traditional non-RMD withdrawals are taxed as ordinary income but aren't
        // tracked as Income objects. Phase 2: trad-spending becomes endogenous in
        // the 3D solver (Phase 3's evaluateCell rewrite); we no longer add
        // baseline trad-spending into nonSSOrdinaryIncomeExclRMD. Still computed
        // to populate `baselineTradWithdrawal`, which the in-flight 2D solver
        // uses until Phase 3 lands.
        // withdrawalDetail no longer includes RMD (RMD is surfaced as income), so the
        // trad withdrawal sum is already RMD-free — no subtraction needed.
        const tradNonRMDWithdrawals = sumTraditionalWithdrawals(simYear);

        const ltcgIncome = simYear.taxDetails.longTermCapitalGains ?? 0;
        const stateParams = TaxService.getTaxParameters(
            simYear.year, effTax.filingStatus, 'state', effTax.stateResidency, assumptions
        );

        // #191: the DP prices each cell with computeYearTax → calculateTotalFederalTax,
        // which reads only fedParams.standardDeduction and NEVER the senior add-ons
        // (the year-0 orchestrator applies those, so the DP previously optimized
        // against a raw-standard-deduction tax the engine doesn't actually bill a 65+
        // filer — biasing conversion headroom). Bake the same effective standard
        // deduction the engine (YearSolver) uses into the stored context so the DP's
        // objective matches the executed tax. MAGI proxy for the OBBBA-bonus phaseout
        // = non-SS ordinary (already net of pre-tax deferrals, #186) + LTCG + taxable
        // SS. Non-senior years (incl. every pre-65 gap year) resolve to the raw
        // standard deduction — byte-for-byte unchanged.
        // #198: generalize from standard-only to the full effective deduction so the
        // DP prices the same itemized ≷ standard choice the engine bills. The
        // itemized total (mortgage interest + flagged expenses + capped SALT) is
        // precomputed by SimulationEngine and stored on the SimulationYear — read it
        // back rather than re-deriving from simYear.expenses, which holds the
        // POST-increment (advanced-balance) mortgage and would return next year's
        // interest (§2c off-by-one). effTax carries the year's resolved
        // deductionMethod. Non-itemizing years (⇒ 0 / 'Standard') resolve to the #191
        // standard path — byte-for-byte unchanged.
        const effectiveFedParams = {
            ...fedParams,
            standardDeduction: TaxService.getEffectiveDeduction(
                fedParams,
                effTax.filingStatus,
                age,
                simYear.year,
                nonSSOrdinaryIncomeExclRMD + ltcgIncome +
                    TaxService.getTaxableSocialSecurityBenefits(
                        ssBenefits,
                        nonSSOrdinaryIncomeExclRMD + ltcgIncome,
                        0,
                        effTax.filingStatus,
                    ),
                simYear.itemizedDeductionTotal ?? 0,
                effTax.deductionMethod,
            ),
        };

        // ACA cliff applies pre-65 only (Medicare eligibility starts at 65).
        // #159: never on gap-year contexts — the engine's working-year path
        // assumes employer coverage and charges no ACA repayment (YearSolver
        // sets tax.aca = 0 pre-retirement), so pricing the cliff here would
        // steer candidates away from a cost the engine never bills.
        let acaOptions: ACAOptions | undefined;
        if (!isGapYear && assumptions.investments.acaAware !== false && age < 65) {
            const acaFiling: 'single' | 'married_filing_jointly' =
                effTax.filingStatus === 'Married Filing Jointly' ? 'married_filing_jointly' : 'single';
            acaOptions = {
                currentAge: age,
                acaSubsidyAware: true,
                // Pass assumptions so post-2026 thresholds inflate with the plan
                // (#185) instead of freezing at the last published FPL.
                acaCliffThreshold: getAcaCliffThreshold(acaFiling, simYear.year, assumptions),
                // Same number the engine charges as real cash (YearSolver), so
                // seed and judge price identical cliff economics.
                estimatedSubsidyLoss: assumptions.investments.acaAnnualSubsidyLoss ?? ACA_SUBSIDY_LOSS_DEFAULT,
            };
        }

        // Medicare IRMAA applies at 65+ (mutually exclusive with the ACA cliff above).
        // Resolve the schedule once per year and close over it: computeYearTax calls
        // this once per grid cell, all at the same (filingStatus, year, multiplier).
        // #159: gap-year contexts skip IRMAA pricing entirely (both branches below) —
        // the #76 head/lookback seeding is keyed to retirement-controlled years, and
        // attaching a conversion-sensitive lookback surcharge to a pre-retirement
        // gap year would double-bill against the head-year baseline seed. The engine
        // score still prices any real IRMAA cash exactly.
        const irmaaSchedule = !isGapYear && age >= MEDICARE_ELIGIBILITY_AGE
            ? getIRMAASchedule(effTax.filingStatus, simYear.year, assumptions)
            : undefined;
        let irmaaSurchargeForMAGI: ((magi: number) => number) | undefined;
        if (irmaaSchedule) {
            // Head edge (#76): for the first IRMAA_HORIZON_EDGE_YEARS Medicare
            // years (ages 65-66), the surcharge is set by the pre-65 (year−2)
            // MAGI, NOT this year's conversion-sensitive MAGI. The engine bills
            // those premiums on the age-63/64 MAGI, which a year-65/66 conversion
            // can't retroactively raise.
            // Window = the IRMAA lookback (ages 65-66 are billed on age-63/64
            // MAGI), NOT the tail-skip width — they're equal today but mean
            // different things, so key off the lookback to stay correct if the
            // tail-skip width is ever tuned independently.
            const isMedicareHeadYear =
                age < MEDICARE_ELIGIBILITY_AGE + IRMAA_LOOKBACK_YEARS;
            // When the age-63/64 lookback year is a POST-retirement (DP-
            // controlled) year, the DP's own conversion there drives this
            // head-year premium — so we attribute the surcharge to the lookback
            // year itself (conversion-sensitive, below) and pin THIS head year to
            // 0, avoiding a double-count. The pre-retirement lookback case (early-
            // claimer / not-yet-retired in the lookback window) keeps the #76
            // baseline-MAGI seed: that year carries no DP conversion, so the
            // engine bills exactly the baseline surcharge here.
            const lookbackYear = simYear.year - IRMAA_LOOKBACK_YEARS;
            const lookbackIsDPControlled = isMedicareHeadYear && lookbackYear >= retirementYear;
            const lookbackMagi = isMedicareHeadYear
                ? baselineMagiByYear.get(lookbackYear)
                : undefined;
            if (lookbackIsDPControlled) {
                // Cost lives on the age-63/64 context (see the pre-Medicare branch
                // below); pin the head year so it isn't billed twice.
                irmaaSurchargeForMAGI = () => 0;
            } else if (isMedicareHeadYear && lookbackMagi !== undefined) {
                const seededSurcharge = irmaaSchedule.annualSurcharge(lookbackMagi);
                irmaaSurchargeForMAGI = () => seededSurcharge;
            } else {
                irmaaSurchargeForMAGI = (magi: number) => irmaaSchedule.annualSurcharge(magi);
            }
        } else if (!isGapYear && age >= MEDICARE_ELIGIBILITY_AGE - IRMAA_LOOKBACK_YEARS) {
            // Pre-Medicare IRMAA LOOKBACK year (ages 63-64) that is in-horizon
            // (post-retirement — #159 gap years are gated out above). The premium the
            // engine charges at age 65-66 is set by THIS year's MAGI — including
            // the DP's conversion here — so price the (year + lookback) Medicare
            // schedule on this year's conversion-sensitive MAGI. Without this the
            // DP sized 63-64 conversions blind to the 65-66 IRMAA they create and
            // over-converted (the matching head years above are pinned to 0, so
            // the surcharge is billed exactly once). The tail-skip in
            // planConversionsViaDP nulls this when the Medicare year would fall
            // past the horizon (engine never charges it), so no horizon guard is
            // needed here.
            //
            // Filing status: price against the status PROJECTED FOR THE MEDICARE
            // YEAR (year + lookback) the premium is billed in, NOT this lookback
            // year's. If a filing-status life event fires between the lookback
            // (ages 63-64) and Medicare (ages 65-66) years — e.g. a spouse's
            // death MFJ → Single — the engine bills the surcharge on the
            // Medicare-year bracket schedule, whose thresholds (and thus tier)
            // differ from the lookback year's. Resolving effTax here would size
            // the 63/64 conversion against the wrong schedule.
            const medicareYear = simYear.year + IRMAA_LOOKBACK_YEARS;
            const medicareFilingStatus = resolveTaxEventsForYear(
                taxState, medicareYear, reachYears,
            ).filingStatus;
            const medicareSchedule = getIRMAASchedule(
                medicareFilingStatus, medicareYear, assumptions,
            );
            irmaaSurchargeForMAGI = (magi: number) => medicareSchedule.annualSurcharge(magi);
        }

        const growthRate = getNetGrowthRate(simYear, assumptions);
        const rothGrowthRate = getRothGrowthRate(simYear, assumptions);
        const rmdDivisor = age >= rmdStartAge ? getDistributionPeriod(age) : 0;

        // Pre-tax spending need: cashflow.totalExpense includes baseline taxes,
        // which the DP recomputes per-plan. Strip them so we don't double-count.
        // Early-withdrawal penalty is rolled into `fed` already.
        const baselineTaxes =
            (simYear.taxDetails.fed ?? 0)
            + (simYear.taxDetails.state ?? 0)
            + (simYear.taxDetails.fica ?? 0)
            // IRMAA is in totalExpense too; the DP recomputes it per-plan in
            // computeYearTax, so strip the baseline value to avoid double-counting.
            + (simYear.taxDetails.irmaa ?? 0)
            // Likewise the ACA subsidy repayment (now real engine cash): the DP
            // prices the cliff per-plan via acaOptions in computeYearTax.
            + (simYear.taxDetails.aca ?? 0);
        const spendingNeed = Math.max(
            0,
            (simYear.cashflow.totalExpense ?? 0) - baselineTaxes,
        );

        // Brokerage entering this year. For the first context (= retirementYear),
        // prevSimYear is preRetirementSimYear (year retirementYear − 1) when
        // available; otherwise fall back to the caller-supplied
        // startingBrokerageBalance. For subsequent retirement years, prevSimYear
        // is always populated from the prior loop iteration.
        const baselineBrokerageAvailable = prevSimYear
            ? sumBrokerageBalanceDiag(prevSimYear)
            : startingBrokerageBalance;

        contexts.push({
            year: simYear.year,
            age,
            nonSSOrdinaryIncomeExclRMD,
            ssBenefits,
            ltcgIncome,
            filingStatus: effTax.filingStatus,
            fedParams: effectiveFedParams,
            stateParams: stateParams ?? null,
            acaOptions,
            irmaaSurchargeForMAGI,
            baselineTradWithdrawal: tradNonRMDWithdrawals,
            spendingNeed,
            baselineBrokerageAvailable,
            rothGrowthRate,
            baselineRothBalance: sumRothBalanceDiag(simYear),
            baselineBrokerageBalance: sumBrokerageBalanceDiag(simYear),
            baselineTradBalance: sumTradBalanceDiag(simYear),
            baselineConversionAmount: simYear.rothConversion?.amount ?? 0,
            // Attach the pre-retirement diagnostic only to the FIRST context
            // (i.e., when this is the first push for retirementYear).
            diagnosticPreRetirementBaselineTrad:
                contexts.length === 0 ? preRetirementBaselineTrad : undefined,
            // #168: prevSimYear tracks the prior CALENDAR year (the gap gating above
            // updates it even for skipped years), so this is the engine's true
            // entering-year trad balance even across a #159 context discontinuity.
            baselineTradBalanceEnteringYear:
                prevSimYear ? sumTradBalanceDiag(prevSimYear) : undefined,
            growthRate,
            rmdDivisor,
        });

        prevSimYear = simYear;
    }

    return contexts;
}

// =============================================================================
// CELL EVALUATION
// =============================================================================

/**
 * Compute this year's absolute total tax (federal + state + ACA penalty) for
 * a given total ordinary-income figure. The DP's V-table accumulates these
 * absolute taxes across the horizon, which lets it see future-RMD savings
 * from a today-conversion (lower future trad → lower future RMD → lower
 * future ordinary income → lower future absolute tax). A conversion's
 * marginal tax cost is just `yearTax(with conv) − yearTax(without conv)`.
 *
 * `penalizedTradSpending` is the portion of `ordinaryIncome` that comes from a
 * Traditional withdrawal taken for SPENDING (not a conversion, not an RMD). The
 * engine charges a flat 10% early-withdrawal penalty on it when age < 59.5
 * (WithdrawalPlanner); we add the same here so a pre-59.5 trad-spending cell
 * isn't priced ~10% cheaper than the engine actually bills. Defaults to 0:
 * callers with no trad spending (initial-guess and baseline taxes) pass nothing
 * and are byte-for-byte unchanged. Exported for unit testing the cell tax.
 * @internal
 */
export function computeYearTax(
    ordinaryIncome: number,
    ctx: DPYearContext,
    penalizedTradSpending: number = 0,
): number {
    const fed = TaxService.calculateTotalFederalTax(
        ordinaryIncome,
        ctx.ssBenefits,
        0,                       // STCG
        ctx.ltcgIncome,
        0,                       // preTaxDeductions: netted out of nonSSOrdinaryIncomeExclRMD upstream (#186)
        ctx.filingStatus,
        ctx.fedParams,
    ).totalTax;

    let state = 0;
    if (ctx.stateParams) {
        // Most states tax LTCG as ordinary. #186: match the engine's retirement
        // state-tax path (YearSolver), which ALWAYS excludes SS from the state
        // base — it computes state tax as
        // calculateTax(allOrdinaryIncome − currentSSTaxable + LTCG), i.e. the
        // taxable SS is removed regardless of the state's SS treatment. So the
        // state base here is just non-SS ordinary + LTCG (`ordinaryIncome`
        // already excludes SS; preTaxDeductions are netted into it upstream, so
        // pass 0 deductions to calculateTax).
        //
        // The old branch mirrored calculateUnifiedStateTax (adds taxable SS for
        // socialSecurityTreatment === 'taxable'), but the engine never calls that
        // in the retirement solve. With every shipped state 'exempt' the branch
        // was dead; if a state ever flips to 'taxable' it would have priced a
        // state-SS cost the engine never bills, biasing candidates. Mirror the
        // engine instead.
        const stateBase = ordinaryIncome + ctx.ltcgIncome;
        state = TaxService.calculateTax(stateBase, 0, ctx.stateParams);
    }

    let acaPenalty = 0;
    if (ctx.acaOptions) {
        // ACA MAGI ≈ ordinaryIncome + full SS + LTCG. Cliff is binary at threshold.
        const magi = ordinaryIncome + ctx.ssBenefits + ctx.ltcgIncome;
        if (magi >= ctx.acaOptions.acaCliffThreshold) {
            acaPenalty = ctx.acaOptions.estimatedSubsidyLoss;
        }
    }

    // Medicare IRMAA surcharge (Medicare years only). IRMAA MAGI uses the TAXABLE
    // portion of SS (it's an AGI add-on), unlike the ACA MAGI above which uses gross SS.
    let irmaaPenalty = 0;
    if (ctx.irmaaSurchargeForMAGI) {
        const irmaaMagi = computeIrmaaMAGI(ordinaryIncome, ctx.ssBenefits, ctx.ltcgIncome, ctx.filingStatus);
        irmaaPenalty = ctx.irmaaSurchargeForMAGI(irmaaMagi);
    }

    // 10% early-withdrawal penalty on pre-59.5 Traditional SPENDING (mirrors the
    // engine's WithdrawalPlanner). Conversions/RMDs are excluded by the caller —
    // only `penalizedTradSpending` is passed in.
    const earlyPenalty = ctx.age < EARLY_WITHDRAWAL_AGE
        ? penalizedTradSpending * EARLY_WITHDRAWAL_PENALTY_RATE
        : 0;

    return fed + state + acaPenalty + irmaaPenalty + earlyPenalty;
}

/**
 * Grow `evaluateCell`'s pre-growth end-of-year balances to next-year
 * (post-growth) balances at the deterministic per-account rates — the legacy
 * single-rate transition the deterministic backward sweep and forward extract
 * use to look up V[t+1]. The stochastic solve (#98) does NOT call this; it grows
 * `tradPre`/`rothPre` by each return-quadrature node instead. Kept in one place
 * so the three deterministic call sites stay in lock-step.
 */
function growBalance(
    tradPre: number,
    rothPre: number,
    ctx: DPYearContext,
): { tradNext: number; rothNext: number } {
    return {
        tradNext: tradPre * (1 + ctx.growthRate),
        rothNext: rothPre * (1 + ctx.rothGrowthRate),
    };
}

/**
 * Per-quadrature-node growth factors for one account at one year — the
 * `1 + rate + meanShift + shock` multipliers the stochastic transition applies
 * to a pre-growth balance. The shocks are zero-mean by construction, so the
 * UNFLOORED factors have weighted mean exactly `1 + rate + meanShift`.
 *
 * A single year can't lose more than 100% (a balance can't go negative), so we
 * floor each factor at 0. But once that floor BINDS (a node's shock drops below
 * −(1+rate+meanShift)), clipping those nodes from negative up to 0 lifts the
 * weighted mean above `1 + rate + meanShift` — biasing the backward V-table
 * expectation to grow faster than the σ=0 forward central step and weakening the
 * "on-track path reproduces the central schedule" property (#105). When the floor
 * binds we rescale the floored factors so `E[factor]` lands back exactly on the
 * central step's value (`max(0, 1+rate+meanShift)`, matching the floored mean-
 * path step); scaling non-negative factors by a positive constant keeps them ≥ 0.
 *
 * The floor only binds at very high σ (≳0.28 at n=7); when it does NOT bind we
 * return the raw factors untouched, so every existing low/normal-vol output is
 * byte-for-byte unchanged — `max(0, base+s)` with `base+s ≥ 0` is just `base+s`,
 * and no rescale runs. Returns BALANCE-space factors; index-space callers (the
 * backward sweep) fold in `1/dB`. Shared by the backward sweep and the unified
 * forward extract so the two stay in lock-step.
 */
function buildNodeGrowthFactors(
    rate: number,
    quad: ReturnQuadrature,
    meanShift: number,
): number[] {
    const base = 1 + rate + meanShift;
    const raw = quad.shocks.map(s => base + s);
    // Fast path: floor never binds ⇒ identical to the old `max(0, base+s)`, and
    // (since the unfloored mean is already 1+rate+meanShift) no rescale needed.
    if (!raw.some(f => f < 0)) return raw;
    const floored = raw.map(f => (f < 0 ? 0 : f));
    // Renormalize the floored factors back to the central-step mean so a σ=0
    // ("on-track") path that reads this V-table reproduces the central schedule.
    // Degenerate when the target mean is itself non-positive (pathological
    // meanShift < −1) or the floored mean collapses to 0 — nothing to scale to.
    const target = base < 0 ? 0 : base;
    if (target <= 0) return floored;
    let mean = 0;
    for (let k = 0; k < quad.weights.length; k++) mean += quad.weights[k] * floored[k];
    if (mean <= 0) return floored;
    const scale = target / mean;
    return floored.map(f => f * scale);
}

/**
 * Single-cell evaluation (3D-ready): given (tradBalance, rothBalance,
 * conversion, ctx), simulate the year's spending waterfall and tax in
 * one shot.
 *
 * Tax routing mirrors the real sim's WITHHOLD path: the year's gap
 * (spending need + this-year tax − cash from ordinary income) flows
 * through a FIXED brokerage → roth → trad spending waterfall — the app's
 * default/tax-efficient order (see module header: an approximation now
 * that the joint order optimizer can pick a different roth-vs-trad order;
 * residual error is confined to per-path MC, since deterministic plans are
 * re-scored on the real engine). The portion that ends up coming from trad
 * (`tradSpending`) becomes ordinary income and feeds back into the tax
 * calc. yearTax and tradSpending are coupled, so
 * we resolve via a small fixed-point iteration. Most years converge in 0
 * iterations because there's enough brokerage + Roth (or enough ordinary
 * income from SS/RMD/pension) to keep tradSpending = 0 — the
 * initial-guess yearTax is already exact.
 *
 * Returns:
 * - `yearTax`: actual federal + state + ACA tax (no infeasibility penalty;
 *   the solver applies that separately via `unmetNeed`).
 * - `conversionMarginal`: yearTax − taxBaseline (diagnostic only).
 * - `tradPre`, `rothPre`: end-of-year balances after flows but BEFORE growth.
 *   Both the stochastic backward sweep (grows them per quadrature node) and
 *   the deterministic callers (grow them once at the per-account rate via
 *   `growBalance`) take it from here — `evaluateCell` no longer grows them.
 * - `tradSpending`, `fromRoth`, `fromBrokerage`: waterfall breakdown for
 *   diagnostics.
 * - `unmetNeed`: dollars of `totalNeed` the waterfall couldn't source
 *   (means the plan ran out of money this year). Solver penalizes via
 *   INFEASIBILITY_PENALTY_PER_DOLLAR.
 *
 * `taxBaseline` is `computeYearTax(ordinaryIncomeBase, ctx)` — i.e. tax
 * with conversion = 0 and no trad-spending. Used only for the marginal
 * diagnostic. Cached by the caller so the inner conversion-loop doesn't
 * recompute it 200× per (year, trad, roth).
 *
 * Brokerage is exogenous (per-year baseline cap, not state) — see module
 * header. LTCG is taken from baseline as well; if a DP plan draws much
 * more from brokerage than baseline, this under-counts LTCG tax. Known
 * limitation, accepted to keep state at 3D.
 *
 * Exported for unit testing the cell's spending waterfall and year-tax (incl.
 * the pre-59.5 early-withdrawal penalty on trad spending). @internal
 */
export function evaluateCell(
    tradBalance: number,
    rothBalance: number,
    conversion: number,
    ctx: DPYearContext,
    taxBaseline: number,
    /**
     * Pre-computed initial-guess tax = `computeYearTax(ordIncomeExclTradSpend,
     * ctx)`, i.e. the year's tax assuming zero trad-spending. This quantity
     * depends only on (conversion, tradBalance via RMD) and NOT on
     * rothBalance, so the backward sweep hoists it out of the rothIdx loop and
     * passes it in to avoid recomputing the full fed+state+SS tax once per
     * rothIdx. When omitted (forward extract / debug-curve paths), it's
     * computed inline as before. The fixed-point still recomputes tax inside
     * the loop whenever trad-spending > 0 (the roth-dependent path), so
     * results are numerically identical.
     */
    precomputedInitialTax?: number,
): {
    yearTax: number;
    conversionMarginal: number;
    /** End-of-year Trad BEFORE growth (= trad − conversion − rmd − tradSpending, floored at 0). */
    tradPre: number;
    /** End-of-year Roth BEFORE growth (= roth + conversion − fromRoth, floored at 0). */
    rothPre: number;
    tradSpending: number;
    fromRoth: number;
    fromBrokerage: number;
    unmetNeed: number;
    ordinarySurplus: number;
} {
    const rmd = ctx.rmdDivisor > 0 ? tradBalance / ctx.rmdDivisor : 0;
    const ordIncomeExclTradSpend = ctx.nonSSOrdinaryIncomeExclRMD + rmd + conversion;
    const tradAvailableForSpending = Math.max(0, tradBalance - conversion - rmd);

    // Cash that ordinary income provides this year — wages/pension/passive
    // (nonSSOrdExclRMD), full SS benefits, and RMD all land in the user's
    // pocket and offset the spending+tax demand. Without this offset the
    // waterfall would over-source by the full ordinary-income amount, which
    // in late retirement years (SS+RMD) can be tens of thousands of dollars.
    // Conversion is intentionally NOT in here: a conversion creates ordinary
    // income for tax purposes but is a Trad→Roth transfer, not cash.
    const cashFromOrdinary =
        ctx.nonSSOrdinaryIncomeExclRMD + ctx.ssBenefits + rmd;

    // Initial guess: tax assuming no trad-spending. This is exact when the
    // waterfall can cover totalNeed from brokerage + roth alone (the common
    // case in early retirement years). Depends only on (conversion,
    // tradBalance) — the backward sweep precomputes it once per (tradIdx,
    // convIdx) and passes it in (see precomputedInitialTax docs).
    let yearTax = precomputedInitialTax !== undefined
        ? precomputedInitialTax
        : computeYearTax(ordIncomeExclTradSpend, ctx);
    let fromBrokerage = 0;
    let fromRoth = 0;
    let tradSpending = 0;

    // Fixed-point: yearTax → totalNeed → waterfall → tradSpending →
    // ordIncome → yearTax. Up to 5 iterations; in practice 1-2.
    for (let iter = 0; iter < 5; iter++) {
        // totalNeed is the cash gap the waterfall must source: spending
        // demand (livingPlusPayroll + this year's tax) minus cash supplied
        // by ordinary income. Clamped to ≥ 0 — surplus years have no gap.
        const totalNeed = Math.max(
            0,
            ctx.spendingNeed + yearTax - cashFromOrdinary,
        );
        fromBrokerage = Math.min(totalNeed, ctx.baselineBrokerageAvailable);
        const remainingAfterBrokerage = totalNeed - fromBrokerage;
        fromRoth = Math.min(remainingAfterBrokerage, rothBalance);
        const tradSpendingNeeded = Math.max(0, remainingAfterBrokerage - fromRoth);
        tradSpending = Math.min(tradSpendingNeeded, tradAvailableForSpending);

        // No trad-spending ⇒ initial yearTax guess was exact, done.
        if (tradSpending === 0) break;

        const ordIncome = ordIncomeExclTradSpend + tradSpending;
        // tradSpending is a pre-59.5-penalized Traditional distribution for
        // spending; computeYearTax adds the 10% early-withdrawal penalty on it
        // when ctx.age < 59.5 (conversion/RMD inside ordIncome are NOT penalized).
        const newYearTax = computeYearTax(ordIncome, ctx, tradSpending);
        if (Math.abs(newYearTax - yearTax) < 1) {
            yearTax = newYearTax;
            break;
        }
        yearTax = newYearTax;
    }

    const totalNeedFinal = Math.max(
        0,
        ctx.spendingNeed + yearTax - cashFromOrdinary,
    );
    const sourced = fromBrokerage + fromRoth + tradSpending;
    const unmetNeed = Math.max(0, totalNeedFinal - sourced);

    // Surplus years (forced ordinary income — SS + RMD + fixed — exceeds spending +
    // tax) deposit the after-tax leftover to brokerage/savings. Brokerage isn't a DP
    // state variable (exogenous-brokerage approx, #7), so the max-wealth objective
    // credits this surplus as a +wealth term SYMMETRIC to the `-fromBrokerage` leak
    // (#4). Without it, low-conversion paths that throw off big RMD surpluses lose that
    // wealth, biasing the DP toward over-converting. Mutually exclusive with
    // fromBrokerage: a surplus year has no gap to source. Credited at face PV because
    // growth at g exactly cancels the max-wealth 1/(1+g) discount — which implicitly
    // treats the reinvested surplus as growing tax-free like Roth; real brokerage growth
    // is taxed, so this slightly OVER-credits surplus years. Second-order vs the
    // over-conversion it fixes; an explicit brokerage drag would need brokerage as a 3rd
    // DP state (declined — see #7).
    const ordinarySurplus = Math.max(0, cashFromOrdinary - ctx.spendingNeed - yearTax);

    const conversionMarginal = Math.max(0, yearTax - taxBaseline);
    // Pre-growth end-of-year balances. The deterministic transition grows them
    // by the per-account rates (via `growBalance` at the call site); the
    // stochastic solve (#98) instead grows them by each return-quadrature node
    // and takes the expectation. evaluateCell returns the pre-growth balances
    // and leaves growth to whichever branch consumes them.
    const tradPre = Math.max(0, tradBalance - conversion - rmd - tradSpending);
    const rothPre = Math.max(0, rothBalance + conversion - fromRoth);

    return {
        yearTax,
        conversionMarginal,
        tradPre,
        rothPre,
        tradSpending,
        fromRoth,
        fromBrokerage,
        unmetNeed,
        ordinarySurplus,
    };
}

/**
 * Bilinear interpolation lookup into a 2D value-function table indexed by
 * (tradIdx, rothIdx). The table is stored as a flat Float64Array with stride
 * (ROTH_BUCKETS + 1) in the roth dimension — element at (tradIdx, rothIdx)
 * lives at `V[tradIdx * (rothBuckets + 1) + rothIdx]`.
 *
 * Out-of-grid values clamp to the table boundary in each dimension. Returns
 * the bilinear blend of the four enclosing corner samples weighted by the
 * fractional position within the (trad, roth) cell.
 */
function interpV2D(
    V: Float64Array,
    tradBalance: number,
    rothBalance: number,
    dB: number,
    dRoth: number,
    tradBuckets: number,
    rothBuckets: number,
): number {
    // Convert balances to fractional grid indices, then delegate. The hot
    // stochastic sweep skips this and calls interpV2DByIndex directly with
    // indices it computes by MULTIPLYING precomputed reciprocals (#98 perf).
    const trad = tradBalance < 0 ? 0 : tradBalance;
    const roth = rothBalance < 0 ? 0 : rothBalance;
    return interpV2DByIndex(V, trad / dB, roth / dRoth, tradBuckets, rothBuckets);
}

/**
 * Bilinear lookup at pre-computed fractional grid indices (`tIdx = trad/dB`,
 * `rIdx = roth/dRoth`). Lets the per-cell quadrature fold the per-year `1/dB`
 * division into a hoisted factor and multiply in the inner loop. Negative inputs
 * are clamped by the caller (or below, defensively).
 */
function interpV2DByIndex(
    V: Float64Array,
    tIdxIn: number,
    rIdxIn: number,
    tradBuckets: number,
    rothBuckets: number,
): number {
    let tIdx = tIdxIn < 0 ? 0 : tIdxIn;
    let rIdx = rIdxIn < 0 ? 0 : rIdxIn;
    if (tIdx > tradBuckets) tIdx = tradBuckets;
    if (rIdx > rothBuckets) rIdx = rothBuckets;

    const t0 = tIdx | 0;
    const r0 = rIdx | 0;
    const t1 = t0 < tradBuckets ? t0 + 1 : tradBuckets;
    const r1 = r0 < rothBuckets ? r0 + 1 : rothBuckets;

    const tFrac = tIdx - t0;
    const rFrac = rIdx - r0;

    const stride = rothBuckets + 1;
    const v00 = V[t0 * stride + r0];
    const v01 = V[t0 * stride + r1];
    const v10 = V[t1 * stride + r0];
    const v11 = V[t1 * stride + r1];

    const v0 = v00 * (1 - rFrac) + v01 * rFrac;
    const v1 = v10 * (1 - rFrac) + v11 * rFrac;
    return v0 * (1 - tFrac) + v1 * tFrac;
}

// =============================================================================
// STOCHASTIC RETURN QUADRATURE (#98)
// =============================================================================

/**
 * Physicists' Gauss-Hermite abscissae/weights (weight function e^{-x²}), for
 * n ∈ {5, 7, 9}. Used to integrate a function of a Normal return draw:
 *   E[f(R)] = (1/√π) Σ wᵢ f(μ + σ√2·xᵢ),   R ~ Normal(μ, σ).
 * Σ wᵢ = √π, so the normalized weights (wᵢ/√π) sum to 1. Hardcoded (rather than
 * Golub–Welsch at runtime) — these few orders are standard and dependency-free.
 */
const GAUSS_HERMITE: Record<number, { x: number[]; w: number[] }> = {
    5: {
        x: [-2.020182870456086, -0.958572464613819, 0, 0.958572464613819, 2.020182870456086],
        w: [0.019953242059046, 0.393619323152241, 0.945308720482942, 0.393619323152241, 0.019953242059046],
    },
    7: {
        x: [-2.651961356835233, -1.673551628767471, -0.816287882858965, 0,
            0.816287882858965, 1.673551628767471, 2.651961356835233],
        w: [0.000971781245100, 0.054515582819127, 0.425607252610128, 0.810264617556807,
            0.425607252610128, 0.054515582819127, 0.000971781245100],
    },
    9: {
        x: [-3.190993201781528, -2.266580584531843, -1.468553289216668, -0.723551018752838, 0,
            0.723551018752838, 1.468553289216668, 2.266580584531843, 3.190993201781528],
        w: [0.000039606977263, 0.004943624275537, 0.088474527394377, 0.432651559002556, 0.720235215606051,
            0.432651559002556, 0.088474527394377, 0.004943624275537, 0.000039606977263],
    },
};

/**
 * A discretized ZERO-MEAN return shock for the stochastic DP transition. The
 * shock is COMMON to all accounts in a given year (mirroring Monte Carlo's
 * single portfolio-level draw); each account's per-node growth factor is
 * `1 + accountRate + meanShift + shockᵢ`, where `accountRate` is the account's
 * deterministic net rate (`ctx.growthRate`/`ctx.rothGrowthRate`). Keeping the
 * shock zero-mean and adding it to the per-account rate makes the σ=0 limit
 * reduce to the deterministic transition exactly, per account.
 */
/** Gauss-Hermite quadrature node counts with a hardcoded abscissae/weight table. */
export type QuadratureNodes = 5 | 7 | 9;

export interface ReturnQuadrature {
    /** Zero-mean return shocks (decimal) per node = `stdDev·√2·xᵢ`. */
    shocks: number[];
    /** Probability weights per node; sum to 1. */
    weights: number[];
    /** The decimal return volatility this quadrature was built for (grid sizing). */
    stdDev: number;
}

/**
 * Build a Gauss-Hermite shock quadrature for the stochastic transition.
 * `stdDev` is the DECIMAL return volatility (0.15 = 15%), matching the units of
 * `ctx.growthRate` — the caller (MonteCarloEngine) converts its percent-valued
 * config. `nodes` ∈ {5,7,9} (typed, so an unsupported count is a compile error
 * rather than a silent fall-back); defaults to 7. The mean is carried separately
 * as `meanShift` (see DPObjectiveOptions.returnDistribution).
 */
export function buildShockQuadrature(stdDev: number, nodes: QuadratureNodes = 7): ReturnQuadrature {
    const table = GAUSS_HERMITE[nodes];
    const SQRT_PI = Math.sqrt(Math.PI);
    const SQRT_2 = Math.SQRT2;
    const shocks = table.x.map(xi => stdDev * SQRT_2 * xi);
    const weights = table.w.map(wi => wi / SQRT_PI);
    return { shocks, weights, stdDev };
}

/**
 * Look up the closed-loop conversion policy (#98) at a realized
 * `(year, trad, roth)` state via NEAREST-NEIGHBOR (nearest grid cell). Returns
 * `undefined` when the year has no policy entry (e.g. pre-retirement years, or a
 * deterministic plan with no policy). The result is clamped to the gross feasible
 * range `[0, trad]` so the contract is safe for every caller (you can't convert
 * more Traditional than you have, or a negative amount); callers refine with the
 * RMD-aware ceiling.
 *
 * Nearest-neighbor (not bilinear) so the lookup only ever returns a conversion
 * amount the DP ACTUALLY chose at some grid cell — never a synthesized in-between
 * amount near a bracket edge. Both callers see this: the MC per-path lookup in
 * YearSolver and the stochastic central-schedule forward walk below. The nearest
 * index uses the same clamping convention as interpV2DByIndex (negative → 0,
 * over-max → buckets).
 */
export function lookupConversionPolicy(
    policy: DPPolicy, year: number, trad: number, roth: number,
): number | undefined {
    const entry = policy.byYear.get(year);
    if (!entry) return undefined;
    // dB/dRoth are > 0 by construction (MIN_BALANCE_RANGE floor in determineGridScales).
    const tiRaw = entry.dB > 0 ? Math.round(trad / entry.dB) : 0;
    const riRaw = entry.dRoth > 0 ? Math.round(roth / entry.dRoth) : 0;
    const ti = tiRaw < 0 ? 0 : (tiRaw > policy.tradBuckets ? policy.tradBuckets : tiRaw);
    const ri = riRaw < 0 ? 0 : (riRaw > policy.rothBuckets ? policy.rothBuckets : riRaw);
    const raw = entry.table[ti * (policy.rothBuckets + 1) + ri];
    return Math.max(0, Math.min(raw, Math.max(0, trad)));
}

// =============================================================================
// SOLVER
// =============================================================================

/**
 * Compute per-year grid scales (`dBByYear`, `dRothByYear`) for the V-table.
 *
 * A single uniform grid is the wrong shape for a long-horizon DP: realistic
 * roth/trad values span ~$200k–$2M in year 1 but compound to tens of
 * millions over a 40+ year horizon. With one `dRoth`, either early-year
 * values fall inside a single bucket (interp manufactures fake costs from
 * unreachable corners) or late-year values exceed the grid (clipped at
 * boundary). Per-year scales adapt to each year's reachable range.
 *
 * Bounds are derived from two independent forward simulations:
 * - **Trad-max trajectory** (no conversions, no spending): RMD + growth
 *   only. Maximizes the trad balance reachable at year `t`.
 * - **Roth-max trajectory** (convert MAX_CONVERSION_CAP/yr, no spending,
 *   no withdrawals): drains trad into roth as fast as the inner-loop
 *   conversion cap allows, then lets the roth pile compound. Maximizes
 *   the roth balance reachable at year `t`.
 *
 * Both bounds get a 30% headroom factor and a `MIN_BALANCE_RANGE` floor
 * so the grid stays usable for small portfolios. Returned arrays have
 * length `horizonYears + 1` (index `t` covers V[t]'s start-of-year-`t`
 * state space; index `horizonYears` is the terminal V-table).
 */
function determineGridScales(
    contexts: DPYearContext[],
    currentTradBalance: number,
    currentRothBalance: number,
    /**
     * Extra per-year drift added to each account's growth rate (#98 stochastic
     * solve passes `meanShift` so the grid follows the MC mean path, not the
     * deterministic RoR — otherwise meanShift>0 overruns the grid and interpV2D
     * silently clamps the value function). 0 ⇒ deterministic (grid unchanged).
     */
    driftPerYear: number = 0,
    /**
     * Headroom multiplier on each year's reachable max. The stochastic solve
     * widens this beyond BALANCE_HEADROOM_FACTOR (≈ +2σ) so a typical year's
     * up-shock doesn't land past the next year's grid edge.
     */
    headroomFactor: number = BALANCE_HEADROOM_FACTOR,
): { dBByYear: number[]; dRothByYear: number[]; dCByYear: number[] } {
    const horizonYears = contexts.length;
    const tradMaxByYear: number[] = new Array(horizonYears + 1);
    const rothMaxByYear: number[] = new Array(horizonYears + 1);
    tradMaxByYear[0] = currentTradBalance;
    rothMaxByYear[0] = currentRothBalance;

    // Trad-max trajectory: no conversions, no spending. Grow at the (drift-shifted)
    // rate so the stochastic mean path is covered.
    {
        let trad = currentTradBalance;
        for (let t = 0; t < horizonYears; t++) {
            const ctx = contexts[t];
            const rmd = ctx.rmdDivisor > 0 ? trad / ctx.rmdDivisor : 0;
            trad = Math.max(0, trad - rmd) * (1 + ctx.growthRate + driftPerYear);
            tradMaxByYear[t + 1] = trad;
        }
    }

    // Roth-max trajectory: convert as fast as the per-year cap allows.
    {
        let trad = currentTradBalance;
        let roth = currentRothBalance;
        for (let t = 0; t < horizonYears; t++) {
            const ctx = contexts[t];
            const rmd = ctx.rmdDivisor > 0 ? trad / ctx.rmdDivisor : 0;
            const conv = Math.min(MAX_CONVERSION_CAP, Math.max(0, trad - rmd));
            trad = Math.max(0, trad - conv - rmd) * (1 + ctx.growthRate + driftPerYear);
            roth = (roth + conv) * (1 + ctx.rothGrowthRate + driftPerYear);
            rothMaxByYear[t + 1] = roth;
        }
    }

    const dBByYear = tradMaxByYear.map(v =>
        Math.max(MIN_BALANCE_RANGE, v * headroomFactor) / TRAD_BUCKETS
    );
    const dRothByYear = rothMaxByYear.map(v =>
        Math.max(MIN_BALANCE_RANGE, v * headroomFactor) / ROTH_BUCKETS
    );

    // Per-year conversion grid: each year's dC scales to that year's
    // reachable trad balance (the no-conversion/no-spending trad-max
    // trajectory), applying the MAX_CONVERSION_CAP ceiling and
    // MIN_CONVERSION_RANGE floor off the projected balance rather than the
    // year-0 balance.
    // This preserves fine early-year resolution AND full late-year reach,
    // so conversions between the old year-0 ceiling and a later cell's true
    // cMax are no longer silently truncated.
    const dCByYear = tradMaxByYear.map(v =>
        Math.min(MAX_CONVERSION_CAP, Math.max(MIN_CONVERSION_RANGE, v)) / CONVERSION_BUCKETS
    );

    return { dBByYear, dRothByYear, dCByYear };
}

/**
 * Assumed effective rate at which Traditional surviving to the horizon exits when
 * BEQUEATHED to a working heir (SECURE Act 10-year drain, stacked on the heir's own
 * income). Approximated flat — the heir's bracket isn't modeled, only that it's high.
 * (The self-liquidate tail remainder uses the drawdown's own blended rate instead, #14.)
 * Exported for the #89 regression test so it scores the same exit assumption.
 */
export const HEIR_EXIT_RATE = 0.32;

/**
 * Scale the DOLLAR thresholds a post-horizon drawdown year actually consumes —
 * standard deduction + ordinary bracket thresholds — by an inflation-index factor
 * (#157). The exit drawdown prices only ordinary income + SS (no LTCG/STCG →
 * capitalGainsBrackets/NIIT/wageBase are dead here; senior fields are consumed by
 * federalTax.ts, not calculateTotalFederalTax), so those fields pass through
 * unscaled. The SS provisional-income thresholds ($25k/$32k…) are statutorily
 * FROZEN in nominal terms — they live as constants inside TaxService and are
 * correctly untouched by this scaling.
 */
function indexTaxParams(p: TaxParameters, factor: number): TaxParameters {
    return {
        ...p,
        standardDeduction: p.standardDeduction * factor,
        brackets: p.brackets.map(b => ({ threshold: b.threshold * factor, rate: b.rate })),
    };
}

/**
 * Bracket-aware exit VALUE (in horizon-year dollars) of a residual Traditional
 * balance `B` at the horizon — the heart of Change 1 (#89). Instead of a flat
 * (1−τ) haircut, value the residual at the best rate it can actually leave at:
 *
 *  - 'self-liquidate': draw `B` down post-horizon on the RMD schedule at REAL
 *    brackets with no other income, so the std-deduction slice each year exits at
 *    0% and the rest fills low brackets. After-tax proceeds discounted back to the
 *    horizon at `g`. Small balances exit at ~0–8%, large balances (RMDs overflow
 *    into high brackets) approach the top rate — i.e. the value is GRADUATED, which
 *    is what makes the DP's effective conversion ceiling adapt to plan shape.
 *  - 'bequeath': flat (1−HEIR_EXIT_RATE) — a working heir drains it at a high rate,
 *    so the DP should convert anything cheaper than that.
 *
 * Mirrors the harvest-aware valuation used in the offline measurement, lifted into
 * the solver so the objective the DP optimizes equals the objective we score on.
 * Exported so the #89 regression test scores the residual with the SAME function the
 * DP optimizes against (no drifting re-implementation).
 */
export function bracketAwareTradExitValue(
    B: number,
    terminalAge: number,
    g: number,
    fedParams: TaxParameters,
    filing: FilingStatus,
    userSituation: 'self-liquidate' | 'bequeath',
    /**
     * Self-liquidate fix (#89 torpedo): the residual is consumed IN LIFE, so its
     * drawdown stacks on the retiree's persisting late-life Social Security and
     * fixed (pension/passive) income — each withdrawal bears its MARGINAL tax on
     * top of that base, INCLUDING SS-inclusion (the torpedo). The old SS=0 path
     * under-priced the exit and made the DP under-convert in SS-heavy plans. These
     * default to 0, which keeps the prior behavior; bequeath ignores them.
     */
    ssBenefit: number = 0,
    fixedIncome: number = 0,
    /**
     * COLA / inflation rate (#10): the persisting SS + fixed income grow with it each
     * drawdown year, mirroring the nominal inflation-adjusted engine (the residual
     * compounds at nominal g). 0 = freeze nominal (pre-#10 behavior; callers/tests that
     * don't pass it are unchanged).
     */
    cola: number = 0,
    /**
     * State tax params for the residency the residual exits under (fp-review F2). The
     * conversion-cost side prices state tax in full (computeYearTax / the engine), so a
     * fed-only exit over-values residual Traditional and biases the optimizer toward
     * under-conversion in taxed states. Mirrors computeYearTax's state base: non-SS
     * ordinary income, plus the IRS-taxable slice of SS only for SS-taxing states.
     * Frozen at the terminal year's nominal thresholds, same as `fedParams`.
     * null/omitted ⇒ no state tax (no-tax state, unresolvable params, or legacy callers).
     */
    stateParams: TaxParameters | null = null,
    /**
     * Annual inflation-indexation rate for the tax PARAMETERS during the drawdown
     * (#157). Real federal/state brackets and standard deductions are inflation-
     * indexed, so freezing them at the terminal year's nominal thresholds while the
     * residual compounds at nominal g manufactures bracket creep the real world
     * doesn't have — overstating the exit tax on long drawdowns (an over-conversion
     * bias, opposite sign to the F2 state-tax gap). When > 0, drawdown year t prices
     * taxes with `indexTaxParams(params, (1+rate)^t)`. The SS provisional-income
     * thresholds stay statutorily frozen (constants inside TaxService) — which is
     * exactly why this is an in-loop indexation rather than the "evaluate in real
     * terms" (g_real, cola=0) rewrite: a pure real-terms swap would implicitly index
     * those frozen thresholds too, over-valuing SS-heavy small residuals by ~1-2%
     * (measured; see RothExitBracketIndexation.test.ts's truth harness).
     * 0 = prior frozen-bracket behavior; production passes the household inflation
     * rate whenever the sim runs nominal (inflationAdjusted).
     */
    bracketIndexRate: number = 0,
): number {
    if (B < 1) return 0;
    if (userSituation === 'bequeath') return B * (1 - HEIR_EXIT_RATE);
    let bal = B, pv = 0, age = terminalAge, t = 0;
    let grossW = 0, totalTax = 0;
    let ss = ssBenefit, fixed = fixedIncome; // grown by COLA each year below
    // Year-indexed tax params (#157): brackets/std-deduction inflate by
    // (1+bracketIndexRate) each drawdown year (like the real IRS/state schedules);
    // reassigned per year below. bracketIndexRate=0 keeps the terminal-year params
    // untouched (no allocations, prior behavior).
    let fedT = fedParams, stT = stateParams, idx = 1;
    // State tax on a drawdown-year ordinary-income base (fp-review F2). Reads the
    // COLA-grown `ss` and year-indexed `stT` from the enclosing scope, so it's
    // recomputed per year like the federal side.
    const stateTaxOn = (ordinary: number): number => {
        if (!stT) return 0;
        let base = ordinary;
        if (ss > 0 && stT.socialSecurityTreatment === 'taxable') {
            base += TaxService.getTaxableSocialSecurityBenefits(ss, ordinary, 0, filing);
        }
        return TaxService.calculateTax(base, 0, stT);
    };
    while (bal > 100 && t < 45) {
        const div = Math.max(2, getDistributionPeriod(Math.min(age, 115)));
        const w = Math.min(bal, bal / div);
        // The residual withdrawal bears only the MARGINAL tax above the persisting
        // income base (so SS/fixed income aren't taxed to the residual). Recomputed per
        // year because the base grows with COLA (and the brackets index, #157).
        const baseTax = TaxService.calculateTotalFederalTax(fixed, ss, 0, 0, 0, filing, fedT).totalTax
            + stateTaxOn(fixed);
        const taxWith = TaxService.calculateTotalFederalTax(fixed + w, ss, 0, 0, 0, filing, fedT).totalTax
            + stateTaxOn(fixed + w);
        const tax = Math.max(0, taxWith - baseTax); // marginal tax attributable to the withdrawal
        pv += (w - tax) / Math.pow(1 + g, t);
        grossW += w; totalTax += tax;
        bal = (bal - w) * (1 + g);
        ss *= (1 + cola); fixed *= (1 + cola); // COLA growth of persisting income (#10)
        if (bracketIndexRate !== 0) { // bracket indexation (#157)
            idx *= 1 + bracketIndexRate;
            fedT = indexTaxParams(fedParams, idx);
            stT = stateParams ? indexTaxParams(stateParams, idx) : null;
        }
        age++; t++;
    }
    // Tail remainder (only when the residual outran its RMD fraction over the 45-yr
    // window). Self-liquidate values it at the drawdown's OWN blended exit rate (#14) —
    // NOT the heir rate, which contradicts the self-liquidate premise. (Bequeath already
    // returned above.)
    if (bal > 100) {
        const tailRate = grossW > 0 ? Math.min(0.5, totalTax / grossW) : 0;
        pv += (bal * (1 - tailRate)) / Math.pow(1 + g, t);
    }
    return pv;
}

/**
 * Objective options for {@link planConversionsViaDP} (#89). PRODUCTION DEFAULT (derived in
 * useSimulation): `objectiveMode: 'max-wealth'` + `terminalValuation: 'bracket-aware'`, which
 * maximizes PV of after-tax terminal wealth and values residual Traditional at its true
 * graduated exit rate, parameterized by `userSituation`. The four objective touch-points
 * (terminal base case, per-year accumuland, optimizer direction, discount factor) flip on
 * `objectiveMode`.
 *
 * `objectiveMode: 'min-tax'` (the legacy lifetime-tax objective) and `terminalValuation:
 * 'flat'` (flat (1−τ) haircut, `terminalTaxRate`) are RETAINED ONLY for regression tests that
 * A/B the old behavior — no production caller selects them. Omitting the options entirely
 * defaults to min-tax/flat-τ; production always passes the derived max-wealth options.
 */
export interface DPObjectiveOptions {
    objectiveMode?: 'min-tax' | 'max-wealth';
    /** Flat-τ terminal: residual Trad valued at (1−τ). Used when terminalValuation='flat'. */
    terminalTaxRate?: number;
    /**
     * 'flat' (default) = the original flat-τ terminal. 'bracket-aware' = value residual Trad
     * at its TRUE exit rate (graduated: std-ded slice at 0%, then brackets), so the effective
     * conversion ceiling adapts to plan shape + user situation instead of a constant τ.
     */
    terminalValuation?: 'flat' | 'bracket-aware';
    /**
     * For 'bracket-aware' only — what happens to Trad surviving to the horizon:
     *  'self-liquidate' (default): retiree/estate draws it down at real brackets, std-ded
     *    slice at 0% → low exit (~5–13%) → DP won't convert cheap dollars to dodge it
     *    (converges to rate-match's conservatism).
     *  'bequeath': working heir drains it (SECURE 10-yr) at a high flat rate → DP converts
     *    anything below that rate (drains aggressively).
     */
    userSituation?: 'self-liquidate' | 'bequeath';
    /**
     * COLA / inflation rate for the bracket-aware terminal drawdown (#10): grows the
     * persisting SS + fixed income each drawdown year so it stays consistent with the nominal
     * inflation-adjusted engine. Default 0 (freeze nominal); production derives it from the
     * macro inflation assumption.
     */
    terminalCola?: number;
    /**
     * Annual inflation-indexation of the terminal drawdown's tax brackets/std-deduction
     * (#157). DEFAULTS TO `terminalCola` — when the sim runs nominal, the exit valuation
     * indexes its brackets at the same household inflation rate the income COLAs at, so
     * the long post-horizon drawdown no longer manufactures bracket creep (which
     * overstated the exit tax → over-conversion bias). Pass 0 explicitly to reproduce
     * the legacy frozen-bracket terminal — RETAINED ONLY for regression tests that A/B
     * the old behavior (same contract as `objectiveMode: 'min-tax'`); no production
     * caller overrides it.
     */
    terminalBracketIndexation?: number;
    /**
     * STOCHASTIC solve (#98). When set, the backward transition integrates a
     * return distribution into the V-table (expectation over Gauss-Hermite nodes)
     * and the solve emits a closed-loop `DPPolicy`. The model is a COMMON
     * zero-mean shock (volatility `stdDev`, DECIMAL e.g. 0.15) applied each node
     * to BOTH accounts — mirroring Monte Carlo's single portfolio draw — around
     * each account's own deterministic rate plus `meanShift`. `meanShift`
     * (DECIMAL, default 0) re-centers the per-account rates on the Monte Carlo
     * mean: `meanShift = (mcReturnMean − (ror + inflation))/100`, so the policy is
     * optimal for the returns MC actually draws (which can differ from the
     * deterministic projection RoR). `nodes` ∈ {5,7,9}, default 7. Omitted ⇒
     * deterministic per-account transition, no policy (byte-for-byte the legacy
     * behavior); `stdDev=0, meanShift=0` reproduces it exactly.
     */
    returnDistribution?: { stdDev: number; meanShift?: number; nodes?: QuadratureNodes };
}

/**
 * Run the DP backward sweep + forward extract, producing a per-year plan.
 */
export function planConversionsViaDP(
    inputs: DPInputs,
    /** Objective config; see {@link DPObjectiveOptions}. Omitted ⇒ legacy min-tax/flat-τ
     *  (direct / test callers); production passes the derived max-wealth options. */
    opts?: DPObjectiveOptions,
): DPPlan {
    const startedAt = performance.now();
    const { contexts, currentTradBalance, currentRothBalance } = inputs;
    const delta = inputs.backloadDelta ?? DP_BACKLOAD_DELTA;
    const discountFactor = 1 / (1 + delta);

    const objectiveMode = opts?.objectiveMode ?? 'min-tax';
    const isMaxWealth = objectiveMode === 'max-wealth';
    const tau = opts?.terminalTaxRate ?? 0.22;
    const terminalValuation = opts?.terminalValuation ?? 'flat';
    const userSituation = opts?.userSituation ?? 'self-liquidate';
    const terminalCola = opts?.terminalCola ?? 0;
    const terminalBracketIndexation = opts?.terminalBracketIndexation ?? terminalCola;

    // Stochastic solve (#98). When a return distribution is supplied, the
    // backward transition grows the pre-growth balances by each node's per-account
    // factor (deterministic rate + meanShift + common shock) and takes the
    // probability-weighted expectation of the future value, and we record the
    // argmax conversion per cell to emit a closed-loop policy. The discount uses
    // the (shifted) trad mean rate per year (1/(1+growthRate+meanShift)) — under
    // the stochastic model the reinvested-surplus credit cancels in expectation,
    // mirroring the deterministic 1/(1+g). Omitted ⇒ the deterministic
    // per-account path below runs exactly as before.
    const quad = opts?.returnDistribution
        ? buildShockQuadrature(opts.returnDistribution.stdDev, opts.returnDistribution.nodes)
        : null;
    const stochastic = quad !== null;
    const meanShift = opts?.returnDistribution?.meanShift ?? 0;

    // Single source of truth for the per-year objective accumuland (#12), so the
    // backward sweep, forward extract, and debug curve can't drift apart. Max-wealth:
    // surplus-cash credit − brokerage leak − ruin penalty (#4/#2). Min-tax: year tax +
    // infeasibility penalty. The remaining two flip points — the ±Infinity "worst"
    // sentinel and the argmin/argmax comparison — stay inline (trivially symmetric and
    // marked CHANGE 3 at each site); only the multi-term accumuland warranted lifting.
    const yearAccumuland = (cell: {
        yearTax: number; fromBrokerage: number; ordinarySurplus: number; unmetNeed: number;
    }): number =>
        isMaxWealth
            ? cell.ordinarySurplus - cell.fromBrokerage - maxWealthUnmetPenalty(cell.unmetNeed)
            : cell.yearTax + cell.unmetNeed * INFEASIBILITY_PENALTY_PER_DOLLAR;

    const horizonYears = contexts.length;

    // Empty-horizon edge case.
    if (horizonYears === 0) {
        return {
            conversionsByYear: new Map(),
            diagnostics: {
                backloadDelta: delta,
                tradBuckets: TRAD_BUCKETS,
                rothBuckets: ROTH_BUCKETS,
                conversionBuckets: CONVERSION_BUCKETS,
                maxBalance: 0,
                maxRoth: 0,
                dB: 0,
                dRoth: 0,
                dBByYear: [],
                dRothByYear: [],
                dCByYear: [],
                dC: 0,
                maxConversion: 0,
                horizonYears: 0,
                elapsedMs: 0,
                perYearAmounts: [],
                summaryLogs: ['[DEBUG DP] Empty horizon — no contexts to solve.'],
                perYearDebug: new Map(),
                perYearTraces: new Map(),
            },
        };
    }

    // Terminal valuation (max-wealth only). Flat-τ: roth + trad·(1−τ).
    // Bracket-aware (Change 1, #89): roth + the GRADUATED exit value of the
    // residual Trad — std-ded slice at 0%, then brackets — so the DP's effective
    // conversion ceiling tracks the residual's true exit rate per plan/user, not a
    // constant τ. Both feed the V-table base case and the no-candidate fallback.
    const lastCtx = contexts[horizonYears - 1];
    const terminalAge = lastCtx.age + 1;
    // Self-liquidate stacks the residual drawdown on the retiree's persisting
    // late-life income — last-year SS + non-SS fixed income (pension/passive,
    // excl. RMD/conversion). Bequeath ignores these (heir drains it standalone).
    // State tax rides the drawdown too (fp-review F2), using the last context's
    // event-resolved stateParams — the same residency/status the in-horizon side
    // prices conversions with. Brackets/std-deduction index at the household
    // inflation rate across the drawdown (#157) so the frozen-terminal-threshold
    // bracket creep no longer overstates the exit tax.
    const tradTerminalAt = (tradBal: number): number =>
        terminalValuation === 'bracket-aware'
            ? bracketAwareTradExitValue(
                tradBal, terminalAge, lastCtx.growthRate, lastCtx.fedParams, lastCtx.filingStatus,
                userSituation, lastCtx.ssBenefits, lastCtx.nonSSOrdinaryIncomeExclRMD, terminalCola,
                lastCtx.stateParams, terminalBracketIndexation)
            : tradBal * (1 - tau);
    // Terminal wealth = Roth + residual-Trad exit value ONLY (#7). Brokerage and savings
    // are NOT terminal state variables here — the DP's state is (trad, roth), keeping the
    // V-table 2-D. That omission is argmax-EQUIVALENT for choosing the conversion
    // schedule, because brokerage enters the objective through PER-YEAR flows instead of
    // a terminal balance: every year the cell charges `-fromBrokerage` when a conversion's
    // tax (or a spending gap) is funded from brokerage, and credits `+ordinarySurplus`
    // when forced income overflows to brokerage (#4). A conversion's only effect on
    // brokerage is the tax it pulls, which is exactly that per-year leak — so adding the
    // terminal brokerage BALANCE would shift every cell by a near-constant (the
    // schedule-invariant baseline brokerage trajectory) and not change which schedule
    // wins. Savings is a small fixed buffer with no conversion interaction, likewise
    // omitted. (Realized total wealth, incl. brokerage+savings, is still what the #89
    // regression test scores — see RothConversionBracketAware.test.ts.)
    const terminalValue = (tradBal: number, rothBal: number) => rothBal + tradTerminalAt(tradBal);

    // Tail IRMAA skip (#76): drop the same-year IRMAA term for the last
    // IRMAA_HORIZON_EDGE_YEARS horizon years. A conversion there would bill its
    // surcharge two years out — past the horizon — so the real engine never
    // charges it; same-year pricing would over-penalize these end-of-life
    // conversions and undercut the back-load preference. We shadow those
    // contexts with `irmaaSurchargeForMAGI: undefined` so computeYearTax (used
    // in both the backward sweep and the forward extract) skips the surcharge,
    // and use `solveContexts` everywhere the solver prices a cell. Diagnostics
    // that read other context fields are unaffected (only this one field is
    // nulled). The head edge (ages 65-66 seeding) is handled upstream in
    // buildDPYearContexts, which has the baseline pre-65 MAGI.
    const tailSkipFrom = horizonYears - IRMAA_HORIZON_EDGE_YEARS;
    const solveContexts: DPYearContext[] = contexts.map((ctx, t) =>
        (t >= tailSkipFrom && ctx.irmaaSurchargeForMAGI)
            ? { ...ctx, irmaaSurchargeForMAGI: undefined }
            : ctx
    );

    // Stochastic solve (#98): size the grid to the MC mean path (drift = meanShift)
    // with extra UP-headroom so a sustained bull run doesn't compound past the next
    // year's grid edge and get silently clamped by interpV2D (under-converting — the
    // opposite of #98's goal). A flat +2σ only covers ONE year's up-shock; over a
    // multi-year horizon the up-shocks ACCUMULATE, so the buffer is scaled by
    // √horizon (random-walk std-dev growth), capped so a long horizon can't coarsen
    // the fixed-bucket grid resolution to uselessness. The rare outermost node can
    // still clamp — bounded, low-weight. Deterministic solve (quad null) passes 0 /
    // BALANCE_HEADROOM_FACTOR → grid byte-for-byte unchanged.
    const gridDrift = stochastic ? meanShift : 0;
    const STOCH_HEADROOM_SIGMA_K = 2;       // σ multiplier (per √year)
    const STOCH_HEADROOM_SIGMA_CAP = 1.5;   // max σ-buffer added on top of BALANCE_HEADROOM_FACTOR
    const gridHeadroom = quad
        ? BALANCE_HEADROOM_FACTOR + Math.min(
            STOCH_HEADROOM_SIGMA_CAP,
            STOCH_HEADROOM_SIGMA_K * quad.stdDev * Math.sqrt(horizonYears),
        )
        : BALANCE_HEADROOM_FACTOR;
    const { dBByYear, dRothByYear, dCByYear } = determineGridScales(
        contexts, currentTradBalance, currentRothBalance, gridDrift, gridHeadroom,
    );
    // Legacy/representative scalars: max-of-horizon. Some diagnostics
    // consumers (and tests) reference `dB`, `dRoth`, `maxBalance`,
    // `maxRoth` as scalars; we surface the worst-case bucket width across
    // the horizon for backward compatibility.
    const dB = Math.max(...dBByYear);
    const dRoth = Math.max(...dRothByYear);
    const maxBalance = dB * TRAD_BUCKETS;
    const maxRoth = dRoth * ROTH_BUCKETS;
    // Representative scalars for diagnostics: the conversion grid is now
    // per-year (dCByYear), so surface the widest bucket across the horizon
    // (and its implied ceiling) for the DPDiagnostics fields and any
    // consumer (e.g. RothConversionDebug.tsx) that reads scalar dC /
    // maxConversion. The solver itself uses dCByYear[t] per cell.
    const dC = Math.max(...dCByYear);
    const maxConversion = dC * CONVERSION_BUCKETS;
    const summaryLogs: string[] = [];
    const perYearDebug = new Map<number, string[]>();
    const perYearTraces = new Map<number, DPYearTrace>();
    const fmt$ = (n: number) => '$' + Math.round(n).toLocaleString();
    const vTableMB =
        ((TRAD_BUCKETS + 1) * (ROTH_BUCKETS + 1) * (horizonYears + 1) * 8) / (1024 * 1024);
    // Stochastic solve also retains a policy slab per year (~the V-table size minus
    // the terminal slice), held alive via policy.byYear (#98) — count it (#11).
    const policyMB = stochastic
        ? ((TRAD_BUCKETS + 1) * (ROTH_BUCKETS + 1) * horizonYears * 8) / (1024 * 1024) : 0;
    summaryLogs.push(
        `[DEBUG DP] solver: objective=${objectiveMode}` +
        `${isMaxWealth ? ` (τ=${(tau * 100).toFixed(0)}%, df=1/(1+growthRate) per year)` : `, δ=${(delta * 100).toFixed(2)}%, df=${discountFactor.toFixed(4)}`}, ` +
        `tradBuckets=${TRAD_BUCKETS}, rothBuckets=${ROTH_BUCKETS}, convBuckets=${CONVERSION_BUCKETS}, ` +
        `maxConversion=${fmt$(maxConversion)} (dC=${fmt$(dC)}), horizon=${horizonYears} years, ` +
        `V-table 2D ≈ ${vTableMB.toFixed(2)} MB` +
        (stochastic ? ` + policy ≈ ${policyMB.toFixed(2)} MB` : ''),
    );
    // Per-year grid scales. Each year `t` has its own dB[t]/dRoth[t]
    // sized to that year's reachable (trad, roth) range. Early years
    // get fine resolution where conversion decisions matter; late years
    // get looser buckets where roth has compounded but decisions are
    // already locked in. Sample the first few years and a midpoint plus
    // the last to see the shape — printing all 46+ years would be noise.
    const sampleYears = Array.from(new Set([
        0, 1, 5,
        Math.floor(horizonYears / 2),
        horizonYears - 1, horizonYears,
    ].filter(t => t >= 0 && t <= horizonYears)));
    const dBSamples = sampleYears
        .map(t => `t=${t}:${fmt$(dBByYear[t])}`).join(', ');
    const dRothSamples = sampleYears
        .map(t => `t=${t}:${fmt$(dRothByYear[t])}`).join(', ');
    summaryLogs.push(
        `[DEBUG DP] per-year dB (trad bucket width): ${dBSamples}`,
    );
    summaryLogs.push(
        `[DEBUG DP] per-year dRoth (roth bucket width): ${dRothSamples}`,
    );
    let baselineTradPeak = 0;
    let baselineRothPeak = 0;
    for (const c of contexts) {
        if ((c.baselineTradBalance ?? 0) > baselineTradPeak) baselineTradPeak = c.baselineTradBalance ?? 0;
        if ((c.baselineRothBalance ?? 0) > baselineRothPeak) baselineRothPeak = c.baselineRothBalance ?? 0;
    }
    summaryLogs.push(
        `[DEBUG DP] grid-sizing rationale: ` +
        `baselineTradPeak=${fmt$(baselineTradPeak)}, ` +
        `baselineRothPeak=${fmt$(baselineRothPeak)}. ` +
        `Per-year scales above adapt to each year's reachable range; ` +
        `legacy max scalars: maxBalance=${fmt$(maxBalance)} (dB=${fmt$(dB)}), ` +
        `maxRoth=${fmt$(maxRoth)} (dRoth=${fmt$(dRoth)}).`,
    );
    summaryLogs.push(
        `[DEBUG DP] start: currentTradBalance=${fmt$(currentTradBalance)}, ` +
        `currentRothBalance=${fmt$(currentRothBalance)} ` +
        `(both at start of FIRST context year — should be retirement-year balances, not today's), ` +
        `firstYear=${contexts[0].year} (age ${contexts[0].age}), ` +
        `lastYear=${contexts[horizonYears - 1].year} (age ${contexts[horizonYears - 1].age})`,
    );
    // Sample first 3 contexts so the user can see what the DP is seeing.
    for (let i = 0; i < Math.min(3, horizonYears); i++) {
        const c = contexts[i];
        summaryLogs.push(
            `[DEBUG DP] ctx[${i}] year=${c.year} age=${c.age}: ` +
            `nonSSOrdExclRMD=${fmt$(c.nonSSOrdinaryIncomeExclRMD)}, ss=${fmt$(c.ssBenefits)}, ` +
            `ltcg=${fmt$(c.ltcgIncome)}, ` +
            `baselineTradWithdrawal=${fmt$(c.baselineTradWithdrawal)}, ` +
            `rmdDivisor=${c.rmdDivisor.toFixed(2)}, growth=${(c.growthRate * 100).toFixed(2)}%`,
        );
    }

    // V[t] is a flat Float64Array indexed by `tradIdx * (ROTH_BUCKETS+1) + rothIdx`,
    // total size (TRAD_BUCKETS+1) × (ROTH_BUCKETS+1). V[horizonYears] is the terminal
    // value (all zeros — no future tax).
    const V_STRIDE = ROTH_BUCKETS + 1;
    const V_SIZE = (TRAD_BUCKETS + 1) * V_STRIDE;
    const V: Float64Array[] = new Array(horizonYears + 1);
    for (let t = 0; t <= horizonYears; t++) {
        V[t] = new Float64Array(V_SIZE);
    }

    // CHANGE 1 (max-wealth) — terminal slice: fill instead of zero. The min-tax
    // terminal is all-zeros ("no future tax"); the max-wealth terminal is the
    // after-tax wealth of the residual (trad, roth) state, in horizon-year
    // dollars, as a function of the V-table grid coordinates at the horizon
    // scale. Left zero for min-tax so that path is unchanged.
    if (isMaxWealth) {
        const Vterm = V[horizonYears];
        const dB_T = dBByYear[horizonYears];
        const dRoth_T = dRothByYear[horizonYears];
        // Precompute the (possibly expensive, drawdown-loop) Trad terminal value
        // once per trad bucket — it's independent of roth, which adds linearly.
        const tradVal = new Float64Array(TRAD_BUCKETS + 1);
        for (let bi = 0; bi <= TRAD_BUCKETS; bi++) tradVal[bi] = tradTerminalAt(bi * dB_T);
        for (let bi = 0; bi <= TRAD_BUCKETS; bi++) {
            const tv = tradVal[bi];
            for (let ri = 0; ri <= ROTH_BUCKETS; ri++) {
                Vterm[bi * V_STRIDE + ri] = tv + ri * dRoth_T;
            }
        }
    }

    // Policy tables (#98, stochastic only): per year `t`, the argmax conversion
    // for each (tradIdx, rothIdx) cell. Same layout/stride as V. Allocated only
    // for the stochastic solve so the deterministic path's memory is unchanged.
    const policyTables: Float64Array[] | null = stochastic
        ? Array.from({ length: horizonYears }, () => new Float64Array(V_SIZE))
        : null;

    // -----------------------------------------------------------------
    // Backward sweep — 3D state (year, tradIdx, rothIdx).
    //
    // For each (t, tradIdx, rothIdx) cell, iterate over conversion buckets,
    // evaluate the cell to get (yearTax, tradPre, rothPre, unmetNeed), grow the
    // pre-growth balances to next-year (deterministic: growBalance; stochastic:
    // per quadrature node), then look up V[t+1] at those grown balances via
    // bilinear interpolation in trad and roth. The minimum total-cost conversion
    // (max-wealth: maximum) wins. The stochastic
    // solve (#98) instead takes the expected future over the return quadrature
    // and records the winning conversion into `policyTables[t]`.
    //
    // Phase 4 caveat: the inner conversion loop and `taxBaseline` only
    // depend on (t, tradIdx) — recomputing them per rothIdx wastes work.
    // We hoist them outside the rothIdx loop.
    // -----------------------------------------------------------------
    // Reusable initial-guess-tax buffer (#13): fully overwritten per (t, bi) before
    // it's read, so a single allocation serves the whole O(T·B·C) sweep instead of a
    // fresh `new Array` each (t, bi).
    const initialTaxByCi: number[] = new Array(CONVERSION_BUCKETS + 1);
    for (let t = horizonYears - 1; t >= 0; t--) {
        // Use the tail-IRMAA-skipped context for pricing (see solveContexts).
        const ctx = solveContexts[t];
        const Vnext = V[t + 1];
        const Vt = V[t];
        const dB_t = dBByYear[t];
        const dRoth_t = dRothByYear[t];
        const dB_next = dBByYear[t + 1];
        const dRoth_next = dRothByYear[t + 1];
        // CHANGE 4 (max-wealth) — discount factor as the units fix. Terminal V is
        // in horizon-year (grown) dollars; the per-year leak (fromBrokerage) is in
        // year-t dollars. Discount the future value by 1/(1+r) per step so the two
        // combine in consistent PV, where r is the rate the balance grids grow at.
        // The model carries per-account net rates (trad growthRate / rothGrowthRate)
        // and brokerage is exogenous with no explicit rate, so we use this year's
        // trad growthRate as the single-rate proxy — see header note; all three are
        // ~RoR+inflation−ER, so the choice doesn't move the pathology result. δ's
        // min-tax back-load tilt is intentionally dropped here (df is purely 1/(1+r)).
        // Stochastic (#98): discount at the (shifted) trad mean rate, the same
        // single-rate proxy choice (meanShift re-centers on the MC mean). The
        // denominator is floored (#5) so a pathological meanShift < −1 can't make
        // df ±Infinity/negative and corrupt the sweep.
        const meanGrowthDenom = Math.max(0.01, 1 + ctx.growthRate + meanShift);
        // Deterministic max-wealth denominator floored the same way (#5) so a
        // pathological net rate ≤ −100% (e.g. a hand-edited customROR=-100, or
        // -95 with a 6% ER) can't make df +Infinity (at −100%) or negative
        // (below −100%) and fill the V-table with Inf/NaN.
        const detGrowthDenom = Math.max(0.01, 1 + ctx.growthRate);
        const df = stochastic
            ? 1 / meanGrowthDenom
            : (isMaxWealth ? 1 / detGrowthDenom : discountFactor);
        // Per-node growth factors for this year (#98), hoisted out of the cell
        // loops: a common zero-mean shock added to each account's own rate +
        // meanShift, floored at 0 (a balance can't grow negative — and the floored
        // mean is renormalized back to 1+rate+meanShift when the floor binds, #105,
        // a no-op at normal vol). Divide by the next year's bucket width HERE so the
        // inner loop multiplies a precomputed index factor instead of dividing per
        // node per cell (#9 hot-path perf).
        const invDBNext = 1 / dB_next;
        const invDRothNext = 1 / dRoth_next;
        const facTradIdx = quad
            ? buildNodeGrowthFactors(ctx.growthRate, quad, meanShift).map(f => f * invDBNext) : null;
        const facRothIdx = quad
            ? buildNodeGrowthFactors(ctx.rothGrowthRate, quad, meanShift).map(f => f * invDRothNext) : null;

        for (let bi = 0; bi <= TRAD_BUCKETS; bi++) {
            const b = bi * dB_t;

            const rmdAtB = ctx.rmdDivisor > 0 ? b / ctx.rmdDivisor : 0;
            const cMax = Math.max(0, b - rmdAtB);

            // Hoist the roth-INDEPENDENT initial-guess tax out of the rothIdx
            // loop. For a fixed (bi, ci), the conversion `c` and RMD are fixed
            // (cMax depends only on b), so `ordIncomeExclTradSpend =
            // nonSSOrdinaryIncomeExclRMD + rmdAtB + c` — and thus its full
            // fed+state+SS tax — is identical across all rothIdx values. We
            // compute it once per (bi, ci) here and reuse it for every ri.
            // The fixed-point inside evaluateCell still recomputes tax when
            // trad-spending > 0 (the genuinely roth-dependent path), so
            // results are numerically identical. (Buffer reused across (t,bi), #13.)
            {
                let ci = 0;
                for (; ci <= CONVERSION_BUCKETS; ci++) {
                    const c = Math.min(ci * dCByYear[t], cMax);
                    initialTaxByCi[ci] =
                        computeYearTax(ctx.nonSSOrdinaryIncomeExclRMD + rmdAtB + c, ctx);
                    if (c >= cMax) break;
                }
            }
            // Baseline (no-conversion, no-trad-spending) tax for the marginal
            // diagnostic — IS the ci=0 initial-guess tax (c=0), so reuse it instead
            // of a second identical computeYearTax call (#13). Doesn't depend on rothIdx.
            const taxBaseline = initialTaxByCi[0];

            for (let ri = 0; ri <= ROTH_BUCKETS; ri++) {
                const r = ri * dRoth_t;

                // CHANGE 3 (max-wealth) — optimizer direction. Sentinel "worst"
                // flips +Inf→−Inf and the comparison min→max below.
                let bestCost = isMaxWealth ? -Infinity : Infinity;
                let bestC = 0;

                for (let ci = 0; ci <= CONVERSION_BUCKETS; ci++) {
                    const c = Math.min(ci * dCByYear[t], cMax);
                    // evaluateCell returns the pre-growth balances; the stochastic
                    // branch (quad present) grows them per quadrature node, the
                    // deterministic branch (quad null) grows them once via growBalance
                    // below — byte-for-byte unchanged from the prior tradNext/rothNext.
                    const { yearTax, tradPre, rothPre, unmetNeed, fromBrokerage, ordinarySurplus } =
                        evaluateCell(b, r, c, ctx, taxBaseline, initialTaxByCi[ci]);

                    // Future value: deterministic per-account lookup, or — when a
                    // return distribution is supplied (#98) — the expectation over
                    // the quadrature, growing the pre-growth balances by each node's
                    // per-account factor (common shock, mirroring MC's single
                    // portfolio draw). The per-cell tax (yearAccumuland) is
                    // return-independent, so only this interp runs per node.
                    let futureCost: number;
                    if (quad && facTradIdx && facRothIdx) {
                        futureCost = 0;
                        for (let k = 0; k < quad.weights.length; k++) {
                            // facTradIdx/facRothIdx already fold in 1/dB_next, so this
                            // is grid index = pre-growth balance × factor (no divide).
                            futureCost += quad.weights[k] * interpV2DByIndex(
                                Vnext, tradPre * facTradIdx[k], rothPre * facRothIdx[k],
                                TRAD_BUCKETS, ROTH_BUCKETS,
                            );
                        }
                    } else {
                        const { tradNext, rothNext } = growBalance(tradPre, rothPre, ctx);
                        futureCost = interpV2D(
                            Vnext, tradNext, rothNext,
                            dB_next, dRoth_next, TRAD_BUCKETS, ROTH_BUCKETS,
                        );
                    }
                    // CHANGE 2 (max-wealth) — per-year accumuland: charge the
                    // brokerage leak, NOT yearTax. IRA-funded tax already depletes
                    // trad/roth via the waterfall → counted in terminal V;
                    // subtracting yearTax too would double-count. fromBrokerage is
                    // the only outflow that leaves the tracked (trad,roth) system
                    // without landing in terminal V. (min-tax path unchanged.)
                    const totalCost =
                        yearAccumuland({ yearTax, fromBrokerage, ordinarySurplus, unmetNeed }) + df * futureCost;
                    // CHANGE 3 — argmax for max-wealth, argmin for min-tax.
                    if (isMaxWealth ? totalCost > bestCost : totalCost < bestCost) {
                        bestCost = totalCost;
                        bestC = c;
                    }

                    if (c >= cMax) break;
                }

                // No-candidate fallback (defensive; the ci=0 cell is always
                // evaluated so this never fires). Mirror the objective's units:
                // terminal wealth for max-wealth, baseline tax for min-tax.
                const noCandidate = isMaxWealth ? bestCost === -Infinity : bestCost === Infinity;
                Vt[bi * V_STRIDE + ri] = noCandidate
                    ? (isMaxWealth ? terminalValue(b, r) : taxBaseline)
                    : bestCost;
                // Record the winning conversion for the closed-loop policy (#98).
                if (policyTables) policyTables[t][bi * V_STRIDE + ri] = bestC;
            }
        }
    }

    // Assemble the closed-loop policy (#98) keyed by simulation year — BEFORE the
    // forward extract, so the stochastic central walk reads it through the SAME
    // lookupConversionPolicy the MC path uses (no divergent inlined interp math).
    const policy: DPPolicy | undefined = policyTables
        ? {
            tradBuckets: TRAD_BUCKETS,
            rothBuckets: ROTH_BUCKETS,
            byYear: new Map(
                contexts.map((ctx, t) => [ctx.year, {
                    table: policyTables[t], dB: dBByYear[t], dRoth: dRothByYear[t],
                }]),
            ),
        }
        : undefined;

    // -----------------------------------------------------------------
    // Forward extract: walk the policy from current state.
    // -----------------------------------------------------------------
    const conversionsByYear = new Map<number, number>();
    const perYearAmounts: DPDiagnostics['perYearAmounts'] = [];

    let trad = currentTradBalance;
    let roth = currentRothBalance;
    // Snapshot for first-year debug: lets us see in the inspector whether the
    // starting balances DP was handed match the baseline sub-sim's
    // retirement-year balances (they should, per the a7eca53 fix).
    const firstCtx = contexts[0];
    const preRetirementBaselineTradVal = firstCtx.diagnosticPreRetirementBaselineTrad;
    const startingDebug =
        `[DEBUG DP setup] year=${firstCtx.year} (first context): ` +
        `startingTrad=${fmt$(currentTradBalance)}, startingRoth=${fmt$(currentRothBalance)} ` +
        `(both passed into planConversionsViaDP), ` +
        `baselineTrad@firstYear=${fmt$(firstCtx.baselineTradBalance ?? 0)} (END of retirement year in baseline), ` +
        `baselineTrad@(firstYear-1)=${preRetirementBaselineTradVal !== undefined ? fmt$(preRetirementBaselineTradVal) : 'n/a'} ` +
        `(END of year BEFORE retirement = START of retirement year). ` +
        `If startingTrad matches baselineTrad@(firstYear-1) ⇒ correct (start-of-retirement). ` +
        `If startingTrad matches baselineTrad@firstYear ⇒ off-by-one (DP is starting from end-of-retirement-year baseline).`;

    // ONE forward extract for both paths (#106). Per year we run a shared
    // prologue (rmd / cMax / taxBaseline), pick the conversion via a strategy
    // (argmax for the deterministic plan, policy lookup along the mean path for
    // the stochastic plan), build the full DPYearTrace + inspector debug, then
    // step the central trajectory. The strategy differs ONLY in:
    //   • how the year's conversion + per-cell future-cost are chosen, and
    //   • how the central state advances (deterministic per-account rate vs the
    //     mean-rate + meanShift step).
    // Both the deterministic AND stochastic conversion outputs are byte-identical
    // to the two loops this replaced; the stochastic path now also gets the
    // structured trace it previously lacked (#104).

    // Future value of a cell's pre-growth balances — the SAME computation the
    // backward sweep used. Deterministic = a degenerate 1-node quadrature
    // (`growBalance` → bilinear V[t+1]); stochastic = the probability-weighted
    // expectation over the return quadrature (the per-year `1/dB`/`1/dRoth` fold
    // is rebuilt here for the forward walk, which runs only `horizonYears` times).
    const transitionExpectation = (
        tradPre: number, rothPre: number, ctx: DPYearContext, t: number,
    ): number => {
        const Vnext = V[t + 1];
        if (quad) {
            const facT = buildNodeGrowthFactors(ctx.growthRate, quad, meanShift);
            const facR = buildNodeGrowthFactors(ctx.rothGrowthRate, quad, meanShift);
            const invDBNext = 1 / dBByYear[t + 1];
            const invDRothNext = 1 / dRothByYear[t + 1];
            let fc = 0;
            for (let k = 0; k < quad.weights.length; k++) {
                fc += quad.weights[k] * interpV2DByIndex(
                    Vnext, tradPre * facT[k] * invDBNext, rothPre * facR[k] * invDRothNext,
                    TRAD_BUCKETS, ROTH_BUCKETS,
                );
            }
            return fc;
        }
        const { tradNext, rothNext } = growBalance(tradPre, rothPre, ctx);
        return interpV2D(
            Vnext, tradNext, rothNext,
            dBByYear[t + 1], dRothByYear[t + 1], TRAD_BUCKETS, ROTH_BUCKETS,
        );
    };

    // Advance the central state one year. Deterministic = the per-account rate
    // (`growBalance`); stochastic = each account's mean rate (shock = 0) with the
    // meanShift, floored (#5) so a pathological meanShift can't drive balances
    // negative. These post-growth balances are both next year's entering state
    // and the trace's tradNext/rothNext.
    const centralStep = (
        tradPre: number, rothPre: number, ctx: DPYearContext,
    ): { tradNext: number; rothNext: number } =>
        stochastic
            ? {
                tradNext: tradPre * Math.max(0, 1 + ctx.growthRate + meanShift),
                rothNext: rothPre * Math.max(0, 1 + ctx.rothGrowthRate + meanShift),
            }
            : growBalance(tradPre, rothPre, ctx);

    // Pick the year's conversion and report the chosen cell's full evaluation +
    // its (discounted) future and total cost, so the shared trace builder below
    // is strategy-agnostic. Deterministic re-runs the per-cell argmax (golden-
    // mastered); stochastic reads the emitted policy via the SAME
    // lookupConversionPolicy an MC path uses (so a σ=0 path reproduces it).
    type SelectedYear = {
        c: number;
        cell: ReturnType<typeof evaluateCell>;
        futureCost: number;
        discountedFuture: number;
        totalCost: number;
        /** c=0 diagnostics (argmax path only; the policy path leaves them at the chosen cell). */
        costAtZero: number;
        yearTaxAtZero: number;
        futureAtZero: number;
    };
    const selectConversion = (
        ctx: DPYearContext, t: number, df: number,
        cMax: number, taxBaseline: number,
    ): SelectedYear => {
        if (stochastic && policy) {
            // Policy lookup (already clamped to [0, trad]), refined by the
            // RMD-aware ceiling; evaluate that single conversion.
            const cRaw = lookupConversionPolicy(policy, ctx.year, trad, roth) ?? 0;
            const c = Math.min(cRaw, cMax);
            const cell = evaluateCell(trad, roth, c, ctx, taxBaseline);
            const futureCost = transitionExpectation(cell.tradPre, cell.rothPre, ctx, t);
            const yearCost = yearAccumuland(cell);
            const totalCost = yearCost + df * futureCost;
            return {
                c, cell, futureCost, discountedFuture: df * futureCost, totalCost,
                costAtZero: totalCost, yearTaxAtZero: cell.yearTax, futureAtZero: futureCost,
            };
        }
        // Deterministic argmax over conversion buckets.
        let bestC = 0;
        let bestCost = isMaxWealth ? -Infinity : Infinity; // CHANGE 3 mirror.
        let bestCell = evaluateCell(trad, roth, 0, ctx, taxBaseline);
        let bestFuture = 0;
        let costAtZero = isMaxWealth ? -Infinity : Infinity;
        let yearTaxAtZero = 0;
        let futureAtZero = 0;
        for (let ci = 0; ci <= CONVERSION_BUCKETS; ci++) {
            const c = Math.min(ci * dCByYear[t], cMax);
            const cell = evaluateCell(trad, roth, c, ctx, taxBaseline);
            const futureCost = transitionExpectation(cell.tradPre, cell.rothPre, ctx, t);
            // CHANGE 2 mirror — accumuland matches the backward sweep (shared helper, #12).
            const totalCost = yearAccumuland(cell) + df * futureCost;

            if (ci === 0) {
                costAtZero = totalCost;
                yearTaxAtZero = cell.yearTax;
                futureAtZero = futureCost;
            }
            // CHANGE 3 mirror — argmax for max-wealth, argmin for min-tax.
            const improves = isMaxWealth ? totalCost > bestCost : totalCost < bestCost;
            if (improves) {
                bestCost = totalCost;
                bestC = c;
                bestCell = cell;
                bestFuture = futureCost;
            }
            if (c >= cMax) break;
        }
        return {
            c: bestC, cell: bestCell, futureCost: bestFuture,
            discountedFuture: df * bestFuture, totalCost: bestCost,
            costAtZero, yearTaxAtZero, futureAtZero,
        };
    };

    for (let t = 0; t < horizonYears; t++) {
        // Price against the tail-IRMAA-skipped context so the forward extract
        // matches the backward sweep's V-table (see solveContexts).
        const ctx = solveContexts[t];
        // CHANGE 4 mirror — same per-year discount as the backward sweep, so the
        // extracted policy is scored on the identical objective the V-table was
        // built with. Stochastic discounts at the (shifted) mean rate, floored
        // (#5), matching the backward sweep's meanGrowthDenom.
        const df = stochastic
            ? 1 / Math.max(0.01, 1 + ctx.growthRate + meanShift)
            // Floored the same way as the backward sweep (#5) — see detGrowthDenom there.
            : (isMaxWealth ? 1 / Math.max(0.01, 1 + ctx.growthRate) : discountFactor);

        const rmdAtB = ctx.rmdDivisor > 0 ? trad / ctx.rmdDivisor : 0;
        const cMax = Math.max(0, trad - rmdAtB);
        const taxBaseline = computeYearTax(ctx.nonSSOrdinaryIncomeExclRMD + rmdAtB, ctx);

        const sel = selectConversion(ctx, t, df, cMax, taxBaseline);
        const chosenC = sel.c;
        const cell = sel.cell;
        const { tradNext, rothNext } = centralStep(cell.tradPre, cell.rothPre, ctx);

        conversionsByYear.set(ctx.year, chosenC);
        perYearAmounts.push({
            year: ctx.year,
            age: ctx.age,
            amount: chosenC,
            estimatedTradBalance: trad,
        });

        // Per-year debug emitted to the year inspector via planConversionDP.
        // Built for BOTH the argmax and the policy walk; the stochastic path is
        // tagged "DP policy" and notes it read the emitted policy along the mean
        // return path (#104 — previously it got only a single lightweight line).
        const debugLines: string[] = [];
        if (t === 0) {
            // Surface the setup info on the first conversion year so the user
            // can spot starting-balance issues right in the inspector.
            debugLines.push(startingDebug);
        }
        const solverTag = stochastic ? 'DP policy' : 'DP solver';
        debugLines.push(
            `[DEBUG ${solverTag}] year=${ctx.year} age=${ctx.age}: ` +
            `tradEntering=${fmt$(trad)}, rmdAtB=${fmt$(rmdAtB)}, cMax=${fmt$(cMax)}, ` +
            `taxBaseline=${fmt$(taxBaseline)}` +
            (stochastic ? ` (policy lookup along mean path, meanShift=${(meanShift * 100).toFixed(2)}%)` : ''),
        );
        debugLines.push(
            `[DEBUG ${solverTag}] year=${ctx.year}: chose c=${fmt$(chosenC)} ` +
            `(yearTax=${fmt$(cell.yearTax)}, marginal=${fmt$(cell.conversionMarginal)}, ` +
            `discountedFuture=${fmt$(sel.discountedFuture)}, totalCost=${fmt$(sel.totalCost)}, ` +
            `tradNext=${fmt$(tradNext)}, rothNext=${fmt$(rothNext)})`,
        );
        if (!stochastic) {
            // c=0 vs chosen comparison — only meaningful for the argmax walk
            // (the policy path evaluates a single conversion).
            debugLines.push(
                `[DEBUG DP solver] year=${ctx.year}: c=0 totalCost=${fmt$(sel.costAtZero)} ` +
                `(yearTax=${fmt$(sel.yearTaxAtZero)}, discountedFuture=${fmt$(df * sel.futureAtZero)})`,
            );
        }
        // Cost-curve sample at FEDERAL BRACKET BOUNDARIES so each segment in
        // the rate-analysis table represents a single bracket — marginals
        // read 10% → 12% → 22% → 24% → 32% → 35% as expected, instead of
        // averages across multi-bracket ranges. Always include 0, the std-ded
        // boundary, the chosen c, and cMax.
        //
        // Conversion needed to land taxable ordinary income at federal bracket
        // threshold T:  c = (stdDed + T) − existingOrdinaryAtCellEntry
        // where existingOrdinary = nonSSOrdinaryIncomeExclRMD + rmd (excludes
        // the conversion itself, which we're varying).
        const stdDed = ctx.fedParams.standardDeduction;
        const existingOrdinary = ctx.nonSSOrdinaryIncomeExclRMD + rmdAtB;
        const stdDedBoundaryC = Math.max(0, stdDed - existingOrdinary);
        const bracketSampleCs = ctx.fedParams.brackets.map(
            b => Math.max(0, stdDed + b.threshold - existingOrdinary),
        );
        const sampleCs = [
            0,
            stdDedBoundaryC,
            ...bracketSampleCs,
            chosenC,
            cMax,
        ]
            .filter(c => c >= 0 && c <= cMax)
            .sort((a, b) => a - b)
            .filter((c, i, arr) => i === 0 || Math.abs(c - arr[i - 1]) > 0.5);
        const curveParts: string[] = [];
        const costCurve: DPYearTrace['costCurve'] = [];
        for (const sampleC of sampleCs) {
            const r = evaluateCell(trad, roth, sampleC, ctx, taxBaseline);
            // Trace's tradNext/rothNext follow the central trajectory (the same
            // step the chosen cell takes), so deterministic uses growBalance and
            // stochastic uses the mean-rate step — consistent with the displayed
            // walk. The future-cost uses the strategy's expectation.
            const { tradNext: sTradNext, rothNext: sRothNext } = centralStep(r.tradPre, r.rothPre, ctx);
            const fc = transitionExpectation(r.tradPre, r.rothPre, ctx, t);
            const yc = yearAccumuland(r); // shared accumuland (#12)
            const dFut = df * fc;
            const total = yc + dFut;
            curveParts.push(
                `c=${fmt$(sampleC)}→total=${fmt$(total)}` +
                ` (yearTax=${fmt$(r.yearTax)}, dFut=${fmt$(dFut)}, ` +
                `tradNext=${fmt$(sTradNext)}, rothNext=${fmt$(sRothNext)})`,
            );
            costCurve.push({
                c: sampleC,
                yearTax: r.yearTax,
                discountedFuture: dFut,
                totalCost: total,
                tradNext: sTradNext,
                rothNext: sRothNext,
            });
        }
        debugLines.push(
            `[DEBUG DP curve] year=${ctx.year}: ${curveParts.join(' | ')}`,
        );
        // Waterfall breakdown for the chosen conversion. The 3D solver
        // tracks the running roth balance forward, so `cap` reflects what
        // DP's own plan has left in Roth this year — not a baseline proxy.
        // gap = max(0, spendingNeed + yearTax − cashFromOrdinary); sourced
        // through the fixed brokerage → roth → trad waterfall (approximation of
        // the engine's chosen order — see module header / evaluateCell docs).
        const cashFromOrd =
            ctx.nonSSOrdinaryIncomeExclRMD + ctx.ssBenefits + rmdAtB;
        const gap = Math.max(0, ctx.spendingNeed + cell.yearTax - cashFromOrd);
        debugLines.push(
            `[DEBUG DP waterfall] year=${ctx.year}: ` +
            `spendingNeed=${fmt$(ctx.spendingNeed)} + yearTax=${fmt$(cell.yearTax)} − ` +
            `cashFromOrdinary=${fmt$(cashFromOrd)} = gap=${fmt$(gap)} → ` +
            `fromBrokerage=${fmt$(cell.fromBrokerage)} (cap=${fmt$(ctx.baselineBrokerageAvailable)}), ` +
            `fromRoth=${fmt$(cell.fromRoth)} (cap=${fmt$(roth)}), ` +
            `tradSpending=${fmt$(cell.tradSpending)}, unmetNeed=${fmt$(cell.unmetNeed)}`,
        );
        // Forward-sweep decomposition: shows exactly how DP is propagating
        // trad and roth jointly under the chosen plan.
        // tradAfterFlows = tradEntering − conversion − rmd − tradSpending
        // tradNext = tradAfterFlows × (1 + growthRate)
        // rothAfterFlows = rothEntering + conversion − fromRoth
        // rothNext = max(0, rothAfterFlows) × (1 + rothGrowthRate)
        const tradAfterFlows = trad - chosenC - rmdAtB - cell.tradSpending;
        const rothAfterFlows = roth + chosenC - cell.fromRoth;
        debugLines.push(
            `[DEBUG DP forward] year=${ctx.year}: ` +
            `tradEntering=${fmt$(trad)} − c=${fmt$(chosenC)} − rmd=${fmt$(rmdAtB)} − ` +
            `tradSpending=${fmt$(cell.tradSpending)} ` +
            `= ${fmt$(tradAfterFlows)} × (1 + ${(ctx.growthRate * 100).toFixed(2)}%) = tradNext=${fmt$(tradNext)}`,
        );
        debugLines.push(
            `[DEBUG DP forward roth] year=${ctx.year}: ` +
            `rothEntering=${fmt$(roth)} + c=${fmt$(chosenC)} − fromRoth=${fmt$(cell.fromRoth)} ` +
            `= ${fmt$(rothAfterFlows)} × (1 + ${(ctx.rothGrowthRate * 100).toFixed(2)}%) = rothNext=${fmt$(rothNext)}`,
        );
        // Baseline trajectory snapshot (std-ded-only sub-sim). The 3D solver
        // tracks both trad and roth jointly under DP's own plan, so divergence
        // from baseline here is expected and informative — compare DP's
        // tradEntering / rothEntering above with these baseline values to see
        // how the chosen plan differs.
        debugLines.push(
            `[DEBUG DP baseline] year=${ctx.year}: ` +
            `baselineTrad=${fmt$(ctx.baselineTradBalance ?? 0)}, ` +
            `baselineRoth=${fmt$(ctx.baselineRothBalance ?? 0)}, ` +
            `baselineBrokerage=${fmt$(ctx.baselineBrokerageBalance ?? 0)}, ` +
            `baselineConversion=${fmt$(ctx.baselineConversionAmount ?? 0)}, ` +
            `baselineTradWithdrawal=${fmt$(ctx.baselineTradWithdrawal)}`,
        );
        perYearDebug.set(ctx.year, debugLines);

        // Structured trace for the Roth debug screen — now built for BOTH the
        // deterministic argmax walk and the stochastic policy walk (#104). The
        // stochastic walk previously emitted only a debug line, leaving the
        // cost-curve / waterfall / balance-flow screen blank for MC policy plans.
        // The deterministic trace is byte-identical to the old argmax loop's.
        const trace: DPYearTrace = {
            year: ctx.year,
            age: ctx.age,
            chosenC,
            yearTax: cell.yearTax,
            conversionMarginal: cell.conversionMarginal,
            discountedFuture: sel.discountedFuture,
            totalCost: sel.totalCost,
            tradEntering: trad,
            rothEntering: roth,
            rmdAtEntering: rmdAtB,
            cMax,
            taxBaselineNoConv: taxBaseline,
            tradNext,
            rothNext,
            spendingNeed: ctx.spendingNeed,
            cashFromOrdinary: cashFromOrd,
            gap,
            fromBrokerage: cell.fromBrokerage,
            fromRoth: cell.fromRoth,
            tradSpending: cell.tradSpending,
            unmetNeed: cell.unmetNeed,
            baselineBrokerageCap: ctx.baselineBrokerageAvailable,
            costCurve,
            baselineTrad: ctx.baselineTradBalance,
            baselineRoth: ctx.baselineRothBalance,
            baselineBrokerage: ctx.baselineBrokerageBalance,
            baselineConversion: ctx.baselineConversionAmount,
            dB: dBByYear[t],
            dRoth: dRothByYear[t],
        };
        perYearTraces.set(ctx.year, trace);

        trad = tradNext;
        roth = rothNext;
    }

    const elapsedMs = performance.now() - startedAt;
    const totalConverted = Array.from(conversionsByYear.values()).reduce((s, a) => s + a, 0);
    const yearsConverting = Array.from(conversionsByYear.values()).filter(a => a > 0).length;
    summaryLogs.push(
        `[DEBUG DP] result: totalConverted=${fmt$(totalConverted)} across ${yearsConverting}/${horizonYears} years, ` +
        `elapsed=${elapsedMs.toFixed(1)}ms` + (quad ? ` (stochastic policy; nodes=${quad.weights.length}, meanShift=${(meanShift * 100).toFixed(2)}%)` : ''),
    );

    // `policy` was assembled above (before the forward extract) so the central
    // walk could read it through lookupConversionPolicy.

    return {
        conversionsByYear,
        policy,
        diagnostics: {
            backloadDelta: delta,
            tradBuckets: TRAD_BUCKETS,
            rothBuckets: ROTH_BUCKETS,
            conversionBuckets: CONVERSION_BUCKETS,
            maxBalance,
            maxRoth,
            dB,
            dRoth,
            dBByYear,
            dRothByYear,
            dCByYear,
            dC,
            maxConversion,
            horizonYears,
            elapsedMs,
            perYearAmounts,
            summaryLogs,
            perYearDebug,
            perYearTraces,
        },
    };
}
