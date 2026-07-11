import React, { useMemo } from 'react';
import { useContainerWidth } from '../../../hooks/useContainerWidth';
import { useTimelineRange } from '../../../hooks/useTimelineRange';
import { ChartTooltipPortal } from '../../../components/Charts/ChartTooltipPortal';
import { ResponsiveLine } from '@nivo/line';
import { useChartTheme } from '../../../components/Charts/useChartTheme';
import { ChartFrame } from "../../../components/Charts/ChartFrame";
import { ProjectionMemoryChart } from "../../../components/Charts/ProjectionMemoryChart";
import { type SimulationYear } from '../../../components/Objects/Assumptions/SimulationEngine';
import { SavedAccount, PropertyAccount, DebtAccount, DeficitDebtAccount, type AnyAccount } from '../../../components/Objects/Accounts/models';
import { formatCompactCurrency, getNetWorthBreakdown } from './FutureUtils';
import { type AnyExpense } from '../../../components/Objects/Expense/models';
import { RangeSlider } from '../../../components/Layout/InputFields/RangeSlider';
import { AlertBanner } from '../../../components/Layout/AlertBanner';
import { getFRA } from '../../../data/SocialSecurityData';
import { FutureSocialSecurityIncome, isSocialSecurity } from '../../../components/Objects/Income/models';
import { getEarnedIncome } from '../../../components/Objects/Taxes/TaxService';
import { useAssumptions, getBirthYear } from '../../../components/Objects/Assumptions/AssumptionsContext';

/**
 * Check if user is subject to Social Security earnings test
 */
function checkEarningsTest(
  year: SimulationYear | undefined,
  birthYear: number
): { applies: boolean; claimingAge?: number; fra?: number; earnedIncome?: number } {
  if (!year) return { applies: false };

  const currentAge = year.year - birthYear;
  const fra = getFRA(birthYear);

  // Check if user has active FutureSocialSecurityIncome before FRA
  const futureSS = year.incomes.find(inc =>
    inc instanceof FutureSocialSecurityIncome &&
    inc.calculatedPIA > 0 &&
    currentAge >= inc.claimingAge &&
    currentAge < fra
  ) as FutureSocialSecurityIncome | undefined;

  if (!futureSS) {
    return { applies: false };
  }

  // Check if user has earned income
  const earnedIncome = getEarnedIncome(year.incomes, year.year);

  if (earnedIncome > 0) {
    return {
      applies: true,
      claimingAge: futureSS.claimingAge,
      fra: fra,
      earnedIncome: earnedIncome
    };
  }

  return { applies: false };
}

/** Per-point data embedded in the net-worth chart, read back in the slice tooltip. */
interface OverviewPoint {
    year: number;
    yearLabel: string;
    isEOY: boolean;
    Invested: number;
    Saved: number;
    Property: number;
    Debt: number;
    /** Unvested employer-match portion (#143) — subtracted from gross to get the
     *  Vested net worth the tooltip leads with. Not plotted as its own band. */
    Unvested: number;
    /** Vested net worth (gross − Unvested). Plotted as the emphasis "Net Worth" line
     *  (#143) so the tooltip's Vested headline matches a visible mark — mirroring the
     *  Dashboard, whose net-worth line converges on its Vested big number. */
    'Net Worth': number;
}

/** The four gross net-worth bands the Overview chart plots (Debt is negative), the
 *  unvested employer-match figure used to derive Vested net worth, and the Vested
 *  net-worth value plotted as the emphasis "Net Worth" line (#143). */
export interface OverviewBuckets {
    Invested: number;
    Saved: number;
    Property: number;
    Debt: number;
    /** Σ InvestedAccount.nonVestedAmount — the part of the gross asset bands you
     *  don't own yet. The plotted bands stay GROSS (like the Dashboard's gross-asset
     *  display); only the Net Worth line/tooltip figure nets this out. */
    Unvested: number;
    /** Vested net worth (gross − Unvested) — the figure the tooltip headlines and the
     *  emphasis "Net Worth" line traces, so the headline has a visible anchor (#143). */
    'Net Worth': number;
}

