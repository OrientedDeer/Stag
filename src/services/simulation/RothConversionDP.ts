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
 * cash supplied by ordinary income forms a `gap`, which flows through
 * the real-sim withdrawal order brokerage → roth → trad. Trad-spending
 * is endogenous (depends on roth state and conversion size) and feeds
 * back into ordinary income; we resolve via a small fixed-point
 * iteration. `yearTax` is the year's actual tax; the V-table sums
 * (yearTax + infeasibility-penalty × unmetNeed) across the horizon.
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
import { AssumptionsState, getBirthYear } from "../../components/Objects/Assumptions/AssumptionsContext";
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
const ACA_SUBSIDY_LOSS_DEFAULT = 12_000;
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
     * Medicare IRMAA surcharge as a function of this year's MAGI. Set only for
     * Medicare years (age 65+). The DP carries no MAGI history, so it generally
     * attributes the surcharge to the same year's MAGI (a conversion's surcharge
     * actually lands two years out; same-year attribution sums to the same
     * lifetime total over the interior horizon and makes the DP avoid
     * IRMAA-tripping conversions).
     *
     * Two horizon-edge corrections approximate the real 2-year lag (#76):
     *  - HEAD: for ages 65-66 (the first IRMAA_HORIZON_EDGE_YEARS Medicare
     *    years), buildDPYearContexts pins this to a CONSTANT surcharge derived
     *    from the baseline pre-65 (year−2) MAGI — it ignores its `magi` argument
     *    — because those premiums are billed on pre-Medicare MAGI the year-65/66
     *    conversion can't affect.
     *  - TAIL: for the last IRMAA_HORIZON_EDGE_YEARS horizon years, the solver
     *    nulls this field (its surcharge would bill past the horizon and never
     *    be charged by the real engine).
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
    const traditionalNames = new Set(
        simYear.accounts
            .filter((acc): acc is InvestedAccount =>
                acc instanceof InvestedAccount &&
                (acc.taxType === 'Traditional 401k' || acc.taxType === 'Traditional IRA')
            )
            .map(acc => acc.name)
    );
    let total = 0;
    for (const [name, amount] of Object.entries(simYear.cashflow.withdrawalDetail || {})) {
        if (traditionalNames.has(name)) total += amount;
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
 * deciding). Out-of-retirement years (before retirementAge) are skipped.
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
        if (simYear.year < retirementYear) {
            prevSimYear = simYear;
            continue;
        }
        const age = simYear.year - birthYear;

        const ssBenefits = TaxService.getSocialSecurityBenefits(simYear.incomes, simYear.year);
        const grossIncome = TaxService.getGrossIncome(simYear.incomes, simYear.year);

        // Traditional non-RMD withdrawals are taxed as ordinary income but aren't
        // tracked as Income objects. Phase 2: trad-spending becomes endogenous in
        // the 3D solver (Phase 3's evaluateCell rewrite); we no longer add
        // baseline trad-spending into nonSSOrdinaryIncomeExclRMD. Still computed
        // to populate `baselineTradWithdrawal`, which the in-flight 2D solver
        // uses until Phase 3 lands.
        // withdrawalDetail no longer includes RMD (RMD is surfaced as income), so the
        // trad withdrawal sum is already RMD-free — no subtraction needed.
        const tradNonRMDWithdrawals = sumTraditionalWithdrawals(simYear);

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
        const nonSSOrdinaryIncomeExclRMD = Math.max(
            0,
            grossIncome - ssBenefits,
        );
        const ltcgIncome = simYear.taxDetails.longTermCapitalGains ?? 0;

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
        if (!fedParams) continue;
        const stateParams = TaxService.getTaxParameters(
            simYear.year, effTax.filingStatus, 'state', effTax.stateResidency, assumptions
        );

        // ACA cliff applies pre-65 only (Medicare eligibility starts at 65).
        let acaOptions: ACAOptions | undefined;
        if (assumptions.investments.acaAware !== false && age < 65) {
            const acaFiling: 'single' | 'married_filing_jointly' =
                effTax.filingStatus === 'Married Filing Jointly' ? 'married_filing_jointly' : 'single';
            acaOptions = {
                currentAge: age,
                acaSubsidyAware: true,
                acaCliffThreshold: getAcaCliffThreshold(acaFiling, simYear.year),
                estimatedSubsidyLoss: ACA_SUBSIDY_LOSS_DEFAULT,
            };
        }

        // Medicare IRMAA applies at 65+ (mutually exclusive with the ACA cliff above).
        // Resolve the schedule once per year and close over it: computeYearTax calls
        // this once per grid cell, all at the same (filingStatus, year, multiplier).
        const irmaaSchedule = age >= MEDICARE_ELIGIBILITY_AGE
            ? getIRMAASchedule(effTax.filingStatus, simYear.year, assumptions)
            : undefined;
        let irmaaSurchargeForMAGI: ((magi: number) => number) | undefined;
        if (irmaaSchedule) {
            // Head edge (#76): for the first IRMAA_HORIZON_EDGE_YEARS Medicare
            // years (ages 65-66), the surcharge is set by the pre-65 (year−2)
            // MAGI from the baseline, NOT this year's conversion-sensitive MAGI.
            // Pin a constant surcharge so the DP can't trip a phantom early
            // surcharge by converting at 65-66 (the engine bills those years on
            // age-63/64 MAGI, which the conversion can't retroactively raise).
            // Fall back to same-year pricing when the lookback MAGI is missing
            // (e.g. lookback year predates the baseline timeline).
            // Window = the IRMAA lookback (ages 65-66 are billed on age-63/64
            // MAGI), NOT the tail-skip width — they're equal today but mean
            // different things, so key off the lookback to stay correct if the
            // tail-skip width is ever tuned independently.
            const isMedicareHeadYear =
                age < MEDICARE_ELIGIBILITY_AGE + IRMAA_LOOKBACK_YEARS;
            const lookbackMagi = isMedicareHeadYear
                ? baselineMagiByYear.get(simYear.year - IRMAA_LOOKBACK_YEARS)
                : undefined;
            if (isMedicareHeadYear && lookbackMagi !== undefined) {
                const seededSurcharge = irmaaSchedule.annualSurcharge(lookbackMagi);
                irmaaSurchargeForMAGI = () => seededSurcharge;
            } else {
                irmaaSurchargeForMAGI = (magi: number) => irmaaSchedule.annualSurcharge(magi);
            }
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
            + (simYear.taxDetails.irmaa ?? 0);
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
            fedParams,
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
 */
function computeYearTax(
    ordinaryIncome: number,
    ctx: DPYearContext,
): number {
    const fed = TaxService.calculateTotalFederalTax(
        ordinaryIncome,
        ctx.ssBenefits,
        0,                       // STCG
        ctx.ltcgIncome,
        0,                       // preTaxDeductions (already in nonSSOrdinaryIncomeExclRMD)
        ctx.filingStatus,
        ctx.fedParams,
    ).totalTax;

    let state = 0;
    if (ctx.stateParams) {
        // Most states tax LTCG as ordinary. SS treatment mirrors the real sim's
        // calculateUnifiedStateTax (stateTax.ts): `ordinaryIncome` here already
        // EXCLUDES SS, so the state base is non-SS ordinary + LTCG, plus — only
        // for states that tax SS — the IRS-taxable portion of SS. SS-taxing
        // states (e.g. via the SS torpedo) make a conversion that raises
        // provisional income create real state tax the DP must price in.
        let stateBase = ordinaryIncome + ctx.ltcgIncome;
        if (ctx.ssBenefits > 0 && ctx.stateParams.socialSecurityTreatment === 'taxable') {
            // agiExcludingSS = non-SS ordinary + LTCG (preTaxDeductions already
            // folded into nonSSOrdinaryIncomeExclRMD upstream).
            const taxableSS = TaxService.getTaxableSocialSecurityBenefits(
                ctx.ssBenefits,
                ordinaryIncome + ctx.ltcgIncome,
                0,
                ctx.filingStatus,
            );
            stateBase += taxableSS;
        }
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

    return fed + state + acaPenalty + irmaaPenalty;
}

/**
 * Single-cell evaluation (3D-ready): given (tradBalance, rothBalance,
 * conversion, ctx), simulate the year's spending waterfall and tax in
 * one shot.
 *
 * Tax routing mirrors the real sim's WITHHOLD path: the year's gap
 * (spending need + this-year tax − cash from ordinary income) flows
 * through the withdrawal order brokerage → roth → trad. The portion that
 * ends up coming from trad (`tradSpending`) becomes ordinary income and
 * feeds back into the tax calc. yearTax and tradSpending are coupled, so
 * we resolve via a small fixed-point iteration. Most years converge in 0
 * iterations because there's enough brokerage + Roth (or enough ordinary
 * income from SS/RMD/pension) to keep tradSpending = 0 — the
 * initial-guess yearTax is already exact.
 *
 * Returns:
 * - `yearTax`: actual federal + state + ACA tax (no infeasibility penalty;
 *   the solver applies that separately via `unmetNeed`).
 * - `conversionMarginal`: yearTax − taxBaseline (diagnostic only).
 * - `tradNext`, `rothNext`: end-of-year balances after flows + growth.
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
 */
function evaluateCell(
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
    /** `tradPre` grown by the deterministic per-account rate (legacy single-rate transition). */
    tradNext: number;
    /** `rothPre` grown by the deterministic per-account rate (legacy single-rate transition). */
    rothNext: number;
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
        const newYearTax = computeYearTax(ordIncome, ctx);
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
    // by the per-account rates below; the stochastic solve (#98) instead grows
    // `tradPre`/`rothPre` by each return-quadrature node and takes the expectation.
    const tradPre = Math.max(0, tradBalance - conversion - rmd - tradSpending);
    const rothPre = Math.max(0, rothBalance + conversion - fromRoth);
    const tradNext = tradPre * (1 + ctx.growthRate);
    const rothNext = rothPre * (1 + ctx.rothGrowthRate);

    return {
        yearTax,
        conversionMarginal,
        tradPre,
        rothPre,
        tradNext,
        rothNext,
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
 * `(year, trad, roth)` state via bilinear interpolation. Returns `undefined`
 * when the year has no policy entry (e.g. pre-retirement years, or a
 * deterministic plan with no policy). The result is clamped to the gross
 * feasible range `[0, trad]` so the contract is safe for every caller (you can't
 * convert more Traditional than you have, or a negative amount); callers refine
 * with the RMD-aware ceiling. Note: interpolating the argmax conversion across
 * grid cells yields an in-between amount near bracket edges — an accepted
 * smoothing approximation (a non-conversion year stays $0 since its whole
 * neighborhood is 0).
 */
export function lookupConversionPolicy(
    policy: DPPolicy, year: number, trad: number, roth: number,
): number | undefined {
    const entry = policy.byYear.get(year);
    if (!entry) return undefined;
    const raw = interpV2D(
        entry.table, trad, roth, entry.dB, entry.dRoth, policy.tradBuckets, policy.rothBuckets,
    );
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
     * don't pass it are unchanged). NOTE: income grows with COLA but `fedParams` brackets
     * stay at the terminal year's nominal thresholds across the 45-yr drawdown, so some
     * bracket creep remains in the valuation — an improvement over frozen-nominal income,
     * still approximate (inflating the brackets too would need a year-indexed param set).
     */
    cola: number = 0,
): number {
    if (B < 1) return 0;
    if (userSituation === 'bequeath') return B * (1 - HEIR_EXIT_RATE);
    let bal = B, pv = 0, age = terminalAge, t = 0;
    let grossW = 0, totalTax = 0;
    let ss = ssBenefit, fixed = fixedIncome; // grown by COLA each year below
    while (bal > 100 && t < 45) {
        const div = Math.max(2, getDistributionPeriod(Math.min(age, 115)));
        const w = Math.min(bal, bal / div);
        // The residual withdrawal bears only the MARGINAL tax above the persisting
        // income base (so SS/fixed income aren't taxed to the residual). Recomputed per
        // year because the base grows with COLA.
        const baseTax = TaxService.calculateTotalFederalTax(fixed, ss, 0, 0, 0, filing, fedParams).totalTax;
        const taxWith = TaxService.calculateTotalFederalTax(fixed + w, ss, 0, 0, 0, filing, fedParams).totalTax;
        const tax = Math.max(0, taxWith - baseTax); // marginal tax attributable to the withdrawal
        pv += (w - tax) / Math.pow(1 + g, t);
        grossW += w; totalTax += tax;
        bal = (bal - w) * (1 + g);
        ss *= (1 + cola); fixed *= (1 + cola); // COLA growth of persisting income (#10)
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
    const tradTerminalAt = (tradBal: number): number =>
        terminalValuation === 'bracket-aware'
            ? bracketAwareTradExitValue(
                tradBal, terminalAge, lastCtx.growthRate, lastCtx.fedParams, lastCtx.filingStatus,
                userSituation, lastCtx.ssBenefits, lastCtx.nonSSOrdinaryIncomeExclRMD, terminalCola)
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
    // with extra headroom (~+2σ) so a typical year's up-shock doesn't land past the
    // next year's grid edge and get silently clamped by interpV2D. The rare
    // outermost node can still clamp — bounded, low-weight, and covering it fully
    // would wreck bulk resolution. Deterministic solve passes 0 / default → grid
    // unchanged.
    const gridDrift = stochastic ? meanShift : 0;
    const gridHeadroom = quad ? BALANCE_HEADROOM_FACTOR + 2 * quad.stdDev : BALANCE_HEADROOM_FACTOR;
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
    // evaluate the cell to get (yearTax, tradNext, rothNext, unmetNeed),
    // then look up V[t+1] at (tradNext, rothNext) via bilinear interpolation
    // in trad and roth. The minimum total-cost conversion wins. The stochastic
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
        const df = stochastic
            ? 1 / meanGrowthDenom
            : (isMaxWealth ? 1 / (1 + ctx.growthRate) : discountFactor);
        // Per-node growth factors for this year (#98), hoisted out of the cell
        // loops: a common zero-mean shock added to each account's own rate +
        // meanShift, floored at 0 (a balance can't grow negative). Divide by the
        // next year's bucket width HERE so the inner loop multiplies a precomputed
        // index factor instead of dividing per node per cell (#9 hot-path perf).
        const invDBNext = 1 / dB_next;
        const invDRothNext = 1 / dRoth_next;
        const facTradIdx = quad
            ? quad.shocks.map(s => Math.max(0, 1 + ctx.growthRate + meanShift + s) * invDBNext) : null;
        const facRothIdx = quad
            ? quad.shocks.map(s => Math.max(0, 1 + ctx.rothGrowthRate + meanShift + s) * invDRothNext) : null;

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
                    const { yearTax, tradPre, rothPre, tradNext, rothNext, unmetNeed, fromBrokerage, ordinarySurplus } =
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

    // STOCHASTIC central schedule (#98): the deterministic diagnostic-heavy
    // extract below re-does the argmax; for the policy solve we instead walk the
    // emitted policy along the mean-return trajectory, reading it through the SAME
    // lookupConversionPolicy an MC path uses — so a zero-volatility ("on-track")
    // MC path reproduces this schedule. The deterministic loop is gated off when
    // stochastic (its `for` condition short-circuits on `!stochastic`).
    if (quad && policy) {
        for (let t = 0; t < horizonYears; t++) {
            const ctx = solveContexts[t];
            const rmdAtB = ctx.rmdDivisor > 0 ? trad / ctx.rmdDivisor : 0;
            const cMaxFwd = Math.max(0, trad - rmdAtB);
            const taxBaseline = computeYearTax(ctx.nonSSOrdinaryIncomeExclRMD + rmdAtB, ctx);
            // Read through the shared lookup (already clamped to [0, trad]), then
            // refine with the RMD-aware ceiling.
            const cRaw = lookupConversionPolicy(policy, ctx.year, trad, roth) ?? 0;
            const c = Math.min(cRaw, cMaxFwd);
            const { tradPre, rothPre } = evaluateCell(trad, roth, c, ctx, taxBaseline);
            conversionsByYear.set(ctx.year, c);
            perYearAmounts.push({ year: ctx.year, age: ctx.age, amount: c, estimatedTradBalance: trad });
            // Lightweight per-year debug for the stochastic mean path (#98): the
            // deterministic loop's full cost-curve/waterfall traces aren't built
            // here, but emit the entering-state + chosen-conversion line so the
            // year inspector isn't blank for a policy solve.
            const debugLines: string[] = [];
            if (t === 0) debugLines.push(startingDebug);
            debugLines.push(
                `[DEBUG DP policy] year=${ctx.year} age=${ctx.age}: ` +
                `tradEntering=${fmt$(trad)}, rothEntering=${fmt$(roth)}, rmd=${fmt$(rmdAtB)}, ` +
                `chose c=${fmt$(c)} (policy lookup along mean path, meanShift=${(meanShift * 100).toFixed(2)}%)`,
            );
            perYearDebug.set(ctx.year, debugLines);
            // Step the central trajectory at each account's mean rate (shock = 0),
            // floored (#5) so a pathological meanShift can't drive balances negative.
            trad = tradPre * Math.max(0, 1 + ctx.growthRate + meanShift);
            roth = rothPre * Math.max(0, 1 + ctx.rothGrowthRate + meanShift);
        }
    }

    for (let t = 0; !stochastic && t < horizonYears; t++) {
        // Price against the tail-IRMAA-skipped context so the forward extract
        // matches the backward sweep's V-table (see solveContexts).
        const ctx = solveContexts[t];
        const Vnext = V[t + 1];
        const dB_next = dBByYear[t + 1];
        const dRoth_next = dRothByYear[t + 1];
        // CHANGE 4 mirror — same per-year discount as the backward sweep, so the
        // extracted policy is scored on the identical objective the V-table was
        // built with (any mismatch would make forward extract disagree with V).
        const df = isMaxWealth ? 1 / (1 + ctx.growthRate) : discountFactor;

        const rmdAtB = ctx.rmdDivisor > 0 ? trad / ctx.rmdDivisor : 0;
        const cMax = Math.max(0, trad - rmdAtB);
        const taxBaseline = computeYearTax(ctx.nonSSOrdinaryIncomeExclRMD + rmdAtB, ctx);

        let bestC = 0;
        // CHANGE 3 mirror — sentinel flips for max-wealth.
        let bestCost = isMaxWealth ? -Infinity : Infinity;
        let bestTradNext = trad;
        let bestRothNext = roth;
        let bestYearTax = 0;
        let bestMarginal = 0;
        let bestTradSpending = 0;
        let bestFromRoth = 0;
        let bestFromBrokerage = 0;
        let bestUnmetNeed = 0;
        // For the diagnostic table: cost @ c=0 vs cost @ a non-zero candidate.
        let costAtZero = isMaxWealth ? -Infinity : Infinity;
        let yearTaxAtZero = 0;
        let futureAtZero = 0;
        let bestFuture = 0;

        for (let ci = 0; ci <= CONVERSION_BUCKETS; ci++) {
            const c = Math.min(ci * dCByYear[t], cMax);
            const { yearTax, conversionMarginal, tradNext, rothNext, tradSpending, fromRoth, fromBrokerage, unmetNeed, ordinarySurplus } =
                evaluateCell(trad, roth, c, ctx, taxBaseline);

            const futureCost = interpV2D(
                Vnext, tradNext, rothNext,
                dB_next, dRoth_next, TRAD_BUCKETS, ROTH_BUCKETS,
            );
            // CHANGE 2 mirror — accumuland matches the backward sweep (shared helper, #12).
            const yearCost = yearAccumuland({ yearTax, fromBrokerage, ordinarySurplus, unmetNeed });
            const totalCost = yearCost + df * futureCost;

            if (ci === 0) {
                costAtZero = totalCost;
                yearTaxAtZero = yearTax;
                futureAtZero = futureCost;
            }

            // CHANGE 3 mirror — argmax for max-wealth, argmin for min-tax.
            const improves = isMaxWealth ? totalCost > bestCost : totalCost < bestCost;
            if (improves) {
                bestCost = totalCost;
                bestC = c;
                bestTradNext = tradNext;
                bestRothNext = rothNext;
                bestYearTax = yearTax;
                bestMarginal = conversionMarginal;
                bestFuture = futureCost;
                bestTradSpending = tradSpending;
                bestFromRoth = fromRoth;
                bestFromBrokerage = fromBrokerage;
                bestUnmetNeed = unmetNeed;
            }

            if (c >= cMax) break;
        }

        conversionsByYear.set(ctx.year, bestC);
        perYearAmounts.push({
            year: ctx.year,
            age: ctx.age,
            amount: bestC,
            estimatedTradBalance: trad,
        });

        // Per-year debug emitted to the year inspector via planConversionDP.
        const debugLines: string[] = [];
        if (t === 0) {
            // Surface the setup info on the first conversion year so the user
            // can spot starting-balance issues right in the inspector.
            debugLines.push(startingDebug);
        }
        debugLines.push(
            `[DEBUG DP solver] year=${ctx.year} age=${ctx.age}: ` +
            `tradEntering=${fmt$(trad)}, rmdAtB=${fmt$(rmdAtB)}, cMax=${fmt$(cMax)}, ` +
            `taxBaseline=${fmt$(taxBaseline)}`,
        );
        debugLines.push(
            `[DEBUG DP solver] year=${ctx.year}: chose c=${fmt$(bestC)} ` +
            `(yearTax=${fmt$(bestYearTax)}, marginal=${fmt$(bestMarginal)}, ` +
            `discountedFuture=${fmt$(df * bestFuture)}, totalCost=${fmt$(bestCost)}, ` +
            `tradNext=${fmt$(bestTradNext)}, rothNext=${fmt$(bestRothNext)})`,
        );
        debugLines.push(
            `[DEBUG DP solver] year=${ctx.year}: c=0 totalCost=${fmt$(costAtZero)} ` +
            `(yearTax=${fmt$(yearTaxAtZero)}, discountedFuture=${fmt$(df * futureAtZero)})`,
        );
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
            bestC,
            cMax,
        ]
            .filter(c => c >= 0 && c <= cMax)
            .sort((a, b) => a - b)
            .filter((c, i, arr) => i === 0 || Math.abs(c - arr[i - 1]) > 0.5);
        const curveParts: string[] = [];
        const costCurve: DPYearTrace['costCurve'] = [];
        for (const sampleC of sampleCs) {
            const r = evaluateCell(trad, roth, sampleC, ctx, taxBaseline);
            const fc = interpV2D(
                Vnext, r.tradNext, r.rothNext,
                dB_next, dRoth_next, TRAD_BUCKETS, ROTH_BUCKETS,
            );
            const yc = yearAccumuland(r); // shared accumuland (#12)
            const dFut = df * fc;
            const total = yc + dFut;
            curveParts.push(
                `c=${fmt$(sampleC)}→total=${fmt$(total)}` +
                ` (yearTax=${fmt$(r.yearTax)}, dFut=${fmt$(dFut)}, ` +
                `tradNext=${fmt$(r.tradNext)}, rothNext=${fmt$(r.rothNext)})`,
            );
            costCurve.push({
                c: sampleC,
                yearTax: r.yearTax,
                discountedFuture: dFut,
                totalCost: total,
                tradNext: r.tradNext,
                rothNext: r.rothNext,
            });
        }
        debugLines.push(
            `[DEBUG DP curve] year=${ctx.year}: ${curveParts.join(' | ')}`,
        );
        // Waterfall breakdown for the chosen conversion. The 3D solver
        // tracks the running roth balance forward, so `cap` reflects what
        // DP's own plan has left in Roth this year — not a baseline proxy.
        // gap = max(0, spendingNeed + yearTax − cashFromOrdinary); sourced
        // brokerage → roth → trad in the real-sim withdrawal order.
        const cashFromOrd =
            ctx.nonSSOrdinaryIncomeExclRMD + ctx.ssBenefits + rmdAtB;
        const gap = Math.max(0, ctx.spendingNeed + bestYearTax - cashFromOrd);
        debugLines.push(
            `[DEBUG DP waterfall] year=${ctx.year}: ` +
            `spendingNeed=${fmt$(ctx.spendingNeed)} + yearTax=${fmt$(bestYearTax)} − ` +
            `cashFromOrdinary=${fmt$(cashFromOrd)} = gap=${fmt$(gap)} → ` +
            `fromBrokerage=${fmt$(bestFromBrokerage)} (cap=${fmt$(ctx.baselineBrokerageAvailable)}), ` +
            `fromRoth=${fmt$(bestFromRoth)} (cap=${fmt$(roth)}), ` +
            `tradSpending=${fmt$(bestTradSpending)}, unmetNeed=${fmt$(bestUnmetNeed)}`,
        );
        // Forward-sweep decomposition: shows exactly how DP is propagating
        // trad and roth jointly under the chosen plan.
        // tradAfterFlows = tradEntering − conversion − rmd − tradSpending
        // tradNext = tradAfterFlows × (1 + growthRate)
        // rothAfterFlows = rothEntering + conversion − fromRoth
        // rothNext = max(0, rothAfterFlows) × (1 + rothGrowthRate)
        const tradAfterFlows = trad - bestC - rmdAtB - bestTradSpending;
        const rothAfterFlows = roth + bestC - bestFromRoth;
        debugLines.push(
            `[DEBUG DP forward] year=${ctx.year}: ` +
            `tradEntering=${fmt$(trad)} − c=${fmt$(bestC)} − rmd=${fmt$(rmdAtB)} − ` +
            `tradSpending=${fmt$(bestTradSpending)} ` +
            `= ${fmt$(tradAfterFlows)} × (1 + ${(ctx.growthRate * 100).toFixed(2)}%) = tradNext=${fmt$(bestTradNext)}`,
        );
        debugLines.push(
            `[DEBUG DP forward roth] year=${ctx.year}: ` +
            `rothEntering=${fmt$(roth)} + c=${fmt$(bestC)} − fromRoth=${fmt$(bestFromRoth)} ` +
            `= ${fmt$(rothAfterFlows)} × (1 + ${(ctx.rothGrowthRate * 100).toFixed(2)}%) = rothNext=${fmt$(bestRothNext)}`,
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

        // Structured trace for the Roth debug screen.
        const trace: DPYearTrace = {
            year: ctx.year,
            age: ctx.age,
            chosenC: bestC,
            yearTax: bestYearTax,
            conversionMarginal: bestMarginal,
            discountedFuture: df * bestFuture,
            totalCost: bestCost,
            tradEntering: trad,
            rothEntering: roth,
            rmdAtEntering: rmdAtB,
            cMax,
            taxBaselineNoConv: taxBaseline,
            tradNext: bestTradNext,
            rothNext: bestRothNext,
            spendingNeed: ctx.spendingNeed,
            cashFromOrdinary: cashFromOrd,
            gap,
            fromBrokerage: bestFromBrokerage,
            fromRoth: bestFromRoth,
            tradSpending: bestTradSpending,
            unmetNeed: bestUnmetNeed,
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

        trad = bestTradNext;
        roth = bestRothNext;
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
