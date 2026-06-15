import { MonteCarloConfig, ScenarioResult, MonteCarloSummary } from './MonteCarloTypes';
import { SeededRandom } from './RandomGenerator';
import { analyzeScenario, summarizeScenarios } from './MonteCarloAggregator';
import { runSimulation, runSimulationWithOptimization } from '../components/Objects/Assumptions/useSimulation';
import { AnyAccount } from '../components/Objects/Accounts/models';
import { AnyIncome } from '../components/Objects/Income/models';
import { AnyExpense } from '../components/Objects/Expense/models';
import { AssumptionsState, getLifeExpectancy, getBirthYear } from '../components/Objects/Assumptions/AssumptionsContext';
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
/**
 * Pre-solved DP conversion plan reused across all MC paths (open-loop). The DP is
 * a precomputed strategy: unlike rate-match it needs a plan built up front, so a raw
 * single-pass runSimulation under the dp-precomputed default would convert $0. We
 * solve it ONCE deterministically (cheap relative to the per-path loop) and replay the
 * fixed per-year amounts on every path. Undefined when the strategy isn't dp-precomputed
 * (or tax optimization is off), in which case runSimulation's per-year rate-match runs.
 */
interface McConversionPlan { plan?: Map<number, number>; reserveAware: boolean; }
function buildMcConversionPlan(
    yearsToRun: number, accounts: AnyAccount[], incomes: AnyIncome[], expenses: AnyExpense[],
    assumptions: AssumptionsState, taxState: TaxState,
): McConversionPlan {
    const strategy = assumptions.investments.rothConversionStrategy ?? 'dp-precomputed';
    if (strategy !== 'dp-precomputed' || !assumptions.investments.taxOptimizationEnabled) {
        return { reserveAware: false };
    }
    const det = runSimulationWithOptimization(yearsToRun, accounts, incomes, expenses, assumptions, taxState);
    const plan = new Map<number, number>();
    for (const y of det) if ((y.rothConversion?.amount ?? 0) > 0) plan.set(y.year, y.rothConversion!.amount);
    return { plan, reserveAware: true }; // production dp-precomputed derives the bracket-aware terminal
}

function runSingleScenario(
    scenarioId: number,
    rng: SeededRandom,
    yearsToRun: number,
    config: MonteCarloConfig,
    accounts: AnyAccount[],
    incomes: AnyIncome[],
    expenses: AnyExpense[],
    assumptions: AssumptionsState,
    taxState: TaxState,
    mcPlan: McConversionPlan,
): ScenarioResult {
    // Generate random returns for this scenario
    // Use the configured mean/stdDev for return distribution
    const yearlyReturns = rng.generateReturns(
        yearsToRun,
        config.returnMean,
        config.returnStdDev
    );

    // Single-pass per path (MC's purpose is return-variance analysis, not re-optimizing
    // conversions per path). Replay the pre-solved DP plan (open-loop) when present;
    // otherwise runSimulation's per-year strategy (rate-match) runs as before. The
    // executor strategy is pinned to the resolved value so a legacy-unset
    // rothConversionStrategy doesn't make YearSolver fall back to rate-match and discard
    // the plan (see the same fix in runSimulationWithOptimization Pass 3).
    const execAssumptions: AssumptionsState = mcPlan.plan
        ? { ...assumptions, investments: { ...assumptions.investments, rothConversionStrategy: 'dp-precomputed' } }
        : assumptions;
    const timeline = runSimulation(
        yearsToRun, accounts, incomes, expenses, execAssumptions, taxState, yearlyReturns,
        undefined, 'rate-match', false, mcPlan.plan, undefined, undefined, undefined, undefined, mcPlan.reserveAware,
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
        getLifeExpectancy(assumptions.milestones) - (new Date().getFullYear() - getBirthYear(assumptions.milestones))
    );

    // Build the DP conversion plan ONCE (open-loop), replayed on every path below.
    const mcPlan = buildMcConversionPlan(yearsToRun, accounts, incomes, expenses, assumptions, taxState);

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
            taxState,
            mcPlan
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
        getLifeExpectancy(assumptions.milestones) - (new Date().getFullYear() - getBirthYear(assumptions.milestones))
    );

    const mcPlan = buildMcConversionPlan(yearsToRun, accounts, incomes, expenses, assumptions, taxState);

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
            taxState,
            mcPlan
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
