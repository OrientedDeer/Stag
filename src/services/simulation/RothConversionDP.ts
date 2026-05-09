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
 * State: `(year, traditional_balance)`. Decision: this year's total
 * Traditional → Roth conversion amount (including any std-ded-headroom
 * portion that the baseline would do for free; the DP picks total).
 *
 * Approximations (Option C):
 * - The baseline trajectory (from a std-ded-only sub-sim) supplies per-year
 *   exogenous context (SS, pension, LTCG, baseline trad-withdrawal-for-
 *   spending, brokerage_slack). DP varies trad balance only.
 * - When DP's conversion tax exceeds baseline brokerage slack, the
 *   overflow is charged to traditional (the "tax leak"). First-order
 *   correction for "convert aggressively → blow through brokerage → trad
 *   gets drained for spending" coupling without 3D state.
 * - Hard cap: never propose a conversion whose tax exceeds available
 *   brokerage × HARD_CAP factor (prevents pathological overspending).
 *
 * Not yet modeled (intentional): real-sim withdrawal logic re-ordering
 * across plans, IRMAA (Medicare premium surcharges, not yet in codebase),
 * Monte-Carlo path divergence (handled at the call site by re-running
 * the DP per path).
 */

import { TaxParameters, FilingStatus } from "../../data/TaxData";
import { TaxState } from "../../components/Objects/Taxes/TaxContext";
import { AssumptionsState, getBirthYear } from "../../components/Objects/Assumptions/AssumptionsContext";
import { SimulationYear } from "./types";
import * as TaxService from "../../components/Objects/Taxes/TaxService";
import { ACAOptions } from "./helpers";
import { getDistributionPeriod, getRMDStartAge } from "../../data/RMDData";
import { getAcaCliffThreshold } from "./TaxOptimizedWithdrawal";
import { InvestedAccount } from "../../components/Objects/Accounts/models";
import { WorkIncome } from "../../components/Objects/Income/models";

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
const CONVERSION_BUCKETS = 50;
const BALANCE_HEADROOM_FACTOR = 1.3;
const MIN_BALANCE_RANGE = 100_000;
const MIN_CONVERSION_RANGE = 10_000;
const ACA_SUBSIDY_LOSS_DEFAULT = 12_000;
const TAX_HARD_CAP_BROKERAGE_MULTIPLIER = 1.2;

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
     * Ordinary income on this year's tax return EXCLUDING SS and EXCLUDING the
     * RMD (which the DP re-derives from its own trad-balance state). Includes
     * baseline std-ded conversion since that's a sunk cost in baseline.
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

    /** Brokerage balance available to absorb additional tax beyond baseline. */
    brokerageSlack: number;
    /** Trad withdrawal for spending in baseline (excludes RMD; approximated as constant across DP plans). */
    baselineTradWithdrawal: number;

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
     * Per-year back-load preference. Defaults to DP_BACKLOAD_DELTA.
     * Exposed as a parameter so tests can pin δ = 0 for deterministic checks.
     */
    backloadDelta?: number;
}

/** Diagnostic info surfaced to the debug page. */
export interface DPDiagnostics {
    backloadDelta: number;
    tradBuckets: number;
    conversionBuckets: number;
    maxBalance: number;
    horizonYears: number;
    elapsedMs: number;
    /** Per-year (year → recommended conversion amount). Same data as conversionsByYear, kept for chart rendering. */
    perYearAmounts: Array<{ year: number; age: number; amount: number; estimatedTradBalance: number }>;
}

export interface DPPlan {
    conversionsByYear: Map<number, number>;
    diagnostics: DPDiagnostics;
}

// =============================================================================
// CONTEXT EXTRACTION
// =============================================================================

/**
 * Sum brokerage balances for a SimulationYear.
 */
