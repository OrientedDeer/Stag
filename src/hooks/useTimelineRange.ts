import { useMemo, useState } from 'react';
import type { RefObject } from 'react';
import { useArrowKeyAdjust } from './useKeyboardShortcuts';

/** Default visible window: the start year out to +32 years (or the projection end). */
export const DEFAULT_TIMELINE_SPAN_YEARS = 32;

/**
 * Year-range state for a Projection chart's Timeline slider, with arrow-key
 * nudging and stale-range reconciliation. A stored range that no longer overlaps
 * [minYear, maxYear] — e.g. after a data import or life-expectancy edit — resets
 * to the default window; a partial overlap is clamped into bounds. Reconciled
 * during render (not via a state-resetting effect) so the chart never renders an
 * empty slice. Extracted from the per-tab copies on the Projection page.
 */
export function useTimelineRange(
    minYear: number,
    maxYear: number,
    containerRef?: RefObject<HTMLElement | null>,
) {
    const [range, setRange] = useState<[number, number] | null>(null);

    const activeRange = useMemo<[number, number]>(() => {
        const fallback: [number, number] = [minYear, Math.min(maxYear, minYear + DEFAULT_TIMELINE_SPAN_YEARS)];
        if (!range || range[1] < minYear || range[0] > maxYear) return fallback;
        return [Math.max(minYear, range[0]), Math.min(maxYear, range[1])];
    }, [range, minYear, maxYear]);

    useArrowKeyAdjust(
        activeRange,
        (v) => setRange(v as [number, number]),
        { min: minYear, max: maxYear, step: 1, containerRef },
    );

    return { activeRange, setRange };
}
