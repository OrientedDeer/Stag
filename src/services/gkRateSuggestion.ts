import { SimulationYear } from "./simulation/types";
import {
    AssumptionsState,
    getBirthYear,
    getRetirementAge,
} from "../components/Objects/Assumptions/AssumptionsContext";

/**
 * Minimum gap (in percentage points) between the implied initial withdrawal
 * rate and the configured rate before we surface a suggestion. Keeps the tip
 * from firing on rounding noise / trivial differences.
 */
export const GK_RATE_SUGGESTION_THRESHOLD_PP = 0.25;

export interface GKRateSuggestion {
    /** Configured Guyton-Klinger initial withdrawal rate (%), e.g. 4. */
    configuredRate: number;
    /**
     * Initial rate (%) that the user's year-1 retirement spending actually
     * implies against the portfolio at retirement.
     */
    impliedRate: number;
    /** `impliedRate` rounded to a sensible apply value (0.1%). */
    suggestedRate: number;
    /** Year-1 retirement planned (pre-cap) living expenses used as numerator. */
    plannedSpending: number;
    /** Portfolio value at retirement used as denominator. */
    portfolioAtRetirement: number;
}

/**
 * Find the first retirement-year SimulationYear and pull out the planned
 * (pre-budget-cap) living expenses and the portfolio value at retirement.
 *
 * - Retirement year = birthYear + retirementAge (from milestones).
 * - Synthetic end-of-year projection rows are skipped so we land on a real
 *   plan year.
 * - "Planned spending" reconstructs the spending the user actually intended
 *   before any Guyton-Klinger / budget cap trimmed it: the year's reported
 *   `livingExpenses` already reflect the trimmed amount, so we add back the
 *   `strategyAdjustment.requiredAdjustment` (the dollar amount the budget cap
 *   wanted to cut). This is the spend that drives the amber budget-cap markers.
 * - "Portfolio at retirement" prefers the engine's own
 *   `strategyWithdrawal.initialPortfolio` (the portfolio it sized the initial
 *   withdrawal against); falls back to summing the year's account snapshot.
 */
export function getRetirementYearSpendingAndPortfolio(
    simulation: SimulationYear[],
    assumptions: AssumptionsState,
): { plannedSpending: number; portfolioAtRetirement: number } | null {
    if (simulation.length === 0) return null;

    const retirementYear =
        getBirthYear(assumptions.milestones) + getRetirementAge(assumptions.milestones);

    const yearData = simulation
        .filter((y) => !y.isEndOfYearProjection)
        .find((y) => y.year === retirementYear);

    if (!yearData) return null;

    // Planned (pre-cap) living expenses: reported living expenses already
    // reflect any budget-cap trim, so add back what the cap wanted to cut.
    const requiredAdjustment = yearData.strategyAdjustment?.guardrailTriggered !== 'prosperity'
        ? yearData.strategyAdjustment?.requiredAdjustment ?? 0
        : 0;
    const plannedSpending = yearData.cashflow.livingExpenses + requiredAdjustment;

    // Portfolio at retirement: prefer the engine's own figure, else sum the
    // year's account snapshot balances.
    const portfolioAtRetirement =
        yearData.strategyWithdrawal?.initialPortfolio
        ?? yearData.accounts.reduce((sum, acc) => sum + (acc.amount ?? 0), 0);

    if (portfolioAtRetirement <= 0) return null;

    return { plannedSpending, portfolioAtRetirement };
}

/**
 * Compute a Guyton-Klinger initial-withdrawal-rate suggestion.
 *
 * The implied initial rate = year-1 retirement planned spending ÷ portfolio at
 * retirement. When Guyton-Klinger (guardrails) is the active strategy and that
 * implied rate meaningfully exceeds the configured initial rate, the configured
 * rate is too low: the planned budget can't be funded at that rate, so the
 * simulation caps spending and stamps amber budget-cap markers throughout
 * retirement.
 *
 * Returns the suggestion only when it's worth surfacing (GK active and the gap
 * exceeds `GK_RATE_SUGGESTION_THRESHOLD_PP`); otherwise returns `null`.
 *
 * Pure: takes simulation results + assumptions, no React/context.
 */
export function computeGKRateSuggestion(
    simulation: SimulationYear[],
    assumptions: AssumptionsState,
    thresholdPP: number = GK_RATE_SUGGESTION_THRESHOLD_PP,
): GKRateSuggestion | null {
    // Only relevant when Guyton-Klinger is the active strategy.
    if (assumptions.investments.withdrawalStrategy !== 'Guyton Klinger') {
        return null;
    }

    const retirement = getRetirementYearSpendingAndPortfolio(simulation, assumptions);
    if (!retirement) return null;

    const { plannedSpending, portfolioAtRetirement } = retirement;
    if (plannedSpending <= 0) return null;

    const impliedRate = (plannedSpending / portfolioAtRetirement) * 100;
    const configuredRate = assumptions.investments.withdrawalRate;

    // Only flag when the implied rate meaningfully exceeds the configured rate.
    if (impliedRate - configuredRate <= thresholdPP) {
        return null;
    }

    // Round up to the nearest 0.1% so the applied rate actually covers the
    // implied spend (rounding down could leave it fractionally short).
    const suggestedRate = Math.ceil(impliedRate * 10) / 10;

    return {
        configuredRate,
        impliedRate,
        suggestedRate,
        plannedSpending,
        portfolioAtRetirement,
    };
}
