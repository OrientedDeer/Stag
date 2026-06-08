/**
 * Calculate ESPP disposition tax breakdown.
 *
 * ESPP shares have special tax treatment based on holding periods:
 *
 * **Qualifying Disposition** (held 2 years from grant AND 1 year from purchase):
 * - Ordinary income = lesser of: (1) discount at grant price, or (2) actual gain
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

    if (totalGain <= 0) {
        // Loss scenario - all goes to capital gains (loss)
        if (isLongTermCG) {
            longTermCapitalGains = totalGain;
        } else {
            shortTermCapitalGains = totalGain;
        }
    } else if (isQualifying) {
        // Qualifying disposition
        // Ordinary income = lesser of grant discount or actual gain
        const grantDiscount = fmvAtGrant * 0.15 * sharesToSell; // Typical 15% discount
        ordinaryIncome = Math.min(grantDiscount, totalGain);
        longTermCapitalGains = totalGain - ordinaryIncome;
    } else {
        // Disqualifying disposition
        const bargainElement = (fmvAtPurchase - purchasePrice) * sharesToSell;
        ordinaryIncome = Math.max(0, bargainElement);

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
