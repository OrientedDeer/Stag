import { AnyAccount, DebtAccount, InvestedAccount } from '../../../components/Objects/Accounts/models';
import { SimulationYear } from '../../../components/Objects/Assumptions/SimulationEngine';
import { AssumptionsState } from '../../../components/Objects/Assumptions/AssumptionsContext';

export const getAccountTotals = (accounts: AnyAccount[]) => {
    const assets = accounts.reduce((total, acc) => {
        if (acc instanceof DebtAccount) return total;
        return total + acc.amount;
    }, 0);
    const liabilities = accounts.reduce((total, acc) => {
        if (acc instanceof DebtAccount) return total + acc.amount;
        return total;
    }, 0);
    return { assets, liabilities, netWorth: assets - liabilities };
};

export const calculateNetWorth = (accounts: AnyAccount[]) => {
    return getAccountTotals(accounts).netWorth;
}

export const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value || 0);
}

export interface FormatCurrencyOptions {
    forceExact?: boolean; // Always show full format, never compact
}

/**
 * Format currency in compact notation for space-constrained displays.
 * Uses K (thousands), M (millions), B (billions) suffixes for large numbers.
 * Examples: $1,234 → $1,234, $12,345 → $12.3K, $1,234,567 → $1.23M
 *
 * @param value - The number to format
 * @param options - Formatting options
 * @param options.forceExact - If true, always show full format (no K/M/B suffixes)
 */
export const formatCompactCurrency = (value: number, options?: FormatCurrencyOptions) => {
    const { forceExact = false } = options || {};

    // If forceExact, always use full formatting
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
    // For amounts under $100K, show full value with 2 decimal places
    return formatCurrency(value);
}

export const findFinancialIndependenceYear = (simulation: SimulationYear[], assumptions: AssumptionsState): number | null => {
    for (let i = 1; i < simulation.length; i++) {
        const lastYear = simulation[i - 1];
        const currentYear = simulation[i];

        const lastYearInvestments = lastYear.accounts
            .filter(acc => acc instanceof InvestedAccount)
            .reduce((sum, acc) => sum + acc.amount, 0);
        
        // Financial independence is reached when the withdrawal from investments can cover all expenses.
        if (lastYearInvestments * (assumptions.investments.withdrawalRate / 100) > currentYear.cashflow.totalExpense) {
            return currentYear.year;
        }
    }
    return null;
};