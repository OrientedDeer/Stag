import { type AssumptionsState, getBirthYear } from '../../components/Objects/Assumptions/AssumptionsContext';

/**
 * Asset allocation resolution (#207).
 *
 * The global return is split into a STOCK rate (`returnRates.ror`, the legacy key) and a
 * BOND rate (`returnRates.bondRor`). An account's effective pre-inflation, pre-expense-ratio
 * return is the balance-agnostic blend of the two at its stock/bond mix.
 *
 * Every consumer of "what rate does this account grow at" MUST route through here —
 * notably the account `increment()` methods, `RothConversionDP.getNetGrowthRate` /
 * `getRothGrowthRate`, and the `rorBase` construction in `useSimulation`. Those last two
 * encode the #98 invariant that the DP's drift matches what Monte Carlo actually applies;
 * a second, divergent implementation of the blend is precisely how that invariant breaks.
 *
 * Backward compatibility: `defaultAllocation.stockPct` defaults to 100, at which
 * `blendRate(100, ...) === ror` exactly (no floating-point residue — see `blendRate`),
 * so plans saved before #207 project identically.
 */

/**
 * One year's drawn returns (#208). Monte Carlo supplies both legs; a bare `number`
 * is still accepted everywhere a draw is taken and means "stock only, bond leg
 * deterministic" — the pre-#208 behavior, kept so non-MC callers and the many tests
 * that pass a scalar override are unaffected.
 */
export interface ReturnDraw {
    /** Drawn STOCK return this year, in percent, nominal if the plan runs nominal. */
    stock: number;
    /** Drawn BOND return this year, same units. */
    bond: number;
}

/**
 * Does any part of this plan hold bonds?
 *
 * Used to decide whether Monte Carlo needs to draw a bond series at all (#208). This is
 * NOT just an optimization: the two return legs share one RNG stream, so drawing bonds
 * for an all-stock plan would consume extra uniforms and shift every subsequent
 * scenario's stock draws — changing results for users who hold no bonds. Skipping the
 * bond pass keeps an all-stock run's stream consumption byte-identical to pre-#208.
 *
 * Checks the default allocation, both glidepath endpoints (it can dip below 100% at any
 * point along the path), and every per-account override.
 */
export function planHasBondExposure(
    accounts: readonly AllocatedAccount[],
    assumptions: AssumptionsState,
): boolean {
    if ((assumptions.investments.defaultAllocation?.stockPct ?? 100) < 100) return true;
    const glide = assumptions.investments.allocationGlidepath;
    if (glide?.enabled && Math.min(glide.startStockPct, glide.endStockPct) < 100) return true;
    return accounts.some(a => a.stockPct !== undefined && a.stockPct < 100);
}

/**
 * The STOCK leg of a draw. ESPP/RSU are pinned to 100% stock (#207 — a part-bond rate
 * applied to a single stock's share price is incoherent), so they consume this directly
 * rather than blending.
 */
export function stockLegOf(draw: number | ReturnDraw | undefined): number | undefined {
    if (draw === undefined) return undefined;
    return typeof draw === 'number' ? draw : draw.stock;
}

/**
 * Standard deviation of a two-asset portfolio at stock weight `w` (a FRACTION, 0-1).
 *
 *     sigma_p = sqrt( w^2*ss^2 + (1-w)^2*sb^2 + 2*w*(1-w)*rho*ss*sb )
 *
 * With `bondStdDev = 0` this reduces to `w * stockStdDev` — the pre-#208 expression,
 * so callers that don't supply bond risk are unchanged.
 */
export function blendedPortfolioStdDev(
    stockWeight: number,
    stockStdDev: number,
    bondStdDev: number,
    correlation: number,
): number {
    const w = Math.min(1, Math.max(0, stockWeight));
    const rho = Math.min(1, Math.max(-1, correlation));
    const variance =
        w * w * stockStdDev * stockStdDev
        + (1 - w) * (1 - w) * bondStdDev * bondStdDev
        + 2 * w * (1 - w) * rho * stockStdDev * bondStdDev;
    // A correlation near -1 can drive the analytic variance marginally below zero
    // through floating-point error; clamp rather than return NaN.
    return Math.sqrt(Math.max(0, variance));
}

/** An account that can carry a per-account allocation override. */
export interface AllocatedAccount {
    /** Stock share 0-100. `undefined` ⇒ inherit the default allocation / glidepath. */
    stockPct?: number;
}

const clampPct = (pct: number): number => Math.min(100, Math.max(0, pct));

/**
 * Blend stock and bond rates at `stockPct`.
 *
 * The two endpoints are returned verbatim rather than computed, so an all-stock account
 * yields `stock` bit-for-bit — the golden-master snapshots depend on that being exact,
 * not merely close (`100/100 * r + 0 * b` can perturb the last mantissa bit).
 */
export function blendRate(stockPct: number, stock: number, bond: number): number {
    const pct = clampPct(stockPct);
    if (pct === 100) return stock;
    if (pct === 0) return bond;
    const w = pct / 100;
    return w * stock + (1 - w) * bond;
}

