import React, { useMemo, useContext } from 'react';
import { useChartTheme } from '../../../components/Charts/useChartTheme';
import { ChartFrame } from "../../../components/Charts/ChartFrame";
import { ResponsiveLine } from '@nivo/line';
import { ScenarioComparison } from '../../../services/ScenarioTypes';
import { formatCompactCurrency } from './FutureUtils';
import { AssumptionsContext } from '../../../components/Objects/Assumptions/AssumptionsContext';

interface OverlaidChartViewProps {
    comparison: ScenarioComparison;
}

/**
 * Custom tooltip for the chart
 */
const ChartTooltip = ({ point }: { point: { seriesId: string | number; data: { xFormatted?: string; y: number | string | null } } }) => {
    const { state: assumptions } = useContext(AssumptionsContext);
    const forceExact = assumptions.display?.useCompactCurrency === false;
    const isBaseline = point.seriesId as string === 'baseline';
    const color = isBaseline ? 'var(--c-accent-soft)' : 'var(--c-cat-orange-soft)';
    const label = isBaseline ? 'Baseline' : 'Comparison';

    return (
        <div className="bg-surface-overlay border border-border-default px-3 py-2 rounded shadow-xl text-sm">
            <div className="flex items-center gap-2 mb-1">
                <div className="w-3 h-3 rounded" style={{ backgroundColor: color }} />
                <span className="text-content-default">{label}</span>
            </div>
            <div className="text-white font-semibold">
                {point.data.xFormatted}: {formatCompactCurrency(point.data.y as number, { forceExact })}
            </div>
        </div>
    );
};

/**
 * Overlaid chart view showing both scenario trajectories
 */
