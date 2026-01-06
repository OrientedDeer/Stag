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

export const findFinancialIndependenceYear = (simulation: SimulationYear[], assumptions: AssumptionsState): number | null => {
    for (let i = 1; i < simulation.length; i++) {
        const lastYear = simulation[i - 1];
        const currentYear = simulation[i];

        const lastYearInvestments = lastYear.accounts
            .filter(acc => acc instanceof InvestedAccount)
            .reduce((sum, acc) => sum + acc.amount, 0);

        const currentYearInvestments = currentYear.accounts
            .filter(acc => acc instanceof InvestedAccount)
            .reduce((sum, acc) => sum + acc.amount, 0);

        const contributions = currentYear.cashflow.investedUser + currentYear.cashflow.investedMatch;
        
        // Financial independence is reached when the withdrawal from investments can cover all expenses.
        if (lastYearInvestments * (assumptions.investments.withdrawalRate / 100) > currentYear.cashflow.totalExpense) {
            return currentYear.year;
        }
    }
    return null;
};