import { ReactElement, useContext, useMemo } from 'react';
import { ResponsiveLine } from '@nivo/line';
import { AccountContext } from '../Objects/Accounts/AccountContext';
import { SimulationContext } from '../Objects/Assumptions/SimulationContext';
import { useChartTheme } from './useChartTheme';
import { ChartFrame } from './ChartFrame';
import { ChartTooltipPortal } from './ChartTooltipPortal';
import { formatCompactCurrency } from '../../tabs/Future/tabs/FutureUtils';
import {
    loadProjectionHistory,
    extractNetWorthCurve,
    actualNetWorthByYear,
} from '../../services/projectionHistory';

const NIVO_THEME = {
    background: 'transparent',
    text: { fontSize: 12, fill: 'var(--c-content-muted)' },
    axis: {
        legend: { text: { fill: 'var(--c-content-muted)' } },
        ticks: { text: { fill: 'var(--c-content-muted)' } },
    },
    grid: { line: { stroke: 'var(--c-border-default)', strokeWidth: 1, strokeDasharray: '4 4' } },
    crosshair: { line: { stroke: 'var(--c-content-muted)', strokeWidth: 1, strokeOpacity: 0.35 } },
    tooltip: { container: { zIndex: 9999 } },
};

interface SlicePoint {
    seriesId: string;
    seriesColor: string;
    data: { x: number; y: number };
}

interface Props {
    /**
     * Visible year window to share with the page's main projection chart so the
     * two line up. The future end is clamped to `yearRange[1]`; the actual
     * (reality) line keeps its earlier history so the past-vs-prediction
     * comparison isn't clipped.
     */
    yearRange?: [number, number];
}

/**
 * "The projection chart gains memory" (#63): overlays the actual net-worth path
 * (from recorded balances) on the current projection and on past frozen
 * projections, so you can see how predictions held up. Predictions accrue
 * monthly — early on this shows mostly the current projection vs reality.
 */
export function ProjectionMemoryChart({ yearRange }: Props = {}): ReactElement {
    const { accounts, amountHistory } = useContext(AccountContext);
    const { simulation } = useContext(SimulationContext);
    const { theme, resolve } = useChartTheme();

    const { lineData, vintageIds, hasData } = useMemo(() => {
        const [rangeStart, rangeEnd] = yearRange ?? [-Infinity, Infinity];
        // Forward-looking series share the page's window; the actual line keeps
        // its past so reality-vs-prediction stays visible.
        const inWindow = (x: number) => x >= rangeStart && x <= rangeEnd;
        const beforeEnd = (x: number) => x <= rangeEnd;

        const snapshots = loadProjectionHistory();
        const actual = actualNetWorthByYear(accounts, amountHistory).filter(p => beforeEnd(p.year));
        const current = extractNetWorthCurve(simulation).filter(p => inWindow(p.year));

        const series: { id: string; data: { x: number; y: number }[] }[] = [];
        const vIds: string[] = [];
        // Past frozen projections first (drawn faint, behind). Skip any with no
        // points left in the window.
        for (const snap of snapshots) {
            const data = snap.netWorthByYear.filter(p => inWindow(p.year)).map(p => ({ x: p.year, y: p.netWorth }));
            if (data.length === 0) continue;
            const id = `Predicted ${snap.capturedYearMonth}`;
            vIds.push(id);
            series.push({ id, data });
        }
        if (current.length > 0) {
            series.push({ id: 'Projected (now)', data: current.map(p => ({ x: p.year, y: p.netWorth })) });
        }
        if (actual.length > 0) {
            series.push({ id: 'Actual', data: actual.map(p => ({ x: p.year, y: p.netWorth })) });
        }
        return { lineData: series, vintageIds: vIds, hasData: actual.length > 0 || current.length > 0 };
    }, [accounts, amountHistory, simulation, yearRange]);

    const SliceTooltip = ({ slice }: { slice: { points: readonly SlicePoint[] } }) => {
        const pts = slice.points;
        if (!pts.length) return null;
        // Name the prominent series (Actual / Projected now); summarize the past
        // predictions (the faint vintage lines) as the range of what they
        // forecast for this year — that spread is the useful comparison.
        const prominent = pts.filter(p => p.seriesId === 'Actual' || p.seriesId === 'Projected (now)');
        const vintageVals = pts.filter(p => p.seriesId !== 'Actual' && p.seriesId !== 'Projected (now)').map(p => p.data.y);
        const vMin = vintageVals.length ? Math.min(...vintageVals) : 0;
        const vMax = vintageVals.length ? Math.max(...vintageVals) : 0;
        return (
            <ChartTooltipPortal>
                <div className="bg-surface-overlay p-3 rounded border border-border-default shadow-xl text-xs min-w-37.5">
                    <div className="font-bold text-white mb-2 pb-1 border-b border-border-strong">
                        Year: {pts[0].data.x}
                    </div>
                    <div className="flex flex-col gap-1">
                        {prominent.map(p => (
                            <div key={p.seriesId} className="flex justify-between gap-4">
                                <span className="text-content-muted">{p.seriesId}:</span>
                                <span className="font-mono" style={{ color: p.seriesColor }}>
                                    {formatCompactCurrency(p.data.y)}
                                </span>
                            </div>
                        ))}
                        {vintageVals.length > 0 && (
                            <div className="flex justify-between gap-4 pt-1 border-t border-border-strong/50">
                                <span className="text-content-subtle">
                                    {vintageVals.length === 1 ? 'Earlier prediction:' : `Earlier predictions (${vintageVals.length}):`}
                                </span>
                                <span className="font-mono text-content-subtle">
                                    {vMin === vMax ? formatCompactCurrency(vMin) : `${formatCompactCurrency(vMin)}–${formatCompactCurrency(vMax)}`}
                                </span>
                            </div>
                        )}
                    </div>
                </div>
            </ChartTooltipPortal>
        );
    };

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
                <>
                    {/* HTML legend (matches the card; no overlay legend on the chart). */}
                    <div className="flex items-center gap-4 text-xs text-content-muted">
                        <span className="flex items-center gap-1.5">
                            <span className="inline-block w-4 h-0.5 rounded" style={{ background: resolve('var(--c-positive-solid)') }} />
                            Actual
                        </span>
                        <span className="flex items-center gap-1.5">
                            <span className="inline-block w-4 h-0.5 rounded" style={{ background: resolve('var(--c-accent-soft)') }} />
                            Projected
                        </span>
                        {vintageIds.length > 0 && (
                            <span className="flex items-center gap-1.5">
                                <span className="inline-block w-4 border-t border-dashed" style={{ borderColor: resolve('var(--c-content-subtle)') }} />
                                Past predictions
                            </span>
                        )}
                    </div>

                    <div className="h-80 w-full text-white">
                        <ChartFrame>
                            <ResponsiveLine
                                key={theme}
                                data={lineData}
                                theme={NIVO_THEME}
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
                                enablePoints={false}
                                enableGridX={false}
                                enableSlices="x"
                                useMesh={true}
                                sliceTooltip={SliceTooltip}
                                layers={[
                                    'grid', 'axes',
                                    // Custom line layer so vintage curves render thin/dashed/faint
                                    // and the actual/current lines read clearly above them.
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
                                                        strokeOpacity={isVintage ? 0.45 : 1}
                                                    />
                                                );
                                            })}
                                        </g>
                                    ),
                                    'crosshair', 'slices', 'mesh',
                                ]}
                            />
                        </ChartFrame>
                    </div>
                </>
            )}
        </div>
    );
}
