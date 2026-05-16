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

    // Select thresholds based on filing status
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
    const tier1Amount = (thresholds.second - thresholds.first) * SS_TIER1_TAXABLE_RATE;
    const tier2Amount = excessAboveSecond * SS_TIER2_TAXABLE_RATE;
    const totalTaxable = tier1Amount + tier2Amount;

    // Cap at 85% of total benefits
    return Math.min(totalTaxable, totalSSBenefits * SS_MAX_TAXABLE_RATE);
}
