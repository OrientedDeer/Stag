import { useMemo, useRef, useState, useEffect, useContext } from 'react';
import { ResponsiveLine } from '@nivo/line';
import { ChartTooltipPortal } from '../../../components/Charts/ChartTooltipPortal';
import { useChartTheme } from '../../../components/Charts/useChartTheme';
import { ChartFrame } from '../../../components/Charts/ChartFrame';
import { RangeSlider } from '../../../components/Layout/InputFields/RangeSlider';
import { useArrowKeyAdjust } from '../../../hooks/useKeyboardShortcuts';
import { AlertBanner } from '../../../components/Layout/AlertBanner';
import { SimulationYear } from '../../../components/Objects/Assumptions/SimulationEngine';
import { useAssumptions } from '../../../components/Objects/Assumptions/AssumptionsContext';
import { TaxContext } from '../../../components/Objects/Taxes/TaxContext';
import { getProjectedRMDMarginalRate } from '../../../services/TaxOptimizationService';
import { computeAfterTaxNetWorth, formatCompactCurrency } from './FutureUtils';

const MIN_CHART_WIDTH = 300;

interface AfterTaxPoint {
    year: number;
    NetWorth: number;
    AfterTax: number;
    DeferredTax: number;
    /** Projected RMD-era marginal rate applied to the Traditional balance. */
    rate: number;
}

interface SliceArg {
    slice?: { points?: ReadonlyArray<{ data: AfterTaxPoint }> };
}

/**
 * Nominal net worth vs. after-tax net worth over the projection (#68). The gap
 * between the two lines is the deferred tax still owed on tax-deferred balances
 * (and unrealized gains) — and it widens over time as those balances grow,
 * because a Traditional dollar isn't a Roth dollar.
 */
