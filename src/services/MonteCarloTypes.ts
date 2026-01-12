import { SimulationYear } from '../components/Objects/Assumptions/SimulationEngine';

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
}

/**
 * Default Monte Carlo configuration
 */
export const defaultMonteCarloConfig: MonteCarloConfig = {
    enabled: false,
    numScenarios: 100,
    seed: Date.now(),
    returnMean: 7,      // 7% real return (historical average)
    returnStdDev: 15,   // 15% volatility (historical S&P 500)
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
