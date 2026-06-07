import React, { useMemo, useContext, useState, useEffect } from 'react';
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
import { HISTORICAL_STATS } from '../../../data/HistoricalReturns';
import { HistoricalBacktestPanel } from './HistoricalBacktestPanel';
import { DropdownInput } from '../../../components/Layout/InputFields/DropdownInput';
import { PercentageInput } from '../../../components/Layout/InputFields/PercentageInput';
import { NumberInput } from '../../../components/Layout/InputFields/NumberInput';

interface MonteCarloTabProps {
    simulationData: SimulationYear[];
}

/**
 * Extract deterministic net worth timeline from simulation data.
 *
 * Some sims emit two entries for the current year — a "Today" snapshot and a
 * "Dec YYYY" end-of-year projection. Monte Carlo percentile lines are annual,
 * so the fan chart's linear x-axis needs exactly one point per year. We keep
 * the EOY entry where it exists since it represents the year-end value that
 * lines up with MC's annual snapshots.
 */
function extractDeterministicLine(simulationData: SimulationYear[]): YearlyPercentile[] {
    const byYear = new Map<number, SimulationYear>();
    for (const year of simulationData) {
        const existing = byYear.get(year.year);
        if (!existing || year.isEndOfYearProjection) {
            byYear.set(year.year, year);
        }
    }
    return Array.from(byYear.values()).map(year => ({
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

    // Auto-update return mean when inflation setting changes.
    // Uses config.lastInflationAdjusted (persisted to localStorage) instead of a ref,
    // so the change is detected even if the component unmounts and remounts (tab switching).
    const inflationRate = assumptions.macro?.inflationRate ?? 0;
    const ror = assumptions.investments?.returnRates?.ror ?? 0;
    useEffect(() => {
        if (normalizedPreset !== 'custom') {
            // For named presets, always sync to the expected value
            const expectedMean = getPresetReturnMean(normalizedPreset, inflationAdjusted);
            if (config.returnMean !== expectedMean) {
                updateConfig({ returnMean: expectedMean, lastInflationAdjusted: inflationAdjusted });
            } else if (config.lastInflationAdjusted !== inflationAdjusted) {
                updateConfig({ lastInflationAdjusted: inflationAdjusted });
            }
        } else {
            // For custom, sync to assumptions: ror + inflation (if toggle on), else just ror.
            // Only re-sync when an assumption value actually changed — never when the user
            // is mid-edit on the Mean Return field.
            const assumptionsChanged =
                config.lastInflationAdjusted !== inflationAdjusted ||
                config.lastInflationRate !== inflationRate ||
                config.lastRor !== ror;
            if (assumptionsChanged) {
                const expectedMean = inflationAdjusted ? ror + inflationRate : ror;
                const rounded = Math.round(expectedMean * 10) / 10;
                updateConfig({
                    returnMean: rounded,
                    lastInflationAdjusted: inflationAdjusted,
                    lastInflationRate: inflationRate,
                    lastRor: ror,
                });
            }
        }
    }, [inflationAdjusted, inflationRate, ror, normalizedPreset, config.returnMean, config.lastInflationAdjusted, config.lastInflationRate, config.lastRor, updateConfig]);

    // Extract deterministic baseline for comparison
    const deterministicLine = useMemo(() => {
        return extractDeterministicLine(simulationData);
    }, [simulationData]);

    // Handle preset selection - uses inflation setting to determine real vs nominal.
    // Custom preset pulls its return mean from assumptions (ror + inflation if toggle on).
    const handlePresetChange = (presetKey: ReturnPresetKey) => {
        const preset = RETURN_PRESETS[presetKey];
        const customMean = inflationAdjusted ? ror + inflationRate : ror;
        const returnMean = presetKey === 'custom'
            ? Math.round(customMean * 10) / 10
            : getPresetReturnMean(presetKey, inflationAdjusted);
        updateConfig({
            preset: presetKey,
            returnMean,
            returnStdDev: preset.returnStdDev,
            lastInflationAdjusted: inflationAdjusted,
            lastInflationRate: inflationRate,
            lastRor: ror,
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
        if (rate >= 95) return 'text-positive';
        if (rate >= 80) return 'text-warning';
        if (rate >= 60) return 'text-cat-orange';
        return 'text-negative';
    };

    return (
        <div className="flex flex-col w-full h-full gap-6 p-4">
            {/* Sub-tab Switcher */}
            <div className="flex gap-1 bg-surface-overlay/50 rounded-lg p-1 w-fit">
                <button
                    onClick={() => handleSubTabChange('monte-carlo')}
                    className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                        activeSubTab === 'monte-carlo'
                            ? 'bg-positive-solid text-white'
                            : 'text-content-muted hover:text-white hover:bg-surface-input'
                    }`}
                >
                    Monte Carlo
                </button>
                <button
                    onClick={() => handleSubTabChange('historical')}
                    className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                        activeSubTab === 'historical'
                            ? 'bg-positive-solid text-white'
                            : 'text-content-muted hover:text-white hover:bg-surface-input'
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
            <div className="bg-surface-overlay/50 rounded-xl p-4 border border-border-default">
                <h3 className="text-white font-semibold mb-4">Monte Carlo Settings</h3>

                {/* Return Assumptions Preset */}
                <div className="mb-4 pb-4 border-b border-border-default">
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
                        <p className="text-content-muted text-xs sm:mt-6">
                            {RETURN_PRESETS[normalizedPreset].description}
                            {normalizedPreset !== 'custom' && (
                                <span className="text-content-muted">
                                    {' '}Using {inflationAdjusted ? 'nominal' : 'real'} returns ({getPresetReturnMean(normalizedPreset, inflationAdjusted)}%).
                                </span>
                            )}
                        </p>
                    </div>
                    {normalizedPreset !== 'custom' && (
                        <div className="mt-2 text-xs text-content-muted">
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
                            className="bg-surface-hover hover:bg-surface-muted text-white px-3 py-2 rounded-lg text-xs
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
                                ? 'bg-surface-hover text-content-muted cursor-not-allowed'
                                : 'bg-positive-solid hover:bg-positive-soft text-white'
                            }`}
                    >
                        {isRunning ? 'Running...' : 'Run Simulation'}
                    </button>

                    {/* Progress Bar */}
                    {isRunning && (
                        <div className="flex-1 flex items-center gap-3">
                            <div className="flex-1 h-2 bg-surface-input rounded-full overflow-hidden">
                                <div
                                    className="h-full bg-positive-soft transition-all duration-100"
                                    style={{ width: `${progress}%` }}
                                />
                            </div>
                            <span className="text-content-muted text-sm tabular-nums">
                                {Math.round(progress)}%
                            </span>
                        </div>
                    )}

                    {/* Error Message */}
                    {error && (
                        <span className="text-negative text-sm">{error}</span>
                    )}
                </div>
            </div>

            {/* Results Summary */}
            {summary && (
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
                    {/* Success Rate */}
                    <div className="bg-surface-overlay/50 rounded-xl p-4 border border-border-default">
                        <div className="text-content-muted text-xs uppercase tracking-wider mb-1">
                            Success Rate
                        </div>
                        <div className={`text-2xl lg:text-3xl font-bold ${getSuccessRateColor(summary.successRate)}`}>
                            {summary.successRate.toFixed(1)}%
                        </div>
                        <div className="text-content-muted text-xs mt-1">
                            {summary.successfulScenarios} of {summary.totalScenarios} scenarios
                        </div>
                    </div>

                    {/* 10th Percentile (Worst Reasonable) */}
                    <div className="bg-surface-overlay/50 rounded-xl p-4 border border-border-default">
                        <div className="text-content-muted text-xs uppercase tracking-wider mb-1">
                            10th Percentile
                        </div>
                        <div className="text-xl lg:text-2xl font-bold text-negative truncate">
                            {formatCompactCurrency(summary.percentiles.p10[summary.percentiles.p10.length - 1]?.netWorth ?? 0, { forceExact })}
                        </div>
                        <div className="text-content-muted text-xs mt-1">
                            Worst reasonable case
                        </div>
                    </div>

                    {/* Median (50th) */}
                    <div className="bg-surface-overlay/50 rounded-xl p-4 border border-border-default">
                        <div className="text-content-muted text-xs uppercase tracking-wider mb-1">
                            Median
                        </div>
                        <div className="text-xl lg:text-2xl font-bold text-positive truncate">
                            {formatCompactCurrency(summary.percentiles.p50[summary.percentiles.p50.length - 1]?.netWorth ?? 0, { forceExact })}
                        </div>
                        <div className="text-content-muted text-xs mt-1">
                            50th percentile
                        </div>
                    </div>

                    {/* 90th Percentile (Best Reasonable) */}
                    <div className="bg-surface-overlay/50 rounded-xl p-4 border border-border-default">
                        <div className="text-content-muted text-xs uppercase tracking-wider mb-1">
                            90th Percentile
                        </div>
                        <div className="text-xl lg:text-2xl font-bold text-info truncate">
                            {formatCompactCurrency(summary.percentiles.p90[summary.percentiles.p90.length - 1]?.netWorth ?? 0, { forceExact })}
                        </div>
                        <div className="text-content-muted text-xs mt-1">
                            Best reasonable case
                        </div>
                    </div>

                    {/* Trimmed Average */}
                    <div className="bg-surface-overlay/50 rounded-xl p-4 border border-border-default">
                        <div className="text-content-muted text-xs uppercase tracking-wider mb-1">
                            Trimmed Avg
                        </div>
                        <div className="text-xl lg:text-2xl font-bold text-content-default truncate">
                            {formatCompactCurrency(summary.averageFinalNetWorth, { forceExact })}
                        </div>
                        <div className="text-content-muted text-xs mt-1">
                            Excludes top/bottom 5%
                        </div>
                    </div>
                </div>
            )}

            {/* Fan Chart */}
            <div className="bg-surface-overlay/50 rounded-xl p-4 border border-border-default flex-1">
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
                        <div className="text-content-muted text-lg mb-2">No simulation data</div>
                        <p className="text-content-muted text-sm max-w-md">
                            Configure the settings above and click "Run Simulation" to see the probability
                            distribution of your portfolio outcomes over time.
                        </p>
                    </div>
                )}
            </div>

            {/* Information Panel */}
            <div className="bg-surface-overlay/30 rounded-xl p-4 border border-border-default/50">
                <h4 className="text-content-default font-medium mb-2">About Monte Carlo Simulation</h4>
                <div className="text-content-muted text-sm space-y-2">
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
            </div>
            </>
            )}
        </div>
    );
});
