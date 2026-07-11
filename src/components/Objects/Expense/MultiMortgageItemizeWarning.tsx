import { useContext, useMemo } from "react";
import { ExpenseContext } from "./ExpenseContext";
import { MortgageExpense, getExpenseActiveMultiplier } from "./models";
import { AlertBanner } from "../../Layout/AlertBanner";

/**
 * #201 — every itemized mortgage shares one $750k acquisition-debt cap, and
 * rental/investment-property interest usually isn't an itemized deduction at
 * all. The engine SUMS interest across ALL mortgages flagged Itemized (it does
 * not reconcile down to the larger loan), so a wrongly-flagged mortgage
 * silently inflates the deduction. Warn once 2+ active mortgages are flagged
 * Itemized so the user can check which should actually be deductible.
 *
 * Shown on the Accounts, Expenses, AND Taxes tabs — mortgages are created from
 * the first two, so a Taxes-only warning is easy to never see.
 */
export function MultiMortgageItemizeWarning({ year }: { year?: number }) {
    const { expenses } = useContext(ExpenseContext);
    const activeYear = year ?? new Date().getFullYear();
    const count = useMemo(
        () =>
            expenses.filter(
                (exp) =>
                    exp instanceof MortgageExpense &&
                    exp.is_tax_deductible === "Itemized" &&
                    getExpenseActiveMultiplier(exp, activeYear) > 0,
            ).length,
        [expenses, activeYear]
    );
    if (count < 2) return null;
    return (
        <AlertBanner severity="warning" title="Multiple mortgages set to Itemized">
            {count} mortgages are marked Itemized. Second-home interest
            shares one $750,000 acquisition-debt cap, and rental- or investment-property
            interest usually isn't an itemized deduction at all (it belongs on Schedule E).
            Check which of these should actually be deductible.
        </AlertBanner>
    );
}
