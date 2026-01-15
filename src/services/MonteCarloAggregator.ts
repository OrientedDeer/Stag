import {
    ScenarioResult,
    MonteCarloSummary,
    YearlyPercentile,
    PercentileData,
} from './MonteCarloTypes';
import { calculateNetWorth } from '../tabs/Future/tabs/FutureUtils';
import { SimulationYear } from '../components/Objects/Assumptions/SimulationEngine';
import { DeficitDebtAccount } from '../components/Objects/Accounts/models';

/**
 * Calculate success rate from scenario results
 * @param scenarios - Array of scenario results
 * @returns Percentage of successful scenarios (0-100)
 */
export function calculateSuccessRate(scenarios: ScenarioResult[]): number {
    if (scenarios.length === 0) return 0;
    const successful = scenarios.filter(s => s.success).length;
    return (successful / scenarios.length) * 100;
}

/**
 * Calculate a specific percentile value from sorted array
 * @param sortedValues - Array of values, must be sorted ascending
 * @param percentile - Percentile to calculate (0-100)
 * @returns The value at the specified percentile
 */
export function getPercentileValue(sortedValues: number[], percentile: number): number {
    if (sortedValues.length === 0) return 0;
    if (sortedValues.length === 1) return sortedValues[0];

    const index = (percentile / 100) * (sortedValues.length - 1);
    const lower = Math.floor(index);
    const upper = Math.ceil(index);

    if (lower === upper) {
        return sortedValues[lower];
    }

    // Linear interpolation between lower and upper bounds
    const fraction = index - lower;
    return sortedValues[lower] * (1 - fraction) + sortedValues[upper] * fraction;
}

/**
 * Calculate percentile data for all years from scenarios
 * @param scenarios - Array of scenario results
 * @returns Percentile data for p10, p25, p50, p75, p90
 */
export function calculatePercentiles(scenarios: ScenarioResult[]): PercentileData {
    if (scenarios.length === 0) {
        return {
            p10: [],
            p25: [],
            p50: [],
            p75: [],
            p90: [],
        };
    }

    // Get the number of years from first scenario
    const numYears = scenarios[0].timeline.length;

    const p10: YearlyPercentile[] = [];
    const p25: YearlyPercentile[] = [];
    const p50: YearlyPercentile[] = [];
    const p75: YearlyPercentile[] = [];
    const p90: YearlyPercentile[] = [];

    // For each year, collect net worth from all scenarios and calculate percentiles
    for (let yearIdx = 0; yearIdx < numYears; yearIdx++) {
        const year = scenarios[0].timeline[yearIdx].year;

        // Collect net worth values for this year across all scenarios
        const netWorths: number[] = scenarios.map(scenario => {
            if (yearIdx < scenario.timeline.length) {
                return calculateNetWorth(scenario.timeline[yearIdx].accounts);
            }
            return 0;
        });

        // Sort for percentile calculation
        netWorths.sort((a, b) => a - b);

        p10.push({ year, netWorth: getPercentileValue(netWorths, 10) });
        p25.push({ year, netWorth: getPercentileValue(netWorths, 25) });
        p50.push({ year, netWorth: getPercentileValue(netWorths, 50) });
        p75.push({ year, netWorth: getPercentileValue(netWorths, 75) });
        p90.push({ year, netWorth: getPercentileValue(netWorths, 90) });
    }

    return { p10, p25, p50, p75, p90 };
}

/**
 * Find scenario closest to a specific final net worth percentile
 * @param scenarios - Array of scenario results, sorted by final net worth
 * @param percentile - Target percentile (0-100)
 * @returns The scenario closest to that percentile
 */
export function findScenarioAtPercentile(
    scenarios: ScenarioResult[],
    percentile: number
): ScenarioResult {
    if (scenarios.length === 0) {
        throw new Error('No scenarios provided');
    }

    const sortedByNetWorth = [...scenarios].sort(
        (a, b) => a.finalNetWorth - b.finalNetWorth
    );

    const index = Math.floor((percentile / 100) * (sortedByNetWorth.length - 1));
    return sortedByNetWorth[index];
}

/**
 * Analyze a single scenario to determine success and key metrics
 * @param scenarioId - Unique identifier for this scenario
 * @param timeline - Full simulation timeline
 * @param yearlyReturns - Returns used in this scenario
 * @returns Analyzed scenario result
 */
