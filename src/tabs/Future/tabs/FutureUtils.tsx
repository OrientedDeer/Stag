import { AnyAccount, DebtAccount, InvestedAccount, PropertyAccount } from '../../../components/Objects/Accounts/models';
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

export function formatCurrency(value: number): string {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
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