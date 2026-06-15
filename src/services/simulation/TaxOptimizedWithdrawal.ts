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
import { AssumptionsState, getBirthYear } from '../../components/Objects/Assumptions/AssumptionsContext';
import { calculateEffectiveConversionTax, computeConversionTaxBaseline, ACAOptions, IRMAAConversionOptions } from './helpers';
import { computeIrmaaMAGI } from '../../data/IRMAAData';
import { getDistributionPeriod, PEAK_RMD_DIVISOR } from '../../data/RMDData';
import { BaselineProjections, RateMatchWalkRow } from './types';

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

    /** Peak mid-retirement RMD amount (balance / 15) used to select ceiling */
    peakRMD: number;

    /** Tax bracket the peak RMD lands in — this is what drives ceiling selection */
    peakRMDBracket: number;

    /** Bracket-by-bracket trace of the rate-match walk (for the Roth Debug page) */
    rateMatchWalk?: RateMatchWalkRow[];
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
 * Get the RMD divisor for a given age.
 *
 * Delegates to the canonical IRS Uniform Lifetime Table in RMDData
 * (getDistributionPeriod), which covers ages 72-120 accurately, instead of
 * keeping a duplicate truncated table with an inaccurate >95 extrapolation.
 * The "no RMD before 72 -> 0" sentinel is preserved here because RMDData's
 * getDistributionPeriod returns the age-72 factor for ages < 72.
 *
 * @param age - Age at end of year
 * @returns RMD divisor (distribution period), or 0 if no RMD applies
 */
