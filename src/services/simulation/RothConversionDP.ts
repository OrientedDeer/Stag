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
 * - Monte-Carlo path divergence: handled at the call site by re-running
 *   the DP per path.
 */

import { TaxParameters, FilingStatus } from "../../data/TaxData";
import { TaxState } from "../../components/Objects/Taxes/TaxContext";
import { AssumptionsState, getBirthYear } from "../../components/Objects/Assumptions/AssumptionsContext";
import { SimulationYear, DPYearTrace } from "./types";
import * as TaxService from "../../components/Objects/Taxes/TaxService";
import { ACAOptions } from "./helpers";
import { getDistributionPeriod, getRMDStartAge } from "../../data/RMDData";
import { getAcaCliffThreshold } from "./TaxOptimizedWithdrawal";
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
 * plans strictly dominated. Tunable: $10/$1 unmet is heavy enough that the
 * solver will choose any feasible alternative.
 */
const INFEASIBILITY_PENALTY_PER_DOLLAR = 10;

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

export interface DPPlan {
    conversionsByYear: Map<number, number>;
    diagnostics: DPDiagnostics;
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

        const fedParams = TaxService.getTaxParameters(
            simYear.year, taxState.filingStatus, 'federal', undefined, assumptions
        );
        if (!fedParams) continue;
        const stateParams = TaxService.getTaxParameters(
            simYear.year, taxState.filingStatus, 'state', taxState.stateResidency, assumptions
        );

