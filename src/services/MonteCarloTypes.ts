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
}

/**
 * Return assumption presets based on historical data
 */
export type ReturnPresetKey = 'historical' | 'conservative' | 'custom';

export interface ReturnPreset {
    key: ReturnPresetKey;
    label: string;
    description: string;
    /** Return mean when inflation adjustment is OFF (nominal returns) */
    returnMeanNominal: number;
    /** Return mean when inflation adjustment is ON (real returns) */
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
 * Get the appropriate return mean based on inflation adjustment setting
 * When inflation adjustment is ON, use nominal returns (simulation adjusts for inflation)
 * When inflation adjustment is OFF, use real returns (already inflation-adjusted)
 */
export function getPresetReturnMean(preset: ReturnPresetKey, inflationAdjusted: boolean): number {
    const presetData = RETURN_PRESETS[preset];
    return inflationAdjusted ? presetData.returnMeanNominal : presetData.returnMeanReal;
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
}

/**
 * State for Monte Carlo context
 */
export interface MonteCarloState {
    /** Current configuration */
    config: MonteCarloConfig;
    /** Results summary (null if not yet run) */
    summary: MonteCarloSummary | null;
    /** Whether simulation is currently running */
    isRunning: boolean;
    /** Progress percentage (0-100) */
    progress: number;
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
    error: null,
};

/**
 * Actions for Monte Carlo reducer
 */
export type MonteCarloAction =
    | { type: 'UPDATE_CONFIG'; payload: Partial<MonteCarloConfig> }
    | { type: 'START_SIMULATION' }
    | { type: 'UPDATE_PROGRESS'; payload: number }
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
