import { useMemo, useContext, useRef, useState, useEffect } from 'react';
import { ResponsiveLine } from '@nivo/line';
import { PercentileData, YearlyPercentile, ScenarioResult } from '../../services/MonteCarloTypes';
import { AssumptionsContext } from '../Objects/Assumptions/AssumptionsContext';
import { formatCompactCurrency } from '../../tabs/Future/tabs/FutureUtils';
import { calculateNetWorth } from '../../tabs/Future/tabs/FutureUtils';

const MIN_CHART_WIDTH = 300;

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

    const chartData = useMemo(() => {
        const lines = [];

        // Median line (50th percentile) - solid line
        if (percentiles.p50.length > 0) {
            lines.push({
                id: 'Median (50th)',
                color: '#10b981',
                data: percentiles.p50.map(p => ({
                    x: p.year,
                    y: p.netWorth,
                })),
            });
        }

        // 25th percentile
        if (percentiles.p25.length > 0) {
            lines.push({
                id: '25th Percentile',
                color: '#6ee7b7',
                data: percentiles.p25.map(p => ({
                    x: p.year,
                    y: p.netWorth,
                })),
            });
        }

        // 75th percentile
        if (percentiles.p75.length > 0) {
            lines.push({
                id: '75th Percentile',
                color: '#6ee7b7',
                data: percentiles.p75.map(p => ({
                    x: p.year,
                    y: p.netWorth,
                })),
            });
        }

        // 10th percentile
        if (percentiles.p10.length > 0) {
            lines.push({
                id: '10th Percentile',
                color: '#a7f3d0',
                data: percentiles.p10.map(p => ({
                    x: p.year,
                    y: p.netWorth,
                })),
            });
        }

        // 90th percentile
        if (percentiles.p90.length > 0) {
            lines.push({
                id: '90th Percentile',
                color: '#a7f3d0',
                data: percentiles.p90.map(p => ({
                    x: p.year,
                    y: p.netWorth,
                })),
            });
        }

        // Deterministic baseline (if provided)
        if (deterministicLine && deterministicLine.length > 0) {
            lines.push({
                id: 'Deterministic',
                color: '#f59e0b',
                data: deterministicLine.map(p => ({
                    x: p.year,
                    y: p.netWorth,
                })),
            });
        }

        // Best case scenario (if provided)
        if (bestCase && bestCase.timeline.length > 0) {
            lines.push({
                id: 'Best Run',
                color: '#3b82f6',
                data: bestCase.timeline.map(year => ({
                    x: year.year,
                    y: calculateNetWorth(year.accounts),
                })),
            });
        }

        // Worst case scenario (if provided)
        if (worstCase && worstCase.timeline.length > 0) {
            lines.push({
                id: 'Worst Run',
                color: '#ef4444',
                data: worstCase.timeline.map(year => ({
                    x: year.year,
                    y: calculateNetWorth(year.accounts),
                })),
            });
        }

        return lines;
    }, [percentiles, deterministicLine, bestCase, worstCase]);

    // Calculate area fill data for the bands
    const areaData = useMemo(() => {
        if (percentiles.p10.length === 0) return null;

        // Create fill between percentiles using custom layer
        return {
            p10_p90: percentiles.p10.map((p10, i) => ({
                x: p10.year,
                y0: p10.netWorth,
                y1: percentiles.p90[i]?.netWorth ?? p10.netWorth,
            })),
            p25_p75: percentiles.p25.map((p25, i) => ({
                x: p25.year,
                y0: p25.netWorth,
                y1: percentiles.p75[i]?.netWorth ?? p25.netWorth,
            })),
        };
    }, [percentiles]);

    // Calculate y-axis bounds from percentile data only (excludes best/worst outliers)
    const yBounds = useMemo(() => {
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
        const max = Math.max(...allValues);

        // Add minimal padding
        const padding = (max - min) * 0.02;
        return {
            min: min - padding,
            max: max + padding,
        };
    }, [percentiles, deterministicLine]);

    // Calculate x-axis tick values to prevent label overlap
    const xTickValues = useMemo(() => {
        if (percentiles.p50.length === 0) return undefined;

        const years = percentiles.p50.map(p => p.year);
        const range = years.length;

        // Determine step size based on range (aim for ~8-10 ticks max)
        let step = 1;
        if (range > 41) step = 2;

        // Filter years at regular intervals
        return years.filter((year, i) => {
            // Always include first and last
            if (i === 0 || i === years.length - 1) return true;
            // Include years at step intervals
            return (year - years[0]) % step === 0;
        });
    }, [percentiles.p50]);

    // Custom layer to render filled areas between percentile bands
    const AreaLayer = ({ xScale, yScale }: any) => {
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
                    fill="#10b981"
                    fillOpacity={0.1}
                />
                {/* Inner band (25th-75th) */}
                <path
                    d={createPath(areaData.p25_p75)}
                    fill="#10b981"
                    fillOpacity={0.15}
                />
            </g>
        );
    };

    if (chartData.length === 0 || chartData[0].data.length === 0) {
        return (
            <div ref={containerRef} className="flex items-center justify-center h-64 border-2 border-dashed border-gray-700 rounded-xl">
                <p className="text-gray-400">Run simulation to see results</p>
            </div>
        );
    }

    // Show loading state until measured, then show message if too narrow
    if (!isMeasured) {
        return (
            <div ref={containerRef} style={{ height }} className="flex items-center justify-center">
                <p className="text-gray-400 text-sm">Loading chart...</p>
            </div>
        );
    }

    if (isNarrow) {
        return (
            <div ref={containerRef} style={{ height }} className="flex items-center justify-center border-2 border-dashed border-gray-700 rounded-xl">
                <p className="text-gray-400 text-sm text-center px-4">Expand window to view chart</p>
            </div>
        );
    }

    return (
        <div ref={containerRef} style={{ height }}>
            <ResponsiveLine
                data={chartData}
                margin={{ top: 20, right: 110, bottom: 50, left: 80 }}
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
                colors={(d) => d.color}
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
                        translateX: 100,
                        translateY: 0,
                        itemsSpacing: 2,
                        itemDirection: 'left-to-right',
                        itemWidth: 80,
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
                        ticks: { text: { fill: '#9ca3af', fontSize: 11 } },
                        legend: { text: { fill: '#9ca3af', fontSize: 12 } },
                    },
                    grid: { line: { stroke: '#374151', strokeWidth: 1 } },
                    crosshair: { line: { stroke: '#10b981', strokeWidth: 1 } },
                    legends: { text: { fill: '#9ca3af', fontSize: 11 } },
                }}
                tooltip={({ point }) => (
                    <div className="bg-gray-800 border border-gray-700 px-3 py-2 rounded shadow-xl text-sm max-w-[300px]">
                        <div className="font-medium text-gray-300 truncate">{point.seriesId}</div>
                        <div className="text-gray-400">
                            Year: <span className="text-white">{point.data.x as number}</span>
                        </div>
                        <div className="text-gray-400">
                            Net Worth:{' '}
                            <span className="text-green-400 font-mono">
                                {formatCompactCurrency(point.data.y as number, { forceExact })}
                            </span>
                        </div>
                    </div>
                )}
            />
        </div>
    );
};
