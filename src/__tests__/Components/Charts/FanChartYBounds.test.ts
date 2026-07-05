import { describe, it, expect } from 'vitest';
import { computeFanChartYBounds } from '../../../components/Charts/fanChartBounds';
import { PercentileData, YearlyPercentile } from '../../../services/MonteCarloTypes';

// Helper: build a PercentileData where every band equals `value` across `years`.
const flatPercentiles = (value: number, years = [2026, 2027, 2028]): PercentileData => {
    const band = (): YearlyPercentile[] => years.map(year => ({ year, netWorth: value }));
    return {
        p10: band(),
        p25: band(),
        p50: band(),
        p75: band(),
        p90: band(),
    };
};

// Regression for #120: when every plotted percentile value is equal (e.g. a
// $0-in-every-year portfolio), the multiplicative padding (max - min) * 0.02
// collapses to 0, leaving min === max. d3-scale then renders all bands/lines as
// a single centered horizontal line. computeFanChartYBounds must widen the
// domain so it stays non-degenerate.
describe('computeFanChartYBounds: degenerate (all-equal) domain (#120)', () => {
    it('produces a non-degenerate domain when every value is $0', () => {
        const bounds = computeFanChartYBounds(flatPercentiles(0));
        expect(bounds.max).toBeGreaterThan(bounds.min);
    });

    it('produces a non-degenerate domain when every value is equal and non-zero', () => {
        const bounds = computeFanChartYBounds(flatPercentiles(500000));
        expect(bounds.max).toBeGreaterThan(bounds.min);
        // 10% of |value| dominates the absolute floor of 1.
        expect(bounds.max - bounds.min).toBeGreaterThan(1);
    });

    it('produces a non-degenerate domain when every value is equal and negative (debt)', () => {
        const bounds = computeFanChartYBounds(flatPercentiles(-25000));
        expect(bounds.max).toBeGreaterThan(bounds.min);
    });

    it('still returns the empty-data fallback when there is no data', () => {
        const empty: PercentileData = { p10: [], p25: [], p50: [], p75: [], p90: [] };
        const bounds = computeFanChartYBounds(empty);
        expect(bounds).toEqual({ min: 0, max: 100000 });
    });

    it('leaves a normal (varied) domain padded but otherwise intact', () => {
        const percentiles: PercentileData = {
            p10: [{ year: 2026, netWorth: 100 }],
            p25: [{ year: 2026, netWorth: 200 }],
            p50: [{ year: 2026, netWorth: 300 }],
            p75: [{ year: 2026, netWorth: 400 }],
            p90: [{ year: 2026, netWorth: 500 }],
        };
        const bounds = computeFanChartYBounds(percentiles);
        // p10/p90 span 100..500; padding = 400 * 0.02 = 8.
        expect(bounds.min).toBeCloseTo(92);
        expect(bounds.max).toBeCloseTo(508);
    });

    it('widens a degenerate domain even when the deterministic line matches', () => {
        const flat = flatPercentiles(1234);
        const detLine: YearlyPercentile[] = [
            { year: 2026, netWorth: 1234 },
            { year: 2027, netWorth: 1234 },
        ];
        const bounds = computeFanChartYBounds(flat, detLine);
        expect(bounds.max).toBeGreaterThan(bounds.min);
    });
});