export function getRMDDivisor(age: number): number {
    if (age < 72) return 0; // No RMD before 72
    return getDistributionPeriod(age);
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

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
 *
 * Production reaches this through coarseToFineSearch; the export exists so unit
 * tests can probe marginal-rate math directly (SS torpedo, ACA cliff, state
 * stacking) without going through the opaque search wrapper.
 *
 * @public
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
    acaOptions?: ACAOptions,
    irmaaOptions?: IRMAAConversionOptions
): number {
    // The "before" tax positions are conversion-independent, so compute them once
    // and reuse for both probes instead of recomputing inside each call.
    const baseline = computeConversionTaxBaseline(
        ordinaryIncome,
        socialSecurity,
        ltcgIncome,
        taxState.filingStatus,
        taxParams,
        stateParams,
    );

    // Calculate total cost of converting conversionAmount
    // taxIncrease includes federal tax increase + state tax + ACA subsidy loss + IRMAA
    const resultAtAmount = calculateEffectiveConversionTax(
        ordinaryIncome,
        socialSecurity,
        ltcgIncome,
        Math.max(0, conversionAmount),
        taxState.filingStatus,
        taxParams,
        stateParams,
        acaOptions,
        baseline,
        irmaaOptions,
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
        acaOptions,
        baseline,
        irmaaOptions,
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
    _debugLabel?: string,  // For debug logging
    irmaaOptions?: IRMAAConversionOptions  // Medicare IRMAA cliff awareness (age 65+)
): CoarseToFineSearchResult {
    // `let` because the IRMAA cliff (below) tightens it as an upper bound.
    let maxAmount = Math.min(traditionalBalance, SEARCH_CONFIG.maxConversionCap);

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
        acaOptions,
        irmaaOptions
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

    // Special case: Medicare IRMAA cliff. Like the ACA cliff above, it's a narrow
    // surcharge step the $5k coarse scan would step over (its cost is a level shift,
    // not a marginal-rate change at the sample points). Locate the next tier floor
    // above the current IRMAA MAGI and check the spike at the crossing point. The
    // IRMAA MAGI base includes taxable SS (and LTCG), which `currentAGI` (non-SS
    // ordinary) excludes, so reconstruct it the same way calculateEffectiveConversionTax does.
    if (irmaaOptions) {
        const currentIRMAAMagi = computeIrmaaMAGI(currentAGI, socialSecurity, ltcgIncome, taxState.filingStatus);
        const nextThreshold = irmaaOptions.nextThresholdAbove(currentIRMAAMagi);
        if (nextThreshold !== null) {
            const cliffConversion = nextThreshold - currentIRMAAMagi;
            if (cliffConversion > 0 && cliffConversion <= maxAmount) {
                // The marginal rate at cliffConversion - 1 includes the full annual
                // surcharge spiked onto the $1 that crosses the tier, so it is
                // (essentially) always over target. We therefore treat the cliff as a
                // hard UPPER BOUND — cap maxAmount just below it — rather than
                // returning here. Returning would (a) overshoot a lower bracket /
                // SS-torpedo edge the coarse/fine search below would otherwise find,
                // and (b) at ages 63-64 (ACA + IRMAA both active) blow past a tighter
                // ACA cliff cap. Capping lets the search still bind on any lower edge,
                // and falls back to this cap (via the `!edgeFound` return) when the
                // IRMAA cliff is itself the tightest constraint.
                const rateBeforeCliff = getEffectiveConversionRate(
                    cliffConversion - 1, currentAGI, ltcgIncome, socialSecurity,
                    taxParams, taxState, year, stateParams, acaOptions, irmaaOptions,
                );
                if (rateBeforeCliff > targetRate) {
                    maxAmount = Math.min(maxAmount, Math.max(0, cliffConversion - 1));
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
            acaOptions,
            irmaaOptions
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
                acaOptions,
                irmaaOptions
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
            acaOptions,
            irmaaOptions
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
 * Result of rate-matched conversion calculation.
 */
export interface RateMatchedConversion {
    /** Total dollars to convert this year */
    optimalConversion: number;
    /** Marginal rate of the last bracket converted into (e.g., 0.12 if conversion stopped after filling 12%) */
    topConversionRate: number;
    /** Projected future marginal rate after this conversion (used to compute the gap that stopped us) */
    futureMarginalAtStop: number;
    /** Why we stopped converting */
    stopReason: 'gap-closed' | 'no-balance' | 'no-future-tax';
    /** Bracket-by-bracket walk trace (for the Roth Debug page). */
    walk: RateMatchWalkRow[];
}

/**
 * Compute the optimal Roth conversion for a single year using direct rate-match.
 *
 * The principle: a dollar is worth converting today only if today's marginal rate
 * is meaningfully lower than the rate it'd be taxed at when withdrawn from Trad
 * later (as RMD). For each chunk of conversion (std-ded headroom, then each
 * federal bracket), compute:
 *   - current_marginal_rate: rate of the bracket this chunk would be taxed at
 *   - future_marginal_rate: rate the LAST RMD dollar would face if we converted
 *     up through this chunk and stopped (depends on remaining Trad balance)
 *
 * Convert the chunk if (future − current) ≥ minimumRateGap. Stop otherwise.
 *
 * Compared to bracket-fill ceilings: this naturally adapts to the actual
 * rate-arbitrage available. Heavy conversions when future is much higher than
 * current; tapers off automatically as remaining Trad shrinks and future rate
 * drops with it.
 *
 * Limitations (handled downstream by SS-torpedo / ACA / LTCG-bump logic):
 *   - Doesn't model SS-taxability bumps mid-conversion
 *   - Doesn't model LTCG bracket stacking
 *   - Doesn't model ACA cliff
 * The conversion amount returned here is the rate-arbitrage optimum; downstream
 * coarseToFineSearch can reduce it further to avoid those discontinuities.
 */
export function computeRateMatchedConversion(
    currentTraditionalBalance: number,
    yearsUntilRMD: number,
    pensionIncomeAtRMD: number,
    ssAtRMD: number,
    passiveIncomeAtRMD: number,
    currentAGI: number,
    growthRate: number,
    currentTaxParams: TaxParameters,
    rmdYearTaxParams: TaxParameters,
    taxState: TaxState,
    minimumRateGap: number = 0.05,
    projectedTradAtRMD?: number
): RateMatchedConversion {
    const walk: RateMatchWalkRow[] = [];

    if (currentTraditionalBalance <= 0 || yearsUntilRMD <= 0) {
        return {
            optimalConversion: 0,
            topConversionRate: 0,
            futureMarginalAtStop: 0,
            stopReason: 'no-balance',
            walk,
        };
    }

    const stdDed = currentTaxParams.standardDeduction;
    const growthFactor = Math.pow(1 + growthRate, yearsUntilRMD);
    // Baseline projected Traditional balance at RMD age. When the caller supplies a
    // sub-sim-derived value, use it as a fixed target (independent of how much we
    // convert this year). Fallback: naive forward-compound of today's balance —
    // matches the legacy algebra so existing tests stay green.
    const baselineProjectedTrad = projectedTradAtRMD ?? currentTraditionalBalance * growthFactor;

    // Helper: project future marginal rate given dollars converted in the current year.
    // balanceAtRMD = baseline projected balance MINUS the conversion compounded forward.
    const futureMarginalAt = (convertedSoFar: number): number => {
        const balanceAtRMD = Math.max(0, baselineProjectedTrad - convertedSoFar * growthFactor);
        if (balanceAtRMD <= 0) return 0;
        const projectedRMD = balanceAtRMD / PEAK_RMD_DIVISOR;
        const projectedTaxableSS = TaxService.getTaxableSocialSecurityBenefits(
            ssAtRMD,
            projectedRMD + pensionIncomeAtRMD + passiveIncomeAtRMD,
            0,
            taxState.filingStatus
        );
        const projectedTaxableIncome =
            projectedRMD + pensionIncomeAtRMD + passiveIncomeAtRMD + projectedTaxableSS - rmdYearTaxParams.standardDeduction;
        return TaxService.getMarginalTaxRate(Math.max(0, projectedTaxableIncome), rmdYearTaxParams).rate;
    };

    let totalConverted = 0;
    let topRate = 0;

    // Chunk 0: std-ded headroom (effectively 0% rate). Conversion that just fills
    // standard deduction produces no taxable income → no current tax → always
    // worth doing if there's any future tax to dodge.
    const stdDedHeadroom = Math.max(0, stdDed - currentAGI);
    if (stdDedHeadroom > 0) {
        const chunkSize = Math.min(stdDedHeadroom, currentTraditionalBalance - totalConverted);
        if (chunkSize > 0) {
            const futureMarginal = futureMarginalAt(totalConverted + chunkSize);
            const gap = futureMarginal; // currentRate is 0
            // For free conversions (current rate = 0), gap is just the future rate. Always convert
            // if future rate is at least the threshold (otherwise we're paying nothing now to
            // dodge nothing later).
            if (futureMarginal >= minimumRateGap) {
                totalConverted += chunkSize;
                topRate = 0;
                walk.push({
                    currentRate: 0,
                    chunkStart: -stdDedHeadroom,
                    chunkEnd: 0,
                    chunkSize,
                    futureMarginal,
                    gap,
                    decision: 'convert',
                    cumulative: totalConverted,
                });
            } else {
                walk.push({
                    currentRate: 0,
                    chunkStart: -stdDedHeadroom,
                    chunkEnd: 0,
                    chunkSize,
                    futureMarginal,
                    gap,
                    decision: 'stop',
                    cumulative: totalConverted,
                });
                return {
                    optimalConversion: totalConverted,
                    topConversionRate: topRate,
                    futureMarginalAtStop: futureMarginal,
                    stopReason: futureMarginal === 0 ? 'no-future-tax' : 'gap-closed',
                    walk,
                };
            }
        }
    }

    // Subsequent chunks: walk through federal brackets from current taxable position
    // upward. Position in the bracket structure = currentAGI - stdDed + (totalConverted - stdDedHeadroom)
    // — i.e., the post-stdDed taxable income after our conversions so far.
    const sortedBrackets = [...currentTaxParams.brackets].sort((a, b) => a.threshold - b.threshold);

    for (let i = 0; i < sortedBrackets.length; i++) {
        if (currentTraditionalBalance - totalConverted <= 0) {
            return {
                optimalConversion: totalConverted,
                topConversionRate: topRate,
                futureMarginalAtStop: futureMarginalAt(currentTraditionalBalance),
                stopReason: 'no-balance',
                walk,
            };
        }

        const bracket = sortedBrackets[i];
        const nextBracket = sortedBrackets[i + 1];
        const bracketTop = nextBracket ? nextBracket.threshold : Infinity;

        // Current taxable position (post-stdDed) after conversions so far
        const currentTaxablePos = Math.max(0, currentAGI + totalConverted - stdDed);

        if (currentTaxablePos >= bracketTop) continue; // already past this bracket

        const chunkStart = Math.max(currentTaxablePos, bracket.threshold);
        const chunkSizeInBracket = bracketTop - chunkStart;
        if (chunkSizeInBracket <= 0) continue;

        const chunkSize = Math.min(chunkSizeInBracket, currentTraditionalBalance - totalConverted);
        if (chunkSize <= 0) continue;

        const currentMarginal = bracket.rate;
        const futureMarginal = futureMarginalAt(totalConverted + chunkSize);

        const gap = futureMarginal - currentMarginal;
        if (gap < minimumRateGap) {
            walk.push({
                currentRate: currentMarginal,
                chunkStart,
                chunkEnd: chunkStart + chunkSize,
                chunkSize,
                futureMarginal,
                gap,
                decision: 'stop',
                cumulative: totalConverted,
            });
            return {
                optimalConversion: totalConverted,
                topConversionRate: topRate,
                futureMarginalAtStop: futureMarginal,
                stopReason: 'gap-closed',
                walk,
            };
        }

        totalConverted += chunkSize;
        topRate = currentMarginal;
        walk.push({
            currentRate: currentMarginal,
            chunkStart,
            chunkEnd: chunkStart + chunkSize,
            chunkSize,
            futureMarginal,
            gap,
            decision: 'convert',
            cumulative: totalConverted,
        });
    }

    return {
        optimalConversion: totalConverted,
        topConversionRate: topRate,
        futureMarginalAtStop: futureMarginalAt(totalConverted),
        stopReason: 'no-balance',
        walk,
    };
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
    growthRate: number,
    rmdStartAge: number,
    taxParams: TaxParameters,
    taxState: TaxState,
    baselineProjections?: BaselineProjections,
    /**
     * Simulation assumptions. When provided, the peak-RMD bracket lookup uses
     * tax parameters projected to the RMD year so that RMD-year nominal income
     * is compared against RMD-year nominal brackets. Without this, the bracket
     * comparison mixes units (income in RMD-year dollars vs brackets in
     * current-year dollars), which inflates the apparent peak-RMD bracket at
     * younger ages. Optional for backwards compatibility — callers that don't
     * pass it get the legacy (unit-mismatched) behavior.
     */
    assumptions?: AssumptionsState,
    conversionMode: 'rate-match' | 'std-ded-only' = 'rate-match'
): ConversionCeilingResult {
    // If already at RMD age, no conversions
    if (yearsUntilRMD <= 0) {
        return {
            conversionCeiling: 0,
            bracketSpacePerYear: 0,
            projectedBalanceAtRMD: currentTraditionalBalance,
            projectedRMDBracket: 0,
            peakRMD: 0,
            peakRMDBracket: 0,
        };
    }

    // Std-ded-only mode: fill the 0% federal bracket (standard-deduction headroom)
    // and stop. Used by `runProjectionSubsim` to project a Traditional-balance
    // trajectory that does only "free" conversions, which feeds the rate-match
    // baseline for the main sim. Skip rate-match, peak-bracket lookup, ideal-target
    // computation entirely — none of it is needed when the conversion is bounded
    // by the standard deduction.
    if (conversionMode === 'std-ded-only') {
        const stdDedHeadroom = Math.max(0, taxParams.standardDeduction - currentAGI);
        const cappedAmount = Math.min(stdDedHeadroom, currentTraditionalBalance);
        return {
            conversionCeiling: 0,
            bracketSpacePerYear: cappedAmount,
            projectedBalanceAtRMD: currentTraditionalBalance,
            projectedRMDBracket: 0,
            peakRMD: 0,
            peakRMDBracket: 0,
        };
    }

    // Use baseline projections if available for fixed income at RMD.
    // Pass 1 simulates the trajectory to RMD year so these reflect actual portfolio
    // dynamics (brokerage growth → dividends, etc.); fall back to direct inputs
    // (which use COLA-only projection or current-year proxies) when not available.
    const effectiveSsAtRMD = baselineProjections?.ssAtRMD ?? ssAtRMD;
    const effectivePensionAtRMD = baselineProjections?.pensionAtRMD ?? pensionIncomeAtRMD;
    const effectivePassiveIncomeAtRMD = baselineProjections?.passiveAtRMD ?? passiveIncomeAtRMD;

    // =========================================================================
    // STEP 1: Compute projected Trad balance at RMD age
    // =========================================================================
    // Prefer baselineProjections.traditionalBalanceAtRMD when available — this
    // value comes from the iterative two-pass run and reflects the actual
    // converging conversion trajectory, so peakRMDBracket reflects where RMDs
    // really land (not "where they'd land if I never converted from this point").
    //
    // Without iteration, fall back to naive growth projection from current
    // balance. This was the original behavior and produces conservative ceilings.

    const baselineBalance = baselineProjections?.traditionalBalanceAtRMD
        ?? currentTraditionalBalance * Math.pow(1 + growthRate, yearsUntilRMD);

    // =========================================================================
    // STEP 2: Determine peak RMD bracket from baseline
    // =========================================================================

    const peakRMD = baselineBalance / PEAK_RMD_DIVISOR;

    // Look up tax parameters for the RMD year, not the current year. peakRMD,
    // effectiveSsAtRMD, effectivePensionAtRMD, and passiveIncomeAtRMD are all
    // expressed in RMD-year nominal dollars — they need to be compared against
    // RMD-year inflation-projected brackets, otherwise the apparent peak-RMD
    // bracket is inflated by (1 + inflation)^yearsUntilRMD.
    //
    // Use birthYear + rmdStartAge for the RMD year — that's the user's actual
    // RMD year and is invariant across simulation years. (Avoid taxState.year +
    // yearsUntilRMD: taxState.year is the user's configured tax year, not the
    // current simulation year, so as yearsUntilRMD shrinks the apparent rmdYear
    // would walk backwards toward the present.)
    let peakBracketTaxParams = taxParams;
    if (assumptions) {
        const rmdYear = getBirthYear(assumptions.milestones) + rmdStartAge;
        const rmdYearParams = TaxService.getTaxParameters(
            rmdYear, taxState.filingStatus, 'federal', undefined, assumptions
        );
        if (rmdYearParams) {
            peakBracketTaxParams = rmdYearParams;
        }
    }

    // Calculate taxable SS at peak RMD
    const peakTaxableSS = TaxService.getTaxableSocialSecurityBenefits(
        effectiveSsAtRMD,
        effectivePensionAtRMD + peakRMD + effectivePassiveIncomeAtRMD,
        0,
        taxState.filingStatus
    );
    const peakTaxableIncome = peakRMD + effectivePensionAtRMD + effectivePassiveIncomeAtRMD + peakTaxableSS - peakBracketTaxParams.standardDeduction;
    const peakRMDBracket = TaxService.getMarginalTaxRate(Math.max(0, peakTaxableIncome), peakBracketTaxParams).rate;

    // =========================================================================
    // STEP 3 + 4: Rate-matched conversion via direct bracket walk
    // =========================================================================
    //
    // Rather than computing a single "ceiling" rate and then filling brackets up
    // to it, walk through the brackets dollar-chunk by dollar-chunk. For each
    // chunk: compute current marginal (the bracket's rate) and project future
    // marginal at the remaining Trad balance after the chunk. Convert if the gap
    // is at least minimumRateGap (default 5pp). Stop otherwise.
    //
    // This naturally adapts: in early low-income years with lots of Trad, walk
    // up through 22%/24% brackets because future is even higher. As Trad shrinks
    // year by year, future marginal drops, gaps close, and the walk stops sooner.
    // No discrete ceiling cliff, no iteration needed — convergence is per-year.
    const minRateGap = assumptions?.investments?.rothConversionMinRateGap ?? 0.05;
    const rateMatchResult = computeRateMatchedConversion(
        currentTraditionalBalance,
        yearsUntilRMD,
        effectivePensionAtRMD,
        effectiveSsAtRMD,
        effectivePassiveIncomeAtRMD,
        currentAGI,
        growthRate,
        taxParams,            // current-year params for the brackets we walk
        peakBracketTaxParams, // RMD-year params for projecting future marginal
        taxState,
        minRateGap,
        baselineBalance       // sub-sim-derived projection (decoupled from live trad balance)
    );

    const ceiling = rateMatchResult.topConversionRate;
    const bracketSpacePerYear = rateMatchResult.optimalConversion;

    // Subsequent SS-torpedo / ACA / LTCG-bump logic (downstream in YearSolver) may
    // further reduce this; rate-match output is the rate-arbitrage optimum.

    // =========================================================================
    // Compute projected balance for return
    // =========================================================================

    // Use baseline projection for projectedBalanceAtRMD if available
    const effectiveProjectedBalance = baselineProjections?.traditionalBalanceAtRMD
        ?? projectBalanceAtRMD(currentTraditionalBalance, yearsUntilRMD, 0, growthRate);

    // Compute projected RMD bracket (first-year RMD using standard divisor)
    const rmdDivisor = getRMDDivisor(rmdStartAge);
    const projectedRMD = rmdDivisor > 0 ? effectiveProjectedBalance / rmdDivisor : 0;
    const projectedTaxableSS = TaxService.getTaxableSocialSecurityBenefits(
        effectiveSsAtRMD,
        effectivePensionAtRMD + projectedRMD + effectivePassiveIncomeAtRMD,
        0,
        taxState.filingStatus
    );
    // Same units fix as peakRMDBracket: projectedRMD/SS/pension are in RMD-year
    // nominal dollars, so look up brackets in RMD-year params when available.
    // Include passive income (rental/dividends) to match peakTaxableIncome — it
    // was previously dropped here, understating the projected RMD bracket.
    const projectedTaxableIncome = projectedRMD + effectivePensionAtRMD + effectivePassiveIncomeAtRMD + projectedTaxableSS - peakBracketTaxParams.standardDeduction;
    const projectedRMDBracket = TaxService.getMarginalTaxRate(Math.max(0, projectedTaxableIncome), peakBracketTaxParams).rate;

    return {
        conversionCeiling: ceiling,
        bracketSpacePerYear,
        projectedBalanceAtRMD: effectiveProjectedBalance,
        projectedRMDBracket,
        peakRMD,
        peakRMDBracket,
        rateMatchWalk: rateMatchResult.walk,
    };
}

