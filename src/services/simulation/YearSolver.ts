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
import { AnyIncome } from "../../components/Objects/Income/models";
// AnyExpense is currently unused but kept for future extension
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { AnyExpense } from "../../components/Objects/Expense/models";
import { TaxParameters } from "../../data/TaxData";
import { TaxState } from "../../components/Objects/Taxes/TaxContext";
import { AssumptionsState } from "../../components/Objects/Assumptions/AssumptionsContext";
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
import { planWithdrawals, createOrderedSnapshots } from "./WithdrawalPlanner";
import * as TaxService from "../../components/Objects/Taxes/TaxService";
import { calculateEffectiveConversionTax, ACAOptions } from "./helpers";
import { getRMDStartAge } from "../../data/RMDData";
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

    // Accounts
    accounts: AnyAccount[];
    withdrawalOrder: { accountId: string }[];

    // Tax state
    taxState: TaxState;
    assumptions: AssumptionsState;

    // Strategy
    strategyResult?: WithdrawalResult;

    // Settings
    taxOptimizationEnabled: boolean;
    acaAware: boolean;

    // Prior year data (for GK and conversions)
    previousSimulation?: { year: number; accounts: AnyAccount[] }[];

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
    strategyName: 'rate-match' | 'dp-precomputed' | undefined,
): ConversionStrategy {
    if (strategyName === 'dp-precomputed') return planConversionDP;
    return planConversion;
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

// Reserved for future cross-account tax payment feature
function _getFirstBrokerageAccount(accounts: AnyAccount[]): InvestedAccount | null {
    return accounts.find(a =>
        a instanceof InvestedAccount && a.taxType === 'Brokerage'
    ) as InvestedAccount | null;
}
void _getFirstBrokerageAccount; // Suppress unused warning

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
 * Uses the same logic as WithdrawalPlanner.getLTCGRate.
 */
function getLTCGRateForIncome(ordinaryIncome: number, fedParams: TaxParameters): number {
    if (!fedParams?.capitalGainsBrackets) return 0.15;

    // Find applicable rate based on ordinary income
    const brackets = fedParams.capitalGainsBrackets;
    for (let i = brackets.length - 1; i >= 0; i--) {
        if (ordinaryIncome >= brackets[i].threshold) {
            return brackets[i].rate;
        }
    }
    return brackets[0]?.rate ?? 0;
}

/**
 * Estimate LTCG that would result from covering a deficit via brokerage withdrawal.
 * Formula: LTCG = grossWithdrawal × gainRatio
 *          grossWithdrawal = deficit / (1 - gainRatio × ltcgRate)
 *          When ltcgRate = 0: grossWithdrawal = deficit, LTCG = deficit × gainRatio
 */
function estimateLTCGFromDeficit(deficit: number, gainRatio: number, ltcgRate: number = 0): number {
    if (deficit <= 0 || gainRatio <= 0) return 0;

    const effectiveRate = gainRatio * ltcgRate;
    const grossWithdrawal = effectiveRate < 1 ? deficit / (1 - effectiveRate) : deficit;
    return grossWithdrawal * gainRatio;
}

// =============================================================================
// CONVERSION PLANNING
// =============================================================================

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
    baseOrdinaryIncome: number,
    socialSecurityBenefits: number,
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
        const limitingFactor: ConversionLimitingFactor = !input.isRetired ? 'NOT_RETIRED' : 'NOT_RETIRED';
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

    // Get RMD start age
    const birthYear = input.year - input.currentAge;
    const rmdStartAge = getRMDStartAge(birthYear);
    const yearsUntilRMD = Math.max(0, rmdStartAge - input.currentAge);

    // Project SS and pension at RMD age
    const pensionIncome = input.incomes
        .filter(i => (i as any).className?.includes('Pension'))
        .reduce((sum, i) => sum + i.getAnnualAmount(input.year), 0);

    // Extract passive income (rental, dividends, interest, etc.)
    // Exclude RMD-sourced PassiveIncome to avoid circular dependency
    const passiveIncome = input.incomes
        .filter(i => (i as any).className === 'PassiveIncome' && (i as any).sourceType !== 'RMD')
        .reduce((sum, i) => sum + i.getAnnualAmount(input.year), 0);

    // Extract annual SS benefit from FutureSocialSecurityIncome and convert to monthly PIA
    // Use `amount` (annual) as the authoritative value since it's always kept in sync,
    // whereas `calculatedPIA` may not reflect the full benefit in all scenarios
    const futureSS = input.incomes.find(i => (i as any).className === 'FutureSocialSecurityIncome') as
        { calculatedPIA?: number; claimingAge?: number; name?: string; amount?: number; projectedPIA?: number } | undefined;
    // Prefer projectedPIA for planning (before claiming), then amount/12 (when claiming), then calculatedPIA
    // Use > 0 check instead of ?? because projectedPIA defaults to 0 (not undefined)
    const futureSS_PIA = (futureSS?.projectedPIA && futureSS.projectedPIA > 0)
        ? futureSS.projectedPIA
        : (futureSS?.amount ? futureSS.amount / 12 : (futureSS?.calculatedPIA ?? 0));
    const ssClaimingAge = futureSS?.claimingAge ?? 67;

    // inflationAdjusted=true means apply inflation/COLA effects
    // inflationAdjusted=false means no inflation/COLA (real dollars)
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

    // Calculate dynamic ceiling first (needed for target balance calculation)
    // Use net growth rate (RoR minus expense ratio) since we're projecting actual balance growth
    const grossRoR = input.assumptions.investments.returnRates.ror || (DEFAULT_GROWTH_RATE * 100);
    const tradAccounts = input.accounts.filter(a =>
        a instanceof InvestedAccount &&
        (a.taxType === 'Traditional 401k' || a.taxType === 'Traditional IRA')
    ) as InvestedAccount[];
    const totalTradBalance = tradAccounts.reduce((sum, a) => sum + a.vestedAmount, 0);
    const weightedER = totalTradBalance > 0
        ? tradAccounts.reduce((sum, a) => sum + a.expenseRatio * a.vestedAmount, 0) / totalTradBalance
        : 0;
    const growthRate = (grossRoR - weightedER) / 100;

    // Use ACA options if enabled
    let acaOptions: ACAOptions | undefined;
    if (input.acaAware && input.currentAge < 65) {
        const acaCliff = input.taxState.filingStatus === 'Married Filing Jointly' ? 125000 : 62500;
        acaOptions = {
            currentAge: input.currentAge,
            acaSubsidyAware: true,
            acaCliffThreshold: acaCliff,
            estimatedSubsidyLoss: 12000, // Conservative estimate
        };
    }

    const ceilingResult = calculateDynamicConversionCeiling(
        traditionalBalance,
        yearsUntilRMD,
        fixedIncomeAtRMD.pensionAtRMD,
        fixedIncomeAtRMD.ssAtRMD,
        passiveIncome, // Fallback only — baselineProjections.passiveAtRMD takes priority when available
        baseOrdinaryIncome,
        socialSecurityBenefits,
        0, // ltcgIncome - not known yet
        growthRate,
        rmdStartAge,
        fedParams,
        input.taxState,
        stateParams,
        acaOptions,
        input.baselineProjections, // Sub-sim projections — source of truth for SS/pension/passive/Trad@RMD
        input.assumptions, // Enables RMD-year-aware bracket lookup for peakRMDBracket
        input.conversionMode ?? 'rate-match'
    );

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
    const adjustedBaseIncome = baseOrdinaryIncome + bracketSpaceForSpending;
    const searchResult = coarseToFineSearch(
        ceilingResult.conversionCeiling,
        traditionalBalance - bracketSpaceForSpending,
        adjustedBaseIncome,
        socialSecurityBenefits,
        0, // ltcgIncome
        fedParams,
        input.taxState,
        input.year,
        null, // federal-only: state tax should not reduce conversion amount
        acaOptions,
        input.assumptions
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

            // 2. Calculate federal tax using the SAME function as solver (lines 716-724)
            const ordinaryTaxResult = TaxService.calculateTotalFederalTax(
                allOrdinaryIncome - socialSecurityBenefits, // non-SS ordinary income
                socialSecurityBenefits,
                0, // STCG
                0, // LTCG - not known yet
                preTaxDeductions,
                input.taxState.filingStatus,
                fedParams
            );

            // 3. Calculate state tax (same as solver lines 726-728)
            const stateTax = stateParams
                ? TaxService.calculateTax(allOrdinaryIncome, preTaxDeductions, stateParams)
                : 0;

            // 4. Total ordinary tax (same as solver line 732)
            const ordinaryTax = ordinaryTaxResult.totalTax + stateTax;

            // 5. Calculate base deficit using SAME formula as solver
            // Note: ordinaryTax already includes conversion tax (via allOrdinaryIncome),
            // so no separate adjustment needed for taxSource='BROKERAGE'.
            const estimatedDeficit = Math.max(0,
                input.totalLivingExpenses + ordinaryTax + ficaTax - spendableIncome - input.rmdAmount
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

    // Calculate conversion tax
    const conversionTaxResult = calculateEffectiveConversionTax(
        baseOrdinaryIncome,
        socialSecurityBenefits,
        0, // ltcgIncome
        conversionAmount,
        input.taxState.filingStatus,
        fedParams,
        stateParams,
        acaOptions
    );

    const conversionTax = conversionTaxResult.taxIncrease;
    const conversionFedTax = conversionTaxResult.breakdown.federalOrdinaryTaxCost
                           + conversionTaxResult.breakdown.ssTorpedoCost
                           + conversionTaxResult.breakdown.ltcgBumpCost
                           + conversionTaxResult.breakdown.niitCost;
    const conversionStateTax = conversionTaxResult.breakdown.stateTaxCost;

    // Determine tax payment source
    let taxSource: ConversionTaxSource = 'SURPLUS';
    let netToRoth = conversionAmount;

    const brokerageBalance = getTotalBrokerageBalance(input.accounts);

    if (surplus >= conversionTax) {
        taxSource = 'SURPLUS';
    } else if (brokerageBalance >= conversionTax) {
        taxSource = 'BROKERAGE';
    } else {
        // No surplus or brokerage to pay tax — tax is covered by the
        // spending deficit (which already includes conversion tax via
        // finalFedResult.totalTax). Full conversion amount reaches Roth.
        taxSource = 'WITHHOLD';
    }

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
    baseOrdinaryIncome: number,
    socialSecurityBenefits: number,
    fedParams: TaxParameters,
    stateParams: TaxParameters | null,
    surplus: number,
    _spendingDeficit: number,
): ConversionPlan {
    const decisions: DecisionLogEntry[] = [];
    const traditionalBalance = getTotalTraditionalBalance(input.accounts);

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
            bracketSpaceForSpending: 0,
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

    // Look up the precomputed amount; clamp to actual trad available.
    const targetConversion = input.dpConversionPlan?.get(input.year) ?? 0;
    const conversionAmount = Math.max(0, Math.min(targetConversion, traditionalBalance));

    if (conversionAmount <= 0) {
        return skipReturn('NO_BRACKET_SPACE', `DP-precomputed conversion for year ${input.year}: $0 (no plan or zero amount).`);
    }

    const sourceAccount = getFirstTraditionalAccount(input.accounts);
    const targetAccount = getFirstRothAccount(input.accounts);
    if (!sourceAccount || !targetAccount) {
        return skipReturn('TRADITIONAL_DEPLETED', 'Skipped DP conversion: no valid source or target account.');
    }

    // ACA options for the tax cost calc (same logic as rate-match path).
    let acaOptions: ACAOptions | undefined;
    if (input.acaAware && input.currentAge < 65) {
        const acaCliff = input.taxState.filingStatus === 'Married Filing Jointly' ? 125000 : 62500;
        acaOptions = {
            currentAge: input.currentAge,
            acaSubsidyAware: true,
            acaCliffThreshold: acaCliff,
            estimatedSubsidyLoss: 12000,
        };
    }

    const conversionTaxResult = calculateEffectiveConversionTax(
        baseOrdinaryIncome,
        socialSecurityBenefits,
        0,
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

    // Tax payment source selection (same priority as rate-match).
    const brokerageBalance = getTotalBrokerageBalance(input.accounts);
    let taxSource: ConversionTaxSource;
    if (surplus >= conversionTax) {
        taxSource = 'SURPLUS';
    } else if (brokerageBalance >= conversionTax) {
        taxSource = 'BROKERAGE';
    } else {
        taxSource = 'WITHHOLD';
    }

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
        bracketSpaceForSpending: 0,
        taxOptimizationTarget: {
            yearsUntilRMD: Math.max(0, rmdStartAge - input.currentAge),
            rmdStartAge,
            targetBracketCeiling: 0,
            bracketSpaceThisYear: conversionAmount,
            ssAtRMD: 0,
            pensionAtRMD: 0,
            currentTraditionalBalance: traditionalBalance,
            limitingFactor: conversionAmount >= traditionalBalance - 1
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
        baseOrdinaryIncome - socialSecurityBenefits,
        socialSecurityBenefits,
        0, 0, // no STCG/LTCG
        roughPreTaxDeductions,
        input.taxState.filingStatus,
        fedParams
    ).totalTax;
    const roughStateTax = stateParams
        ? TaxService.calculateTax(baseOrdinaryIncome, roughPreTaxDeductions, stateParams)
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
    let converged = true;

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

    // ACA withdrawal options (computed once, used in each iteration)
    const acaWithdrawalOpts = input.acaAware && input.currentAge < 65
        ? {
            acaCliffThreshold: getAcaCliffThreshold(
                input.taxState.filingStatus === 'Married Filing Jointly' ? 'married_filing_jointly' : 'single',
                input.year
            ),
            // ACA MAGI = all gross income including 100% of SS benefits.
            // taxableBase (= spendable + reinvested) already includes full SS,
            // so we just add conversion income on top.
            currentMAGI: taxableBase + conversionPlan.additionalOrdinaryIncome,
        }
        : undefined;

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
    let estimatedTradWithdrawal = 0;

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
    let finalStateTax = stateParams
        ? TaxService.calculateTax(allOrdinaryIncome - currentSSTaxable, preTaxDeductions, stateParams)
        : 0;

    const MAX_ITERATIONS = 10;
    for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
        if (iter > 0) {
            // Recompute SS taxable with Traditional withdrawal in combined income.
            // IRS combined income = AGI excluding SS + 50% × SS.
            // AGI excluding SS includes: base income + conversion + Trad withdrawal + LTCG.
            const updatedSSTaxable = TaxService.getTaxableSocialSecurityBenefits(
                socialSecurityBenefits,
                nonSSBaseIncome + conversionAdded + estimatedTradWithdrawal + estimatedLTCG,
                0,
                input.taxState.filingStatus
            );

            // Update SS taxable and allOrdinaryIncome
            currentSSTaxable = updatedSSTaxable;
            allOrdinaryIncome = nonSSBaseIncome + currentSSTaxable + conversionAdded;

            // Federal tax: allOrdinaryIncome includes taxable SS, pass SS=0
            finalFedResult = TaxService.calculateTotalFederalTax(
                allOrdinaryIncome,
                0, // SS=0: taxable SS already in allOrdinaryIncome
                0, // STCG
                estimatedLTCG,
                preTaxDeductions,
                input.taxState.filingStatus,
                fedParams
            );

            // State tax: exclude SS taxable (DC and most states exempt SS)
            // Include LTCG in base (DC and most states tax gains as ordinary income)
            finalStateTax = stateParams
                ? TaxService.calculateTax(allOrdinaryIncome - currentSSTaxable + estimatedLTCG, preTaxDeductions, stateParams)
                : 0;
        }

        // Deficit includes authoritative LTCG tax (via finalFedResult.totalTax).
        // Note: classifyIncome adds rmdAmount to spendable, so we don't subtract it again.
        const deficit =
            effectiveLivingExpenses +
            finalFedResult.totalTax +
            finalStateTax +
            ficaTax -
            incomeClassification.classified.spendable;

        if (deficit <= 0) break;

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
        withdrawalOrdinaryTax = withdrawalResult.withdrawals
            .filter(w => w.capitalGains === undefined)
            .reduce((sum, w) => sum + w.tax, 0);
        totalPenalties = withdrawalResult.totalPenalties;
        withdrawalDecisions = withdrawalResult.decisions;
        iterations = iter + 1;


        // Extract Traditional spending withdrawal (exclude RMDs — already in nonSSBaseIncome)
        const newTradWithdrawal = withdrawalResult.withdrawals
            .filter(w => w.source === 'traditional_401k' || w.source === 'traditional_ira')
            .reduce((sum, w) => sum + w.gross, 0);

        // Check convergence: both LTCG and Traditional withdrawal (which drives SS taxable) must stabilize
        const newLTCG = withdrawalResult.totalLTCG;
        const ltcgDelta = Math.abs(newLTCG - estimatedLTCG);
        const tradDelta = Math.abs(newTradWithdrawal - estimatedTradWithdrawal);
        estimatedLTCG = newLTCG;
        estimatedTradWithdrawal = newTradWithdrawal;

        if (ltcgDelta < 1 && tradDelta < 1) {
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

    // Step F: Calculate final surplus using authoritative tax values.
    // Exclude RMD entries from totalGrossWithdrawals — RMD is already in spendable
    // (classifyIncome puts it there) and including it here would double-count cash in.
    const totalGrossWithdrawals = withdrawals
        .filter(w => w.reason !== 'Required Minimum Distribution')
        .reduce((sum, w) => sum + w.gross, 0);

    // Total tax uses authoritative federal (ordinary + LTCG + NIIT) + state (with LTCG)
    // + withdrawal ordinary tax (Roth 5-year, Traditional, HSA) + FICA + penalties
    const totalTax = finalFedResult.totalTax + finalStateTax + withdrawalOrdinaryTax + ficaTax + totalPenalties;

    // Final cash flow.
    // LTCG tax is a pass-through: brokerage gross-up pays it directly to the government.
    // The deficit already included LTCG (via finalFedResult.totalTax), so the gross withdrawal
    // is deficit + ltcgTax. Counting that full gross as spendable cash-in would create a phantom
    // surplus equal to ltcgTax. Subtract it so only the net (post-tax) portion is cash-in.
    const actualLTCGTax = withdrawals
        .filter(w => w.capitalGains !== undefined)
        .reduce((sum, w) => sum + w.tax, 0);

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
        federal: finalFedResult.ordinaryTax,
        state: finalStateTax,
        fica: ficaTax,
        capitalGainsLT: finalFedResult.ltcgTax,
        capitalGainsST: 0,
        withdrawalOrdinaryTax,
        niit: finalFedResult.niitTax,
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

    // Calculate initial surplus/deficit
    // IMPORTANT: Must subtract pre-tax deductions (401k, HSA) and post-tax deductions
    // (Roth 401k, after-tax contributions) from cashIn because they reduce spendable
    // cash even though they may reduce taxes or be after-tax.
    // Note: spendable already excludes reinvested income (handled by classifyIncome).
    const incomeCashIn = incomeClassification.classified.spendable - preTaxDeductions - postTaxDeductions;
    const incomeCashOut = input.totalLivingExpenses + totalTax;
    const initialDeficit = Math.max(0, incomeCashOut - incomeCashIn);

    // Plan withdrawals if income doesn't cover expenses
    let withdrawals: PlannedWithdrawal[] = [];
    let ltcgTax = 0;
    let withdrawalOrdinaryTax = 0;
    let totalPenalties = 0;

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
        ltcgTax = withdrawalResult.withdrawals
            .filter(w => w.capitalGains !== undefined)
            .reduce((sum, w) => sum + w.tax, 0);
        withdrawalOrdinaryTax = withdrawalResult.withdrawals
            .filter(w => w.capitalGains === undefined)
            .reduce((sum, w) => sum + w.tax, 0);
        totalPenalties = withdrawalResult.totalPenalties;
        decisions.push(...withdrawalResult.decisions);
    }

    // Final cash flow including withdrawals
    const totalGrossWithdrawals = withdrawals.reduce((sum, w) => sum + w.gross, 0);
    const finalTotalTax = totalTax + ltcgTax + withdrawalOrdinaryTax + totalPenalties;

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
        niit: 0,
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