/**
 * Split a year's accounts into the chart's net-worth buckets.
 *
 * The GROSS bucket bands (Invested / Saved / Property / Debt) are derived the SAME
 * way as getAccountTotals / calculateNetWorth (the Assets sub-tab, the DataTab Total
 * Assets/Debt columns, and projection-history snapshots), so the plotted asset/debt
 * bands cannot disagree with those views:
 *   - assets  = every non-debt account's balance (split into Invested / Saved /
 *     Property for display). ESPP and RSU extend BaseAccount directly (not
 *     InvestedAccount), so they're folded into Invested explicitly — otherwise
 *     they'd be silently dropped and understate net worth.
 *   - liabilities = DebtAccount/DeficitDebtAccount balances + PropertyAccount.loanAmount.
 *
 * The headline Net Worth figure in the tooltip is VESTED (gross − Unvested), matching
 * the Dashboard net-worth card and the DataTab Net Worth column (#143). `Unvested`
 * (Σ InvestedAccount.nonVestedAmount) is carried alongside the bands so the tooltip
 * can net it out and also surface the gross figure. The plotted bands themselves stay
 * gross — they ARE the Dashboard's gross-asset display. The Vested figure is ALSO
 * returned as `'Net Worth'` and plotted as an emphasis line so the tooltip headline
 * has a visible anchor on the chart (the gross bands are not stacked, so their tops
 * never trace a single net-worth line) — mirroring the Dashboard, whose net-worth
 * line converges on its Vested big number.
 *
 * Note the deliberate split: the projection-history snapshots (services/projectionHistory)
 * stay GROSS — they freeze a net-worth curve via getAccountTotals and overlay it against a
 * gross reconstruction of actual balances, and that internal trend overlay must keep using
 * the same gross definition on both lines (it is NOT a display that should track this tab's
 * vested headline).
 *
 * Mortgage debt is taken from PropertyAccount.loanAmount (the account side),
 * NOT from MortgageExpense.loan_balance. For a linked mortgage the engine keeps
 * the two in sync, but sourcing the loan from the expense diverged from
 * getAccountTotals for unlinked/imported state: an unlinked MortgageExpense
 * subtracted the loan here while the Assets sub-tab did not, and a PropertyAccount
 * with a loan but no linked expense overstated net worth here. Delegating the
 * asset/liability totals to getAccountTotals removes both divergences. `expenses`
 * is retained for call-site/signature stability but no longer read.
 */
// eslint-disable-next-line react-refresh/only-export-components -- pure net-worth helper exported for unit testing alongside the tab component
export function computeOverviewBuckets(
    accounts: AnyAccount[],
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- retained for call-site/signature stability; net worth is now derived from accounts only
    _expenses?: AnyExpense[]
): OverviewBuckets {
    let invested = 0;
    let saved = 0;
    let property = 0;

    for (const acc of accounts) {
        if (acc instanceof DebtAccount) {
            // Liabilities are summed via getAccountTotals below (keeps the bucket
            // total identical to calculateNetWorth); skip them in the asset split.
            continue;
        } else if (acc instanceof SavedAccount) {
            saved += acc.amount;
        } else if (acc instanceof PropertyAccount) {
            property += acc.amount;
        } else {
            // InvestedAccount, ESPPAccount, RSUAccount, and any other asset bucket.
            invested += acc.amount;
        }
    }

    // Debt mirrors getAccountTotals exactly: DebtAccount balances + PropertyAccount
    // loanAmount, ignoring expenses. Stored negative for the stacked chart.
    // Unvested employer match (#143): netted out of the plotted gross net worth to
    // get the Vested figure the tooltip leads with — matching the Dashboard card.
    // The asset bands above stay gross (they ARE the Dashboard's gross-asset display).
    // Both come from a single getNetWorthBreakdown pass — it already runs
    // getAccountTotals internally, so calling that separately would double the walk.
    const { liabilities, unvested, vested } = getNetWorthBreakdown(accounts);

    return {
        Invested: invested,
        Saved: saved,
        Property: property,
        Debt: -Math.abs(liabilities),
        Unvested: unvested,
        // Vested net worth, plotted as the emphasis "Net Worth" line so the tooltip's
        // Vested headline lines up with a visible mark (the gross bands alone never
        // sum to a single plotted line under the non-stacked layout).
        'Net Worth': vested,
    };
}

