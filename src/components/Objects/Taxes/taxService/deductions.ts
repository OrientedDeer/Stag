import { AnyExpense, MortgageExpense, getExpenseActiveMultiplier } from "../../Expense/models";

/**
 * Narrow an expense to those that declare a numeric `tax_deductible` field.
 * Only some classes in the AnyExpense union (Mortgage, Loan, Dependent,
 * Healthcare, Charity) carry it; the SimpleExpense / Rent variants do not.
 */
function hasTaxDeductible(exp: AnyExpense): exp is AnyExpense & { tax_deductible: number } {
    return "tax_deductible" in exp;
}

export function getItemizedDeductions(expenses: AnyExpense[], year: number): number {
    return expenses
        .filter(
            (exp) =>
                "is_tax_deductible" in exp &&
                exp.is_tax_deductible === "Itemized" &&
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
