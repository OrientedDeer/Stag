import { MonteCarloConfig, ScenarioResult, MonteCarloSummary } from './MonteCarloTypes';
import { SeededRandom } from './RandomGenerator';
import { analyzeScenario, summarizeScenarios } from './MonteCarloAggregator';
import { runSimulation, runSimulationWithOptimization } from '../components/Objects/Assumptions/useSimulation';
import { AnyAccount, InvestedAccount } from '../components/Objects/Accounts/models';
import { SimulationYear } from './simulation/types';
import { getTotalTraditionalBalance } from './simulation/YearSolver';
import { AnyIncome } from '../components/Objects/Income/models';
import { AnyExpense } from '../components/Objects/Expense/models';
import { AssumptionsState, getLifeExpectancy, getBirthYear } from '../components/Objects/Assumptions/AssumptionsContext';
import { resolveRothConversionStrategy } from '../components/Objects/Assumptions/rothConversionStrategy';
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
/** Total Traditional (pre-tax 401k + IRA) balance in a SimulationYear's EOY accounts. */
function tradBalanceOf(year: SimulationYear): number {
    return year.accounts
        .filter((a): a is InvestedAccount =>
            a instanceof InvestedAccount &&
            (a.taxType === 'Traditional 401k' || a.taxType === 'Traditional IRA'))
        .reduce((sum, a) => sum + a.vestedAmount, 0);
}

/**
 * Pre-solved DP conversion plan reused across all MC paths, with a NON-ANTICIPATIVE
 * adaptive overlay (#93).
 *
 * THE PLAN (open-loop core). The DP is a precomputed strategy: unlike rate-match it
 * needs a plan built up front, so a raw single-pass runSimulation under the
 * dp-precomputed default would convert $0. We solve it ONCE deterministically against
 * the user's projection RoR (cheap relative to the per-path loop) and reuse it on every
 * path. Undefined when the strategy isn't dp-precomputed (or tax optimization is off),
 * in which case runSimulation's per-year rate-match runs.
 *
 * THE ADAPTIVE OVERLAY (#93). Replaying FIXED per-year dollar amounts on every path is
 * open-loop and least faithful on the left tail: on an early-crash path it still fires
 * "convert $X", draining stressed liquid assets to pay conversion tax — behavior an
 * adaptive retiree would trim. Instead of re-solving the DP per path per year (~30k
 * solves/run, rejected), we capture from the SAME deterministic solve the EXPECTED
 * start-of-year Traditional balance the plan assumed each year (`expectedTradByYear`),
 * and hand it to the simulation. Per year, the DP conversion strategy scales the planned
 * amount by the ratio of the path's REALIZED start-of-year Traditional balance to that
 * expected balance (clamped, see YearSolver.planConversionDP / MC_ADAPTIVE_RATIO_CAP).
 *
 * WHERE ON THE CHEAP↔RICHER SPECTRUM. This sits in the MIDDLE: richer than a binary
 * "skip conversions in drawdown years" gate (it scales continuously by realized
 * depletion), but far cheaper than a per-year bracket-aware re-solve — it costs one map
 * lookup + one multiply per conversion year and adds ZERO extra simulations beyond the
 * single deterministic solve already done here. The realized Traditional balance is the
 * right signal because it tracks BOTH the conversion source AND portfolio stress: a
 * crash shrinks Traditional, so the rule converts proportionally less, which in turn
 * pulls proportionally less tax from the stressed liquid accounts.
 *
 * GENERALIZATION GUARANTEE. The expected balances come from the deterministic projection
 * that produced the plan, so on a path whose returns track that projection the realized
 * balance equals the expected balance, the ratio is 1, and the scaled amount equals the
 * planned amount EXACTLY. The overlay is therefore a strict generalization of the
 * open-loop plan: identical conversions on the central/on-track path, diverging only as
 * realized balances drift. This keeps the MC median consistent with the deterministic
 * projection shown elsewhere. NON-ANTICIPATIVE: the ratio uses only the balance realized
 * up to the current year — never future returns.
 *
 * LIMITATIONS (documented tradeoffs of the cheap non-anticipative design, not bugs):
 * - Trims do NOT compound cleanly across consecutive crash years. `expectedTrad` is the
 *   deterministic baseline that assumed FULL (un-trimmed) prior conversions, so once an
 *   earlier year is trimmed, realized Traditional is HIGHER than the baseline and later
 *   crash-year ratios are biased up — later years are under-trimmed.
 * - The overlay only SCALES existing plan-conversion years; it never ADDS conversion years
 *   (expectedTradByYear/plan are populated only where the deterministic DP converted, and
 *   planConversionDP gates on plannedConversion > 0). So sustained bull paths under-convert
 *   vs a wealth-level re-optimization, and the median-consistency guarantee is tight only
 *   near the central path — upper-percentile bands understate conversions.
 */
interface McConversionPlan {
    plan?: Map<number, number>;
    /** Expected start-of-year Traditional balance per conversion year (#93). */
    expectedTradByYear?: Map<number, number>;
}
function buildMcConversionPlan(
    yearsToRun: number, accounts: AnyAccount[], incomes: AnyIncome[], expenses: AnyExpense[],
    assumptions: AssumptionsState, taxState: TaxState,
): McConversionPlan {
    const strategy = resolveRothConversionStrategy(assumptions.investments.rothConversionStrategy);
    if (strategy !== 'dp-precomputed' || !assumptions.investments.taxOptimizationEnabled) {
        return {};
    }
    const det = runSimulationWithOptimization(yearsToRun, accounts, incomes, expenses, assumptions, taxState);
    const plan = new Map<number, number>();
    // Index the deterministic timeline by year so we can read the prior year's
    // END-OF-YEAR Traditional balance = the conversion year's START-OF-YEAR balance
    // (SimulationYear records EOY state; planConversionDP reads start-of-year, i.e.
    // pre-conversion, balance).
    const detByYear = new Map<number, SimulationYear>();
    for (const y of det) detByYear.set(y.year, y);
    const expectedTradByYear = new Map<number, number>();
    for (const y of det) {
        if ((y.rothConversion?.amount ?? 0) <= 0) continue;
        plan.set(y.year, y.rothConversion!.amount);
        const prior = detByYear.get(y.year - 1);
        // Start-of-year Trad = end-of-prior-year Trad. If no prior year is in the
        // timeline (conversion in the very first sim year), fall back to today's
        // Traditional balance — the same start-of-year state the path begins from.
        const expectedTrad = prior
            ? tradBalanceOf(prior)
            : getTotalTraditionalBalance(accounts);
        expectedTradByYear.set(y.year, expectedTrad);
    }
    return { plan, expectedTradByYear };
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
    // re-solve). Reuse the pre-solved DP plan when present, but apply it through the #93
    // NON-ANTICIPATIVE adaptive overlay: `mcPlan.expectedTradByYear` lets the DP strategy
    // scale each year's planned conversion by realized/expected Traditional balance, so a
    // crash path trims conversions while an on-track path converts exactly the plan (the
    // overlay reduces to the open-loop plan when the ratio is 1 — see buildMcConversionPlan).
    // Without a DP plan (rate-match / opt-off) the extra map is undefined and ignored. No
    // strategy re-pin needed: selectConversionStrategy resolves an unset field to the
    // dp-precomputed default, so the plan executes whether the field is 'dp-precomputed' or
    // undefined (legacy).
    const timeline = runSimulation(
        yearsToRun, accounts, incomes, expenses, assumptions, taxState, yearlyReturns,
        undefined, 'rate-match', false, mcPlan.plan, undefined, undefined, undefined, undefined,
        mcPlan.expectedTradByYear,
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
