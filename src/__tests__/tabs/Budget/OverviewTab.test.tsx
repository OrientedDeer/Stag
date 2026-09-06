import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { type ReactNode } from 'react';
import OverviewTab from '../../../tabs/Budget/OverviewTab';
import { BudgetContext } from '../../../components/Objects/Budget/BudgetContext';
import type { BudgetState, MonthlySnapshot } from '../../../components/Objects/Budget/BudgetTypes';
import { ExpenseContext } from '../../../components/Objects/Expense/ExpenseContext';
import { OtherExpense, type AnyExpense } from '../../../components/Objects/Expense/models';

// The bar chart isn't under test and doesn't lay out in jsdom.
vi.mock('@nivo/bar', () => ({
    ResponsiveBar: () => <div data-testid="mock-bar-chart" />,
}));

const makeSnapshot = (
    month: number,
    year: number,
    overrides: Partial<MonthlySnapshot> = {},
): MonthlySnapshot => ({
    id: `${year}-${month}`,
    month,
    year,
    spending: {},
    accountBalances: {},
    contributions: {},
    transactions: [],
    reconciled: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
});

// $1,000/mo rent (non-discretionary) is the only thing that can be projected.
const rent = new OtherExpense('rent', 'Rent', 1000, 'Monthly', new Date(2026, 0, 1));

const renderOverviewTab = (budget: Partial<BudgetState>, expenses: AnyExpense[] = [rent]) => {
    const budgetValue = {
        months: [] as MonthlySnapshot[],
        importSettings: {
            dateColumn: 'Date',
            amountColumn: 'Amount',
            descriptionColumn: 'Description',
            categoryMappings: [],
            savedCSVFormats: [],
            autoCreateRules: false,
        },
        selectedMonth: 12,
        selectedYear: 2026,
        projectFuture: true,
        dispatch: vi.fn(),
        getOrCreateMonth: () => makeSnapshot(12, 2026),
        getCurrentMonth: () => undefined,
        ...budget,
    };
    const wrapper = ({ children }: { children: ReactNode }) => (
        <ExpenseContext.Provider value={{ expenses }}>
            <BudgetContext.Provider value={budgetValue}>
                {children}
            </BudgetContext.Provider>
        </ExpenseContext.Provider>
    );
    return render(<OverviewTab />, { wrapper });
};

/** The December tile's title carries the "projected" vs "spent" wording. */
const decemberTileTitle = (): string =>
    screen.getByRole('button', { name: 'Dec' }).getAttribute('title') ?? '';

/** "spent / budget" text of the "This Month" summary card. */
const thisMonthTotals = (): string => {
    const heading = screen.getByRole('heading', { name: /This Month/ });
    const card = heading.parentElement as HTMLElement;
    // The budget half lives in a nested <span>, so read the whole value line.
    return (within(card).getByText(/\/\s*\$/).parentElement as HTMLElement).textContent ?? '';
};

describe('OverviewTab — non-discretionary projection for empty future months (#210)', () => {
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date(2026, 5, 15)); // June 15, 2026 — December is in the future
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('projects a future month with no snapshot at all', () => {
        renderOverviewTab({ months: [] });

        expect(thisMonthTotals()).toBe('$1,000/ $1,000');
        expect(screen.getAllByText('(non-discretionary projected)').length).toBeGreaterThan(0);
        expect(decemberTileTitle()).toContain('$1,000 projected');
    });

    it('projects a future month whose snapshot was emptied by deleting its transaction', () => {
        // What DELETE_TRANSACTION now leaves behind: the snapshot getOrCreateMonth
        // made, with both the transaction and its derived spending entry gone.
        renderOverviewTab({ months: [makeSnapshot(12, 2026)] });

        expect(thisMonthTotals()).toBe('$1,000/ $1,000');
        expect(decemberTileTitle()).toContain('$1,000 projected');
    });

    it('projects a future month whose only spending entries are zeros', () => {
        renderOverviewTab({ months: [makeSnapshot(12, 2026, { spending: { rent: 0 } })] });

        expect(thisMonthTotals()).toBe('$1,000/ $1,000');
        expect(decemberTileTitle()).toContain('$1,000 projected');
    });

    it('still reports real spending instead of the projection when the month is tracked', () => {
        renderOverviewTab({ months: [makeSnapshot(12, 2026, { spending: { rent: 640 } })] });

        expect(thisMonthTotals()).toBe('$640/ $1,000');
        expect(decemberTileTitle()).toContain('$640 spent');
    });

    it('does not replace a tracked zero-dollar month with a projection', () => {
        renderOverviewTab({
            months: [makeSnapshot(12, 2026, {
                transactions: [{
                    id: 'transfer',
                    date: new Date(2026, 11, 5),
                    description: 'Transfer',
                    amount: -100,
                    isTransfer: true,
                }],
            })],
        });

        expect(thisMonthTotals()).toBe('$0/ $1,000');
        expect(decemberTileTitle()).toContain('$0 spent');
    });
});