interface OverviewSliceArg {
    slice?: { points?: ReadonlyArray<{ data: OverviewPoint }> };
}

/** Minimal per-point shape the x-axis tick selector needs. */
interface XTickPoint {
    year: number;
    yearLabel: string;
    isEOY: boolean;
}

/**
 * Select the x-axis tick labels for the net-worth chart (point scale keyed on
 * string labels: 'Today', year strings, 'Dec YYYY').
 *
 * Always shows 'Today' plus the first/last regular years, and thins the rest to
 * every Nth year based on how many fit. When thinning (step > 1), an every-Nth
 * pick can land on the point right next to a forced tick (e.g. forced first year
 * 2027 followed by 2028 % 2 === 0), colliding on screen — so any step-selected
 * tick immediately adjacent (in point-scale slots, EOY points included) to the
 * previously kept tick or to the forced last tick is dropped.
 */
// eslint-disable-next-line react-refresh/only-export-components -- pure tick-selection helper exported for unit testing alongside the tab component
export function computeXTickValues(points: XTickPoint[], containerWidth: number | null | undefined): string[] | undefined {
    if (points.length === 0) return undefined;

    // Always show Today and EOY labels; apply step filter to regular years
    const regularYears = points.filter(d => !d.isEOY && d.yearLabel !== 'Today');
    const count = regularYears.length;
    const mobile = (containerWidth ?? 800) < 640;

    let step = 1;
    if (mobile) {
        if (count > 30) step = 5;
        else if (count > 15) step = 3;
        else if (count > 8) step = 2;
    } else {
        if (count > 40) step = 5;
        else if (count > 20) step = 2;
    }

    const lastRegularIdx = points.indexOf(regularYears[count - 1]);
    const result: string[] = [];
    let lastKeptIdx = Number.NEGATIVE_INFINITY;

    points.forEach((d, i) => {
        // Don't tick the EOY ("Dec YYYY") points — their long labels sit
        // right next to the adjacent year and overlap. The line still
        // passes through them and the tooltip still identifies them as
        // "Projected Dec YYYY".
        if (d.isEOY) return;
        if (d.yearLabel === 'Today') {
            result.push(d.yearLabel);
            lastKeptIdx = i;
            return;
        }
        // For regular years, include first, last, and every Nth
        const ri = regularYears.indexOf(d);
        const isForced = ri === 0 || ri === count - 1;
        if (!isForced) {
            if (d.year % step !== 0) return;
            // Collision guard: when thinning, skip a step tick that would sit
            // directly beside the last kept tick or the forced last tick.
            if (step > 1 && (i - lastKeptIdx <= 1 || lastRegularIdx - i <= 1)) return;
        }
        result.push(d.yearLabel);
        lastKeptIdx = i;
    });
    return result;
}

