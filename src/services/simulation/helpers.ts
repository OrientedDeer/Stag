import { type AnyAccount, InvestedAccount, SavedAccount, ESPPAccount } from "../../components/Objects/Accounts/models";
import { type FilingStatus, type TaxParameters } from "../../data/TaxData";
import * as TaxService from "../../components/Objects/Taxes/TaxService";
import { computeIrmaaMAGI } from "../../data/IRMAAData";

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

/**
 * Medicare IRMAA awareness for conversion sizing. IRMAA is a cliff surcharge on
 * Part B/D premiums that lands TWO YEARS after the income year. We attribute that
 * deferred surcharge to the conversion decision now (realization-year), so the
 * rate-match search avoids conversions that trip a tier for little benefit.
 *
 * Provided only on the SEARCH path (not the reported-cost path): the actual
 * surcharge is deducted in year N+2 via the engine's true 2-year lookback, so
 * folding it into the reported conversion tax would double-count it.
 */
export interface IRMAAConversionOptions {
    /** Annual household IRMAA surcharge for a given MAGI (returns 0 outside Medicare). */
    annualSurchargeForMAGI: (magi: number) => number;
    /** Smallest IRMAA tier floor strictly above the given MAGI, or null when already
     *  in the top tier. The coarse search steps in $5k and would otherwise step over
     *  a narrow cliff, so the search probes this exact crossing point (like ACA). */
    nextThresholdAbove: (magi: number) => number | null;
}

export interface ConversionTaxBreakdown {
    federalOrdinaryTaxCost: number;
    ssTorpedoCost: number;
    ltcgBumpCost: number;
    niitCost: number;
    stateTaxCost: number;
    acaSubsidyLost: number;
    /** Increase in the (2-years-deferred) IRMAA surcharge caused by the conversion. */
    irmaaSurchargeIncrease: number;
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
 * The conversion-INDEPENDENT "before" tax positions used by
 * calculateEffectiveConversionTax. They depend only on the fixed income inputs,
 * so a search that probes many conversion amounts at the same income (e.g.
 * coarseToFineSearch via getEffectiveConversionRate) can compute this once and
 * pass it in via the optional `baseline` param instead of recomputing it on
 * every probe.
 */
export interface ConversionTaxBaseline {
    taxResultBefore: ReturnType<typeof TaxService.calculateTotalFederalTax>;
    taxBeforeManualSS: ReturnType<typeof TaxService.calculateTotalFederalTax>;
    stateTaxBefore: number;
}

export function computeConversionTaxBaseline(
    nonSSIncome: number,
    totalSSBenefits: number,
    ltcgIncome: number,
    filingStatus: FilingStatus,
    fedParams: TaxParameters,
    stateParams: TaxParameters | null,
): ConversionTaxBaseline {
    const taxResultBefore = TaxService.calculateTotalFederalTax(
        nonSSIncome, totalSSBenefits, 0, ltcgIncome, 0, filingStatus, fedParams,
    );
    // "before" with taxable SS folded into ordinary income (frozen-SS baseline).
    const taxBeforeManualSS = TaxService.calculateTotalFederalTax(
        nonSSIncome + taxResultBefore.taxableSS, 0, 0, ltcgIncome, 0, filingStatus, fedParams,
    );
    const stateTaxBefore = stateParams
        ? TaxService.calculateTax(nonSSIncome + ltcgIncome, 0, stateParams)
        : 0;
    return { taxResultBefore, taxBeforeManualSS, stateTaxBefore };
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
    acaOptions?: ACAOptions,
    /** Precomputed conversion-independent "before" positions. When omitted they
     *  are computed here (unchanged behavior); a probing search can compute them
     *  once and pass them in to avoid recomputing on every probe. */
    baseline?: ConversionTaxBaseline,
    /** Medicare IRMAA awareness (search path only). When omitted, no IRMAA cost is
     *  attributed — behavior is identical to before this feature. */
    irmaaOptions?: IRMAAConversionOptions,
): EffectiveConversionTaxResult {
    const base = baseline ?? computeConversionTaxBaseline(
        nonSSIncome, totalSSBenefits, ltcgIncome, filingStatus, fedParams, stateParams,
    );
    // =========================================================================
    // CALCULATE FULL TAX BEFORE AND AFTER CONVERSION
    // =========================================================================
    // Use calculateTotalFederalTax for unified handling of SS taxability and LTCG stacking
    // Note: ltcgIncome is passed as longTermCapitalGains (4th param), STCG is 0 (3rd param)
    const taxResultBefore = base.taxResultBefore;

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

    // Also need the "before" state with SS added manually for apples-to-apples
    // comparison (conversion-independent; supplied by the baseline).
    const taxBeforeManualSS = base.taxBeforeManualSS;

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
        const stateTaxBefore = base.stateTaxBefore;
        const stateTaxAfter = TaxService.calculateTax(stateIncome + conversionAmount, 0, stateParams);
        stateTaxCost = stateTaxAfter - stateTaxBefore;
    }

    // =========================================================================
    // ACA SUBSIDY CLIFF
    // =========================================================================
    let crossesACACliff = false;
    let acaSubsidyLost = 0;
    if (acaOptions && acaOptions.acaSubsidyAware && acaOptions.currentAge < 65) {
        // MAGI for ACA includes 100% of SS benefits (not just taxable portion) and
        // capital gains (LTCG is part of AGI), so cliff crossings are detected for
        // retirees with capital gains.
        const magiBefore = nonSSIncome + totalSSBenefits + ltcgIncome;
        const magiAfter = magiBefore + conversionAmount;

        if (magiBefore < acaOptions.acaCliffThreshold && magiAfter >= acaOptions.acaCliffThreshold) {
            crossesACACliff = true;
            acaSubsidyLost = acaOptions.estimatedSubsidyLoss;
        }
    }

    // =========================================================================
    // MEDICARE IRMAA SURCHARGE (realization-year attribution)
    // =========================================================================
    // A conversion raises this year's MAGI, which sets the Part B/D premium
    // surcharge two years later. We charge that surcharge delta to the conversion
    // decision now (mirroring acaSubsidyLost). IRMAA MAGI ≈ non-SS income +
    // taxable SS (which the conversion can push up via the torpedo) + LTCG.
    let irmaaSurchargeIncrease = 0;
    if (irmaaOptions) {
        const irmaaMagiBefore = computeIrmaaMAGI(nonSSIncome, totalSSBenefits, ltcgIncome, filingStatus);
        const irmaaMagiAfter = computeIrmaaMAGI(nonSSIncome + conversionAmount, totalSSBenefits, ltcgIncome, filingStatus);
        irmaaSurchargeIncrease = Math.max(0,
            irmaaOptions.annualSurchargeForMAGI(irmaaMagiAfter) -
            irmaaOptions.annualSurchargeForMAGI(irmaaMagiBefore));
    }

    // =========================================================================
    // TOTALS
    // =========================================================================
    const taxBefore = taxResultBefore.totalTax;
    const taxAfter = taxResultAfter.totalTax;
    const taxIncrease = (taxAfter - taxBefore) + stateTaxCost + acaSubsidyLost + irmaaSurchargeIncrease;
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
            acaSubsidyLost,
            irmaaSurchargeIncrease
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