export function analyzeScenario(
    scenarioId: number,
    timeline: SimulationYear[],
    yearlyReturns: number[]
): ScenarioResult {
    // Calculate final net worth
    const finalYear = timeline[timeline.length - 1];
    const finalNetWorth = calculateNetWorth(finalYear.accounts);

    // Find year of depletion (if any) - when deficit debt is created
    // This means expenses couldn't be covered by income + withdrawals
    // Note: Regular debt (mortgages, loans) doesn't count as failure
    let yearOfDepletion: number | null = null;
    for (let i = 0; i < timeline.length; i++) {
        const hasDeficitDebt = timeline[i].accounts.some(
            acc => acc instanceof DeficitDebtAccount
        );
        if (hasDeficitDebt) {
            yearOfDepletion = timeline[i].year;
            break;
        }
    }

    return {
        scenarioId,
        timeline,
        success: yearOfDepletion === null,
        finalNetWorth,
        yearOfDepletion,
        yearlyReturns,
    };
}

/**
 * Summarize all Monte Carlo scenarios into aggregate statistics
 * @param scenarios - Array of all scenario results
 * @param seed - Random seed used for reproducibility
 * @returns Comprehensive summary of results
 */
export function summarizeScenarios(
    scenarios: ScenarioResult[],
    seed: number
): MonteCarloSummary {
    if (scenarios.length === 0) {
        throw new Error('No scenarios to summarize');
    }

    // Calculate success metrics
    const successfulScenarios = scenarios.filter(s => s.success).length;
    const successRate = (successfulScenarios / scenarios.length) * 100;

    // Calculate percentiles
    const percentiles = calculatePercentiles(scenarios);

    // Find representative scenarios (worst, median, best)
    const sortedByNetWorth = [...scenarios].sort(
        (a, b) => a.finalNetWorth - b.finalNetWorth
    );

    const worstCase = sortedByNetWorth[0];
    const bestCase = sortedByNetWorth[sortedByNetWorth.length - 1];
    const medianIndex = Math.floor(sortedByNetWorth.length / 2);
    const medianCase = sortedByNetWorth[medianIndex];

    // Calculate trimmed average final net worth (excluding top and bottom 5%)
    const trimPercent = 0.05;
    const trimCount = Math.floor(sortedByNetWorth.length * trimPercent);
    const trimmedScenarios = sortedByNetWorth.slice(trimCount, sortedByNetWorth.length - trimCount);
    const trimmedTotal = trimmedScenarios.reduce((sum, s) => sum + s.finalNetWorth, 0);
    const averageFinalNetWorth = trimmedScenarios.length > 0
        ? trimmedTotal / trimmedScenarios.length
        : sortedByNetWorth[Math.floor(sortedByNetWorth.length / 2)].finalNetWorth;

    return {
        successRate,
        percentiles,
        worstCase,
        medianCase,
        bestCase,
        totalScenarios: scenarios.length,
        successfulScenarios,
        averageFinalNetWorth,
        seed,
    };
}

/**
 * Extract net worth timeline from a scenario for charting
 * @param scenario - A single scenario result
 * @returns Array of {year, netWorth} data points
 */
export function extractNetWorthTimeline(
    scenario: ScenarioResult
): YearlyPercentile[] {
    return scenario.timeline.map(year => ({
        year: year.year,
        netWorth: calculateNetWorth(year.accounts),
    }));
}

/**
 * Calculate statistical summary of final net worths
 * @param scenarios - Array of scenario results
 * @returns Statistics about final net worth distribution
 */
export function calculateFinalNetWorthStats(scenarios: ScenarioResult[]): {
    min: number;
    max: number;
    mean: number;
    median: number;
    stdDev: number;
} {
    if (scenarios.length === 0) {
        return { min: 0, max: 0, mean: 0, median: 0, stdDev: 0 };
    }

    const values = scenarios.map(s => s.finalNetWorth);
    const sorted = [...values].sort((a, b) => a - b);

    const min = sorted[0];
    const max = sorted[sorted.length - 1];
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
    const median = sorted[Math.floor(sorted.length / 2)];

    const squaredDiffs = values.map(v => Math.pow(v - mean, 2));
    const variance = squaredDiffs.reduce((sum, v) => sum + v, 0) / values.length;
    const stdDev = Math.sqrt(variance);

    return { min, max, mean, median, stdDev };
}
