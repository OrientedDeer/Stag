import React, { useMemo, useContext } from 'react';
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
const ChartTooltip = ({ point }: { point: { seriesId: string | number; data: { xFormatted?: string; y: number | string } } }) => {
    const { state: assumptions } = useContext(AssumptionsContext);
    const forceExact = assumptions.display?.useCompactCurrency === false;
    const isBaseline = point.seriesId as string === 'baseline';
    const color = isBaseline ? '#3b82f6' : '#f97316';
    const label = isBaseline ? 'Baseline' : 'Comparison';

    return (
        <div className="bg-gray-800 border border-gray-700 px-3 py-2 rounded shadow-xl text-sm">
            <div className="flex items-center gap-2 mb-1">
                <div className="w-3 h-3 rounded" style={{ backgroundColor: color }} />
                <span className="text-gray-300">{label}</span>
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
    const { state: assumptions } = useContext(AssumptionsContext);
    const forceExact = assumptions.display?.useCompactCurrency === false;
    const { baseline, comparison: comp, differences } = comparison;

    // Prepare chart data
    const chartData = useMemo(() => {
        return [
            {
                id: 'baseline',
                color: '#3b82f6', // Blue
                data: differences.netWorthByYear.map(y => ({
                    x: y.year,
                    y: y.baseline
                }))
            },
            {
                id: 'comparison',
                color: '#f97316', // Orange
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

        differences.netWorthByYear.forEach(y => {
            min = Math.min(min, y.baseline, y.comparison);
            max = Math.max(max, y.baseline, y.comparison);
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
                    <div className="w-4 h-1 bg-blue-500 rounded" />
                    <span className="text-gray-300 text-sm">{baseline.metadata.name}</span>
                </div>
                <div className="flex items-center gap-2">
                    <div className="w-4 h-1 bg-orange-500 rounded" />
                    <span className="text-gray-300 text-sm">{comp.metadata.name}</span>
                </div>
            </div>

            {/* Chart */}
            <div className="bg-gray-800/50 rounded-xl border border-gray-700 p-4">
                <h3 className="text-white font-semibold mb-4">Net Worth Over Time</h3>

                <div className="h-96 w-full">
                    <ResponsiveLine
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
                        colors={['#3b82f6', '#f97316']}
                        lineWidth={2}
                        enablePoints={false}
                        useMesh={true}
                        enableSlices="x"
                        curve="monotoneX"
                        theme={{
                            axis: {
                                ticks: { text: { fill: '#9ca3af', fontSize: 11 } },
                                legend: { text: { fill: '#9ca3af', fontSize: 12 } }
                            },
                            grid: { line: { stroke: '#374151', strokeWidth: 1 } },
                            crosshair: { line: { stroke: '#fff', strokeWidth: 1, strokeOpacity: 0.5 } }
                        }}
                        sliceTooltip={({ slice }) => (
                            <div className="bg-gray-800 border border-gray-700 px-4 py-3 rounded shadow-xl">
                                <div className="text-gray-400 text-sm mb-2">Year {slice.points[0].data.x}</div>
                                {slice.points.map(point => {
                                    const isBaseline = point.seriesId as string === 'baseline';
                                    const color = isBaseline ? '#3b82f6' : '#f97316';
                                    const label = isBaseline ? baseline.metadata.name : comp.metadata.name;

                                    return (
                                        <div key={point.id} className="flex items-center gap-2 mb-1">
                                            <div
                                                className="w-3 h-3 rounded"
                                                style={{ backgroundColor: color }}
                                            />
                                            <span className="text-gray-300 text-sm">{label}:</span>
                                            <span className="text-white font-semibold text-sm">
                                                {formatCompactCurrency(point.data.y as number, { forceExact })}
                                            </span>
                                        </div>
                                    );
                                })}
                                {slice.points.length === 2 && (
                                    <div className="border-t border-gray-700 mt-2 pt-2">
                                        <span className="text-gray-400 text-sm">Difference: </span>
                                        <span className={`font-semibold text-sm ${
                                            (slice.points[1].data.y as number) >= (slice.points[0].data.y as number)
                                                ? 'text-green-400'
                                                : 'text-red-400'
                                        }`}>
                                            {formatCompactCurrency((slice.points[1].data.y as number) - (slice.points[0].data.y as number), { forceExact })}
                                        </span>
                                    </div>
                                )}
                            </div>
                        )}
                        tooltip={ChartTooltip}
                    />
                </div>
            </div>

            {/* Summary stats */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-gray-800/50 rounded-xl border border-gray-700 p-4">
                    <div className="text-xs text-gray-400 uppercase mb-1">Starting Net Worth</div>
                    <div className="flex items-baseline gap-2">
                        <span className="text-blue-400 font-semibold">
                            {formatCompactCurrency(differences.netWorthByYear[0]?.baseline ?? 0, { forceExact })}
                        </span>
                        <span className="text-gray-400">vs</span>
                        <span className="text-orange-400 font-semibold">
                            {formatCompactCurrency(differences.netWorthByYear[0]?.comparison ?? 0, { forceExact })}
                        </span>
                    </div>
                </div>

                <div className="bg-gray-800/50 rounded-xl border border-gray-700 p-4">
                    <div className="text-xs text-gray-400 uppercase mb-1">Ending Net Worth</div>
                    <div className="flex items-baseline gap-2">
                        <span className="text-blue-400 font-semibold">
                            {formatCompactCurrency(differences.netWorthByYear[differences.netWorthByYear.length - 1]?.baseline ?? 0, { forceExact })}
                        </span>
                        <span className="text-gray-400">vs</span>
                        <span className="text-orange-400 font-semibold">
                            {formatCompactCurrency(differences.netWorthByYear[differences.netWorthByYear.length - 1]?.comparison ?? 0, { forceExact })}
                        </span>
                    </div>
                </div>

                <div className="bg-gray-800/50 rounded-xl border border-gray-700 p-4">
                    <div className="text-xs text-gray-400 uppercase mb-1">Final Difference</div>
                    <div className={`text-xl font-bold ${
                        differences.legacyValueDelta >= 0 ? 'text-green-400' : 'text-red-400'
                    }`}>
                        {differences.legacyValueDelta >= 0 ? '+' : ''}
                        {formatCompactCurrency(differences.legacyValueDelta, { forceExact })}
                    </div>
                    <div className="text-xs text-gray-400">
                        ({differences.legacyValueDeltaPercent.toFixed(1)}%)
                    </div>
                </div>
            </div>
        </div>
    );
};

export default OverlaidChartView;
