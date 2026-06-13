import { ReactElement, useContext, useMemo } from 'react';
import { ResponsiveLine } from '@nivo/line';
import { AccountContext } from '../Objects/Accounts/AccountContext';
import { SimulationContext } from '../Objects/Assumptions/SimulationContext';
import { useChartTheme } from './useChartTheme';
import { ChartFrame } from './ChartFrame';
import {
    loadProjectionHistory,
    extractNetWorthCurve,
    actualNetWorthByYear,
} from '../../services/projectionHistory';

/**
 * "The projection chart gains memory" (#63): overlays the actual net-worth path
 * (from recorded balances) on the current projection and on past frozen
 * projections, so you can see how predictions held up. Predictions accrue
 * monthly — early on this shows mostly the current projection vs reality.
 */
export function ProjectionMemoryChart(): ReactElement {
    const { accounts, amountHistory } = useContext(AccountContext);
    const { simulation } = useContext(SimulationContext);
    const { theme, resolve } = useChartTheme();

    const { lineData, vintageIds, hasData } = useMemo(() => {
        const snapshots = loadProjectionHistory();
        const actual = actualNetWorthByYear(accounts, amountHistory);
        const current = extractNetWorthCurve(simulation);

        const series: { id: string; data: { x: number; y: number }[] }[] = [];

        // Past frozen projections, oldest → newest (faint, behind everything).
        const vIds: string[] = [];
        for (const snap of snapshots) {
            const id = `Predicted ${snap.capturedYearMonth}`;
            vIds.push(id);
            series.push({ id, data: snap.netWorthByYear.map(p => ({ x: p.year, y: p.netWorth })) });
        }
        if (current.length > 0) {
            series.push({ id: 'Projected (now)', data: current.map(p => ({ x: p.year, y: p.netWorth })) });
        }
        if (actual.length > 0) {
            series.push({ id: 'Actual', data: actual.map(p => ({ x: p.year, y: p.netWorth })) });
        }

        return { lineData: series, vintageIds: vIds, hasData: actual.length > 0 || current.length > 0 };
    }, [accounts, amountHistory, simulation]);

    return (
        <div className="bg-[var(--c-surface-raised)] rounded-xl border border-border-subtle p-4 space-y-3">
            <div>
                <h3 className="text-lg font-semibold text-white">Projection track record</h3>
                <p className="text-xs text-content-muted mt-0.5">
                    How the model's past predictions line up with your actual net worth. Predictions
                    are recorded once a month. Differences reflect both market/assumption surprises
                    and changes you've made to your plan since.
                </p>
            </div>

            {!hasData ? (
                <div className="h-64 flex items-center justify-center text-center">
                    <p className="text-content-muted text-sm px-6">
                        No data yet. Update your account balances and let a projection run — predictions
                        are saved monthly, then this shows how they hold up over time.
                    </p>
                </div>
            ) : (
                <div className="h-80 w-full text-white">
                    <ChartFrame>
                        <ResponsiveLine
                            key={theme}
                            data={lineData}
                            margin={{ top: 16, right: 24, bottom: 48, left: 80 }}
                            xScale={{ type: 'linear', min: 'auto', max: 'auto' }}
                            yScale={{ type: 'linear', min: 'auto', max: 'auto', stacked: false }}
                            curve="monotoneX"
                            axisTop={null}
                            axisRight={null}
                            axisBottom={{ tickSize: 0, tickPadding: 10, legend: 'Year', legendOffset: 36, legendPosition: 'middle', format: (v) => `${v}` }}
                            axisLeft={{ tickSize: 0, tickPadding: 10, format: ' >-$,.0f' }}
                            colors={({ id }) => {
                                if (id === 'Actual') return resolve('var(--c-positive-solid)');
                                if (id === 'Projected (now)') return resolve('var(--c-accent-soft)');
                                return resolve('var(--c-content-subtle)'); // vintages
                            }}
                            lineWidth={3}
                            enablePoints={false}
                            enableGridX={false}
                            enableSlices="x"
                            useMesh={true}
                            // Vintage lines: thin, dashed, low opacity so the actual/current read clearly.
                            layers={[
                                'grid', 'axes',
                                ({ series, lineGenerator, xScale, yScale }) => (
                                    <g>
                                        {series.map(s => {
                                            const isVintage = vintageIds.includes(String(s.id));
                                            const path = lineGenerator(
                                                s.data.map(d => ({
                                                    x: (xScale as (v: number) => number)(d.data.x as number),
                                                    y: (yScale as (v: number) => number)(d.data.y as number),
                                                }))
                                            ) ?? undefined;
                                            return (
                                                <path
                                                    key={s.id}
                                                    d={path}
                                                    fill="none"
                                                    stroke={s.color}
                                                    strokeWidth={isVintage ? 1 : 3}
                                                    strokeDasharray={isVintage ? '3 3' : undefined}
                                                    strokeOpacity={isVintage ? 0.5 : 1}
                                                />
                                            );
                                        })}
                                    </g>
                                ),
                                'crosshair', 'slices', 'mesh', 'legends',
                            ]}
                            legends={[
                                {
                                    anchor: 'top-left', direction: 'row', translateY: -4, itemWidth: 110,
                                    itemHeight: 16, symbolSize: 8, itemTextColor: resolve('var(--c-content-muted)'),
                                    data: [
                                        { id: 'Actual', label: 'Actual', color: resolve('var(--c-positive-solid)') },
                                        { id: 'Projected (now)', label: 'Projected', color: resolve('var(--c-accent-soft)') },
                                        ...(vintageIds.length > 0 ? [{ id: 'vintage', label: 'Past predictions', color: resolve('var(--c-content-subtle)') }] : []),
                                    ],
                                },
                            ]}
                        />
                    </ChartFrame>
                </div>
            )}
        </div>
    );
}
