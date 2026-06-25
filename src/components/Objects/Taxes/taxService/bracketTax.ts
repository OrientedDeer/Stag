/**
 * The core bracket-walking federal tax calculation. Lives here (not in
 * federalTax.ts) so that stateTax.ts can use `calculateTax` for its
 * bracket math without creating a circular dependency back to the
 * federal-from-incomes orchestrator.
 */
import { FilingStatus, TaxParameters } from "../../../../data/TaxData";
import { getTaxableSocialSecurityFromComponents } from "./socialSecurity";

/** Result of the unified federal tax calculation */
export interface TotalFederalTaxResult {
    taxableSS: number;      // Taxable portion of SS benefits
    ordinaryTax: number;    // Tax on ordinary income (wages, pensions, withdrawals, taxable SS, STCG)
    ltcgTax: number;        // Tax on long-term capital gains + qualified dividends
    niitTax: number;        // Net Investment Income Tax (3.8% on investment income above threshold)
    totalTax: number;       // ordinaryTax + ltcgTax + niitTax
}

/** NIIT thresholds by filing status */
const NIIT_THRESHOLDS: Record<FilingStatus, number> = {
    'Single': 200000,
    'Married Filing Jointly': 250000,
    'Married Filing Separately': 125000,
};

/** NIIT rate (default; params.niitRate overrides it, e.g. for future-year calibration) */
const NIIT_RATE = 0.038;

/**
 * Unified federal tax calculation that handles all income types and their interactions.
 *
 * This function properly handles:
 * - Social Security taxability (provisional income calculation)
 * - STCG taxed as ordinary income (but counted as investment income for NIIT)
 * - LTCG stacking on top of ordinary income for bracket determination
 * - NIIT (3.8% on investment income above threshold)
 * - Standard deduction applied to ordinary income only
 *
 * Calculation order:
 * 1. Calculate provisional income for SS taxability
 * 2. Calculate taxable SS using getTaxableSocialSecurityBenefits
 * 3. Calculate taxable ordinary income (includes STCG)
 * 4. Calculate ordinary tax on taxable ordinary income
 * 5. Calculate LTCG tax where gains "stack" on top of ordinary taxable income
 * 6. Calculate NIIT on investment income above threshold
 *
 * @param ordinaryIncome - Wages, Traditional withdrawals, pensions, Roth conversions (NOT STCG)
 * @param socialSecurityBenefits - Gross SS benefits (we calculate taxable portion internally)
 * @param shortTermCapitalGains - STCG (taxed as ordinary income, but is investment income for NIIT)
 * @param longTermCapitalGains - LTCG + qualified dividends
 * @param preTaxDeductions - 401k, HSA contributions, etc.
 * @param filingStatus - Tax filing status
 * @param params - Federal tax parameters (brackets, standard deduction, LTCG brackets)
 */
