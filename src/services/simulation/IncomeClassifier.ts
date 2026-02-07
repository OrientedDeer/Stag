/**
 * IncomeClassifier.ts
 *
 * Classifies income into spendable vs reinvested categories for deficit calculation.
 *
 * Income Classification Rules:
 * - Spendable: Cash available to cover expenses (wages, SS, pensions, rental, etc.)
 * - Reinvested: Taxable but not available as cash (reinvested dividends/interest)
 * - RMD Income: Required distributions - always spendable and taxable
 * - Conversion Income: Roth conversions - taxable but NOT spendable (it's a transfer)
 */

import { AnyIncome, PassiveIncome, WorkIncome, SocialSecurityIncome, CurrentSocialSecurityIncome, FutureSocialSecurityIncome, FERSPensionIncome, CSRSPensionIncome, WindfallIncome } from "../../components/Objects/Income/models";
import { ClassifiedIncome, IncomeClassificationResult, DecisionLogEntry } from "./types";

/**
 * Classifies all active incomes for a simulation year.
 *
 * @param incomes - All income objects for the year
 * @param rmdAmount - Total RMD amount for the year (from RMD processing)
 * @param conversionAmount - Total Roth conversion amount (taxable but not spendable)
 * @param year - Current simulation year
 * @returns Classified income breakdown
 */
export function classifyIncome(
    incomes: AnyIncome[],
    rmdAmount: number,
    conversionAmount: number,
    year: number // Current simulation year for date-based filtering
): IncomeClassificationResult {
    const decisions: DecisionLogEntry[] = [];

    // Initialize breakdown
    const breakdown = {
        wages: 0,
        socialSecurity: 0,
        pensions: 0,
        passive: 0,
        rmd: rmdAmount,
        reinvested: 0,
    };

    let spendable = 0;
    let reinvested = 0;

    for (const income of incomes) {
        // Pass year to apply date-based filtering (incomes outside their date range return 0)
        const annualAmount = income.getAnnualAmount(year);
        if (annualAmount <= 0) continue;

        if (income instanceof WorkIncome) {
            // Work income is always spendable
            spendable += annualAmount;
            breakdown.wages += annualAmount;
        } else if (income instanceof SocialSecurityIncome ||
            income instanceof CurrentSocialSecurityIncome ||
            income instanceof FutureSocialSecurityIncome) {
            // Social Security is always spendable
            spendable += annualAmount;
            breakdown.socialSecurity += annualAmount;
        } else if (income instanceof FERSPensionIncome || income instanceof CSRSPensionIncome) {
            // Pensions are always spendable
            spendable += annualAmount;
            breakdown.pensions += annualAmount;
        } else if (income instanceof PassiveIncome) {
            // PassiveIncome can be reinvested or spendable based on isReinvested flag
            if (income.isReinvested) {
                reinvested += annualAmount;
                breakdown.reinvested += annualAmount;
            } else {
                spendable += annualAmount;
                breakdown.passive += annualAmount;
            }

            // Special handling for RMD-sourced passive income
            // Note: RMD creates a PassiveIncome with sourceType 'RMD', but the actual RMD amount
            // is passed in separately to avoid double-counting. We skip RMD-sourced passive income.
            if (income.sourceType === 'RMD') {
                // RMD amount is passed in separately, don't double-count
                // Actually, let's undo what we just added since RMD is tracked separately
                if (income.isReinvested) {
                    reinvested -= annualAmount;
                    breakdown.reinvested -= annualAmount;
                } else {
                    spendable -= annualAmount;
                    breakdown.passive -= annualAmount;
                }
            }
        } else if (income instanceof WindfallIncome) {
            // Windfalls are spendable
            spendable += annualAmount;
            breakdown.passive += annualAmount;
        } else {
            // Default: treat as spendable passive income
            spendable += annualAmount;
            breakdown.passive += annualAmount;
        }
    }

    // RMD is always spendable (passed in separately)
    spendable += rmdAmount;

    // Calculate taxable total:
    // - All spendable income is taxable
    // - Reinvested income is taxable
    // - RMD is already included in spendable
    // - Conversion is taxable but not spendable
    const taxableTotal = spendable + reinvested + conversionAmount;

    const classified: ClassifiedIncome = {
        spendable,
        reinvested,
        rmdIncome: rmdAmount,
        conversionIncome: conversionAmount,
        taxableTotal,
        breakdown,
    };

    // Log significant classifications
    if (reinvested > 0) {
        decisions.push({
            category: 'tax',
            amount: reinvested,
            description: `Reinvested income of $${reinvested.toLocaleString()} is taxable but not available for spending.`,
        });
    }

    if (conversionAmount > 0) {
        decisions.push({
            category: 'conversion',
            amount: conversionAmount,
            description: `Roth conversion of $${conversionAmount.toLocaleString()} is taxable but not spendable (transfer between accounts).`,
        });
    }

    return {
        classified,
        logs: decisions.map(d => d.description),
    };
}

/**
 * Get total Social Security benefits from incomes.
 * Used for SS taxability calculation (not the same as taxable SS).
 */
export function getTotalSSBenefits(incomes: AnyIncome[], year: number): number {
    let total = 0;
    for (const income of incomes) {
        if (income instanceof SocialSecurityIncome ||
            income instanceof CurrentSocialSecurityIncome ||
            income instanceof FutureSocialSecurityIncome) {
            total += income.getAnnualAmount(year);
        }
    }
    return total;
}

/**
 * Get total pension income from incomes.
 */
export function getTotalPensionIncome(incomes: AnyIncome[], year: number): number {
    let total = 0;
    for (const income of incomes) {
        if (income instanceof FERSPensionIncome || income instanceof CSRSPensionIncome) {
            total += income.getAnnualAmount(year);
        }
    }
    return total;
}

/**
 * Get total earned income from incomes.
 * Used for Roth IRA contribution eligibility.
 */
export function getTotalEarnedIncome(incomes: AnyIncome[], year: number): number {
    let total = 0;
    for (const income of incomes) {
        if (income.earned_income === 'Yes') {
            total += income.getAnnualAmount(year);
        }
    }
    return total;
}

/**
 * Get total wage income (for FICA calculation).
 */
export function getTotalWageIncome(incomes: AnyIncome[], year: number): number {
    let total = 0;
    for (const income of incomes) {
        if (income instanceof WorkIncome) {
            total += income.getAnnualAmount(year);
        }
    }
    return total;
}
