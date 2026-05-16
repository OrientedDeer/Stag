import { AnyExpense, MortgageExpense, getExpenseActiveMultiplier } from "../../Expense/models";

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
            return val + exp.getProratedAnnual((exp as any).tax_deductible || 0, year);
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
            return val + exp.getProratedAnnual((exp as any).tax_deductible || 0, year);
        }, 0);
}
