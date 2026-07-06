/**
 * YearSolver.ts
 *
 * Phase 2R: Retirement Year Solver
 *
 * This is the core convergence solver for retirement years. It handles:
 * 1. Roth conversion planning (FIRST - determines ordinary income)
 * 2. Withdrawal planning (SECOND - uses known tax rates)
 * 3. Convergence loop for bracket crossings
 *
 * Design Principles:
 * - Conversion before withdrawals (conversion affects LTCG rates)
 * - Algebraic gross-up on BASE deficit (no LTCG in deficit)
 * - Loop only when bracket crossing occurs (rare)
 * - Pure functions - no mutations during planning
 */

import { AnyAccount, InvestedAccount } from "../../components/Objects/Accounts/models";
import { AnyIncome, FERSPensionIncome, PassiveIncome, isSocialSecurity } from "../../components/Objects/Income/models";
import { AnyExpense, LoanExpense } from "../../components/Objects/Expense/models";
import { isOfferableDebt, DEBT_PAYOFF_EPSILON } from "./SurplusAllocator";
import { TaxParameters } from "../../data/TaxData";
import { TaxState } from "../../components/Objects/Taxes/TaxContext";
import { AssumptionsState, ACA_SUBSIDY_LOSS_DEFAULT } from "../../components/Objects/Assumptions/AssumptionsContext";
import { RothConversionStrategy, resolveRothConversionStrategy } from "../../components/Objects/Assumptions/rothConversionStrategy";
import {
    YearPlan,
    PlannedWithdrawal,
    PlannedConversion,
    DecisionLogEntry,
    YearPlanTax,
    ConversionTaxSource,
    TaxOptimizationTarget,
    ConversionConstraints,
    ConversionLimitingFactor,
    BaselineProjections,
} from "./types";
import { WithdrawalResult } from "../WithdrawalStrategies";
import { DPPolicy, lookupConversionPolicy } from "./RothConversionDP";
import { classifyIncome, getTotalSSBenefits } from "./IncomeClassifier";
import { planWithdrawals, createOrderedSnapshots, grossUpBrokerage } from "./WithdrawalPlanner";
import * as TaxService from "../../components/Objects/Taxes/TaxService";
import { getLTCGRate } from "../../components/Objects/Taxes/taxService/capitalGainsTax";
import { calculateEffectiveConversionTax, ACAOptions, IRMAAConversionOptions } from "./helpers";
import { getRMDStartAge, calculateRMD, isAccountSubjectToRMD } from "../../data/RMDData";
import { getIRMAAAnnualSurcharge, getIRMAASchedule, resolveIrmaaLookbackMAGI, MEDICARE_ELIGIBILITY_AGE } from "../../data/IRMAAData";
import {
    calculateDynamicConversionCeiling,
    coarseToFineSearch,
    getAcaCliffThreshold,
} from "./TaxOptimizedWithdrawal";
import { estimateFixedIncomeAtRMD } from "./helpers";
import { allocateSurplus, SurplusAllocationSettings } from "./SurplusAllocator";
import { getIRALimit } from "../../data/ContributionLimits";

// =============================================================================
// CONSTANTS
// =============================================================================

const DEFAULT_GROWTH_RATE = 0.07;
const DEFAULT_EMERGENCY_FUND_TARGET = 30000;

/**
 * #60 (linked-debt surplus paydown): per-DebtAccount cap = the linked
 * LoanExpense's current (post-amortization) balance, so allocateSurplus pays at
 * most what's left on the loan and the engine reduces the authoritative expense.
 * The link is bidirectional — the LoanExpense's linkedAccountId is the
 * DebtAccount's id — so we key by `loan.linkedAccountId`. Returns {} when no debt
 * is payable (the common case) so default-off is a no-op.
 *
 * [6] The cap gates on the LOAN's balance (`exp.amount`, authoritative), NOT the
 * DebtAccount mirror — the mirror can be stale/0 while the loan still owes (or
 * vice versa). [5] Sub-cent residuals are treated as paid off so a near-zero
 * loan isn't a fundable paydown.
 */
function buildDebtPaydownCaps(accounts: AnyAccount[], expenses: AnyExpense[]): Record<string, number> {
    const caps: Record<string, number> = {};
    for (const exp of expenses) {
        if (!(exp instanceof LoanExpense) || !exp.linkedAccountId) continue;
        if (exp.amount <= DEBT_PAYOFF_EPSILON) continue; // [5]/[6]: gate on the LOAN balance
        const debt = accounts.find(a => a.id === exp.linkedAccountId);
        // The debt must be a paydown-eligible account type (linked, non-deficit).
        if (isOfferableDebt(debt)) {
            caps[debt.id] = exp.amount;
        }
    }
    return caps;
}

// =============================================================================
// TYPES
// =============================================================================

export interface YearSolverInput {
    year: number;
    currentAge: number;
    isRetired: boolean;

    // Income & Expenses
    incomes: AnyIncome[];
    expenses: AnyExpense[];
    totalLivingExpenses: number;
    rmdAmount: number;
    /**
     * IRS excise penalty (25% of the RMD shortfall) computed by RMDService when a
     * required distribution can't be fully satisfied. It's a cash tax with no
     * matching distribution, so the solver folds it into the year's total tax /
     * penalties so it reduces cash and shows up in net worth. Defaults to 0.
     */
    rmdPenalty?: number;

    /**
     * RSU sell-to-cover withholding the employer already remitted this year (by
     * selling the withholding slice of shares at vest). It's an estimated-tax
     * PREPAYMENT, so in the working-year cash-flow it offsets the tax due: the
     * deficit math nets it out (and treats any excess over the actual tax as a
     * refund inflow) so an over-withheld vest doesn't fabricate a phantom
     * deficit-debt (#114). Defaults to 0; non-RSU years are unaffected
     * (`max(0, tax − 0) == tax`). Only `solveWorkingYear` consumes it — the
     * retirement path applies the same netting in SimulationEngine instead.
     */
    rsuWithholding?: number;

    // Accounts
    accounts: AnyAccount[];
    withdrawalOrder: { accountId: string }[];
    /**
     * Accounts reserved for a dedicated purpose (goal sinking funds). The
     * surplus allocator must never treat these as general savings — without
     * this, its no-priorities smart-default can pick a goal fund as "the
     * emergency fund" and stuff surplus into it on top of the committed goal
     * funding the engine deposits directly.
     */
    reservedAccountIds?: string[];

    // Tax state
    taxState: TaxState;
    assumptions: AssumptionsState;

    // Strategy
    strategyResult?: WithdrawalResult;

    // Settings
    taxOptimizationEnabled: boolean;
    acaAware: boolean;

    // Prior year data (for GK and conversions). `magi` carries each prior year's
    // MAGI so the solver can read year N-2's MAGI for the Medicare IRMAA lookback.
    previousSimulation?: { year: number; accounts: AnyAccount[]; magi?: number }[];

    // GK Guardrails (optional - only passed when withdrawal strategy is active)
    gkBudget?: number;           // The GK-adjusted spending budget
    fixedExpenses?: number;      // Fixed (non-discretionary) expenses
    discretionaryExpenses?: number; // Discretionary expenses (may be eliminated)

    // Baseline projections from a per-year forward sub-simulation (std-ded-only
    // conversions). When provided, the conversion ceiling calculator uses these as
    // the source of truth for SS/pension/passive/Trad-balance at RMD age — more
    // accurate than COLA-only fallbacks or naive forward-compounding of today's
    // Trad balance.
    baselineProjections?: BaselineProjections;

    // Conversion mode. 'rate-match' (default) runs the full bracket-walking
    // algorithm. 'std-ded-only' is used by `runProjectionSubsim` to do only
    // standard-deduction-headroom conversions while projecting the baseline
    // trajectory for the main sim's rate-match decisions.
    conversionMode?: 'rate-match' | 'std-ded-only';

    // Precomputed conversion plan keyed by simulation year. Populated only when
    // `assumptions.investments.rothConversionStrategy === 'dp-precomputed'`. The
    // DP strategy looks up this year's amount and skips per-year bracket-walking.
    dpConversionPlan?: Map<number, number>;
    // Per-year debug-log strings from the DP solver. planConversionDP appends
    // them to its decisions so they surface in the year inspector. Only set
    // when the DP strategy is in use.
    dpDebugByYear?: Map<number, string[]>;
    // Closed-loop conversion POLICY (#98). Set ONLY on the MC path; undefined in
    // production/deterministic runs. When set, planConversionDP looks up the
    // conversion at the path's REALIZED (Traditional, Roth) state — re-optimizing
    // the amount AND whether to convert from each realized state, fixing #93's
    // bull-path overrun / can't-add-years / trim-drift. Non-anticipative: the
    // policy integrates over the return distribution, never a path's realized future.
    mcConversionPolicy?: DPPolicy;

    // #164 INTERNAL — never set by callers. When true, the conversion strategy
    // plans a $0 conversion (the spending-deficit bracket reservation is still
    // computed, since it doesn't depend on the conversion amount). Used by
    // solveRetirementYear's display-fidelity counterfactual re-solve, which
    // reports the conversion's tax cost as the finite difference between this
    // year's total tax with and without the conversion.
    forceZeroConversion?: boolean;

    // #170: set ONLY on candidate-SCORING runs (engine-direct conversion search,
    // joint withdrawal-order search, MC h*-cap derivation) — timelines that never
    // surface a displayed tax cost. Skips the display-fidelity refinements: the
    // #164 counterfactual re-solve (solveRetirementYear) and the #159 working-year
    // finite-difference decomposition. Reporting-only — conversion amounts,
    // balances, taxes, and cashflows are identical either way; only the reported
    // PlannedConversion.taxAmount / fed / state fields fall back to the cheap
    // estimate ($0 for working years). The final user-facing projection never
    // sets this.
    skipDisplayRefinement?: boolean;
}

export interface ConversionPlan {
    conversion: PlannedConversion | null;
    conversionTax: number;
    taxSource: ConversionTaxSource;
    additionalOrdinaryIncome: number;
    decisions: DecisionLogEntry[];
    taxOptimizationTarget?: TaxOptimizationTarget;
    bracketSpaceForSpending: number;  // bracket space reserved for Traditional spending
}

/**
 * A conversion-amount-deciding strategy. Implementations decide how much (if any)
 * Traditional → Roth conversion to do for a single year, given the year's tax
 * context. The rate-match implementation walks brackets per-year; future DP
 * implementations precompute a per-year plan and look it up. Both must satisfy
 * the same input/output contract.
 */
export type ConversionStrategy = (
    input: YearSolverInput,
    baseOrdinaryIncome: number,
    socialSecurityBenefits: number,
    nonSSOrdinaryIncome: number,
    fedParams: TaxParameters,
    stateParams: TaxParameters | null,
    surplus: number,
    spendingDeficit: number,
    // GK-effective living expenses for the year (after Guardrails / Fixed-Real
    // trimming). May be less than input.totalLivingExpenses. The rate-match
    // ACA-cliff estimator uses this so its deficit/MAGI match the authoritative
    // loop instead of overstating the deficit from the un-trimmed total.
    effectiveLivingExpenses: number,
) => ConversionPlan;

/**
 * Pick the conversion strategy for the current run. The DP path requires a
 * precomputed plan to be on `input.dpConversionPlan` (built upstream by
 * `runSimulationWithOptimization`); without it, the DP strategy returns a
 * no-conversion plan for the year.
 */
