import React, { useMemo, useContext, useState } from 'react';
import { FanChart } from '../../../components/Charts/FanChart';
import { useMonteCarlo } from '../../../components/Objects/Assumptions/MonteCarloContext';
import { AccountContext } from '../../../components/Objects/Accounts/AccountContext';
import { IncomeContext } from '../../../components/Objects/Income/IncomeContext';
import { ExpenseContext } from '../../../components/Objects/Expense/ExpenseContext';
import { useAssumptions } from '../../../components/Objects/Assumptions/AssumptionsContext';
import { TaxContext } from '../../../components/Objects/Taxes/TaxContext';
import { SimulationYear } from '../../../components/Objects/Assumptions/SimulationEngine';
import { calculateNetWorth, formatCompactCurrency } from './FutureUtils';
import { YearlyPercentile, RETURN_PRESETS, ReturnPresetKey, getPresetReturnMean } from '../../../services/MonteCarloTypes';
import { MonteCarloDebugPanel } from './MonteCarloDebugPanel';
import { HISTORICAL_STATS } from '../../../data/HistoricalReturns';
import { HistoricalBacktestPanel } from './HistoricalBacktestPanel';
import { DropdownInput } from '../../../components/Layout/InputFields/DropdownInput';
import { PercentageInput } from '../../../components/Layout/InputFields/PercentageInput';
import { NumberInput } from '../../../components/Layout/InputFields/NumberInput';

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
type SimulationSubTab = 'monte-carlo' | 'historical';

const SUBTAB_STORAGE_KEY = 'stag_mc_subtab';

