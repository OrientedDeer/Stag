/**
 * Roth-conversion strategy: the single source of truth for the type, the default, and
 * the default-resolution (#89). Pure module (no React) so the executor in
 * services/simulation/YearSolver, the plan-build gates in useSimulation /
 * MonteCarloEngine, and the AssumptionsState definition can all share it without
 * pulling in the React context.
 */

/** Which algorithm decides the per-year Roth conversion amount when auto-conversions are on.
 *  'rate-match' = bracket-walk vs projected RMD-age marginal. 'dp-precomputed' = whole-horizon
 *  backward-induction DP that maximizes after-tax terminal wealth (bracket-aware terminal). */
export type RothConversionStrategy = 'rate-match' | 'dp-precomputed';

/**
 * SINGLE SOURCE OF TRUTH for the strategy default (#89): the max-after-tax-wealth,
 * bracket-aware DP. rate-match is the non-default conservative fallback. Used both as the
 * declared default in `defaultAssumptions` and as the fallback in
 * `resolveRothConversionStrategy`, so the default literal lives in exactly one place.
 */
export const DEFAULT_ROTH_CONVERSION_STRATEGY: RothConversionStrategy = 'dp-precomputed';

/**
 * Resolve the effective strategy for a (possibly legacy/unset) assumptions object. An
 * undefined field — saved before the strategy existed — resolves to the production default.
 * The executor (`selectConversionStrategy`), the plan-build gates (useSimulation /
 * MonteCarloEngine), and any other reader all go through this, so a built DP plan is never
 * silently discarded by a raw-undefined read falling back to rate-match.
 */
export const resolveRothConversionStrategy = (
    s: RothConversionStrategy | undefined,
): RothConversionStrategy => s ?? DEFAULT_ROTH_CONVERSION_STRATEGY;
