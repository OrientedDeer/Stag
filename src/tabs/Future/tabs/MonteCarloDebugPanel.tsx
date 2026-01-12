import React, { useState, useMemo } from 'react';
import { MonteCarloSummary, MonteCarloConfig, ScenarioResult } from '../../../services/MonteCarloTypes';
import { calculateNetWorth, formatCurrency } from './FutureUtils';
import { calculateMean, calculateStdDev } from '../../../services/RandomGenerator';

interface MonteCarloDebugPanelProps {
    summary: MonteCarloSummary;
    config: MonteCarloConfig;
}

/**
 * Collapsible section component
 */
const DebugSection = ({
    title,
    children,
    defaultOpen = false,
}: {
    title: string;
    children: React.ReactNode;
    defaultOpen?: boolean;
}) => {
    const [isOpen, setIsOpen] = useState(defaultOpen);

    return (
        <div className="border border-gray-700 rounded-lg overflow-hidden">
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="w-full px-4 py-2 bg-gray-800 text-left text-sm font-medium text-gray-300
                         hover:bg-gray-750 flex justify-between items-center"
            >
                <span>{title}</span>
                <span className="text-gray-500">{isOpen ? '▼' : '▶'}</span>
            </button>
            {isOpen && (
                <div className="p-4 bg-gray-900/50 text-xs font-mono overflow-auto">
                    {children}
                </div>
            )}
        </div>
    );
};

/**
 * Format a number for display
 */
const formatNum = (n: number, decimals = 2) => {
    if (Math.abs(n) >= 1000000) {
        return `${(n / 1000000).toFixed(decimals)}M`;
    }
    if (Math.abs(n) >= 1000) {
        return `${(n / 1000).toFixed(decimals)}K`;
    }
    return n.toFixed(decimals);
};

/**
 * Scenario timeline table
 */
