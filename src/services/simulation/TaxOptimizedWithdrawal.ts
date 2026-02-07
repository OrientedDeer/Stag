/**
 * Tax-Optimized Withdrawal and Roth Conversion Service
 *
 * Implements the tax optimization strategy described in TAX_OPTIMIZATION_IMPLEMENTATION.md.
 * Key features:
 * - Dynamic conversion ceiling based on projected RMD bracket
 * - Target Traditional balance to keep RMDs in low brackets
 * - SS torpedo and LTCG bump zone awareness
 * - Four-phase withdrawal logic with survival spending priority
 */

import { TaxParameters, FilingStatus } from '../../data/TaxData';
import * as TaxService from '../../components/Objects/Taxes/TaxService';
import { TaxState } from '../../components/Objects/Taxes/TaxContext';
import { AssumptionsState } from '../../components/Objects/Assumptions/AssumptionsContext';
import { calculateEffectiveConversionTax, ACAOptions } from './helpers';
import { BaselineProjections } from './types';

// Re-export for convenience
export type { TaxParameters, FilingStatus, TaxState };

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

/**
 * Which phase of retirement we're in
 */
export type Phase =
    | 'BROKERAGE_AVAILABLE'    // Brokerage covers spending; conversions get full bracket space
    | 'BROKERAGE_TRANSITION'   // Brokerage running low (0.5-2 years); reduce conversion aggressiveness
    | 'BROKERAGE_DEPLETED'     // No brokerage; survival spending has first claim on bracket space
    | 'ROTH_DEPLETED';         // No Roth either; Traditional is primary source, no conversions

/**
 * How conversion taxes will be funded
 */
export type TaxPaymentSource = 'BROKERAGE' | 'SAVINGS' | 'WITHHOLD' | 'NONE';

/**
 * What caused the effective rate limit to be reached
 */
export type EdgeType =
    | 'SS_TORPEDO'        // Social Security taxation caused >25% rate jump
    | 'LTCG_BUMP'         // Long-term capital gains pushed from 0% to 15%
    | 'BRACKET_EDGE'      // Normal tax bracket boundary
    | 'ALREADY_AT_CEILING'; // Already at or above target rate at zero conversion

/**
 * Result of calculating how much can be converted before exceeding target effective rate
 */
export interface EffectiveRateLimitResult {
    /** Maximum conversion amount before exceeding target rate */
    maxConversion: number;

    /** The effective marginal rate at the max conversion amount */
    effectiveRateAtMax: number;

    /** The nominal tax bracket at the max conversion amount */
    bracketAtMax: number;

    /** What caused the limit (SS torpedo, LTCG bump, or bracket edge) */
    edgeType: EdgeType | null;
}

/**
 * Result of dynamic conversion ceiling calculation
 */
export interface ConversionCeilingResult {
    /** The tax bracket rate to convert up to (e.g., 0.22 for 22%) */
    conversionCeiling: number;

    /** Bracket space available per year up to the ceiling */
    bracketSpacePerYear: number;

    /** What Traditional balance will realistically be at RMD age */
    projectedBalanceAtRMD: number;

    /** What bracket RMDs will land in given projected balance */
    projectedRMDBracket: number;

    /** What balance WOULD keep RMDs in 12% bracket (may be unachievable) */
    idealTargetBalance: number;
}

/**
 * Result of target balance calculation
 */
export interface TargetBalanceResult {
    /** Balance that keeps RMDs in low brackets */
    idealTarget: number;

    /** What we can realistically achieve */
    realisticTarget: number;

    /** max(ideal, realistic) - the effective target to use */
    effectiveTarget: number;

    /** How much to convert this year to stay on track */
    conversionNeededThisYear: number;

    /** Are we above or below target? */
    aboveTarget: boolean;

    /** What's limiting this year's conversion (for debugging) */
    limitingFactor?: 'BRACKET_CEILING' | 'SS_TORPEDO' | 'ACA_CLIFF' | 'BALANCE_BELOW_TARGET' | 'PACING' | 'NO_BRACKET_SPACE';
}

/**
 * The complete plan for a simulation year
 */
export interface TaxOptimizedYearPlan {
    /** Which phase we're in */
    phase: Phase;

    /** Roth conversion amount for this year (gross, before withholding) */
    conversionAmount: number;

    /** Amount withheld from conversion for taxes (0 if paid from other source) */
    conversionWithholding: number;

    /** Net amount that actually arrives in Roth */
    netConversionToRoth: number;

    /** How conversion taxes are funded (NONE if no conversion) */
    taxPaymentSource: TaxPaymentSource;

    /** Withdrawal amounts by source */
    withdrawals: {
        traditional: number;  // For spending (not conversion)
        roth: number;
        brokerage: number;
        savings: number;
    };

    /** Bracket we're converting/spending up to */
    conversionCeiling: number;

    /** For UI display */
    projectedRMDBracket: number;
    effectiveTarget: number;

    /** Effective marginal rate after all allocations (for invariant verification) */
    effectiveRateAfterAllocation: number;

    /** Breakdown of bracket space usage */
    bracketSpaceUsed: {
        byConversion: number;
        byTraditionalSpending: number;
        remaining: number;
    };

    /** Structural changes this year that may affect ceiling (for logging) */
    structuralChanges?: string[];
}

/**
 * Configuration options for tax optimization
 */
export interface TaxOptimizationSettings {
    /** Whether tax optimization is enabled */
    enabled: boolean;

    /** Whether to allow conversions after RMD age (rare edge case) */
    allowPostRMDConversions?: boolean;

    /** Whether to cap conversions to preserve ACA subsidies (for under-65 retirees) */
    acaSubsidyAware?: boolean;
}

/**
 * Result of coarse-to-fine search for max conversion amount
 */
export interface CoarseToFineSearchResult {
    /** Maximum conversion amount before exceeding target rate */
    amount: number;

    /** Whether the search converged within tolerance */
    converged: boolean;

    /** Type of edge that caused the limit (null if no limit reached) */
    edgeType: EdgeType | null;
}

// =============================================================================
// CONSTANTS
// =============================================================================

/**
 * Configuration for coarse-to-fine search algorithm
 */
export const SEARCH_CONFIG = {
    /** Coarse scan increment for initial sweep */
    coarseStep: 5_000,

    /** Minimum step size for fine binary search */
    fineMinStep: 100,

    /** Maximum iterations for binary search */
    maxIterations: 50,

    /** Tolerance for rate matching (±0.25%) */
    epsilon: 0.0025,

    /** Maximum conversion amount to consider (practical limit) */
    maxConversionCap: 500_000,
} as const;

/**
 * Maximum bracket for Roth conversions.
 * We cap at 32% because prepaying 35%+ tax on conversions is rarely beneficial.
 */
export const MAX_CONVERSION_BRACKET = 0.32;

/**
 * Get bracket progression from tax parameters, capped at MAX_CONVERSION_BRACKET.
 * We cap at 32% because prepaying 35%+ tax on conversions is rarely beneficial.
 */
export function getBracketProgression(taxParams: TaxParameters): number[] {
    return taxParams.brackets
        .map(b => b.rate)
        .filter(rate => rate <= MAX_CONVERSION_BRACKET);
}

/**
 * IRS Uniform Lifetime Table - RMD divisors by age (2024+)
 * Source: IRS Publication 590-B
 */
export const RMD_DIVISORS: Record<number, number> = {
    72: 27.4,
    73: 26.5,
    74: 25.5,
    75: 24.6,
    76: 23.7,
    77: 22.9,
    78: 22.0,
    79: 21.1,
    80: 20.2,
    81: 19.4,
    82: 18.5,
    83: 17.7,
    84: 16.8,
    85: 16.0,
    86: 15.2,
    87: 14.4,
    88: 13.7,
    89: 12.9,
    90: 12.2,
    91: 11.5,
    92: 10.8,
    93: 10.1,
    94: 9.5,
    95: 8.9,
} as const;

/**
 * Get the RMD divisor for a given age.
 * Uses IRS Uniform Lifetime Table values.
 *
 * @param age - Age at end of year
 * @returns RMD divisor (distribution period)
 */
