/**
 * Roth-conversion strategy: the single source of truth for the type, the default, and
 * the default-resolution (#89). Pure module (no React) so the executor in
 * services/simulation/YearSolver, the plan-build gates in useSimulation /
 * MonteCarloEngine, and the AssumptionsState definition can all share it without
 * pulling in the React context.
 */

/** Which algorithm decides the per-year Roth conversion amount when auto-conversions are on.
 *  - 'dp-precomputed' (default): whole-horizon backward-induction DP that maximizes after-tax
 *    terminal wealth (bracket-aware terminal).
 *  - 'std-ded-only': convert only the always-free standard-deduction headroom each year (no tax
 *    cost) — the conservative floor offered in the UI.
 *  - 'rate-match': per-year bracket walk vs the projected RMD-age marginal rate. LEGACY/internal
 *    only — no longer offered in the UI (persisted values migrate to 'std-ded-only'; see
 *    migrateAssumptions). Retained because the bracket-walk algorithm + its engine tests still
 *    exercise it via the `conversionMode` param. */
export type RothConversionStrategy = 'rate-match' | 'std-ded-only' | 'dp-precomputed';

/**
 * SINGLE SOURCE OF TRUTH for the strategy default (#89): the max-after-tax-wealth,
 * bracket-aware DP. 'std-ded-only' is the conservative alternative; 'rate-match' is legacy
 * (UI-removed). Used both as the declared default in `defaultAssumptions` and as the fallback
 * in `resolveRothConversionStrategy`, so the default literal lives in exactly one place.
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
