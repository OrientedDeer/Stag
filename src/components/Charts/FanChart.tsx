import { useMemo } from 'react';
import { ResponsiveLine } from '@nivo/line';
import { PercentileData, YearlyPercentile } from '../../services/MonteCarloTypes';

interface FanChartProps {
    percentiles: PercentileData;
    deterministicLine?: YearlyPercentile[];
    height?: number;
}

/**
 * Fan Chart for Monte Carlo simulation results
 * Shows probability bands (10th-90th, 25th-75th percentiles) with median line
 */
export const FanChart = ({ percentiles, deterministicLine, height = 400 }: FanChartProps) => {
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

        return lines;
    }, [percentiles, deterministicLine]);

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
            <div className="flex items-center justify-center h-64 border-2 border-dashed border-gray-700 rounded-xl">
                <p className="text-gray-500">Run simulation to see results</p>
            </div>
        );
    }

    return (
        <div style={{ height }}>
            <ResponsiveLine
                data={chartData}
                margin={{ top: 20, right: 110, bottom: 50, left: 80 }}
                xScale={{ type: 'linear', min: 'auto', max: 'auto' }}
                yScale={{ type: 'linear', min: 'auto', max: 'auto' }}
                axisBottom={{
                    tickSize: 5,
                    tickPadding: 5,
                    tickRotation: 0,
                    legend: 'Year',
                    legendOffset: 36,
                    legendPosition: 'middle',
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
                    <div className="bg-gray-800 border border-gray-700 px-3 py-2 rounded shadow-xl text-sm">
                        <div className="font-medium text-gray-300">{point.seriesId}</div>
                        <div className="text-gray-400">
                            Year: <span className="text-white">{point.data.x as number}</span>
                        </div>
                        <div className="text-gray-400">
                            Net Worth:{' '}
                            <span className="text-green-400 font-mono">
                                ${(point.data.y as number).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                            </span>
                        </div>
                    </div>
                )}
            />
        </div>
    );
};
