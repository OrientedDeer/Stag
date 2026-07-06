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

import { AnyIncome, PassiveIncome, WorkIncome, FERSPensionIncome, CSRSPensionIncome, WindfallIncome, isSocialSecurity } from "../../components/Objects/Income/models";
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

    // Derive the RMD from the incomes list as a fallback when the caller passes 0.
    // processRMDs drains the Trad account and surfaces the distribution as a
    // PassiveIncome with sourceType 'RMD'; the retirement path passes that same total
    // in as `rmdAmount`, but solveWorkingYear passes 0 (working-year path). Without
    // this, a plan that keeps working PAST the RMD age loses the RMD dollars entirely:
    // the account is drained, the loop below strips the RMD-sourced passive income (it's
    // meant to be re-added via `rmdAmount`), and adding 0 back means those dollars are
    // never taxed and never arrive as spendable cash. When `rmdAmount` is supplied
    // (retirement path) it equals this sum, so `rmdAmount > 0` keeps that path
    // byte-identical; only the working-year 0 case falls back to the list.
    const rmdFromList = incomes.reduce((sum, income) => {
        if (income instanceof PassiveIncome && income.sourceType === 'RMD') {
            return sum + Math.max(0, income.getAnnualAmount(year));
        }
        return sum;
    }, 0);
    const effectiveRmdAmount = rmdAmount > 0 ? rmdAmount : rmdFromList;

    // Initialize breakdown
    const breakdown = {
        wages: 0,
        socialSecurity: 0,
        pensions: 0,
        passive: 0,
        rmd: effectiveRmdAmount,
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
        } else if (isSocialSecurity(income)) {
            // Social Security is always spendable. Use the canonical className-aware
            // predicate so reconstituted (plain-JSON, prototype-stripped) SS income —
            // e.g. a sim year rehydrated from cache or marshalled across a worker —
            // classifies the same as a live instance and isn't misbucketed as passive.
            spendable += annualAmount;
            breakdown.socialSecurity += annualAmount;
        } else if (income instanceof FERSPensionIncome) {
            // FERS pension is always spendable; include the MRA-to-62 supplement.
            const fersTotal = income.getTotalAnnualAmount(year);
            spendable += fersTotal;
            breakdown.pensions += fersTotal;
        } else if (income instanceof CSRSPensionIncome) {
            // CSRS pension is always spendable
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

    // RMD is always spendable (tracked separately from the stripped RMD passive income).
    spendable += effectiveRmdAmount;

    // Calculate taxable total:
    // - All spendable income is taxable
    // - Reinvested income is taxable
    // - RMD is already included in spendable
    // - Conversion is taxable but not spendable
    const taxableTotal = spendable + reinvested + conversionAmount;

    const classified: ClassifiedIncome = {
        spendable,
        reinvested,
        rmdIncome: effectiveRmdAmount,
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
        // Canonical className-aware predicate so reconstituted SS income counts too.
        if (isSocialSecurity(income)) {
            // Guard the prototype method: the className-aware predicate also matches
            // method-less className-only objects (raw mock-fixture / worker literals).
            // A method-bearing object yields its real amount; a method-less one adds 0
            // instead of throwing.
            total += income.getAnnualAmount?.(year) ?? 0;
        }
    }
    return total;
}

