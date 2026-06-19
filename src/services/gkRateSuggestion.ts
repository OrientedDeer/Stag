import { SimulationYear } from "./simulation/types";
import {
    AssumptionsState,
    getBirthYear,
    getRetirementAge,
} from "../components/Objects/Assumptions/AssumptionsContext";
import { sumInvestedAssets } from "../components/Objects/Accounts/accountUtils";

/**
 * Minimum gap (in percentage points) between the implied initial withdrawal
 * rate and the configured rate before we surface a suggestion. Keeps the tip
 * from firing on rounding noise / trivial differences.
 */
export const GK_RATE_SUGGESTION_THRESHOLD_PP = 0.25;

export interface GKRateSuggestion {
    /**
     * Which way the configured rate is off relative to planned spending:
     * - `'raise'`: implied rate is higher than configured — the rate is too LOW,
     *   so Guyton-Klinger caps spending (amber budget-cap markers).
     * - `'lower'`: implied rate is lower than configured — the rate is too HIGH,
     *   so the prosperity guardrail keeps boosting spending above the plan.
     */
    direction: 'raise' | 'lower';
    /** Configured Guyton-Klinger initial withdrawal rate (%), e.g. 4. */
    configuredRate: number;
    /**
     * Initial rate (%) that the user's year-1 retirement spending actually
     * implies against the portfolio at retirement.
     */
    impliedRate: number;
    /**
     * `impliedRate` rounded to a sensible apply value (0.1%). Rounded UP for the
     * `'raise'` case (so the rate covers the planned spend) and DOWN for the
     * `'lower'` case (so the rate doesn't overshoot it).
     */
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
    // `requiredAdjustment` is the dollar amount the cap wanted to trim and is 0
    // for non-cut years — prosperity *increases* are tracked in actualAdjustment,
    // never here — so this reconstructs the user's original planned spend.
    const requiredAdjustment = yearData.strategyAdjustment?.requiredAdjustment ?? 0;
    const plannedSpending = yearData.cashflow.livingExpenses + requiredAdjustment;

    // Portfolio at retirement: prefer the engine's own figure, else sum the
    // year's invested-asset balances using the SAME set the engine sizes the
    // withdrawal budget against (so the denominator can't drift).
    const portfolioAtRetirement =
        yearData.strategyWithdrawal?.initialPortfolio
        ?? sumInvestedAssets(yearData.accounts);

    if (portfolioAtRetirement <= 0) return null;

    return { plannedSpending, portfolioAtRetirement };
}

/**
 * Compute a Guyton-Klinger initial-withdrawal-rate suggestion.
 *
 * The implied initial rate = year-1 retirement planned spending ÷ portfolio at
 * retirement. When Guyton-Klinger (guardrails) is the active strategy and that
 * implied rate diverges meaningfully from the configured initial rate, the
 * configured rate is off in one of two ways:
 *  - implied > configured (`direction: 'raise'`): the rate is too LOW — the
 *    planned budget can't be funded at that rate, so the simulation caps
 *    spending and stamps amber budget-cap markers throughout retirement.
 *  - implied < configured (`direction: 'lower'`): the rate is too HIGH — the
 *    prosperity guardrail keeps firing and boosts spending above the plan.
 *
 * Returns the suggestion only when it's worth surfacing (GK active and the gap
 * in EITHER direction exceeds `GK_RATE_SUGGESTION_THRESHOLD_PP`); otherwise
 * returns `null`.
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
    const gap = impliedRate - configuredRate;

    // Only flag when the implied rate meaningfully DIVERGES from the configured
    // rate — in either direction. Within the threshold band the rates agree
    // closely enough that GK won't systematically cap or boost spending.
    if (Math.abs(gap) <= thresholdPP) {
        return null;
    }

    const direction: 'raise' | 'lower' = gap > 0 ? 'raise' : 'lower';

    // Round to the nearest 0.1%, biased so the applied rate lands on the safe
    // side of the implied spend:
    //  - 'raise' (rate too low): round UP so the rate covers the implied spend
    //    (rounding down could leave it fractionally short).
    //  - 'lower' (rate too high): round DOWN so the rate doesn't overshoot the
    //    plan and keep the prosperity guardrail firing.
    // The ±1e-9 epsilon absorbs IEEE-754 noise (e.g. 5.8 arriving as
    // 5.800000000000001) so a clean tenth isn't nudged an extra 0.1%.
    const suggestedRate =
        direction === 'raise'
            ? Math.ceil(impliedRate * 10 - 1e-9) / 10
            : Math.floor(impliedRate * 10 + 1e-9) / 10;

    return {
        direction,
        configuredRate,
        impliedRate,
        suggestedRate,
        plannedSpending,
        portfolioAtRetirement,
    };
}
