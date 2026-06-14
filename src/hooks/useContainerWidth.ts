import { useEffect, useRef, useState } from 'react';

/** Minimum width below which a Projection chart is too narrow to render usefully. */
export const MIN_CHART_WIDTH = 300;

/**
 * Track a chart container's width via ResizeObserver. `isMeasured` gates the
 * first paint so charts never render with negative SVG dimensions; `isNarrow`
 * flags widths below `minWidth`. Extracted from the per-tab copies on the
 * Projection page (Overview, Assets after-tax, …).
 */
export function useContainerWidth(minWidth: number = MIN_CHART_WIDTH) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [containerWidth, setContainerWidth] = useState<number | null>(null);

    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        const observer = new ResizeObserver((entries) => {
            for (const entry of entries) setContainerWidth(entry.contentRect.width);
        });
        observer.observe(el);
        return () => observer.disconnect();
    }, []);

    return {
        containerRef,
        containerWidth,
        isMeasured: containerWidth !== null,
        isNarrow: containerWidth !== null && containerWidth < minWidth,
    };
}
