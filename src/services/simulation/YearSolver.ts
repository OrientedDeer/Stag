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
}

interface ConversionPlan {
    conversion: PlannedConversion | null;
    conversionTax: number;
    taxSource: ConversionTaxSource;
    additionalOrdinaryIncome: number;
    decisions: DecisionLogEntry[];
    taxOptimizationTarget?: TaxOptimizationTarget;
    bracketSpaceForSpending: number;  // bracket space reserved for Traditional spending
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
                targetTraditionalAtRMD: 0,
                conversionNeededThisYear: 0,
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
                targetTraditionalAtRMD: 0,
                conversionNeededThisYear: 0,
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
    const growthRate = (input.assumptions.investments.returnRates.ror / 100) || DEFAULT_GROWTH_RATE;

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
        passiveIncome,
        baseOrdinaryIncome,
        socialSecurityBenefits,
        0, // ltcgIncome - not known yet
        growthRate,
        rmdStartAge,
        fedParams,
        input.taxState,
        stateParams,
        acaOptions
    );

    // Use idealTargetBalance from the ceiling calculation (new three-tier system)
    const idealTargetBalance = ceilingResult.idealTargetBalance;

    // Calculate PMT-based conversion amount (new pacing algorithm)
    // Formula: pmt = (currentBalance * r^n - idealTarget) * (r - 1) / (r^n - 1)
    const r = 1 + growthRate;
    let pmtConversionAmount = 0;

    if (yearsUntilRMD > 0 && growthRate > 0.001) {
        // Present value of target - if current balance exceeds this, we need to convert
        const pvTarget = idealTargetBalance / Math.pow(r, yearsUntilRMD);
        if (traditionalBalance > pvTarget) {
            const rN = Math.pow(r, yearsUntilRMD);
            pmtConversionAmount = (traditionalBalance * rN - idealTargetBalance) * (r - 1) / (rN - 1);
        }
    }

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
        targetTraditionalAtRMD: idealTargetBalance,
        conversionNeededThisYear: pmtConversionAmount,
        yearsUntilRMD,
        rmdStartAge,
        targetBracketCeiling: ceilingResult.conversionCeiling,
        bracketSpaceThisYear: ceilingResult.bracketSpacePerYear,
        ssAtRMD: fixedIncomeAtRMD.ssAtRMD,
        pensionAtRMD: fixedIncomeAtRMD.pensionAtRMD,
        // Extended fields for debugging (idealTarget = target, no separate realistic with PMT pacing)
        idealTarget: idealTargetBalance,
        realisticTarget: ceilingResult.projectedBalanceAtRMD, // What we'll actually end up with
        currentTraditionalBalance: traditionalBalance,
        onTrack: traditionalBalance <= idealTargetBalance ||
                 (pmtConversionAmount > 0 && pmtConversionAmount <= ceilingResult.bracketSpacePerYear),
        constraintDetails,
    };

    // If projected balance at RMD is below target, skip conversion
    // Compare projected balance (what we'll have at RMD without conversions) against ideal target
    // NOT current balance vs target - that's comparing apples to oranges
    const projectedBalanceAtRMD = ceilingResult.projectedBalanceAtRMD;
    if (projectedBalanceAtRMD <= idealTargetBalance) {
        decisions.push({
            category: 'conversion',
            amount: idealTargetBalance,
            description: `Skipped Roth conversion: Projected balance at RMD ($${Math.round(projectedBalanceAtRMD).toLocaleString()}) below target ($${idealTargetBalance.toLocaleString()}).`,
        });
        taxOptimizationTarget.limitingFactor = 'BALANCE_BELOW_TARGET';
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

    // Calculate conversion amount using PMT pacing (min of bracket space, PMT amount, and balance)
    // PMT pacing gives us a smoothly decreasing conversion over time to reach the ideal target
    // Can't convert what we'll spend from Traditional directly
    const availableTraditional = traditionalBalance - bracketSpaceForSpending;
    const pmtCap = pmtConversionAmount > 0 ? pmtConversionAmount : bracketSpace;
    let conversionAmount = Math.min(bracketSpace, pmtCap, availableTraditional);

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
        if (pmtConversionAmount > 0 && pmtConversionAmount < effectiveBracket) {
            constraints.push(`PMT pacing $${Math.round(pmtConversionAmount).toLocaleString()} (target $${Math.round(idealTargetBalance).toLocaleString()} in ${yearsUntilRMD}yr)`);
        }
        if (availableTraditional < effectiveBracket && availableTraditional < pmtCap) {
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
                `PMT pacing $${Math.round(pmtConversionAmount).toLocaleString()}, ` +
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
            if (projectedBalanceAtRMD <= idealTargetBalance) {
                decisions.push({
                    category: 'conversion',
                    description: `Skipped Roth conversion: Projected balance at RMD ($${Math.round(projectedBalanceAtRMD).toLocaleString()}) below target ($${Math.round(idealTargetBalance).toLocaleString()}). Future RMDs will fill 0% bracket.`,
                });
                taxOptimizationTarget.limitingFactor = 'BALANCE_BELOW_TARGET';
            } else {
                decisions.push({
                    category: 'conversion',
                    description: `Skipped Roth conversion: no bracket space available.`,
                });
                taxOptimizationTarget.limitingFactor = 'NO_BRACKET_SPACE';
            }
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

    // Determine tax payment source
    let taxSource: ConversionTaxSource = 'SURPLUS';
    let netToRoth = conversionAmount;

    const brokerageBalance = getTotalBrokerageBalance(input.accounts);

    if (surplus >= conversionTax) {
        taxSource = 'SURPLUS';
    } else if (brokerageBalance >= conversionTax) {
        taxSource = 'BROKERAGE';
    } else {
        // Default: allow withholding from conversion
        taxSource = 'WITHHOLD';
        // Withhold tax from conversion
        netToRoth = conversionAmount - conversionTax;
        if (netToRoth <= 0) {
            decisions.push({
                category: 'conversion',
                description: 'Skipped Roth conversion: withholding would leave nothing for Roth.',
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

    // Determine limiting factor if not already set
    if (!taxOptimizationTarget.limitingFactor) {
        if (conversionAmount >= bracketSpace * 0.95) {
            taxOptimizationTarget.limitingFactor = 'BRACKET_CEILING';
        } else if (pmtConversionAmount > 0 && conversionAmount >= pmtConversionAmount * 0.95) {
            taxOptimizationTarget.limitingFactor = 'PACING';
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

    // Initial surplus estimate (for determining if conversion tax can be paid from surplus)
    const initialSurplusEstimate = Math.max(0,
        incomeClassification.classified.spendable +
        input.rmdAmount -
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

    const preliminaryDeficit = Math.max(0,
        effectiveLivingExpenses + roughTax -
        incomeClassification.classified.spendable -
        input.rmdAmount
    );

    // Step B: Plan Roth conversion FIRST
    const conversionPlan = planConversion(
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
    const allOrdinaryIncome = baseOrdinaryIncome + conversionPlan.additionalOrdinaryIncome;

    // Recalculate SS taxability with conversion (used internally by calculateTotalFederalTax)
    // Note: This value is calculated for debugging/logging purposes
    const _taxableSSWithConversion = TaxService.getTaxableSocialSecurityBenefits(
        socialSecurityBenefits,
        allOrdinaryIncome - socialSecurityBenefits, // non-SS income
        0,
        input.taxState.filingStatus
    );
    void _taxableSSWithConversion; // Suppress unused warning

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

    const ordinaryTaxResult = TaxService.calculateTotalFederalTax(
        allOrdinaryIncome - socialSecurityBenefits, // non-SS ordinary income
        socialSecurityBenefits,
        0, // STCG
        0, // LTCG - not known yet
        preTaxDeductions,
        input.taxState.filingStatus,
        fedParams
    );

    const stateTax = stateParams
        ? TaxService.calculateTax(allOrdinaryIncome, preTaxDeductions, stateParams)
        : 0;

    // Ordinary tax is FIXED - includes income tax on wages, SS, pensions, conversions, Traditional withdrawals
    // This does NOT include LTCG tax - that's computed separately from withdrawal results
    const ordinaryTax = ordinaryTaxResult.totalTax + stateTax;

    // Base deficit = expenses + ordinaryTax + FICA - spendable income - RMD
    // CRITICAL: LTCG tax is NEVER included here - the algebraic gross-up handles it
    // Note: Use effectiveLivingExpenses which accounts for GK budget constraints
    // Note: ordinaryTax already includes conversion tax (via allOrdinaryIncome), so no
    // separate adjustment is needed for taxSource='BROKERAGE'. The taxSource flag is
    // purely bookkeeping - it indicates where the tax payment comes from, not that we
    // need additional withdrawal.
    const baseDeficit =
        effectiveLivingExpenses +
        ordinaryTax +
        ficaTax -
        incomeClassification.classified.spendable -
        input.rmdAmount;

    // Step E: Plan withdrawals (if deficit > 0)
    let withdrawals: PlannedWithdrawal[] = [];
    let ltcgTax = 0; // Capital gains tax from brokerage/ESPP withdrawals
    let withdrawalOrdinaryTax = 0; // Ordinary income tax from Roth earnings (5-year rule), Traditional, HSA non-medical
    let withdrawalDecisions: DecisionLogEntry[] = [];
    let totalPenalties = 0;
    let iterations = 1;
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

    if (baseDeficit > 0) {
        // Create account snapshots in withdrawal order
        let accountSnapshots;

        if (conversionPlan.bracketSpaceForSpending > 0) {
            // Tax-optimized order: put capped Traditional first, then normal order
            const allSnapshots = createOrderedSnapshots(
                input.accounts, input.withdrawalOrder, input.currentAge, input.year
            );

            const tradSnapshots: typeof allSnapshots = [];
            const otherSnapshots: typeof allSnapshots = [];
            let remainingCap = conversionPlan.bracketSpaceForSpending;

            for (const s of allSnapshots) {
                if ((s.accountType === 'traditional_401k' || s.accountType === 'traditional_ira')
                    && remainingCap > 0) {
                    const capped = Math.min(s.vestedBalance, remainingCap);
                    tradSnapshots.push({ ...s, vestedBalance: capped });
                    remainingCap -= capped;
                    // Add remaining balance back to normal order
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
        } else {
            accountSnapshots = createOrderedSnapshots(
                input.accounts, input.withdrawalOrder, input.currentAge, input.year
            );
        }

        // Plan withdrawals - algebraic gross-up handles LTCG tax calculation in 1 pass
        // No iteration loop needed: the formula gross = baseDeficit / (1 - gainRatio × ltcgRate)
        // correctly computes the withdrawal amount including LTCG tax in a single calculation.
        // The LTCG rate is determined by ordinary income (wages, SS, pensions, conversions, RMD)
        // which is fixed before withdrawal planning begins.

        // Pass ACA options so brokerage withdrawals can be capped when LTCG would breach the cliff,
        // substituting tax-free Roth withdrawals instead.
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

        const withdrawalResult = planWithdrawals(
            baseDeficit,
            accountSnapshots,
            input.currentAge,
            input.year,
            input.taxState,
            allOrdinaryIncome,
            input.assumptions,
            'Spending deficit',
            acaWithdrawalOpts
        );

        withdrawals = [
            ...withdrawals.filter(w => w.reason === 'Required Minimum Distribution'), // Keep RMD
            ...withdrawalResult.withdrawals,
        ];
        // Split withdrawal taxes by source:
        // - Capital gains tax: from brokerage/ESPP withdrawals (have w.capitalGains)
        // - Ordinary tax: from Roth earnings (5-year rule), Traditional, HSA non-medical (no w.capitalGains)
        ltcgTax = withdrawalResult.withdrawals
            .filter(w => w.capitalGains !== undefined)
            .reduce((sum, w) => sum + w.tax, 0);
        withdrawalOrdinaryTax = withdrawalResult.withdrawals
            .filter(w => w.capitalGains === undefined)
            .reduce((sum, w) => sum + w.tax, 0);
        totalPenalties = withdrawalResult.totalPenalties;
        withdrawalDecisions = withdrawalResult.decisions;
        iterations = 1; // Always 1 with algebraic gross-up
        converged = true;

        decisions.push(...withdrawalDecisions);
    }

    // Step G: Calculate final surplus
    const totalGrossWithdrawals = withdrawals.reduce((sum, w) => sum + w.gross, 0);

    // Total tax = ordinary tax + LTCG tax + withdrawal ordinary tax + FICA + penalties
    // ordinaryTax covers income tax on wages, SS, pensions, conversions
    // ltcgTax covers capital gains from brokerage withdrawals (computed by algebraic gross-up)
    // withdrawalOrdinaryTax covers tax on Roth earnings (5-year rule), Traditional, HSA non-medical
    // All of these consume cash from grossWithdrawals and must be in cashOut for surplus to be correct.
    const totalTax = ordinaryTax + ltcgTax + withdrawalOrdinaryTax + ficaTax + totalPenalties;

    // Final cash flow
    const cashIn =
        incomeClassification.classified.spendable +
        totalGrossWithdrawals;

    const cashOut =
        effectiveLivingExpenses +
        totalTax;

    const surplus = Math.max(0, cashIn - cashOut);
    const unfundedDeficit = Math.max(0, cashOut - cashIn);

    if (unfundedDeficit > 0) {
        decisions.push({
            category: 'warning',
            amount: unfundedDeficit,
            description: `Unfunded deficit of $${unfundedDeficit.toLocaleString()}. Insufficient account balances.`,
        });
    }

    // Build tax summary
    // ordinaryTax = federal ordinary + state ordinary (calculated once, never includes LTCG)
    // ltcgTax = LTCG tax from brokerage/ESPP withdrawals (capital gains)
    // withdrawalOrdinaryTax = tax from Roth earnings (5-year rule), Traditional withdrawals, HSA non-medical
    const stateTaxAmount = stateParams ? TaxService.calculateTax(allOrdinaryIncome, preTaxDeductions, stateParams) : 0;
    const taxSummary: YearPlanTax = {
        federal: ordinaryTax - stateTaxAmount,
        state: stateTaxAmount,
        fica: ficaTax,
        capitalGainsLT: ltcgTax, // Capital gains tax from brokerage/ESPP withdrawals
        capitalGainsST: 0,
        withdrawalOrdinaryTax, // Tax from Roth earnings (5-year rule), Traditional, HSA non-medical
        niit: 0, // Would need to calculate separately
        penalties: totalPenalties,
        total: totalTax,
    };

    // Step G: Allocate surplus (if any)
    let surplusAllocations: YearPlan['surplusAllocations'] = [];
    if (surplus > 0) {
        const priorityBuckets = (input.assumptions.priorities || []).map((p, idx) => ({
            accountId: p.accountId || '',
            priority: idx,
        })).filter(p => p.accountId);

        const earnedIncome = TaxService.getEarnedIncome(input.incomes, input.year);
        const surplusSettings: SurplusAllocationSettings = {
            emergencyFundTarget: DEFAULT_EMERGENCY_FUND_TARGET,
            rothIRAContributionEnabled: true,
            rothIRALimit: getIRALimit(input.year, input.currentAge, input.assumptions.macro.inflationAdjusted),
            rothIRAContributedThisYear: 0,
        };

        const surplusResult = allocateSurplus(
            surplus,
            input.accounts,
            priorityBuckets,
            earnedIncome,
            surplusSettings
        );

        surplusAllocations = surplusResult.allocations;
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
 * Solve a working year (simpler - no withdrawals/conversions).
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

    // Calculate surplus/deficit
    // IMPORTANT: Must subtract pre-tax deductions (401k, HSA) and post-tax deductions
    // (Roth 401k, after-tax contributions) from cashIn because they reduce spendable
    // cash even though they may reduce taxes or be after-tax.
    // Note: spendable already excludes reinvested income (handled by classifyIncome).
    const cashIn = incomeClassification.classified.spendable - preTaxDeductions - postTaxDeductions;
    const cashOut = input.totalLivingExpenses + totalTax;
    const surplus = Math.max(0, cashIn - cashOut);
    const unfundedDeficit = Math.max(0, cashOut - cashIn);

    const taxSummary: YearPlanTax = {
        federal: taxResult.totalTax,
        state: stateTax,
        fica: ficaTax,
        capitalGainsLT: 0,
        capitalGainsST: 0,
        withdrawalOrdinaryTax: 0,
        niit: 0,
        penalties: 0,
        total: totalTax,
    };

    // Allocate surplus (if any)
    let surplusAllocations: YearPlan['surplusAllocations'] = [];
    if (surplus > 0) {
        const priorityBuckets = (input.assumptions.priorities || []).map((p, idx) => ({
            accountId: p.accountId || '',
            priority: idx,
        })).filter(p => p.accountId);

        const earnedIncome = TaxService.getEarnedIncome(input.incomes, input.year);
        const surplusSettings: SurplusAllocationSettings = {
            emergencyFundTarget: DEFAULT_EMERGENCY_FUND_TARGET,
            rothIRAContributionEnabled: true,
            rothIRALimit: getIRALimit(input.year, input.currentAge, input.assumptions.macro.inflationAdjusted),
            rothIRAContributedThisYear: 0,
        };

        const surplusResult = allocateSurplus(
            surplus,
            input.accounts,
            priorityBuckets,
            earnedIncome,
            surplusSettings
        );

        surplusAllocations = surplusResult.allocations;
        decisions.push(...surplusResult.decisions);
    }

    return {
        year: input.year,
        isRetired: false,
        income: incomeClassification.classified,
        withdrawals: [],
        conversion: null,
        contributions: [], // Will be filled by contribution planning
        surplusAllocations,
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
