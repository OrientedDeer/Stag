import React, { useMemo, useContext } from 'react';
import { FanChart } from '../../../components/Charts/FanChart';
import { useMonteCarlo } from '../../../components/Objects/Assumptions/MonteCarloContext';
import { AccountContext } from '../../../components/Objects/Accounts/AccountContext';
import { IncomeContext } from '../../../components/Objects/Income/IncomeContext';
import { ExpenseContext } from '../../../components/Objects/Expense/ExpenseContext';
import { useAssumptions } from '../../../components/Objects/Assumptions/AssumptionsContext';
import { TaxContext } from '../../../components/Objects/Taxes/TaxContext';
import { SimulationYear } from '../../../components/Objects/Assumptions/SimulationEngine';
import { calculateNetWorth, formatCurrency } from './FutureUtils';
import { YearlyPercentile } from '../../../services/MonteCarloTypes';
import { MonteCarloDebugPanel } from './MonteCarloDebugPanel';

interface MonteCarloTabProps {
    simulationData: SimulationYear[];
}

/**
 * Extract deterministic net worth timeline from simulation data
 */
function extractDeterministicLine(simulationData: SimulationYear[]): YearlyPercentile[] {
    return simulationData.map(year => ({
        year: year.year,
        netWorth: calculateNetWorth(year.accounts),
    }));
}

/**
 * Monte Carlo simulation tab component
 * Shows controls, results, and probability fan chart
 */
