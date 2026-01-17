import React, { useState, useMemo, useRef, useEffect } from 'react';
import { ResponsiveLine } from '@nivo/line';
import { SimulationYear } from '../../../components/Objects/Assumptions/SimulationEngine';
import { SavedAccount, InvestedAccount, PropertyAccount, DebtAccount } from '../../../components/Objects/Accounts/models';
import { formatCompactCurrency } from './FutureUtils';
import { LoanExpense, MortgageExpense } from '../../../components/Objects/Expense/models';
import { RangeSlider } from '../../../components/Layout/InputFields/RangeSlider';
import { AlertBanner } from '../../../components/Layout/AlertBanner';
import { getFRA } from '../../../data/SocialSecurityData';
import { FutureSocialSecurityIncome } from '../../../components/Objects/Income/models';
import { getEarnedIncome } from '../../../components/Objects/Taxes/TaxService';
import { useAssumptions } from '../../../components/Objects/Assumptions/AssumptionsContext';

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
            // Include debt from expenses (loans, mortgages)
            year.expenses.forEach(exp => {
                if (exp instanceof LoanExpense) {
                    debt += (exp.amount);
                } else if (exp instanceof MortgageExpense) {
                    debt += (exp.loan_balance);
                }
            });
            // Include debt from accounts (DebtAccount, DeficitDebtAccount)
            year.accounts.forEach(acc => {
                if (acc instanceof DebtAccount) {
                    debt += acc.amount;
                }
            });

            return {
                year: year.year,
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
                x: d.year,
                y: d[id]
            }))
        }));
    }, [rawData]);

    // Calculate x-axis tick values to prevent label overlap
    const xTickValues = useMemo(() => {
        if (rawData.length === 0) return undefined;

        const years = rawData.map(d => d.year);
        const range = years.length;

        // Determine step size based on range (aim for ~8-10 ticks max)
        let step = 1;
        if (range > 41) step = 2;
        else if (range > 25) step = 1;

        // Filter years at regular intervals
        return years.filter((year, i) => {
            // Always include first and last
            if (i === 0 || i === years.length - 1) return true;
            // Include years at step intervals
            return (year - years[0]) % step === 0;
        });
    }, [rawData]);

    // 5. Custom Tooltip
    const CustomTooltip = ({ slice }: any) => {
        if (!slice?.points?.length) return null;
        
        // Access data from the first point (all points share the same embedded data)
        const point = slice.points[0];
        const data = point.data; 

        const totalNetWorth = (data.Invested || 0) + (data.Saved || 0) + (data.Property || 0) + (data.Debt || 0);

        return (
            <div className="bg-gray-800 p-3 rounded border border-gray-700 shadow-xl text-xs min-w-37.5">
                <div className="font-bold text-white mb-2 pb-1 border-b border-gray-600">
                    Year: {data.year}
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
        );
    };

    // Check for earnings test scenario (use first year in filtered data)
    const earningsTestCheck = checkEarningsTest(
        filteredData[0],
        assumptions.demographics.birthYear
    );

    // Check for Guyton-Klinger warnings in simulation data
    const gkWarnings = useMemo(() => {
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

    // Count GK guardrail triggers for summary
    const gkTriggerCount = useMemo(() => {
        let capitalPreservation = 0;
        let prosperity = 0;
        simulationData.forEach(year => {
            if (year.strategyAdjustment?.guardrailTriggered === 'capital-preservation') {
                capitalPreservation++;
            } else if (year.strategyAdjustment?.guardrailTriggered === 'prosperity') {
                prosperity++;
            }
        });
        return { capitalPreservation, prosperity };
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

            {/* Guyton-Klinger Warning Banner */}
            {gkWarnings.length > 0 && (
                <AlertBanner severity="warning" title="Guyton-Klinger Strategy Warning">
                    <div className="text-sm space-y-2">
                        <p>
                            In <span className="text-amber-300 font-semibold">{gkWarnings.length} year(s)</span> of your simulation,
                            the Capital Preservation rule would require cutting more than your discretionary expenses allow.
                        </p>
                        <div className="text-gray-400 text-xs space-y-1">
                            <p><strong>Consider:</strong></p>
                            <ul className="list-disc list-inside pl-2">
                                <li>Marking more expenses as discretionary</li>
                                <li>Choosing a different withdrawal strategy</li>
                                <li>Lowering your withdrawal rate</li>
                            </ul>
                        </div>
                    </div>
                </AlertBanner>
            )}

            {/* Guyton-Klinger Guardrail Summary (show when strategy is GK and triggers happened) */}
            {assumptions.investments?.withdrawalStrategy === 'Guyton Klinger' &&
             (gkTriggerCount.capitalPreservation > 0 || gkTriggerCount.prosperity > 0) && (
                <AlertBanner severity="success" size="sm">
                    <div className="flex items-center gap-2">
                        <span className="font-medium">Guyton-Klinger Adjustments:</span>
                        {gkTriggerCount.capitalPreservation > 0 && (
                            <span className="text-red-300">
                                {gkTriggerCount.capitalPreservation} expense cut(s)
                            </span>
                        )}
                        {gkTriggerCount.capitalPreservation > 0 && gkTriggerCount.prosperity > 0 && (
                            <span className="text-gray-400">|</span>
                        )}
                        {gkTriggerCount.prosperity > 0 && (
                            <span className="text-green-300">
                                {gkTriggerCount.prosperity} expense increase(s)
                            </span>
                        )}
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
                    theme={{
                        "background": "transparent",
                        "text": { "fontSize": 12, "fill": "#9ca3af" },
                        "axis": { 
                            "legend": { "text": { "fill": "#9ca3af" } }, 
                            "ticks": { "text": { "fill": "#9ca3af" } } 
                        },
                        "grid": { "line": { "stroke": "#374151", "strokeWidth": 1, "strokeDasharray": "4 4" } },
                        "crosshair": { "line": { "stroke": "#9ca3af", "strokeWidth": 1, "strokeOpacity": 0.35 } }
                    }}
                />
                )}
            </div>
        </div>
    );
});