export const OverviewTab = React.memo(({ simulationData }: { simulationData: SimulationYear[] }) => {
    const { assumptions } = useAssumptions();
    const { resolve } = useChartTheme();
    const forceExact = assumptions.display?.useCompactCurrency === false;
    const { containerRef, containerWidth, isMeasured, isNarrow } = useContainerWidth();

    // 1. Determine Min/Max Years from Data (or defaults if empty)
    const minYear = simulationData.length > 0 ? simulationData[0].year : new Date().getFullYear();
    const maxYear = simulationData.length > 0 ? simulationData[simulationData.length - 1].year : minYear + 10;

    // 2. Range Slider state (defaults to the full range, capped at +32 years).
    const { activeRange, setRange } = useTimelineRange(minYear, maxYear, containerRef);

    // 3. Filter Data based on Slider
    const filteredData = useMemo(() => {
        return simulationData.filter(d => d.year >= activeRange[0] && d.year <= activeRange[1]);
    }, [simulationData, activeRange]);

    // Detect if the simulation includes the "Today" + "EOY" pair
    const hasEOYPoint = useMemo(() => filteredData.some(d => d.isEndOfYearProjection), [filteredData]);
    const baselineYear = useMemo(() => filteredData.find(d => !d.isEndOfYearProjection)?.year, [filteredData]);

    // 4. Calculate Chart Data from Filtered Data
    const rawData = useMemo(() => {
        return filteredData.map(year => {
            const buckets = computeOverviewBuckets(year.accounts, year.expenses);

            const yearLabel = year.isEndOfYearProjection
                ? `Dec ${year.year}`
                : (hasEOYPoint && year.year === baselineYear)
                    ? 'Today'
                    : String(year.year);

            return {
                year: year.year,
                yearLabel,
                isEOY: !!year.isEndOfYearProjection,
                ...buckets,
            };
        });
    }, [filteredData, hasEOYPoint, baselineYear]);

    const lineData = useMemo(() => {
        // 'Net Worth' (Vested) is plotted last so it draws on top of the gross bands as
        // the emphasis line the tooltip headline points at (#143).
        const keys = ['Invested', 'Saved', 'Property', 'Debt', 'Net Worth'] as const;
        return keys.map(id => ({
            id,
            data: rawData.map(d => ({
                ...d, // Embed full data for robust tooltip access
                x: d.yearLabel,
                y: d[id]
            }))
        }));
    }, [rawData]);

    // Calculate x-axis tick values to prevent label overlap
    const xTickValues = useMemo(() => computeXTickValues(rawData, containerWidth), [rawData, containerWidth]);

    // 5. Custom Tooltip
    const CustomTooltip = ({ slice }: OverviewSliceArg) => {
        if (!slice?.points?.length) return null;

        // Access data from the first point (all points share the same embedded data)
        const point = slice.points[0];
        const data = point.data;

        // Gross net worth = the plotted asset bands minus the debt band (Debt is
        // stored negative). Vested nets out the unvested employer match (#143) so
        // the headline matches the Dashboard net-worth card.
        const grossNetWorth = (data.Invested || 0) + (data.Saved || 0) + (data.Property || 0) + (data.Debt || 0);
        const unvested = data.Unvested || 0;
        const vestedNetWorth = grossNetWorth - unvested;

        return (
            <ChartTooltipPortal>
            <div className="bg-surface-overlay p-3 rounded border border-border-default shadow-xl text-xs min-w-37.5">
                <div className="font-bold text-white mb-2 pb-1 border-b border-border-strong">
                    {data.yearLabel === 'Today' ? `Today (${data.year})` : data.isEOY ? `Projected Dec ${data.year}` : `Year: ${data.year}`}
                </div>
                <div className="flex flex-col gap-1">
                    <div className="flex justify-between gap-4">
                        <span className="text-content-muted">Invested:</span>
                        <span className="text-positive font-mono">{formatCompactCurrency(data.Invested, { forceExact })}</span>
                    </div>
                    <div className="flex justify-between gap-4">
                        <span className="text-content-muted">Saved:</span>
                        <span className="text-info font-mono">{formatCompactCurrency(data.Saved, { forceExact })}</span>
                    </div>
                    <div className="flex justify-between gap-4">
                        <span className="text-content-muted">Property:</span>
                        <span className="text-warning font-mono">{formatCompactCurrency(data.Property, { forceExact })}</span>
                    </div>
                    <div className="flex justify-between gap-4">
                        <span className="text-content-muted">Debt:</span>
                        <span className="text-negative font-mono">{formatCompactCurrency(data.Debt, { forceExact })}</span>
                    </div>

                    {unvested > 0 && (
                        <div className="flex justify-between gap-4">
                            <span className="text-content-muted">Unvested:</span>
                            <span className="text-warning font-mono">{formatCompactCurrency(unvested, { forceExact })}</span>
                        </div>
                    )}

                    <div className="border-t border-border-strong my-1"></div>

                    <div className="flex justify-between gap-4">
                        <span className="text-white font-bold">Net Worth:</span>
                        <span className={`font-mono font-bold ${vestedNetWorth >= 0 ? 'text-positive' : 'text-negative'}`}>
                            {formatCompactCurrency(vestedNetWorth, { forceExact })}
                        </span>
                    </div>

                    {unvested > 0 && (
                        <div className="flex justify-between gap-4">
                            <span className="text-content-muted">Gross Net Worth:</span>
                            <span className="text-content-muted font-mono">{formatCompactCurrency(grossNetWorth, { forceExact })}</span>
                        </div>
                    )}
                </div>
            </div>
            </ChartTooltipPortal>
        );
    };

    // Check for earnings test scenario (use first year in filtered data)
    const earningsTestCheck = checkEarningsTest(
        filteredData[0],
        getBirthYear(assumptions.milestones)
    );

    // Check for strategy warnings in simulation data
    const strategyWarnings = useMemo(() => {
        const warnings: Array<{ year: number; warning: string }> = [];
        simulationData.forEach(year => {
            if (year.strategyAdjustment?.warning) {
                warnings.push({
                    year: year.year,
                    warning: year.strategyAdjustment.warning
                });
            }
        });
        return warnings;
    }, [simulationData]);

    // Count strategy-adjustment categories for summary
    const gkTriggerCount = useMemo(() => {
        let capitalPreservation = 0;
        let prosperity = 0;
        let budgetCap = 0;
        simulationData.forEach(year => {
            const trig = year.strategyAdjustment?.guardrailTriggered;
            if (trig === 'capital-preservation') capitalPreservation++;
            else if (trig === 'prosperity') prosperity++;
            else if (year.strategyAdjustment) budgetCap++;
        });
        return { capitalPreservation, prosperity, budgetCap };
    }, [simulationData]);

    // Build vertical markers for years where the withdrawal strategy adjusted spending.
    // Captures: GK capital-preservation cuts (red), prosperity boosts (green),
    // and budget-cap trims (amber) for any Fixed Real / Percentage / GK strategy.
    const gkMarkers = useMemo(() => {
        return filteredData
            .filter(y => y.strategyAdjustment !== undefined)
            .map(y => {
                const trig = y.strategyAdjustment?.guardrailTriggered;
                const stroke =
                    trig === 'capital-preservation' ? 'var(--c-negative-soft)' :
                    trig === 'prosperity' ? 'var(--c-positive-soft)' :
                    'var(--c-warning-soft)';
                // Must match the yearLabel rawData assigns, since the chart's
                // xScale is a point scale keyed on those strings — a numeric
                // year here would resolve to undefined and the marker would
                // render at translate(undefined, 0).
                const valueLabel = y.isEndOfYearProjection
                    ? `Dec ${y.year}`
                    : (hasEOYPoint && y.year === baselineYear)
                        ? 'Today'
                        : String(y.year);
                return {
                    axis: 'x' as const,
                    value: valueLabel,
                    lineStyle: {
                        stroke,
                        strokeWidth: 2,
                        strokeDasharray: '4 3',
                        strokeOpacity: 0.85,
                    },
                };
            });
    }, [filteredData, hasEOYPoint, baselineYear]);

    // Check for uncovered deficit (expenses exceed all available income + withdrawals)
    const deficitInfo = useMemo(() => {
        let firstYear: number | null = null;
        let maxAmount = 0;
        for (const year of simulationData) {
            const deficitAcc = year.accounts.find(acc => acc instanceof DeficitDebtAccount);
            if (deficitAcc) {
                if (!firstYear) firstYear = year.year;
                maxAmount = Math.max(maxAmount, deficitAcc.amount);
            }
        }
        return firstYear ? { firstYear, maxAmount } : null;
    }, [simulationData]);

    // Check if user qualifies for SS but hasn't set up SS income
    const missingSocialSecurity = useMemo(() => {
        if (!assumptions.income?.qualifiesForSocialSecurity) return false;

        // Check if any year has a Social Security income of any kind — Current
        // (already collecting), legacy base, or Future — not just Future. Using
        // the type-specific check showed a false "add a Future SS income"
        // banner to users already collecting via a Current/base SS income.
        const hasSSIncome = simulationData.some(year =>
            year.incomes.some(inc => isSocialSecurity(inc))
        );

        return !hasSSIncome;
    }, [assumptions.income?.qualifiesForSocialSecurity, simulationData]);

    return (
        <div className="flex flex-col w-full h-full gap-4">
            {/* Header: Range Slider Control */}
            <div className="px-1 pt-2 flex justify-end">
                <div className="w-full">
                    <RangeSlider
                        label="Timeline"
                        min={minYear}
                        max={maxYear}
                        value={activeRange}
                        onChange={(val) => setRange(val as [number, number])}
                    />
                </div>
            </div>

            {/* Missing Social Security Warning */}
            {missingSocialSecurity && (
                <AlertBanner severity="info" title="Social Security Not Configured">
                    <div className="text-sm">
                        <p>
                            You've indicated you qualify for Social Security, but no Social Security income has been added.
                            Add a "Future Social Security" income in the Income tab to include projected benefits in your plan.
                        </p>
                        <p className="text-content-muted text-xs mt-2">
                            If you don't expect to receive Social Security benefits, turn off "Qualifies for Social Security" in the Assumptions tab.
                        </p>
                    </div>
                </AlertBanner>
            )}

            {/* Earnings Test Warning */}
            {earningsTestCheck.applies && (
                <AlertBanner severity="warning" title="Social Security Benefits Reduced While Working">
                    <div className="text-sm space-y-1">
                        <p>
                            You're claiming Social Security at age {earningsTestCheck.claimingAge} and continuing to work
                            (earning ${earningsTestCheck.earnedIncome?.toLocaleString()}/year).
                            Your benefits are being reduced until you reach Full Retirement Age ({earningsTestCheck.fra}).
                        </p>
                        <p className="text-content-muted text-xs mt-2">
                            <strong>Note:</strong> This simulation uses a simplified earnings test calculation.
                            Withheld benefits are actually recalculated by SSA and added back to your monthly benefit
                            at Full Retirement Age, but that adjustment is not yet implemented in this tool.
                        </p>
                    </div>
                </AlertBanner>
            )}

            {/* Strategy Warning Banner */}
            {strategyWarnings.length > 0 && (
                <AlertBanner severity="warning" title="Withdrawal Strategy Warning">
                    <div className="text-sm space-y-2">
                        <p>
                            In <span className="text-warning-bright font-semibold">{strategyWarnings.length} year(s)</span> of your simulation,
                            your spending exceeds the strategy budget and cannot be fully covered by cutting discretionary expenses.
                        </p>
                        <div className="text-content-muted text-xs space-y-1">
                            <p><strong>Consider:</strong></p>
                            <ul className="list-disc list-inside pl-2">
                                <li>Marking more expenses as discretionary</li>
                                <li>Reducing fixed expenses</li>
                                <li>Increasing your withdrawal rate</li>
                            </ul>
                        </div>
                    </div>
                </AlertBanner>
            )}

            {/* Strategy adjustment summary (any strategy that trimmed/boosted spending) */}
            {(gkTriggerCount.capitalPreservation > 0 || gkTriggerCount.prosperity > 0 || gkTriggerCount.budgetCap > 0) && (
                <AlertBanner severity="success" size="sm">
                    <div className="flex items-center gap-3 flex-wrap">
                        <span className="font-medium">Spending Adjustments:</span>
                        {gkTriggerCount.capitalPreservation > 0 && (
                            <span className="text-negative-bright inline-flex items-center gap-1">
                                <span className="inline-block w-3 border-t-2 border-dashed border-negative" />
                                {gkTriggerCount.capitalPreservation} GK cut(s)
                            </span>
                        )}
                        {gkTriggerCount.prosperity > 0 && (
                            <span className="text-positive-bright inline-flex items-center gap-1">
                                <span className="inline-block w-3 border-t-2 border-dashed border-positive" />
                                {gkTriggerCount.prosperity} GK boost(s)
                            </span>
                        )}
                        {gkTriggerCount.budgetCap > 0 && (
                            <span className="text-warning-bright inline-flex items-center gap-1">
                                <span className="inline-block w-3 border-t-2 border-dashed border-warning" />
                                {gkTriggerCount.budgetCap} budget cap(s)
                            </span>
                        )}
                        <span className="text-content-muted text-xs">— marked on chart</span>
                    </div>
                </AlertBanner>
            )}

            {/* Deficit Warning */}
            {deficitInfo && (
                <AlertBanner severity="error" title="Plan Has Uncovered Deficit">
                    <div className="text-sm space-y-2">
                        <p>
                            Starting in <span className="text-negative-bright font-semibold">{deficitInfo.firstYear}</span>,
                            your expenses exceed all available income and withdrawable savings,
                            reaching up to {formatCompactCurrency(deficitInfo.maxAmount, { forceExact })} in uncovered shortfall.
                        </p>
                        <div className="text-content-muted text-xs space-y-1">
                            <p><strong>Consider adjusting:</strong></p>
                            <ul className="list-disc list-inside pl-2">
                                <li>Increasing retirement age or savings rate</li>
                                <li>Reducing planned expenses</li>
                                <li>Lowering the withdrawal rate</li>
                                <li>Adding additional income sources</li>
                            </ul>
                        </div>
                    </div>
                </AlertBanner>
            )}

            {/* Chart Area */}
            <div ref={containerRef} className="h-100 w-full text-white">
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
                    margin={{ top: 40, right: 30, bottom: 50, left: 90 }}
                    xScale={{ type: 'point' }}
                    yScale={{
                        type: 'linear',
                        min: 'auto',
                        max: 'auto',
                        stacked: false,
                        reverse: false
                    }}
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
                        legend: undefined,
                        legendOffset: -40,
                        legendPosition: 'middle',
                        format: " >-$,.0f",
                    }}
                    colors={({ id }) => {
                        if (id === 'Net Worth') return resolve('var(--c-content-bright)');
                        if (id === 'Debt') return resolve('var(--c-negative-soft)');
                        if (id === 'Invested') return resolve('var(--color-chart-money)');
                        if (id === 'Saved') return resolve('var(--c-accent-soft)');
                        if (id === 'Property') return resolve('var(--c-warning-soft)');
                        return resolve('var(--c-content-subtle)');
                    }}
                    lineWidth={3}
                    enablePoints={false}
                    enableGridX={false}
                    enableArea={true}
                    areaOpacity={0.15}
                    useMesh={true}
                    enableSlices="x"
                    sliceTooltip={CustomTooltip}
                    markers={gkMarkers}
                    legends={[{
                        anchor: 'top',
                        direction: 'row',
                        translateY: -34,
                        itemsSpacing: 6,
                        itemWidth: 78,
                        itemHeight: 14,
                        symbolSize: 9,
                        symbolShape: 'circle',
                        itemTextColor: 'var(--c-content-muted)',
                    }]}
                    layers={['grid', 'axes', 'areas', 'lines', 'crosshair', 'markers', 'slices', 'points', 'mesh', 'legends']}
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

            <div className="mt-4">
                <ProjectionMemoryChart yearRange={activeRange} />
            </div>
        </div>
    );
});