const ScenarioTimeline = ({ scenario, label }: { scenario: ScenarioResult; label: string }) => {
    const [expanded, setExpanded] = useState(false);
    const displayYears = expanded ? scenario.timeline : scenario.timeline.slice(0, 10);

    return (
        <div className="mb-4">
            <div className="text-gray-400 mb-2 font-semibold">{label} (ID: {scenario.scenarioId})</div>
            <div className="grid grid-cols-2 gap-4 mb-2 text-gray-500">
                <div>Final Net Worth: <span className={scenario.finalNetWorth >= 0 ? 'text-green-400' : 'text-red-400'}>
                    {formatCurrency(scenario.finalNetWorth)}
                </span></div>
                <div>Success: <span className={scenario.success ? 'text-green-400' : 'text-red-400'}>
                    {scenario.success ? 'Yes' : `No (depleted ${scenario.yearOfDepletion})`}
                </span></div>
            </div>

            <table className="w-full text-xs">
                <thead>
                    <tr className="text-gray-500 border-b border-gray-700">
                        <th className="text-left py-1 px-2">Year</th>
                        <th className="text-right py-1 px-2">Return %</th>
                        <th className="text-right py-1 px-2">Net Worth</th>
                        <th className="text-right py-1 px-2">Income</th>
                        <th className="text-right py-1 px-2">Expenses</th>
                        <th className="text-right py-1 px-2">Withdrawals</th>
                    </tr>
                </thead>
                <tbody>
                    {displayYears.map((year, idx) => {
                        const netWorth = calculateNetWorth(year.accounts);
                        const returnPct = scenario.yearlyReturns[idx] ?? 0;
                        return (
                            <tr key={year.year} className="border-b border-gray-800 hover:bg-gray-800/50">
                                <td className="py-1 px-2 text-gray-300">{year.year}</td>
                                <td className={`py-1 px-2 text-right ${returnPct >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                    {returnPct.toFixed(1)}%
                                </td>
                                <td className={`py-1 px-2 text-right ${netWorth >= 0 ? 'text-blue-400' : 'text-red-400'}`}>
                                    {formatNum(netWorth)}
                                </td>
                                <td className="py-1 px-2 text-right text-gray-400">
                                    {formatNum(year.cashflow.totalIncome)}
                                </td>
                                <td className="py-1 px-2 text-right text-gray-400">
                                    {formatNum(year.cashflow.totalExpense)}
                                </td>
                                <td className="py-1 px-2 text-right text-orange-400">
                                    {year.cashflow.withdrawals > 0 ? formatNum(year.cashflow.withdrawals) : '-'}
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>

            {scenario.timeline.length > 10 && (
                <button
                    onClick={() => setExpanded(!expanded)}
                    className="mt-2 text-blue-400 hover:text-blue-300 text-xs"
                >
                    {expanded ? 'Show less' : `Show all ${scenario.timeline.length} years`}
                </button>
            )}
        </div>
    );
};

/**
 * Return distribution analysis
 */
const ReturnDistributionAnalysis = ({ scenario, label }: { scenario: ScenarioResult; label: string }) => {
    const stats = useMemo(() => {
        const returns = scenario.yearlyReturns;
        if (returns.length === 0) return null;

        const mean = calculateMean(returns);
        const stdDev = calculateStdDev(returns);
        const sorted = [...returns].sort((a, b) => a - b);
        const min = sorted[0];
        const max = sorted[sorted.length - 1];
        const median = sorted[Math.floor(sorted.length / 2)];

        // Count positive vs negative years
        const positiveYears = returns.filter(r => r >= 0).length;
        const negativeYears = returns.filter(r => r < 0).length;

        // Count extreme years (> 2 std dev)
        const extremePositive = returns.filter(r => r > mean + 2 * stdDev).length;
        const extremeNegative = returns.filter(r => r < mean - 2 * stdDev).length;

        return {
            mean,
            stdDev,
            min,
            max,
            median,
            positiveYears,
            negativeYears,
            extremePositive,
            extremeNegative,
            totalYears: returns.length,
        };
    }, [scenario.yearlyReturns]);

    if (!stats) return null;

    return (
        <div className="mb-3">
            <div className="text-gray-400 font-semibold mb-1">{label}</div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-gray-300">
                <div>Mean: <span className="text-blue-400">{stats.mean.toFixed(2)}%</span></div>
                <div>Std Dev: <span className="text-purple-400">{stats.stdDev.toFixed(2)}%</span></div>
                <div>Min: <span className="text-red-400">{stats.min.toFixed(2)}%</span></div>
                <div>Max: <span className="text-green-400">{stats.max.toFixed(2)}%</span></div>
                <div>Median: <span className="text-yellow-400">{stats.median.toFixed(2)}%</span></div>
                <div>Positive Years: <span className="text-green-400">{stats.positiveYears}/{stats.totalYears}</span></div>
                <div>Negative Years: <span className="text-red-400">{stats.negativeYears}/{stats.totalYears}</span></div>
                <div>Extreme Years: <span className="text-orange-400">{stats.extremePositive + stats.extremeNegative}</span></div>
            </div>
        </div>
    );
};

/**
 * Main debug panel component
 */
export const MonteCarloDebugPanel = React.memo(({ summary, config }: MonteCarloDebugPanelProps) => {
    const [isVisible, setIsVisible] = useState(false);

    // Calculate aggregate return statistics across all representative scenarios
    const aggregateStats = useMemo(() => {
        const allReturns = [
            ...summary.worstCase.yearlyReturns,
            ...summary.medianCase.yearlyReturns,
            ...summary.bestCase.yearlyReturns,
        ];

        if (allReturns.length === 0) return null;

        return {
            mean: calculateMean(allReturns),
            stdDev: calculateStdDev(allReturns),
        };
    }, [summary]);

    return (
        <div className="mt-4">
            <button
                onClick={() => setIsVisible(!isVisible)}
                className="flex items-center gap-2 text-gray-500 hover:text-gray-300 text-sm transition-colors"
            >
                <span className="text-xs">{isVisible ? '▼' : '▶'}</span>
                <span>Debug Panel</span>
                {isVisible && <span className="text-xs text-gray-600">(for troubleshooting)</span>}
            </button>

            {isVisible && (
                <div className="mt-4 space-y-3 bg-gray-900 border border-gray-700 rounded-xl p-4">
                    <div className="text-yellow-500 text-xs mb-4 flex items-center gap-2">
                        <span>⚠️</span>
                        <span>Debug information - for development and troubleshooting</span>
                    </div>

                    {/* Configuration Used */}
                    <DebugSection title="Configuration" defaultOpen={true}>
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-gray-300">
                            <div>Scenarios: <span className="text-blue-400">{config.numScenarios}</span></div>
                            <div>Seed: <span className="text-purple-400">{config.seed}</span></div>
                            <div>Enabled: <span className="text-gray-400">{config.enabled ? 'Yes' : 'No'}</span></div>
                            <div>Target Mean: <span className="text-green-400">{config.returnMean}%</span></div>
                            <div>Target StdDev: <span className="text-orange-400">{config.returnStdDev}%</span></div>
                            {aggregateStats && (
                                <>
                                    <div>Actual Mean (sample): <span className="text-green-400">{aggregateStats.mean.toFixed(2)}%</span></div>
                                    <div>Actual StdDev (sample): <span className="text-orange-400">{aggregateStats.stdDev.toFixed(2)}%</span></div>
                                </>
                            )}
                        </div>
                    </DebugSection>

                    {/* Summary Statistics */}
                    <DebugSection title="Summary Statistics" defaultOpen={true}>
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-gray-300">
                            <div>Total Scenarios: <span className="text-blue-400">{summary.totalScenarios}</span></div>
                            <div>Successful: <span className="text-green-400">{summary.successfulScenarios}</span></div>
                            <div>Failed: <span className="text-red-400">{summary.totalScenarios - summary.successfulScenarios}</span></div>
                            <div>Success Rate: <span className="text-yellow-400">{summary.successRate.toFixed(2)}%</span></div>
                            <div>Avg Final NW: <span className="text-blue-400">{formatCurrency(summary.averageFinalNetWorth)}</span></div>
                            <div>Seed Used: <span className="text-purple-400">{summary.seed}</span></div>
                        </div>

                        <div className="mt-4 grid grid-cols-3 gap-4">
                            <div className="text-center p-2 bg-red-900/20 rounded border border-red-800">
                                <div className="text-red-400 text-xs uppercase">Worst Case</div>
                                <div className="text-white font-bold">{formatCurrency(summary.worstCase.finalNetWorth)}</div>
                                <div className="text-gray-500 text-xs">ID: {summary.worstCase.scenarioId}</div>
                            </div>
                            <div className="text-center p-2 bg-gray-800 rounded border border-gray-700">
                                <div className="text-gray-400 text-xs uppercase">Median Case</div>
                                <div className="text-white font-bold">{formatCurrency(summary.medianCase.finalNetWorth)}</div>
                                <div className="text-gray-500 text-xs">ID: {summary.medianCase.scenarioId}</div>
                            </div>
                            <div className="text-center p-2 bg-green-900/20 rounded border border-green-800">
                                <div className="text-green-400 text-xs uppercase">Best Case</div>
                                <div className="text-white font-bold">{formatCurrency(summary.bestCase.finalNetWorth)}</div>
                                <div className="text-gray-500 text-xs">ID: {summary.bestCase.scenarioId}</div>
                            </div>
                        </div>
                    </DebugSection>

                    {/* Return Distribution */}
                    <DebugSection title="Return Distribution Analysis">
                        <ReturnDistributionAnalysis scenario={summary.worstCase} label="Worst Case Returns" />
                        <ReturnDistributionAnalysis scenario={summary.medianCase} label="Median Case Returns" />
                        <ReturnDistributionAnalysis scenario={summary.bestCase} label="Best Case Returns" />
                    </DebugSection>

                    {/* Percentile Data */}
                    <DebugSection title="Percentile Data (First & Last 5 Years)">
                        <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                                <thead>
                                    <tr className="text-gray-500 border-b border-gray-700">
                                        <th className="text-left py-1 px-2">Year</th>
                                        <th className="text-right py-1 px-2">P10</th>
                                        <th className="text-right py-1 px-2">P25</th>
                                        <th className="text-right py-1 px-2">P50 (Median)</th>
                                        <th className="text-right py-1 px-2">P75</th>
                                        <th className="text-right py-1 px-2">P90</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {summary.percentiles.p50.slice(0, 5).map((p50, idx) => (
                                        <tr key={p50.year} className="border-b border-gray-800">
                                            <td className="py-1 px-2 text-gray-300">{p50.year}</td>
                                            <td className="py-1 px-2 text-right text-red-400">
                                                {formatNum(summary.percentiles.p10[idx]?.netWorth ?? 0)}
                                            </td>
                                            <td className="py-1 px-2 text-right text-orange-400">
                                                {formatNum(summary.percentiles.p25[idx]?.netWorth ?? 0)}
                                            </td>
                                            <td className="py-1 px-2 text-right text-green-400">
                                                {formatNum(p50.netWorth)}
                                            </td>
                                            <td className="py-1 px-2 text-right text-blue-400">
                                                {formatNum(summary.percentiles.p75[idx]?.netWorth ?? 0)}
                                            </td>
                                            <td className="py-1 px-2 text-right text-purple-400">
                                                {formatNum(summary.percentiles.p90[idx]?.netWorth ?? 0)}
                                            </td>
                                        </tr>
                                    ))}
                                    {summary.percentiles.p50.length > 10 && (
                                        <tr>
                                            <td colSpan={6} className="py-1 px-2 text-center text-gray-600">
                                                ... {summary.percentiles.p50.length - 10} more years ...
                                            </td>
                                        </tr>
                                    )}
                                    {summary.percentiles.p50.slice(-5).map((p50, idx) => {
                                        const actualIdx = summary.percentiles.p50.length - 5 + idx;
                                        return (
                                            <tr key={p50.year} className="border-b border-gray-800">
                                                <td className="py-1 px-2 text-gray-300">{p50.year}</td>
                                                <td className="py-1 px-2 text-right text-red-400">
                                                    {formatNum(summary.percentiles.p10[actualIdx]?.netWorth ?? 0)}
                                                </td>
                                                <td className="py-1 px-2 text-right text-orange-400">
                                                    {formatNum(summary.percentiles.p25[actualIdx]?.netWorth ?? 0)}
                                                </td>
                                                <td className="py-1 px-2 text-right text-green-400">
                                                    {formatNum(p50.netWorth)}
                                                </td>
                                                <td className="py-1 px-2 text-right text-blue-400">
                                                    {formatNum(summary.percentiles.p75[actualIdx]?.netWorth ?? 0)}
                                                </td>
                                                <td className="py-1 px-2 text-right text-purple-400">
                                                    {formatNum(summary.percentiles.p90[actualIdx]?.netWorth ?? 0)}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </DebugSection>

                    {/* Scenario Timelines */}
                    <DebugSection title="Worst Case Timeline">
                        <ScenarioTimeline scenario={summary.worstCase} label="Worst Case" />
                    </DebugSection>

                    <DebugSection title="Median Case Timeline">
                        <ScenarioTimeline scenario={summary.medianCase} label="Median Case" />
                    </DebugSection>

                    <DebugSection title="Best Case Timeline">
                        <ScenarioTimeline scenario={summary.bestCase} label="Best Case" />
                    </DebugSection>

                    {/* Raw JSON Export */}
                    <DebugSection title="Export Raw Data">
                        <div className="space-y-2">
                            <p className="text-gray-500">Click to copy raw JSON data for analysis:</p>
                            <div className="flex gap-2 flex-wrap">
                                <button
                                    onClick={() => {
                                        navigator.clipboard.writeText(JSON.stringify(config, null, 2));
                                    }}
                                    className="px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded text-gray-300 text-xs"
                                >
                                    Copy Config
                                </button>
                                <button
                                    onClick={() => {
                                        const exportData = {
                                            successRate: summary.successRate,
                                            totalScenarios: summary.totalScenarios,
                                            successfulScenarios: summary.successfulScenarios,
                                            averageFinalNetWorth: summary.averageFinalNetWorth,
                                            seed: summary.seed,
                                            worstCase: {
                                                scenarioId: summary.worstCase.scenarioId,
                                                success: summary.worstCase.success,
                                                finalNetWorth: summary.worstCase.finalNetWorth,
                                                yearOfDepletion: summary.worstCase.yearOfDepletion,
                                                yearlyReturns: summary.worstCase.yearlyReturns,
                                            },
                                            medianCase: {
                                                scenarioId: summary.medianCase.scenarioId,
                                                success: summary.medianCase.success,
                                                finalNetWorth: summary.medianCase.finalNetWorth,
                                                yearlyReturns: summary.medianCase.yearlyReturns,
                                            },
                                            bestCase: {
                                                scenarioId: summary.bestCase.scenarioId,
                                                success: summary.bestCase.success,
                                                finalNetWorth: summary.bestCase.finalNetWorth,
                                                yearlyReturns: summary.bestCase.yearlyReturns,
                                            },
                                        };
                                        navigator.clipboard.writeText(JSON.stringify(exportData, null, 2));
                                    }}
                                    className="px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded text-gray-300 text-xs"
                                >
                                    Copy Summary (no timelines)
                                </button>
                                <button
                                    onClick={() => {
                                        navigator.clipboard.writeText(JSON.stringify(summary.percentiles, null, 2));
                                    }}
                                    className="px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded text-gray-300 text-xs"
                                >
                                    Copy Percentiles
                                </button>
                            </div>
                        </div>
                    </DebugSection>
                </div>
            )}
        </div>
    );
});
