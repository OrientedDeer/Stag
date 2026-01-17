import { MonteCarloConfig, ScenarioResult, MonteCarloSummary } from './MonteCarloTypes';
import { SeededRandom } from './RandomGenerator';
import { analyzeScenario, summarizeScenarios } from './MonteCarloAggregator';
import { runSimulation } from '../components/Objects/Assumptions/useSimulation';
import { AnyAccount } from '../components/Objects/Accounts/models';
import { AnyIncome } from '../components/Objects/Income/models';
import { AnyExpense } from '../components/Objects/Expense/models';
import { AssumptionsState } from '../components/Objects/Assumptions/AssumptionsContext';
import { TaxState } from '../components/Objects/Taxes/TaxContext';

/**
 * Run a single Monte Carlo scenario
 * @param scenarioId - Unique ID for this scenario
 * @param rng - Seeded random number generator
 * @param yearsToRun - Number of years to simulate
 * @param config - Monte Carlo configuration
 * @param accounts - Initial account state
 * @param incomes - Initial income state
 * @param expenses - Initial expense state
 * @param assumptions - Simulation assumptions
 * @param taxState - Tax configuration
 * @returns ScenarioResult for this scenario
 */
function runSingleScenario(
    scenarioId: number,
    rng: SeededRandom,
    yearsToRun: number,
    config: MonteCarloConfig,
    accounts: AnyAccount[],
    incomes: AnyIncome[],
    expenses: AnyExpense[],
    assumptions: AssumptionsState,
    taxState: TaxState
): ScenarioResult {
    // Generate random returns for this scenario
    // Use the configured mean/stdDev for return distribution
    const yearlyReturns = rng.generateReturns(
        yearsToRun,
        config.returnMean,
        config.returnStdDev
    );

    // Run the simulation with these returns
    const timeline = runSimulation(
        yearsToRun,
        accounts,
        incomes,
        expenses,
        assumptions,
        taxState,
        yearlyReturns
    );

    // Analyze and return the result
    return analyzeScenario(scenarioId, timeline, yearlyReturns);
}

/**
 * Progress callback type
 */
export type ProgressCallback = (progress: number) => void;

/**
 * Run Monte Carlo simulation with multiple scenarios
 * Uses chunked processing to avoid blocking the UI
 *
 * @param config - Monte Carlo configuration
 * @param accounts - Initial account state
 * @param incomes - Initial income state
 * @param expenses - Initial expense state
 * @param assumptions - Simulation assumptions
 * @param taxState - Tax configuration
 * @param onProgress - Callback for progress updates (0-100)
 * @returns Promise resolving to MonteCarloSummary
 */
export async function runMonteCarloSimulation(
    config: MonteCarloConfig,
    accounts: AnyAccount[],
    incomes: AnyIncome[],
    expenses: AnyExpense[],
    assumptions: AssumptionsState,
    taxState: TaxState,
    onProgress?: ProgressCallback
): Promise<MonteCarloSummary> {
    const rng = new SeededRandom(config.seed);
    const scenarios: ScenarioResult[] = [];

    // Calculate years to run based on life expectancy
    const yearsToRun = Math.max(0,
        assumptions.demographics.lifeExpectancy - (new Date().getFullYear() - assumptions.demographics.birthYear)
    );

    // Chunk size for yielding to UI
    const CHUNK_SIZE = 10;

    for (let i = 0; i < config.numScenarios; i++) {
        // Run a single scenario
        const result = runSingleScenario(
            i,
            rng,
            yearsToRun,
            config,
            accounts,
            incomes,
            expenses,
            assumptions,
            taxState
        );

        scenarios.push(result);

        // Report progress
        const progress = ((i + 1) / config.numScenarios) * 100;
        onProgress?.(progress);

        // Yield to UI every CHUNK_SIZE scenarios
        if ((i + 1) % CHUNK_SIZE === 0 && i < config.numScenarios - 1) {
            await new Promise(resolve => setTimeout(resolve, 0));
        }
    }

    // Summarize all scenarios
    return summarizeScenarios(scenarios, config.seed);
}

/**
 * Run Monte Carlo simulation synchronously (for testing)
 * Does not yield to UI - use only in tests or when blocking is acceptable
 */
export function runMonteCarloSimulationSync(
    config: MonteCarloConfig,
    accounts: AnyAccount[],
    incomes: AnyIncome[],
    expenses: AnyExpense[],
    assumptions: AssumptionsState,
    taxState: TaxState
): MonteCarloSummary {
    const rng = new SeededRandom(config.seed);
    const scenarios: ScenarioResult[] = [];

    const yearsToRun = Math.max(0,
        assumptions.demographics.lifeExpectancy - (new Date().getFullYear() - assumptions.demographics.birthYear)
    );

    for (let i = 0; i < config.numScenarios; i++) {
        const result = runSingleScenario(
            i,
            rng,
            yearsToRun,
            config,
            accounts,
            incomes,
            expenses,
            assumptions,
            taxState
        );

        scenarios.push(result);
    }

    return summarizeScenarios(scenarios, config.seed);
}

/**
 * Validate Monte Carlo configuration
 * @returns Error message if invalid, null if valid
 */
export function validateConfig(config: MonteCarloConfig): string | null {
    if (config.numScenarios < 1) {
        return 'Number of scenarios must be at least 1';
    }
    if (config.numScenarios > 10000) {
        return 'Number of scenarios cannot exceed 10,000';
    }
    if (config.returnStdDev < 0) {
        return 'Volatility (standard deviation) cannot be negative';
    }
    if (config.returnStdDev > 100) {
        return 'Volatility (standard deviation) cannot exceed 100%';
    }
    return null;
}

/**
 * Estimate time to run simulation based on config
 * @param numScenarios - Number of scenarios
 * @param yearsToRun - Years per scenario
 * @returns Estimated time in milliseconds
 */
export function estimateRunTime(numScenarios: number, yearsToRun: number): number {
    // Rough estimate: ~5ms per scenario-year on typical hardware
    const msPerScenarioYear = 5;
    return numScenarios * yearsToRun * msPerScenarioYear;
}
