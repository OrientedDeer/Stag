/**
 * Calculate ESPP disposition tax breakdown.
 *
 * ESPP shares have special tax treatment based on holding periods:
 *
 * **Qualifying Disposition** (held 2 years from grant AND 1 year from purchase):
 * - Ordinary income = lesser of: (1) the grant bargain element (fmvAtGrant - purchasePrice),
 *   or (2) actual gain
 * - Capital gains = remainder (long-term)
 *
 * **Disqualifying Disposition** (sold before meeting both holding periods):
 * - Ordinary income = FMV at purchase - purchase price (the "bargain element")
 * - Capital gains = sale price - FMV at purchase (can be short or long term)
 *
 * TODO: This function is exported and tested but not used in the app.
 * Either wire it up to the ESPP account UI (e.g., lot sale preview) or delete it.
 *
 * @param sharesToSell - Number of shares being sold
 * @param salePrice - Sale price per share
 * @param purchasePrice - Original purchase price per share
 * @param fmvAtGrant - Fair market value at grant date
 * @param fmvAtPurchase - Fair market value at purchase date
 * @param isQualifying - Whether this is a qualifying disposition
 * @param isLongTermCG - Whether capital gains portion qualifies as long-term
 * @returns Tax breakdown with ordinary income and capital gains amounts
 */
export function calculateESPPDispositionTax(
    sharesToSell: number,
    salePrice: number,
    purchasePrice: number,
    fmvAtGrant: number,
    fmvAtPurchase: number,
    isQualifying: boolean,
    isLongTermCG: boolean,
): {
    ordinaryIncome: number;
    shortTermCapitalGains: number;
    longTermCapitalGains: number;
    totalTaxableGain: number;
} {
    const totalSaleProceeds = sharesToSell * salePrice;
    const totalCostBasis = sharesToSell * purchasePrice;
    const totalGain = totalSaleProceeds - totalCostBasis;

    let ordinaryIncome = 0;
    let shortTermCapitalGains = 0;
    let longTermCapitalGains = 0;

    if (isQualifying) {
        // Qualifying disposition
        // A sale at/below cost recognizes no ordinary income — the qualifying
        // rule caps ordinary income at the ACTUAL gain (IRC §423(c)), so a loss
        // is pure capital loss (always long-term: qualifying requires >1yr from
        // purchase).
        if (totalGain <= 0) {
            longTermCapitalGains = totalGain;
        } else {
            // Ordinary income = lesser of the grant bargain element or the actual gain.
            // The bargain element is the ACTUAL discount at grant (fmvAtGrant - purchasePrice),
            // NOT a hardcoded 15% — ESPP discounts vary (and can be measured at the lower of
            // grant/purchase FMV under a lookback plan). Using the real discount matches the IRS
            // rule and the disqualifying branch below (#16).
            const grantDiscount = Math.max(0, fmvAtGrant - purchasePrice) * sharesToSell;
            ordinaryIncome = Math.min(grantDiscount, totalGain);
            longTermCapitalGains = totalGain - ordinaryIncome;
        }
    } else {
        // Disqualifying disposition
        // The purchase-date bargain element is ordinary income REGARDLESS of the
        // sale price (IRC §421(b) has no gain cap for disqualifying dispositions
        // — unlike the qualifying rule above). It also steps up the basis to
        // fmvAtPurchase, so a sale below FMV-at-purchase produces the full
        // ordinary income PLUS a capital loss. The old code routed a sale at a
        // net loss entirely to capital loss, silently dropping the bargain
        // element from ordinary income.
        const bargainElement = Math.max(0, fmvAtPurchase - purchasePrice) * sharesToSell;
        ordinaryIncome = bargainElement;

        const capitalGain = totalGain - bargainElement;
        if (isLongTermCG) {
            longTermCapitalGains = capitalGain;
        } else {
            shortTermCapitalGains = capitalGain;
        }
    }

    return {
        ordinaryIncome,
        shortTermCapitalGains,
        longTermCapitalGains,
        totalTaxableGain: ordinaryIncome + shortTermCapitalGains + longTermCapitalGains,
    };
}
