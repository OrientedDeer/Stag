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
import { AnyIncome, FERSPensionIncome, PassiveIncome } from "../../components/Objects/Income/models";
import { AnyExpense } from "../../components/Objects/Expense/models";
import { TaxParameters } from "../../data/TaxData";
import { TaxState } from "../../components/Objects/Taxes/TaxContext";
import { AssumptionsState } from "../../components/Objects/Assumptions/AssumptionsContext";
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
import { classifyIncome, getTotalSSBenefits } from "./IncomeClassifier";
import { planWithdrawals, createOrderedSnapshots, grossUpBrokerage } from "./WithdrawalPlanner";
import * as TaxService from "../../components/Objects/Taxes/TaxService";
import { getLTCGRate } from "../../components/Objects/Taxes/taxService/capitalGainsTax";
import { calculateEffectiveConversionTax, ACAOptions, IRMAAConversionOptions } from "./helpers";
import { getRMDStartAge } from "../../data/RMDData";
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

// #93 Monte Carlo adaptive overlay: upper clamp on the realized/expected
// Traditional-balance ratio used to scale the precomputed conversion. A bull
// path can grow Traditional well past the plan's expectation; capping the
// scale-up at 1.5× keeps the path from over-converting into high brackets the
// bracket-aware DP deliberately avoided (the plan's amount is already the
// wealth-optimal target for the central path). The downside is uncapped (ratio
// floors at 0), since trimming conversions on a crash is exactly the desired
// left-tail behavior. At ratio = 1 (on-track) the scale is the identity, so the
// rule reduces to the precomputed plan.
const MC_ADAPTIVE_RATIO_CAP = 1.5;

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
    // Monte Carlo non-anticipative adaptive overlay (#93). Per-year EXPECTED
    // start-of-year Traditional balance from the deterministic projection the
    // dpConversionPlan was solved against. Set ONLY on the MC path; undefined in
    // production/deterministic runs (so those are byte-for-byte unchanged). When
    // present, planConversionDP scales the precomputed amount by the ratio of the
    // path's REALIZED start-of-year Traditional balance to this expected balance
    // — see planConversionDP for the rule. Non-anticipative: uses only the
    // balance realized up to this year, never future returns.
    mcAdaptiveExpectedTrad?: Map<number, number>;
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

function getTotalTraditionalBalance(accounts: AnyAccount[]): number {
    return accounts
        .filter(a => a instanceof InvestedAccount &&
            (a.taxType === 'Traditional 401k' || a.taxType === 'Traditional IRA'))
        .reduce((sum, a) => sum + (a as InvestedAccount).vestedAmount, 0);
}

function getTotalBrokerageBalance(accounts: AnyAccount[]): number {
    return accounts
        .filter(a => a instanceof InvestedAccount && a.taxType === 'Brokerage')
        .reduce((sum, a) => sum + (a as InvestedAccount).vestedAmount, 0);
}

