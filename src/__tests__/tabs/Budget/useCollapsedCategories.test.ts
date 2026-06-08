import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCollapsedCategories } from '../../../tabs/Budget/transactions/useCollapsedCategories';

// Use the current month so the auto-collapse-old-months effect doesn't fire.
const now = new Date();
const month = now.getMonth() + 1;
const year = now.getFullYear();
const expenses = [{ id: 'exp1' }, { id: 'exp2' }] as never;

describe('useCollapsedCategories — expand/collapse all', () => {
    it('starts fully expanded for the current month', () => {
        const { result } = renderHook(() => useCollapsedCategories(month, year, expenses));
        expect(result.current.allExpanded).toBe(true);
        expect(result.current.collapsed.size).toBe(0);
    });

    it('collapseAll collapses every section and expense category', () => {
        const { result } = renderHook(() => useCollapsedCategories(month, year, expenses));
        act(() => result.current.collapseAll());
        expect(result.current.allExpanded).toBe(false);
        ['uncategorized', 'income', 'transfers', 'contributions', 'exp1', 'exp2'].forEach(id =>
            expect(result.current.collapsed.has(id)).toBe(true),
        );
    });

    it('expandAll clears every collapsed section', () => {
        const { result } = renderHook(() => useCollapsedCategories(month, year, expenses));
        act(() => result.current.collapseAll());
        act(() => result.current.expandAll());
        expect(result.current.allExpanded).toBe(true);
        expect(result.current.collapsed.size).toBe(0);
    });

    it('allExpanded becomes false when any single section is collapsed', () => {
        const { result } = renderHook(() => useCollapsedCategories(month, year, expenses));
        act(() => result.current.toggle('income'));
        expect(result.current.allExpanded).toBe(false);
        act(() => result.current.expandAll());
        expect(result.current.allExpanded).toBe(true);
    });
});
