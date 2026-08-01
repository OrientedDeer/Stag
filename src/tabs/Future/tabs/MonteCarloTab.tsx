import React, { useMemo, useContext, useState, useEffect, useRef } from 'react';
import { FanChart } from '../../../components/Charts/FanChart';
import { useMonteCarlo } from '../../../components/Objects/Assumptions/MonteCarloContext';
import { AccountContext } from '../../../components/Objects/Accounts/AccountContext';
import { IncomeContext } from '../../../components/Objects/Income/IncomeContext';
import { ExpenseContext } from '../../../components/Objects/Expense/ExpenseContext';
import { useAssumptions } from '../../../components/Objects/Assumptions/AssumptionsContext';
import { TaxContext } from '../../../components/Objects/Taxes/TaxContext';
import { type SimulationYear } from '../../../components/Objects/Assumptions/SimulationEngine';
import { applyChosenWithdrawalOrder } from '../../../services/simulation/EngineDirectConversionSearch';
import { calculateNetWorth, formatCompactCurrency } from './FutureUtils';
import { type YearlyPercentile, RETURN_PRESETS, type ReturnPresetKey, getPresetReturnMean } from '../../../services/MonteCarloTypes';
import { HISTORICAL_STATS } from '../../../data/HistoricalReturns';
import { HistoricalBacktestPanel } from './HistoricalBacktestPanel';
import { DropdownInput } from '../../../components/Layout/InputFields/DropdownInput';
import { PercentageInput } from '../../../components/Layout/InputFields/PercentageInput';
import { NumberInput } from '../../../components/Layout/InputFields/NumberInput';
import { ToggleInput } from '../../../components/Layout/InputFields/ToggleInput';
import { AlertBanner } from '../../../components/Layout/AlertBanner';
import { InvestedAccount } from '../../../components/Objects/Accounts/models';
import { planHasBondExposure } from '../../../services/simulation/allocation';
import { McHeadlineTiles } from './McHeadlineTiles';
import { McConversionCard } from './McConversionCard';

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
    const { state, runSimulation, updateConfig, generateNewSeed, tryRestoreSummary } = useMonteCarlo();
    const { accounts } = useContext(AccountContext);
    const { incomes } = useContext(IncomeContext);
    const { expenses } = useContext(ExpenseContext);
    const { assumptions } = useAssumptions();
    const { state: taxState } = useContext(TaxContext);
    const forceExact = assumptions.display?.useCompactCurrency === false;

    const { config, summary, isRunning, progress, phase, error } = state;

    // Fan-chart outlier toggle (ui-sweep): the single best run can spike far
    // above the percentile bands and visually compress them; hiding the
    // best/worst series lets the chart focus on the bands. Default ON keeps
    // the long-standing behavior.
    const [showOutlierRuns, setShowOutlierRuns] = useState(true);
    const inflationAdjusted = assumptions.macro?.inflationAdjusted ?? true;

    // Normalize preset - handle old values from before simplification
    const normalizedPreset: ReturnPresetKey = RETURN_PRESETS[config.preset]
        ? config.preset
        : 'historical'; // Fallback for old 'historical_real' or 'historical_nominal' values

    // Auto-update return mean when inflation setting changes.
    // Uses config.lastInflationAdjusted (persisted to localStorage) instead of a ref,
    // so the change is detected even if the component unmounts and remounts (tab switching).
    const inflationRate = assumptions.macro?.inflationRate ?? 0;
    // #207: true when anything in the plan is below 100% stock — drives the disclosure
    // banner about the single-stream (deterministic-bond) approximation below.
    // Shared with the engine's draw decision (#208) so the banner can never disagree with
    // whether bonds were actually simulated.
    const hasBondAllocation = planHasBondExposure(
        accounts.filter(a => a instanceof InvestedAccount),
        assumptions,
    );

    // #207: deliberately the STOCK rate, not the blended default. Monte Carlo draws ONE
    // series and each account treats it as its stock return, blending in the bond rate at
    // its own allocation (see blendedMonteCarloReturn). Syncing this to the blend would
    // apply the bond drag twice.
    const ror = assumptions.investments?.returnRates?.ror ?? 0;
    useEffect(() => {
        if (normalizedPreset !== 'custom') {
            // For named presets, always sync to the expected value. When inflation
            // is on, the nominal mean is derived from the sim inflation rate
            // (returnMeanReal + inflationRate), so dragging the inflation rate
            // re-runs this effect and re-syncs the displayed Mean Return (#109).
            const expectedMean = getPresetReturnMean(normalizedPreset, inflationAdjusted, inflationRate);
            const inflationTrackingChanged =
                config.lastInflationAdjusted !== inflationAdjusted ||
                config.lastInflationRate !== inflationRate;
            if (config.returnMean !== expectedMean) {
                updateConfig({
                    returnMean: expectedMean,
                    lastInflationAdjusted: inflationAdjusted,
                    lastInflationRate: inflationRate,
                });
            } else if (inflationTrackingChanged) {
                updateConfig({ lastInflationAdjusted: inflationAdjusted, lastInflationRate: inflationRate });
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

    // The assumptions MC actually runs under: the deterministic projection's
    // chosen withdrawal order applied on top of the user's assumptions (#1). Both
    // the run (handleRun) and the refresh-restore key MUST use this SAME object,
    // or the persisted-summary key won't match on reload (it reorders
    // withdrawalStrategy, which getSimulationInputHash hashes).
    const mcAssumptions = useMemo(
        () => applyChosenWithdrawalOrder(
            assumptions,
            simulationData[0]?.chosenWithdrawalOrder,
            new Set(accounts.map(a => a.id)),
        ),
        [assumptions, simulationData, accounts],
    );

    // Restore a persisted summary once on mount so a hard refresh re-displays the
    // last run instead of "No simulation data" (#204). Runs at most once; the
    // provider no-ops when results already exist or a run is in flight, and its
    // reducer guards against a late resolve clobbering a newer run.
    const didAttemptRestore = useRef(false);
    useEffect(() => {
        if (didAttemptRestore.current) return;
        didAttemptRestore.current = true;
        void tryRestoreSummary(accounts, incomes, expenses, mcAssumptions, taxState);
    }, [tryRestoreSummary, accounts, incomes, expenses, mcAssumptions, taxState]);

    // Handle preset selection - uses inflation setting to determine real vs nominal.
    // Custom preset pulls its return mean from assumptions (ror + inflation if toggle on).
    const handlePresetChange = (presetKey: ReturnPresetKey) => {
        const preset = RETURN_PRESETS[presetKey];
        const customMean = inflationAdjusted ? ror + inflationRate : ror;
        const returnMean = presetKey === 'custom'
            ? Math.round(customMean * 10) / 10
            : getPresetReturnMean(presetKey, inflationAdjusted, inflationRate);
        updateConfig({
            preset: presetKey,
            returnMean,
            returnStdDev: preset.returnStdDev,
            // #208: a preset carries a paired bond volatility. Selecting one WRITES it
            // into the config (nothing reads the preset at run time), so omitting this
            // would leave e.g. Conservative running on the historical bond vol.
            bondReturnStdDev: preset.bondStdDev,
            lastInflationAdjusted: inflationAdjusted,
            lastInflationRate: inflationRate,
            lastRor: ror,
        });
    };

    // Handle manual return value changes (switch to custom if not already)
    const handleReturnMeanChange = (value: number) => {
        const newConfig: { returnMean: number; preset?: ReturnPresetKey } = { returnMean: value };
        // Switch to custom if value doesn't match current preset
        const expectedMean = getPresetReturnMean(normalizedPreset, inflationAdjusted, inflationRate);
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

    // Handle running simulation. Uses `mcAssumptions` (the deterministic plan's
    // chosen withdrawal order applied on top of the user's assumptions, #1) —
    // see its useMemo above; the refresh-restore key reuses the same object.
    const handleRun = async () => {
        await runSimulation(accounts, incomes, expenses, mcAssumptions, taxState);
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
                                    {' '}Using {inflationAdjusted ? 'nominal' : 'real'} returns ({getPresetReturnMean(normalizedPreset, inflationAdjusted, inflationRate)}%).
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
                        tooltip="Average annual return the random paths are drawn around. With Inflation Adjusted ON this is a NOMINAL return — your real return plus your inflation assumption (e.g. 7% real + 2.5% inflation = 9.5% here) — because the simulation runs in nominal dollars. With it OFF it's a real return, applied directly in today's dollars."
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
                        {isRunning ? (phase === 'solving' ? 'Solving…' : 'Running…') : 'Run Simulation'}
                    </button>

                    {/* Progress Bar. During the one-time policy solve (#98) the
                        per-scenario % can't advance, so show an indeterminate
                        sliding segment + label (a full pulsing bar reads as
                        "done" during a 10–20s solve); switch to the % bar for
                        the path loop. */}
                    {isRunning && (
                        <div className="flex-1 flex items-center gap-3">
                            {phase === 'solving' ? (
                                <>
                                    <div className="flex-1 h-2 bg-surface-input rounded-full overflow-hidden">
                                        <div className="h-full w-1/3 rounded-full bg-positive-soft animate-[indeterminate-slide_1.2s_ease-in-out_infinite_alternate]" />
                                    </div>
                                    <span className="text-content-muted text-sm">
                                        Solving conversion policy…
                                    </span>
                                </>
                            ) : (
                                <>
                                    <div className="flex-1 h-2 bg-surface-input rounded-full overflow-hidden">
                                        <div
                                            className="h-full bg-positive-soft transition-all duration-100"
                                            style={{ width: `${progress}%` }}
                                        />
                                    </div>
                                    <span className="text-content-muted text-sm tabular-nums">
                                        Running paths… {Math.round(progress)}%
                                    </span>
                                </>
                            )}
                        </div>
                    )}

                    {/* Error Message */}
                    {error && (
                        <span className="text-negative text-sm">{error}</span>
                    )}
                </div>
            </div>

            {/* Headline (#162 D1): success rate + AFTER-TAX terminal distribution
                (falls back to the legacy gross tiles on stale persisted summaries). */}
            {summary && <McHeadlineTiles summary={summary} forceExact={forceExact} />}

            {/* Merged Roth-conversion-behavior card (#162 D3): baseline verdict first,
                converted-per-path audit below a divider. Also owns the baseline toggle
                (persisted via the same config.compareToBaseline as before). */}
            <McConversionCard
                summary={summary}
                compareToBaseline={config.compareToBaseline ?? false}
                onToggleCompare={(v) => updateConfig({ compareToBaseline: v })}
                forceExact={forceExact}
            />

            {/* Fan Chart */}
            <div className="bg-surface-overlay/50 rounded-xl p-4 border border-border-default flex-1">
                <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 mb-4">
                    <h3 className="text-white font-semibold">Probability Distribution</h3>
                    {summary && (
                        <ToggleInput
                            id="mc-show-outlier-runs"
                            label="Show best/worst runs"
                            enabled={showOutlierRuns}
                            setEnabled={setShowOutlierRuns}
                            tooltip="The single best and worst simulated paths are extreme outliers — the best run can spike far above the bands and compress them. Turn this off to omit those two lines."
                        />
                    )}
                </div>
                {summary ? (
                    <>
                        <FanChart
                            percentiles={summary.percentiles}
                            deterministicLine={deterministicLine}
                            bestCase={showOutlierRuns ? summary.bestCase : undefined}
                            worstCase={showOutlierRuns ? summary.worstCase : undefined}
                            height={400}
                        />
                        {/* Gross terminal percentiles (#162 D2): demoted from the headline —
                            the chart plots GROSS per-year net worth, so this is what the
                            bands end at. */}
                        <div className="text-content-muted text-xs mt-3">
                            The bands end at (gross net worth):{' '}
                            <span className="text-content-default font-medium tabular-nums">
                                <span className="whitespace-nowrap">{formatCompactCurrency(summary.percentiles.p10[summary.percentiles.p10.length - 1]?.netWorth ?? 0, { forceExact })} (p10)</span>
                                {' / '}<span className="whitespace-nowrap">{formatCompactCurrency(summary.percentiles.p50[summary.percentiles.p50.length - 1]?.netWorth ?? 0, { forceExact })} (median)</span>
                                {' / '}<span className="whitespace-nowrap">{formatCompactCurrency(summary.percentiles.p90[summary.percentiles.p90.length - 1]?.netWorth ?? 0, { forceExact })} (p90)</span>
                            </span>
                            {' · '}
                            <span className="whitespace-nowrap">
                                trimmed average{' '}
                                <span className="text-content-default font-medium tabular-nums">{formatCompactCurrency(summary.averageFinalNetWorth, { forceExact })}</span>
                            </span>
                            {' '}(excludes top/bottom 5%)
                        </div>
                        {/* fp-review F11: the overlay and the bands run different conversion
                            machinery, so off-centering isn't only a volatility artifact. */}
                        <AlertBanner severity="info" size="sm" className="mt-3">
                            The orange line replays your deterministic plan — including its fixed
                            Roth-conversion schedule — while each simulated path re-decides
                            conversions from its own realized balances, so the line can sit
                            off-center of the median band for conversion-strategy reasons as well
                            as market volatility.
                        </AlertBanner>
                        {/* #208: bonds now carry their own volatility and a correlation with
                            stocks, so the single-stream disclosure that stood here is gone. What
                            remains worth saying is that the correlation is a fixed average — it
                            rose sharply in 2022's inflation shock, when diversification helped
                            least. */}
                        {hasBondAllocation && (
                            <AlertBanner severity="info" size="sm" className="mt-3">
                                Bond returns are simulated with their own volatility and a fixed
                                correlation to stocks. Real correlation is regime-dependent — in an
                                inflation shock both can fall together — so a bond-heavy plan's
                                diversification benefit here is closer to a long-run average than a
                                worst case.
                            </AlertBanner>
                        )}
                    </>
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
                    </ul>
                    {/* fp-review F13: an honest statement of what stays deterministic. */}
                    <p className="text-xs">
                        <strong>What this simulation holds fixed:</strong> only investment returns are
                        randomized. Inflation, salary growth, savings interest, and property
                        appreciation follow your deterministic assumptions on every path; the plan
                        always ends at your configured End of Plan age; and taxes use your
                        configured filing status on every path. Tax brackets and deductions keep
                        pace with your inflation assumption; what&apos;s held fixed is the LAW
                        itself — today&apos;s rates, bracket structure, and rules, with no future
                        legislation.
                    </p>
                </div>
            </div>
            </>
            )}
        </div>
    );
});
