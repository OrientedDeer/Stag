import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Dashboard from '../../tabs/Dashboard';
import { IncomeContext } from '../../components/Objects/Income/IncomeContext';
import { ExpenseContext } from '../../components/Objects/Expense/ExpenseContext';
import { AccountContext } from '../../components/Objects/Accounts/AccountContext';
import { PassiveIncome } from '../../components/Objects/Income/models';
import { OtherExpense } from '../../components/Objects/Expense/models';
import { SavedAccount } from '../../components/Objects/Accounts/models';

// The dashboard's lazy-loaded charts aren't under test — stub them out so the
// test doesn't pull Nivo into jsdom.
vi.mock('../../components/Charts/TaxBreakdownSunburst', () => ({
    TaxBreakdownSunburst: () => <div data-testid="tax-sunburst" />,
}));
vi.mock('../../components/Charts/SpendingSunburst', () => ({
    SpendingSunburst: () => <div data-testid="spending-sunburst" />,
}));
vi.mock('../../components/Charts/AssetSunburst', () => ({
    AssetSunburst: () => <div data-testid="asset-sunburst" />,
}));
vi.mock('../../components/Charts/Networth', () => ({
    NetWorthCard: () => <div data-testid="net-worth" />,
}));
vi.mock('../../components/Charts/CashflowSankey', () => ({
    CashflowSankey: () => <div data-testid="cashflow-sankey" />,
}));

describe('Dashboard monthly expense label', () => {
    it('labels the monthly-expense metric as an annualized average ("avg/mo this year")', () => {
        // The metric cards only render once setup is complete (income + expense + account).
        const incomes = [new PassiveIncome('i1', 'Rental', 1000, 'Monthly', 'No', 'Rental')];
        const expenses = [new OtherExpense('e1', 'Rent', 1000, 'Monthly', new Date(2024, 0, 1))];
        const accounts = [new SavedAccount('a1', 'Savings', 5000, 0)];

        render(
            <MemoryRouter>
                <IncomeContext.Provider value={{ incomes }}>
                    <ExpenseContext.Provider value={{ expenses }}>
                        <AccountContext.Provider value={{ accounts, amountHistory: {} }}>
                            <Dashboard />
                        </AccountContext.Provider>
                    </ExpenseContext.Provider>
                </IncomeContext.Provider>
            </MemoryRouter>
        );

        expect(screen.getByText('Expenses')).toBeInTheDocument();
        // Deliberately distinct from Budget/Allocation's "this month" figures.
        expect(screen.getByText('avg/mo this year')).toBeInTheDocument();
    });
});
