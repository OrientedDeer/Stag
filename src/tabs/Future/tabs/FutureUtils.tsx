import { type AnyAccount, ESPPAccount, InvestedAccount, RSUAccount } from '../../../components/Objects/Accounts/models';
import { type SimulationYear } from '../../../components/Objects/Assumptions/SimulationEngine';
import { type AssumptionsState, getBirthYear } from '../../../components/Objects/Assumptions/AssumptionsContext';
import { type TaxState, resolveTaxEventsForYear } from '../../../components/Objects/Taxes/TaxContext';
import { getProjectedRMDMarginalRate } from '../../../services/TaxOptimizationService';
import { buildMilestoneReachYears } from '../../../services/simulation/MilestoneEvaluator';
import { bracketAwareTradExitValue, HEIR_EXIT_RATE } from '../../../services/simulation/RothConversionDP';
import * as TaxService from '../../../components/Objects/Taxes/TaxService';

// getAccountTotals is the app's canonical net-worth definition. It now lives in
// a provider-neutral module next to the account models so services (Excel export,
// projection history) can single-source it without importing from src/tabs.
// Re-exported here so every existing importer keeps its FutureUtils import path.
export { getAccountTotals } from '../../../components/Objects/Accounts/accountTotals';
import { getAccountTotals } from '../../../components/Objects/Accounts/accountTotals';

export function calculateNetWorth(accounts: AnyAccount[]): number {
    return getAccountTotals(accounts).netWorth;
}

/**
 * Net worth split into its Gross / Unvested / Vested parts (#143).
 *
 * The display surfaces (Dashboard net-worth card, Overview + Data tabs) lead with
 * the VESTED net worth — what you actually own today — and surface the gross and
 * unvested figures alongside it. This is the single source for that math:
 *   - `gross`      = getAccountTotals(accounts).netWorth — assets − liabilities,
 *                    counting the FULL InvestedAccount balance (the engine /
 *                    optimizer / Monte Carlo definition; UNCHANGED).
 *   - `unvested`   = Σ InvestedAccount.nonVestedAmount — the employer-match portion
 *                    you don't own until it vests.
 *   - `vested`     = gross − unvested — net worth excluding the unvested match.
 *
 * NOTE: intentionally does NOT change `getAccountTotals` / `calculateNetWorth`.
 * Those stay gross because they feed the Roth optimizer's after-tax-wealth ruler,
 * Monte Carlo, Scenarios, and the projection-history snapshots, none of which
 * should shift. This helper is additive — a display-only breakdown layered on top.
 */
export function getNetWorthBreakdown(accounts: AnyAccount[]): {
    assets: number;
    liabilities: number;
    gross: number;
    unvested: number;
    vested: number;
} {
    const { assets, liabilities, netWorth: gross } = getAccountTotals(accounts);

    let unvested = 0;
    for (const acc of accounts) {
        if (acc instanceof InvestedAccount) {
            unvested += acc.nonVestedAmount;
        }
    }

    return { assets, liabilities, gross, unvested, vested: gross - unvested };
}

/**
 * Capital-gains rate applied to unrealized gains in taxable accounts when
 * estimating after-tax net worth. A representative long-term rate — most
 * retirees realizing gains land in the 15% LTCG bracket.
 */
export const ASSUMED_LTCG_RATE = 0.15;

export interface AfterTaxNetWorth {
    /** Nominal net worth (assets − liabilities), unchanged. */
    netWorth: number;
    /** Net worth after subtracting estimated taxes still owed to access it. */
    afterTaxNetWorth: number;
    /** Total estimated deferred tax (ordinary + capital gains). */
    deferredTax: number;
    /** Ordinary-income tax owed on tax-deferred (Traditional) balances. */
    deferredOrdinaryTax: number;
    /** LTCG tax owed on unrealized gains in taxable accounts. */
    deferredCapGainsTax: number;
}

