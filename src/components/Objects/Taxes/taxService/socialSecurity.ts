import { FilingStatus } from "../../../../data/TaxData";

/** Social Security combined income thresholds for benefit taxation */
const SS_THRESHOLDS_SINGLE = { first: 25000, second: 34000 };
const SS_THRESHOLDS_JOINT = { first: 32000, second: 44000 };

/** Social Security taxation rates */
const SS_TIER1_TAXABLE_RATE = 0.5;  // 50% of excess taxable in tier 1
const SS_TIER2_TAXABLE_RATE = 0.85; // 85% of excess taxable in tier 2
const SS_MAX_TAXABLE_RATE = 0.85;   // Maximum 85% of benefits can be taxed

/**
 * Calculate taxable portion of Social Security benefits.
 *
 * Combined Income = otherIncome + taxExemptInterest + 50% of SS Benefits
 *
 * Thresholds (not inflation-adjusted since 1984/1993):
 * Single/MFS:
 *   < $25,000: 0% taxable
 *   $25,000-$34,000: Up to 50% taxable
 *   > $34,000: Up to 85% taxable
 *
 * Married Filing Jointly:
 *   < $32,000: 0% taxable
 *   $32,000-$44,000: Up to 50% taxable
 *   > $44,000: Up to 85% taxable
 *
 * MFS APPROXIMATION (#33): We apply the Single base amounts ($25k/$34k) to Married
 * Filing Separately. That is exactly correct ONLY for a MFS taxpayer who lived APART
 * from their spouse for the ENTIRE year. A MFS taxpayer who lived WITH their spouse at
 * any time during the year has a $0 base amount under IRS rules (so up to 85% of
 * benefits is taxable from the first dollar of combined income) — for that sub-case
 * this function UNDER-taxes SS. The model has no "lived apart from spouse all year"
 * flag, so we keep the lived-apart-correct Single thresholds rather than silently
 * flipping every MFS filer to a $0 base (which would OVER-tax the lived-apart case).
 * A proper fix needs a per-taxpayer "lived apart from spouse all year" toggle.
 *
 * @param totalSSBenefits - Gross Social Security benefits received
 * @param otherIncome - All taxable income EXCEPT SS. Must include:
 *                      - Wages and salaries
 *                      - Pension income
 *                      - Traditional IRA/401k withdrawals
 *                      - Roth conversions
 *                      - Long-term capital gains
 *                      - Short-term capital gains
 *                      - Qualified dividends
 *                      - Ordinary dividends
 *                      - Interest income
 *                      - Rental income
 *                      - Any other taxable income
 * @param taxExemptInterest - Municipal bond interest. Not taxed federally, but DOES count
 *                            toward SS combined income calculation. Pass 0 if not tracking.
 *                            TODO: System does not currently track tax-exempt interest separately.
 * @param filingStatus - Tax filing status (Single, MFJ, MFS)
 * @returns Taxable portion of SS benefits (0 to 85% of totalSSBenefits)
 */
export function getTaxableSocialSecurityBenefits(
    totalSSBenefits: number,
    otherIncome: number,
    taxExemptInterest: number,
    filingStatus: FilingStatus,
): number {
    if (totalSSBenefits === 0) return 0;

    // Combined income = otherIncome + taxExemptInterest + 50% of SS Benefits
    const combinedIncome = otherIncome + taxExemptInterest + (totalSSBenefits * SS_TIER1_TAXABLE_RATE);

    // Select thresholds based on filing status. MFS uses the Single base amounts:
    // correct for a MFS filer who lived apart from their spouse all year, but it
    // under-taxes a MFS filer who lived with their spouse (IRS base $0). See the
    // function doc comment (#33) — a proper fix needs a "lived apart" toggle.
    const useSingleThresholds = filingStatus === 'Single' || filingStatus === 'Married Filing Separately';
    const thresholds = useSingleThresholds ? SS_THRESHOLDS_SINGLE : SS_THRESHOLDS_JOINT;

    // No SS benefits are taxable below first threshold
    if (combinedIncome < thresholds.first) {
        return 0;
    }

    // Up to 50% of SS benefits are taxable between first and second threshold
    if (combinedIncome < thresholds.second) {
        const excessAboveFirst = combinedIncome - thresholds.first;
        const taxable50Percent = Math.min(
            excessAboveFirst * SS_TIER1_TAXABLE_RATE,
            totalSSBenefits * SS_TIER1_TAXABLE_RATE,
        );
        return Math.min(taxable50Percent, totalSSBenefits);
    }

    // Up to 85% of SS benefits are taxable above second threshold
    const excessAboveSecond = combinedIncome - thresholds.second;
    const tier1Amount = Math.min((thresholds.second - thresholds.first) * SS_TIER1_TAXABLE_RATE, totalSSBenefits * SS_TIER1_TAXABLE_RATE);
    const tier2Amount = excessAboveSecond * SS_TIER2_TAXABLE_RATE;
    const totalTaxable = tier1Amount + tier2Amount;

    // Cap at 85% of total benefits
    return Math.min(totalTaxable, totalSSBenefits * SS_MAX_TAXABLE_RATE);
}

