import { type SimulationYear } from "./simulation/types";
import {
    type AssumptionsState,
    getBirthYear,
    getRetirementAge,
} from "../components/Objects/Assumptions/AssumptionsContext";
import { sumInvestedAssets } from "../components/Objects/Accounts/accountUtils";
import { fundingRate } from "./WithdrawalStrategies";

export interface GKRateSuggestion {
    /**
     * Which way the configured initial rate is off relative to planned spending,
     * i.e. where it sits versus the rate the plan actually implies:
     * - `'raise'`: implied rate is higher than configured — the rate is too LOW,
     *   so the guardrail band is centered below your spending (you start near/over
     *   the upper guardrail).
     * - `'lower'`: implied rate is lower than configured — the rate is too HIGH,
     *   so the band is centered above your spending.
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
     * The rate to apply: `impliedRate` rounded UP to the nearest 0.1% — the
     * smallest tenth that still fully funds the planned spend. This is the SAME
     * value shown in the tip and set by the button, so the displayed and applied
     * numbers always agree.
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
 *   before any strategy adjustment moved it: the year's reported `livingExpenses`
 *   already reflect the adjusted amount, so we back out the dollar size of the
 *   move by guardrail direction — ADD it back on a capital-preservation CUT
 *   (reported spend was trimmed down), SUBTRACT it on a prosperity BOOST (reported
 *   spend was inflated up). We back out `actualAdjustment` (what the engine ACTUALLY
 *   moved), NOT `requiredAdjustment` (the TARGET it wanted): on a partial/failed
 *   cut — discretionary can't absorb the full target — the engine trims
 *   `livingExpenses` by only the applied amount, so adding back the larger target
 *   would reconstruct a plan HIGHER than the user ever set and inflate the implied
 *   rate. On a full cut or any boost `actualAdjustment === requiredAdjustment`, so
 *   this matches the unconstrained case exactly. The engine stores the same
 *   POSITIVE `actualAdjustment` for both directions (SimulationEngine.tsx:416), so
 *   the sign must come from the triggered guardrail, not the value. Under
 *   plan-anchored Guyton-Klinger the retirement year is usually within-band
 *   (nothing moved, so the add-back is 0); it only matters on a guardrail-cut/boost
 *   year or for the budget-cap strategies (Fixed Real / Percentage, which only ever
 *   cut, and likewise trim by the applied amount when fixed costs exceed budget).
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

    // Planned (pre-adjustment) living expenses: reported living expenses already
    // reflect any guardrail move, so back out the move to recover the original
    // plan. Use `actualAdjustment` — the (always-positive) dollars the engine
    // ACTUALLY moved — not `requiredAdjustment` (the target it wanted): on a
    // partial/failed capital-preservation cut the engine only trims by what
    // discretionary can absorb, so backing out the larger target would overshoot
    // the original plan and inflate the implied rate. The SIGN comes from the
    // triggered guardrail — a capital-preservation cut trimmed reported spend DOWN
    // (add it back), a prosperity boost inflated it UP (subtract it). It is 0 for
    // within-band years.
    const adjustment = yearData.strategyAdjustment;
    const actualAdjustment = adjustment?.actualAdjustment ?? 0;
    const signedAdjustment =
        adjustment?.guardrailTriggered === 'prosperity'
            ? -actualAdjustment
            : actualAdjustment;
    const plannedSpending = yearData.cashflow.livingExpenses + signedAdjustment;

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
 * Strategy-AGNOSTIC suggested initial withdrawal rate (%): the rate the user's
 * year-1 retirement planned spending implies against the portfolio at
 * retirement, rounded UP to the nearest 0.1% so it covers the spend.
 *
 * Unlike {@link computeGKRateSuggestion}, this does NOT gate on the active
 * strategy or on any threshold — it's the raw "what rate funds my plan?" value.
 * Used to seed the rate when the user first switches to Guyton-Klinger (at which
 * point the cached simulation still reflects the prior strategy, so
 * `computeGKRateSuggestion` would return `null`). Returns `null` when the
 * retirement-year spending/portfolio can't be derived.
 *
 * Pure: takes simulation results + assumptions, no React/context.
 */
export function suggestedInitialRate(
    simulation: SimulationYear[],
    assumptions: AssumptionsState,
): number | null {
    const retirement = getRetirementYearSpendingAndPortfolio(simulation, assumptions);
    if (!retirement) return null;

    const { plannedSpending, portfolioAtRetirement } = retirement;
    if (plannedSpending <= 0) return null;

    const impliedRate = (plannedSpending / portfolioAtRetirement) * 100;
    return fundingRate(impliedRate);
}

/**
 * The Guyton-Klinger AUTO-mode initial withdrawal rate (%) for a cached
 * simulation: the rate the engine derived at retirement and stamped on the
 * retirement-year `strategyWithdrawal.derivedInitialRate`. Falls back to
 * computing it from the retirement year's spending/portfolio (same math the
 * engine uses) when the stamp is absent — e.g. the cached simulation still
 * reflects a prior strategy or manual mode. Returns `null` when the
 * retirement year can't be found or the rate can't be derived.
 *
 * Intended for the UI's "Auto — currently X%" readout. Pure: takes simulation
 * results + assumptions, no React/context.
 */
export function getAutoRate(
    simulation: SimulationYear[],
    assumptions: AssumptionsState,
): number | null {
    if (simulation.length === 0) return null;

    const retirementYear =
        getBirthYear(assumptions.milestones) + getRetirementAge(assumptions.milestones);

    const yearData = simulation
        .filter((y) => !y.isEndOfYearProjection)
        .find((y) => y.year === retirementYear);

    const stamped = yearData?.strategyWithdrawal?.derivedInitialRate;
    if (stamped !== undefined) return stamped;

    return suggestedInitialRate(simulation, assumptions);
}

/**
 * Compute a Guyton-Klinger initial-withdrawal-rate suggestion.
 *
 * The implied initial rate = year-1 retirement planned spending ÷ portfolio at
 * retirement. The configured rate centers the Guyton-Klinger guardrail band, so
 * when it diverges from the implied rate the band is off-center relative to your
 * actual spending:
 *  - implied > configured (`direction: 'raise'`): the rate is too LOW — your plan
 *    sits near/above the upper guardrail, so a capital-preservation cut can fire
 *    early. Raising the rate re-centers the band on your spending.
 *  - implied < configured (`direction: 'lower'`): the rate is too HIGH — your plan
 *    sits near/below the lower guardrail, so a prosperity boost can fire early.
 *
 * Returns the suggestion only when it's worth surfacing: GK active and the
 * configured rate rounds to a different 0.1% than the funding rate. Otherwise
 * returns `null`.
 *
 * Pure: takes simulation results + assumptions, no React/context.
 */
export function computeGKRateSuggestion(
    simulation: SimulationYear[],
    assumptions: AssumptionsState,
): GKRateSuggestion | null {
    // Only relevant when Guyton-Klinger is the active strategy.
    if (assumptions.investments.withdrawalStrategy !== 'Guyton Klinger') {
        return null;
    }

    // In AUTO rate mode the engine derives the initial rate from the plan
    // itself at retirement, so the configured number can never drift from the
    // implied rate — there is nothing to suggest.
    if (assumptions.investments.withdrawalRateMode !== 'manual') {
        return null;
    }

    const retirement = getRetirementYearSpendingAndPortfolio(simulation, assumptions);
    if (!retirement) return null;

    const { plannedSpending, portfolioAtRetirement } = retirement;
    if (plannedSpending <= 0) return null;

    const impliedRate = (plannedSpending / portfolioAtRetirement) * 100;
    const configuredRate = assumptions.investments.withdrawalRate;
    // One value for both the tip text and the applied rate, so they agree.
    const suggestedRate = fundingRate(impliedRate);

    // Flag whenever the configured rate rounds to a DIFFERENT 0.1% than the rate
    // that funds the plan — i.e. whenever GK would actually cap (rate too low) or
    // systematically inflate (rate too high) spending at the precision you can
    // set. A percentage-point gap threshold is the wrong unit: on a large
    // portfolio even a sub-0.1pp gap is a real dollar cut, so the comparison must
    // be in rate-resolution terms, not a pp band. Comparing the rounded funding
    // rate also guarantees applying the suggestion clears the tip — suggestedRate
    // then equals configuredRate.
    if (Math.abs(suggestedRate - configuredRate) < 0.05) {
        return null;
    }

    const direction: 'raise' | 'lower' = suggestedRate > configuredRate ? 'raise' : 'lower';

    return {
        direction,
        configuredRate,
        impliedRate,
        suggestedRate,
        plannedSpending,
        portfolioAtRetirement,
    };
}