/**
 * Estimate after-tax net worth: nominal net worth minus the taxes a person
 * would still owe to actually access the money.
 *
 * The point this surfaces: a dollar in a Traditional 401k is NOT a dollar in a
 * Roth. The *entire* Traditional balance — original pre-tax contributions AND
 * every dollar of growth on top — comes out as ordinary income, so it's worth
 * less than its face value. Taxable (brokerage / ESPP / RSU) balances owe LTCG
 * on their growth — even the bucket people assume is fully theirs gets taxed on
 * gains. Roth, HSA, cash, and property are taken at face. So the same $1 of
 * growth is kept in full (Roth), taxed lightly (brokerage), or taxed at
 * ordinary rates (Traditional) — and the gap widens the longer it compounds.
 *
 * @param ordinaryRate rate applied to the WHOLE tax-deferred balance. Callers in
 *        #68 pass the RMD-era MARGINAL rate (getProjectedRMDMarginalRate, ~0.22),
 *        deliberately — it's the rate the Traditional faces when RMDs force it
 *        out, which keeps the metric consistent with the Roth-conversion engine.
 *        Do NOT swap this for an effective rate; that was tried and reverted.
 * @param ltcgRate     capital-gains rate on unrealized gains (default 15%).
 * @param tradDeferredTax OPTIONAL aggregate override for the Traditional deferred-tax
 *        term (#94). When supplied it's called with the AGGREGATE Traditional balance and
 *        returns the after-tax VALUE KEPT on it (the deferred tax is then `balance − value`),
 *        generalizing the flat `balance × (1 − ordinaryRate)`. Callers pass a SITUATION-based
 *        exit valuation (`buildTradValuation` → graduated self-liquidate or the flat heir rate
 *        for bequeath) applied identically to every strategy's balances, so the residual
 *        Traditional is valued by how it actually exits rather than by which optimizer produced
 *        it. Aggregate (not per-account) because the graduated exit is non-linear in balance.
 *        Omitted ⇒ identical behavior to the flat per-account `ordinaryRate`.
 */
export function computeAfterTaxNetWorth(
    accounts: AnyAccount[],
    ordinaryRate: number,
    ltcgRate: number = ASSUMED_LTCG_RATE,
    tradDeferredTax?: (totalTradBalance: number) => number,
): AfterTaxNetWorth {
    const { netWorth } = getAccountTotals(accounts);

    let deferredOrdinaryTax = 0;
    let deferredCapGainsTax = 0;
    let totalTradBalance = 0;

    for (const acc of accounts) {
        if (acc instanceof InvestedAccount) {
            switch (acc.taxType) {
                case 'Traditional 401k':
                case 'Traditional IRA':
                    // Whole balance (contributions + growth) is ordinary income on the way out.
                    // With a situation-based valuation supplied, the deferred tax is computed on
                    // the AGGREGATE balance below; otherwise apply the flat per-account rate.
                    totalTradBalance += acc.amount;
                    if (!tradDeferredTax) deferredOrdinaryTax += acc.amount * ordinaryRate;
                    break;
                case 'Brokerage':
                    // Only the growth is taxed, at LTCG rates.
                    deferredCapGainsTax += acc.unrealizedGains * ltcgRate;
                    break;
                // Roth 401k / Roth IRA / HSA: no further tax.
            }
        } else if (acc instanceof ESPPAccount || acc instanceof RSUAccount) {
            // Taxable equity comp: gains since vest/purchase owe capital gains.
            // (ESPP bargain-element ordinary tax is approximated as LTCG here.)
            deferredCapGainsTax += acc.unrealizedGains * ltcgRate;
        }
        // SavedAccount (cash), PropertyAccount, DebtAccount: taken at face value.
    }

    if (tradDeferredTax) {
        // Situation-based (#94): deferred ordinary tax = the graduated exit tax on the WHOLE
        // Traditional balance (face − supplied after-tax exit value), clamped to ≥ 0 so a
        // rounding undershoot can't credit a "negative tax".
        deferredOrdinaryTax = Math.max(0, totalTradBalance - tradDeferredTax(totalTradBalance));
    }

    const deferredTax = deferredOrdinaryTax + deferredCapGainsTax;

    return {
        netWorth,
        afterTaxNetWorth: netWorth - deferredTax,
        deferredTax,
        deferredOrdinaryTax,
        deferredCapGainsTax,
    };
}

