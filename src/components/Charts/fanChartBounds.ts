import { type PercentileData, type YearlyPercentile } from '../../services/MonteCarloTypes';

/**
 * Compute the y-axis domain for the fan chart from the percentile values
 * (and optional deterministic line). Excludes best/worst outliers by design.
 *
 * Guards against a degenerate domain: when every plotted value is equal
 * (e.g. a $0-in-every-year portfolio), `max === min` and the multiplicative
 * padding collapses to 0, which makes d3-scale render all bands/lines as a
 * single centered horizontal line. In that case widen the domain with an
 * absolute fallback so the chart keeps a real height.
 *
 * Lives in its own module (not FanChart.tsx) so the component file only
 * exports components (react-refresh/only-export-components).
 */
export const computeFanChartYBounds = (
    percentiles: PercentileData,
    deterministicLine?: YearlyPercentile[],
): { min: number; max: number } => {
    const allValues: number[] = [];

    // Include percentile data
    percentiles.p10.forEach(p => allValues.push(p.netWorth));
    percentiles.p90.forEach(p => allValues.push(p.netWorth));

    // Include deterministic line if present
    if (deterministicLine) {
        deterministicLine.forEach(p => allValues.push(p.netWorth));
    }

    if (allValues.length === 0) {
        return { min: 0, max: 100000 };
    }

    const min = Math.min(...allValues);
    let max = Math.max(...allValues);

    // Degenerate domain: all values equal. Widen with an absolute fallback so
    // d3-scale doesn't collapse the bands to a centered horizontal line.
    if (max === min) {
        max = min + Math.max(1, Math.abs(min) * 0.1);
    }

    // Add minimal padding
    const padding = (max - min) * 0.02;
    return {
        min: min - padding,
        max: max + padding,
    };
};