function selectConversionStrategy(
    strategyName: RothConversionStrategy | undefined,
): ConversionStrategy {
    // Resolve the default HERE (the single executor dispatch) so an unset (legacy) strategy
    // dispatches to the DP plan rather than silently falling back to rate-match and
    // discarding a built plan. This is why callers no longer need to re-pin the strategy.
    return resolveRothConversionStrategy(strategyName) === 'dp-precomputed' ? planConversionDP : planConversion;
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

export function getTotalTraditionalBalance(accounts: AnyAccount[]): number {
    return accounts
        .filter(a => a instanceof InvestedAccount &&
            (a.taxType === 'Traditional 401k' || a.taxType === 'Traditional IRA'))
        .reduce((sum, a) => sum + (a as InvestedAccount).vestedAmount, 0);
}

export function getTotalBrokerageBalance(accounts: AnyAccount[]): number {
    return accounts
        .filter(a => a instanceof InvestedAccount && a.taxType === 'Brokerage')
        .reduce((sum, a) => sum + (a as InvestedAccount).vestedAmount, 0);
}

/**
 * Total Roth IRA balance — the realized Roth state for the #98 policy lookup.
 * Matches the DP's roth state (RothConversionDP keys its policy on Roth IRA
 * balances only, excluding Roth 401k, mirroring buildDPYearContexts).
 */
export function getTotalRothBalance(accounts: AnyAccount[]): number {
    return accounts
        .filter(a => a instanceof InvestedAccount && a.taxType === 'Roth IRA')
        .reduce((sum, a) => sum + (a as InvestedAccount).vestedAmount, 0);
}

function getFirstTraditionalAccount(accounts: AnyAccount[]): InvestedAccount | null {
    return accounts.find(a =>
        a instanceof InvestedAccount &&
        (a.taxType === 'Traditional 401k' || a.taxType === 'Traditional IRA') &&
        a.vestedAmount > 0
    ) as InvestedAccount | null;
}

/**
 * Per-account RMD reservation amounts. RMDService drains each RMD-subject
 * Traditional account by its OWN required distribution (prior-year vested
 * balance ÷ life-expectancy factor, capped at the account's vested balance),
 * recording it as a negative userInflow applied later by growAccounts. The
 * solver reads the raw (undrained) balances, so the discretionary planner must
 * reserve each account's RMD from its snapshot — otherwise it could plan to
 * withdraw dollars the RMD already took.
 *
 * This mirrors RMDService.processRMDs exactly (same prior-year source, same
 * `calculateRMD`, same vested cap), so the reserved amount equals what was
 * actually drained per account. Reserving the WHOLE RMD against only the first
 * Traditional account (the prior behavior) over-reserved that account and left
 * the withdrawal-source account under-reserved, fabricating phantom spendable
 * cash and stranding balance in the over-reserved account.
 */
function computePerAccountRMD(
    accounts: AnyAccount[],
    previousSimulation: YearSolverInput['previousSimulation'],
    currentAge: number,
): Map<string, number> {
    const perAccount = new Map<string, number>();
    const priorSim = previousSimulation && previousSimulation.length > 0
        ? previousSimulation[previousSimulation.length - 1]
        : undefined;

    for (const account of accounts) {
        if (!(account instanceof InvestedAccount)) continue;
        if (!isAccountSubjectToRMD(account.taxType)) continue;

        let priorYearBalance = account.vestedAmount;
        if (priorSim) {
            const priorAccount = priorSim.accounts.find(a => a.id === account.id);
            if (priorAccount instanceof InvestedAccount) {
                priorYearBalance = priorAccount.vestedAmount;
            }
        }

        const rmd = calculateRMD(priorYearBalance, currentAge);
        if (rmd <= 0) continue;
        const withdrawn = Math.min(rmd, account.vestedAmount);
        if (withdrawn > 0) {
            perAccount.set(account.id, (perAccount.get(account.id) ?? 0) + withdrawn);
        }
    }
    return perAccount;
}

function getFirstRothAccount(accounts: AnyAccount[]): InvestedAccount | null {
    return accounts.find(a =>
        a instanceof InvestedAccount &&
        (a.taxType === 'Roth 401k' || a.taxType === 'Roth IRA')
    ) as InvestedAccount | null;
}

/**
 * Get the weighted average gain ratio for brokerage accounts.
 * Used for estimating LTCG from potential withdrawals.
 */
function getBrokerageGainRatio(accounts: AnyAccount[]): number {
    let totalBalance = 0;
    let totalGains = 0;

    for (const account of accounts) {
        if (account instanceof InvestedAccount && account.taxType === 'Brokerage') {
            const balance = account.vestedAmount;
            const gains = Math.max(0, balance - account.costBasis);
            totalBalance += balance;
            totalGains += gains;
        }
    }

    return totalBalance > 0 ? totalGains / totalBalance : 0;
}

/**
 * Get LTCG rate based on ordinary income level.
 * Thin alias over the shared getLTCGRate helper in capitalGainsTax.
 */
const getLTCGRateForIncome = getLTCGRate;

/**
 * Estimate LTCG that would result from covering a deficit via brokerage withdrawal.
 * Formula: LTCG = grossWithdrawal × gainRatio
 *          grossWithdrawal = deficit / (1 - gainRatio × ltcgRate)
 *          When ltcgRate = 0: grossWithdrawal = deficit, LTCG = deficit × gainRatio
 */
function estimateLTCGFromDeficit(deficit: number, gainRatio: number, ltcgRate: number = 0): number {
    if (deficit <= 0 || gainRatio <= 0) return 0;

    // Delegate to the authoritative brokerage sizer so this ACA-cliff prediction
    // can't drift from how the withdrawal planner actually realizes LTCG.
    return grossUpBrokerage(deficit, gainRatio, ltcgRate).ltcg;
}

/**
 * Tax-split helpers for planned withdrawals, shared by the retirement and
 * working solvers. A withdrawal with `capitalGains === undefined` is
 * ordinary-only (Traditional/HSA/Roth): its whole `tax` is ordinary. A
 * capital-gains-bearing withdrawal (brokerage/ESPP) carries its ordinary
 * portion (the ESPP bargain element) in `ordinaryTax`; the rest of its `tax`
 * is the LTCG/STCG pass-through.
 */
function ordinaryTaxOf(withdrawals: PlannedWithdrawal[]): number {
    return withdrawals.reduce(
        (sum, w) => sum + (w.capitalGains === undefined ? w.tax : (w.ordinaryTax ?? 0)),
        0,
    );
}

function ltcgTaxOf(withdrawals: PlannedWithdrawal[]): number {
    return withdrawals
        .filter(w => w.capitalGains !== undefined)
        .reduce((sum, w) => sum + (w.tax - (w.ordinaryTax ?? 0)), 0);
}

/**
 * Compute this year's Medicare IRMAA surcharge (2-year lookback) and log it.
 *
 * Shared by the retirement and working-year solvers: both gate on Medicare age,
 * resolve the lookback MAGI (year N-2, with the supplied `selfProxyMAGI` as the
 * first-simulated-year fallback), bill the surcharge, and push the same decision
 * log line. They differ ONLY in the self-proxy MAGI expression, which the caller
 * passes in — so this collapses two near-identical blocks into one definition.
 * Returns 0 when not yet on Medicare.
 */
function computeIrmaaForYear(
    input: YearSolverInput,
    selfProxyMAGI: number,
    decisions: DecisionLogEntry[],
): number {
    if (input.currentAge < MEDICARE_ELIGIBILITY_AGE) return 0;

    const lookbackMAGI = resolveIrmaaLookbackMAGI(
        input.previousSimulation,
        input.year,
        selfProxyMAGI,
    );
    const irmaaSurcharge = getIRMAAAnnualSurcharge(
        lookbackMAGI,
        input.taxState.filingStatus,
        input.year,
        input.assumptions,
    );
    if (irmaaSurcharge > 0) {
        decisions.push({
            category: 'tax',
            amount: irmaaSurcharge,
            description: `Medicare IRMAA surcharge: $${Math.round(irmaaSurcharge).toLocaleString()} ` +
                `(from ${input.year - 2} MAGI of $${Math.round(lookbackMAGI).toLocaleString()}).`,
        });
    }
    return irmaaSurcharge;
}

/**
 * Compute a conversion's tax cost, its federal/state decomposition, and the
 * tax-payment source. Shared by planConversion (rate-match) and planConversionDP
 * so both strategies price an identical conversion identically (they previously
 * duplicated this block, which risked the two paths silently diverging).
 */
function computeConversionTaxAndSource(
    input: YearSolverInput,
    baseOrdinaryIncome: number,
    nonSSOrdinaryIncome: number,
    socialSecurityBenefits: number,
    conversionAmount: number,
    spendingDeficit: number,
    surplus: number,
    fedParams: TaxParameters,
    stateParams: TaxParameters | null,
): { conversionTax: number; conversionFedTax: number; conversionStateTax: number; taxSource: ConversionTaxSource } {
    // Estimate this year's LTCG so the conversion's displayed Tax Cost reflects
    // the LTCG bump (brokerage is sold for the spending deficit + conversion tax,
    // and the LTCG rate rises 0%→15%→20% as ordinary income climbs).
    const ltcgGainRatio = getBrokerageGainRatio(input.accounts);
    const ltcgRateAtIncome = getLTCGRateForIncome(baseOrdinaryIncome + conversionAmount, fedParams);
    const estimatedLTCGForYear = estimateLTCGFromDeficit(
        Math.max(0, spendingDeficit),
        ltcgGainRatio,
        ltcgRateAtIncome,
    );

    // First arg must be ordinary income EXCLUDING SS — the function re-derives
    // taxable SS internally from the separate socialSecurityBenefits arg. Passing
    // baseOrdinaryIncome (which already includes taxable SS) double-counts SS.
    //
    // No acaOptions here (reported-cost path, mirroring the IRMAA convention):
    // the ACA subsidy repayment is charged as REAL cash by solveRetirementYear
    // (acaSubsidyRepayment → total tax) in cliff-crossing years, so folding it
    // into the conversion's displayed taxAmount would double-count it. The
    // SEARCH paths (coarseToFineSearch, DP) still price the cliff via acaOptions
    // to steer conversion sizing.
    const conversionTaxResult = calculateEffectiveConversionTax(
        nonSSOrdinaryIncome,
        socialSecurityBenefits,
        estimatedLTCGForYear,
        conversionAmount,
        input.taxState.filingStatus,
        fedParams,
        stateParams,
    );

    const conversionTax = conversionTaxResult.taxIncrease;
    const conversionFedTax = conversionTaxResult.breakdown.federalOrdinaryTaxCost
        + conversionTaxResult.breakdown.ssTorpedoCost
        + conversionTaxResult.breakdown.ltcgBumpCost
        + conversionTaxResult.breakdown.niitCost;
    const conversionStateTax = conversionTaxResult.breakdown.stateTaxCost;

    // Tax payment source: prefer surplus, then brokerage, else withhold from the
    // conversion (the spending deficit already includes the conversion tax via
    // finalFedResult.totalTax, so the full amount still reaches Roth).
    const brokerageBalance = getTotalBrokerageBalance(input.accounts);
    let taxSource: ConversionTaxSource;
    if (surplus >= conversionTax) {
        taxSource = 'SURPLUS';
    } else if (brokerageBalance >= conversionTax) {
        taxSource = 'BROKERAGE';
    } else {
        taxSource = 'WITHHOLD';
    }

    return { conversionTax, conversionFedTax, conversionStateTax, taxSource };
}

// =============================================================================
// CONVERSION PLANNING
// =============================================================================

/**
 * Build the inputs for and call calculateDynamicConversionCeiling. Extracted so
 * both planConversion (rate-match) and planConversionDP can compute the same
 * ceiling and bracket-space figures — DP uses them only for the spending
 * reservation gate, rate-match uses them for conversion sizing too.
 */
function computeCeilingContext(
    input: YearSolverInput,
    baseOrdinaryIncome: number,
    socialSecurityBenefits: number,
    fedParams: TaxParameters,
): {
    ceilingResult: ReturnType<typeof calculateDynamicConversionCeiling>;
    rmdStartAge: number;
    yearsUntilRMD: number;
    fixedIncomeAtRMD: ReturnType<typeof estimateFixedIncomeAtRMD>;
    passiveIncome: number;
    growthRate: number;
    acaOptions?: ACAOptions;
    traditionalBalance: number;
} {
    const traditionalBalance = getTotalTraditionalBalance(input.accounts);
    const birthYear = input.year - input.currentAge;
    const rmdStartAge = getRMDStartAge(birthYear);
    const yearsUntilRMD = Math.max(0, rmdStartAge - input.currentAge);

    // Pension income for the conversion ceiling must include the FERS MRA-to-62
    // supplement (a bridge payment that ends at 62). FERSPensionIncome exposes it
    // via getTotalAnnualAmount(); plain getAnnualAmount() drops it. Mirror
    // IncomeClassifier / CashflowDetailBuilder, which both use the total. Other
    // pension types (CSRS) have no supplement, so fall back to getAnnualAmount().
    const pensionIncome = input.incomes
        .filter(i => i.className?.includes('Pension'))
        .reduce((sum, i) => sum + (i instanceof FERSPensionIncome
            ? i.getTotalAnnualAmount(input.year)
            : i.getAnnualAmount(input.year)), 0);

    const passiveIncome = input.incomes
        .filter(i => i.className === 'PassiveIncome' && (i as PassiveIncome).sourceType !== 'RMD')
        .reduce((sum, i) => sum + i.getAnnualAmount(input.year), 0);

    const futureSS = input.incomes.find(i => i.className === 'FutureSocialSecurityIncome') as
        { calculatedPIA?: number; claimingAge?: number; name?: string; amount?: number; projectedPIA?: number } | undefined;
    // Fall back to any not-yet-claimed Social Security income (e.g. a plain
    // SocialSecurityIncome with a claiming age we haven't reached — still a current
    // app-produced shape, not just legacy) when there's no FutureSocialSecurityIncome
    // and SS isn't already being received this year. Without this the ceiling lookup
    // matched only className==='FutureSocialSecurityIncome' and projected ssAtRMD=0,
    // understating the SS torpedo and lifting the conversion ceiling too high.
    const unclaimedLegacySS = (!futureSS && socialSecurityBenefits <= 0)
        ? input.incomes.find(i =>
            isSocialSecurity(i) &&
            typeof (i as { claimingAge?: number }).claimingAge === 'number' &&
            (i as { claimingAge: number }).claimingAge > input.currentAge) as
            (AnyIncome & { claimingAge?: number }) | undefined
        : undefined;
    // getAnnualAmount() with NO year returns the raw (un-prorated) annual benefit —
    // a not-yet-active income prorates to 0 for the current year, so we must skip the
    // active-multiplier here to recover its claiming-age benefit.
    const legacyMonthlyPIA = unclaimedLegacySS ? unclaimedLegacySS.getAnnualAmount() / 12 : 0;
    const futureSS_PIA = (futureSS?.projectedPIA && futureSS.projectedPIA > 0)
        ? futureSS.projectedPIA
        : (futureSS?.amount ? futureSS.amount / 12 : (futureSS?.calculatedPIA ?? legacyMonthlyPIA));
    const ssClaimingAge = futureSS?.claimingAge ?? unclaimedLegacySS?.claimingAge ?? 67;

    const inflationAdjusted = input.assumptions.macro.inflationAdjusted;
    const ssCola = inflationAdjusted ? 0.02 : 0;
    const pensionCola = inflationAdjusted ? 0.02 : 0;

    const fixedIncomeAtRMD = estimateFixedIncomeAtRMD(
        socialSecurityBenefits,
        futureSS_PIA,
        pensionIncome,
        input.currentAge,
        rmdStartAge,
        ssClaimingAge,
        ssCola,
        pensionCola
    );

    const grossRoR = input.assumptions.investments.returnRates.ror ?? (DEFAULT_GROWTH_RATE * 100);
    const tradAccounts = input.accounts.filter(a =>
        a instanceof InvestedAccount &&
        (a.taxType === 'Traditional 401k' || a.taxType === 'Traditional IRA')
    ) as InvestedAccount[];
    const totalTradBalance = tradAccounts.reduce((sum, a) => sum + a.vestedAmount, 0);
    const weightedER = totalTradBalance > 0
        ? tradAccounts.reduce((sum, a) => sum + a.expenseRatio * a.vestedAmount, 0) / totalTradBalance
        : 0;
    const growthRate = (grossRoR - weightedER) / 100;

    let acaOptions: ACAOptions | undefined;
    if (input.acaAware && input.currentAge < 65) {
        // Use the shared 400% FPL cliff (by year + filing status) rather than hardcoded
        // values, matching RothConversionDP. The old constants ($125k MFJ / $62.5k single)
        // diverged from the real thresholds (~$81.8k / $60.2k for 2024).
        const acaFiling: 'single' | 'married_filing_jointly' =
            input.taxState.filingStatus === 'Married Filing Jointly' ? 'married_filing_jointly' : 'single';
        acaOptions = {
            currentAge: input.currentAge,
            acaSubsidyAware: true,
            acaCliffThreshold: getAcaCliffThreshold(acaFiling, input.year),
            estimatedSubsidyLoss: input.assumptions.investments.acaAnnualSubsidyLoss ?? ACA_SUBSIDY_LOSS_DEFAULT,
        };
    }

    const ceilingResult = calculateDynamicConversionCeiling(
        traditionalBalance,
        yearsUntilRMD,
        fixedIncomeAtRMD.pensionAtRMD,
        fixedIncomeAtRMD.ssAtRMD,
        passiveIncome,
        baseOrdinaryIncome,
        growthRate,
        rmdStartAge,
        fedParams,
        input.taxState,
        input.baselineProjections,
        input.assumptions,
        input.conversionMode ?? 'rate-match'
    );

    return {
        ceilingResult,
        rmdStartAge,
        yearsUntilRMD,
        fixedIncomeAtRMD,
        passiveIncome,
        growthRate,
        acaOptions,
        traditionalBalance,
    };
}

/**
 * Plan Roth conversion for the year.
 *
 * Conversion is planned FIRST because it affects:
 * 1. Ordinary income (determines marginal rates)
 * 2. LTCG rate (stacks on top of ordinary income)
 * 3. SS taxability (provisional income includes conversion)
 */
function planConversion(
    input: YearSolverInput,
    baseOrdinaryIncome: number, // non-SS ordinary income + taxable SS (federal bracket-positioning base)
    socialSecurityBenefits: number,
    nonSSOrdinaryIncome: number, // ordinary income EXCLUDING SS entirely (taxableBase - fullSS)
    fedParams: TaxParameters,
    stateParams: TaxParameters | null,
    surplus: number, // Cash surplus that could pay conversion tax
    spendingDeficit: number,  // pre-tax deficit estimate (expenses + roughTax - spendable - RMD)
    effectiveLivingExpenses: number  // GK-effective living expenses (≤ totalLivingExpenses)
): ConversionPlan {
    const decisions: DecisionLogEntry[] = [];
    let bracketSpaceForSpending = 0;

    const traditionalBalance = getTotalTraditionalBalance(input.accounts);

    // Skip conversion if not enabled or not retired
    if (!input.taxOptimizationEnabled || !input.isRetired) {
        const limitingFactor: ConversionLimitingFactor = !input.isRetired ? 'NOT_RETIRED' : 'OPTIMIZATION_DISABLED';
        return {
            conversion: null,
            conversionTax: 0,
            taxSource: 'SURPLUS',
            additionalOrdinaryIncome: 0,
            decisions,
            bracketSpaceForSpending: 0,
            taxOptimizationTarget: {
                yearsUntilRMD: 0,
                rmdStartAge: 73,
                targetBracketCeiling: 0,
                bracketSpaceThisYear: 0,
                ssAtRMD: 0,
                pensionAtRMD: 0,
                currentTraditionalBalance: traditionalBalance,
                limitingFactor,
                actualConversion: 0,
            },
        };
    }

    if (traditionalBalance <= 0) {
        decisions.push({
            category: 'conversion',
            description: 'Skipped Roth conversion: no Traditional balance available.',
        });
        return {
            conversion: null,
            conversionTax: 0,
            taxSource: 'SURPLUS',
            additionalOrdinaryIncome: 0,
            decisions,
            bracketSpaceForSpending: 0,
            taxOptimizationTarget: {
                yearsUntilRMD: 0,
                rmdStartAge: 73,
                targetBracketCeiling: 0,
                bracketSpaceThisYear: 0,
                ssAtRMD: 0,
                pensionAtRMD: 0,
                currentTraditionalBalance: 0,
                limitingFactor: 'TRADITIONAL_DEPLETED',
                actualConversion: 0,
            },
        };
    }

    const {
        ceilingResult,
        rmdStartAge,
        yearsUntilRMD,
        fixedIncomeAtRMD,
        acaOptions,
    } = computeCeilingContext(input, baseOrdinaryIncome, socialSecurityBenefits, fedParams);

    // Log ceiling decision so it's visible in the year inspector
    decisions.push({
        category: 'conversion',
        description:
            `Ceiling: ${yearsUntilRMD}yr to RMD, ` +
            `Trad@RMD ~$${Math.round(ceilingResult.projectedBalanceAtRMD).toLocaleString()} ` +
            `(baseline no-conversion), ` +
            `peak RMD ~$${Math.round(ceilingResult.peakRMD).toLocaleString()}/yr ` +
            `→ ${(ceilingResult.peakRMDBracket * 100).toFixed(0)}% bracket ` +
            `→ ceiling ${ceilingResult.conversionCeiling > 0 ? (ceilingResult.conversionCeiling * 100).toFixed(0) + '%' : 'none (0%)'}.`,
    });

    // Build constraint details for debugging
    const constraintDetails: ConversionConstraints = {
        bracketCeiling: ceilingResult.conversionCeiling,
        bracketTop: 0, // Will be calculated below
        currentAGI: baseOrdinaryIncome,
        rawBracketSpace: ceilingResult.bracketSpacePerYear,
        ssTorpedoReduction: 0,
        acaCliffReduction: 0,
        effectiveBracketSpace: ceilingResult.bracketSpacePerYear,
        ssTorpedoTriggered: false,
        acaCliffTriggered: false,
    };

    // Calculate bracket top based on filing status and target ceiling
    const bracketThresholds = fedParams.brackets.filter(b => b.rate <= ceilingResult.conversionCeiling);
    if (bracketThresholds.length > 0) {
        const topBracket = bracketThresholds[bracketThresholds.length - 1];
        // Next bracket threshold is the top of current bracket
        const nextBracketIdx = fedParams.brackets.findIndex(b => b.rate > ceilingResult.conversionCeiling);
        if (nextBracketIdx > 0) {
            constraintDetails.bracketTop = fedParams.brackets[nextBracketIdx].threshold + fedParams.standardDeduction;
        } else {
            // At highest bracket
            constraintDetails.bracketTop = topBracket.threshold + fedParams.standardDeduction + 1000000;
        }
    }

    // Build the tax optimization target info for UI display
    const taxOptimizationTarget: TaxOptimizationTarget = {
        yearsUntilRMD,
        rmdStartAge,
        targetBracketCeiling: ceilingResult.conversionCeiling,
        bracketSpaceThisYear: ceilingResult.bracketSpacePerYear,
        ssAtRMD: fixedIncomeAtRMD.ssAtRMD,
        pensionAtRMD: fixedIncomeAtRMD.pensionAtRMD,
        projectedBalanceAtRMD: ceilingResult.projectedBalanceAtRMD,
        currentTraditionalBalance: traditionalBalance,
        constraintDetails,
        rateMatchWalk: ceilingResult.rateMatchWalk,
    };

    // Calculate bracket space
    let bracketSpace = Math.max(0, ceilingResult.bracketSpacePerYear);

    if (bracketSpace <= 0) {
        decisions.push({
            category: 'conversion',
            description: `Skipped Roth conversion: no bracket space (income $${baseOrdinaryIncome.toLocaleString()} at ceiling ${(ceilingResult.conversionCeiling * 100).toFixed(0)}% bracket).`,
        });
        taxOptimizationTarget.limitingFactor = 'NO_BRACKET_SPACE';
        taxOptimizationTarget.actualConversion = 0;
        return {
            conversion: null,
            conversionTax: 0,
            taxSource: 'SURPLUS',
            additionalOrdinaryIncome: 0,
            decisions,
            bracketSpaceForSpending: 0,
            taxOptimizationTarget,
        };
    }

    // =========================================================================
    // SPENDING DEFICIT: Reserve bracket space for Traditional withdrawals
    // =========================================================================
    // When there's a spending deficit and brokerage can't cover it, the solver
    // would convert Traditional→Roth then withdraw Roth for spending — a wasteful
    // roundtrip. Instead, reserve bracket space for direct Traditional withdrawal.
    //
    // Two guards:
    // 1. Age >= 59.5 only. Under 59.5, conversion is strictly cheaper than
    //    penalized Traditional withdrawal. Spending comes from Roth contribution
    //    basis (penalty-free FIFO) or brokerage.
    // 2. Brokerage insufficient. When brokerage covers the deficit, no roundtrip
    //    exists — conversion fills brackets while brokerage handles spending.
    //    Only reserve for the shortfall that would spill into Roth.
    const penaltyApplies = input.currentAge < 59.5;
    if (spendingDeficit > 0 && traditionalBalance > 0 && bracketSpace > 0 && !penaltyApplies) {
        // Check how much of the deficit brokerage can cover
        const brokerageBalance = getTotalBrokerageBalance(input.accounts);
        const brokerageGainRatio = getBrokerageGainRatio(input.accounts);
        const ltcgRate = getLTCGRateForIncome(baseOrdinaryIncome, fedParams);
        // Gross down: brokerage withdrawal of $B yields $B × (1 - gainRatio × ltcgRate) net
        const brokerageCoverage = brokerageBalance * (1 - brokerageGainRatio * ltcgRate);
        const rothBoundDeficit = Math.max(0, spendingDeficit - brokerageCoverage);

        if (rothBoundDeficit > 0) {
            const marginalResult = TaxService.getMarginalTaxRate(
                Math.max(0, baseOrdinaryIncome - fedParams.standardDeduction),
                fedParams
            );
            const stateRate = stateParams
                ? TaxService.getMarginalTaxRate(
                    Math.max(0, baseOrdinaryIncome - stateParams.standardDeduction),
                    stateParams
                  ).rate
                : 0;

            // Only reserve when marginal rate is at or below the ceiling
            if (marginalResult.rate <= ceilingResult.conversionCeiling + 0.005) {
                // Gross-up the Roth-bound portion to bracket space terms
                const totalEffectiveRate = marginalResult.rate + stateRate;
                const grossForDeficit = rothBoundDeficit / Math.max(0.5, 1 - totalEffectiveRate);
                bracketSpaceForSpending = Math.min(grossForDeficit, bracketSpace, traditionalBalance);

                // Reduce bracket space available for conversion
                bracketSpace = Math.max(0, bracketSpace - bracketSpaceForSpending);

                decisions.push({
                    category: 'conversion',
                    amount: bracketSpaceForSpending,
                    description: `Reserved $${Math.round(bracketSpaceForSpending).toLocaleString()} bracket space ` +
                        `for Traditional spending (Roth-bound deficit $${Math.round(rothBoundDeficit).toLocaleString()} ` +
                        `of $${Math.round(spendingDeficit).toLocaleString()} total, ` +
                        `brokerage covers $${Math.round(brokerageCoverage).toLocaleString()}, ` +
                        `marginal rate ${(marginalResult.rate * 100).toFixed(1)}% ` +
                        `vs ${(ceilingResult.conversionCeiling * 100).toFixed(0)}% ceiling).`,
                });

                if (bracketSpace <= 0) {
                    taxOptimizationTarget.limitingFactor = 'SPENDING_DEFICIT';
                }
            }
        }
    }

    // #164 display-fidelity counterfactual: "this exact year, but a $0
    // conversion". The spending reservation above is kept (it's independent of
    // the conversion amount and shapes the withdrawal order); sizing, the SS-
    // torpedo search, and the ACA clamp are skipped — a $0 conversion needs none.
    if (input.forceZeroConversion) {
        taxOptimizationTarget.actualConversion = 0;
        return {
            conversion: null,
            conversionTax: 0,
            taxSource: 'SURPLUS',
            additionalOrdinaryIncome: 0,
            decisions,
            bracketSpaceForSpending,
            taxOptimizationTarget,
        };
    }

    // Calculate conversion amount: min of bracket space (after spending reservation)
    // and available Traditional balance. Iterative refinement of baselineProjections
    // (in runSimulationWithOptimization) handles the "smooth glidepath" behavior
    // PMT pacing previously aimed for.
    const availableTraditional = traditionalBalance - bracketSpaceForSpending;
    let conversionAmount = Math.min(bracketSpace, availableTraditional);

    // Use coarse-to-fine search for optimal amount considering SS torpedo.
    // Federal-only rates: the ceiling (e.g., 12%) is a federal bracket target.
    // State tax is still fully accounted for in the actual conversion tax cost.
    // Adjust base income and available balance for spending reservation.
    // Base must EXCLUDE SS: the search → getEffectiveConversionRate →
    // calculateEffectiveConversionTax re-derives taxable SS internally from the
    // separate socialSecurityBenefits arg. Passing baseOrdinaryIncome (which
    // already includes taxable SS) double-counts SS. Mirror the direct conversion-
    // tax call below, which passes nonSSOrdinaryIncome.
    const adjustedNonSSBaseIncome = nonSSOrdinaryIncome + bracketSpaceForSpending;

    // Medicare IRMAA conversion-awareness. A conversion this year raises this
    // year's MAGI, which sets the Part B/D surcharge two years out; so the search
    // should weigh it only when that surcharge year (currentAge + 2) is a Medicare
    // year, i.e. currentAge >= 63. Uses this year's schedule (MAGI and thresholds
    // in the same dollar-year). The actual surcharge is still deducted in year N+2
    // via the engine's true lookback — this only shapes the conversion size.
    let irmaaConversionOptions: IRMAAConversionOptions | undefined;
    if (input.currentAge + 2 >= MEDICARE_ELIGIBILITY_AGE) {
        // Resolve the schedule once: coarseToFineSearch probes these closures dozens
        // of times per conversion-year, all at the same (filingStatus, year, multiplier).
        const irmaaSchedule = getIRMAASchedule(input.taxState.filingStatus, input.year, input.assumptions);
        irmaaConversionOptions = {
            annualSurchargeForMAGI: (magi: number) => irmaaSchedule.annualSurcharge(magi),
            nextThresholdAbove: (magi: number) => irmaaSchedule.nextThreshold(magi),
        };
    }

    const searchResult = coarseToFineSearch(
        ceilingResult.conversionCeiling,
        traditionalBalance - bracketSpaceForSpending,
        adjustedNonSSBaseIncome,
        socialSecurityBenefits,
        0, // ltcgIncome
        fedParams,
        input.taxState,
        input.year,
        null, // federal-only: state tax should not reduce conversion amount
        acaOptions,
        input.assumptions,
        undefined, // debugLabel
        irmaaConversionOptions
    );

    if (searchResult.amount > 0) {
        conversionAmount = Math.min(conversionAmount, searchResult.amount);
    }

    // Log conversion sizing breakdown so the user can see what constrained the amount
    {
        const constraints: string[] = [];
        const rawBracketSpace = ceilingResult.bracketSpacePerYear;
        const effectiveBracket = bracketSpace; // after spending reservation

        if (bracketSpaceForSpending > 0) {
            constraints.push(`spending reservation $${Math.round(bracketSpaceForSpending).toLocaleString()}`);
        }
        if (availableTraditional < effectiveBracket) {
            constraints.push(`Traditional balance $${Math.round(availableTraditional).toLocaleString()}`);
        }
        if (searchResult.amount > 0 && searchResult.amount < conversionAmount + 100) {
            constraints.push(`SS torpedo search $${Math.round(searchResult.amount).toLocaleString()}${searchResult.edgeType === 'SS_TORPEDO' ? ' (torpedo)' : ''}`);
        }

        const limitedBy = constraints.length > 0
            ? `Limited by: ${constraints.join('; ')}.`
            : `Using full bracket space.`;

        decisions.push({
            category: 'conversion',
            amount: conversionAmount,
            description: `Conversion sizing: bracket space $${Math.round(rawBracketSpace).toLocaleString()} ` +
                `(ceiling ${(ceilingResult.conversionCeiling * 100).toFixed(0)}%), ` +
                `result $${Math.round(conversionAmount).toLocaleString()}. ${limitedBy}`,
        });
    }

    // =========================================================================
    // ACA CLIFF ENFORCEMENT: Account for LTCG in MAGI calculation
    // =========================================================================
    // The algebraic approach:
    //   MAGI = conversion + LTCG
    //   LTCG comes from brokerage withdrawals to cover deficit
    //   deficit = expenses + ordinaryTax(conversion) - income
    // We need to find max conversion where MAGI ≤ cliff
    if (acaOptions && input.acaAware && input.currentAge < 65 && conversionAmount > 0) {
        const acaCliff = acaOptions.acaCliffThreshold;
        const gainRatio = getBrokerageGainRatio(input.accounts);

        // Get the EXACT same values the solver uses
        const incomeClass = classifyIncome(input.incomes, input.rmdAmount, 0, input.year);
        const spendableIncome = incomeClass.classified.spendable;
        const preTaxDeductions = TaxService.getPreTaxExemptions(input.incomes, input.year, input.currentAge, true);
        const ficaTax = TaxService.calculateFicaTax(input.taxState, input.incomes, input.year, input.assumptions);

        // Function to estimate MAGI for a given conversion - uses EXACT same logic as solver
        const estimateMAGI = (conversion: number): number => {
            // 1. Calculate ordinary income with conversion (same as solver line 690)
            const allOrdinaryIncome = baseOrdinaryIncome + conversion;

            // 2. Calculate federal tax using the SAME function as solver (lines 716-724).
            // First arg = ordinary income EXCLUDING SS. nonSSOrdinaryIncome already
            // strips SS; baseOrdinaryIncome - socialSecurityBenefits would mis-net it
            // (baseOrdinaryIncome holds taxable SS, not full SS).
            const ordinaryTaxResult = TaxService.calculateTotalFederalTax(
                nonSSOrdinaryIncome + conversion, // non-SS ordinary income
                socialSecurityBenefits,
                0, // STCG
                0, // LTCG - not known yet
                preTaxDeductions,
                input.taxState.filingStatus,
                fedParams
            );

            // 3. Calculate state tax the same way the solver loop does: the state
            // base EXCLUDES the SS-taxable portion (DC and all modeled states
            // exempt SS), i.e. `allOrdinaryIncome - currentSSTaxable`, which is
            // exactly nonSS ordinary income + conversion. Using allOrdinaryIncome
            // (which embeds taxable SS via baseOrdinaryIncome) overstated state
            // tax in SS-exempting states, inflating the estimated deficit →
            // estimated LTCG → predicted MAGI, and over-cutting the conversion.
            // The solver's `+ estimatedLTCG` term is intentionally absent here:
            // LTCG is derived from this very deficit below, so it isn't known yet
            // (this matches the solver's pre-loop baseline, which also omits it).
            const stateTax = stateParams
                ? TaxService.calculateTax(nonSSOrdinaryIncome + conversion, preTaxDeductions, stateParams)
                : 0;

            // 4. Total ordinary tax (same as solver line 732)
            const ordinaryTax = ordinaryTaxResult.totalTax + stateTax;

            // 5. Calculate base deficit using the SAME formula as the solver.
            // Note: ordinaryTax already includes conversion tax (via allOrdinaryIncome),
            // so no separate adjustment needed for taxSource='BROKERAGE'.
            // classifyIncome already folds rmdAmount into spendableIncome, so it must
            // NOT be subtracted again here — the authoritative loop deficit and the
            // preliminaryDeficit both omit it. Subtracting it understated the deficit
            // (and thus estimated LTCG and MAGI), letting the ACA-cliff search permit
            // a conversion that breached the cliff.
            const estimatedDeficit = Math.max(0,
                effectiveLivingExpenses + ordinaryTax + ficaTax - spendableIncome
            );

            // 6. Calculate LTCG using gross-up formula
            // Determine LTCG rate based on income level (same logic as WithdrawalPlanner)
            const ltcgRate = getLTCGRateForIncome(allOrdinaryIncome, fedParams);
            const estimatedLTCG = estimateLTCGFromDeficit(estimatedDeficit, gainRatio, ltcgRate);

            // ACA MAGI = all gross income including 100% of SS (not just taxable portion)
            // spendable + reinvested already includes full SS, so no separate SS addition needed.
            // Previous formula (baseOrdinaryIncome + socialSecurityBenefits) double-counted SS
            // because baseOrdinaryIncome already contains taxableSS.
            const grossIncomeBase = incomeClass.classified.spendable + incomeClass.classified.reinvested;
            return grossIncomeBase + conversion + estimatedLTCG;
        };

        const originalConversion = conversionAmount;
        const initialMAGI = estimateMAGI(conversionAmount);

        if (initialMAGI > acaCliff) {
            // Need to reduce conversion - use binary search
            const ACA_BUFFER = 1000; // $1k buffer under cliff
            const targetMAGI = acaCliff - ACA_BUFFER;

            let lo = 0;
            let hi = conversionAmount;
            let bestConversion = 0;

            // Binary search for max conversion where MAGI ≤ targetMAGI
            for (let i = 0; i < 20 && hi - lo > 100; i++) {
                const mid = (lo + hi) / 2;
                const magi = estimateMAGI(mid);

                if (magi <= targetMAGI) {
                    bestConversion = mid;
                    lo = mid;
                } else {
                    hi = mid;
                }
            }

            // If buffer was too aggressive (MAGI at conv=0 is between target and cliff),
            // retry with no buffer to squeeze in a small conversion
            if (bestConversion === 0 && estimateMAGI(0) < acaCliff) {
                lo = 0;
                hi = conversionAmount;
                for (let i = 0; i < 20 && hi - lo > 100; i++) {
                    const mid = (lo + hi) / 2;
                    if (estimateMAGI(mid) <= acaCliff) {
                        bestConversion = mid;
                        lo = mid;
                    } else {
                        hi = mid;
                    }
                }
            }

            conversionAmount = Math.max(0, Math.floor(bestConversion));

            // Log the reduction
            if (conversionAmount < originalConversion) {
                const finalMAGI = estimateMAGI(conversionAmount);
                const acaReduction = originalConversion - conversionAmount;
                decisions.push({
                    category: 'conversion',
                    amount: acaReduction,
                    description: `Conversion reduced from $${originalConversion.toLocaleString()} to $${conversionAmount.toLocaleString()}: MAGI ($${Math.round(finalMAGI).toLocaleString()}) would exceed ACA cliff ($${acaCliff.toLocaleString()}) with estimated LTCG.`,
                });
                // Update constraint details with ACA info
                constraintDetails.acaCliffTriggered = true;
                constraintDetails.acaCliffReduction = acaReduction;
                constraintDetails.currentMAGI = finalMAGI;
                constraintDetails.acaCliffThreshold = acaCliff;
                constraintDetails.brokerageGainRatio = gainRatio;
                taxOptimizationTarget.limitingFactor = 'ACA_CLIFF';
            }
        }
    }

    // Update constraint details if SS torpedo was detected
    if (searchResult.edgeType === 'SS_TORPEDO') {
        constraintDetails.ssTorpedoTriggered = true;
        // Calculate how much was lost to SS torpedo
        const torpedoReduction = Math.max(0, bracketSpace - searchResult.amount);
        constraintDetails.ssTorpedoReduction = torpedoReduction;
        constraintDetails.effectiveBracketSpace = searchResult.amount;
        if (!taxOptimizationTarget.limitingFactor) {
            taxOptimizationTarget.limitingFactor = 'SS_TORPEDO';
        }
    }

    if (conversionAmount <= 0) {
        // Log why conversion was skipped — but don't overwrite limitingFactor if already set (e.g., by ACA cliff)
        if (!taxOptimizationTarget.limitingFactor) {
            decisions.push({
                category: 'conversion',
                description: `Skipped Roth conversion: no bracket space available.`,
            });
            taxOptimizationTarget.limitingFactor = 'NO_BRACKET_SPACE';
        }
        taxOptimizationTarget.actualConversion = 0;
        return {
            conversion: null,
            conversionTax: 0,
            taxSource: 'SURPLUS',
            additionalOrdinaryIncome: 0,
            decisions,
            bracketSpaceForSpending,
            taxOptimizationTarget,
        };
    }

    const { conversionTax, conversionFedTax, conversionStateTax, taxSource } =
        computeConversionTaxAndSource(
            input, baseOrdinaryIncome, nonSSOrdinaryIncome, socialSecurityBenefits,
            conversionAmount, spendingDeficit, surplus, fedParams, stateParams,
        );
    const netToRoth = conversionAmount;

    // Find source and target accounts
    const sourceAccount = getFirstTraditionalAccount(input.accounts);
    const targetAccount = getFirstRothAccount(input.accounts);

    if (!sourceAccount || !targetAccount) {
        decisions.push({
            category: 'conversion',
            description: 'Skipped Roth conversion: no valid source or target account.',
        });
        return {
            conversion: null,
            conversionTax: 0,
            taxSource: 'SURPLUS',
            additionalOrdinaryIncome: 0,
            decisions,
            bracketSpaceForSpending,
            taxOptimizationTarget,
        };
    }

    const conversion: PlannedConversion = {
        amount: conversionAmount,
        fromAccountId: sourceAccount.id,
        toAccountId: targetAccount.id,
        taxSource,
        taxAmount: conversionTax,
        federalTaxCost: conversionFedTax,
        stateTaxCost: conversionStateTax,
        netToRoth,
        reason: `Roth conversion to fill ${(ceilingResult.conversionCeiling * 100).toFixed(0)}% bracket. Tax paid from ${taxSource.toLowerCase()}.`,
    };

    decisions.push({
        category: 'conversion',
        account: sourceAccount.name,
        amount: conversionAmount,
        description: `Converted $${conversionAmount.toLocaleString()} from ${sourceAccount.name} to Roth. Tax: $${conversionTax.toLocaleString()} (${taxSource.toLowerCase()}).`,
    });

    // Update actual conversion amount and determine limiting factor if not already set
    taxOptimizationTarget.actualConversion = conversionAmount;

    // Determine limiting factor if not already set. Without PMT, the conversion is
    // either capped by bracket space (most common) or by available Traditional balance.
    if (!taxOptimizationTarget.limitingFactor) {
        if (conversionAmount >= availableTraditional - 1) {
            taxOptimizationTarget.limitingFactor = 'TRADITIONAL_DEPLETED';
        } else {
            taxOptimizationTarget.limitingFactor = 'BRACKET_CEILING';
        }
    }

    return {
        conversion,
        conversionTax,
        taxSource,
        additionalOrdinaryIncome: conversionAmount,
        decisions,
        bracketSpaceForSpending,
        taxOptimizationTarget,
    };
}

/**
 * DP-precomputed conversion strategy. Reads `input.dpConversionPlan?.get(year)`
 * (set upstream by `runSimulationWithOptimization`), clamps to available trad
 * balance, then runs the same downstream tax-payment / account-selection logic
 * as the rate-match path.
 *
 * Skip cases: not retired, optimization off, no DP plan, no traditional
 * balance, no source/target account. Falls through with the no-conversion
 * shape — same as rate-match's skip cases.
 */
function planConversionDP(
    input: YearSolverInput,
    baseOrdinaryIncome: number, // non-SS ordinary income + taxable SS (federal bracket-positioning base)
    socialSecurityBenefits: number,
    nonSSOrdinaryIncome: number, // ordinary income EXCLUDING SS entirely (taxableBase - fullSS)
    fedParams: TaxParameters,
    stateParams: TaxParameters | null,
    surplus: number,
    spendingDeficit: number,
    // The shared ConversionStrategy contract passes effectiveLivingExpenses as a
    // 9th arg for the rate-match ACA-cliff estimator. The DP path has no such
    // estimator, so it omits the param (a narrower function still satisfies the
    // wider type) rather than carry an unused binding.
): ConversionPlan {
    const decisions: DecisionLogEntry[] = [];
    const traditionalBalance = getTotalTraditionalBalance(input.accounts);
    let bracketSpaceForSpending = 0;

    // Surface DP solver's per-year debug into the year inspector.
    const dpDebugLines = input.dpDebugByYear?.get(input.year) ?? [];
    for (const line of dpDebugLines) {
        decisions.push({ category: 'conversion', description: line });
    }

    const skipReturn = (limitingFactor: ConversionLimitingFactor, description?: string): ConversionPlan => {
        if (description) {
            decisions.push({ category: 'conversion', description });
        }
        return {
            conversion: null,
            conversionTax: 0,
            taxSource: 'SURPLUS',
            additionalOrdinaryIncome: 0,
            decisions,
            bracketSpaceForSpending,
            taxOptimizationTarget: {
                yearsUntilRMD: Math.max(0, getRMDStartAge(input.year - input.currentAge) - input.currentAge),
                rmdStartAge: getRMDStartAge(input.year - input.currentAge),
                targetBracketCeiling: 0,
                bracketSpaceThisYear: 0,
                ssAtRMD: 0,
                pensionAtRMD: 0,
                currentTraditionalBalance: traditionalBalance,
                limitingFactor,
                actualConversion: 0,
            },
        };
    };

    if (!input.taxOptimizationEnabled || !input.isRetired) {
        // #159: never skip a SCHEDULED conversion silently — when the plan carries
        // an amount for this year, leave a decision-log entry saying why it was
        // not honored. (Working years normally route to solveWorkingYear, which
        // executes plan entries itself; this gate fires for tax-opt-off runs and
        // direct not-retired solves.)
        const scheduled = input.dpConversionPlan?.get(input.year) ?? 0;
        return skipReturn(
            !input.isRetired ? 'NOT_RETIRED' : 'OPTIMIZATION_DISABLED',
            scheduled > 0
                ? `Skipped scheduled Roth conversion of $${Math.round(scheduled).toLocaleString()}: ` +
                    (!input.isRetired ? 'not retired this year.' : 'tax optimization is disabled.')
                : undefined,
        );
    }
    if (traditionalBalance <= 0) {
        return skipReturn('TRADITIONAL_DEPLETED', 'Skipped Roth conversion: no Traditional balance available.');
    }

    // Spending-deficit reservation. Mirrors planConversion: when there's a
    // Roth-bound spending deficit (brokerage can't cover it) and we're not
    // penalized (age >= 59.5), reserve trad bracket space for direct
    // Traditional withdrawal — avoids the wasteful "convert → withdraw Roth
    // for spending" round-trip. Downstream in solveRetirementYear, a non-zero
    // bracketSpaceForSpending puts trad first (capped at the reservation).
    //
    // Gate uses the same conversion ceiling as rate-match (computed via
    // computeCeilingContext). When ceiling=0% (future RMDs land in 12% or
    // lower, no incentive to convert into a taxable bracket), reservation
    // only fires if first-dollar marginal is also 0% — preventing the
    // bracket-crossing $219k withdrawals at 22% marginal that the older
    // hardcoded-24% gate produced.
    const penaltyApplies = input.currentAge < 59.5;
    if (spendingDeficit > 0 && !penaltyApplies) {
        const { ceilingResult } = computeCeilingContext(
            input, baseOrdinaryIncome, socialSecurityBenefits, fedParams,
        );
        const conversionCeiling = ceilingResult.conversionCeiling;
        const bracketSpacePerYear = Math.max(0, ceilingResult.bracketSpacePerYear);

        const brokerageBalance = getTotalBrokerageBalance(input.accounts);
        const brokerageGainRatio = getBrokerageGainRatio(input.accounts);
        const ltcgRate = getLTCGRateForIncome(baseOrdinaryIncome, fedParams);
        const brokerageCoverage = brokerageBalance * (1 - brokerageGainRatio * ltcgRate);
        const rothBoundDeficit = Math.max(0, spendingDeficit - brokerageCoverage);

        if (rothBoundDeficit > 0 && bracketSpacePerYear > 0) {
            const marginalResult = TaxService.getMarginalTaxRate(
                Math.max(0, baseOrdinaryIncome - fedParams.standardDeduction),
                fedParams,
            );
            const stateRate = stateParams
                ? TaxService.getMarginalTaxRate(
                    Math.max(0, baseOrdinaryIncome - stateParams.standardDeduction),
                    stateParams,
                  ).rate
                : 0;

            const gateOk = marginalResult.rate <= conversionCeiling + 0.005;
            if (gateOk) {
                const totalEffectiveRate = marginalResult.rate + stateRate;
                const grossForDeficit = rothBoundDeficit / Math.max(0.5, 1 - totalEffectiveRate);
                bracketSpaceForSpending = Math.min(grossForDeficit, bracketSpacePerYear, traditionalBalance);

                // NOTE: an earlier "reserve-aware spending" experiment (#89 Change 2)
                // capped this reservation at the std-deduction 0% slice. It was removed:
                // the cap only ran here (brokerage already exhausted, rothBoundDeficit>0),
                // where trimming Trad spend can only push the gap onto tax-free Roth —
                // never wealth-optimal (Trad exits at a positive rate, Roth never does),
                // and the spend already passed gateOk (marginal ≤ the future RMD-age
                // ceiling). The bracket-aware terminal already prices the residual, so no
                // extra reservation cap is warranted.

                decisions.push({
                    category: 'conversion',
                    amount: bracketSpaceForSpending,
                    description: `Reserved $${Math.round(bracketSpaceForSpending).toLocaleString()} bracket space ` +
                        `for Traditional spending (Roth-bound deficit $${Math.round(rothBoundDeficit).toLocaleString()} ` +
                        `of $${Math.round(spendingDeficit).toLocaleString()} total, ` +
                        `brokerage covers $${Math.round(brokerageCoverage).toLocaleString()}, ` +
                        `marginal rate ${(marginalResult.rate * 100).toFixed(1)}% ` +
                        `vs ${(conversionCeiling * 100).toFixed(0)}% ceiling).`,
                });
            }
        }
    }

    // #164 display-fidelity counterfactual: "this exact year, but a $0
    // conversion". Keeps the spending reservation above (independent of the
    // conversion amount); skipReturn preserves bracketSpaceForSpending. Mirrors
    // the natural zero-plan path below.
    if (input.forceZeroConversion) {
        return skipReturn(bracketSpaceForSpending > 0 ? 'SPENDING_DEFICIT' : 'NO_BRACKET_SPACE');
    }

    // Look up the precomputed conversion amount. Clamp to (traditional - reserved
    // for spending) so the conversion doesn't compete with the spending withdrawal.
    const availableTradForConversion = Math.max(0, traditionalBalance - bracketSpaceForSpending);
    const plannedConversion = input.dpConversionPlan?.get(input.year) ?? 0;

    let targetConversion = plannedConversion;
    if (input.mcConversionPolicy) {
        // --- #98 closed-loop POLICY lookup (supersedes the #93 overlay) ------
        // The policy — solved ONCE by integrating the return distribution into the
        // DP — gives the optimal conversion as a function of (year, trad, roth)
        // state. Look it up at the path's REALIZED (Traditional, Roth IRA) balances:
        // a per-path re-optimization of BOTH the amount and whether to convert, with
        // no re-solve. Avoids the open-loop scaling failure modes (bull-path bracket
        // overrun, can't-add-conversion-years, trim-compounding drift). Non-anticipative:
        // the policy never sees a path's realized future, and these balances reflect only
        // returns realized through this year. Years without a policy entry (undefined)
        // keep the planned amount. (#169: pre-retirement GAP years have entries too,
        // consulted by solveWorkingYear's mirror of this lookup.)
        const rothBalance = getTotalRothBalance(input.accounts);
        const rawPolicy = lookupConversionPolicy(
            input.mcConversionPolicy, input.year, traditionalBalance, rothBalance);
        if (rawPolicy !== undefined) {
            targetConversion = Math.max(0, rawPolicy);
            // #89 MC over-conversion cap: bound the per-path policy at the deterministic
            // engine-search optimum — fill realized taxable income only to stdDed + capHeadroom —
            // so the stochastic policy can't over-convert past the validated peak on the low/no-SS
            // large-Traditional corner. Uses REALIZED non-SS ordinary income (incl. this path's
            // realized RMD), so the bound adapts per path. undefined capHeadroom (the legacy DP won
            // the deterministic search → policy already at/under the optimum, e.g. real-SS) ⇒ no cap.
            const capHeadroom = input.mcConversionPolicy.capHeadroom;
            if (capHeadroom !== undefined) {
                const capAmount = Math.max(0, fedParams.standardDeduction + capHeadroom - nonSSOrdinaryIncome);
                targetConversion = Math.min(targetConversion, capAmount);
            }
            if (targetConversion > 0) {
                decisions.push({
                    category: 'conversion',
                    description: `[#98 MC policy] realized Trad $${Math.round(traditionalBalance).toLocaleString()}, ` +
                        `Roth $${Math.round(rothBalance).toLocaleString()} → policy conversion ` +
                        `$${Math.round(targetConversion).toLocaleString()}.`,
                });
            }
        }
    }

    const conversionAmount = Math.max(0, Math.min(targetConversion, availableTradForConversion));

    if (conversionAmount <= 0) {
        // Spending reservation may still be nonzero — preserve it via skipReturn.
        return skipReturn(
            bracketSpaceForSpending > 0 ? 'SPENDING_DEFICIT' : 'NO_BRACKET_SPACE',
            `DP-precomputed conversion for year ${input.year}: $0 (no plan or zero amount).`,
        );
    }

    const sourceAccount = getFirstTraditionalAccount(input.accounts);
    const targetAccount = getFirstRothAccount(input.accounts);
    if (!sourceAccount || !targetAccount) {
        return skipReturn('TRADITIONAL_DEPLETED', 'Skipped DP conversion: no valid source or target account.');
    }

    const { conversionTax, conversionFedTax, conversionStateTax, taxSource } =
        computeConversionTaxAndSource(
            input, baseOrdinaryIncome, nonSSOrdinaryIncome, socialSecurityBenefits,
            conversionAmount, spendingDeficit, surplus, fedParams, stateParams,
        );

    const conversion: PlannedConversion = {
        amount: conversionAmount,
        fromAccountId: sourceAccount.id,
        toAccountId: targetAccount.id,
        taxSource,
        taxAmount: conversionTax,
        federalTaxCost: conversionFedTax,
        stateTaxCost: conversionStateTax,
        netToRoth: conversionAmount,
        reason: `DP-precomputed conversion of $${Math.round(conversionAmount).toLocaleString()}. Tax paid from ${taxSource.toLowerCase()}.`,
    };

    decisions.push({
        category: 'conversion',
        account: sourceAccount.name,
        amount: conversionAmount,
        description: `DP-planned: $${Math.round(conversionAmount).toLocaleString()} from ${sourceAccount.name} to Roth. Tax: $${Math.round(conversionTax).toLocaleString()} (${taxSource.toLowerCase()}).`,
    });

    const rmdStartAge = getRMDStartAge(input.year - input.currentAge);
    return {
        conversion,
        conversionTax,
        taxSource,
        additionalOrdinaryIncome: conversionAmount,
        decisions,
        bracketSpaceForSpending,
        taxOptimizationTarget: {
            yearsUntilRMD: Math.max(0, rmdStartAge - input.currentAge),
            rmdStartAge,
            targetBracketCeiling: 0,
            bracketSpaceThisYear: conversionAmount,
            ssAtRMD: 0,
            pensionAtRMD: 0,
            currentTraditionalBalance: traditionalBalance,
            limitingFactor: conversionAmount >= availableTradForConversion - 1
                ? 'TRADITIONAL_DEPLETED'
                : 'BRACKET_CEILING',
            actualConversion: conversionAmount,
        },
    };
}

// =============================================================================
// MAIN SOLVER
// =============================================================================

/**
 * Solve a retirement year.
 *
 * Flow:
 * 1. Classify income (spendable vs reinvested)
 * 2. Plan Roth conversion FIRST
 * 3. Calculate ordinary tax (with conversion)
 * 4. Calculate base deficit
 * 5. Plan withdrawals with algebraic gross-up
 * 6. Loop if bracket crossing (rare)
 * 7. Calculate surplus/deficit
 */
export function solveRetirementYear(input: YearSolverInput): YearPlan {
    const decisions: DecisionLogEntry[] = [];

    // Get tax parameters
    const rawFedParams = TaxService.getTaxParameters(
        input.year,
        input.taxState.filingStatus,
        'federal',
        undefined,
        input.assumptions
    );
    const stateParams = TaxService.getTaxParameters(
        input.year,
        input.taxState.filingStatus,
        'state',
        input.taxState.stateResidency,
        input.assumptions
    );

    if (!rawFedParams) {
        throw new Error(`No federal tax parameters for year ${input.year}`);
    }

    // Step A: Classify income (before conversion)
    const incomeClassification = classifyIncome(
        input.incomes,
        input.rmdAmount,
        0, // No conversion yet
        input.year
    );

    // Get SS benefits for taxability calculation
    const socialSecurityBenefits = getTotalSSBenefits(input.incomes, input.year);

    // ==========================================================================
    // GK GUARDRAILS: Determine effective spending target
    // ==========================================================================
    // When GK budget is provided, enforce spending caps:
    // - If fixed expenses > GK budget: use fixed expenses (can't cut fixed costs)
    // - If fixed expenses <= GK budget: use min(totalLivingExpenses, gkBudget)
    // - Log appropriate warnings and decisions
    let effectiveLivingExpenses = input.totalLivingExpenses;

    if (input.gkBudget !== undefined) {
        const gkBudget = input.gkBudget;
        const fixedExpenses = input.fixedExpenses ?? input.totalLivingExpenses;
        const discretionaryExpenses = input.discretionaryExpenses ?? 0;

        if (fixedExpenses > gkBudget) {
            // Fixed expenses exceed GK budget - eliminate discretionary but cover fixed
            effectiveLivingExpenses = fixedExpenses;

            // Log warning about fixed expenses exceeding guardrails budget
            decisions.push({
                category: 'warning',
                amount: fixedExpenses - gkBudget,
                description: `Fixed expenses ($${fixedExpenses.toLocaleString()}) exceed guardrails budget ($${gkBudget.toLocaleString()}). Discretionary spending eliminated.`,
            });

            // Log decision about discretionary elimination
            if (discretionaryExpenses > 0) {
                decisions.push({
                    category: 'spending',
                    amount: discretionaryExpenses,
                    description: `Discretionary expenses ($${discretionaryExpenses.toLocaleString()}) eliminated due to GK guardrails cap.`,
                });
            }
        } else {
            // GK budget can accommodate fixed expenses
            // Use the lesser of total requested expenses and GK budget
            effectiveLivingExpenses = Math.min(input.totalLivingExpenses, gkBudget);

            if (input.totalLivingExpenses > gkBudget) {
                // Need to trim discretionary
                const trimAmount = input.totalLivingExpenses - gkBudget;
                decisions.push({
                    category: 'spending',
                    amount: trimAmount,
                    description: `Discretionary expenses trimmed by $${trimAmount.toLocaleString()} to stay within GK budget of $${gkBudget.toLocaleString()}.`,
                });
            }
        }
    }

    // Calculate initial ordinary income (without conversion)
    // Include reinvested income - it's taxable even though it's not spendable
    const taxableBase = incomeClassification.classified.spendable + incomeClassification.classified.reinvested;
    const baseOrdinaryIncome =
        taxableBase -
        socialSecurityBenefits + // Remove SS, add back taxable portion
        TaxService.getTaxableSocialSecurityBenefits(
            socialSecurityBenefits,
            taxableBase - socialSecurityBenefits,
            0, // taxExemptInterest
            input.taxState.filingStatus
        );

    // #191: fold the federal 65+ senior deductions (permanent additional standard
    // deduction + OBBBA senior bonus) into the standard deduction for this year, so
    // every downstream tax / bracket-headroom / conversion-cap computation matches
    // the year-0 Taxes-tab orchestrator instead of taxing seniors on the raw
    // standard deduction. The engine only ever takes the standard path, so both
    // add-ons collapse into `standardDeduction`. `baseOrdinaryIncome` (non-SS
    // ordinary + taxable SS, pre-withdrawal) is the MAGI proxy for the bonus
    // phaseout — it excludes not-yet-known withdrawals/conversions/gains, matching
    // the situation the retiree enters the year in; the phaseout-free regular add-on
    // (the dominant dollar effect) is unaffected by the proxy's approximation.
    // Non-senior years (age < seniorAge) resolve to the raw standard deduction, so
    // working-age projections are byte-for-byte unchanged.
    const fedParams = {
        ...rawFedParams,
        standardDeduction: TaxService.getEffectiveStandardDeduction(
            rawFedParams,
            input.taxState.filingStatus,
            input.currentAge,
            input.year,
            baseOrdinaryIncome,
        ),
    };

    // Initial surplus estimate (for determining if conversion tax can be paid from surplus).
    // Note: classifyIncome adds rmdAmount to spendable, so we don't add it again here.
    const initialSurplusEstimate = Math.max(0,
        incomeClassification.classified.spendable -
        effectiveLivingExpenses
    );

    // Rough tax estimate for preliminary deficit (before conversion is known)
    const roughPreTaxDeductions = TaxService.getPreTaxExemptions(input.incomes, input.year, input.currentAge, true);
    const roughFedTax = TaxService.calculateTotalFederalTax(
        taxableBase - socialSecurityBenefits, // non-SS ordinary income (baseOrdinaryIncome holds taxable SS)
        socialSecurityBenefits,
        0, 0, // no STCG/LTCG
        roughPreTaxDeductions,
        input.taxState.filingStatus,
        fedParams
    ).totalTax;
    const roughStateTax = stateParams
        // State tax excludes Social Security (DC and all modeled states exempt
        // it), mirroring the authoritative state calc below. baseOrdinaryIncome
        // folds in taxable SS, so use the non-SS ordinary income — the same base
        // the rough federal calc above uses.
        ? TaxService.calculateTax(taxableBase - socialSecurityBenefits, roughPreTaxDeductions, stateParams)
        : 0;
    const roughFica = TaxService.calculateFicaTax(input.taxState, input.incomes, input.year, input.assumptions);
    const roughTax = roughFedTax + roughStateTax + roughFica;

    // Note: classifyIncome adds rmdAmount to spendable, so we don't subtract it again.
    const preliminaryDeficit = Math.max(0,
        effectiveLivingExpenses + roughTax -
        incomeClassification.classified.spendable
    );

    // Step B: Plan Roth conversion FIRST
    const conversionStrategy = selectConversionStrategy(
        input.assumptions.investments.rothConversionStrategy,
    );
    const conversionPlan = conversionStrategy(
        input,
        baseOrdinaryIncome,
        socialSecurityBenefits,
        // True non-SS ordinary income (excludes SS entirely). baseOrdinaryIncome
        // already folds in taxable SS, so it must NOT be reused where the federal
        // tax contract expects SS-free ordinary income (calculateTotalFederalTax /
        // calculateEffectiveConversionTax re-derive taxable SS internally).
        taxableBase - socialSecurityBenefits,
        fedParams,
        stateParams ?? null, // Convert undefined to null
        initialSurplusEstimate,
        preliminaryDeficit,
        effectiveLivingExpenses
    );
    decisions.push(...conversionPlan.decisions);

    // Update income classification with conversion
    const finalIncomeClassification = classifyIncome(
        input.incomes,
        input.rmdAmount,
        conversionPlan.additionalOrdinaryIncome,
        input.year
    );

    // Step C: Calculate ordinary tax (with conversion)
    //
    // Income views for tax computation:
    //   nonSSBaseIncome: all income EXCLUDING Social Security (stable base for iteration)
    //   allOrdinaryIncome: nonSS + conversion (used for state tax and planner — excludes SS)
    //   currentSSTaxable: taxable portion of SS, computed externally with Trad withdrawal
    //                     in combined income. Added to allOrdinaryIncome for federal tax only.
    //
    // Why separate? DC (and most states) exempts SS from state tax. The planner also needs
    // the state starting position without SS. Federal tax needs SS taxable in the income base.
    const nonSSBaseIncome = taxableBase - socialSecurityBenefits;
    const conversionAdded = conversionPlan.additionalOrdinaryIncome;

    // Initial SS taxable estimate (no Traditional withdrawal yet)
    let currentSSTaxable = TaxService.getTaxableSocialSecurityBenefits(
        socialSecurityBenefits,
        nonSSBaseIncome + conversionAdded,
        0,
        input.taxState.filingStatus
    );

    // allOrdinaryIncome: includes taxable SS. Used for federal tax and planner's federal bracket
    // positioning. For state tax (and planner's state brackets), currentSSTaxable is excluded
    // since DC and most states exempt SS from income tax.
    let allOrdinaryIncome = nonSSBaseIncome + currentSSTaxable + conversionAdded;

    // Calculate FICA (only on wages)
    const ficaTax = TaxService.calculateFicaTax(
        input.taxState,
        input.incomes,
        input.year,
        input.assumptions
    );

    // We'll calculate final tax after knowing withdrawals (for LTCG)

    // Step D: Calculate base deficit
    // Start with conservative estimate (no LTCG tax yet)
    const preTaxDeductions = TaxService.getPreTaxExemptions(input.incomes, input.year, input.currentAge, true);

    // Step D+E: Iterative LTCG-aware deficit and withdrawal planning
    //
    // We use calculateTotalFederalTax() with bracket-stacked LTCG as the authoritative
    // tax source. The planner's flat-rate gross-up is kept as-is for withdrawal sizing.
    // We iterate because:
    //   - Total tax (including LTCG) affects the deficit
    //   - LTCG depends on withdrawal amount (which depends on deficit)
    //   - Converges in 2-3 iterations since LTCG tax is a fraction of total withdrawal

    let withdrawals: PlannedWithdrawal[] = [];
    let withdrawalOrdinaryTax = 0;
    let withdrawalDecisions: DecisionLogEntry[] = [];
    let totalPenalties = 0;
    let iterations = 0;
    let converged = false;

    if (input.rmdAmount > 0) {
        // Find Traditional accounts for RMD source
        const tradAccount = getFirstTraditionalAccount(input.accounts);
        if (tradAccount) {
            withdrawals.push({
                source: tradAccount.taxType === 'Traditional 401k' ? 'traditional_401k' : 'traditional_ira',
                accountId: tradAccount.id,
                accountName: tradAccount.name,
                gross: input.rmdAmount,
                net: input.rmdAmount, // RMD tax is on the income side, not withheld
                penalty: 0,
                tax: 0,
                reason: 'Required Minimum Distribution',
            });

            decisions.push({
                category: 'rmd',
                account: tradAccount.name,
                amount: input.rmdAmount,
                description: `RMD of $${input.rmdAmount.toLocaleString()} from ${tradAccount.name}.`,
            });
        }
    }

    // Create account snapshots in withdrawal order (before the loop - these don't change)
    // includeUnorderedSellable=true: in a retirement drawdown, also reach any sellable
    // account the withdrawal ORDER omits (e.g. a Traditional balance ignored by a Roth-only
    // order) so a real spending shortfall taps it instead of fabricating deficit debt.
    //
    // Two distinct cases use this:
    //   • Under TAX OPTIMIZATION the algorithm OWNS the order — the manual order and any
    //     account exclusions don't bind, so the optimizer already folds every sellable account
    //     into the order it scores and runs (useSimulation's joint optimizer; see
    //     withAllSellableAccounts). For that path `input.withdrawalOrder` already lists every
    //     sellable account, so this flag is a no-op there.
    //   • For the NON-tax-opt MANUAL-order path, the user's order is honored as-is and an
    //     order-omitted account would otherwise never be tapped; this flag is the SAFETY NET
    //     (#111) that lets a genuine shortfall reach it rather than borrowing.
    //
    // The working-year path (solveWorkingYear) honors the literal order the same way (Tax Opt
    // off) but keeps includeUnorderedSellable OFF — its initialDeficit conflates tax with
    // spending and the #111 safety-net tier would mishandle RSU withholding (#114). No-op when
    // the order already lists every account (the golden masters and all scenarios).
    // honorLiteralOrder only when the USER owns the order (Tax Opt off). When Tax Opt
    // is on the optimizer owns it and keeps its penalty-aware execution — the order it
    // SCORES must match how it RUNS, so its picks stay stable (#154). On that
    // optimizer-owned path savings leads the non-penalized tier (#161, per
    // WITHDRAWAL_TAX_RANK) so idle cash deploys for living expenses instead of
    // waiting for a big-tax year to force it out.
    let accountSnapshots = createOrderedSnapshots(
        input.accounts, input.withdrawalOrder, input.currentAge, input.year, true, !input.taxOptimizationEnabled,
    );

    // Keep reserved goal sinking-fund accounts out of the general drawdown until
    // everything else is exhausted. A goal fund accumulates committed deposits the
    // engine credits directly; draining it for general living expenses means the
    // goal can't be funded at its due year.
    //
    // The prior guard only dropped a reserved account when it was NOT an explicit
    // member of the user's order — but the app-wide reconciler syncs EVERY eligible
    // account into withdrawalStrategy (the withdrawal-order UI is reorder-only; an
    // account can't be removed), so a reserved goal fund is ALWAYS in the order and
    // the guard never fired. Result: tax-opt drained the goal fund first while other
    // accounts sat untouched. Fix: move reserved accounts to the END of the drawdown
    // (last-resort) regardless of order membership, so a genuine total shortfall can
    // still reach them (avoiding fabricated deficit debt) but they're never tapped
    // for living expenses while any non-reserved balance remains.
    if (input.reservedAccountIds && input.reservedAccountIds.length > 0) {
        const reserved = new Set(input.reservedAccountIds);
        const nonReserved = accountSnapshots.filter(s => !reserved.has(s.accountId));
        const reservedSnapshots = accountSnapshots.filter(s => reserved.has(s.accountId));
        accountSnapshots = [...nonReserved, ...reservedSnapshots];
    }

    // Reserve the RMD against the account(s) it draws from. RMDService drains each
    // RMD-subject Traditional account by its OWN required distribution (recorded as a
    // negative userInflow, applied later by growAccounts), but createOrderedSnapshots
    // reads the raw balance, so without this the discretionary planner could plan to
    // withdraw dollars the RMD already took — over-draining the account and surfacing
    // phantom spendable cash. Reserve PER ACCOUNT (not the whole RMD against the first
    // Traditional account): with two Traditional accounts, reserving the total against
    // account A alone under-reserved account B (the actual draw source) and stranded
    // balance in A.
    if (input.rmdAmount > 0) {
        const perAccountRMD = computePerAccountRMD(input.accounts, input.previousSimulation, input.currentAge);
        if (perAccountRMD.size > 0) {
            accountSnapshots = accountSnapshots.map(s => {
                const reserved = perAccountRMD.get(s.accountId);
                return reserved
                    ? { ...s, vestedBalance: Math.max(0, s.vestedBalance - reserved) }
                    : s;
            });
        }
    }

    if (conversionPlan.bracketSpaceForSpending > 0) {
        // Tax-optimized order: put capped Traditional first, then normal order
        const allSnapshots = accountSnapshots;
        const tradSnapshots: typeof allSnapshots = [];
        const otherSnapshots: typeof allSnapshots = [];
        let remainingCap = conversionPlan.bracketSpaceForSpending;

        for (const s of allSnapshots) {
            if ((s.accountType === 'traditional_401k' || s.accountType === 'traditional_ira')
                && remainingCap > 0) {
                const capped = Math.min(s.vestedBalance, remainingCap);
                tradSnapshots.push({ ...s, vestedBalance: capped });
                remainingCap -= capped;
                const remainder = s.vestedBalance - capped;
                if (remainder > 0) {
                    otherSnapshots.push({ ...s, vestedBalance: remainder });
                }
            } else {
                otherSnapshots.push(s);
            }
        }

        accountSnapshots = [...tradSnapshots, ...otherSnapshots];

        decisions.push({
            category: 'withdrawal',
            description: `Tax-optimized order: Traditional first ` +
                `(cap $${Math.round(conversionPlan.bracketSpaceForSpending).toLocaleString()}) ` +
                `then normal order.`,
        });
    }

    // ACA cliff context. The threshold is fixed; the MAGI base is not.
    //
    // Bug #10: currentMAGI must reflect ALL income realized this year, but the
    // Traditional spending withdrawal (ordinary income) and the brokerage LTCG are
    // both produced by the deficit loop below — they aren't known here. The base
    // MAGI is therefore everything EXCEPT those loop-produced amounts:
    //   base = taxableBase (incl. 100% SS) + conversion.
    // The planner already layers its own brokerage LTCG onto currentMAGI internally
    // (cumulativeLTCG + actualLTCG), so we must NOT add LTCG here. But the planner
    // does NOT know about the Traditional withdrawal, so we feed the running
    // estimatedTradWithdrawal into currentMAGI each iteration. Without it the cliff
    // guard under-counts MAGI by the Traditional draw and can blow past the cliff.
    const acaCliffActive = input.acaAware && input.currentAge < 65;
    const acaCliffThreshold = acaCliffActive
        ? getAcaCliffThreshold(
            input.taxState.filingStatus === 'Married Filing Jointly' ? 'married_filing_jointly' : 'single',
            input.year
        )
        : 0;
    const acaBaseMAGI = taxableBase + conversionPlan.additionalOrdinaryIncome;

    // Medicare IRMAA surcharge (2-year lookback). Year N's Part B/D premiums are
    // surcharged based on year N-2's MAGI; only beneficiaries on Medicare (age
    // 65+) pay it. The lookback MAGI is FIXED before this year's withdrawals, so
    // we treat the surcharge as a known cash cost: it's folded into the deficit
    // (so withdrawals cover it) and into the year's total tax. A conversion this
    // year raises THIS year's MAGI, which feeds year N+2's surcharge via the
    // stored MAGI — no within-year circularity. baseOrdinaryIncome is the
    // income-side self-proxy used only for the very first simulated year, when no
    // prior-year MAGI exists at all.
    const irmaaSurcharge = computeIrmaaForYear(input, baseOrdinaryIncome, decisions);

    // ACA subsidy repayment (F1): a pre-65 retirement year whose ACA MAGI
    // (100%-of-SS base + conversion + deficit-funding withdrawals + realized
    // gains) reaches the 400%-FPL cliff loses the marketplace premium subsidy —
    // a REAL cash cost, charged like IRMAA: folded into the deficit (so
    // withdrawals cover it) and into the year's total tax. Recomputed each
    // iteration alongside the MAGI drivers (Trad withdrawal / ESPP / LTCG /
    // STCG); those only grow with the deficit, so the cliff test is monotone
    // and converges with the loop. The searches (rate-match clamp, DP shadow
    // penalty, withdrawal-planner steering) still AVOID the cliff; this prices
    // the years where the plan crosses it anyway, so the engine-direct
    // optimizer's judge no longer scores crossings at $0.
    const acaEstimatedSubsidyLoss =
        input.assumptions.investments.acaAnnualSubsidyLoss ?? ACA_SUBSIDY_LOSS_DEFAULT;
    let acaSubsidyRepayment = 0;
    let acaMagiEstimate = 0;

    // Iterative deficit loop: converges on LTCG and SS taxability.
    //
    // Two circular dependencies resolved by iteration:
    //   1. LTCG depends on withdrawal → withdrawal depends on deficit → deficit depends on LTCG tax
    //   2. SS taxable depends on combined income (includes Traditional withdrawal) →
    //      fed tax depends on SS taxable → deficit depends on fed → withdrawal depends on deficit
    //
    // Architecture: calculateTotalFederalTax() computes SS taxable internally from provisional
    // income. But its ordinaryTax covers ALL income passed in (including Traditional withdrawal),
    // while withdrawalOrdinaryTax from the planner separately covers the withdrawal tax.
    // To avoid double-counting, we compute SS taxable EXTERNALLY (with Traditional withdrawal
    // in combined income) and pass SS=0 to calculateTotalFederalTax(), with the pre-computed
    // taxable SS baked into allOrdinaryIncome. This way the function computes tax only on
    // base income + taxable SS, and the planner handles withdrawal tax separately.
    //
    // Convergence: SS taxable is piecewise-linear and monotonic, so 2-4 iterations.
    let estimatedLTCG = 0;
    let estimatedSTCG = 0;
    let estimatedTradWithdrawal = 0;
    let estimatedESPPOrdinaryIncome = 0;

    // Realized short-term capital gains (RSU lots sold <1yr from vest) are taxed
    // as ordinary income by the planner (reported via withdrawalOrdinaryTax), so
    // we must NOT let calculateTotalFederalTax re-charge that ordinary tax. But
    // positive STCG still (a) stacks under LTCG for cap-gains bracket placement,
    // (b) feeds NIIT, and (c) feeds SS-taxability and MAGI. We therefore pass STCG
    // into the federal helper for those effects and subtract the STCG-induced
    // ordinary-tax delta so it isn't double-counted against the planner's
    // withdrawalOrdinaryTax. A realized STCG LOSS is handled entirely by the
    // planner (capped at the $3,000 annual limit), so it contributes nothing here
    // — clamp at 0. Mirrors solveWorkingYear, which feeds realizedSTCG into NIIT/MAGI.
    const stcgForFederal = (stcg: number): number => Math.max(0, stcg);
    const stcgOrdinaryTaxDelta = (stcg: number): number => {
        const positive = stcgForFederal(stcg);
        if (positive === 0) return 0;
        const withSTCG = TaxService.calculateTotalFederalTax(
            allOrdinaryIncome, 0, positive, 0, preTaxDeductions, input.taxState.filingStatus, fedParams,
        ).ordinaryTax;
        const withoutSTCG = TaxService.calculateTotalFederalTax(
            allOrdinaryIncome, 0, 0, 0, preTaxDeductions, input.taxState.filingStatus, fedParams,
        ).ordinaryTax;
        return withSTCG - withoutSTCG;
    };

    // Initial federal tax: SS taxable computed without Traditional withdrawal
    // Pass allOrdinaryIncome (which includes taxable SS) with SS=0 to skip internal SS calc
    let finalFedResult = TaxService.calculateTotalFederalTax(
        allOrdinaryIncome, // nonSS + taxableSS + conversion (SS pre-computed externally)
        0, // SS=0: taxable SS already in allOrdinaryIncome
        0, // STCG
        0, // LTCG - not known yet
        preTaxDeductions,
        input.taxState.filingStatus,
        fedParams
    );
    // State tax: exclude SS taxable (DC and most states exempt SS from income tax)
    // State tax on the Traditional withdrawal is in withdrawalOrdinaryTax from the planner.
    // `+ estimatedLTCG` keeps this textually identical to the in-loop recompute below;
    // it is always 0 here (no withdrawals planned yet), and every loop exit that has
    // planned withdrawals goes through the in-loop recompute or converged with
    // ltcgDelta < $1, so this baseline can never be left stale with material LTCG.
    let finalStateTax = stateParams
        ? TaxService.calculateTax(allOrdinaryIncome - currentSSTaxable + estimatedLTCG, preTaxDeductions, stateParams)
        : 0;

    const MAX_ITERATIONS = 10;
    for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
        if (iter > 0) {
            // Recompute SS taxable with Traditional withdrawal in combined income.
            // IRS combined income = AGI excluding SS + 50% × SS.
            // AGI excluding SS includes: base income + conversion + Trad withdrawal + LTCG.
            const updatedSSTaxable = TaxService.getTaxableSocialSecurityBenefits(
                socialSecurityBenefits,
                nonSSBaseIncome + conversionAdded + estimatedTradWithdrawal + estimatedESPPOrdinaryIncome + estimatedLTCG + stcgForFederal(estimatedSTCG),
                0,
                input.taxState.filingStatus
            );

            // Update SS taxable and allOrdinaryIncome
            currentSSTaxable = updatedSSTaxable;
            allOrdinaryIncome = nonSSBaseIncome + currentSSTaxable + conversionAdded;

            // Federal tax: allOrdinaryIncome includes taxable SS, pass SS=0.
            // STCG is included so NIIT and the LTCG bracket-stack see it; its
            // ordinary-tax portion is backed out below (planner already charges it).
            finalFedResult = TaxService.calculateTotalFederalTax(
                allOrdinaryIncome,
                0, // SS=0: taxable SS already in allOrdinaryIncome
                stcgForFederal(estimatedSTCG),
                estimatedLTCG,
                preTaxDeductions,
                input.taxState.filingStatus,
                fedParams
            );

            // State tax: exclude SS taxable (DC and most states exempt SS).
            // Include both LTCG and STCG in base (states tax gains as ordinary
            // income). STCG state tax is the planner's, so this base only sets
            // bracket position; the planner's withdrawalOrdinaryTax carries the
            // STCG state tax. To avoid double-counting we leave STCG out of the
            // state base (the planner already positioned it via runningOrdinaryIncome).
            finalStateTax = stateParams
                ? TaxService.calculateTax(allOrdinaryIncome - currentSSTaxable + estimatedLTCG, preTaxDeductions, stateParams)
                : 0;
        }

        // Authoritative federal tax EXCLUDING the STCG ordinary tax (the planner
        // charges that via withdrawalOrdinaryTax / its gross-up). NIIT and the
        // LTCG bracket-stack effect of STCG are retained.
        const fedTaxExStcgOrdinary = finalFedResult.totalTax - stcgOrdinaryTaxDelta(estimatedSTCG);

        // ACA cliff check with this iteration's MAGI drivers. Uses the same MAGI
        // base as the withdrawal planner's cliff guard (acaBaseMAGI, incl. 100%
        // of SS) plus the loop-produced income the guard layers on internally.
        if (acaCliffActive) {
            acaMagiEstimate = acaBaseMAGI + estimatedTradWithdrawal +
                estimatedESPPOrdinaryIncome + estimatedLTCG + stcgForFederal(estimatedSTCG);
            acaSubsidyRepayment = acaMagiEstimate >= acaCliffThreshold ? acaEstimatedSubsidyLoss : 0;
        }

        // Deficit includes authoritative LTCG tax (via fedTaxExStcgOrdinary).
        // Note: classifyIncome adds rmdAmount to spendable, so we don't subtract it again.
        const deficit =
            effectiveLivingExpenses +
            fedTaxExStcgOrdinary +
            finalStateTax +
            ficaTax +
            irmaaSurcharge +
            acaSubsidyRepayment -
            incomeClassification.classified.spendable;

        if (deficit <= 0) {
            // Surplus year: nothing to solve, this is a genuine (converged) outcome.
            converged = true;
            break;
        }

        // Per-iteration ACA options (Bug #10): roll the running Traditional
        // withdrawal into currentMAGI so the planner's cliff guard sees the
        // ordinary income this loop realizes. estimatedTradWithdrawal is the prior
        // iteration's value (0 on the first pass) and converges alongside LTCG.
        //
        // Also roll in estimatedESPPOrdinaryIncome: the ESPP bargain element is
        // ordinary income the subsidy-repayment check below (acaMagiEstimate) counts,
        // and the planner needs it in currentMAGI so an ESPP sale that comes AFTER the
        // brokerage in the withdrawal order (not yet reflected in the planner's own
        // cumulativeOrdinaryFromSales when the brokerage cliff guard runs) still steers
        // the brokerage cap. For an ESPP-BEFORE-brokerage order the planner DOES layer
        // the same bargain element into cumulativeOrdinaryFromSales (#176), which would
        // double-count it against this currentMAGI seed — so we hand the planner
        // esppOrdinaryInMAGI and it backs out the overlap (min of the two), counting the
        // bargain element exactly once for BOTH orders. NOTE: the subsidy BILLING
        // (acaMagiEstimate, above) is computed independently and single-counts correctly
        // — do not fold this de-dupe into it.
        const acaWithdrawalOpts = acaCliffActive
            ? {
                acaCliffThreshold,
                currentMAGI: acaBaseMAGI + estimatedTradWithdrawal + estimatedESPPOrdinaryIncome,
                esppOrdinaryInMAGI: estimatedESPPOrdinaryIncome,
            }
            : undefined;

        // Plan withdrawals - planner uses allOrdinaryIncome as starting income position
        // Pass currentSSTaxable as stateExemptIncome so the planner excludes it from
        // state bracket positioning (DC and most states exempt SS from income tax)
        const withdrawalResult = planWithdrawals(
            deficit,
            accountSnapshots,
            input.currentAge,
            input.year,
            input.taxState,
            allOrdinaryIncome,
            input.assumptions,
            'Spending deficit',
            acaWithdrawalOpts,
            currentSSTaxable
        );

        // Update tracking variables from this iteration
        withdrawals = [
            ...withdrawals.filter(w => w.reason === 'Required Minimum Distribution'), // Keep RMD
            ...withdrawalResult.withdrawals,
        ];
        // Ordinary withdrawal tax = the full tax of ordinary-only withdrawals
        // (Traditional/HSA/Roth, capitalGains undefined) PLUS the ordinary
        // portion of mixed withdrawals (ESPP bargain element, ordinaryTax set).
        withdrawalOrdinaryTax = ordinaryTaxOf(withdrawalResult.withdrawals);
        totalPenalties = withdrawalResult.totalPenalties;
        withdrawalDecisions = withdrawalResult.decisions;
        iterations = iter + 1;


        // Extract Traditional spending withdrawal (exclude RMDs — already in nonSSBaseIncome)
        const newTradWithdrawal = withdrawalResult.withdrawals
            .filter(w => w.source === 'traditional_401k' || w.source === 'traditional_ira')
            .reduce((sum, w) => sum + w.gross, 0);

        // ESPP bargain-element ordinary income drives SS taxability like a
        // Traditional withdrawal. Its tax is reported via withdrawalOrdinaryTax,
        // so it is NOT folded into allOrdinaryIncome's federal base (which would
        // double-count the tax) — only into the SS-taxability combined income.
        const newESPPOrdinaryIncome = withdrawalResult.withdrawals
            .reduce((sum, w) => sum + (w.ordinaryIncome ?? 0), 0);

        // Check convergence: LTCG, the Traditional withdrawal, and the ESPP
        // bargain element (all three drive SS taxability) must stabilize. An
        // exit while the ESPP estimate is still moving would leave the final SS
        // taxability (and the taxes/deficit derived from it) one iteration
        // behind the withdrawals that were sized from it.
        const newLTCG = withdrawalResult.totalLTCG;
        const newSTCG = withdrawalResult.totalSTCG;
        const ltcgDelta = Math.abs(newLTCG - estimatedLTCG);
        const stcgDelta = Math.abs(newSTCG - estimatedSTCG);
        const tradDelta = Math.abs(newTradWithdrawal - estimatedTradWithdrawal);
        const esppDelta = Math.abs(newESPPOrdinaryIncome - estimatedESPPOrdinaryIncome);
        estimatedLTCG = newLTCG;
        estimatedSTCG = newSTCG;
        estimatedTradWithdrawal = newTradWithdrawal;
        estimatedESPPOrdinaryIncome = newESPPOrdinaryIncome;

        if (ltcgDelta < 1 && stcgDelta < 1 && tradDelta < 1 && esppDelta < 1) {
            converged = true;
            break;
        }
    }

    // DO NOT recompute tax after the loop with plan.totalLTCG.
    // The withdrawal was sized for the deficit computed from finalFedResult/finalStateTax.
    // Recomputing with the planner's actual LTCG (which differs by up to the convergence
    // threshold from estimatedLTCG) would create a mismatch between reported taxes and
    // withdrawal amount, causing Sankey balance leaks.

    decisions.push(...withdrawalDecisions);

    // RMD shortfall excise (Bug #4). When RMDService couldn't fully satisfy a
    // required distribution, it computed a 25% penalty on the shortfall. It is an
    // excise paid in cash with no offsetting distribution, so fold it into the
    // year's penalties: this flows into totalTax (below) → cashOut, reducing the
    // surplus / increasing the deficit, and surfaces in the tax summary's
    // penalties line. Without this the computed penalty had zero financial effect.
    const rmdPenalty = input.rmdPenalty ?? 0;
    if (rmdPenalty > 0) {
        totalPenalties += rmdPenalty;
        decisions.push({
            category: 'rmd',
            amount: rmdPenalty,
            description: `RMD shortfall excise: $${Math.round(rmdPenalty).toLocaleString()} (25% of unmet required distribution).`,
        });
    }

    // Step F: Calculate final surplus using authoritative tax values.
    // Exclude RMD entries from totalGrossWithdrawals — RMD is already in spendable
    // (classifyIncome puts it there) and including it here would double-count cash in.
    const totalGrossWithdrawals = withdrawals
        .filter(w => w.reason !== 'Required Minimum Distribution')
        .reduce((sum, w) => sum + w.gross, 0);

    // Authoritative federal tax with the STCG ordinary portion backed out (the
    // planner charges RSU STCG ordinary tax via withdrawalOrdinaryTax). NIIT and
    // the LTCG bracket-stack effect of STCG remain in finalFedResult.
    const finalFedTaxExStcgOrdinary = finalFedResult.totalTax - stcgOrdinaryTaxDelta(estimatedSTCG);

    // Total tax uses authoritative federal (ordinary + LTCG + NIIT, less STCG
    // ordinary which the planner carries) + state (with LTCG) + withdrawal
    // ordinary tax (Roth 5-year, Traditional, HSA, RSU STCG) + FICA + penalties
    // + Medicare IRMAA surcharge (from year N-2 MAGI) + ACA subsidy repayment
    // (pre-65 cliff crossing).
    const totalTax = finalFedTaxExStcgOrdinary + finalStateTax + withdrawalOrdinaryTax + ficaTax + totalPenalties + irmaaSurcharge + acaSubsidyRepayment;

    if (acaSubsidyRepayment > 0) {
        decisions.push({
            category: 'tax',
            amount: acaSubsidyRepayment,
            description: `ACA subsidy lost: $${Math.round(acaSubsidyRepayment).toLocaleString()} ` +
                `(MAGI $${Math.round(acaMagiEstimate).toLocaleString()} crossed the 400% FPL cliff ` +
                `$${Math.round(acaCliffThreshold).toLocaleString()} before age 65).`,
        });
    }

    // =========================================================================
    // #164: Display-fidelity conversion tax cost (reporting only)
    // =========================================================================
    // The planning-time estimate (computeConversionTaxAndSource) prices the
    // conversion's LTCG-bump from the ACCOUNT-AVERAGE brokerage gain ratio and
    // ignores the extra brokerage sale that funds the conversion tax itself —
    // but the withdrawal planner realizes gains FIFO oldest-lot-first, so in
    // brokerage-funded years the displayed cost understated the truth. Re-solve
    // this exact year with the conversion forced to $0 and report the finite
    // difference (total tax with − total tax without) as the conversion's tax
    // cost. Everything decided above — conversion amount, tax source,
    // withdrawals, taxes, cashflows — is final and untouched; only the reported
    // PlannedConversion.taxAmount (and its fed/state decomposition) changes.
    // Nothing decision-side reads it (the DP / engine-direct search score
    // timelines on balances and `rothConversion.amount` only).
    //
    // Skipped on hot non-display paths, where the estimate was never surfaced:
    //   • forceZeroConversion — the counterfactual itself (no recursion);
    //   • mcConversionPolicy — MC per-path solves (the aggregator reads only
    //     `amount`; also keeps #98 MC golden masters byte-identical);
    //   • conversionMode 'std-ded-only' — the O(years²) baseline sub-sims
    //     (consumed via BaselineProjections, which carries no tax costs);
    //   • skipDisplayRefinement — candidate-scoring runs (#170), whose
    //     timelines never reach the UI.
    if (
        conversionPlan.conversion &&
        conversionPlan.conversion.amount > 0 &&
        !input.forceZeroConversion &&
        !input.skipDisplayRefinement &&
        !input.mcConversionPolicy &&
        input.conversionMode !== 'std-ded-only'
    ) {
        const counterfactual = solveRetirementYear({ ...input, forceZeroConversion: true });
        const estimatedTaxCost = conversionPlan.conversion.taxAmount;
        const trueTaxCost = Math.max(0, totalTax - counterfactual.tax.total);
        // Decomposition: the solver-side state delta is exact; the planner's
        // withdrawalOrdinaryTax delta (a fed+state blend on Traditional draws)
        // lands in the federal component, so fed + state always equals taxAmount.
        const stateDelta = Math.min(trueTaxCost, Math.max(0, finalStateTax - counterfactual.tax.state));
        conversionPlan.conversion.taxAmount = trueTaxCost;
        conversionPlan.conversion.stateTaxCost = stateDelta;
        conversionPlan.conversion.federalTaxCost = trueTaxCost - stateDelta;
        if (Math.abs(trueTaxCost - estimatedTaxCost) > 0.5) {
            decisions.push({
                category: 'conversion',
                amount: trueTaxCost,
                description: `Conversion tax cost (display): $${Math.round(trueTaxCost).toLocaleString()} — ` +
                    `this year's total tax minus a no-conversion re-solve's ` +
                    `($${Math.round(counterfactual.tax.total).toLocaleString()}); ` +
                    `sizing-time estimate was $${Math.round(estimatedTaxCost).toLocaleString()}.`,
            });
        }
    }

    // The year's MAGI (≈ AGI) — stored so year N+2 can read it for its IRMAA
    // lookback. Equals all ordinary income (incl. taxable SS + conversion) plus the
    // deficit-funding Traditional withdrawal, ESPP bargain element, and realized
    // capital gains (long- AND short-term). (Tax-exempt interest, the only
    // AGI→MAGI add-back, isn't tracked yet.)
    const yearMAGI = Math.max(0,
        allOrdinaryIncome + estimatedTradWithdrawal + estimatedESPPOrdinaryIncome + estimatedLTCG + stcgForFederal(estimatedSTCG));

    // Final cash flow.
    // LTCG tax is a pass-through: brokerage gross-up pays it directly to the government.
    // The deficit already included LTCG (via finalFedResult.totalTax), so the gross withdrawal
    // is deficit + ltcgTax. Counting that full gross as spendable cash-in would create a phantom
    // surplus equal to ltcgTax. Subtract it so only the net (post-tax) portion is cash-in.
    // LTCG pass-through tax = the LTCG portion of capital-gains withdrawals.
    // For ESPP, exclude the bargain-element ordinary tax (ordinaryTax) — that is
    // reported via withdrawalOrdinaryTax, not subtracted from cash-in here.
    const actualLTCGTax = ltcgTaxOf(withdrawals);

    const cashIn =
        incomeClassification.classified.spendable +
        totalGrossWithdrawals -
        actualLTCGTax;

    const cashOut =
        effectiveLivingExpenses +
        totalTax;

    const surplus = Math.max(0, cashIn - cashOut);
    const rawDeficit = cashOut - cashIn;
    const unfundedDeficit = rawDeficit < 0.01 ? 0 : rawDeficit;

    if (unfundedDeficit > 0) {
        decisions.push({
            category: 'warning',
            amount: unfundedDeficit,
            description: `Unfunded deficit of $${unfundedDeficit.toLocaleString()}. Insufficient account balances.`,
        });
    }

    // Build tax summary with authoritative values
    // federal: ordinaryTax only (LTCG and NIIT are separate line items)
    // state: includes LTCG in income base (DC and most states tax gains as ordinary)
    // capitalGainsLT: authoritative bracket-stacked LTCG tax from calculateTotalFederalTax
    // niit: from calculateTotalFederalTax (3.8% on investment income above threshold)
    const taxSummary: YearPlanTax = {
        // Back out the STCG ordinary tax — it's reported under withdrawalOrdinaryTax
        // (planner), so leaving it in finalFedResult.ordinaryTax would double-show it.
        federal: finalFedResult.ordinaryTax - stcgOrdinaryTaxDelta(estimatedSTCG),
        state: finalStateTax,
        fica: ficaTax,
        capitalGainsLT: finalFedResult.ltcgTax,
        // RSU short-term gains are taxed at ordinary rates and reported via
        // withdrawalOrdinaryTax (not here) to keep the component fields summing
        // to `total` without double-counting.
        capitalGainsST: 0,
        withdrawalOrdinaryTax,
        niit: finalFedResult.niitTax,
        irmaa: irmaaSurcharge,
        aca: acaSubsidyRepayment,
        penalties: totalPenalties,
        total: totalTax,
    };

    // Step G: Allocate surplus (if any)
    let surplusAllocations: YearPlan['surplusAllocations'] = [];
    let surplusDeficitDebtPayment = 0;
    if (surplus > 0) {
        const priorityBuckets = (input.assumptions.priorities || []).map((p, idx) => ({
            accountId: p.accountId || '',
            priority: idx,
            capType: p.capType,
            capValue: p.capValue,
        })).filter(p => p.accountId);

        const earnedIncome = TaxService.getEarnedIncome(input.incomes, input.year);
        const surplusSettings: SurplusAllocationSettings = {
            emergencyFundTarget: DEFAULT_EMERGENCY_FUND_TARGET,
            rothIRAContributionEnabled: true,
            rothIRALimit: getIRALimit(input.year, input.currentAge, input.assumptions.macro.inflationAdjusted),
            rothIRAContributedThisYear: 0,
            monthlyExpenses: effectiveLivingExpenses / 12,
            reservedAccountIds: input.reservedAccountIds ? new Set(input.reservedAccountIds) : undefined,
            // #60: cap each debt bucket at its linked loan's current balance.
            debtPaydownCaps: buildDebtPaydownCaps(input.accounts, input.expenses),
        };

        const surplusResult = allocateSurplus(
            surplus,
            input.accounts,
            priorityBuckets,
            earnedIncome,
            surplusSettings
        );

        surplusAllocations = surplusResult.allocations;
        surplusDeficitDebtPayment = surplusResult.deficitDebtPayment;
        decisions.push(...surplusResult.decisions);
    }

    return {
        year: input.year,
        isRetired: input.isRetired,
        income: finalIncomeClassification.classified,
        withdrawals,
        conversion: conversionPlan.conversion,
        contributions: [], // No contributions in retirement
        surplusAllocations,
        deficitDebtPayment: surplusDeficitDebtPayment,
        tax: taxSummary,
        magi: yearMAGI,
        surplus,
        unfundedDeficit,
        totalExpenses: effectiveLivingExpenses,
        strategyResult: input.strategyResult,
        iterations,
        converged,
        decisions,
        taxOptimizationTarget: conversionPlan.taxOptimizationTarget,
    };
}