function sumBrokerageBalance(simYear: SimulationYear): number {
    return simYear.accounts
        .filter((acc): acc is InvestedAccount =>
            acc instanceof InvestedAccount && acc.taxType === 'Brokerage'
        )
        .reduce((sum, acc) => sum + acc.vestedAmount, 0);
}

/**
 * Sum trad withdrawals from this year's withdrawalDetail (excludes RMD via subtraction).
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
 * Pull the average net growth rate (RoR − ER) from the baseline accounts.
 * Used for the DP's trad-balance forward propagation.
 */
function getNetGrowthRate(simYear: SimulationYear, assumptions: AssumptionsState): number {
    const tradAccounts = simYear.accounts.filter((acc): acc is InvestedAccount =>
        acc instanceof InvestedAccount &&
        (acc.taxType === 'Traditional 401k' || acc.taxType === 'Traditional IRA')
    );
    const totalBalance = tradAccounts.reduce((s, a) => s + a.vestedAmount, 0);
    const grossRoR = (assumptions.investments.returnRates.ror ?? 7) / 100;
    if (totalBalance <= 0) return grossRoR;
    const weightedER =
        tradAccounts.reduce((s, a) => s + a.expenseRatio * a.vestedAmount, 0) / totalBalance;
    return grossRoR - weightedER / 100;
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
): DPYearContext[] {
    const contexts: DPYearContext[] = [];
    const birthYear = getBirthYear(assumptions.milestones);
    const rmdStartAge = getRMDStartAge(birthYear);

    for (const simYear of baseline) {
        if (simYear.year < retirementYear) continue;
        const age = simYear.year - birthYear;

        const ssBenefits = TaxService.getSocialSecurityBenefits(simYear.incomes, simYear.year);
        const grossIncome = TaxService.getGrossIncome(simYear.incomes, simYear.year);

        // Traditional non-RMD withdrawals are taxed as ordinary income but aren't
        // tracked as Income objects, so they're missing from getGrossIncome.
        const totalTradWithdrawals = sumTraditionalWithdrawals(simYear);
        const baselineRMDAmount = simYear.rmdDetails?.totalRMD ?? 0;
        const tradNonRMDWithdrawals = Math.max(0, totalTradWithdrawals - baselineRMDAmount);

        // getGrossIncome includes RMD (it's a PassiveIncome) but excludes
        // conversions and non-RMD trad withdrawals. We want ordinary-on-return
        // EXCLUDING RMD (DP re-derives RMD from its own balance state) and
        // EXCLUDING SS (calculateTotalFederalTax handles SS taxability).
        const baselineConversionAmount = simYear.rothConversion?.amount ?? 0;
        const nonSSOrdinaryIncomeExclRMD = Math.max(
            0,
            grossIncome - ssBenefits - baselineRMDAmount + tradNonRMDWithdrawals + baselineConversionAmount,
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

        const brokerageSlack = sumBrokerageBalance(simYear);
        const growthRate = getNetGrowthRate(simYear, assumptions);
        const rmdDivisor = age >= rmdStartAge ? getDistributionPeriod(age) : 0;

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
            brokerageSlack,
            baselineTradWithdrawal: tradNonRMDWithdrawals,
            growthRate,
            rmdDivisor,
        });
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
        // Most states tax LTCG as ordinary; SS treatment is handled by stateParams.
        state = TaxService.calculateTax(ordinaryIncome + ctx.ltcgIncome, 0, ctx.stateParams);
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
 * Single-cell evaluation: given (trad balance, conversion amount, year context),
 * return this year's absolute total tax (federal + state + ACA penalty), the
 * conversion's marginal tax cost (for hard-cap and leak correction), and the
 * resulting next-year trad balance after conversion / RMD / baseline withdrawal
 * / brokerage→trad tax leak.
 *
 * `taxBaseline` is `computeYearTax(ordinaryIncomeBase, ctx)` — i.e. tax with
 * conversion = 0. Pass it in so the inner conversion-loop doesn't recompute
 * it 50× per (year, balance).
 */
function evaluateCell(
    tradBalance: number,
    conversion: number,
    ctx: DPYearContext,
    taxBaseline: number,
): { yearTax: number; conversionMarginal: number; tradNext: number } {
    const rmd = ctx.rmdDivisor > 0 ? tradBalance / ctx.rmdDivisor : 0;
    const ordIncomeBase = ctx.nonSSOrdinaryIncomeExclRMD + rmd;
    const ordIncomeWithConversion = ordIncomeBase + conversion;

    const yearTax = computeYearTax(ordIncomeWithConversion, ctx);
    const conversionMarginal = Math.max(0, yearTax - taxBaseline);

    // Tax-leak correction: anything above brokerage slack drains trad.
    const leak = Math.max(0, conversionMarginal - ctx.brokerageSlack);

    const tradAfterFlows = tradBalance - conversion - rmd - ctx.baselineTradWithdrawal - leak;
    const tradNext = Math.max(0, tradAfterFlows) * (1 + ctx.growthRate);

    return { yearTax, conversionMarginal, tradNext };
}

/**
 * Linear interpolation lookup into a value-function row at a non-bucket-aligned
 * balance. Edges clamp to the table's boundary values.
 */
function interpV(
    Vrow: Float64Array,
    balance: number,
    dB: number,
    buckets: number,
): number {
    if (balance <= 0) return Vrow[0];
    const idx = balance / dB;
    if (idx >= buckets) return Vrow[buckets];
    const lo = idx | 0;
    const frac = idx - lo;
    return Vrow[lo] * (1 - frac) + Vrow[lo + 1] * frac;
}

// =============================================================================
// SOLVER
// =============================================================================

/**
 * Pick the maximum trad balance the DP grid needs to span. We start from the
 * largest balance the baseline trajectory hits, then add headroom because
 * lower-conversion plans grow trad faster than baseline.
 */
function determineMaxBalance(
    contexts: DPYearContext[],
    currentTradBalance: number,
): number {
    let maxBaseline = currentTradBalance;
    let trad = currentTradBalance;
    for (const ctx of contexts) {
        const rmd = ctx.rmdDivisor > 0 ? trad / ctx.rmdDivisor : 0;
        // No-conversion forward: just rmd + baseline withdrawal + growth
        trad = Math.max(0, trad - rmd - ctx.baselineTradWithdrawal) * (1 + ctx.growthRate);
        if (trad > maxBaseline) maxBaseline = trad;
    }
    return Math.max(MIN_BALANCE_RANGE, maxBaseline * BALANCE_HEADROOM_FACTOR);
}

/**
 * Pick the maximum per-year conversion considered. Cap at the trad balance at
 * the start (you can't convert more than you have) plus headroom for tax-free
 * growth before RMDs hit. Floor for grid resolution.
 */
function determineMaxConversion(currentTradBalance: number): number {
    return Math.max(MIN_CONVERSION_RANGE, currentTradBalance);
}

/**
 * Hard-cap conversion choices whose tax exceeds available brokerage × multiplier.
 * Prevents the DP from proposing conversions the real sim physically cannot
 * fund (which would otherwise show up as huge tax-leaks in pathological years).
 */
function isWithinHardCap(conversionMarginalTax: number, brokerageSlack: number): boolean {
    return conversionMarginalTax <= brokerageSlack * TAX_HARD_CAP_BROKERAGE_MULTIPLIER;
}

/**
 * Run the DP backward sweep + forward extract, producing a per-year plan.
 */
export function planConversionsViaDP(inputs: DPInputs): DPPlan {
    const startedAt = performance.now();
    const { contexts, currentTradBalance } = inputs;
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
                conversionBuckets: CONVERSION_BUCKETS,
                maxBalance: 0,
                horizonYears: 0,
                elapsedMs: 0,
                perYearAmounts: [],
            },
        };
    }

    const maxBalance = determineMaxBalance(contexts, currentTradBalance);
    const dB = maxBalance / TRAD_BUCKETS;
    const maxConversion = determineMaxConversion(currentTradBalance);
    const dC = maxConversion / CONVERSION_BUCKETS;

    // V[t] is a Float64Array of size TRAD_BUCKETS+1.
    // V[horizonYears] is the terminal value (all zeros — no future tax).
    const V: Float64Array[] = new Array(horizonYears + 1);
    for (let t = 0; t <= horizonYears; t++) {
        V[t] = new Float64Array(TRAD_BUCKETS + 1);
    }

    // -----------------------------------------------------------------
    // Backward sweep
    // -----------------------------------------------------------------
    for (let t = horizonYears - 1; t >= 0; t--) {
        const ctx = contexts[t];
        const Vnext = V[t + 1];
        const Vt = V[t];

        for (let bi = 0; bi <= TRAD_BUCKETS; bi++) {
            const b = bi * dB;

            const rmdAtB = ctx.rmdDivisor > 0 ? b / ctx.rmdDivisor : 0;
            const cMax = Math.max(0, b - rmdAtB);
            // Compute baseline (no-conversion) tax once per (year, balance).
            const taxBaseline = computeYearTax(ctx.nonSSOrdinaryIncomeExclRMD + rmdAtB, ctx);

            let bestCost = Infinity;

            for (let ci = 0; ci <= CONVERSION_BUCKETS; ci++) {
                const c = Math.min(ci * dC, cMax);
                const { yearTax, conversionMarginal, tradNext } =
                    evaluateCell(b, c, ctx, taxBaseline);

                if (!isWithinHardCap(conversionMarginal, ctx.brokerageSlack)) continue;

                const futureCost = interpV(Vnext, tradNext, dB, TRAD_BUCKETS);
                const totalCost = yearTax + discountFactor * futureCost;

                if (totalCost < bestCost) bestCost = totalCost;

                if (c >= cMax) break;
            }

            Vt[bi] = bestCost === Infinity ? taxBaseline : bestCost;
        }
    }

    // -----------------------------------------------------------------
    // Forward extract: walk the policy from current state.
    // -----------------------------------------------------------------
    const conversionsByYear = new Map<number, number>();
    const perYearAmounts: DPDiagnostics['perYearAmounts'] = [];

    let trad = currentTradBalance;
    for (let t = 0; t < horizonYears; t++) {
        const ctx = contexts[t];
        const Vnext = V[t + 1];

        const rmdAtB = ctx.rmdDivisor > 0 ? trad / ctx.rmdDivisor : 0;
        const cMax = Math.max(0, trad - rmdAtB);
        const taxBaseline = computeYearTax(ctx.nonSSOrdinaryIncomeExclRMD + rmdAtB, ctx);

        let bestC = 0;
        let bestCost = Infinity;
        let bestNext = trad;

        for (let ci = 0; ci <= CONVERSION_BUCKETS; ci++) {
            const c = Math.min(ci * dC, cMax);
            const { yearTax, conversionMarginal, tradNext } =
                evaluateCell(trad, c, ctx, taxBaseline);

            if (!isWithinHardCap(conversionMarginal, ctx.brokerageSlack)) continue;

            const futureCost = interpV(Vnext, tradNext, dB, TRAD_BUCKETS);
            const totalCost = yearTax + discountFactor * futureCost;

            if (totalCost < bestCost) {
                bestCost = totalCost;
                bestC = c;
                bestNext = tradNext;
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

        trad = bestNext;
    }

    const elapsedMs = performance.now() - startedAt;

    return {
        conversionsByYear,
        diagnostics: {
            backloadDelta: delta,
            tradBuckets: TRAD_BUCKETS,
            conversionBuckets: CONVERSION_BUCKETS,
            maxBalance,
            horizonYears,
            elapsedMs,
            perYearAmounts,
        },
    };
}

// Avoid unused-import warnings until step 5 wires this in.
void WorkIncome;
