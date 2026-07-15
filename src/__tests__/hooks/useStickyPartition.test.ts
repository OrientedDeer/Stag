import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useStickyPartition } from '../../hooks/useStickyPartition';

interface Item {
    id: string;
    done: boolean;
}

describe('useStickyPartition', () => {
    it('freezes an item\'s side across re-renders even after the predicate flips', () => {
        const items: Item[] = [{ id: 'a', done: false }];
        const { result, rerender } = renderHook(
            ({ list }) => useStickyPartition(list, (i: Item) => i.done),
            { initialProps: { list: items } },
        );
        expect(result.current(items[0])).toBe(false);

        // The user "end-dates" item a: its live predicate now returns true, but
        // its frozen section must not move while the tab stays mounted.
        items[0].done = true;
        rerender({ list: items });
        expect(result.current(items[0])).toBe(false);
    });

    it('re-settles on remount (a fresh mount reads the current predicate)', () => {
        const item: Item = { id: 'a', done: true };
        const { result } = renderHook(() =>
            useStickyPartition([item], (i: Item) => i.done),
        );
        expect(result.current(item)).toBe(true);
    });

    it('classifies a newly-appearing item on first sight', () => {
        const a: Item = { id: 'a', done: false };
        const b: Item = { id: 'b', done: true };
        const { result, rerender } = renderHook(
            ({ list }) => useStickyPartition(list, (i: Item) => i.done),
            { initialProps: { list: [a] } },
        );
        expect(result.current(a)).toBe(false);

        // b is added later — it should be classified live, not defaulted.
        rerender({ list: [a, b] });
        expect(result.current(b)).toBe(true);
    });

    it('reactivating a frozen-past item keeps it in place until remount', () => {
        const item: Item = { id: 'a', done: true };
        const { result, rerender } = renderHook(
            ({ list }) => useStickyPartition(list, (i: Item) => i.done),
            { initialProps: { list: [item] } },
        );
        expect(result.current(item)).toBe(true);

        item.done = false; // reactivated
        rerender({ list: [item] });
        expect(result.current(item)).toBe(true); // still filed under "past"
    });
});