/**
 * Solve a working year (no conversions, but withdrawals occur if income < expenses).
 */
export function solveWorkingYear(input: YearSolverInput): YearPlan {
    const decisions: DecisionLogEntry[] = [];

    // Get tax parameters
    const rawFedParams = TaxService.getTaxParameters(
        input.year,
        input.taxState.filingStatus,
        'federal',
        undefined,
        input.assumptions
    );
    const stateParams = TaxService.getTaxParameters(
        input.year,
        input.taxState.filingStatus,
        'state',
        input.taxState.stateResidency,
        input.assumptions
    );

    if (!rawFedParams) {
        throw new Error(`No federal tax parameters for year ${input.year}`);
    }

    // Classify income
    const incomeClassification = classifyIncome(
        input.incomes,
        0, // No RMD
        0, // No conversion
        input.year
    );

    // Calculate deductions
    const preTaxDeductions = TaxService.getPreTaxExemptions(input.incomes, input.year, input.currentAge, true);
    const postTaxDeductions = TaxService.getPostTaxExemptions(input.incomes, input.year, input.currentAge, true);
    const socialSecurityBenefits = getTotalSSBenefits(input.incomes, input.year);

    // Include reinvested income in tax base - it's taxable even though it's not spendable
    const taxableOrdinaryBase = incomeClassification.classified.spendable + incomeClassification.classified.reinvested;

    // #191: fold the federal 65+ senior deductions into the standard deduction (see
    // the matching note in solveRetirementYear). Working years are usually pre-65, so
    // this is a no-op for most scenarios; a 65+ still-working filer now gets parity
    // with the year-0 orchestrator. MAGI proxy for the OBBBA bonus phaseout = non-SS
    // ordinary (net of pre-tax deferrals) + taxable SS.
    const fedParams = {
        ...rawFedParams,
        standardDeduction: TaxService.getEffectiveStandardDeduction(
            rawFedParams,
            input.taxState.filingStatus,
            input.currentAge,
            input.year,
            Math.max(0, taxableOrdinaryBase - socialSecurityBenefits - preTaxDeductions) +
                TaxService.getTaxableSocialSecurityBenefits(
                    socialSecurityBenefits,
                    taxableOrdinaryBase - socialSecurityBenefits,
                    0,
                    input.taxState.filingStatus,
                ),
        ),
    };

    // -------------------------------------------------------------------------
    // #159: DP-planned Roth conversion in a WORKING year.
    //
    // Pre-retirement years used to be a hard no-conversion zone: the DP contexts
    // skipped them and this solver had no conversion plumbing at all, so a modeled
    // income gap (sabbatical / layoff / income end-date) silently got $0
    // conversions even when free standard-deduction bracket space existed. Now the
    // optimizer emits plan entries for pre-retirement GAP years (see
    // buildDPYearContexts) and this solver executes them: the conversion joins the
    // year's ordinary income (federal + state tax, SS taxability, MAGI),
    // executeYearPlan moves the balances, and the extra tax flows through the SAME
    // deficit/surplus cash math as every other tax — covered by surplus first,
    // else it raises the deficit that withdrawals fund (the retirement path's
    // surplus-then-brokerage-then-withhold economics without new plumbing).
    //
    // SIMPLIFICATION (deliberate): a Traditional 401k generally can't be converted
    // in-service while employed. The app doesn't model employment↔account linkage
    // at that grain, and the target use case is scenario exploration of income-GAP
    // years (not employed), so no employment gating is applied.
    //
    // #114 note: the conversion tax joins `totalTax` BEFORE the RSU-withholding
    // netting below — the same point every other tax comes out — so the known
    // working-year withholding-vs-deficit ordering surface is unchanged.
    const scheduledConversion = input.forceZeroConversion
        ? 0
        : (input.dpConversionPlan?.get(input.year) ?? 0);

    // #169: MC closed-loop policy consult for GAP years — the same #98 lookup
    // planConversionDP performs for retirement years. Without it, MC paths
    // executed the central plan's gap-year amount verbatim (open-loop): a path
    // whose realized returns left a much smaller (or larger) Traditional balance
    // in the gap year still converted the centrally-planned amount. The policy
    // table already covers gap-year contexts (buildDPYearContexts emits them and
    // the stochastic solve records every context's argmax), so look it up at the
    // path's REALIZED (Traditional, Roth IRA) state. Non-gap working years have
    // no policy entry (lookup → undefined) and deterministic runs never set
    // mcConversionPolicy — both keep the scheduled amount, byte-for-byte.
    let targetConversion = scheduledConversion;
    if (!input.forceZeroConversion && input.taxOptimizationEnabled && input.mcConversionPolicy) {
        const tradForLookup = getTotalTraditionalBalance(input.accounts);
        const rothForLookup = getTotalRothBalance(input.accounts);
        const rawPolicy = lookupConversionPolicy(
            input.mcConversionPolicy, input.year, tradForLookup, rothForLookup);
        if (rawPolicy !== undefined) {
            targetConversion = Math.max(0, rawPolicy);
            // #89 MC over-conversion cap — the same per-path bound planConversionDP
            // applies: fill realized taxable income only to stdDed + capHeadroom.
            // The working-year ordinary base nets pre-tax deductions exactly as the
            // tax calc below does, so the cap adapts to any residual gap-year wages.
            const capHeadroom = input.mcConversionPolicy.capHeadroom;
            if (capHeadroom !== undefined) {
                const nonSSOrdinary = Math.max(
                    0, taxableOrdinaryBase - socialSecurityBenefits - preTaxDeductions);
                targetConversion = Math.min(targetConversion,
                    Math.max(0, fedParams.standardDeduction + capHeadroom - nonSSOrdinary));
            }
            if (targetConversion > 0) {
                decisions.push({
                    category: 'conversion',
                    description: `[#98 MC policy] realized Trad $${Math.round(tradForLookup).toLocaleString()}, ` +
                        `Roth $${Math.round(rothForLookup).toLocaleString()} → gap-year policy conversion ` +
                        `$${Math.round(targetConversion).toLocaleString()}.`,
                });
            }
        }
    }

    let conversionAmount = 0;
    let conversionSourceAccount: InvestedAccount | null = null;
    let conversionTargetAccount: InvestedAccount | null = null;
    if (targetConversion > 0) {
        const traditionalBalance = getTotalTraditionalBalance(input.accounts);
        conversionSourceAccount = getFirstTraditionalAccount(input.accounts);
        conversionTargetAccount = getFirstRothAccount(input.accounts);
        if (!input.taxOptimizationEnabled) {
            // #159: never skip a scheduled conversion silently — say why.
            decisions.push({
                category: 'conversion',
                amount: targetConversion,
                description: `Skipped scheduled Roth conversion of $${Math.round(targetConversion).toLocaleString()}: tax optimization is disabled.`,
            });
        } else if (traditionalBalance <= 0 || !conversionSourceAccount || !conversionTargetAccount) {
            decisions.push({
                category: 'conversion',
                amount: targetConversion,
                description: `Skipped scheduled Roth conversion of $${Math.round(targetConversion).toLocaleString()}: ` +
                    (traditionalBalance <= 0 || !conversionSourceAccount
                        ? 'no Traditional balance available.'
                        : 'no Roth account to receive the conversion.'),
            });
        } else {
            conversionAmount = Math.min(targetConversion, traditionalBalance);
            if (conversionAmount < targetConversion - 0.5) {
                decisions.push({
                    category: 'conversion',
                    amount: conversionAmount,
                    description: `Scheduled Roth conversion of $${Math.round(targetConversion).toLocaleString()} clamped to the available Traditional balance ($${Math.round(conversionAmount).toLocaleString()}).`,
                });
            }
        }
    }

    const taxResult = TaxService.calculateTotalFederalTax(
        taxableOrdinaryBase - socialSecurityBenefits + conversionAmount,
        socialSecurityBenefits,
        0,
        0,
        preTaxDeductions,
        input.taxState.filingStatus,
        fedParams
    );

    const ficaTax = TaxService.calculateFicaTax(
        input.taxState,
        input.incomes,
        input.year,
        input.assumptions
    );

    const stateTax = stateParams
        ? TaxService.calculateTax(
            // Exclude Social Security (DC and all modeled states exempt it),
            // mirroring the retirement path. Reinvested income is already folded
            // into taxableOrdinaryBase and stays in the state base. A #159
            // working-year conversion is state-taxable ordinary income too.
            taxableOrdinaryBase - socialSecurityBenefits + conversionAmount,
            preTaxDeductions,
            stateParams
        )
        : 0;

    const totalTax = taxResult.totalTax + stateTax + ficaTax;

    // #159: the conversion's own tax cost — the finite difference between this
    // year's fed+state tax with and without the conversion income (the same
    // finite-difference truth #164 established for the retirement display).
    // Zero-conversion years never take this branch (byte-identical to before).
    let conversion: PlannedConversion | null = null;
    if (conversionAmount > 0 && conversionSourceAccount && conversionTargetAccount) {
        // #170: candidate-scoring runs never display the cost — skip the two
        // no-conversion tax computations and report $0 (reporting-only; the
        // conversion income is already inside taxResult/stateTax above, and
        // nothing decision-side reads taxAmount/taxSource).
        let conversionFedTax = 0;
        let conversionStateTax = 0;
        if (!input.skipDisplayRefinement) {
            const fedNoConv = TaxService.calculateTotalFederalTax(
                taxableOrdinaryBase - socialSecurityBenefits,
                socialSecurityBenefits,
                0, 0, preTaxDeductions, input.taxState.filingStatus, fedParams,
            ).totalTax;
            const stateNoConv = stateParams
                ? TaxService.calculateTax(taxableOrdinaryBase - socialSecurityBenefits, preTaxDeductions, stateParams)
                : 0;
            conversionFedTax = Math.max(0, taxResult.totalTax - fedNoConv);
            conversionStateTax = Math.max(0, stateTax - stateNoConv);
        }
        const conversionTax = conversionFedTax + conversionStateTax;

        // Tax-payment source, mirroring computeConversionTaxAndSource's preference
        // order (surplus → brokerage → withhold). Advisory/display only — the cash
        // itself flows through the year's deficit/surplus math either way.
        const surplusEstimate = Math.max(0,
            incomeClassification.classified.spendable - preTaxDeductions - postTaxDeductions - input.totalLivingExpenses);
        const taxSource: ConversionTaxSource =
            surplusEstimate >= conversionTax ? 'SURPLUS'
                : getTotalBrokerageBalance(input.accounts) >= conversionTax ? 'BROKERAGE'
                    : 'WITHHOLD';

        conversion = {
            amount: conversionAmount,
            fromAccountId: conversionSourceAccount.id,
            toAccountId: conversionTargetAccount.id,
            taxSource,
            taxAmount: conversionTax,
            federalTaxCost: conversionFedTax,
            stateTaxCost: conversionStateTax,
            netToRoth: conversionAmount,
            reason: `DP-planned working-year (income-gap) conversion of $${Math.round(conversionAmount).toLocaleString()}. Tax paid from ${taxSource.toLowerCase()}.`,
        };
        decisions.push({
            category: 'conversion',
            account: conversionSourceAccount.name,
            amount: conversionAmount,
            description: `DP-planned (working year): $${Math.round(conversionAmount).toLocaleString()} from ${conversionSourceAccount.name} to Roth. Tax: $${Math.round(conversionTax).toLocaleString()} (${taxSource.toLowerCase()}).`,
        });
    }

    // Medicare IRMAA surcharge (2-year lookback). Applies to anyone on Medicare
    // (age 65+) — including those still working — based on year N-2's MAGI. It's a
    // known cash cost, so fold it into the deficit and the year's total tax. The
    // income-side MAGI (non-SS ordinary + taxable SS) is the self-proxy for the
    // very first simulated year, when no prior-year MAGI exists. A #159
    // working-year conversion is ordinary income and belongs in it.
    const incomeSideMAGI = (taxableOrdinaryBase - socialSecurityBenefits + conversionAmount) + taxResult.taxableSS;
    const irmaaSurcharge = computeIrmaaForYear(input, incomeSideMAGI, decisions);

    // RSU sell-to-cover withholding is an estimated-tax PREPAYMENT the employer
    // already remitted (by selling the withholding slice of shares at vest), so in
    // the cash-flow it offsets the tax due — exactly as SimulationEngine nets it at
    // the Sankey stage. Netting it into the DEFICIT math here (gated on > 0, so
    // non-RSU years are byte-identical) stops an over-withheld vest from fabricating
    // a phantom deficit-debt for a tax the withholding already covered (#114). The
    // excess over the actual tax is a genuine refund and returns as a cash inflow.
    const rsuWithholding = Math.max(0, input.rsuWithholding ?? 0);

    // Calculate initial surplus/deficit
    // IMPORTANT: Must subtract pre-tax deductions (401k, HSA) and post-tax deductions
    // (Roth 401k, after-tax contributions) from cashIn because they reduce spendable
    // cash even though they may reduce taxes or be after-tax.
    // Note: spendable already excludes reinvested income (handled by classifyIncome).
    // The withholding nets against the cash tax (floored at 0); any excess over the
    // income tax is a refund and returns as a cash inflow so this year's position
    // isn't understated by the prepayment. (Refund is re-derived against the FINAL
    // tax below — at this initial stage deficit withdrawals haven't added tax yet.)
    const initialCashTax = Math.max(0, totalTax - rsuWithholding);
    const initialRsuRefund = Math.max(0, rsuWithholding - totalTax);
    const incomeCashIn = incomeClassification.classified.spendable - preTaxDeductions - postTaxDeductions + initialRsuRefund;
    const incomeCashOut = input.totalLivingExpenses + initialCashTax + irmaaSurcharge;
    const initialDeficit = Math.max(0, incomeCashOut - incomeCashIn);

    // Plan withdrawals if income doesn't cover expenses
    let withdrawals: PlannedWithdrawal[] = [];
    let ltcgTax = 0;
    let withdrawalOrdinaryTax = 0;
    let totalPenalties = 0;
    let niitTax = 0;
    // State tax on realized LTCG (#175/2): the planner grosses up brokerage LTCG at the
    // FEDERAL rate only, so the working-year path charged no state tax on realized
    // long-term gains. Mirror the retirement path, which folds LTCG into its state base
    // (finalStateTax). STCG state tax is already charged by the planner (brokerageStcgTax
    // uses the state marginal rate), so only LTCG is added here.
    let stateLtcgTax = 0;
    // SS torpedo (#175/5): deficit-funding ordinary withdrawals raise combined income,
    // making more Social Security taxable than taxResult (computed pre-withdrawal)
    // assumed. The planner charges only the withdrawal's own marginal tax, so the
    // incremental federal tax on that extra taxable SS was charged nowhere.
    let ssTorpedoFedTax = 0;
    let realizedLTCG = 0;
    let realizedSTCG = 0;
    let withdrawalOrdinaryIncome = 0;
    let withdrawalDecisions: DecisionLogEntry[] = [];
    // Taxable SS used for the year's MAGI — bumped by the SS torpedo below.
    let effectiveTaxableSS = taxResult.taxableSS;

    if (initialDeficit > 0) {
        // #154: honor the user's literal withdrawal order on the working-year deficit
        // too — same as the retirement drawdown — so a pre-retirement shortfall taps
        // accounts in the exact sequence the UI shows. Gated on Tax Opt OFF: when Tax
        // Optimization is ON the optimizer owns the order and keeps its penalty-aware
        // bucketing, savings-first among non-penalized (#161) — the same execution as
        // the retirement drawdown, so the order it scores matches how it runs both
        // before and after retirement. includeUnorderedSellable
        // stays false here — the #111 safety-net tier is deliberately retirement-only
        // because the working-year initialDeficit conflates tax with spending and would
        // mishandle RSU withholding (#114).
        const accountSnapshots = createOrderedSnapshots(
            input.accounts, input.withdrawalOrder, input.currentAge, input.year, false, !input.taxOptimizationEnabled,
        );

        // Base ordinary income EXCLUDING SS (SS enters via its taxable portion below),
        // plus any #159 working-year conversion.
        const baseExSS = taxableOrdinaryBase - socialSecurityBenefits + conversionAmount;
        const fedOrdinaryTaxAt = (ordinary: number): number =>
            TaxService.calculateTotalFederalTax(
                Math.max(0, ordinary), 0, 0, 0, preTaxDeductions, input.taxState.filingStatus, fedParams,
            ).ordinaryTax;
        const stateTaxAt = (base: number): number =>
            stateParams ? TaxService.calculateTax(Math.max(0, base), preTaxDeductions, stateParams) : 0;

        // Iterate: the deficit and the taxes it triggers (NIIT, state LTCG, SS torpedo)
        // are mutually dependent, exactly as in the retirement path — sizing the
        // withdrawal without them fabricated a phantom unfunded deficit even with ample
        // sellable balances (#175/1: unfundedDeficit ≈ niitTax while brokerage sat
        // untouched). Grow the deficit by the newly-surfaced taxes and re-plan until it
        // converges. A year with no SS and no realized gains yields zero on all three,
        // so the loop converges after one pass, byte-identical to the prior single pass.
        const MAX_WORKING_ITERATIONS = 6;
        let currentDeficit = initialDeficit;
        for (let iter = 0; iter < MAX_WORKING_ITERATIONS; iter++) {
            // Recompute taxable SS with this iteration's deficit-funding ordinary income
            // + gains folded into combined income (the working-year SS torpedo). The
            // first pass uses the base position (all estimates 0).
            const combinedExSS = baseExSS + withdrawalOrdinaryIncome + realizedLTCG + Math.max(0, realizedSTCG);
            const iterTaxableSS = socialSecurityBenefits > 0
                ? TaxService.getTaxableSocialSecurityBenefits(
                    socialSecurityBenefits, combinedExSS, 0, input.taxState.filingStatus)
                : 0;
            // #175/4: position the planner's LTCG bracket + gross-up at base ordinary +
            // the TAXABLE portion of SS (mirrors the retirement path), not 100% of SS —
            // over-counting SS could push realized LTCG from the 0% into the 15% bracket.
            // Pass the taxable SS as stateExemptIncome so the planner excludes it from
            // state bracketing (states exempt SS).
            const plannerOrdinaryIncome = baseExSS + iterTaxableSS;

            const withdrawalResult = planWithdrawals(
                currentDeficit,
                accountSnapshots,
                input.currentAge,
                input.year,
                input.taxState,
                plannerOrdinaryIncome,
                input.assumptions,
                'Spending deficit',
                undefined,     // no ACA steering in working years (employer coverage; aca = 0)
                iterTaxableSS, // stateExemptIncome
            );

            withdrawals = withdrawalResult.withdrawals;
            // Split mixed (ESPP) withdrawal tax: the LTCG portion → ltcgTax, the ordinary
            // bargain-element portion → withdrawalOrdinaryTax.
            ltcgTax = ltcgTaxOf(withdrawalResult.withdrawals);
            withdrawalOrdinaryTax = ordinaryTaxOf(withdrawalResult.withdrawals);
            totalPenalties = withdrawalResult.totalPenalties;
            realizedLTCG = withdrawalResult.totalLTCG;
            realizedSTCG = withdrawalResult.totalSTCG;
            // Ordinary income realized by deficit withdrawals (Traditional gross + ESPP
            // bargain element) — feeds the year's MAGI and the SS torpedo.
            withdrawalOrdinaryIncome = withdrawalResult.withdrawals.reduce(
                (s, w) => s + ((w.source === 'traditional_401k' || w.source === 'traditional_ira')
                    ? w.gross
                    : (w.ordinaryIncome ?? 0)),
                0);
            withdrawalDecisions = withdrawalResult.decisions;

            // Recompute taxable SS with THIS iteration's realized withdrawal + gains
            // (the top-of-loop iterTaxableSS lagged one iteration — it used the prior
            // pass's withdrawal, 0 on the first — so the torpedo and the grown deficit
            // must use the post-planning value or the loop converges before the torpedo
            // propagates).
            const postCombinedExSS = baseExSS + withdrawalOrdinaryIncome + realizedLTCG + Math.max(0, realizedSTCG);
            const postTaxableSS = socialSecurityBenefits > 0
                ? TaxService.getTaxableSocialSecurityBenefits(
                    socialSecurityBenefits, postCombinedExSS, 0, input.taxState.filingStatus)
                : 0;
            effectiveTaxableSS = postTaxableSS;

            // NIIT (3.8%) on realized gains. Fold the deficit-funding Traditional
            // withdrawal into the ordinary base so the internal MAGI/SS-taxability see it;
            // only .niitTax is read (the inflated ordinary tax is charged separately via
            // withdrawalOrdinaryTax).
            niitTax = (realizedLTCG > 0 || realizedSTCG > 0)
                ? TaxService.calculateTotalFederalTax(
                    baseExSS + withdrawalOrdinaryIncome,
                    socialSecurityBenefits,
                    realizedSTCG,
                    realizedLTCG,
                    preTaxDeductions,
                    input.taxState.filingStatus,
                    fedParams,
                ).niitTax
                : 0;

            // State tax on realized LTCG (#175/2), stacked above base ordinary income.
            stateLtcgTax = realizedLTCG > 0
                ? Math.max(0, stateTaxAt(baseExSS + realizedLTCG) - stateTaxAt(baseExSS))
                : 0;

            // SS torpedo (#175/5): the incremental federal ordinary tax on the EXTRA
            // taxable SS the withdrawal created, stacked directly above the base ordinary
            // income (matching the retirement path, whose finalFedResult prices the
            // torpedo-inclusive taxable SS without the withdrawal below it). taxResult
            // already priced the base taxable SS; this adds only the increment.
            ssTorpedoFedTax = postTaxableSS > taxResult.taxableSS
                ? Math.max(0, fedOrdinaryTaxAt(baseExSS + postTaxableSS) - fedOrdinaryTaxAt(baseExSS + taxResult.taxableSS))
                : 0;

            // These three taxes were unknown when initialDeficit was sized; grow the
            // deficit so the next pass funds them (mirrors the retirement path's
            // iterative deficit). Converges fast — SS taxability and the gains are
            // monotone in the deficit.
            const newDeficit = initialDeficit + niitTax + stateLtcgTax + ssTorpedoFedTax;
            if (Math.abs(newDeficit - currentDeficit) < 1) {
                currentDeficit = newDeficit;
                break;
            }
            currentDeficit = newDeficit;
        }

        decisions.push(...withdrawalDecisions);
    }

    // Final cash flow including withdrawals
    const totalGrossWithdrawals = withdrawals.reduce((sum, w) => sum + w.gross, 0);
    const finalTotalTax = totalTax + ltcgTax + withdrawalOrdinaryTax + niitTax
        + stateLtcgTax + ssTorpedoFedTax + totalPenalties + irmaaSurcharge;

    // The year's MAGI (≈ AGI) — stored for the year N+2 IRMAA lookback. Non-SS
    // ordinary income (+ any #159 working-year conversion) + taxable SS (torpedo-
    // inclusive, #175/5) + deficit-funding withdrawal income + realized gains.
    const yearMAGI = Math.max(0,
        (taxableOrdinaryBase - socialSecurityBenefits + conversionAmount) + effectiveTaxableSS
        + withdrawalOrdinaryIncome + realizedLTCG + realizedSTCG);

    // Re-derive the withholding netting against the FINAL tax (deficit withdrawals
    // may have added LTCG/ordinary/penalty tax). The prepayment offsets the cash
    // tax; any excess is the refund. `incomeCashIn` already carries the initial-stage
    // refund (computed against the income-only tax) — back it out and re-add the
    // final-stage refund so it's counted exactly once. Net cash effect: withholding
    // reduces the cash tax paid, with the over-withholding returned as a refund.
    const finalCashTax = Math.max(0, finalTotalTax - rsuWithholding);
    const finalRsuRefund = Math.max(0, rsuWithholding - finalTotalTax);
    const finalCashIn = incomeCashIn - initialRsuRefund + finalRsuRefund + totalGrossWithdrawals;
    const finalCashOut = input.totalLivingExpenses + finalCashTax;
    const surplus = Math.max(0, finalCashIn - finalCashOut);
    const unfundedDeficit = Math.max(0, finalCashOut - finalCashIn);

    if (unfundedDeficit > 0) {
        decisions.push({
            category: 'warning',
            amount: unfundedDeficit,
            description: `Unfunded deficit of $${unfundedDeficit.toLocaleString()}. Insufficient account balances.`,
        });
    }

    const taxSummary: YearPlanTax = {
        // Federal includes the SS-torpedo increment the deficit-funding withdrawals
        // triggered (#175/5) so the reported federal tax matches finalTotalTax.
        federal: taxResult.totalTax + ssTorpedoFedTax,
        // State includes the tax on realized LTCG the planner (federal-only) omitted
        // (#175/2).
        state: stateTax + stateLtcgTax,
        fica: ficaTax,
        capitalGainsLT: ltcgTax,
        capitalGainsST: 0,
        withdrawalOrdinaryTax,
        niit: niitTax,
        irmaa: irmaaSurcharge,
        // Working years assume employer coverage (no marketplace subsidy at
        // stake); the ACA charge applies only on the retirement path.
        aca: 0,
        penalties: totalPenalties,
        total: finalTotalTax,
    };

    // Allocate surplus (if any)
    let surplusAllocations: YearPlan['surplusAllocations'] = [];
    let surplusDeficitDebtPayment = 0;
    if (surplus > 0) {
        const priorityBuckets = (input.assumptions.priorities || []).map((p, idx) => ({
            accountId: p.accountId || '',
            priority: idx,
            capType: p.capType,
            capValue: p.capValue,
        })).filter(p => p.accountId);

        const earnedIncome = TaxService.getEarnedIncome(input.incomes, input.year);
        const surplusSettings: SurplusAllocationSettings = {
            emergencyFundTarget: DEFAULT_EMERGENCY_FUND_TARGET,
            rothIRAContributionEnabled: true,
            rothIRALimit: getIRALimit(input.year, input.currentAge, input.assumptions.macro.inflationAdjusted),
            rothIRAContributedThisYear: 0,
            monthlyExpenses: input.totalLivingExpenses / 12,
            reservedAccountIds: input.reservedAccountIds ? new Set(input.reservedAccountIds) : undefined,
            // #60: cap each debt bucket at its linked loan's current balance.
            debtPaydownCaps: buildDebtPaydownCaps(input.accounts, input.expenses),
        };

        const surplusResult = allocateSurplus(
            surplus,
            input.accounts,
            priorityBuckets,
            earnedIncome,
            surplusSettings
        );

        surplusAllocations = surplusResult.allocations;
        surplusDeficitDebtPayment = surplusResult.deficitDebtPayment;
        decisions.push(...surplusResult.decisions);
    }

    // #159: report the conversion as taxable-but-not-spendable income (mirrors
    // the retirement path's post-conversion re-classification). Zero-conversion
    // years reuse the original classification object untouched.
    const finalIncomeClassification = conversionAmount > 0
        ? classifyIncome(input.incomes, 0, conversionAmount, input.year)
        : incomeClassification;

    return {
        year: input.year,
        isRetired: false,
        income: finalIncomeClassification.classified,
        withdrawals,
        conversion,
        contributions: [], // Will be filled by contribution planning
        surplusAllocations,
        deficitDebtPayment: surplusDeficitDebtPayment,
        tax: taxSummary,
        magi: yearMAGI,
        surplus,
        unfundedDeficit,
        totalExpenses: input.totalLivingExpenses,
        strategyResult: input.strategyResult,
        iterations: 1,
        converged: true,
        decisions,
    };
}

/**
 * Main entry point - routes to working or retirement solver.
 */
export function solveYear(input: YearSolverInput): YearPlan {
    if (input.isRetired) {
        return solveRetirementYear(input);
    } else {
        return solveWorkingYear(input);
    }
}