/**
 * Build the Traditional deferred-tax valuation + a representative fallback rate for a
 * timeline. This is the ruler the Withdrawal-tab "After-Tax Wealth Gained" comparison
 * scores every strategy with (#94 / card-side of #95).
 *
 * The valuation is SITUATION-based, NOT strategy-based: the after-tax value of a Traditional
 * balance is a property of the balance and the retiree's exit plan — not of which conversion
 * optimizer produced it. The caller (useSimulation) builds ONE ruler from the strategy-
 * independent std-ded baseline timeline and applies it to both the baseline and the selected
 * strategy's terminal balances, so the comparison is apples-to-apples and the reference
 * baseline stays invariant to the selected strategy.
 *   - self-liquidate: the graduated rate the residual actually exits at on self-drawdown
 *     (`bracketAwareTradExitValue` — std-ded slice at 0%, then climbing brackets; balance-
 *     dependent). Uses THIS timeline's own terminal-year age + persisting SS/fixed income as
 *     the base the drawdown stacks on (the SS torpedo, #89). Falls back to the flat projected-
 *     RMD rate only if terminal tax params can't be resolved.
 *   - bequeath: the heir's flat `HEIR_EXIT_RATE` (a working heir drains it within 10 years
 *     with no low-bracket runway). `tradDeferredTax` returns the after-tax VALUE KEPT
 *     `b·(1−heir)` — computeAfterTaxNetWorth derives the tax as `balance − value`, so
 *     returning the tax here would invert it (tax at 1−heir).
 *
 * Returns `{ rate, tradDeferredTax }`; pass both straight into `computeAfterTaxNetWorth`.
 */
export function buildTradValuation(
    simulation: SimulationYear[],
    assumptions: AssumptionsState,
    taxState: TaxState,
): { rate: number; tradDeferredTax?: (totalTradBalance: number) => number } {
    const projectedRMDRate = getProjectedRMDMarginalRate(simulation, assumptions, taxState) ?? 0;

    const userSituation = assumptions.investments.rothConversionUserSituation ?? 'self-liquidate';
    if (userSituation === 'bequeath') {
        return { rate: HEIR_EXIT_RATE, tradDeferredTax: (b: number) => b * (1 - HEIR_EXIT_RATE) };
    }

    const realYears = simulation.filter(y => !y.isEndOfYearProjection);
    const last = realYears[realYears.length - 1];
    if (!last) return { rate: projectedRMDRate };
    const birthYear = getBirthYear(assumptions.milestones);
    const terminalAge = last.year - birthYear + 1;
    // Resolve scheduled tax life events (filing-status / state-residency changes) to the
    // TERMINAL year before building the ruler (fp-review F3a). The engine, the DP contexts,
    // and the DP's own terminal all price a scheduled event (e.g. MFJ→Single widowhood);
    // using the raw year-0 taxState here left the largest term in the objective on the
    // wrong brackets whenever an event fires in-horizon. Milestone-triggered events resolve
    // against the reach years this timeline actually recorded.
    const effTax = resolveTaxEventsForYear(taxState, last.year, buildMilestoneReachYears(realYears));
    const fedParams = TaxService.getTaxParameters(last.year, effTax.filingStatus, 'federal', undefined, assumptions);
    if (!fedParams) return { rate: projectedRMDRate };
    // State tax rides the exit drawdown too (fp-review F2): the conversion-cost side
    // prices state tax in full, so a fed-only exit over-values the residual and biases
    // the optimizer toward under-conversion in taxed states. No-tax states (or an
    // unknown residency) resolve to undefined → fed-only, unchanged.
    const stateParams = TaxService.getTaxParameters(last.year, effTax.filingStatus, 'state', effTax.stateResidency, assumptions) ?? null;
    const g = (assumptions.investments.returnRates.ror ?? 7) / 100
        + (assumptions.macro.inflationAdjusted ? assumptions.macro.inflationRate / 100 : 0);
    const ss = TaxService.getSocialSecurityBenefits(last.incomes, last.year);
    const fixed = Math.max(0, TaxService.getGrossIncome(last.incomes, last.year) - ss);
    // The household inflation rate: COLAs the persisting SS/fixed income AND indexes the
    // drawdown's brackets/std-deduction per year (#157) — the real schedules are
    // inflation-indexed, so freezing them at the terminal-year thresholds while the
    // residual compounds at nominal g overstated the exit tax on long drawdowns.
    const cola = assumptions.macro.inflationAdjusted ? assumptions.macro.inflationRate / 100 : 0;
    return {
        rate: projectedRMDRate,
        tradDeferredTax: (b: number) =>
            bracketAwareTradExitValue(b, terminalAge, g, fedParams, effTax.filingStatus, 'self-liquidate', ss, fixed, cola, stateParams, cola),
    };
}

