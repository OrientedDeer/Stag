import React, { useState, useMemo, useRef, useEffect } from 'react';
import { ChartTooltipPortal } from '../../../components/Charts/ChartTooltipPortal';
import { ResponsiveLine } from '@nivo/line';
import { SimulationYear } from '../../../components/Objects/Assumptions/SimulationEngine';
import { SavedAccount, InvestedAccount, PropertyAccount, DebtAccount, DeficitDebtAccount } from '../../../components/Objects/Accounts/models';
import { formatCompactCurrency } from './FutureUtils';
import { MortgageExpense } from '../../../components/Objects/Expense/models';
import { RangeSlider } from '../../../components/Layout/InputFields/RangeSlider';
import { AlertBanner } from '../../../components/Layout/AlertBanner';
import { getFRA } from '../../../data/SocialSecurityData';
import { FutureSocialSecurityIncome } from '../../../components/Objects/Income/models';
import { getEarnedIncome } from '../../../components/Objects/Taxes/TaxService';
import { useAssumptions, getBirthYear } from '../../../components/Objects/Assumptions/AssumptionsContext';

const MIN_CHART_WIDTH = 300;

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

export const OverviewTab = React.memo(({ simulationData }: { simulationData: SimulationYear[] }) => {
    const { assumptions } = useAssumptions();
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

    // 1. Determine Min/Max Years from Data (or defaults if empty)
    const minYear = simulationData.length > 0 ? simulationData[0].year : new Date().getFullYear();
    const maxYear = simulationData.length > 0 ? simulationData[simulationData.length - 1].year : minYear + 10;

    // 2. State for Range Slider (Defaults to full range)
    const [range, setRange] = useState<[number, number] | null>(null);
    const activeRange = range ?? [minYear,  Math.min(maxYear, minYear + 32)];

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
            const invested = year.accounts
                .filter(acc => acc instanceof InvestedAccount)
                .reduce((sum, acc) => sum + (acc.amount), 0);

            const saved = year.accounts
                .filter(acc => acc instanceof SavedAccount)
                .reduce((sum, acc) => sum + (acc.amount), 0);

            const property = year.accounts
                .filter(acc => acc instanceof PropertyAccount)
                .reduce((sum, acc) => sum + (acc.amount), 0);

            let debt = 0;
            // Include mortgage debt from expenses (linked to PropertyAccount, not DebtAccount)
            year.expenses.forEach(exp => {
                if (exp instanceof MortgageExpense) {
                    debt += (exp.loan_balance);
                }
            });
            // Include debt from accounts (DebtAccount tracks loan balances, DeficitDebtAccount tracks uncovered deficits)
            // Note: LoanExpense is NOT counted here — DebtAccount already tracks the same linked balance
            year.accounts.forEach(acc => {
                if (acc instanceof DebtAccount) {
                    debt += acc.amount;
                }
            });

            const yearLabel = year.isEndOfYearProjection
                ? `Dec ${year.year}`
                : (hasEOYPoint && year.year === baselineYear)
                    ? 'Today'
                    : String(year.year);

            return {
                year: year.year,
                yearLabel,
                isEOY: !!year.isEndOfYearProjection,
                Invested: invested,
                Saved: saved,
                Property: property,
                Debt: -Math.abs(debt)
            };
        });
    }, [filteredData]);

    const lineData = useMemo(() => {
        const keys = ['Invested', 'Saved', 'Property', 'Debt'] as const;
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
    const xTickValues = useMemo(() => {
        if (rawData.length === 0) return undefined;

        // Always show Today and EOY labels; apply step filter to regular years
        const regularYears = rawData.filter(d => !d.isEOY && d.yearLabel !== 'Today');
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

        const result: string[] = [];
        rawData.forEach((d, i) => {
            if (d.yearLabel === 'Today' || d.isEOY) {
                result.push(d.yearLabel);
                return;
            }
            // For regular years, include first, last, and every Nth
            const ri = regularYears.indexOf(d);
            if (ri === 0 || ri === regularYears.length - 1 || d.year % step === 0) {
                result.push(d.yearLabel);
            }
        });
        return result;
    }, [rawData, containerWidth]);

    // 5. Custom Tooltip
    const CustomTooltip = ({ slice }: any) => {
        if (!slice?.points?.length) return null;

        // Access data from the first point (all points share the same embedded data)
        const point = slice.points[0];
        const data = point.data;

        const totalNetWorth = (data.Invested || 0) + (data.Saved || 0) + (data.Property || 0) + (data.Debt || 0);

        return (
            <ChartTooltipPortal>
            <div className="bg-gray-800 p-3 rounded border border-gray-700 shadow-xl text-xs min-w-37.5">
                <div className="font-bold text-white mb-2 pb-1 border-b border-gray-600">
                    {data.yearLabel === 'Today' ? `Today (${data.year})` : data.isEOY ? `Projected Dec ${data.year}` : `Year: ${data.year}`}
                </div>
                <div className="flex flex-col gap-1">
                    <div className="flex justify-between gap-4">
                        <span className="text-gray-400">Invested:</span>
                        <span className="text-emerald-400 font-mono">{formatCompactCurrency(data.Invested, { forceExact })}</span>
                    </div>
                    <div className="flex justify-between gap-4">
                        <span className="text-gray-400">Saved:</span>
                        <span className="text-blue-400 font-mono">{formatCompactCurrency(data.Saved, { forceExact })}</span>
                    </div>
                    <div className="flex justify-between gap-4">
                        <span className="text-gray-400">Property:</span>
                        <span className="text-amber-400 font-mono">{formatCompactCurrency(data.Property, { forceExact })}</span>
                    </div>
                    <div className="flex justify-between gap-4">
                        <span className="text-gray-400">Debt:</span>
                        <span className="text-red-400 font-mono">{formatCompactCurrency(data.Debt, { forceExact })}</span>
                    </div>
                    
                    <div className="border-t border-gray-600 my-1"></div>
                    
                    <div className="flex justify-between gap-4">
                        <span className="text-white font-bold">Net Worth:</span>
                        <span className={`font-mono font-bold ${totalNetWorth >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                            {formatCompactCurrency(totalNetWorth, { forceExact })}
                        </span>
                    </div>
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
                    trig === 'capital-preservation' ? '#ef4444' :
                    trig === 'prosperity' ? '#22c55e' :
                    '#f59e0b';
                return {
                    axis: 'x' as const,
                    value: y.year,
                    lineStyle: {
                        stroke,
                        strokeWidth: 2,
                        strokeDasharray: '4 3',
                        strokeOpacity: 0.85,
                    },
                };
            });
    }, [filteredData]);

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

        // Check if any year has FutureSocialSecurityIncome
        const hasSSIncome = simulationData.some(year =>
            year.incomes.some(inc => inc instanceof FutureSocialSecurityIncome)
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
                        <p className="text-gray-400 text-xs mt-2">
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
                        <p className="text-gray-400 text-xs mt-2">
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
                            In <span className="text-amber-300 font-semibold">{strategyWarnings.length} year(s)</span> of your simulation,
                            your spending exceeds the strategy budget and cannot be fully covered by cutting discretionary expenses.
                        </p>
                        <div className="text-gray-400 text-xs space-y-1">
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
                            <span className="text-red-300 inline-flex items-center gap-1">
                                <span className="inline-block w-3 border-t-2 border-dashed border-red-400" />
                                {gkTriggerCount.capitalPreservation} GK cut(s)
                            </span>
                        )}
                        {gkTriggerCount.prosperity > 0 && (
                            <span className="text-green-300 inline-flex items-center gap-1">
                                <span className="inline-block w-3 border-t-2 border-dashed border-green-400" />
                                {gkTriggerCount.prosperity} GK boost(s)
                            </span>
                        )}
                        {gkTriggerCount.budgetCap > 0 && (
                            <span className="text-amber-300 inline-flex items-center gap-1">
                                <span className="inline-block w-3 border-t-2 border-dashed border-amber-400" />
                                {gkTriggerCount.budgetCap} budget cap(s)
                            </span>
                        )}
                        <span className="text-gray-400 text-xs">— marked on chart</span>
                    </div>
                </AlertBanner>
            )}

            {/* Deficit Warning */}
            {deficitInfo && (
                <AlertBanner severity="error" title="Plan Has Uncovered Deficit">
                    <div className="text-sm space-y-2">
                        <p>
                            Starting in <span className="text-red-300 font-semibold">{deficitInfo.firstYear}</span>,
                            your expenses exceed all available income and withdrawable savings,
                            reaching up to {formatCompactCurrency(deficitInfo.maxAmount, { forceExact })} in uncovered shortfall.
                        </p>
                        <div className="text-gray-400 text-xs space-y-1">
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
                        <p className="text-gray-400 text-sm">Loading chart...</p>
                    </div>
                ) : isNarrow ? (
                    <div className="h-full flex items-center justify-center border-2 border-dashed border-gray-700 rounded-xl">
                        <p className="text-gray-400 text-sm text-center px-4">Expand window to view chart</p>
                    </div>
                ) : (
                <ResponsiveLine
                    data={lineData}
                    margin={{ top: 20, right: 30, bottom: 50, left: 90 }}
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
                        if (id === 'Debt') return '#ef4444';
                        if (id === 'Invested') return '#10b981';
                        if (id === 'Saved') return '#3b82f6';
                        if (id === 'Property') return '#f59e0b';
                        return '#888888';
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
                    layers={['grid', 'axes', 'areas', 'lines', 'crosshair', 'markers', 'slices', 'points', 'mesh', 'legends']}
                    theme={{
                        "background": "transparent",
                        "text": { "fontSize": 12, "fill": "#9ca3af" },
                        "axis": {
                            "legend": { "text": { "fill": "#9ca3af" } },
                            "ticks": { "text": { "fill": "#9ca3af" } }
                        },
                        "grid": { "line": { "stroke": "#374151", "strokeWidth": 1, "strokeDasharray": "4 4" } },
                        "crosshair": { "line": { "stroke": "#9ca3af", "strokeWidth": 1, "strokeOpacity": 0.35 } },
                        "tooltip": { "container": { "zIndex": 9999 } }
                    }}
                />
                )}
            </div>
        </div>
    );
});