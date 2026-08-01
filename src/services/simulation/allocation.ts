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
 * Monte Carlo blend: the drawn series is the STOCK return, blended against the bond rate.
 *
 * `drawnReturn` is NOMINAL when `inflationAdjusted` is on (the MC preset mean already
 * includes inflation), while `bondRor` is stored in the same real terms as `ror`. The bond
 * leg therefore needs inflation added before blending — without it, bond-heavy accounts
 * undershoot by the inflation rate in Monte Carlo only, which reads exactly like a
 * drift-mismatch bug in the DP.
 */
export function blendedMonteCarloReturn(
    account: AllocatedAccount,
    assumptions: AssumptionsState,
    drawnReturn: number,
    year?: number,
): number {
    const stockPct = resolveStockPct(account, assumptions, year);
    if (stockPct === 100) return drawnReturn;
    const inflation = assumptions.macro.inflationAdjusted ? assumptions.macro.inflationRate : 0;
    const bondNominal = (assumptions.investments.returnRates.bondRor ?? 0) + inflation;
    return blendRate(stockPct, drawnReturn, bondNominal);
}
