import { useCallback, useState } from 'react';
import { type AnyExpense } from '../../../components/Objects/Expense/models';

// The fixed sections plus every expense category — the id universe used both
// for the older-month auto-collapse default and the explicit "collapse all".
function buildAllCategoryIds(expenses: AnyExpense[]): Set<string> {
    return new Set([
        'uncategorized',
        'income',
        'transfers',
        'contributions',
        ...expenses.map(e => e.id),
    ]);
}

/**
 * Tracks which category sections are collapsed, auto-collapsing all for older
 * months (so historical browsing doesn't dump a wall of rows). Current and
 * future months start expanded.
 */
export function useCollapsedCategories(
    selectedMonth: number,
    selectedYear: number,
    expenses: AnyExpense[],
) {
    // The default collapse set for the currently-viewed month/expense set.
    const computeDefault = (): Set<string> => {
        const now = new Date();
        const currentMonth = now.getMonth() + 1;
        const currentYear = now.getFullYear();
        const isOlderMonth = selectedYear < currentYear ||
            (selectedYear === currentYear && selectedMonth < currentMonth);
        return isOlderMonth ? buildAllCategoryIds(expenses) : new Set<string>();
    };

    const [collapsed, setCollapsed] = useState<Set<string>>(computeDefault);

    // Reset to the default whenever the viewed month or the expense set changes.
    // Comparing against the previous inputs during render is React's recommended
    // alternative to a syncing effect (and avoids a one-frame flash on mount).
    const [prevInputs, setPrevInputs] = useState({ selectedMonth, selectedYear, expenses });
    if (
        prevInputs.selectedMonth !== selectedMonth ||
        prevInputs.selectedYear !== selectedYear ||
        prevInputs.expenses !== expenses
    ) {
        setPrevInputs({ selectedMonth, selectedYear, expenses });
        setCollapsed(computeDefault());
    }

    const toggle = useCallback((categoryId: string) => {
        setCollapsed(prev => {
            const next = new Set(prev);
            if (next.has(categoryId)) {
                next.delete(categoryId);
            } else {
                next.add(categoryId);
            }
            return next;
        });
    }, []);

    const expandAll = useCallback(() => setCollapsed(new Set()), []);

    const collapseAll = useCallback(() => {
        // Same id universe the auto-collapse default uses. Ids for sections that
        // aren't currently rendered are harmless (their `collapsed.has(...)` is
        // simply never read).
        setCollapsed(buildAllCategoryIds(expenses));
    }, [expenses]);

    // Nothing collapsed -> everything is expanded.
    const allExpanded = collapsed.size === 0;

    return { collapsed, toggle, expandAll, collapseAll, allExpanded };
}