export const MonteCarloTab = React.memo(({ simulationData }: MonteCarloTabProps) => {
    const [activeSubTab, setActiveSubTab] = useState<SimulationSubTab>(() => {
        const saved = localStorage.getItem(SUBTAB_STORAGE_KEY);
        return (saved === 'monte-carlo' || saved === 'historical') ? saved : 'monte-carlo';
    });

    // Persist sub-tab selection
    const handleSubTabChange = (tab: SimulationSubTab) => {
        setActiveSubTab(tab);
        localStorage.setItem(SUBTAB_STORAGE_KEY, tab);
    };
    const { state, runSimulation, updateConfig, generateNewSeed } = useMonteCarlo();
    const { accounts } = useContext(AccountContext);
    const { incomes } = useContext(IncomeContext);
    const { expenses } = useContext(ExpenseContext);
    const { assumptions } = useAssumptions();
    const { state: taxState } = useContext(TaxContext);
    const forceExact = assumptions.display?.useCompactCurrency === false;

    const { config, summary, isRunning, progress, error } = state;
    const inflationAdjusted = assumptions.macro?.inflationAdjusted ?? true;

    // Normalize preset - handle old values from before simplification
    const normalizedPreset: ReturnPresetKey = RETURN_PRESETS[config.preset]
        ? config.preset
        : 'historical'; // Fallback for old 'historical_real' or 'historical_nominal' values

    // Extract deterministic baseline for comparison
    const deterministicLine = useMemo(() => {
        return extractDeterministicLine(simulationData);
    }, [simulationData]);

    // Handle preset selection - uses inflation setting to determine real vs nominal
    const handlePresetChange = (presetKey: ReturnPresetKey) => {
        const preset = RETURN_PRESETS[presetKey];
        updateConfig({
            preset: presetKey,
            returnMean: getPresetReturnMean(presetKey, inflationAdjusted),
            returnStdDev: preset.returnStdDev,
        });
    };

    // Handle manual return value changes (switch to custom if not already)
    const handleReturnMeanChange = (value: number) => {
        const newConfig: { returnMean: number; preset?: ReturnPresetKey } = { returnMean: value };
        // Switch to custom if value doesn't match current preset
        const expectedMean = getPresetReturnMean(normalizedPreset, inflationAdjusted);
        if (value !== expectedMean) {
            newConfig.preset = 'custom';
        }
        updateConfig(newConfig);
    };

    const handleReturnStdDevChange = (value: number) => {
        const newConfig: { returnStdDev: number; preset?: ReturnPresetKey } = { returnStdDev: value };
        // Switch to custom if value doesn't match current preset
        const currentPreset = RETURN_PRESETS[normalizedPreset];
        if (value !== currentPreset.returnStdDev) {
            newConfig.preset = 'custom';
        }
        updateConfig(newConfig);
    };

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
            {/* Sub-tab Switcher */}
            <div className="flex gap-1 bg-gray-800/50 rounded-lg p-1 w-fit">
                <button
                    onClick={() => handleSubTabChange('monte-carlo')}
                    className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                        activeSubTab === 'monte-carlo'
                            ? 'bg-emerald-600 text-white'
                            : 'text-gray-400 hover:text-white hover:bg-gray-700'
                    }`}
                >
                    Monte Carlo
                </button>
                <button
                    onClick={() => handleSubTabChange('historical')}
                    className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                        activeSubTab === 'historical'
                            ? 'bg-emerald-600 text-white'
                            : 'text-gray-400 hover:text-white hover:bg-gray-700'
                    }`}
                >
                    Historical Backtest
                </button>
            </div>

            {/* Historical Backtest Tab */}
            {activeSubTab === 'historical' && <HistoricalBacktestPanel simulationData={simulationData} />}

            {/* Monte Carlo Tab */}
            {activeSubTab === 'monte-carlo' && (
            <>
            {/* Controls Section */}
            <div className="bg-gray-800/50 rounded-xl p-4 border border-gray-700">
                <h3 className="text-white font-semibold mb-4">Monte Carlo Settings</h3>

                {/* Return Assumptions Preset */}
                <div className="mb-4 pb-4 border-b border-gray-700">
                    <div className="flex flex-col sm:flex-row sm:items-start gap-4">
                        <div className="sm:w-48">
                            <DropdownInput
                                label="Return Assumptions"
                                value={normalizedPreset}
                                onChange={(val) => handlePresetChange(val as ReturnPresetKey)}
                                options={Object.values(RETURN_PRESETS).map(preset => ({
                                    value: preset.key,
                                    label: preset.label
                                }))}
                            />
                        </div>
                        <p className="text-gray-400 text-xs sm:mt-6">
                            {RETURN_PRESETS[normalizedPreset].description}
                            {normalizedPreset !== 'custom' && (
                                <span className="text-gray-400">
                                    {' '}Using {inflationAdjusted ? 'nominal' : 'real'} returns ({getPresetReturnMean(normalizedPreset, inflationAdjusted)}%).
                                </span>
                            )}
                        </p>
                    </div>
                    {normalizedPreset !== 'custom' && (
                        <div className="mt-2 text-xs text-gray-400">
                            Data: {HISTORICAL_STATS.stocks.startYear}-{HISTORICAL_STATS.stocks.endYear} S&P 500 total returns
                        </div>
                    )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <DropdownInput
                        label="Scenarios"
                        value={config.numScenarios.toString()}
                        onChange={(val) => updateConfig({ numScenarios: Number(val) })}
                        options={[
                            { value: '100', label: '100 (Fast)' },
                            { value: '500', label: '500 (Balanced)' },
                            { value: '1000', label: '1,000 (Detailed)' },
                        ]}
                        tooltip="Number of random scenarios to simulate"
                    />

                    <PercentageInput
                        label="Mean Return"
                        value={config.returnMean}
                        onChange={handleReturnMeanChange}
                        tooltip="Expected average annual return"
                        max={50}
                    />

                    <PercentageInput
                        label="Volatility"
                        value={config.returnStdDev}
                        onChange={handleReturnStdDevChange}
                        tooltip="Standard deviation of annual returns"
                        max={50}
                    />

                    <div className="flex gap-2 items-end">
                        <div className="flex-1">
                            <NumberInput
                                label="Random Seed"
                                value={config.seed}
                                onChange={(val) => updateConfig({ seed: val })}
                                tooltip="Seed for reproducible results"
                            />
                        </div>
                        <button
                            onClick={generateNewSeed}
                            disabled={isRunning}
                            className="bg-gray-600 hover:bg-gray-500 text-white px-3 py-2 rounded-lg text-xs
                                     transition-colors disabled:opacity-50 mb-1"
                            title="Generate new random seed"
                        >
                            New
                        </button>
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
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
                    {/* Success Rate */}
                    <div className="bg-gray-800/50 rounded-xl p-4 border border-gray-700">
                        <div className="text-gray-400 text-xs uppercase tracking-wider mb-1">
                            Success Rate
                        </div>
                        <div className={`text-2xl lg:text-3xl font-bold ${getSuccessRateColor(summary.successRate)}`}>
                            {summary.successRate.toFixed(1)}%
                        </div>
                        <div className="text-gray-400 text-xs mt-1">
                            {summary.successfulScenarios} of {summary.totalScenarios} scenarios
                        </div>
                    </div>

                    {/* 10th Percentile (Worst Reasonable) */}
                    <div className="bg-gray-800/50 rounded-xl p-4 border border-gray-700">
                        <div className="text-gray-400 text-xs uppercase tracking-wider mb-1">
                            10th Percentile
                        </div>
                        <div className="text-xl lg:text-2xl font-bold text-red-400 truncate">
                            {formatCompactCurrency(summary.percentiles.p10[summary.percentiles.p10.length - 1]?.netWorth ?? 0, { forceExact })}
                        </div>
                        <div className="text-gray-400 text-xs mt-1">
                            Worst reasonable case
                        </div>
                    </div>

                    {/* Median (50th) */}
                    <div className="bg-gray-800/50 rounded-xl p-4 border border-gray-700">
                        <div className="text-gray-400 text-xs uppercase tracking-wider mb-1">
                            Median
                        </div>
                        <div className="text-xl lg:text-2xl font-bold text-emerald-400 truncate">
                            {formatCompactCurrency(summary.percentiles.p50[summary.percentiles.p50.length - 1]?.netWorth ?? 0, { forceExact })}
                        </div>
                        <div className="text-gray-400 text-xs mt-1">
                            50th percentile
                        </div>
                    </div>

                    {/* 90th Percentile (Best Reasonable) */}
                    <div className="bg-gray-800/50 rounded-xl p-4 border border-gray-700">
                        <div className="text-gray-400 text-xs uppercase tracking-wider mb-1">
                            90th Percentile
                        </div>
                        <div className="text-xl lg:text-2xl font-bold text-blue-400 truncate">
                            {formatCompactCurrency(summary.percentiles.p90[summary.percentiles.p90.length - 1]?.netWorth ?? 0, { forceExact })}
                        </div>
                        <div className="text-gray-400 text-xs mt-1">
                            Best reasonable case
                        </div>
                    </div>

                    {/* Trimmed Average */}
                    <div className="bg-gray-800/50 rounded-xl p-4 border border-gray-700">
                        <div className="text-gray-400 text-xs uppercase tracking-wider mb-1">
                            Trimmed Avg
                        </div>
                        <div className="text-xl lg:text-2xl font-bold text-gray-300 truncate">
                            {formatCompactCurrency(summary.averageFinalNetWorth, { forceExact })}
                        </div>
                        <div className="text-gray-400 text-xs mt-1">
                            Excludes top/bottom 5%
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
                        bestCase={summary.bestCase}
                        worstCase={summary.worstCase}
                        height={400}
                    />
                ) : (
                    <div className="flex flex-col items-center justify-center h-96 text-center">
                        <div className="text-gray-400 text-lg mb-2">No simulation data</div>
                        <p className="text-gray-400 text-sm max-w-md">
                            Configure the settings above and click "Run Simulation" to see the probability
                            distribution of your portfolio outcomes over time.
                        </p>
                    </div>
                )}
            </div>

            {/* Information Panel */}
            <div className="bg-gray-800/30 rounded-xl p-4 border border-gray-700/50">
                <h4 className="text-gray-300 font-medium mb-2">About Monte Carlo Simulation</h4>
                <div className="text-gray-400 text-sm space-y-2">
                    <p>
                        Monte Carlo simulation runs hundreds of scenarios with randomized market returns
                        to estimate the probability of your retirement plan succeeding.
                    </p>
                    <ul className="list-disc list-inside space-y-1 text-xs">
                        <li><strong>Success Rate:</strong> Percentage of scenarios where your portfolio lasted through life expectancy</li>
                        <li><strong>Historical Preset:</strong> Based on {HISTORICAL_STATS.stocks.startYear}-{HISTORICAL_STATS.stocks.endYear} S&P 500 data. Uses {inflationAdjusted ? 'nominal' : 'real (inflation-adjusted)'} returns.</li>
                        <li><strong>Volatility:</strong> Standard deviation of returns ({HISTORICAL_STATS.stocks.stdDev.toFixed(1)}% for historical S&P 500)</li>
                        <li><strong>Orange Line:</strong> Deterministic projection using your configured return rate</li>
                        <li><strong>Green Bands:</strong> Probability ranges (darker = 25th-75th percentile, lighter = 10th-90th)</li>
                        <li><strong>Blue Line:</strong> Best performing simulation run</li>
                        <li><strong>Red Line:</strong> Worst performing simulation run</li>
                    </ul>
                </div>

                {/* Debug Panel */}
                {summary && (
                    <MonteCarloDebugPanel summary={summary} config={config} />
                )}
            </div>
            </>
            )}
        </div>
    );
});
