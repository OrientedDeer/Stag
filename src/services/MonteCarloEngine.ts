import { MonteCarloConfig, ScenarioResult, MonteCarloSummary } from './MonteCarloTypes';
import { SeededRandom } from './RandomGenerator';
import { analyzeScenario, summarizeScenarios } from './MonteCarloAggregator';
import { runSimulation, buildMcConversionPolicy } from '../components/Objects/Assumptions/useSimulation';
import { AnyAccount } from '../components/Objects/Accounts/models';
import { DPPolicy } from './simulation/RothConversionDP';
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
 * Closed-loop DP conversion POLICY, solved ONCE per run and reused on every MC
 * path (#98, replaces the #93 scalar-ratio overlay).
 *
 * THE POLICY. The DP is turned STOCHASTIC: it integrates the return distribution
 * MC actually draws (Normal(mean, stdDev)) into the V-table transition and solves
 * once to produce the optimal conversion as a FUNCTION of (year, trad, roth)
 * state — see useSimulation.buildMcConversionPolicy / RothConversionDP. Each MC
 * path then LOOKS UP the policy at its realized state each year
 * (YearSolver.planConversionDP via lookupConversionPolicy) — a per-path
 * re-optimization of both the amount AND whether to convert, with no re-solve.
 *
 * WHY (vs the #93 overlay it replaces). #93 scaled a single deterministic plan by
 * realized/expected Traditional balance (clamped [0,1.5]) — cheap but it could
 * over-convert past the DP's bracket on bull paths, never ADD conversion years,
 * and under-trim across consecutive crashes. The policy re-optimizes from each
 * realized state, fixing all three. It stays non-anticipative by construction:
 * the policy integrates over the return DISTRIBUTION, never a path's realized
 * future, and each path advances on its own draw.
 *
 * `plan` is the policy's central (mean-trajectory) schedule, threaded as
 * `dpConversionPlan` so pre-retirement / no-policy years behave as before.
 * Undefined `policy` ⇒ strategy isn't dp-precomputed (or tax opt off) ⇒ MC falls
 * back to per-year rate-match.
 */
export interface McConversionPlan {
    plan?: Map<number, number>;
    /** Closed-loop conversion policy looked up per path/year (#98). */
    policy?: DPPolicy;
}
function buildMcConversionPlan(
    yearsToRun: number, accounts: AnyAccount[], incomes: AnyIncome[], expenses: AnyExpense[],
    assumptions: AssumptionsState, taxState: TaxState, config: MonteCarloConfig,
): McConversionPlan {
    const dpPlan = buildMcConversionPolicy(
        yearsToRun, accounts, incomes, expenses, assumptions, taxState,
        config.returnMean, config.returnStdDev,
    );
    if (!dpPlan) return {};
    return { plan: dpPlan.conversionsByYear, policy: dpPlan.policy };
}

/** Simulation horizon = life expectancy − current age (≥ 0). */
export function mcYearsToRun(assumptions: AssumptionsState): number {
    return Math.max(0,
        getLifeExpectancy(assumptions.milestones) - (new Date().getFullYear() - getBirthYear(assumptions.milestones)),
    );
}

/**
 * Solve the MC conversion plan/policy standalone (#98). Lets the worker compute
 * the policy once, cache it (policyCache), and pass it back via `precomputedPlan`
 * so the run doesn't re-solve. Returns {} when the strategy isn't dp-precomputed.
 */
export function solveMcConversionPlan(
    config: MonteCarloConfig, accounts: AnyAccount[], incomes: AnyIncome[], expenses: AnyExpense[],
    assumptions: AssumptionsState, taxState: TaxState,
): McConversionPlan {
    return buildMcConversionPlan(
        mcYearsToRun(assumptions), accounts, incomes, expenses, assumptions, taxState, config,
    );
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

    // Single-pass per path (MC's purpose is return-variance analysis, not a per-path DP
    // re-solve). The pre-solved closed-loop POLICY (#98) is looked up per year at this
    // path's REALIZED (trad, roth) state — re-optimizing the conversion from each state,
    // not scaling a fixed plan. `dpConversionPlan` carries the policy's central schedule
    // for pre-retirement / no-policy years. Without a policy (rate-match / opt-off) both
    // are undefined and ignored. No strategy re-pin needed: selectConversionStrategy
    // resolves an unset field to the dp-precomputed default, so the policy executes whether
    // the field is 'dp-precomputed' or undefined (legacy).
    const timeline = runSimulation(
        yearsToRun, accounts, incomes, expenses, assumptions, taxState, yearlyReturns,
        {
            dpConversionPlan: mcPlan.plan,
            mcConversionPolicy: mcPlan.policy,
        },
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
    onProgress?: ProgressCallback,
    /** Pre-solved (and possibly cached) plan/policy; skips the in-run solve (#98). */
    precomputedPlan?: McConversionPlan,
): Promise<MonteCarloSummary> {
    const rng = new SeededRandom(config.seed);
    const scenarios: ScenarioResult[] = [];

    const yearsToRun = mcYearsToRun(assumptions);

    // Solve the closed-loop conversion POLICY ONCE (#98), looked up per path below
    // — unless the caller pre-solved/cached it (worker path).
    const mcPlan = precomputedPlan
        ?? buildMcConversionPlan(yearsToRun, accounts, incomes, expenses, assumptions, taxState, config);

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
    taxState: TaxState,
    precomputedPlan?: McConversionPlan,
): MonteCarloSummary {
    const rng = new SeededRandom(config.seed);
    const scenarios: ScenarioResult[] = [];

    const yearsToRun = mcYearsToRun(assumptions);

    const mcPlan = precomputedPlan
        ?? buildMcConversionPlan(yearsToRun, accounts, incomes, expenses, assumptions, taxState, config);

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
