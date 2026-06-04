import { useCallback, useEffect, useState } from 'react';
import { AnyExpense } from '../../../components/Objects/Expense/models';

/**
 * Tracks which category sections are collapsed, with an auto-collapse-all
 * effect for older months (so historical browsing doesn't dump a wall of
 * rows). Current and future months expand all categories on mount.
 */
export function useCollapsedCategories(
    selectedMonth: number,
    selectedYear: number,
    expenses: AnyExpense[],
) {
    const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

    useEffect(() => {
        const now = new Date();
        const currentMonth = now.getMonth() + 1;
        const currentYear = now.getFullYear();
        const isOlderMonth = selectedYear < currentYear ||
            (selectedYear === currentYear && selectedMonth < currentMonth);

        if (isOlderMonth) {
            const allCategoryIds = new Set([
                'uncategorized',
                'income',
                'transfers',
                'contributions',
                ...expenses.map(e => e.id),
            ]);
            setCollapsed(allCategoryIds);
        } else {
            setCollapsed(new Set());
        }
    }, [selectedMonth, selectedYear, expenses]);

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
        // Same id universe the auto-collapse effect uses: the fixed sections plus
        // every expense category. Ids for sections that aren't currently rendered
        // are harmless (their `collapsed.has(...)` is simply never read).
        setCollapsed(new Set([
            'uncategorized',
            'income',
            'transfers',
            'contributions',
            ...expenses.map(e => e.id),
        ]));
    }, [expenses]);

    // Nothing collapsed -> everything is expanded.
    const allExpanded = collapsed.size === 0;

    return { collapsed, toggle, expandAll, collapseAll, allExpanded };
}