export const OverlaidChartView: React.FC<OverlaidChartViewProps> = ({ comparison }) => {
    const { resolve } = useChartTheme();
    const { state: assumptions } = useContext(AssumptionsContext);
    const forceExact = assumptions.display?.useCompactCurrency === false;
    const { baseline, comparison: comp, differences } = comparison;

    // Prepare chart data
    const chartData = useMemo(() => {
        return [
            {
                id: 'baseline',
                color: 'var(--c-accent-soft)', // Blue
                data: differences.netWorthByYear.map(y => ({
                    x: y.year,
                    y: y.baseline
                }))
            },
            {
                id: 'comparison',
                color: 'var(--c-cat-orange-soft)', // Orange
                data: differences.netWorthByYear.map(y => ({
                    x: y.year,
                    y: y.comparison
                }))
            }
        ];
    }, [differences.netWorthByYear]);

    // Calculate min/max for y-axis
    const { minY, maxY } = useMemo(() => {
        let min = Infinity;
        let max = -Infinity;

        // Ignore null tail years (beyond a plan's horizon) — they are gaps, not $0.
        differences.netWorthByYear.forEach(y => {
            if (y.baseline !== null) { min = Math.min(min, y.baseline); max = Math.max(max, y.baseline); }
            if (y.comparison !== null) { min = Math.min(min, y.comparison); max = Math.max(max, y.comparison); }
        });

        // Add some padding
        const padding = (max - min) * 0.1;
        return { minY: min - padding, maxY: max + padding };
    }, [differences.netWorthByYear]);

    return (
        <div className="flex flex-col gap-4">
            {/* Legend */}
            <div className="flex gap-6 justify-center">
                <div className="flex items-center gap-2">
                    <div className="w-4 h-1 bg-accent-soft rounded" />
                    <span className="text-content-default text-sm">{baseline.metadata.name}</span>
                </div>
                <div className="flex items-center gap-2">
                    <div className="w-4 h-1 bg-cat-orange-soft rounded" />
                    <span className="text-content-default text-sm">{comp.metadata.name}</span>
                </div>
            </div>

            {/* Chart */}
            <div className="bg-surface-overlay/50 rounded-xl border border-border-default p-4">
                <h3 className="text-white font-semibold mb-4">Net Worth Over Time</h3>

                <div className="h-96 w-full">
                    <ChartFrame><ResponsiveLine
                        data={chartData}
                        margin={{ top: 20, right: 30, bottom: 50, left: 80 }}
                        xScale={{ type: 'point' }}
                        yScale={{
                            type: 'linear',
                            min: minY,
                            max: maxY,
                            stacked: false
                        }}
                        axisBottom={{
                            tickSize: 5,
                            tickPadding: 5,
                            tickRotation: -45,
                            legend: 'Year',
                            legendOffset: 40,
                            legendPosition: 'middle',
                            tickValues: differences.netWorthByYear
                                .filter((_, i) => i % Math.ceil(differences.netWorthByYear.length / 10) === 0)
                                .map(y => y.year)
                        }}
                        axisLeft={{
                            tickSize: 5,
                            tickPadding: 5,
                            tickRotation: 0,
                            legend: 'Net Worth',
                            legendOffset: -65,
                            legendPosition: 'middle',
                            format: (value) => formatCompactCurrency(value as number, { forceExact })
                        }}
                        enableGridX={false}
                        enableGridY={true}
                        colors={(d) => resolve((d as { color?: string }).color)}
                        lineWidth={2}
                        enablePoints={false}
                        useMesh={true}
                        enableSlices="x"
                        curve="monotoneX"
                        theme={{
                            axis: {
                                ticks: { text: { fill: 'var(--c-content-muted)', fontSize: 11 } },
                                legend: { text: { fill: 'var(--c-content-muted)', fontSize: 12 } }
                            },
                            grid: { line: { stroke: 'var(--c-border-default)', strokeWidth: 1 } },
                            crosshair: { line: { stroke: '#fff', strokeWidth: 1, strokeOpacity: 0.5 } }
                        }}
                        sliceTooltip={({ slice }) => (
                            <div className="bg-surface-overlay border border-border-default px-4 py-3 rounded shadow-xl">
                                <div className="text-content-muted text-sm mb-2">Year {slice.points[0].data.x}</div>
                                {slice.points.map(point => {
                                    const isBaseline = point.seriesId as string === 'baseline';
                                    const color = isBaseline ? 'var(--c-accent-soft)' : 'var(--c-cat-orange-soft)';
                                    const label = isBaseline ? baseline.metadata.name : comp.metadata.name;

                                    return (
                                        <div key={point.id} className="flex items-center gap-2 mb-1">
                                            <div
                                                className="w-3 h-3 rounded"
                                                style={{ backgroundColor: color }}
                                            />
                                            <span className="text-content-default text-sm">{label}:</span>
                                            <span className="text-white font-semibold text-sm">
                                                {formatCompactCurrency(point.data.y as number, { forceExact })}
                                            </span>
                                        </div>
                                    );
                                })}
                                {slice.points.length === 2 && (
                                    <div className="border-t border-border-default mt-2 pt-2">
                                        <span className="text-content-muted text-sm">Difference: </span>
                                        <span className={`font-semibold text-sm ${
                                            (slice.points[1].data.y as number) >= (slice.points[0].data.y as number)
                                                ? 'text-positive'
                                                : 'text-negative'
                                        }`}>
                                            {formatCompactCurrency((slice.points[1].data.y as number) - (slice.points[0].data.y as number), { forceExact })}
                                        </span>
                                    </div>
                                )}
                            </div>
                        )}
                        tooltip={ChartTooltip}
                    /></ChartFrame>
                </div>
            </div>

            {/* Summary stats */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-surface-overlay/50 rounded-xl border border-border-default p-4">
                    <div className="text-xs text-content-muted uppercase mb-1">Starting Net Worth</div>
                    <div className="flex items-baseline gap-2">
                        <span className="text-info font-semibold">
                            {formatCompactCurrency(differences.netWorthByYear[0]?.baseline ?? 0, { forceExact })}
                        </span>
                        <span className="text-content-muted">vs</span>
                        <span className="text-cat-orange font-semibold">
                            {formatCompactCurrency(differences.netWorthByYear[0]?.comparison ?? 0, { forceExact })}
                        </span>
                    </div>
                </div>

                <div className="bg-surface-overlay/50 rounded-xl border border-border-default p-4">
                    <div className="text-xs text-content-muted uppercase mb-1">Ending Net Worth</div>
                    <div className="flex items-baseline gap-2">
                        {/* Each plan's OWN final year (horizons can differ); the last
                            union year's value may be null for the shorter plan. */}
                        <span className="text-info font-semibold">
                            {formatCompactCurrency(baseline.milestones.legacyValue, { forceExact })}
                        </span>
                        <span className="text-content-muted">vs</span>
                        <span className="text-cat-orange font-semibold">
                            {formatCompactCurrency(comp.milestones.legacyValue, { forceExact })}
                        </span>
                    </div>
                </div>

                <div className="bg-surface-overlay/50 rounded-xl border border-border-default p-4">
                    <div className="text-xs text-content-muted uppercase mb-1">Final Difference</div>
                    <div className={`text-xl font-bold ${
                        differences.legacyValueDelta >= 0 ? 'text-positive' : 'text-negative'
                    }`}>
                        {differences.legacyValueDelta >= 0 ? '+' : ''}
                        {formatCompactCurrency(differences.legacyValueDelta, { forceExact })}
                    </div>
                    <div className="text-xs text-content-muted">
                        ({differences.legacyValueDeltaPercent.toFixed(1)}%)
                    </div>
                </div>
            </div>
        </div>
    );
};
