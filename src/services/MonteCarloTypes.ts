import { SimulationYear } from '../components/Objects/Assumptions/SimulationEngine';
import { HISTORICAL_STATS } from '../data/HistoricalReturns';

/**
 * Configuration for Monte Carlo simulation
 */
export interface MonteCarloConfig {
    /** Whether Monte Carlo mode is enabled */
    enabled: boolean;
    /** Number of scenarios to run (100, 500, 1000) */
    numScenarios: number;
    /** Random seed for reproducibility */
    seed: number;
    /** Expected annual return percentage (e.g., 7 for 7%) */
    returnMean: number;
    /** Annual volatility/standard deviation (e.g., 15 for 15%) */
    returnStdDev: number;
    /** Selected preset key (for UI tracking) */
    preset: ReturnPresetKey;
    /** Tracks the inflation toggle state when returnMean was last set (survives unmount via localStorage) */
    lastInflationAdjusted?: boolean;
    /** Tracks the inflation rate from assumptions when the custom returnMean was last synced */
    lastInflationRate?: number;
    /** Tracks the assumptions investment return rate when the custom returnMean was last synced */
    lastRor?: number;
    /**
     * Run a second arm on the SAME random seeds with Roth conversions locked to the
     * standard-deduction-only baseline, and report the paired plan-vs-baseline
     * comparison (Δsuccess, paired after-tax deltas). Roughly doubles runtime, so
     * it defaults off. The baseline arm needs no policy solve.
     */
    compareToBaseline?: boolean;
}

/**
 * Return assumption presets based on historical data
 */
export type ReturnPresetKey = 'historical' | 'conservative' | 'custom';

export interface ReturnPreset {
    key: ReturnPresetKey;
    label: string;
    description: string;
    /**
     * Seed nominal return used only as the initial default in
     * {@link defaultMonteCarloConfig}. The displayed/synced nominal return is
     * NOT this static value — it is derived as `returnMeanReal + simInflation`
     * (see {@link getPresetReturnMean}) so the preset tracks the same inflation
     * rate the rest of the simulation runs on, rather than a frozen historic CPI.
     */
    returnMeanNominal: number;
    /** Real (inflation-OFF) return mean. Also the base for the derived nominal. */
    returnMeanReal: number;
    returnStdDev: number;
}

// Calculate real return from historical nominal returns and inflation
const historicalNominalReturn = Math.round(HISTORICAL_STATS.stocks.mean * 10) / 10;
const historicalRealReturn = Math.round(
    ((1 + HISTORICAL_STATS.stocks.mean / 100) / (1 + HISTORICAL_STATS.inflation.mean / 100) - 1) * 100 * 10
) / 10;
const historicalStdDev = Math.round(HISTORICAL_STATS.stocks.stdDev * 10) / 10;

export const RETURN_PRESETS: Record<ReturnPresetKey, ReturnPreset> = {
    historical: {
        key: 'historical',
        label: 'Historical S&P 500',
        description: `Based on ${HISTORICAL_STATS.stocks.startYear}-${HISTORICAL_STATS.stocks.endYear} data.`,
        returnMeanNominal: historicalNominalReturn,
        returnMeanReal: historicalRealReturn,
        returnStdDev: historicalStdDev,
    },
    conservative: {
        key: 'conservative',
        label: 'Conservative',
        description: 'Lower expected returns for more cautious planning.',
        returnMeanNominal: 6,
        returnMeanReal: 4,
        returnStdDev: 12,
    },
    custom: {
        key: 'custom',
        label: 'Custom',
        description: 'Set your own return assumptions.',
        returnMeanNominal: 7,
        returnMeanReal: 7,
        returnStdDev: 15,
    },
};

