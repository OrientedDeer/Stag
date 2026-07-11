import { useMemo, useContext, useRef, useState, useEffect } from 'react';
import { ResponsiveLine } from '@nivo/line';
import { type PercentileData, type YearlyPercentile, type ScenarioResult } from '../../services/MonteCarloTypes';
import { computeFanChartYBounds } from './fanChartBounds';
import { useChartTheme } from './useChartTheme';
import { ChartFrame } from "./ChartFrame";
import { AssumptionsContext } from '../Objects/Assumptions/AssumptionsContext';
import { formatCompactCurrency } from '../../tabs/Future/tabs/FutureUtils';
import { calculateNetWorth } from '../../tabs/Future/tabs/FutureUtils';

const MIN_CHART_WIDTH = 300;

/**
 * Sequential single-hue ramp for the ORDERED percentile series: the median is
 * the full-strength money hue, p25/p75 a mid step, p10/p90 the most recessive.
 * Steps are derived by mixing the theme's money color toward the theme's
 * surface, so the ramp stays one hue, keeps its ordering in every theme, and
 * the legend symbols (which take the series color) are visibly distinct —
 * previously all five series shared one green and the legend was
 * indistinguishable.
 */
const PERCENTILE_COLORS = {
    median: 'var(--color-chart-money)',
    mid: 'color-mix(in srgb, var(--color-chart-money) 65%, var(--c-surface-base))',
    outer: 'color-mix(in srgb, var(--color-chart-money) 40%, var(--c-surface-base))',
};

interface FanChartProps {
    percentiles: PercentileData;
    deterministicLine?: YearlyPercentile[];
    bestCase?: ScenarioResult;
    worstCase?: ScenarioResult;
    height?: number;
}

/**
 * Fan Chart for Monte Carlo simulation results
 * Shows probability bands (10th-90th, 25th-75th percentiles) with median line
 */
