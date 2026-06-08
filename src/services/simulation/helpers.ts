import { AnyAccount, InvestedAccount, SavedAccount, ESPPAccount } from "../../components/Objects/Accounts/models";
import { FilingStatus, TaxParameters } from "../../data/TaxData";
import * as TaxService from "../../components/Objects/Taxes/TaxService";

export type TaxCategory = 'tax-deferred' | 'tax-free' | 'taxable' | 'mixed';

/**
 * Classify an account by its tax treatment for withdrawal ordering.
 */
export function classifyAccountTaxCategory(account: AnyAccount): TaxCategory {
    if (account instanceof SavedAccount) return 'tax-free';
    if (account instanceof InvestedAccount) {
        switch (account.taxType) {
            case 'Traditional 401k':
            case 'Traditional IRA':
                return 'tax-deferred';
            case 'Roth 401k':
            case 'Roth IRA':
            case 'HSA':
                return 'tax-free';
            case 'Brokerage':
            default:
                return 'taxable';
        }
    }
    if (account instanceof ESPPAccount) return 'mixed';
    return 'taxable';
}

export interface ACAOptions {
    currentAge: number;
    acaSubsidyAware: boolean;
    acaCliffThreshold: number;
    estimatedSubsidyLoss: number;  // What would be lost if cliff crossed
}

export interface ConversionTaxBreakdown {
    federalOrdinaryTaxCost: number;
    ssTorpedoCost: number;
    ltcgBumpCost: number;
    niitCost: number;
    stateTaxCost: number;
    acaSubsidyLost: number;
}

export interface EffectiveConversionTaxResult {
    taxBefore: number;
    taxAfter: number;
    taxIncrease: number;
    effectiveRate: number;
    breakdown: ConversionTaxBreakdown;
    crossesACACliff: boolean;
}

/**
 * Calculate the effective tax cost of a Roth conversion, including:
 * - SS "tax torpedo" effect (conversion pushes more SS into taxable territory)
 * - LTCG bump (conversion can push LTCG from 0% to 15% bracket)
 * - State tax on the conversion
 * - ACA subsidy cliff (for early retirees under 65)
 *
 * Uses calculateTotalFederalTax for unified tax calculation with proper
 * SS taxability and LTCG stacking.
 *
 * @param nonSSIncome - AGI excluding Social Security benefits
 * @param totalSSBenefits - Total Social Security benefits received
 * @param ltcgIncome - Long-term capital gains income (0 if none)
 * @param conversionAmount - Amount of Roth conversion
 * @param filingStatus - Tax filing status
 * @param fedParams - Federal tax parameters
 * @param stateParams - State tax parameters (null if no state tax)
 * @param acaOptions - ACA subsidy awareness options (undefined if not applicable)
 */