/**
 * Get the appropriate return mean for a preset given the inflation setting.
 *
 * When inflation adjustment is OFF, the simulation runs in real dollars, so the
 * preset's real return is used directly.
 *
 * When inflation adjustment is ON, the simulation runs in nominal dollars driven
 * by the *sim* inflation rate (`simInflationRate`), so the nominal return is
 * derived as `returnMeanReal + simInflationRate` — mirroring how the Custom
 * preset computes `ror + inflationRate`. Previously this returned the static
 * `returnMeanNominal`, which baked in a frozen historic CPI and ignored the sim
 * inflation rate (issue #109).
 *
 * @param simInflationRate The sim inflation rate (percent, e.g. 2 for 2%). Only
 *   used when `inflationAdjusted` is true. Defaults to 0 so a missing rate
 *   degrades to the real return rather than throwing.
 */
export function getPresetReturnMean(
    preset: ReturnPresetKey,
    inflationAdjusted: boolean,
    simInflationRate: number = 0
): number {
    const presetData = RETURN_PRESETS[preset];
    if (!inflationAdjusted) {
        return presetData.returnMeanReal;
    }
    // Derive nominal from the sim inflation rate; round to 1 decimal to match the
    // displayed precision and the Custom path's rounding.
    return Math.round((presetData.returnMeanReal + simInflationRate) * 10) / 10;
}

/**
 * Default Monte Carlo configuration using historical returns
 */
export const defaultMonteCarloConfig: MonteCarloConfig = {
    enabled: false,
    numScenarios: 100,
    seed: Date.now(),
    returnMean: RETURN_PRESETS.historical.returnMeanNominal, // Default assumes inflation-adjusted=true, so use nominal
    returnStdDev: RETURN_PRESETS.historical.returnStdDev,
    preset: 'historical',
};

/**
 * Result of a single Monte Carlo scenario
 */
export interface ScenarioResult {
    /** Unique identifier for this scenario */
    scenarioId: number;
    /** Full simulation timeline for this scenario */
    timeline: SimulationYear[];
    /** Whether the portfolio lasted until life expectancy */
    success: boolean;
    /** Final net worth at end of simulation */
    finalNetWorth: number;
    /** Year when portfolio was depleted (null if never) */
    yearOfDepletion: number | null;
    /** Array of yearly returns used in this scenario */
    yearlyReturns: number[];
}

/**
 * Net worth data point for a single year
 */
export interface YearlyPercentile {
    year: number;
    netWorth: number;
}

/**
 * Percentile data across all years
 */
export interface PercentileData {
    p10: YearlyPercentile[];
    p25: YearlyPercentile[];
    p50: YearlyPercentile[];
    p75: YearlyPercentile[];
    p90: YearlyPercentile[];
}

/** Terminal-distribution percentiles (single numbers, not per-year bands). */
export interface TerminalPercentiles {
    p10: number;
    p50: number;
    p90: number;
}

/**
 * Conversion-facing MC statistics (fp-review F11): folds over the per-path
 * timelines' recorded `rothConversion` amounts. Purely reporting — the
 * conversion decisions themselves come from the #98 policy, untouched here.
 */
export interface ConversionMcStats {
    /** p10/p50/p90 of the TOTAL $ converted per path across the horizon. */
    totalConverted: TerminalPercentiles;
    /** Fraction of paths (0-1) that executed any conversion at all. */
    fractionOfPathsConverting: number;
    /**
     * Buy-the-dip audit: median $ converted in years immediately FOLLOWING a
     * negative-return year, vs all other years, sampled inside each path's own
     * converting window. Null when the sample is empty.
     */
    medianConvertedAfterDownYear: number | null;
    medianConvertedAfterOtherYears: number | null;
}

/**
 * Paired plan-vs-baseline comparison (fp-review F7). The baseline arm re-runs
 * every path on the SAME return draws with conversions locked to the
 * std-ded-only baseline, so the per-path deltas are causal (common random
 * numbers), not cross-sectional band differences.
 */