export function calculateTotalFederalTax(
    ordinaryIncome: number,
    socialSecurityBenefits: number,
    shortTermCapitalGains: number,
    longTermCapitalGains: number,
    preTaxDeductions: number,
    filingStatus: FilingStatus,
    params: TaxParameters,
): TotalFederalTaxResult {
    // STEP 1 + 2: Provisional income and the taxable portion of Social Security.
    // IRS formula: Provisional Income = AGI (excluding SS) + tax-exempt interest + 50% of SS.
    // Both STCG and LTCG count toward the AGI-excluding-SS portion; pre-tax deductions
    // (401k, HSA, etc.) reduce it. Shared with federalTax.ts's OBBBA-bonus MAGI proxy
    // via getTaxableSocialSecurityFromComponents so the SS-taxability math lives in one
    // place and isn't computed twice for a senior standard-path call.
    // TODO: Verify all income types are included (LTCG, STCG, dividends, etc.)
    const { taxableSS } = getTaxableSocialSecurityFromComponents(
        ordinaryIncome,
        shortTermCapitalGains,
        longTermCapitalGains,
        preTaxDeductions,
        socialSecurityBenefits,
        filingStatus,
    );

    // STEP 3: Taxable ordinary income (includes STCG).
    // The standard deduction is applied against ordinary income first, but any UNUSED
    // portion still offsets LTCG. The IRS 0%/15%/20% LTCG brackets are measured against
    // TOTAL taxable income (ordinary + LTCG, after the standard deduction), so when
    // ordinary income is below the deduction the leftover deduction reduces the amount of
    // LTCG that is taxable. `taxableOrdinary` (floored at 0) is the LTCG stacking floor;
    // `unusedDeduction` is the leftover deduction that reduces taxable LTCG in STEP 5.
    const totalOrdinaryIncome = ordinaryIncome + shortTermCapitalGains + taxableSS;
    const adjustedOrdinary = Math.max(0, totalOrdinaryIncome - preTaxDeductions);
    const taxableOrdinary = Math.max(0, adjustedOrdinary - params.standardDeduction);
    const unusedDeduction = Math.max(0, params.standardDeduction - adjustedOrdinary);

    // STEP 4: Ordinary income tax (includes STCG)
    let ordinaryTax = 0;
    for (let i = 0; i < params.brackets.length; i++) {
        const current = params.brackets[i];
        const next = params.brackets[i + 1];
        const upperLimit = next ? next.threshold : Infinity;

        if (taxableOrdinary > current.threshold) {
            const amountInBracket = Math.min(taxableOrdinary, upperLimit) - current.threshold;
            ordinaryTax += amountInBracket * current.rate;
        }
    }

    // STEP 5: LTCG tax (stacks on top of ordinary income)
    let ltcgTax = 0;
    if (longTermCapitalGains > 0 && params.capitalGainsBrackets) {
        const brackets = params.capitalGainsBrackets;
        // Any standard deduction not consumed by ordinary income offsets LTCG, so only the
        // LTCG above that unused deduction is taxable. LTCG then stacks on top of taxable
        // ordinary income for bracket placement.
        let remainingGains = Math.max(0, longTermCapitalGains - unusedDeduction);
        let incomeStack = taxableOrdinary;

        for (let i = 0; i < brackets.length && remainingGains > 0; i++) {
            const bracket = brackets[i];
            const nextBracket = brackets[i + 1];
            const upperLimit = nextBracket ? nextBracket.threshold : Infinity;

            if (incomeStack >= upperLimit) continue;

            const bracketFloor = Math.max(incomeStack, bracket.threshold);
            const roomInBracket = upperLimit - bracketFloor;
            const gainsInBracket = Math.min(remainingGains, roomInBracket);

            ltcgTax += gainsInBracket * bracket.rate;

            incomeStack += gainsInBracket;
            remainingGains -= gainsInBracket;
        }
    }

    // STEP 6: NIIT (Net Investment Income Tax)
    // 3.8% on the LESSER of net investment income or MAGI exceeding threshold.
    let niitTax = 0;
    const niitThreshold = NIIT_THRESHOLDS[filingStatus];
    const netInvestmentIncome = shortTermCapitalGains + longTermCapitalGains;

    if (netInvestmentIncome > 0) {
        // MAGI for NIIT purposes (approximated as AGI here)
        const magi = ordinaryIncome + shortTermCapitalGains + longTermCapitalGains + taxableSS - preTaxDeductions;
        const magiExcess = Math.max(0, magi - niitThreshold);

        if (magiExcess > 0) {
            const niitBase = Math.min(netInvestmentIncome, magiExcess);
            niitTax = niitBase * (params.niitRate ?? NIIT_RATE);
        }
    }

    return {
        taxableSS,
        ordinaryTax,
        ltcgTax,
        niitTax,
        totalTax: ordinaryTax + ltcgTax + niitTax,
    };
}

/**
 * Legacy tax calculation function for backwards compatibility.
 * Use calculateTotalFederalTax for new code that needs SS/LTCG/NIIT handling.
 *
 * @param grossIncome - Gross income before deductions
 * @param preTaxDeductions - 401k, HSA, etc.
 * @param params - Tax parameters
 * @returns Tax amount (ordinary income tax only, no SS/LTCG/NIIT)
 */
export function calculateTax(
    grossIncome: number,
    preTaxDeductions: number,
    params: TaxParameters,
): number {
    return calculateTotalFederalTax(
        grossIncome,
        0,
        0,
        0,
        preTaxDeductions,
        'Single', // filing status doesn't matter when SS=0 and no investment income
        params,
    ).ordinaryTax;
}