export function getRMDDivisor(age: number): number {
    if (age < 72) return 0; // No RMD before 72

    // Return from table if available
    if (age in RMD_DIVISORS) {
        return RMD_DIVISORS[age];
    }

    // For ages beyond table, estimate with linear extrapolation
    // (divisor decreases ~0.9 per year after 95)
    if (age > 95) {
        return Math.max(1.0, 8.9 - (age - 95) * 0.9);
    }

    return 0;
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Get the damping factor for conversion calculations based on years until RMD.
 * More aggressive (higher %) when time is short, conservative when time is long.
 *
 * @param yearsUntilRMD - Years remaining until Required Minimum Distributions start
 * @returns Damping factor between 0.15 and 0.50
 */
export function getDampingFactor(yearsUntilRMD: number): number {
    if (yearsUntilRMD >= 15) return 0.15;  // Very conservative when lots of time
    if (yearsUntilRMD >= 10) return 0.20;
    if (yearsUntilRMD >= 7) return 0.25;
    if (yearsUntilRMD >= 5) return 0.30;
    if (yearsUntilRMD >= 3) return 0.40;
    return 0.50;  // Aggressive when time is very short
}

/**
 * Get the ACA subsidy cliff threshold (400% FPL) for a given year and filing status.
 * Values should be updated annually when FPL is published (typically January).
 *
 * @param filingStatus - 'single' or 'married_filing_jointly'
 * @param year - The tax year
 * @returns The income threshold where ACA subsidies phase out completely
 */
export function getAcaCliffThreshold(
    filingStatus: 'single' | 'married_filing_jointly',
    year: number
): number {
    // Base FPL values by year (update annually when published)
    // 400% FPL = threshold where ACA subsidies phase out completely
    const FPL_BASE: Record<number, { single: number; couple: number }> = {
        2024: { single: 15_060, couple: 20_440 },
        2025: { single: 15_650, couple: 21_150 },  // Estimated
        2026: { single: 16_100, couple: 21_750 },  // Estimated ~3% inflation
    };

    // Use most recent known year if future year requested
    const knownYears = Object.keys(FPL_BASE).map(Number).sort((a, b) => b - a);
    const useYear = knownYears.find(y => y <= year) ?? knownYears[knownYears.length - 1];
    const fpl = FPL_BASE[useYear];

    const baseFPL = filingStatus === 'single' ? fpl.single : fpl.couple;

    // 400% FPL is the cliff
    return baseFPL * 4;
}

/**
 * Get the effective MARGINAL tax rate for a conversion at a given amount.
 * Calculates (total cost at amount+1 - total cost at amount) to get the marginal rate.
 *
 * This properly handles SS torpedo, LTCG bump, NIIT, state tax, and ACA cliff.
 * Uses taxIncrease (which includes federal + state + ACA) not just taxAfter (federal only).
 */
export function getEffectiveConversionRate(
    conversionAmount: number,
    ordinaryIncome: number,
    ltcgIncome: number,
    socialSecurity: number,
    taxParams: TaxParameters,
    taxState: TaxState,
    _year: number,
    stateParams: TaxParameters | null,
    acaOptions?: ACAOptions
): number {
    // Calculate total cost of converting conversionAmount
    // taxIncrease includes federal tax increase + state tax + ACA subsidy loss
    const resultAtAmount = calculateEffectiveConversionTax(
        ordinaryIncome,
        socialSecurity,
        ltcgIncome,
        Math.max(0, conversionAmount),
        taxState.filingStatus,
        taxParams,
        stateParams,
        acaOptions
    );

    // Calculate total cost of converting conversionAmount + $1
    const resultAtAmountPlus1 = calculateEffectiveConversionTax(
        ordinaryIncome,
        socialSecurity,
        ltcgIncome,
        Math.max(0, conversionAmount) + 1,
        taxState.filingStatus,
        taxParams,
        stateParams,
        acaOptions
    );

    // Marginal rate = difference in total cost for $1 more conversion
    // taxIncrease is the cost of converting that amount vs not converting at all
    // So the difference gives us the marginal cost of the last $1
    return resultAtAmountPlus1.taxIncrease - resultAtAmount.taxIncrease;
}

/**
 * Coarse-to-fine search for maximum conversion amount before exceeding target effective rate.
 *
 * Pure binary search fails on plateaus and discontinuities (SS torpedo, LTCG bump zones).
 * This algorithm:
 * 1. Coarse scan in $5k increments to find the edge
 * 2. Identify edge type based on rate jump magnitude
 * 3. Fine binary search within the identified window
 * 4. Return conservative lower bound
 *
 * @param targetRate - Target effective tax rate to stay under (e.g., 0.22 for 22%)
 * @param traditionalBalance - Available Traditional IRA/401k balance
 * @param currentAGI - Current AGI before conversion (gross income)
 * @param socialSecurity - Annual Social Security benefits
 * @param ltcgIncome - Long-term capital gains income
 * @param taxParams - Federal tax parameters
 * @param taxState - Tax state (filing status, etc.)
 * @param year - Tax year
 * @param stateParams - State tax parameters (null if no state tax)
 * @param acaOptions - ACA subsidy awareness options (undefined if not applicable)
 * @param assumptions - Optional assumptions for inflation adjustments
 * @returns Search result with amount, convergence status, and edge type
 */
export function coarseToFineSearch(
    targetRate: number,
    traditionalBalance: number,
    currentAGI: number,
    socialSecurity: number,
    ltcgIncome: number,
    taxParams: TaxParameters,
    taxState: TaxState,
    year: number,
    stateParams: TaxParameters | null,
    acaOptions: ACAOptions | undefined,
    _assumptions?: AssumptionsState,  // Reserved for future inflation adjustments
    _debugLabel?: string  // For debug logging
): CoarseToFineSearchResult {
    const maxAmount = Math.min(traditionalBalance, SEARCH_CONFIG.maxConversionCap);

    // EDGE CASE: Check if we're already above target rate at zero conversion
    const rateAtZero = getEffectiveConversionRate(
        0,
        currentAGI,
        ltcgIncome,
        socialSecurity,
        taxParams,
        taxState,
        year,
        stateParams,
        acaOptions
    );


    if (rateAtZero > targetRate + SEARCH_CONFIG.epsilon) {
        // Already ABOVE target rate from other income - cannot convert anything
        // Note: if rateAtZero ≈ targetRate (within epsilon), we're IN the target bracket
        // and can still convert up to the top of that bracket
        return { amount: 0, converged: true, edgeType: 'ALREADY_AT_CEILING' };
    }

    // PHASE 1: Coarse scan to find the bracket edge
    let edgeFound = false;
    let edgeLow = 0;
    let edgeHigh = 0;
    let edgeType: EdgeType | null = null;

    // Special case: Check ACA cliff threshold specifically since coarse step might jump over it
    // The cliff creates a rate spike at exactly the crossing point
    if (acaOptions && acaOptions.acaSubsidyAware && acaOptions.currentAge < 65) {
        const cliffConversion = Math.max(0, acaOptions.acaCliffThreshold - currentAGI);
        if (cliffConversion > 0 && cliffConversion <= maxAmount) {
            // Check rate just before and at the cliff
            const rateBeforeCliff = getEffectiveConversionRate(
                cliffConversion - 1,
                currentAGI,
                ltcgIncome,
                socialSecurity,
                taxParams,
                taxState,
                year,
                stateParams,
                acaOptions
            );
            if (rateBeforeCliff > targetRate) {
                // Already over target before cliff
                edgeFound = true;
                edgeLow = 0;
                edgeHigh = cliffConversion - 1;
                edgeType = 'BRACKET_EDGE';
            } else {
                // Check if the cliff crossing exceeds target
                const rateAtCliff = getEffectiveConversionRate(
                    cliffConversion,
                    currentAGI,
                    ltcgIncome,
                    socialSecurity,
                    taxParams,
                    taxState,
                    year,
                    stateParams,
                    acaOptions
                );
                // The cliff causes a massive spike at exactly cliffConversion - 1
                // (because converting $1 more would cross the cliff)
                if (rateAtCliff > targetRate || rateAtCliff >= 1.0) {
                    // Cliff crossing would exceed target - cap at cliff - 1
                    return {
                        amount: Math.max(0, cliffConversion - 1),
                        converged: true,
                        edgeType: 'BRACKET_EDGE'
                    };
                }
            }
        }
    }

    for (let amount = 0; amount <= maxAmount; amount += SEARCH_CONFIG.coarseStep) {
        const rate = getEffectiveConversionRate(
            amount,
            currentAGI,
            ltcgIncome,
            socialSecurity,
            taxParams,
            taxState,
            year,
            stateParams,
            acaOptions
        );

        // Use epsilon tolerance to avoid numerical precision issues
        // We want to find where rate CLEARLY exceeds target, not just barely
        if (rate > targetRate + SEARCH_CONFIG.epsilon) {
            // Found the edge - it's somewhere in the previous $5k window
            edgeFound = true;
            edgeLow = Math.max(0, amount - SEARCH_CONFIG.coarseStep);
            edgeHigh = amount;

            // Identify edge type for logging based on rate jump magnitude
            const rateBefore = getEffectiveConversionRate(
                edgeLow,
                currentAGI,
                ltcgIncome,
                socialSecurity,
                taxParams,
                taxState,
                year,
                stateParams,
                acaOptions
            );
            const rateJump = rate - rateBefore;

            // Thresholds based on actual discontinuity magnitudes:
            // - SS torpedo: Can cause 40%+ effective rates (jump of 25%+)
            // - LTCG bump: 0% to 15% LTCG rate (jump of ~12-15%)
            // - Bracket edge: Normal bracket transitions (10-12% jumps max)
            if (rateJump > 0.25) {
                edgeType = 'SS_TORPEDO';
            } else if (rateJump > 0.12) {
                edgeType = 'LTCG_BUMP';
            } else {
                edgeType = 'BRACKET_EDGE';
            }
            break;
        }
    }

    if (!edgeFound) {
        // Never exceeded target rate - can convert everything
        return { amount: maxAmount, converged: true, edgeType: null };
    }

    // PHASE 2: Fine binary search within the identified window
    let low = edgeLow;
    let high = edgeHigh;
    let iterations = 0;

    while (high - low > SEARCH_CONFIG.fineMinStep &&
           iterations < SEARCH_CONFIG.maxIterations) {
        const mid = Math.floor((low + high) / 2);
        const rate = getEffectiveConversionRate(
            mid,
            currentAGI,
            ltcgIncome,
            socialSecurity,
            taxParams,
            taxState,
            year,
            stateParams,
            acaOptions
        );

        // We want to find the MAXIMUM conversion where rate <= target
        // When rate ≈ target (within epsilon), it's still valid, so search higher
        // Only search lower when rate clearly exceeds target
        if (rate <= targetRate + SEARCH_CONFIG.epsilon) {
            low = mid;  // Valid amount, search higher for max
        } else {
            high = mid;  // Too high, search lower
        }
        iterations++;
    }

    // Return conservative lower bound
    return {
        amount: low,
        converged: iterations < SEARCH_CONFIG.maxIterations,
        edgeType
    };
}

/**
 * Calculate how much can be converted before effective marginal rate exceeds a target rate.
 *
 * Uses coarse-to-fine search to handle the complexities of the SS tax torpedo
 * (effective rates can be much higher than nominal brackets) and other
 * discontinuities like LTCG bump zones.
 *
 * Properly handles SS torpedo, LTCG bump, NIIT, state tax, and ACA cliff
 * via calculateEffectiveConversionTax.
 *
 * @param currentAGI - AGI before conversion (gross income)
 * @param socialSecurityBenefits - Total SS benefits
 * @param ltcgIncome - Long-term capital gains (for bump zone detection)
 * @param targetEffectiveRate - Stop when effective rate exceeds this
 * @param traditionalBalance - Available Traditional IRA/401k balance
 * @param taxParams - Federal tax parameters
 * @param taxState - Tax state (filing status, etc.)
 * @param year - Tax year
 * @param stateParams - State tax parameters (null if no state tax)
 * @param acaOptions - ACA subsidy awareness options (undefined if not applicable)
 * @param assumptions - Optional assumptions for inflation adjustments
 * @returns Result with maxConversion, effectiveRateAtMax, bracketAtMax, and edgeType
 */
export function calculateEffectiveRateConversionLimit(
    currentAGI: number,
    socialSecurityBenefits: number,
    ltcgIncome: number,
    targetEffectiveRate: number,
    traditionalBalance: number,
    taxParams: TaxParameters,
    taxState: TaxState,
    year: number,
    stateParams: TaxParameters | null,
    acaOptions: ACAOptions | undefined,
    assumptions?: AssumptionsState
): EffectiveRateLimitResult {
    // Use coarse-to-fine search to find max conversion staying below target effective rate
    const searchResult = coarseToFineSearch(
        targetEffectiveRate,
        traditionalBalance,
        currentAGI,
        socialSecurityBenefits,
        ltcgIncome,
        taxParams,
        taxState,
        year,
        stateParams,
        acaOptions,
        assumptions
    );

    // Calculate the effective rate at the found amount
    const effectiveRateAtMax = getEffectiveConversionRate(
        searchResult.amount,
        currentAGI,
        ltcgIncome,
        socialSecurityBenefits,
        taxParams,
        taxState,
        year,
        stateParams,
        acaOptions
    );

    // Find nominal bracket at the conversion amount
    // Approximate by looking at total income
    const totalIncome = currentAGI + searchResult.amount;
    const taxableAtMax = Math.max(0, totalIncome - taxParams.standardDeduction);
    let bracketAtMax = 0;
    for (const bracket of taxParams.brackets) {
        if (taxableAtMax >= bracket.threshold) {
            bracketAtMax = bracket.rate;
        }
    }

    return {
        maxConversion: searchResult.amount,
        effectiveRateAtMax,
        bracketAtMax,
        edgeType: searchResult.edgeType
    };
}

/**
 * Calculate what Traditional balance at RMD age would keep RMDs in a target bracket.
 *
 * Uses effective rate calculation to properly account for:
 * - SS torpedo (RMD can push more SS into taxable territory)
 * - LTCG bump zone
 * - NIIT
 * - State tax
 *
 * Formula: IdealBalance = MaxRMDInBracket × RMDDivisor
 *
 * @param pensionIncomeAtRMD - Non-SS fixed income at RMD age (pensions, annuities)
 * @param ssAtRMD - Social Security benefits at RMD age
 * @param targetBracket - Target tax bracket rate (e.g., 0.12 for 12%)
 * @param rmdStartAge - Age when RMDs begin (typically 73 or 75)
 * @param taxParams - Federal tax parameters
 * @param taxState - Tax state (filing status, etc.)
 * @param stateParams - State tax parameters (null if no state tax)
 * @param year - Tax year for bracket calculations
 * @returns Ideal Traditional balance at RMD age
 */
export function calculateIdealTargetBalance(
    pensionIncomeAtRMD: number,
    ssAtRMD: number,
    passiveIncomeAtRMD: number,
    targetBracket: number,
    rmdStartAge: number,
    taxParams: TaxParameters
): number {
    const rmdDivisor = getRMDDivisor(rmdStartAge);
    if (rmdDivisor === 0) {
        return 0;
    }

    // Simple bracket math approach:
    // 1. Find the CEILING of the target bracket (threshold of NEXT bracket)
    // 2. Add standard deduction to get gross income ceiling
    // 3. Subtract taxable SS and pension to get RMD space
    // 4. Multiply by RMD divisor

    // Find the ceiling of the target bracket (threshold of the next bracket)
    const sortedBrackets = [...taxParams.brackets].sort((a, b) => a.rate - b.rate);
    const targetBracketIndex = sortedBrackets.findIndex(b => b.rate === targetBracket);

    let bracketCeiling: number;
    if (targetBracketIndex >= 0 && targetBracketIndex < sortedBrackets.length - 1) {
        // Ceiling is the threshold of the NEXT bracket
        bracketCeiling = sortedBrackets[targetBracketIndex + 1].threshold;
    } else {
        // Target is highest bracket or not found - use a large number
        bracketCeiling = 1_000_000;
    }

    // Gross income ceiling = bracket ceiling (taxable) + standard deduction
    const grossCeiling = bracketCeiling + taxParams.standardDeduction;

    // Calculate taxable SS at RMD age
    // At RMD age with significant income, typically 85% of SS is taxable
    // Use conservative 85% estimate for simplicity
    const taxableSS = ssAtRMD * 0.85;

    // RMD space = gross ceiling - taxable SS - pension income - passive income
    const maxRMD = Math.max(0, grossCeiling - taxableSS - pensionIncomeAtRMD - passiveIncomeAtRMD);

    // Ideal balance = maxRMD × RMD divisor
    const idealBalance = maxRMD * rmdDivisor;

    // DEBUG: Trace target balance calculation (disabled - too noisy)
    // console.log('[calculateIdealTargetBalance] Inputs:', { pensionIncomeAtRMD, ssAtRMD, passiveIncomeAtRMD, targetBracket, rmdStartAge, standardDeduction: taxParams.standardDeduction });
    // console.log('[calculateIdealTargetBalance] Intermediate values:', { rmdDivisor, bracketCeiling, grossCeiling, taxableSS, maxRMD, idealBalance });

    return idealBalance;
}

/**
 * Project what Traditional balance will be at RMD age given a conversion rate.
 *
 * For each year: balance = balance × (1 + growthRate) - annualConversionAmount
 *
 * @param currentBalance - Current Traditional balance
 * @param yearsUntilRMD - Years remaining until RMD age
 * @param annualConversionAmount - Amount to convert each year
 * @param growthRate - Expected annual growth rate (e.g., 0.07 for 7%)
 * @returns Projected balance at RMD age (floored at 0)
 */
export function projectBalanceAtRMD(
    currentBalance: number,
    yearsUntilRMD: number,
    annualConversionAmount: number,
    growthRate: number
): number {
    // Handle edge cases
    if (yearsUntilRMD <= 0) {
        return currentBalance;
    }

    // Zero growth is a special case - simple subtraction
    if (growthRate === 0) {
        const projectedBalance = currentBalance - (yearsUntilRMD * annualConversionAmount);
        return Math.max(0, projectedBalance);
    }

    // Use iterative calculation (clearer than closed-form)
    // For each year: balance grows, then conversion is removed
    let balance = currentBalance;

    for (let year = 0; year < yearsUntilRMD; year++) {
        // Growth first
        balance = balance * (1 + growthRate);

        // Then conversion
        balance = balance - annualConversionAmount;

        // Floor at 0 - can't go negative
        if (balance <= 0) {
            return 0;
        }
    }

    return Math.max(0, balance);
}

/**
 * Find the optimal bracket ceiling for conversions using a simple three-tier system.
 *
 * Algorithm:
 * 1. Compute baseline projected balance assuming only 12% bracket conversions each year
 * 2. Determine peak RMD bracket from baseline using mid-retirement divisor (15)
 * 3. Set ceiling from three-tier table based on peak RMD bracket
 * 4. Return bracket space at that ceiling for PMT pacing
 *
 * Three-tier ceiling table:
 * - Peak RMD bracket <= 12%: ceiling = 0% (standard deduction only)
 * - Peak RMD bracket is 22% or 24%: ceiling = 12%
 * - Peak RMD bracket >= 32%: ceiling = 24%
 *
 * Principle: Only convert at a rate that is at least two bracket tiers below
 * the projected RMD rate. This ensures real savings after accounting for
 * sequence-of-returns risk.
 *
 * @param currentTraditionalBalance - Current Traditional IRA/401k balance
 * @param yearsUntilRMD - Years remaining until RMD age
 * @param pensionIncomeAtRMD - Non-SS fixed income at RMD age (pensions, annuities)
 * @param ssAtRMD - Social Security benefits at RMD age
 * @param currentAGI - This year's AGI (excluding SS)
 * @param socialSecurityThisYear - This year's SS benefits
 * @param ltcgIncome - Long-term capital gains (for bump zone detection)
 * @param growthRate - Expected annual growth rate
 * @param rmdStartAge - Age at which RMDs begin (72, 73, or 75 based on birth year)
 * @param taxParams - Federal tax parameters
 * @param taxState - Tax state (filing status, etc.)
 * @returns ConversionCeilingResult with ceiling, bracket space, projections
 */
export function calculateDynamicConversionCeiling(
    currentTraditionalBalance: number,
    yearsUntilRMD: number,
    pensionIncomeAtRMD: number,
    ssAtRMD: number,
    passiveIncomeAtRMD: number,
    currentAGI: number,
    socialSecurityThisYear: number,
    ltcgIncome: number,
    growthRate: number,
    rmdStartAge: number,
    taxParams: TaxParameters,
    taxState: TaxState,
    stateParams: TaxParameters | null = null,
    acaOptions?: ACAOptions,
    baselineProjections?: BaselineProjections
): ConversionCeilingResult {
    // If already at RMD age, no conversions
    if (yearsUntilRMD <= 0) {
        return {
            conversionCeiling: 0,
            bracketSpacePerYear: 0,
            projectedBalanceAtRMD: currentTraditionalBalance,
            projectedRMDBracket: 0,
            idealTargetBalance: 0
        };
    }

    // Use baseline projections if available for fixed income at RMD
    const effectiveSsAtRMD = baselineProjections?.ssAtRMD ?? ssAtRMD;
    const effectivePensionAtRMD = baselineProjections?.pensionAtRMD ?? pensionIncomeAtRMD;

    // =========================================================================
    // STEP 1: Compute baseline projected balance with NO conversions
    // =========================================================================
    // Project balance forward with NO conversions to see worst-case RMD bracket.
    // This avoids circular logic: we need to know where RMDs would land WITHOUT
    // intervention to decide IF we should intervene.

    let baselineBalance = currentTraditionalBalance;
    for (let year = 0; year < yearsUntilRMD; year++) {
        baselineBalance = baselineBalance * (1 + growthRate);
    }

    // =========================================================================
    // STEP 2: Determine peak RMD bracket from baseline
    // =========================================================================

    const PEAK_RMD_DIVISOR = 15;  // Approximates age ~87 (mid-retirement)
    const peakRMD = baselineBalance / PEAK_RMD_DIVISOR;

    // Calculate taxable SS at peak RMD
    const peakTaxableSS = TaxService.getTaxableSocialSecurityBenefits(
        effectiveSsAtRMD,
        effectivePensionAtRMD + peakRMD + passiveIncomeAtRMD,
        0,
        taxState.filingStatus
    );
    const peakTaxableIncome = peakRMD + effectivePensionAtRMD + passiveIncomeAtRMD + peakTaxableSS - taxParams.standardDeduction;
    const peakRMDBracket = TaxService.getMarginalTaxRate(Math.max(0, peakTaxableIncome), taxParams).rate;

    // =========================================================================
    // STEP 3: Set ceiling from three-tier table
    // =========================================================================

    // Three-tier ceiling: convert at least two brackets below projected RMD bracket
    let ceiling: number;
    if (peakRMDBracket <= 0.12) {
        // RMDs will be in 12% or lower - only use standard deduction space
        ceiling = 0;
    } else if (peakRMDBracket <= 0.24) {
        // RMDs will be in 22% or 24% - convert at 12%
        ceiling = 0.12;
    } else {
        // RMDs will be in 32%+ - convert at 24%
        ceiling = 0.24;
    }

    // =========================================================================
    // STEP 4: Compute bracket space at the selected ceiling
    // =========================================================================

    let bracketSpacePerYear = 0;
    if (ceiling > 0) {
        const conversionLimit = calculateEffectiveRateConversionLimit(
            currentAGI,
            socialSecurityThisYear,
            ltcgIncome,
            ceiling,
            currentTraditionalBalance,
            taxParams,
            taxState,
            taxState.year,
            stateParams,
            acaOptions
        );
        bracketSpacePerYear = conversionLimit.maxConversion;
    } else {
        // Ceiling = 0 means only standard deduction space (0% bracket)
        bracketSpacePerYear = Math.max(0, taxParams.standardDeduction - currentAGI);
    }

    // =========================================================================
    // Compute ideal target and projected balance for return
    // =========================================================================

    const idealTargetBalance = calculateIdealTargetBalance(
        effectivePensionAtRMD,
        effectiveSsAtRMD,
        passiveIncomeAtRMD,
        0.12,   // Always target 12% bracket for RMDs
        rmdStartAge,
        taxParams
    );


    // Use baseline projection for projectedBalanceAtRMD if available
    const effectiveProjectedBalance = baselineProjections?.traditionalBalanceAtRMD
        ?? projectBalanceAtRMD(currentTraditionalBalance, yearsUntilRMD, 0, growthRate);

    // Compute projected RMD bracket (first-year RMD using standard divisor)
    const rmdDivisor = getRMDDivisor(rmdStartAge);
    const projectedRMD = rmdDivisor > 0 ? effectiveProjectedBalance / rmdDivisor : 0;
    const projectedTaxableSS = TaxService.getTaxableSocialSecurityBenefits(
        effectiveSsAtRMD,
        effectivePensionAtRMD + projectedRMD,
        0,
        taxState.filingStatus
    );
    const projectedTaxableIncome = projectedRMD + effectivePensionAtRMD + projectedTaxableSS - taxParams.standardDeduction;
    const projectedRMDBracket = TaxService.getMarginalTaxRate(Math.max(0, projectedTaxableIncome), taxParams).rate;

    // DEBUG: Log ceiling decision for high balances (DISABLED to reduce noise)
    if (false && currentTraditionalBalance > 1_500_000 && taxState.year >= 2042 && taxState.year <= 2043) {
    }

    return {
        conversionCeiling: ceiling,
        bracketSpacePerYear,
        projectedBalanceAtRMD: effectiveProjectedBalance,
        projectedRMDBracket,
        idealTargetBalance
    };
}

// =============================================================================
// PLACEHOLDER FUNCTIONS (to be implemented in subsequent tasks)
// =============================================================================

/**
 * Calculate the recommended Roth conversion amount for this year.
 *
 * Uses a three-way minimum to prevent over-conversion:
 * 1. simpleSpread - Linear spread of excess balance over remaining years
 * 2. bracketCap - This year's available bracket space (from effective rate calculation)
 * 3. dampedMax - Dynamic damping based on years until RMD
 *
 * Under-converting is self-correcting (next year adjusts); over-converting cannot be undone.
 *
 * @param currentBalance - Current Traditional IRA/401k balance
 * @param effectiveTarget - Target balance at RMD age (from calculateDynamicConversionCeiling)
 * @param yearsUntilRMD - Years remaining until RMD age
 * @param bracketSpaceThisYear - Available conversion space before exceeding ceiling rate
 * @param growthRate - Expected annual growth rate
 * @returns Recommended conversion amount for this year
 */
export function calculateConversionThisYear(
    currentBalance: number,
    effectiveTarget: number,
    yearsUntilRMD: number,
    bracketSpaceThisYear: number,
    growthRate: number
): number {
    // Early returns: no conversion needed or possible
    if (currentBalance <= effectiveTarget) return 0;
    if (yearsUntilRMD <= 0) return 0;

    // Calculate excess balance that needs to be converted
    const excess = currentBalance - effectiveTarget;

    // Method 1: Growth-aware spread (FIXED - Bug 2)
    // Solve annuity equation: Target = Balance × (1+g)^n - C × [(1+g)^n - 1] / g
    // For C: C = [Balance × (1+g)^n - Target] × g / [(1+g)^n - 1]
    let growthAwareSpread: number;

    if (growthRate === 0 || growthRate < 0.001) {
        // No growth - simple division
        growthAwareSpread = excess / yearsUntilRMD;
    } else {
        const growthFactor = Math.pow(1 + growthRate, yearsUntilRMD);
        const futureBalance = currentBalance * growthFactor;
        const numerator = (futureBalance - effectiveTarget) * growthRate;
        const denominator = growthFactor - 1;
        growthAwareSpread = numerator / denominator;
    }

    // Method 2: Cap at this year's effective bracket space
    // (Already accounts for SS torpedo via calculateEffectiveRateConversionLimit)
    const bracketCap = bracketSpaceThisYear;

    // Method 3: Dynamic damping based on years remaining
    // More aggressive (higher %) when time is short, conservative when time is long
    const dampingFactor = getDampingFactor(yearsUntilRMD);
    const dampedMax = excess * dampingFactor;

    // Use the MINIMUM of all three caps
    // This prevents aggressive over-conversion
    const conversionAmount = Math.min(growthAwareSpread, bracketCap, dampedMax);

    // Floor at 0 (should never be negative, but safety first)
    return Math.max(0, conversionAmount);
}

/**
 * Calculate both ideal and realistic Traditional balance targets.
 *
 * - **Ideal:** Balance that keeps RMDs + fixed income in 12% bracket
 * - **Realistic:** What we can achieve given conversion ceiling and years remaining
 * - Returns the higher of the two (can't go below realistic)
 *
 * @param currentBalance - Current Traditional IRA/401k balance
 * @param yearsUntilRMD - Years remaining until RMD age
 * @param ceilingResult - Result from calculateDynamicConversionCeiling
 * @param growthRate - Expected annual growth rate
 * @returns TargetBalanceResult with ideal, realistic, effective targets and conversion
 */
export function calculateTargetTraditionalBalance(
    currentBalance: number,
    yearsUntilRMD: number,
    ceilingResult: ConversionCeilingResult,
    growthRate: number
): TargetBalanceResult {
    // 1. idealTarget = from 12% bracket calculation
    const idealTarget = ceilingResult.idealTargetBalance;

    // 2. realisticTarget = the lowest balance achievable if we convert at bracketSpacePerYear every year
    // If we can't convert fast enough to reach idealTarget, we target what's actually achievable
    const realisticTarget = projectBalanceAtRMD(
        currentBalance,
        yearsUntilRMD,
        ceilingResult.bracketSpacePerYear,
        growthRate
    );

    // 3. effectiveTarget = max(ideal, realistic)
    // Can't target below what's realistically achievable
    const effectiveTarget = Math.max(idealTarget, realisticTarget);


    // 4. Determine if we're above target and need to convert
    const aboveTarget = currentBalance > effectiveTarget;

    // 5. Calculate conversion needed this year
    let conversionNeededThisYear = 0;
    let limitingFactor: TargetBalanceResult['limitingFactor'] = undefined;

    if (aboveTarget) {
        // Above target - convert to get down to target
        conversionNeededThisYear = calculateConversionThisYear(
            currentBalance,
            effectiveTarget,
            yearsUntilRMD,
            ceilingResult.bracketSpacePerYear,
            growthRate
        );

        // Determine what's limiting the conversion
        if (ceilingResult.bracketSpacePerYear <= 0) {
            limitingFactor = 'NO_BRACKET_SPACE';
        } else if (conversionNeededThisYear >= ceilingResult.bracketSpacePerYear * 0.95) {
            // Conversion is capped by bracket space
            limitingFactor = 'BRACKET_CEILING';
        } else {
            // Conversion is limited by pacing/damping
            limitingFactor = 'PACING';
        }
    } else {
        // Below target: skip conversion entirely.
        // Future RMDs will be small enough to fill the 0% bracket.
        // Converting now at 10-12% is worse than RMDs at 0%.
        conversionNeededThisYear = 0;
        limitingFactor = 'BALANCE_BELOW_TARGET';
    }

    return {
        idealTarget,
        realisticTarget,
        effectiveTarget,
        conversionNeededThisYear,
        aboveTarget,
        limitingFactor
    };
}

/**
 * Result of withholding with penalty calculation
 */
export interface WithholdingWithPenaltyResult {
    /** Total amount to withhold (may be higher than tax if under 59.5) */
    grossWithholding: number;
    /** Amount that actually arrives in Roth after withholding */
    netToRoth: number;
    /** Early withdrawal penalty amount (0 if age >= 59.5) */
    penaltyAmount: number;
}

/**
 * Calculate withholding amount accounting for early withdrawal penalty.
 *
 * When withholding from conversions and age < 59.5, the withheld amount is
 * a non-qualified distribution that incurs a 10% early withdrawal penalty.
 * Must gross up the withholding to cover this penalty.
 *
 * @param conversionAmount - Gross conversion amount
 * @param totalTax - Total tax (federal + state)
 * @param age - Current age
 * @returns Gross withholding, net to Roth, and penalty amount
 */
export function calculateWithholdingWithPenalty(
    conversionAmount: number,
    totalTax: number,
    age: number
): WithholdingWithPenaltyResult {
    // Handle zero tax case
    if (totalTax === 0) {
        return {
            grossWithholding: 0,
            netToRoth: conversionAmount,
            penaltyAmount: 0
        };
    }

    // No penalty if age >= 59.5
    if (age >= 59.5) {
        return {
            grossWithholding: totalTax,
            netToRoth: conversionAmount - totalTax,
            penaltyAmount: 0
        };
    }

    // Under 59.5: withheld amount incurs 10% penalty
    // Need to solve: withholding = tax + 0.10 * withholding
    // => withholding - 0.10 * withholding = tax
    // => 0.90 * withholding = tax
    // => withholding = tax / 0.90
    const grossWithholding = totalTax / 0.90;
    const penaltyAmount = grossWithholding * 0.10;

    return {
        grossWithholding,
        netToRoth: conversionAmount - grossWithholding,
        penaltyAmount
    };
}

/**
 * Determine which phase of retirement/withdrawal strategy we're in.
 *
 * Phases affect how bracket space is allocated between conversions and spending:
 * - BROKERAGE_AVAILABLE: Full conversions, brokerage pays taxes
 * - BROKERAGE_TRANSITION: Reduced conversions, preserve brokerage
 * - BROKERAGE_DEPLETED: Spending first, conversions get leftovers
 * - ROTH_DEPLETED: No conversions, Traditional covers all spending
 *
 * @param brokerageBalance - Current brokerage account balance
 * @param rothBalance - Current Roth IRA/401k balance
 * @param deficit - Annual spending needed (expenses - income)
 * @returns The current phase
 */
export function determinePhase(
    brokerageBalance: number,
    rothBalance: number,
    deficit: number
): Phase {
    // Handle zero/negative deficit (no spending needed)
    if (deficit <= 0) {
        return 'BROKERAGE_AVAILABLE';
    }

    // Calculate how many years of expenses brokerage can cover
    const brokerageYears = brokerageBalance / deficit;

    // Four phases to avoid cliff behavior at transitions
    if (brokerageYears >= 2.0) {
        return 'BROKERAGE_AVAILABLE';
    }

    if (brokerageYears >= 0.5) {
        return 'BROKERAGE_TRANSITION';
    }

    // Brokerage < 0.5 years
    if (rothBalance >= deficit * 0.5) {
        return 'BROKERAGE_DEPLETED';
    }

    // Both brokerage and Roth are low
    return 'ROTH_DEPLETED';
}

/**
 * Input for planTaxOptimizedYear - account balances by type
 */
export interface AccountBalances {
    traditional: number;
    roth: number;
    brokerage: number;
    savings: number;
}

/**
 * Master function that creates the complete tax-optimized plan for a simulation year.
 *
 * Coordinates all tax optimization logic:
 * - Phase detection based on account balances
 * - Conversion ceiling calculation
 * - ACA cliff awareness (optional)
 * - Survival spending priority in BROKERAGE_DEPLETED phase
 * - Invariant verification (effective rate <= ceiling)
 *
 * @param deficit - Spending needed (expenses - income)
 * @param accountBalances - Current balances by account type
 * @param currentAge - Current age
 * @param rmdStartAge - Age when RMDs begin (typically 73)
 * @param currentAGI - This year's AGI (excluding SS)
 * @param socialSecurityThisYear - This year's SS benefits
 * @param ltcgIncome - Long-term capital gains this year
 * @param pensionIncomeAtRMD - Non-SS fixed income at RMD age (pensions, annuities)
 * @param ssAtRMD - Social Security benefits at RMD age
 * @param growthRate - Expected annual growth rate
 * @param taxParams - Federal tax parameters
 * @param taxState - Tax state from TaxContext
 * @param settings - Tax optimization settings
 * @returns Complete plan for the year
 */
export function planTaxOptimizedYear(
    deficit: number,
    accountBalances: AccountBalances,
    currentAge: number,
    rmdStartAge: number,
    currentAGI: number,
    socialSecurityThisYear: number,
    ltcgIncome: number,
    pensionIncomeAtRMD: number,
    ssAtRMD: number,
    passiveIncomeAtRMD: number,
    growthRate: number,
    taxParams: TaxParameters,
    taxState: TaxState,
    settings: TaxOptimizationSettings,
    stateParams: TaxParameters | null = null,
    acaOptions?: ACAOptions,
    baselineProjections?: BaselineProjections
): TaxOptimizedYearPlan {
    const { traditional: traditionalBalance, roth: rothBalance, brokerage: brokerageBalance, savings: savingsBalance } = accountBalances;

    // 1. Calculate years until RMD
    const yearsUntilRMD = Math.max(0, rmdStartAge - currentAge);

    // 2. Calculate conversion ceiling (skip if already at RMD age)
    let ceilingResult: ConversionCeilingResult;
    if (yearsUntilRMD > 0) {
        ceilingResult = calculateDynamicConversionCeiling(
            traditionalBalance,
            yearsUntilRMD,
            pensionIncomeAtRMD,
            ssAtRMD,
            passiveIncomeAtRMD,
            currentAGI,
            socialSecurityThisYear,
            ltcgIncome,
            growthRate,
            rmdStartAge,
            taxParams,
            taxState,
            stateParams,
            acaOptions,
            baselineProjections
        );
    } else {
        // At or past RMD age, no conversions by policy
        ceilingResult = {
            conversionCeiling: 0,
            bracketSpacePerYear: 0,
            projectedBalanceAtRMD: traditionalBalance,
            projectedRMDBracket: 0,
            idealTargetBalance: 0
        };
    }

    // 3. Calculate PMT-based conversion amount
    // PMT formula spreads conversions evenly to reach ideal target at RMD age
    const idealTargetBalance = ceilingResult.idealTargetBalance;
    const r = 1 + growthRate;
    let pmtConversionAmount = 0;

    if (yearsUntilRMD > 0 && growthRate > 0.001) {
        const pvTarget = idealTargetBalance / Math.pow(r, yearsUntilRMD);
        if (traditionalBalance > pvTarget) {
            // PMT = (PV * r^n - FV) * (r - 1) / (r^n - 1)
            const rN = Math.pow(r, yearsUntilRMD);
            pmtConversionAmount = (traditionalBalance * rN - idealTargetBalance) * (r - 1) / (rN - 1);
        }
    }

    // 3b. Calculate 0% bracket floor (applied later, only in appropriate phases)
    const zeroBracketFloor = Math.max(0, taxParams.standardDeduction - currentAGI);

    // 4. Determine phase
    const phase = determinePhase(brokerageBalance, rothBalance, deficit);

    // 5. Get total bracket space at the ceiling
    const searchResult = coarseToFineSearch(
        ceilingResult.conversionCeiling,
        traditionalBalance,
        currentAGI,
        socialSecurityThisYear,
        ltcgIncome,
        taxParams,
        taxState,
        taxState.year,
        stateParams,
        acaOptions
    );
    let totalBracketSpace = searchResult.amount;

    // 5b. Apply ACA cliff ceiling if enabled
    let acaBlocked = false;
    let acaCliff = 0;
    let roomUnderCliff = 0;
    if (settings.acaSubsidyAware && currentAge < 65) {
        acaCliff = getAcaCliffThreshold(
            taxState.filingStatus === 'Single' ? 'single' : 'married_filing_jointly',
            taxState.year
        );
        // MAGI for ACA includes 100% of SS (different from tax calculation)
        const currentMAGI = currentAGI + socialSecurityThisYear;
        roomUnderCliff = Math.max(0, acaCliff - currentMAGI - 1000); // $1k buffer
        if (pmtConversionAmount > roomUnderCliff) {
            acaBlocked = true;
        }
        pmtConversionAmount = Math.min(pmtConversionAmount, roomUnderCliff);
    }


    // Initialize result variables
    let conversionAmount = 0;
    let taxPaymentSource: TaxPaymentSource = 'NONE';
    let totalTaxNeeded = 0;
    let conversionWithholding = 0;
    let withdrawals = { traditional: 0, roth: 0, brokerage: 0, savings: 0 };

    // 6. Phase handling
    if (phase === 'BROKERAGE_AVAILABLE') {
        // Full conversions, brokerage covers spending and taxes
        // Use PMT pacing, but ensure at least the 0% bracket floor (free tax space)
        const conversionTarget = Math.max(pmtConversionAmount, zeroBracketFloor);

        // Final conversion = min(target, bracket space, available balance)
        conversionAmount = Math.min(conversionTarget, totalBracketSpace, traditionalBalance);


        if (conversionAmount > 0) {
            const taxResult = calculateEffectiveConversionTax(
                currentAGI, socialSecurityThisYear, 0, conversionAmount,
                taxState.filingStatus, taxParams, stateParams ?? null
            );
            totalTaxNeeded = taxResult.taxIncrease;

            if (brokerageBalance >= deficit + totalTaxNeeded) {
                taxPaymentSource = 'BROKERAGE';
            } else if (savingsBalance >= totalTaxNeeded) {
                taxPaymentSource = 'SAVINGS';
            } else {
                taxPaymentSource = 'WITHHOLD';
                const penaltyResult = calculateWithholdingWithPenalty(conversionAmount, totalTaxNeeded, currentAge);
                conversionWithholding = penaltyResult.grossWithholding;
                // penaltyAmount tracked in penaltyResult but not returned
            }
        }

        // Roth conversion doesn't reduce spending deficit - it's just an inter-account transfer.
        // We need to withdraw: deficit (for spending) + tax (if paid from brokerage/savings)
        const brokerageForTax = taxPaymentSource === 'BROKERAGE' ? totalTaxNeeded : 0;

        withdrawals = {
            traditional: 0,
            roth: 0,
            brokerage: deficit + brokerageForTax,
            savings: taxPaymentSource === 'SAVINGS' ? totalTaxNeeded : 0
        };

    } else if (phase === 'BROKERAGE_TRANSITION') {
        // Reduce conversion aggressiveness to preserve brokerage
        // Use PMT pacing but cap at reduced bracket space (50%)
        const reducedBracketSpace = totalBracketSpace * 0.5;
        const conversionTarget = Math.max(pmtConversionAmount, zeroBracketFloor);
        conversionAmount = Math.min(conversionTarget, reducedBracketSpace, traditionalBalance);

        if (conversionAmount > 0) {
            const taxResult = calculateEffectiveConversionTax(
                currentAGI, socialSecurityThisYear, 0, conversionAmount,
                taxState.filingStatus, taxParams, stateParams ?? null
            );
            totalTaxNeeded = taxResult.taxIncrease;

            if (brokerageBalance >= deficit + totalTaxNeeded) {
                taxPaymentSource = 'BROKERAGE';
            } else if (savingsBalance >= totalTaxNeeded) {
                taxPaymentSource = 'SAVINGS';
            } else {
                taxPaymentSource = 'WITHHOLD';
                const penaltyResult = calculateWithholdingWithPenalty(conversionAmount, totalTaxNeeded, currentAge);
                conversionWithholding = penaltyResult.grossWithholding;
                // penaltyAmount tracked in penaltyResult but not returned
            }
        }

        // Roth conversion doesn't reduce spending deficit - it's just an inter-account transfer.
        // We need to withdraw: deficit (for spending) + tax (if paid from brokerage/savings)
        const brokerageForTax = taxPaymentSource === 'BROKERAGE' ? totalTaxNeeded : 0;

        withdrawals = {
            traditional: 0,
            roth: 0,
            brokerage: deficit + brokerageForTax,
            savings: taxPaymentSource === 'SAVINGS' ? totalTaxNeeded : 0
        };

    } else if (phase === 'BROKERAGE_DEPLETED') {
        // Survival spending first, conversions get leftovers
        let traditionalForSpending = 0;

        if (currentAge < 59.5) {
            // Early withdrawal penalty makes Traditional expensive
            if (rothBalance >= deficit) {
                traditionalForSpending = 0;
            } else {
                traditionalForSpending = Math.min(deficit - rothBalance, traditionalBalance);
            }
        } else {
            // No penalty - use Traditional up to bracket space
            traditionalForSpending = Math.min(totalBracketSpace, deficit, traditionalBalance);
        }

        // Remaining bracket space after spending
        const remainingBracketSpace = Math.max(0, totalBracketSpace - traditionalForSpending);

        // Conversions from remaining space (use PMT pacing)
        if (remainingBracketSpace > 0) {
            conversionAmount = Math.min(
                pmtConversionAmount,
                remainingBracketSpace,
                traditionalBalance - traditionalForSpending
            );
        }

        if (conversionAmount > 0) {
            const taxResult = calculateEffectiveConversionTax(
                currentAGI + traditionalForSpending, socialSecurityThisYear, 0, conversionAmount,
                taxState.filingStatus, taxParams, stateParams ?? null
            );
            totalTaxNeeded = taxResult.taxIncrease;

            if (savingsBalance >= totalTaxNeeded) {
                taxPaymentSource = 'SAVINGS';
            } else {
                taxPaymentSource = 'WITHHOLD';
                const penaltyResult = calculateWithholdingWithPenalty(conversionAmount, totalTaxNeeded, currentAge);
                conversionWithholding = penaltyResult.grossWithholding;
                // penaltyAmount tracked in penaltyResult but not returned
            }
        }

        // Roth conversion doesn't reduce spending deficit - it's just an inter-account transfer.
        // Tax is paid separately from savings (savingsForTaxes) or withheld from conversion.
        const remainingAfterTraditional = Math.max(0, deficit - traditionalForSpending);
        const rothForSpending = Math.min(remainingAfterTraditional, rothBalance);
        const savingsForTaxes = taxPaymentSource === 'SAVINGS' ? totalTaxNeeded : 0;
        const savingsForSpending = Math.max(0, remainingAfterTraditional - rothForSpending);

        withdrawals = {
            traditional: traditionalForSpending,
            roth: rothForSpending,
            brokerage: 0,
            savings: savingsForTaxes + savingsForSpending
        };

    } else {
        // ROTH_DEPLETED - survival mode, no conversions
        conversionAmount = 0;
        taxPaymentSource = 'NONE';
        totalTaxNeeded = 0;

        const traditionalForSpending = Math.min(deficit, traditionalBalance);
        const savingsForSpending = Math.min(deficit - traditionalForSpending, savingsBalance);

        withdrawals = {
            traditional: traditionalForSpending,
            roth: 0,
            brokerage: 0,
            savings: savingsForSpending
        };
    }

    // =========================================================================
    // Step 9: INVARIANT VERIFICATION
    // Verify that effectiveRateAfterAllocation <= conversionCeiling
    // If violated, reduce conversions (not spending) until satisfied
    // =========================================================================
    const invariantTolerance = 0.005; // 0.5% tolerance

    // Calculate initial effective rate
    let finalConversionAmount = conversionAmount;
    let finalTaxPaymentSource = taxPaymentSource;
    let finalConversionWithholding = conversionWithholding;
    let finalTotalTaxNeeded = totalTaxNeeded;

    // Only check invariant if there's a conversion and a ceiling
    if (finalConversionAmount > 0 && ceilingResult.conversionCeiling > 0) {
        let totalTaxableActivity = finalConversionAmount + withdrawals.traditional;
        let effectiveRate = getEffectiveConversionRate(
            totalTaxableActivity,
            currentAGI,
            ltcgIncome,
            socialSecurityThisYear,
            taxParams,
            taxState,
            taxState.year,
            stateParams,
            acaOptions
        );

        // If invariant is violated, reduce conversion amount
        if (effectiveRate > ceilingResult.conversionCeiling + invariantTolerance) {
            // Binary search to find max conversion that satisfies invariant
            let low = 0;
            let high = finalConversionAmount;
            const searchTolerance = 100; // $100 precision

            while (high - low > searchTolerance) {
                const mid = (low + high) / 2;
                const testTaxableActivity = mid + withdrawals.traditional;
                const testRate = getEffectiveConversionRate(
                    testTaxableActivity,
                    currentAGI,
                    ltcgIncome,
                    socialSecurityThisYear,
                    taxParams,
                    taxState,
                    taxState.year,
                    stateParams,
                    acaOptions
                );

                if (testRate <= ceilingResult.conversionCeiling + invariantTolerance) {
                    low = mid;
                } else {
                    high = mid;
                }
            }

            // Use the conservative lower bound
            finalConversionAmount = Math.floor(low);

            // Recalculate tax payment source and withholding for reduced conversion
            if (finalConversionAmount <= 0) {
                // Conversion reduced to zero
                finalConversionAmount = 0;
                finalTaxPaymentSource = 'NONE';
                finalConversionWithholding = 0;
                finalTotalTaxNeeded = 0;
            } else {
                // Recalculate tax for reduced conversion
                const reducedTaxResult = calculateEffectiveConversionTax(
                    currentAGI + withdrawals.traditional, socialSecurityThisYear, 0, finalConversionAmount,
                    taxState.filingStatus, taxParams, stateParams ?? null
                );
                finalTotalTaxNeeded = reducedTaxResult.taxIncrease;

                // Re-determine tax payment source for reduced amount
                if (phase === 'BROKERAGE_AVAILABLE' || phase === 'BROKERAGE_TRANSITION') {
                    if (brokerageBalance >= deficit + finalTotalTaxNeeded) {
                        finalTaxPaymentSource = 'BROKERAGE';
                    } else if (savingsBalance >= finalTotalTaxNeeded) {
                        finalTaxPaymentSource = 'SAVINGS';
                    } else {
                        finalTaxPaymentSource = 'WITHHOLD';
                        const penaltyResult = calculateWithholdingWithPenalty(finalConversionAmount, finalTotalTaxNeeded, currentAge);
                        finalConversionWithholding = penaltyResult.grossWithholding;
                    }
                } else {
                    // BROKERAGE_DEPLETED or ROTH_DEPLETED
                    if (savingsBalance >= finalTotalTaxNeeded) {
                        finalTaxPaymentSource = 'SAVINGS';
                    } else {
                        finalTaxPaymentSource = 'WITHHOLD';
                        const penaltyResult = calculateWithholdingWithPenalty(finalConversionAmount, finalTotalTaxNeeded, currentAge);
                        finalConversionWithholding = penaltyResult.grossWithholding;
                    }
                }
            }
        }
    }

    // Calculate net conversion to Roth with final values
    const netConversionToRoth = finalTaxPaymentSource === 'WITHHOLD'
        ? finalConversionAmount - finalConversionWithholding
        : finalConversionAmount;

    // Calculate effective rate after all allocations (final values)
    const totalTaxableActivity = finalConversionAmount + withdrawals.traditional;
    const effectiveRateAfterAllocation = getEffectiveConversionRate(
        totalTaxableActivity,
        currentAGI,
        ltcgIncome,
        socialSecurityThisYear,
        taxParams,
        taxState,
        taxState.year,
        stateParams,
        acaOptions
    );


    // DEBUG: Log conversion decision for ages 50-55 (approx years 2053-2058)
    if (currentAge >= 50 && currentAge <= 55) {
        console.log(`[ROTH-DEBUG age=${currentAge}] ========== planTaxOptimizedYear (V1) ==========`);
        console.log(`[ROTH-DEBUG age=${currentAge}] Traditional balance: $${Math.round(traditionalBalance).toLocaleString()}`);
        console.log(`[ROTH-DEBUG age=${currentAge}] Ideal target at RMD: $${Math.round(idealTargetBalance).toLocaleString()}`);
        console.log(`[ROTH-DEBUG age=${currentAge}] Projected balance at RMD: $${Math.round(ceilingResult.projectedBalanceAtRMD).toLocaleString()}`);
        console.log(`[ROTH-DEBUG age=${currentAge}] Years until RMD: ${yearsUntilRMD}, age: ${currentAge}, rmdStartAge: ${rmdStartAge}`);
        console.log(`[ROTH-DEBUG age=${currentAge}] Growth rate: ${(growthRate * 100).toFixed(1)}%`);
        console.log(`[ROTH-DEBUG age=${currentAge}] --- Income ---`);
        console.log(`[ROTH-DEBUG age=${currentAge}] currentAGI (excl SS): $${Math.round(currentAGI).toLocaleString()}`);
        console.log(`[ROTH-DEBUG age=${currentAge}] SS this year: $${Math.round(socialSecurityThisYear).toLocaleString()}`);
        console.log(`[ROTH-DEBUG age=${currentAge}] SS at RMD: $${Math.round(ssAtRMD).toLocaleString()}`);
        console.log(`[ROTH-DEBUG age=${currentAge}] Pension at RMD: $${Math.round(pensionIncomeAtRMD).toLocaleString()}`);
        console.log(`[ROTH-DEBUG age=${currentAge}] Passive at RMD: $${Math.round(passiveIncomeAtRMD).toLocaleString()}`);
        console.log(`[ROTH-DEBUG age=${currentAge}] --- Ceiling & Bracket Space ---`);
        console.log(`[ROTH-DEBUG age=${currentAge}] Conversion ceiling: ${(ceilingResult.conversionCeiling * 100).toFixed(0)}%`);
        console.log(`[ROTH-DEBUG age=${currentAge}] Total bracket space: $${Math.round(totalBracketSpace).toLocaleString()}`);
        console.log(`[ROTH-DEBUG age=${currentAge}] Projected RMD bracket: ${(ceilingResult.projectedRMDBracket * 100).toFixed(0)}%`);
        console.log(`[ROTH-DEBUG age=${currentAge}] coarseToFineSearch edge: ${searchResult.edgeType || 'none'}`);
        console.log(`[ROTH-DEBUG age=${currentAge}] --- Pacing ---`);
        console.log(`[ROTH-DEBUG age=${currentAge}] PMT amount: $${Math.round(pmtConversionAmount).toLocaleString()}`);
        console.log(`[ROTH-DEBUG age=${currentAge}] 0% bracket floor: $${Math.round(zeroBracketFloor).toLocaleString()}`);
        console.log(`[ROTH-DEBUG age=${currentAge}] --- Phase & Result ---`);
        console.log(`[ROTH-DEBUG age=${currentAge}] Phase: ${phase}`);
        console.log(`[ROTH-DEBUG age=${currentAge}] Deficit: $${Math.round(deficit).toLocaleString()}`);
        console.log(`[ROTH-DEBUG age=${currentAge}] Balances: trad=$${Math.round(traditionalBalance).toLocaleString()} roth=$${Math.round(rothBalance).toLocaleString()} brok=$${Math.round(brokerageBalance).toLocaleString()} sav=$${Math.round(savingsBalance).toLocaleString()}`);
        console.log(`[ROTH-DEBUG age=${currentAge}] Pre-invariant conversion: $${Math.round(conversionAmount).toLocaleString()}`);
        console.log(`[ROTH-DEBUG age=${currentAge}] Final conversion: $${Math.round(finalConversionAmount).toLocaleString()}`);
        console.log(`[ROTH-DEBUG age=${currentAge}] Effective rate after: ${(effectiveRateAfterAllocation * 100).toFixed(1)}%`);
        console.log(`[ROTH-DEBUG age=${currentAge}] ACA: aware=${settings.acaSubsidyAware}, blocked=${acaBlocked}, cliff=$${Math.round(acaCliff).toLocaleString()}, room=$${Math.round(roomUnderCliff).toLocaleString()}`);
        console.log(`[ROTH-DEBUG age=${currentAge}] =============================================`);
    }

    return {
        phase,
        conversionAmount: finalConversionAmount,
        conversionWithholding: finalConversionWithholding,
        netConversionToRoth,
        taxPaymentSource: finalTaxPaymentSource,
        withdrawals,
        conversionCeiling: ceilingResult.conversionCeiling,
        projectedRMDBracket: ceilingResult.projectedRMDBracket,
        effectiveTarget: idealTargetBalance,  // Now using ideal target directly (PMT pacing targets this)
        effectiveRateAfterAllocation,
        bracketSpaceUsed: {
            byConversion: finalConversionAmount,
            byTraditionalSpending: withdrawals.traditional,
            remaining: Math.max(0, totalBracketSpace - finalConversionAmount - withdrawals.traditional)
        }
    };
}

// =============================================================================
// COMPLETED TASKS
// =============================================================================

// Task 7: calculateSimpleBracketSpace - DELETED (dead code)
// Task 9: calculateEffectiveRateWithLTCG - DONE
// Task 11: coarseToFineSearch - DONE
// Task 13: calculateEffectiveRateConversionLimit - DONE
// Task 15: calculateIdealTargetBalance - DONE
// Task 17: projectBalanceAtRMD - DONE
// Task 19: calculateDynamicConversionCeiling - DONE
// Task 21: calculateConversionThisYear - DONE
// Task 23: calculateTargetTraditionalBalance - DONE
// Task 25: calculateConversionWithholding - DELETED (call sites use calculateEffectiveConversionTax)
// Task 27: calculateWithholdingWithPenalty - DONE
// Task 33: planTaxOptimizedYear - DONE (including Step 9 invariant verification)
