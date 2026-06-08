import { TaxState } from "../TaxContext";
import { AssumptionsState } from "../../Assumptions/AssumptionsContext";
import { getTaxParameters } from "./parameters";
import { TaxParameters } from "../../../../data/TaxData";

/**
 * Get the long-term capital gains rate that applies at a given ordinary income
 * level. LTCG stack on top of ordinary income, so the applicable rate is the
 * highest capital-gains bracket whose threshold the ordinary income reaches.
 *
 * Walks brackets high→low and returns the first whose threshold is met
 * (>=). Falls back to a flat 15% when no capital-gains brackets are available,
 * and to 0% when the bracket array is empty.
 *
 * @param ordinaryIncome - Ordinary income that positions the gains in a bracket
 * @param fedParams - Federal tax parameters (supplying capitalGainsBrackets)
 * @returns The applicable LTCG rate (decimal)
 */
export function getLTCGRate(ordinaryIncome: number, fedParams: TaxParameters | null | undefined): number {
    if (!fedParams?.capitalGainsBrackets) return 0.15;

    const brackets = fedParams.capitalGainsBrackets;
    for (let i = brackets.length - 1; i >= 0; i--) {
        if (ordinaryIncome >= brackets[i].threshold) {
            return brackets[i].rate;
        }
    }
    return brackets[0]?.rate ?? 0;
}

/**
 * Calculate capital gains tax on long-term gains.
 * Capital gains are taxed based on your total taxable income bracket.
 * The gains "stack on top" of ordinary income to determine the applicable rate.
 *
 * @param gains - Amount of long-term capital gains
 * @param ordinaryTaxableIncome - Taxable income from ordinary sources (after deductions)
 * @param taxState - Filing status and other tax state
 * @param year - Tax year
 * @param assumptions - Assumptions for inflation adjustments
 * @returns The tax owed on the capital gains
 */
export function calculateCapitalGainsTax(
    gains: number,
    ordinaryTaxableIncome: number,
    taxState: TaxState,
    year: number,
    assumptions?: AssumptionsState,
): number {
    if (gains <= 0) return 0;

    const fedParams = getTaxParameters(year, taxState.filingStatus, 'federal', undefined, assumptions);
    if (!fedParams || !fedParams.capitalGainsBrackets) {
        // Fallback to flat 15% if no brackets available
        return gains * 0.15;
    }

    const brackets = fedParams.capitalGainsBrackets;
    let remainingGains = gains;
    let totalTax = 0;
    let incomeLevel = Math.max(0, ordinaryTaxableIncome);

    for (let i = 0; i < brackets.length && remainingGains > 0; i++) {
        const currentBracket = brackets[i];
        const nextBracket = brackets[i + 1];
        const upperLimit = nextBracket ? nextBracket.threshold : Infinity;

        if (incomeLevel >= upperLimit) continue;

        const roomInBracket = upperLimit - incomeLevel;
        const gainsInBracket = Math.min(remainingGains, roomInBracket);
        totalTax += gainsInBracket * currentBracket.rate;

        incomeLevel += gainsInBracket;
        remainingGains -= gainsInBracket;
    }

    return totalTax;
}
