import { type TaxParameters } from "../../../../data/TaxData";

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

// NOTE: a standalone `calculateCapitalGainsTax(gains, postDeductionOrdinary, …)`
// helper used to live here. It had zero production callers, and its
// post-deduction contract structurally forfeited the unused-deduction LTCG
// offset for any future caller (the engine path in calculateTotalFederalTax
// STEP 5 applies leftover deduction to LTCG; this wrapper reconstructed the
// inputs so no deduction could ever be left over). Deleted — call
// calculateTotalFederalTax with PRE-deduction ordinary income instead.
