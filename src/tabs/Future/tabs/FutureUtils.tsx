import { AnyAccount, DebtAccount, ESPPAccount, InvestedAccount, PropertyAccount, RSUAccount } from '../../../components/Objects/Accounts/models';
import { SimulationYear } from '../../../components/Objects/Assumptions/SimulationEngine';
import { AssumptionsState } from '../../../components/Objects/Assumptions/AssumptionsContext';

export function getAccountTotals(accounts: AnyAccount[]): { assets: number; liabilities: number; netWorth: number } {
    let assets = 0;
    let liabilities = 0;

    for (const acc of accounts) {
        if (acc instanceof DebtAccount) {
            liabilities += acc.amount;
        } else {
            assets += acc.amount;
            // PropertyAccount has a loan that counts as liability
            if (acc instanceof PropertyAccount && acc.loanAmount) {
                liabilities += acc.loanAmount;
            }
        }
    }

    return { assets, liabilities, netWorth: assets - liabilities };
}

export function calculateNetWorth(accounts: AnyAccount[]): number {
    return getAccountTotals(accounts).netWorth;
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
 * @param ordinaryRate projected effective ordinary tax rate at withdrawal (the
 *        sim's own getMedianRetirementTaxRate), e.g. 0.18.
 * @param ltcgRate     capital-gains rate on unrealized gains (default 15%).
 */
export function computeAfterTaxNetWorth(
    accounts: AnyAccount[],
    ordinaryRate: number,
    ltcgRate: number = ASSUMED_LTCG_RATE,
): AfterTaxNetWorth {
    const { netWorth } = getAccountTotals(accounts);

    let deferredOrdinaryTax = 0;
    let deferredCapGainsTax = 0;

    for (const acc of accounts) {
        if (acc instanceof InvestedAccount) {
            switch (acc.taxType) {
                case 'Traditional 401k':
                case 'Traditional IRA':
                    // Whole balance (contributions + growth) is ordinary income on the way out.
                    deferredOrdinaryTax += acc.amount * ordinaryRate;
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

    const deferredTax = deferredOrdinaryTax + deferredCapGainsTax;

    return {
        netWorth,
        afterTaxNetWorth: netWorth - deferredTax,
        deferredTax,
        deferredOrdinaryTax,
        deferredCapGainsTax,
    };
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