/**
 * After-tax net worth of a timeline's terminal (last real) year, valued with a supplied
 * situation-based ruler (#94). `ruler` is built once via `buildTradValuation` from a strategy-
 * independent source so the same valuation scores every timeline. Returns 0 for an empty
 * timeline (no terminal year to value).
 */
export function terminalAfterTaxNetWorth(
    simulation: SimulationYear[],
    ruler: { rate: number; tradDeferredTax?: (totalTradBalance: number) => number },
): number {
    const realYears = simulation.filter(y => !y.isEndOfYearProjection);
    const last = realYears[realYears.length - 1];
    if (!last) return 0;
    return computeAfterTaxNetWorth(last.accounts, ruler.rate, undefined, ruler.tradDeferredTax).afterTaxNetWorth;
}

export function formatCurrency(value: number): string {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
    }).format(value || 0);
}

export interface FormatCurrencyOptions {
    forceExact?: boolean;
}

/**
 * Format currency in compact notation for space-constrained displays.
 * Uses K (thousands), M (millions), B (billions) suffixes for large numbers.
 * Examples: $1,234 -> $1,234, $12,345 -> $12.3K, $1,234,567 -> $1.23M
 */
export function formatCompactCurrency(value: number, options?: FormatCurrencyOptions): string {
    const forceExact = options?.forceExact ?? false;

    if (forceExact) {
        return formatCurrency(value);
    }

    const absValue = Math.abs(value || 0);
    const sign = value < 0 ? '-' : '';

    if (absValue >= 1_000_000_000) {
        return `${sign}$${(absValue / 1_000_000_000).toFixed(2)}B`;
    }
    if (absValue >= 1_000_000) {
        return `${sign}$${(absValue / 1_000_000).toFixed(2)}M`;
    }
    if (absValue >= 100_000) {
        return `${sign}$${(absValue / 1_000).toFixed(1)}K`;
    }

    return formatCurrency(value);
}

export function findFinancialIndependenceYear(simulation: SimulationYear[], assumptions: AssumptionsState): number | null {
    for (let i = 1; i < simulation.length; i++) {
        const lastYear = simulation[i - 1];
        const currentYear = simulation[i];

        const lastYearInvestments = lastYear.accounts
            .filter(acc => acc instanceof InvestedAccount)
            .reduce((sum, acc) => sum + acc.amount, 0);

        // Financial independence: withdrawal from investments covers all expenses
        if (lastYearInvestments * (assumptions.investments.withdrawalRate / 100) > currentYear.cashflow.totalExpense) {
            return currentYear.year;
        }
    }
    return null;
}