        // ACA cliff applies pre-65 only (Medicare eligibility starts at 65).
        let acaOptions: ACAOptions | undefined;
        if (assumptions.investments.acaAware !== false && age < 65) {
            const acaFiling: 'single' | 'married_filing_jointly' =
                taxState.filingStatus === 'Married Filing Jointly' ? 'married_filing_jointly' : 'single';
            acaOptions = {
                currentAge: age,
                acaSubsidyAware: true,
                acaCliffThreshold: getAcaCliffThreshold(acaFiling, simYear.year),
                estimatedSubsidyLoss: ACA_SUBSIDY_LOSS_DEFAULT,
            };
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
            + (simYear.taxDetails.fica ?? 0);
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
            filingStatus: taxState.filingStatus,
            fedParams,
            stateParams: stateParams ?? null,
            acaOptions,
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

    return fed + state + acaPenalty;
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
    tradNext: number;
    rothNext: number;
    tradSpending: number;
    fromRoth: number;
    fromBrokerage: number;
    unmetNeed: number;
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

    const conversionMarginal = Math.max(0, yearTax - taxBaseline);
    const tradNext = Math.max(0, tradBalance - conversion - rmd - tradSpending) * (1 + ctx.growthRate);
    const rothNext = Math.max(0, rothBalance + conversion - fromRoth) * (1 + ctx.rothGrowthRate);

    return {
        yearTax,
        conversionMarginal,
        tradNext,
        rothNext,
        tradSpending,
        fromRoth,
        fromBrokerage,
        unmetNeed,
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
    const trad = tradBalance < 0 ? 0 : tradBalance;
    const roth = rothBalance < 0 ? 0 : rothBalance;

    let tIdx = trad / dB;
    let rIdx = roth / dRoth;
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
): { dBByYear: number[]; dRothByYear: number[]; dCByYear: number[] } {
    const horizonYears = contexts.length;
    const tradMaxByYear: number[] = new Array(horizonYears + 1);
    const rothMaxByYear: number[] = new Array(horizonYears + 1);
    tradMaxByYear[0] = currentTradBalance;
    rothMaxByYear[0] = currentRothBalance;

    // Trad-max trajectory: no conversions, no spending.
    {
        let trad = currentTradBalance;
        for (let t = 0; t < horizonYears; t++) {
            const ctx = contexts[t];
            const rmd = ctx.rmdDivisor > 0 ? trad / ctx.rmdDivisor : 0;
            trad = Math.max(0, trad - rmd) * (1 + ctx.growthRate);
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
            trad = Math.max(0, trad - conv - rmd) * (1 + ctx.growthRate);
            roth = (roth + conv) * (1 + ctx.rothGrowthRate);
            rothMaxByYear[t + 1] = roth;
        }
    }

    const dBByYear = tradMaxByYear.map(v =>
        Math.max(MIN_BALANCE_RANGE, v * BALANCE_HEADROOM_FACTOR) / TRAD_BUCKETS
    );
    const dRothByYear = rothMaxByYear.map(v =>
        Math.max(MIN_BALANCE_RANGE, v * BALANCE_HEADROOM_FACTOR) / ROTH_BUCKETS
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
 * Run the DP backward sweep + forward extract, producing a per-year plan.
 */
export function planConversionsViaDP(inputs: DPInputs): DPPlan {
    const startedAt = performance.now();
    const { contexts, currentTradBalance, currentRothBalance } = inputs;
    const delta = inputs.backloadDelta ?? DP_BACKLOAD_DELTA;
    const discountFactor = 1 / (1 + delta);

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

    const { dBByYear, dRothByYear, dCByYear } = determineGridScales(
        contexts, currentTradBalance, currentRothBalance,
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
    summaryLogs.push(
        `[DEBUG DP] solver: δ=${(delta * 100).toFixed(2)}%, df=${discountFactor.toFixed(4)}, ` +
        `tradBuckets=${TRAD_BUCKETS}, rothBuckets=${ROTH_BUCKETS}, convBuckets=${CONVERSION_BUCKETS}, ` +
        `maxConversion=${fmt$(maxConversion)} (dC=${fmt$(dC)}), horizon=${horizonYears} years, ` +
        `V-table 2D ≈ ${vTableMB.toFixed(2)} MB`,
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

    // -----------------------------------------------------------------
    // Backward sweep — 3D state (year, tradIdx, rothIdx).
    //
    // For each (t, tradIdx, rothIdx) cell, iterate over conversion buckets,
    // evaluate the cell to get (yearTax, tradNext, rothNext, unmetNeed),
    // then look up V[t+1] at (tradNext, rothNext) via bilinear interpolation
    // in trad and roth. The minimum total-cost conversion wins.
    //
    // Phase 4 caveat: the inner conversion loop and `taxBaseline` only
    // depend on (t, tradIdx) — recomputing them per rothIdx wastes work.
    // We hoist them outside the rothIdx loop.
    // -----------------------------------------------------------------
    for (let t = horizonYears - 1; t >= 0; t--) {
        const ctx = contexts[t];
        const Vnext = V[t + 1];
        const Vt = V[t];
        const dB_t = dBByYear[t];
        const dRoth_t = dRothByYear[t];
        const dB_next = dBByYear[t + 1];
        const dRoth_next = dRothByYear[t + 1];

        for (let bi = 0; bi <= TRAD_BUCKETS; bi++) {
            const b = bi * dB_t;

            const rmdAtB = ctx.rmdDivisor > 0 ? b / ctx.rmdDivisor : 0;
            const cMax = Math.max(0, b - rmdAtB);
            // Baseline (no-conversion, no-trad-spending) tax — only used for
            // the marginal diagnostic. Doesn't depend on rothIdx.
            const taxBaseline = computeYearTax(ctx.nonSSOrdinaryIncomeExclRMD + rmdAtB, ctx);

            // Hoist the roth-INDEPENDENT initial-guess tax out of the rothIdx
            // loop. For a fixed (bi, ci), the conversion `c` and RMD are fixed
            // (cMax depends only on b), so `ordIncomeExclTradSpend =
            // nonSSOrdinaryIncomeExclRMD + rmdAtB + c` — and thus its full
            // fed+state+SS tax — is identical across all rothIdx values. We
            // compute it once per (bi, ci) here and reuse it for every ri.
            // The fixed-point inside evaluateCell still recomputes tax when
            // trad-spending > 0 (the genuinely roth-dependent path), so
            // results are numerically identical.
            const initialTaxByCi: number[] = new Array(CONVERSION_BUCKETS + 1);
            {
                let ci = 0;
                for (; ci <= CONVERSION_BUCKETS; ci++) {
                    const c = Math.min(ci * dCByYear[t], cMax);
                    initialTaxByCi[ci] =
                        computeYearTax(ctx.nonSSOrdinaryIncomeExclRMD + rmdAtB + c, ctx);
                    if (c >= cMax) break;
                }
            }

            for (let ri = 0; ri <= ROTH_BUCKETS; ri++) {
                const r = ri * dRoth_t;

                let bestCost = Infinity;

                for (let ci = 0; ci <= CONVERSION_BUCKETS; ci++) {
                    const c = Math.min(ci * dCByYear[t], cMax);
                    const { yearTax, tradNext, rothNext, unmetNeed } =
                        evaluateCell(b, r, c, ctx, taxBaseline, initialTaxByCi[ci]);

                    const futureCost = interpV2D(
                        Vnext, tradNext, rothNext,
                        dB_next, dRoth_next, TRAD_BUCKETS, ROTH_BUCKETS,
                    );
                    const yearCost = yearTax + unmetNeed * INFEASIBILITY_PENALTY_PER_DOLLAR;
                    const totalCost = yearCost + discountFactor * futureCost;

                    if (totalCost < bestCost) bestCost = totalCost;

                    if (c >= cMax) break;
                }

                Vt[bi * V_STRIDE + ri] = bestCost === Infinity ? taxBaseline : bestCost;
            }
        }
    }

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

    for (let t = 0; t < horizonYears; t++) {
        const ctx = contexts[t];
        const Vnext = V[t + 1];
        const dB_next = dBByYear[t + 1];
        const dRoth_next = dRothByYear[t + 1];

        const rmdAtB = ctx.rmdDivisor > 0 ? trad / ctx.rmdDivisor : 0;
        const cMax = Math.max(0, trad - rmdAtB);
        const taxBaseline = computeYearTax(ctx.nonSSOrdinaryIncomeExclRMD + rmdAtB, ctx);

        let bestC = 0;
        let bestCost = Infinity;
        let bestTradNext = trad;
        let bestRothNext = roth;
        let bestYearTax = 0;
        let bestMarginal = 0;
        let bestTradSpending = 0;
        let bestFromRoth = 0;
        let bestFromBrokerage = 0;
        let bestUnmetNeed = 0;
        // For the diagnostic table: cost @ c=0 vs cost @ a non-zero candidate.
        let costAtZero = Infinity;
        let yearTaxAtZero = 0;
        let futureAtZero = 0;
        let bestFuture = 0;

        for (let ci = 0; ci <= CONVERSION_BUCKETS; ci++) {
            const c = Math.min(ci * dCByYear[t], cMax);
            const { yearTax, conversionMarginal, tradNext, rothNext, tradSpending, fromRoth, fromBrokerage, unmetNeed } =
                evaluateCell(trad, roth, c, ctx, taxBaseline);

            const futureCost = interpV2D(
                Vnext, tradNext, rothNext,
                dB_next, dRoth_next, TRAD_BUCKETS, ROTH_BUCKETS,
            );
            const yearCost = yearTax + unmetNeed * INFEASIBILITY_PENALTY_PER_DOLLAR;
            const totalCost = yearCost + discountFactor * futureCost;

            if (ci === 0) {
                costAtZero = totalCost;
                yearTaxAtZero = yearTax;
                futureAtZero = futureCost;
            }

            if (totalCost < bestCost) {
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
            `discountedFuture=${fmt$(discountFactor * bestFuture)}, totalCost=${fmt$(bestCost)}, ` +
            `tradNext=${fmt$(bestTradNext)}, rothNext=${fmt$(bestRothNext)})`,
        );
        debugLines.push(
            `[DEBUG DP solver] year=${ctx.year}: c=0 totalCost=${fmt$(costAtZero)} ` +
            `(yearTax=${fmt$(yearTaxAtZero)}, discountedFuture=${fmt$(discountFactor * futureAtZero)})`,
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
            const yc = r.yearTax + r.unmetNeed * INFEASIBILITY_PENALTY_PER_DOLLAR;
            const dFut = discountFactor * fc;
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
            discountedFuture: discountFactor * bestFuture,
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
        `elapsed=${elapsedMs.toFixed(1)}ms`,
    );

    return {
        conversionsByYear,
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