function getFirstTraditionalAccount(accounts: AnyAccount[]): InvestedAccount | null {
    return accounts.find(a =>
        a instanceof InvestedAccount &&
        (a.taxType === 'Traditional 401k' || a.taxType === 'Traditional IRA') &&
        a.vestedAmount > 0
    ) as InvestedAccount | null;
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
    acaOptions: ACAOptions | undefined,
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
    const conversionTaxResult = calculateEffectiveConversionTax(
        nonSSOrdinaryIncome,
        socialSecurityBenefits,
        estimatedLTCGForYear,
        conversionAmount,
        input.taxState.filingStatus,
        fedParams,
        stateParams,
        acaOptions,
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
    const futureSS_PIA = (futureSS?.projectedPIA && futureSS.projectedPIA > 0)
        ? futureSS.projectedPIA
        : (futureSS?.amount ? futureSS.amount / 12 : (futureSS?.calculatedPIA ?? 0));
    const ssClaimingAge = futureSS?.claimingAge ?? 67;

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
            estimatedSubsidyLoss: 12000,
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
    spendingDeficit: number  // pre-tax deficit estimate (expenses + roughTax - spendable - RMD)
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
                input.totalLivingExpenses + ordinaryTax + ficaTax - spendableIncome
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
            conversionAmount, spendingDeficit, surplus, fedParams, stateParams, acaOptions,
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
        return skipReturn('NOT_RETIRED');
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

    // Look up the precomputed conversion amount. Clamp to (traditional - reserved
    // for spending) so the conversion doesn't compete with the spending withdrawal.
    const availableTradForConversion = Math.max(0, traditionalBalance - bracketSpaceForSpending);
    const plannedConversion = input.dpConversionPlan?.get(input.year) ?? 0;

    // --- #93 Monte Carlo NON-ANTICIPATIVE adaptive overlay -------------------
    // Production/deterministic runs leave `mcAdaptiveExpectedTrad` undefined, so
    // `targetConversion === plannedConversion` and behavior is byte-for-byte the
    // precomputed plan. On an MC path it IS set: scale the planned amount by the
    // ratio of the path's REALIZED start-of-year Traditional balance to the
    // EXPECTED balance the plan was solved against. This is a strict
    // GENERALIZATION of dp-precomputed — when the realized path tracks the
    // projection (returns ≈ the plan's RoR) the ratio is 1 and we convert exactly
    // the planned amount; the rule only diverges as realized balances drift. On a
    // drawdown path (ratio < 1) it scales the conversion DOWN, so an early-crash
    // path no longer drains stressed liquid assets to pay tax on a conversion an
    // adaptive retiree would trim — the left-tail behavior #93 targets. The ratio
    // is clamped to [0, MC_ADAPTIVE_RATIO_CAP] so an extreme bull run can't
    // over-convert into brackets the DP avoided. Strictly non-anticipative:
    // `traditionalBalance` reflects only returns realized through this year.
    let targetConversion = plannedConversion;
    const expectedTrad = input.mcAdaptiveExpectedTrad?.get(input.year);
    if (expectedTrad !== undefined && plannedConversion > 0) {
        // expectedTrad <= 0 means the plan expected no Traditional here (so it
        // would not have scheduled a conversion); guard the divide and skip.
        const ratio = expectedTrad > 1
            ? Math.max(0, Math.min(MC_ADAPTIVE_RATIO_CAP, traditionalBalance / expectedTrad))
            : 0;
        targetConversion = plannedConversion * ratio;
        decisions.push({
            category: 'conversion',
            description: `[#93 MC adaptive] realized Trad $${Math.round(traditionalBalance).toLocaleString()} ` +
                `vs expected $${Math.round(expectedTrad).toLocaleString()} → ratio ${ratio.toFixed(3)}; ` +
                `scaled planned conversion $${Math.round(plannedConversion).toLocaleString()} ` +
                `→ $${Math.round(targetConversion).toLocaleString()}.`,
        });
    }
    // -------------------------------------------------------------------------

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

    // ACA options for the tax cost calc (same logic as rate-match path).
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
            estimatedSubsidyLoss: 12000,
        };
    }

    const { conversionTax, conversionFedTax, conversionStateTax, taxSource } =
        computeConversionTaxAndSource(
            input, baseOrdinaryIncome, nonSSOrdinaryIncome, socialSecurityBenefits,
            conversionAmount, spendingDeficit, surplus, fedParams, stateParams, acaOptions,
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
    const fedParams = TaxService.getTaxParameters(
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

    if (!fedParams) {
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
        preliminaryDeficit
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
    let accountSnapshots = createOrderedSnapshots(
        input.accounts, input.withdrawalOrder, input.currentAge, input.year
    );

    // Reserve the RMD against the Traditional account it draws from. The RMD already
    // claims `input.rmdAmount` from that account (recorded as a negative userInflow,
    // applied later by growAccounts), but createOrderedSnapshots reads the raw balance,
    // so without this the discretionary planner could plan to withdraw dollars the RMD
    // already took — over-draining the account and surfacing phantom spendable cash.
    if (input.rmdAmount > 0) {
        const rmdAccount = getFirstTraditionalAccount(input.accounts);
        if (rmdAccount) {
            accountSnapshots = accountSnapshots.map(s =>
                s.accountId === rmdAccount.id
                    ? { ...s, vestedBalance: Math.max(0, s.vestedBalance - input.rmdAmount) }
                    : s
            );
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

        // Deficit includes authoritative LTCG tax (via fedTaxExStcgOrdinary).
        // Note: classifyIncome adds rmdAmount to spendable, so we don't subtract it again.
        const deficit =
            effectiveLivingExpenses +
            fedTaxExStcgOrdinary +
            finalStateTax +
            ficaTax +
            irmaaSurcharge -
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
        const acaWithdrawalOpts = acaCliffActive
            ? { acaCliffThreshold, currentMAGI: acaBaseMAGI + estimatedTradWithdrawal }
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
    // + Medicare IRMAA surcharge (from year N-2 MAGI).
    const totalTax = finalFedTaxExStcgOrdinary + finalStateTax + withdrawalOrdinaryTax + ficaTax + totalPenalties + irmaaSurcharge;

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
    const fedParams = TaxService.getTaxParameters(
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

    if (!fedParams) {
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

    const taxResult = TaxService.calculateTotalFederalTax(
        taxableOrdinaryBase - socialSecurityBenefits,
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
            taxableOrdinaryBase,  // Include reinvested income in state tax too
            preTaxDeductions,
            stateParams
        )
        : 0;

    const totalTax = taxResult.totalTax + stateTax + ficaTax;

    // Medicare IRMAA surcharge (2-year lookback). Applies to anyone on Medicare
    // (age 65+) — including those still working — based on year N-2's MAGI. It's a
    // known cash cost, so fold it into the deficit and the year's total tax. The
    // income-side MAGI (non-SS ordinary + taxable SS) is the self-proxy for the
    // very first simulated year, when no prior-year MAGI exists.
    const incomeSideMAGI = (taxableOrdinaryBase - socialSecurityBenefits) + taxResult.taxableSS;
    const irmaaSurcharge = computeIrmaaForYear(input, incomeSideMAGI, decisions);

    // Calculate initial surplus/deficit
    // IMPORTANT: Must subtract pre-tax deductions (401k, HSA) and post-tax deductions
    // (Roth 401k, after-tax contributions) from cashIn because they reduce spendable
    // cash even though they may reduce taxes or be after-tax.
    // Note: spendable already excludes reinvested income (handled by classifyIncome).
    const incomeCashIn = incomeClassification.classified.spendable - preTaxDeductions - postTaxDeductions;
    const incomeCashOut = input.totalLivingExpenses + totalTax + irmaaSurcharge;
    const initialDeficit = Math.max(0, incomeCashOut - incomeCashIn);

    // Plan withdrawals if income doesn't cover expenses
    let withdrawals: PlannedWithdrawal[] = [];
    let ltcgTax = 0;
    let withdrawalOrdinaryTax = 0;
    let totalPenalties = 0;
    let niitTax = 0;
    let realizedLTCG = 0;
    let realizedSTCG = 0;
    let withdrawalOrdinaryIncome = 0;

    if (initialDeficit > 0) {
        const accountSnapshots = createOrderedSnapshots(
            input.accounts, input.withdrawalOrder, input.currentAge, input.year
        );

        const withdrawalResult = planWithdrawals(
            initialDeficit,
            accountSnapshots,
            input.currentAge,
            input.year,
            input.taxState,
            taxableOrdinaryBase, // ordinary income for LTCG bracket determination
            input.assumptions,
            'Spending deficit'
        );

        withdrawals = withdrawalResult.withdrawals;
        // Split mixed (ESPP) withdrawal tax: the LTCG portion → ltcgTax, the
        // ordinary bargain-element portion → withdrawalOrdinaryTax. Before this
        // split, ESPP's full tax was mislabeled as capital-gains tax.
        ltcgTax = ltcgTaxOf(withdrawalResult.withdrawals);
        withdrawalOrdinaryTax = ordinaryTaxOf(withdrawalResult.withdrawals);
        totalPenalties = withdrawalResult.totalPenalties;

        // NIIT (3.8%) on capital gains realized to fund the deficit. The federal
        // tax helper computes it internally from investment income; extract only
        // the NIIT so the existing planner-based ltcgTax cash handling is kept.
        realizedLTCG = withdrawalResult.totalLTCG;
        realizedSTCG = withdrawalResult.totalSTCG;
        // Ordinary income realized by deficit withdrawals (Traditional gross +
        // ESPP bargain element) — feeds the year's MAGI for the IRMAA lookback.
        withdrawalOrdinaryIncome = withdrawalResult.withdrawals.reduce(
            (s, w) => s + ((w.source === 'traditional_401k' || w.source === 'traditional_ira')
                ? w.gross
                : (w.ordinaryIncome ?? 0)),
            0);
        if (realizedLTCG > 0 || realizedSTCG > 0) {
            niitTax = TaxService.calculateTotalFederalTax(
                taxableOrdinaryBase - socialSecurityBenefits,
                socialSecurityBenefits,
                realizedSTCG,
                realizedLTCG,
                preTaxDeductions,
                input.taxState.filingStatus,
                fedParams
            ).niitTax;
        }

        decisions.push(...withdrawalResult.decisions);
    }

    // Final cash flow including withdrawals
    const totalGrossWithdrawals = withdrawals.reduce((sum, w) => sum + w.gross, 0);
    const finalTotalTax = totalTax + ltcgTax + withdrawalOrdinaryTax + niitTax + totalPenalties + irmaaSurcharge;

    // The year's MAGI (≈ AGI) — stored for the year N+2 IRMAA lookback. Non-SS
    // ordinary income + taxable SS + deficit-funding withdrawal income + realized gains.
    const yearMAGI = Math.max(0,
        (taxableOrdinaryBase - socialSecurityBenefits) + taxResult.taxableSS
        + withdrawalOrdinaryIncome + realizedLTCG + realizedSTCG);

    const finalCashIn = incomeCashIn + totalGrossWithdrawals;
    const finalCashOut = input.totalLivingExpenses + finalTotalTax;
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
        federal: taxResult.totalTax,
        state: stateTax,
        fica: ficaTax,
        capitalGainsLT: ltcgTax,
        capitalGainsST: 0,
        withdrawalOrdinaryTax,
        niit: niitTax,
        irmaa: irmaaSurcharge,
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
        isRetired: false,
        income: incomeClassification.classified,
        withdrawals,
        conversion: null,
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