// NOTE: This function's ACA-MAGI check (magiBefore = nonSSIncome + totalSSBenefits)
// previously double-counted Social Security because callers passed `baseOrdinaryIncome`
// (= non-SS income + taxableSS) into the `nonSSIncome` slot. The conversion review fixed
// the call sites to pass true non-SS ordinary income, so `nonSSIncome + totalSSBenefits`
// now correctly equals actual-non-SS + full SS.
export function calculateEffectiveConversionTax(
    nonSSIncome: number,
    totalSSBenefits: number,
    ltcgIncome: number,
    conversionAmount: number,
    filingStatus: FilingStatus,
    fedParams: TaxParameters,
    stateParams: TaxParameters | null,
    acaOptions?: ACAOptions
): EffectiveConversionTaxResult {
    // =========================================================================
    // CALCULATE FULL TAX BEFORE AND AFTER CONVERSION
    // =========================================================================
    // Use calculateTotalFederalTax for unified handling of SS taxability and LTCG stacking
    // Note: ltcgIncome is passed as longTermCapitalGains (4th param), STCG is 0 (3rd param)
    const taxResultBefore = TaxService.calculateTotalFederalTax(
        nonSSIncome,
        totalSSBenefits,
        0,          // shortTermCapitalGains
        ltcgIncome, // longTermCapitalGains
        0,          // preTaxDeductions - already accounted for in nonSSIncome
        filingStatus,
        fedParams
    );

    const taxResultAfter = TaxService.calculateTotalFederalTax(
        nonSSIncome + conversionAmount,
        totalSSBenefits,
        0,          // shortTermCapitalGains
        ltcgIncome, // longTermCapitalGains
        0,          // preTaxDeductions
        filingStatus,
        fedParams
    );

    // =========================================================================
    // CALCULATE BREAKDOWN COMPONENTS
    // =========================================================================

    // LTCG bump: direct comparison from unified results
    const ltcgBumpCost = taxResultAfter.ltcgTax - taxResultBefore.ltcgTax;

    // NIIT cost: 3.8% on investment income above threshold when MAGI exceeds threshold
    const niitCost = taxResultAfter.niitTax - taxResultBefore.niitTax;

    // -------------------------------------------------------------------------
    // SS Torpedo Calculation
    // -------------------------------------------------------------------------
    // The "torpedo" is specifically about MORE SS becoming taxable due to the
    // conversion. When SS is already at 85% taxable, there's no torpedo effect.
    //
    // We calculate a "frozen SS" scenario: what would the tax be after conversion
    // if SS taxability stayed the same as before?
    //
    // federalOrdinaryTaxCost = marginal tax at current bracket (with existing taxable SS)
    // ssTorpedoCost = extra tax from the INCREASE in taxable SS
    // -------------------------------------------------------------------------

    const taxableSS_before = taxResultBefore.taxableSS;
    // Note: taxResultAfter.taxableSS available for debugging if needed

    // Calculate tax with "frozen" SS (what if SS didn't become more taxable?)
    // We add taxableSS_before to ordinary income manually (with no SS benefits)
    // to simulate the conversion without additional SS becoming taxable
    const taxFrozenSS = TaxService.calculateTotalFederalTax(
        nonSSIncome + conversionAmount + taxableSS_before,  // use taxableSS_before
        0,          // no SS benefits (we're adding taxableSS manually to ordinary)
        0,          // shortTermCapitalGains
        ltcgIncome, // longTermCapitalGains
        0,          // preTaxDeductions
        filingStatus,
        fedParams
    );

    // Also need the "before" state with SS added manually for apples-to-apples comparison
    const taxBeforeManualSS = TaxService.calculateTotalFederalTax(
        nonSSIncome + taxableSS_before,
        0,          // no SS benefits
        0,          // shortTermCapitalGains
        ltcgIncome, // longTermCapitalGains
        0,          // preTaxDeductions
        filingStatus,
        fedParams
    );

    // federalOrdinaryTaxCost = marginal tax at current bracket (with existing taxable SS held constant)
    const federalOrdinaryTaxCost = taxFrozenSS.ordinaryTax - taxBeforeManualSS.ordinaryTax;

    // ssTorpedoCost = extra tax from MORE SS becoming taxable
    // This is the difference between actual tax after and the "frozen SS" scenario
    const ssTorpedoCost = taxResultAfter.ordinaryTax - taxFrozenSS.ordinaryTax;

    // =========================================================================
    // STATE TAX
    // =========================================================================
    let stateTaxCost = 0;
    if (stateParams) {
        // Most states tax LTCG as ordinary income (no preferential rate).
        // Include LTCG in state income to get correct marginal rate on conversion.
        const stateIncome = nonSSIncome + ltcgIncome;
        const stateTaxBefore = TaxService.calculateTax(stateIncome, 0, stateParams);
        const stateTaxAfter = TaxService.calculateTax(stateIncome + conversionAmount, 0, stateParams);
        stateTaxCost = stateTaxAfter - stateTaxBefore;
    }

    // =========================================================================
    // ACA SUBSIDY CLIFF
    // =========================================================================
    let crossesACACliff = false;
    let acaSubsidyLost = 0;
    if (acaOptions && acaOptions.acaSubsidyAware && acaOptions.currentAge < 65) {
        // MAGI for ACA includes 100% of SS benefits (not just taxable portion)
        const magiBefore = nonSSIncome + totalSSBenefits;
        const magiAfter = magiBefore + conversionAmount;

        if (magiBefore < acaOptions.acaCliffThreshold && magiAfter >= acaOptions.acaCliffThreshold) {
            crossesACACliff = true;
            acaSubsidyLost = acaOptions.estimatedSubsidyLoss;
        }
    }

    // =========================================================================
    // TOTALS
    // =========================================================================
    const taxBefore = taxResultBefore.totalTax;
    const taxAfter = taxResultAfter.totalTax;
    const taxIncrease = (taxAfter - taxBefore) + stateTaxCost + acaSubsidyLost;
    const effectiveRate = conversionAmount > 0 ? taxIncrease / conversionAmount : 0;

    return {
        taxBefore,
        taxAfter,
        taxIncrease,
        effectiveRate,
        breakdown: {
            federalOrdinaryTaxCost,
            ssTorpedoCost,
            ltcgBumpCost,
            niitCost,
            stateTaxCost,
            acaSubsidyLost
        },
        crossesACACliff
    };
}