/**
 * The DEFAULT stock share for a given calendar year, honoring the glidepath when enabled.
 *
 * `year` is a calendar year (the simulation's own unit). A falsy/absent year means "no
 * particular year" — several call sites and older tests invoke `increment()` without one
 * (the parameter defaults to 0) — and resolves to the flat default rather than computing
 * an age of `-birthYear` and clamping to a glidepath endpoint.
 */
export function defaultStockPctForYear(assumptions: AssumptionsState, year?: number): number {
    const glide = assumptions.investments.allocationGlidepath;
    const flat = clampPct(assumptions.investments.defaultAllocation?.stockPct ?? 100);
    if (!glide?.enabled || !year) return flat;

    const age = year - getBirthYear(assumptions.milestones);
    const { startAge, endAge, startStockPct, endStockPct } = glide;

    // Degenerate band (endAge <= startAge): treat the whole timeline as "past the end".
    if (endAge <= startAge) return clampPct(endStockPct);
    if (age <= startAge) return clampPct(startStockPct);
    if (age >= endAge) return clampPct(endStockPct);

    const t = (age - startAge) / (endAge - startAge);
    return clampPct(startStockPct + t * (endStockPct - startStockPct));
}

/**
 * The stock share for a specific account. An explicit per-account `stockPct` wins over the
 * default AND over the glidepath — an account the user has pinned is deliberately opted out
 * of the automatic drift.
 */
export function resolveStockPct(
    account: AllocatedAccount,
    assumptions: AssumptionsState,
    year?: number,
): number {
    if (account.stockPct !== undefined && Number.isFinite(account.stockPct)) {
        return clampPct(account.stockPct);
    }
    return defaultStockPctForYear(assumptions, year);
}

/**
 * The blended return implied by the DEFAULT allocation for a year — i.e. the rate an
 * account with no `stockPct` of its own would use. This is the #207 replacement for the
 * bare `returnRates.ror` fallbacks that appear wherever there is no specific account to
 * weight against (empty portfolios, projections, advisory estimates).
 */
export function defaultBlendedRoR(assumptions: AssumptionsState, year?: number): number {
    const { ror, bondRor } = assumptions.investments.returnRates;
    return blendRate(defaultStockPctForYear(assumptions, year), ror, bondRor ?? ror);
}

/**
 * The account's blended return, BEFORE inflation and BEFORE the expense ratio — i.e. a
 * drop-in replacement for what used to be `assumptions.investments.returnRates.ror`.
 *
 * Does NOT consider `customROR`: that override bypasses the blend entirely and stays the
 * caller's concern, so this function keeps a single meaning ("the allocation-implied rate").
 */
export function blendedRoR(
    account: AllocatedAccount,
    assumptions: AssumptionsState,
    year?: number,
): number {
    const { ror, bondRor } = assumptions.investments.returnRates;
    return blendRate(resolveStockPct(account, assumptions, year), ror, bondRor ?? ror);
}

/**
 * The rate an account actually grows at, pre-inflation and pre-expense-ratio: an explicit
 * `customROR` if set, otherwise the allocation blend. This is the single expression of the
 * `customROR > allocation` precedence — the DP and `rorBase` weightings use it so they can
 * never drift from what `increment()` does.
 */
export function effectiveRoR(
    account: AllocatedAccount & { customROR?: number },
    assumptions: AssumptionsState,
    year?: number,
): number {
    if (account.customROR !== undefined) return account.customROR;
    return blendedRoR(account, assumptions, year);
}

/**
 * Monte Carlo blend: combine this year's drawn stock and bond returns at the account's
 * allocation.
 *
 * Two forms of `drawn`:
 *  - `ReturnDraw` (#208): both legs were drawn from the correlated generator, so the bond
 *    leg carries its own volatility. This is what Monte Carlo passes.
 *  - `number` (pre-#208): the stock leg only. The bond leg falls back to the DETERMINISTIC
 *    `bondRor`, which understates risk for bond-bearing portfolios — retained only for
 *    callers that supply a scalar override.
 *
 * Units: a drawn return is NOMINAL when `inflationAdjusted` is on (the MC preset mean
 * already includes inflation), while `bondRor` is stored in the same real terms as `ror`.
 * The DETERMINISTIC fallback therefore needs inflation added before blending — without it,
 * bond-heavy accounts undershoot by the inflation rate in Monte Carlo only, which reads
 * exactly like a drift-mismatch bug in the DP. A drawn bond leg is already in the right
 * units and must NOT be adjusted again.
 */
export function blendedMonteCarloReturn(
    account: AllocatedAccount,
    assumptions: AssumptionsState,
    drawn: number | ReturnDraw,
    year?: number,
): number {
    const stockPct = resolveStockPct(account, assumptions, year);
    const stockLeg = typeof drawn === 'number' ? drawn : drawn.stock;
    if (stockPct === 100) return stockLeg;
    if (typeof drawn !== 'number') return blendRate(stockPct, stockLeg, drawn.bond);
    const inflation = assumptions.macro.inflationAdjusted ? assumptions.macro.inflationRate : 0;
    const bondNominal = (assumptions.investments.returnRates.bondRor ?? 0) + inflation;
    return blendRate(stockPct, stockLeg, bondNominal);
}