/**
 * Taxable portion of SS from a precomputed AGI-excluding-SS base.
 *
 * Thin wrapper that pins the app-wide convention for the two fixed arguments to
 * getTaxableSocialSecurityBenefits — tax-exempt interest = 0 (not tracked) — so
 * every SS-taxability site routes the `base → taxableSS` step through ONE call.
 *
 * IMPORTANT: this does NOT floor `agiExcludingSS` at 0. Callers decide the floor:
 *  - getTaxableSocialSecurityFromComponents floors (max(0, …)) — federal convention.
 *  - stateTax's 'taxable' path passes its raw `nonSSGross − preTax` UN-floored, so a
 *    negative base lowers combined income (its long-standing behavior). Keeping the
 *    floor decision at the call site preserves that exact behavior on both paths.
 *
 * @param agiExcludingSS - The `otherIncome` term (AGI excluding SS), pre-floored
 *                         by the caller if/as desired.
 */
export function getTaxableSocialSecurityFromBase(
    agiExcludingSS: number,
    socialSecurityBenefits: number,
    filingStatus: FilingStatus,
): number {
    return getTaxableSocialSecurityBenefits(
        socialSecurityBenefits,
        agiExcludingSS,
        0, // tax-exempt interest — not currently tracked
        filingStatus,
    );
}

/**
 * Taxable portion of SS from raw income COMPONENTS — the single source of the
 * provisional-income (AGI-excluding-SS) FORMULA that drives SS taxability.
 *
 * The provisional base (the `otherIncome` fed to getTaxableSocialSecurityBenefits)
 * is `max(0, ordinaryIncome + stcg + ltcg − preTaxDeductions)`, with tax-exempt
 * interest = 0 (the app does not track it). Both bracketTax.ts's standard-path
 * calculation and federalTax.ts's OBBBA-bonus MAGI proxy need exactly this same
 * taxable-SS value, so they share this helper rather than each open-coding the
 * SS-taxability formula (which previously lived in two files and risked drift
 * near the SS-taxability thresholds).
 *
 * Returns a bare number (the taxable SS). The provisional base is intentionally
 * NOT returned: federalTax's MAGI proxy reconstructs its own AGI term from the
 * un-clamped components — `max(0, ordinary+stcg+ltcg+taxableSS−preTax)` — which
 * is NOT the same as `clampedBase + taxableSS` when the AGI term is negative but
 * SS is large enough to be partly taxable. Exposing the clamped base would invite
 * a caller to assemble a different (off-by-the-clamp) MAGI. The clamp lives here
 * only as the `otherIncome` floor that getTaxableSocialSecurityBenefits expects.
 *
 * @returns the taxable portion of the SS benefits.
 */
export function getTaxableSocialSecurityFromComponents(
    ordinaryIncome: number,
    shortTermCapitalGains: number,
    longTermCapitalGains: number,
    preTaxDeductions: number,
    socialSecurityBenefits: number,
    filingStatus: FilingStatus,
): number {
    const provisionalBase = Math.max(
        0,
        ordinaryIncome + shortTermCapitalGains + longTermCapitalGains - preTaxDeductions,
    );
    return getTaxableSocialSecurityFromBase(provisionalBase, socialSecurityBenefits, filingStatus);
}