// =============================================================================
// FIXED INCOME AT RMD PROJECTION
// =============================================================================

/**
 * Result of projecting fixed income to RMD age
 */
export interface FixedIncomeAtRMDResult {
    /** Projected Social Security income at RMD age (with COLA) */
    ssAtRMD: number;
    /** Projected pension income at RMD age (with COLA) */
    pensionAtRMD: number;
    /** Projected passive income at RMD age (no growth assumed) */
    passiveAtRMD: number;
    /** Years of COLA applied */
    yearsProjected: number;
}

/**
 * Default COLA rate for SS (historical average is ~2.5%, use conservative 2%)
 */
export const DEFAULT_SS_COLA = 0.02;

/**
 * Default COLA rate for FERS pensions (typically CPI-based, ~2%)
 */
export const DEFAULT_PENSION_COLA = 0.02;

/**
 * Estimate fixed income (SS + pensions) at RMD age by projecting with COLA.
 *
 * This is the FALLBACK calculation used when baselineProjections is not available.
 * It projects current SS and pension income forward using COLA rates.
 *
 * @param currentSSIncome - Current year's Social Security income (0 if not yet claiming)
 * @param futureSS_PIA - Monthly PIA from FutureSocialSecurityIncome (if not yet claiming)
 * @param currentPensionIncome - Current year's pension income
 * @param currentAge - Current age in simulation
 * @param rmdStartAge - Age when RMDs begin (72, 73, or 75)
 * @param ssClaimingAge - Age when SS will be claimed (for projecting PIA forward)
 * @param ssCola - Annual SS COLA rate (default 2%)
 * @param pensionCola - Annual pension COLA rate (default 2%)
 * @param currentPassiveIncome - Current year's passive income (rental, dividends, etc.)
 * @returns Projected SS, pension, and passive income at RMD age
 */
export function estimateFixedIncomeAtRMD(
    currentSSIncome: number,
    futureSS_PIA: number,
    currentPensionIncome: number,
    currentAge: number,
    rmdStartAge: number,
    ssClaimingAge: number = 67,
    ssCola: number = DEFAULT_SS_COLA,
    pensionCola: number = DEFAULT_PENSION_COLA,
    currentPassiveIncome: number = 0
): FixedIncomeAtRMDResult {
    // If already at or past RMD age, no projection needed
    if (currentAge >= rmdStartAge) {
        return {
            ssAtRMD: currentSSIncome,
            pensionAtRMD: currentPensionIncome,
            passiveAtRMD: currentPassiveIncome,
            yearsProjected: 0
        };
    }

    const yearsUntilRMD = rmdStartAge - currentAge;

    // --- Project SS to RMD age ---
    let ssAtRMD: number;

    if (currentSSIncome > 0) {
        // Already receiving SS - project forward with COLA
        ssAtRMD = currentSSIncome * Math.pow(1 + ssCola, yearsUntilRMD);
    } else if (futureSS_PIA > 0) {
        // Not yet receiving SS - use PIA and project with COLA
        // PIA is monthly, convert to annual
        const annualSS = futureSS_PIA * 12;

        // Calculate years of COLA from claiming age to RMD age
        // SS benefits get COLA starting the year after claiming
        const yearsOfSSCola = Math.max(0, rmdStartAge - ssClaimingAge);
        ssAtRMD = annualSS * Math.pow(1 + ssCola, yearsOfSSCola);
    } else {
        // No SS info available - default to $0
        // User should add a FutureSocialSecurityIncome object for accurate planning
        ssAtRMD = 0;
    }

    // --- Project Pension to RMD age ---
    let pensionAtRMD: number;

    if (currentPensionIncome > 0) {
        // Project pension forward with COLA
        pensionAtRMD = currentPensionIncome * Math.pow(1 + pensionCola, yearsUntilRMD);
    } else {
        // No pension or not yet receiving
        pensionAtRMD = 0;
    }

    return {
        ssAtRMD,
        pensionAtRMD,
        passiveAtRMD: currentPassiveIncome,
        yearsProjected: yearsUntilRMD
    };
}