export interface McBaselineComparison {
    /** Baseline arm's success rate (0-100). */
    baselineSuccessRate: number;
    /** Active − baseline success rate, in percentage points. */
    deltaSuccessRate: number;
    /** Failed-path counts per arm (same seeds, so directly comparable). */
    activeFailures: number;
    baselineFailures: number;
    /** Median depletion year among each arm's failed paths (null: no failures). */
    medianDepletionYearActive: number | null;
    medianDepletionYearBaseline: number | null;
    /**
     * Fraction of paths (0-1) whose terminal AFTER-TAX net worth ended strictly
     * below the same-seed baseline path's.
     */
    fractionBehindBaseline: number;
    /** Percentiles of the PAIRED per-path after-tax delta (active − baseline). */
    afterTaxDelta: TerminalPercentiles;
    /** Baseline arm's terminal after-tax percentiles (cross-sectional). */
    baselineAfterTax: TerminalPercentiles;
}

/**
 * Summary of Monte Carlo simulation results
 */
export interface MonteCarloSummary {
    /** Percentage of scenarios where portfolio lasted (0-100) */
    successRate: number;
    /** Percentile bands for net worth over time */
    percentiles: PercentileData;
    /** Worst outcome scenario (lowest final net worth) */
    worstCase: ScenarioResult;
    /** Median outcome scenario (50th percentile final net worth) */
    medianCase: ScenarioResult;
    /** Best outcome scenario (highest final net worth) */
    bestCase: ScenarioResult;
    /** Total number of scenarios run */
    totalScenarios: number;
    /** Number of successful scenarios */
    successfulScenarios: number;
    /** Average final net worth across all scenarios */
    averageFinalNetWorth: number;
    /** Seed used for reproducibility */
    seed: number;
    /**
     * Terminal AFTER-TAX net worth percentiles (fp-review F4): each path's
     * terminal balances valued through the situation-based Traditional
     * valuation ruler (buildTradValuation, built ONCE from the deterministic
     * std-ded baseline), so residual Traditional is NOT priced at 100 cents.
     * The nominal bands above stay unchanged. Undefined when the ruler wasn't
     * supplied (e.g. summaries built directly in older tests).
     */
    afterTaxPercentiles?: TerminalPercentiles;
    /** Conversion-facing stats (F11). Undefined only for pre-existing summaries. */
    conversionStats?: ConversionMcStats;
    /** Paired same-seed plan-vs-baseline comparison (F7); set only when the
     *  baseline arm ran (config.compareToBaseline). */
    baselineComparison?: McBaselineComparison;
}

/**
 * State for Monte Carlo context
 */
/**
 * Run phase (#98). 'solving' = the one-time stochastic-DP policy solve (the
 * per-scenario progress bar doesn't move during it); 'running' = the path loop.
 */
export type MonteCarloPhase = 'idle' | 'solving' | 'running';

export interface MonteCarloState {
    /** Current configuration */
    config: MonteCarloConfig;
    /** Results summary (null if not yet run) */
    summary: MonteCarloSummary | null;
    /** Whether simulation is currently running */
    isRunning: boolean;
    /** Progress percentage (0-100) */
    progress: number;
    /** Which phase the run is in (for the progress label). */
    phase: MonteCarloPhase;
    /** Error message if simulation failed */
    error: string | null;
}

/**
 * Initial state for Monte Carlo context
 */
export const initialMonteCarloState: MonteCarloState = {
    config: defaultMonteCarloConfig,
    summary: null,
    isRunning: false,
    progress: 0,
    phase: 'idle',
    error: null,
};

/**
 * Actions for Monte Carlo reducer
 */
export type MonteCarloAction =
    | { type: 'UPDATE_CONFIG'; payload: Partial<MonteCarloConfig> }
    | { type: 'START_SIMULATION' }
    | { type: 'UPDATE_PROGRESS'; payload: number }
    | { type: 'SET_PHASE'; payload: MonteCarloPhase }
    | { type: 'COMPLETE_SIMULATION'; payload: MonteCarloSummary }
    | { type: 'SIMULATION_ERROR'; payload: string }
    | { type: 'RESET' };

/**
 * Helper type for net worth calculation
 */
export interface NetWorthSnapshot {
    year: number;
    netWorth: number;
    totalAssets: number;
    totalLiabilities: number;
}