export const FanChart = ({ percentiles, deterministicLine, bestCase, worstCase, height = 400 }: FanChartProps) => {
    const { resolve } = useChartTheme();
    const { state: assumptions } = useContext(AssumptionsContext);
    const forceExact = assumptions.display?.useCompactCurrency === false;
    const containerRef = useRef<HTMLDivElement>(null);
    const [containerWidth, setContainerWidth] = useState<number | null>(null);

    // Track container width to prevent negative SVG dimensions
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const observer = new ResizeObserver((entries) => {
            for (const entry of entries) {
                setContainerWidth(entry.contentRect.width);
            }
        });

        observer.observe(container);

        return () => observer.disconnect();
    }, []);

    const isNarrow = containerWidth !== null && containerWidth < MIN_CHART_WIDTH;
    const isMeasured = containerWidth !== null;

    // MC scenarios can include both a "Today" snapshot and an end-of-year
    // projection for the current year, producing two entries at the same year
    // value. Nivo's linear x-scale uses x as the point key, so duplicates
    // trigger a "two children with the same key" warning. Collapse to one
    // point per year, keeping the last entry (EOY where present).
    const dedupePoints = <T extends { x: number; y: number }>(points: T[]): T[] => {
        const byX = new Map<number, T>();
        for (const p of points) byX.set(p.x, p);
        return Array.from(byX.values());
    };

    const chartData = useMemo(() => {
        const lines = [];

        // Median line (50th percentile) - solid line
        if (percentiles.p50.length > 0) {
            lines.push({
                id: 'Median (50th)',
                color: PERCENTILE_COLORS.median,
                data: dedupePoints(percentiles.p50.map(p => ({
                    x: p.year,
                    y: p.netWorth,
                }))),
            });
        }

        // 25th percentile
        if (percentiles.p25.length > 0) {
            lines.push({
                id: '25th Percentile',
                color: PERCENTILE_COLORS.mid,
                data: dedupePoints(percentiles.p25.map(p => ({
                    x: p.year,
                    y: p.netWorth,
                }))),
            });
        }

        // 75th percentile
        if (percentiles.p75.length > 0) {
            lines.push({
                id: '75th Percentile',
                color: PERCENTILE_COLORS.mid,
                data: dedupePoints(percentiles.p75.map(p => ({
                    x: p.year,
                    y: p.netWorth,
                }))),
            });
        }

        // 10th percentile
        if (percentiles.p10.length > 0) {
            lines.push({
                id: '10th Percentile',
                color: PERCENTILE_COLORS.outer,
                data: dedupePoints(percentiles.p10.map(p => ({
                    x: p.year,
                    y: p.netWorth,
                }))),
            });
        }

        // 90th percentile
        if (percentiles.p90.length > 0) {
            lines.push({
                id: '90th Percentile',
                color: PERCENTILE_COLORS.outer,
                data: dedupePoints(percentiles.p90.map(p => ({
                    x: p.year,
                    y: p.netWorth,
                }))),
            });
        }

        // Deterministic baseline (if provided)
        if (deterministicLine && deterministicLine.length > 0) {
            lines.push({
                id: 'Deterministic',
                color: 'var(--c-warning-soft)',
                data: dedupePoints(deterministicLine.map(p => ({
                    x: p.year,
                    y: p.netWorth,
                }))),
            });
        }

        // Best case scenario (if provided)
        if (bestCase && bestCase.timeline.length > 0) {
            lines.push({
                id: 'Best Run',
                color: 'var(--c-accent-soft)',
                data: dedupePoints(bestCase.timeline.map(year => ({
                    x: year.year,
                    y: calculateNetWorth(year.accounts),
                }))),
            });
        }

        // Worst case scenario (if provided)
        if (worstCase && worstCase.timeline.length > 0) {
            lines.push({
                id: 'Worst Run',
                color: 'var(--c-negative-soft)',
                data: dedupePoints(worstCase.timeline.map(year => ({
                    x: year.year,
                    y: calculateNetWorth(year.accounts),
                }))),
            });
        }

        return lines;
    }, [percentiles, deterministicLine, bestCase, worstCase]);

    // Calculate area fill data for the bands. Collapse duplicate-year rows
    // (Today + EOY for the current year) so paths don't double back on
    // themselves at the same x.
    const areaData = useMemo(() => {
        if (percentiles.p10.length === 0) return null;

        const dedupeBand = (rows: { x: number; y0: number; y1: number }[]) => {
            const byX = new Map<number, { x: number; y0: number; y1: number }>();
            for (const r of rows) byX.set(r.x, r);
            return Array.from(byX.values());
        };

        return {
            p10_p90: dedupeBand(percentiles.p10.map((p10, i) => ({
                x: p10.year,
                y0: p10.netWorth,
                y1: percentiles.p90[i]?.netWorth ?? p10.netWorth,
            }))),
            p25_p75: dedupeBand(percentiles.p25.map((p25, i) => ({
                x: p25.year,
                y0: p25.netWorth,
                y1: percentiles.p75[i]?.netWorth ?? p25.netWorth,
            }))),
        };
    }, [percentiles]);

    // Calculate y-axis bounds from percentile data only (excludes best/worst outliers)
    const yBounds = useMemo(
        () => computeFanChartYBounds(percentiles, deterministicLine),
        [percentiles, deterministicLine],
    );

    // Calculate x-axis tick values to prevent label overlap
    const xTickValues = useMemo(() => {
        if (percentiles.p50.length === 0) return undefined;

        const years = Array.from(new Set(percentiles.p50.map(p => p.year)));
        const range = years.length;
        const mobile = (containerWidth ?? 800) < 640;

        let step = 1;
        if (mobile) {
            if (range > 30) step = 5;
            else if (range > 15) step = 3;
            else if (range > 8) step = 2;
        } else {
            if (range > 40) step = 5;
            else if (range > 20) step = 2;
        }

        return years.filter((year, i) => {
            if (i === 0 || i === years.length - 1) return true;
            return (year - years[0]) % step === 0;
        });
    }, [percentiles.p50, containerWidth]);

    // Custom layer to render filled areas between percentile bands.
    // Nivo hands custom layers its computed scales; we only need them as
    // number -> pixel functions.
    const AreaLayer = ({ xScale, yScale }: {
        xScale: (value: number) => number;
        yScale: (value: number) => number;
    }) => {
        if (!areaData) return null;

        const createPath = (data: { x: number; y0: number; y1: number }[]) => {
            if (data.length === 0) return '';

            // Create forward path along top (y1)
            let path = `M ${xScale(data[0].x)},${yScale(data[0].y1)}`;
            for (let i = 1; i < data.length; i++) {
                path += ` L ${xScale(data[i].x)},${yScale(data[i].y1)}`;
            }

            // Create reverse path along bottom (y0)
            for (let i = data.length - 1; i >= 0; i--) {
                path += ` L ${xScale(data[i].x)},${yScale(data[i].y0)}`;
            }

            path += ' Z';
            return path;
        };

        return (
            <g>
                {/* Outer band (10th-90th) */}
                <path
                    d={createPath(areaData.p10_p90)}
                    fill="var(--color-chart-money)"
                    fillOpacity={0.1}
                />
                {/* Inner band (25th-75th) */}
                <path
                    d={createPath(areaData.p25_p75)}
                    fill="var(--color-chart-money)"
                    fillOpacity={0.15}
                />
            </g>
        );
    };

    if (chartData.length === 0 || chartData[0].data.length === 0) {
        return (
            <div ref={containerRef} className="flex items-center justify-center h-64 border-2 border-dashed border-border-default rounded-xl">
                <p className="text-content-muted">Run simulation to see results</p>
            </div>
        );
    }

    // Show loading state until measured, then show message if too narrow
    if (!isMeasured) {
        return (
            <div ref={containerRef} style={{ height }} className="flex items-center justify-center">
                <p className="text-content-muted text-sm">Loading chart...</p>
            </div>
        );
    }

    if (isNarrow) {
        return (
            <div ref={containerRef} style={{ height }} className="flex items-center justify-center border-2 border-dashed border-border-default rounded-xl">
                <p className="text-content-muted text-sm text-center px-4">Expand window to view chart</p>
            </div>
        );
    }

    return (
        <div ref={containerRef} style={{ height }}>
            <ChartFrame><ResponsiveLine
                data={chartData}
                margin={{ top: 20, right: 130, bottom: 50, left: 80 }}
                xScale={{ type: 'linear', min: 'auto', max: 'auto' }}
                yScale={{ type: 'linear', min: yBounds.min, max: yBounds.max }}
                axisBottom={{
                    tickSize: 5,
                    tickPadding: 5,
                    tickRotation: 0,
                    legend: 'Year',
                    legendOffset: 36,
                    legendPosition: 'middle',
                    tickValues: xTickValues,
                }}
                axisLeft={{
                    tickSize: 5,
                    tickPadding: 5,
                    tickRotation: 0,
                    legend: 'Net Worth ($)',
                    legendOffset: -65,
                    legendPosition: 'middle',
                    format: (value: number) => {
                        if (Math.abs(value) >= 1000000) {
                            return `$${(value / 1000000).toFixed(1)}M`;
                        }
                        if (Math.abs(value) >= 1000) {
                            return `$${(value / 1000).toFixed(0)}K`;
                        }
                        return `$${value}`;
                    },
                }}
                enableGridX={false}
                enableGridY={true}
                colors={(d) => resolve(d.color)}
                lineWidth={2}
                enablePoints={false}
                useMesh={true}
                layers={[
                    'grid',
                    'markers',
                    'axes',
                    AreaLayer,
                    'lines',
                    'crosshair',
                    'slices',
                    'points',
                    'mesh',
                    'legends',
                ]}
                legends={[
                    {
                        anchor: 'bottom-right',
                        direction: 'column',
                        justify: false,
                        // itemWidth must fit the longest label ("90th Percentile")
                        // at fontSize 11 — 80px truncated it to "90th Percentil…".
                        translateX: 125,
                        translateY: 0,
                        itemsSpacing: 2,
                        itemDirection: 'left-to-right',
                        itemWidth: 118,
                        itemHeight: 20,
                        itemOpacity: 0.75,
                        symbolSize: 12,
                        symbolShape: 'circle',
                        effects: [
                            {
                                on: 'hover',
                                style: {
                                    itemOpacity: 1,
                                },
                            },
                        ],
                    },
                ]}
                theme={{
                    axis: {
                        ticks: { text: { fill: 'var(--c-content-muted)', fontSize: 11 } },
                        legend: { text: { fill: 'var(--c-content-muted)', fontSize: 12 } },
                    },
                    grid: { line: { stroke: 'var(--c-border-default)', strokeWidth: 1 } },
                    crosshair: { line: { stroke: 'var(--color-chart-money)', strokeWidth: 1 } },
                    legends: { text: { fill: 'var(--c-content-muted)', fontSize: 11 } },
                    tooltip: { container: { zIndex: 9999 } },
                }}
                tooltip={({ point }) => (
                    <div className="bg-surface-overlay border border-border-default px-3 py-2 rounded shadow-xl text-sm max-w-[300px]">
                        <div className="font-medium text-content-default truncate">{point.seriesId}</div>
                        <div className="text-content-muted">
                            Year: <span className="text-white">{point.data.x as number}</span>
                        </div>
                        <div className="text-content-muted">
                            Net Worth:{' '}
                            <span className="text-positive font-mono">
                                {formatCompactCurrency(point.data.y as number, { forceExact })}
                            </span>
                        </div>
                    </div>
                )}
            /></ChartFrame>
        </div>
    );
};