// =============================================================================
// INCOME EXTRACTION FOR RMD PLANNING
// =============================================================================

/**
 * Result of extracting income sources for RMD planning
 */
export interface ExtractedIncomeForRMD {
    /** Current Social Security income (0 if not yet claiming) */
    socialSecurityBenefits: number;
    /** Monthly PIA from FutureSocialSecurityIncome (0 if not available) */
    futureSS_PIA: number;
    /** Age when SS will be claimed */
    ssClaimingAge: number;
    /** Current pension income */
    pensionIncome: number;
    /** Current passive income (rental, dividends, interest) */
    passiveIncome: number;
    /** Social Security COLA rate */
    ssCola: number;
    /** Pension COLA rate */
    pensionCola: number;
}

/**
 * Extract Social Security and pension income from income context for RMD planning.
 *
 * This helper extracts the necessary income data from plain JSON income objects
 * (after localStorage deserialization) to feed into estimateFixedIncomeAtRMD().
 *
 * Use this when you need to project fixed income to RMD age but only have access
 * to the income context, not simulation results.
 *
 * @param incomes - Array of income objects from IncomeContext (class instances with className property)
 * @param currentYear - Current calendar year for getAnnualAmount() calls
 * @param inflationAdjusted - Whether to apply COLA (from state.macro.inflationAdjusted)
 * @returns Extracted income data ready for estimateFixedIncomeAtRMD()
 */
export function extractIncomeForRMDEstimate(
    incomes: any[], // AnyIncome[] - class instances with className property
    currentYear: number,
    inflationAdjusted: boolean
): ExtractedIncomeForRMD {
    // Extract current SS income (if already claiming)
    // Includes both SocialSecurityIncome (legacy) and CurrentSocialSecurityIncome (disability, survivor, already-claimed)
    const socialSecurityBenefits = incomes
        .filter(i => i.className === 'SocialSecurityIncome' || i.className === 'CurrentSocialSecurityIncome')
        .reduce((sum, i) => sum + i.getAnnualAmount(currentYear), 0);

    // Extract future SS (if not yet claiming)
    const futureSS = incomes.find(i =>
        i.className === 'FutureSocialSecurityIncome'
    ) as { calculatedPIA?: number; claimingAge?: number; amount?: number; projectedPIA?: number } | undefined;
    // Use projectedPIA if > 0, then fall back to amount/12, then calculatedPIA, then 0.
    // Cannot use ?? because projectedPIA defaults to 0 (not undefined), so ?? treats it as valid.
    const futureSS_PIA = (futureSS?.projectedPIA && futureSS.projectedPIA > 0)
        ? futureSS.projectedPIA
        : (futureSS?.amount ? futureSS.amount / 12 : (futureSS?.calculatedPIA ?? 0));
    const ssClaimingAge = futureSS?.claimingAge ?? 67;

    // Extract pension income
    const pensionIncome = incomes
        .filter(i => i.className && i.className.includes('Pension'))
        .reduce((sum, i) => sum + i.getAnnualAmount(currentYear), 0);

    // Extract passive income (rental, dividends, interest, etc.)
    const passiveIncome = incomes
        .filter(i => i.className === 'PassiveIncome')
        .reduce((sum, i) => sum + i.getAnnualAmount(currentYear), 0);

    // Get inflation settings
    const ssCola = inflationAdjusted ? 0.02 : 0;
    const pensionCola = inflationAdjusted ? 0.02 : 0;

    return {
        socialSecurityBenefits,
        futureSS_PIA,
        ssClaimingAge,
        pensionIncome,
        passiveIncome,
        ssCola,
        pensionCola
    };
}
