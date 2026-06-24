import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTimelineRange, DEFAULT_TIMELINE_SPAN_YEARS } from '../../hooks/useTimelineRange';

// Regression coverage for the AssetsStreamChart timeline bug (2026-06-24 review,
// #35): a stored range that no longer overlaps the data's year span (after a
// life-expectancy edit or data import) must reconcile against the new bounds so
// the chart never renders an empty slice. The pre-fix code initialized the range
// once and never reconciled it.

describe('useTimelineRange', () => {
    it('defaults to [minYear, min(maxYear, minYear + span)]', () => {
        const { result } = renderHook(() => useTimelineRange(2025, 2100));
        expect(result.current.activeRange).toEqual([2025, 2025 + DEFAULT_TIMELINE_SPAN_YEARS]);
    });

    it('caps the default window at maxYear when the span is shorter', () => {
        const { result } = renderHook(() => useTimelineRange(2025, 2030));
        expect(result.current.activeRange).toEqual([2025, 2030]);
    });

    it('keeps a user-selected range that still overlaps the bounds', () => {
        const { result } = renderHook(() => useTimelineRange(2025, 2100));
        act(() => result.current.setRange([2040, 2060]));
        expect(result.current.activeRange).toEqual([2040, 2060]);
    });

    it('resets a stale non-overlapping range to the default window (the #35 bug)', () => {
        // User picks a far-future window, then the data span shrinks so the old
        // range [2080, 2090] is entirely above the new maxYear of 2050.
        const { result, rerender } = renderHook(
            ({ min, max }) => useTimelineRange(min, max),
            { initialProps: { min: 2025, max: 2100 } },
        );
        act(() => result.current.setRange([2080, 2090]));
        expect(result.current.activeRange).toEqual([2080, 2090]);

        rerender({ min: 2025, max: 2050 });
        // No overlap with [2025, 2050] → fall back to the default window, NOT empty.
        expect(result.current.activeRange).toEqual([2025, 2050]);
    });

    it('clamps a partially-overlapping range into the new bounds', () => {
        const { result, rerender } = renderHook(
            ({ min, max }) => useTimelineRange(min, max),
            { initialProps: { min: 2025, max: 2100 } },
        );
        act(() => result.current.setRange([2040, 2090]));
        rerender({ min: 2025, max: 2060 });
        // Upper bound is clamped down to the new maxYear; lower bound preserved.
        expect(result.current.activeRange).toEqual([2040, 2060]);
    });
});
