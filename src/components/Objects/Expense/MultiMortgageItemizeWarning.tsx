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
 *
 * Styled to match the non-vesting RSU warning in FutureTab: Title Case title,
 * a lead-in paragraph, a per-item list naming each affected mortgage, and a
 * closing paragraph pointing at where to fix it. Left margin-free so the parent
 * container owns spacing (ExpenseTab/AccountTab wrap it in `mb-4 empty:hidden`,
 * TaxesTab lays it out under `space-y-6`).
 */
export function MultiMortgageItemizeWarning({ year }: { year?: number }) {
    const { expenses } = useContext(ExpenseContext);
    const activeYear = year ?? new Date().getFullYear();
    const itemized = useMemo(
        () =>
            expenses.filter(
                (exp): exp is MortgageExpense =>
                    exp instanceof MortgageExpense &&
                    exp.is_tax_deductible === "Itemized" &&
                    getExpenseActiveMultiplier(exp, activeYear) > 0,
            ),
        [expenses, activeYear]
    );
    if (itemized.length < 2) return null;
    return (
        <AlertBanner severity="warning" title="Multiple Mortgages Set to Itemized">
            <p className="text-sm">
                The projection sums the interest on every mortgage flagged Itemized under
                one shared <strong>$750,000</strong> acquisition-debt cap — it does not
                pick the larger loan — so a wrongly-flagged mortgage inflates your itemized
                deduction:
            </p>
            <ul className="mt-2 list-disc list-inside text-sm space-y-1">
                {itemized.map((exp) => (
                    <li key={exp.id}>
                        <strong>{exp.name}</strong> is deducted as itemized mortgage interest.
                    </li>
                ))}
            </ul>
            <p className="mt-2 text-sm">
                Fix it on the expense's card in the <strong>Expenses</strong> tab (the
                Tax Deductible setting). A second home's interest legitimately shares the
                same $750,000 cap, but rental- or investment-property interest belongs on
                Schedule E — not in your itemized deductions.
            </p>
        </AlertBanner>
    );
}