export const MonteCarloTab = React.memo(({ simulationData }: MonteCarloTabProps) => {
    const { state, runSimulation, updateConfig, generateNewSeed } = useMonteCarlo();
    const { accounts } = useContext(AccountContext);
    const { incomes } = useContext(IncomeContext);
    const { expenses } = useContext(ExpenseContext);
    const { assumptions } = useAssumptions();
    const { state: taxState } = useContext(TaxContext);

    const { config, summary, isRunning, progress, error } = state;

    // Extract deterministic baseline for comparison
    const deterministicLine = useMemo(() => {
        return extractDeterministicLine(simulationData);
    }, [simulationData]);

    // Handle running simulation
    const handleRun = async () => {
        await runSimulation(accounts, incomes, expenses, assumptions, taxState);
    };

    // Format success rate with color
    const getSuccessRateColor = (rate: number) => {
        if (rate >= 95) return 'text-green-400';
        if (rate >= 80) return 'text-yellow-400';
        if (rate >= 60) return 'text-orange-400';
        return 'text-red-400';
    };

    return (
        <div className="flex flex-col w-full h-full gap-6 p-4">
            {/* Controls Section */}
            <div className="bg-gray-800/50 rounded-xl p-4 border border-gray-700">
                <h3 className="text-white font-semibold mb-4">Monte Carlo Settings</h3>

                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    {/* Number of Scenarios */}
                    <div className="flex flex-col gap-1">
                        <label className="text-gray-400 text-xs uppercase tracking-wider">
                            Scenarios
                        </label>
                        <select
                            value={config.numScenarios}
                            onChange={(e) => updateConfig({ numScenarios: Number(e.target.value) })}
                            disabled={isRunning}
                            className="bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm
                                     focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-50"
                        >
                            <option value={100}>100 (Fast)</option>
                            <option value={500}>500 (Balanced)</option>
                            <option value={1000}>1,000 (Detailed)</option>
                        </select>
                    </div>

                    {/* Return Mean */}
                    <div className="flex flex-col gap-1">
                        <label className="text-gray-400 text-xs uppercase tracking-wider">
                            Mean Return
                        </label>
                        <div className="flex items-center gap-2">
                            <input
                                type="number"
                                value={config.returnMean}
                                onChange={(e) => updateConfig({ returnMean: Number(e.target.value) })}
                                disabled={isRunning}
                                step={0.5}
                                className="bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm w-full
                                         focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-50"
                            />
                            <span className="text-gray-400">%</span>
                        </div>
                    </div>

                    {/* Volatility (Std Dev) */}
                    <div className="flex flex-col gap-1">
                        <label className="text-gray-400 text-xs uppercase tracking-wider">
                            Volatility
                        </label>
                        <div className="flex items-center gap-2">
                            <input
                                type="number"
                                value={config.returnStdDev}
                                onChange={(e) => updateConfig({ returnStdDev: Number(e.target.value) })}
                                disabled={isRunning}
                                step={1}
                                min={0}
                                max={50}
                                className="bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm w-full
                                         focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-50"
                            />
                            <span className="text-gray-400">%</span>
                        </div>
                    </div>

                    {/* Seed */}
                    <div className="flex flex-col gap-1">
                        <label className="text-gray-400 text-xs uppercase tracking-wider">
                            Random Seed
                        </label>
                        <div className="flex items-center gap-2">
                            <input
                                type="number"
                                value={config.seed}
                                onChange={(e) => updateConfig({ seed: Number(e.target.value) })}
                                disabled={isRunning}
                                className="bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm w-full
                                         focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-50"
                            />
                            <button
                                onClick={generateNewSeed}
                                disabled={isRunning}
                                className="bg-gray-600 hover:bg-gray-500 text-white px-2 py-2 rounded-lg text-xs
                                         transition-colors disabled:opacity-50"
                                title="Generate new random seed"
                            >
                                New
                            </button>
                        </div>
                    </div>
                </div>

                {/* Run Button */}
                <div className="mt-4 flex items-center gap-4">
                    <button
                        onClick={handleRun}
                        disabled={isRunning}
                        className={`px-6 py-2 rounded-lg font-medium transition-colors
                            ${isRunning
                                ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
                                : 'bg-emerald-600 hover:bg-emerald-500 text-white'
                            }`}
                    >
                        {isRunning ? 'Running...' : 'Run Simulation'}
                    </button>

                    {/* Progress Bar */}
                    {isRunning && (
                        <div className="flex-1 flex items-center gap-3">
                            <div className="flex-1 h-2 bg-gray-700 rounded-full overflow-hidden">
                                <div
                                    className="h-full bg-emerald-500 transition-all duration-100"
                                    style={{ width: `${progress}%` }}
                                />
                            </div>
                            <span className="text-gray-400 text-sm tabular-nums">
                                {Math.round(progress)}%
                            </span>
                        </div>
                    )}

                    {/* Error Message */}
                    {error && (
                        <span className="text-red-400 text-sm">{error}</span>
                    )}
                </div>
            </div>

            {/* Results Summary */}
            {summary && (
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                    {/* Success Rate */}
                    <div className="bg-gray-800/50 rounded-xl p-4 border border-gray-700">
                        <div className="text-gray-400 text-xs uppercase tracking-wider mb-1">
                            Success Rate
                        </div>
                        <div className={`text-3xl font-bold ${getSuccessRateColor(summary.successRate)}`}>
                            {summary.successRate.toFixed(1)}%
                        </div>
                        <div className="text-gray-500 text-xs mt-1">
                            {summary.successfulScenarios} of {summary.totalScenarios} scenarios
                        </div>
                    </div>

                    {/* 10th Percentile (Worst Reasonable) */}
                    <div className="bg-gray-800/50 rounded-xl p-4 border border-gray-700">
                        <div className="text-gray-400 text-xs uppercase tracking-wider mb-1">
                            10th Percentile
                        </div>
                        <div className="text-2xl font-bold text-red-400">
                            {formatCurrency(summary.percentiles.p10[summary.percentiles.p10.length - 1]?.netWorth ?? 0)}
                        </div>
                        <div className="text-gray-500 text-xs mt-1">
                            Worst reasonable case
                        </div>
                    </div>

                    {/* Median (50th) */}
                    <div className="bg-gray-800/50 rounded-xl p-4 border border-gray-700">
                        <div className="text-gray-400 text-xs uppercase tracking-wider mb-1">
                            Median
                        </div>
                        <div className="text-2xl font-bold text-emerald-400">
                            {formatCurrency(summary.percentiles.p50[summary.percentiles.p50.length - 1]?.netWorth ?? 0)}
                        </div>
                        <div className="text-gray-500 text-xs mt-1">
                            50th percentile
                        </div>
                    </div>

                    {/* 90th Percentile (Best Reasonable) */}
                    <div className="bg-gray-800/50 rounded-xl p-4 border border-gray-700">
                        <div className="text-gray-400 text-xs uppercase tracking-wider mb-1">
                            90th Percentile
                        </div>
                        <div className="text-2xl font-bold text-blue-400">
                            {formatCurrency(summary.percentiles.p90[summary.percentiles.p90.length - 1]?.netWorth ?? 0)}
                        </div>
                        <div className="text-gray-500 text-xs mt-1">
                            Best reasonable case
                        </div>
                    </div>

                    {/* Average */}
                    <div className="bg-gray-800/50 rounded-xl p-4 border border-gray-700">
                        <div className="text-gray-400 text-xs uppercase tracking-wider mb-1">
                            Average
                        </div>
                        <div className="text-2xl font-bold text-gray-300">
                            {formatCurrency(summary.averageFinalNetWorth)}
                        </div>
                        <div className="text-gray-500 text-xs mt-1">
                            Mean final net worth
                        </div>
                    </div>
                </div>
            )}

            {/* Fan Chart */}
            <div className="bg-gray-800/50 rounded-xl p-4 border border-gray-700 flex-1">
                <h3 className="text-white font-semibold mb-4">Probability Distribution</h3>
                {summary ? (
                    <FanChart
                        percentiles={summary.percentiles}
                        deterministicLine={deterministicLine}
                        height={400}
                    />
                ) : (
                    <div className="flex flex-col items-center justify-center h-96 text-center">
                        <div className="text-gray-500 text-lg mb-2">No simulation data</div>
                        <p className="text-gray-600 text-sm max-w-md">
                            Configure the settings above and click "Run Simulation" to see the probability
                            distribution of your portfolio outcomes over time.
                        </p>
                    </div>
                )}
            </div>

            {/* Information Panel */}
            <div className="bg-gray-800/30 rounded-xl p-4 border border-gray-700/50">
                <h4 className="text-gray-300 font-medium mb-2">About Monte Carlo Simulation</h4>
                <div className="text-gray-500 text-sm space-y-2">
                    <p>
                        Monte Carlo simulation runs hundreds of scenarios with randomized market returns
                        to estimate the probability of your retirement plan succeeding.
                    </p>
                    <ul className="list-disc list-inside space-y-1 text-xs">
                        <li><strong>Success Rate:</strong> Percentage of scenarios where your portfolio lasted through life expectancy</li>
                        <li><strong>Mean Return:</strong> Average expected annual return (historically ~7% real for equities)</li>
                        <li><strong>Volatility:</strong> Standard deviation of returns (historically ~15% for S&P 500)</li>
                        <li><strong>Orange Line:</strong> Deterministic projection using your configured return rate</li>
                        <li><strong>Green Bands:</strong> Probability ranges (darker = 25th-75th percentile, lighter = 10th-90th)</li>
                    </ul>
                </div>

                {/* Debug Panel */}
                {summary && (
                    <MonteCarloDebugPanel summary={summary} config={config} />
                )}
            </div>
        </div>
    );
});