export function AfterTaxNetWorthChart({ simulationData }: { simulationData: SimulationYear[] }) {
    const { assumptions } = useAssumptions();
    const { state: taxState } = useContext(TaxContext);
    const { resolve } = useChartTheme();
    const forceExact = assumptions.display?.useCompactCurrency === false;

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
    const isMeasured = containerWidth !== null;
    const isNarrow = containerWidth !== null && containerWidth < MIN_CHART_WIDTH;

    // Real (non-EOY) projection years, and a Timeline range slider over them —
    // matching the per-chart range control used elsewhere on the Future tabs.
    const realYears = useMemo(() => simulationData.filter(y => !y.isEndOfYearProjection), [simulationData]);
    const minYear = realYears.length > 0 ? realYears[0].year : new Date().getFullYear();
    const maxYear = realYears.length > 0 ? realYears[realYears.length - 1].year : minYear + 10;
    const [range, setRange] = useState<[number, number] | null>(null);
    // Reconcile a stored range with the current projection bounds during render
    // (it can fall outside them after a data import / life-expectancy change).
    // Deriving here — rather than resetting state in an effect — keeps the chart
    // from rendering an empty slice. If the range no longer overlaps the bounds at
    // all, reset to the default window; otherwise clamp the overlap into range.
    const activeRange = useMemo<[number, number]>(() => {
        const fallback: [number, number] = [minYear, Math.min(maxYear, minYear + 32)];
        if (!range || range[1] < minYear || range[0] > maxYear) return fallback;
        return [Math.max(minYear, range[0]), Math.min(maxYear, range[1])];
    }, [range, minYear, maxYear]);
    useArrowKeyAdjust(
        activeRange,
        (v) => setRange(v as [number, number]),
        { min: minYear, max: maxYear, step: 1, containerRef },
    );

    // One rate for the whole balance: the marginal rate the Traditional faces when
    // RMDs force it out (see getProjectedRMDMarginalRate). This is the rate the
    // conversion engine itself targets, so the metric no longer fights it. Computed
    // across the full projection, independent of the viewing window.
    const tradRate = useMemo(
        () => getProjectedRMDMarginalRate(simulationData, assumptions, taxState) ?? 0,
        [simulationData, assumptions, taxState],
    );

    const points = useMemo<AfterTaxPoint[]>(() => {
        return realYears
            .filter(y => y.year >= activeRange[0] && y.year <= activeRange[1])
            .map(y => {
                const { netWorth, afterTaxNetWorth, deferredTax } = computeAfterTaxNetWorth(y.accounts, tradRate);
                return { year: y.year, NetWorth: netWorth, AfterTax: afterTaxNetWorth, DeferredTax: deferredTax, rate: tradRate };
            });
    }, [realYears, activeRange, tradRate]);

    const lineData = useMemo(() => {
        const series = [
            { id: 'Net Worth', field: 'NetWorth' as const },
            { id: 'After-Tax', field: 'AfterTax' as const },
        ];
        return series.map(({ id, field }) => ({
            id,
            data: points.map(p => ({ ...p, x: String(p.year), y: p[field] })),
        }));
    }, [points]);

    // Thin out x-axis labels for long horizons so they don't overlap.
    const xTickValues = useMemo(() => {
        if (points.length === 0) return undefined;
        const n = points.length;
        const step = n > 40 ? 5 : n > 20 ? 2 : 1;
        return points
            .filter((p, i) => i === 0 || i === n - 1 || p.year % step === 0)
            .map(p => String(p.year));
    }, [points]);

    // Headline reflects the TRUE end of the projection (the last real year, not
    // the visible slider end), so the figures don't silently change as you scrub
    // and they show the plan's end-state — where the gap is widest. Guarded so it
    // only renders coherent numbers: positive net worth that still leaves
    // something after the deferred tax (avoids pct > 100% / negative net worth).
    const headline = useMemo(() => {
        const last = realYears[realYears.length - 1];
        if (!last) return null;
        const { netWorth, afterTaxNetWorth, deferredTax, deferredOrdinaryTax, deferredCapGainsTax } =
            computeAfterTaxNetWorth(last.accounts, tradRate);
        if (netWorth <= 0 || deferredTax <= 0 || afterTaxNetWorth <= 0) return null;
        return {
            year: last.year,
            netWorth,
            afterTax: afterTaxNetWorth,
            deferredTax,
            deferredOrdinaryTax,
            deferredCapGainsTax,
            pct: deferredTax / netWorth,
        };
    }, [realYears, tradRate]);

    const Tooltip = ({ slice }: SliceArg) => {
        if (!slice?.points?.length) return null;
        const d = slice.points[0].data;
        return (
            <ChartTooltipPortal>
                <div className="bg-surface-overlay p-3 rounded border border-border-default shadow-xl text-xs min-w-37.5">
                    <div className="font-bold text-white mb-2 pb-1 border-b border-border-strong">Year: {d.year}</div>
                    <div className="flex flex-col gap-1">
                        <div className="flex justify-between gap-4">
                            <span className="text-content-muted">Net worth:</span>
                            <span className="font-mono" style={{ color: 'var(--c-cat-cyan)' }}>{formatCompactCurrency(d.NetWorth, { forceExact })}</span>
                        </div>
                        <div className="flex justify-between gap-4">
                            <span className="text-content-muted">After-tax:</span>
                            <span className="font-mono" style={{ color: 'var(--c-cat-purple)' }}>{formatCompactCurrency(d.AfterTax, { forceExact })}</span>
                        </div>
                        <div className="border-t border-border-strong my-1" />
                        <div className="flex justify-between gap-4">
                            <span className="text-content-subtle">Deferred tax:</span>
                            <span className="font-mono text-content-subtle">−{formatCompactCurrency(d.DeferredTax, { forceExact })}</span>
                        </div>
                        <div className="flex justify-between gap-4">
                            <span className="text-content-subtle">Trad rate:</span>
                            <span className="font-mono text-content-subtle">{(d.rate * 100).toFixed(1)}%</span>
                        </div>
                    </div>
                </div>
            </ChartTooltipPortal>
        );
    };

    return (
        <div className="flex flex-col gap-3 w-full">
            <RangeSlider
                label="Timeline"
                min={minYear}
                max={maxYear}
                value={activeRange}
                onChange={(val) => setRange(val as [number, number])}
            />

            {headline && (
                <AlertBanner severity="info" size="sm" title="Not all of it is yours to spend">
                    <p className="text-sm">
                        By {headline.year}, about{' '}
                        <span className="font-semibold text-info-bright">{formatCompactCurrency(headline.deferredTax, { forceExact })}</span>{' '}
                        ({(headline.pct * 100).toFixed(0)}%) of your{' '}
                        {formatCompactCurrency(headline.netWorth, { forceExact })} net worth is taxes you haven't paid yet —
                        leaving <span className="font-semibold text-info-bright">{formatCompactCurrency(headline.afterTax, { forceExact })}</span> after-tax.
                        {headline.deferredOrdinaryTax > 0 ? (
                            <> That discounts the Traditional balance at <span className="font-semibold text-info-bright">~{(tradRate * 100).toFixed(0)}%</span> —
                            the marginal rate it's taxed at when RMDs force it out. A dollar in a Traditional account isn't a dollar in a Roth.</>
                        ) : (
                            <> That's deferred capital-gains tax on unrealized gains in your taxable accounts — even money you've already paid income tax on still owes tax on its growth.</>
                        )}
                    </p>
                </AlertBanner>
            )}

            <div className="flex items-center gap-4 px-1 flex-wrap">
                <h3 className="text-sm font-semibold text-content-muted">Net worth vs after-tax</h3>
                <span className="inline-flex items-center gap-1 text-xs text-content-muted">
                    <span className="inline-block w-3 border-t-2" style={{ borderColor: 'var(--c-cat-cyan)' }} />Net worth
                </span>
                <span className="inline-flex items-center gap-1 text-xs text-content-muted">
                    <span className="inline-block w-3 border-t-2" style={{ borderColor: 'var(--c-cat-purple)' }} />After-tax
                </span>
            </div>

            <div ref={containerRef} className="h-72 w-full text-white">
                {!isMeasured ? (
                    <div className="h-full flex items-center justify-center">
                        <p className="text-content-muted text-sm">Loading chart...</p>
                    </div>
                ) : isNarrow ? (
                    <div className="h-full flex items-center justify-center border-2 border-dashed border-border-default rounded-xl">
                        <p className="text-content-muted text-sm text-center px-4">Expand window to view chart</p>
                    </div>
                ) : (
                    <ChartFrame><ResponsiveLine
                        data={lineData}
                        margin={{ top: 16, right: 30, bottom: 50, left: 90 }}
                        xScale={{ type: 'point' }}
                        yScale={{ type: 'linear', min: 'auto', max: 'auto', stacked: false, reverse: false }}
                        curve="catmullRom"
                        axisTop={null}
                        axisRight={null}
                        axisBottom={{
                            tickSize: 0,
                            tickPadding: 12,
                            tickRotation: 0,
                            legend: 'Year',
                            legendOffset: 36,
                            legendPosition: 'middle',
                            tickValues: xTickValues,
                        }}
                        axisLeft={{
                            tickSize: 0,
                            tickPadding: 12,
                            tickRotation: 0,
                            format: ' >-$,.0f',
                        }}
                        colors={({ id }) => id === 'After-Tax' ? resolve('var(--c-cat-purple)') : resolve('var(--c-cat-cyan)')}
                        lineWidth={3}
                        enablePoints={false}
                        enableGridX={false}
                        enableArea={false}
                        useMesh={true}
                        enableSlices="x"
                        sliceTooltip={Tooltip}
                        theme={{
                            "background": "transparent",
                            "text": { "fontSize": 12, "fill": "var(--c-content-muted)" },
                            "axis": {
                                "legend": { "text": { "fill": "var(--c-content-muted)" } },
                                "ticks": { "text": { "fill": "var(--c-content-muted)" } }
                            },
                            "grid": { "line": { "stroke": "var(--c-border-default)", "strokeWidth": 1, "strokeDasharray": "4 4" } },
                            "crosshair": { "line": { "stroke": "var(--c-content-muted)", "strokeWidth": 1, "strokeOpacity": 0.35 } },
                            "tooltip": { "container": { "zIndex": 9999 } }
                        }}
                    /></ChartFrame>
                )}
            </div>
        </div>
    );
}
