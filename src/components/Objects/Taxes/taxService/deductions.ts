import { AnyExpense, MortgageExpense, getExpenseActiveMultiplier } from "../../Expense/models";

/**
 * Narrow an expense to those that declare a numeric `tax_deductible` field.
 * Only some classes in the AnyExpense union (Mortgage, Loan, Dependent,
 * Healthcare, Charity) carry it; the SimpleExpense / Rent variants do not.
 */
function hasTaxDeductible(exp: AnyExpense): exp is AnyExpense & { tax_deductible: number } {
    return "tax_deductible" in exp;
}

/**
 * TCJA acquisition-debt limit: home-mortgage interest is deductible only on the
 * interest attributable to the first $750,000 of acquisition debt (post-2017
 * loans). Single-user simplification — a flat $750k with NO pre-2018 $1M
 * grandfathering.
 */
export const MORTGAGE_ACQUISITION_DEBT_LIMIT = 750_000;

/**
 * Proration factor to apply to itemized mortgage interest for the $750k
 * acquisition-debt cap. The cap is SHARED across all itemized mortgages: the
 * factor is min(1, 750_000 / combined average balance), where each mortgage's
 * average balance ≈ (entering + exiting)/2 for the year (the IRS Pub 936
 * average-balance approximation). Returns exactly 1 when combined debt is at or
 * below the limit (or there are no mortgages) — so a ≤$750k plan multiplies
 * interest by 1.0 and stays byte-identical to the pre-cap behavior.
 */
function mortgageInterestProration(activeItemized: AnyExpense[], year: number): number {
    let combinedAvgBalance = 0;
    for (const exp of activeItemized) {
        if (!(exp instanceof MortgageExpense)) continue;
        const { totalPrincipal } = exp.calculateAnnualAmortization(year);
        const entering = exp.loan_balance;
        const exiting = entering - totalPrincipal;
        combinedAvgBalance += (entering + exiting) / 2;
    }
    if (combinedAvgBalance <= MORTGAGE_ACQUISITION_DEBT_LIMIT) return 1;
    return MORTGAGE_ACQUISITION_DEBT_LIMIT / combinedAvgBalance;
}

export function getItemizedDeductions(expenses: AnyExpense[], year: number): number {
    const activeItemized = expenses.filter(
        (exp) =>
            "is_tax_deductible" in exp &&
            exp.is_tax_deductible === "Itemized" &&
            getExpenseActiveMultiplier(exp, year) > 0,
    );

    // Same proration for every itemized mortgage — applying the shared factor
    // per-mortgage is equivalent to prorating their combined interest.
    const mortgageProration = mortgageInterestProration(activeItemized, year);

    return activeItemized.reduce((val, exp) => {
        if (exp instanceof MortgageExpense) {
            return val + exp.calculateAnnualAmortization(year).totalInterest * mortgageProration;
        }
        return hasTaxDeductible(exp)
            ? val + exp.getProratedAnnual(exp.tax_deductible ?? 0, year)
            : val;
    }, 0);
}

export function getYesDeductions(expenses: AnyExpense[], year: number): number {
    return expenses
        .filter(
            (exp) =>
                "is_tax_deductible" in exp &&
                exp.is_tax_deductible === "Yes" &&
                getExpenseActiveMultiplier(exp, year) > 0,
        )
        .reduce((val, exp) => {
            if (exp instanceof MortgageExpense) {
                return val + exp.calculateAnnualAmortization(year).totalInterest;
            }
            return hasTaxDeductible(exp)
                ? val + exp.getProratedAnnual(exp.tax_deductible ?? 0, year)
                : val;
        }, 0);
}
