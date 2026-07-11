import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { type ReactNode } from 'react';
import HistoryTab from '../../../tabs/Budget/HistoryTab';
import { BudgetContext } from '../../../components/Objects/Budget/BudgetContext';
import type { BudgetState, MonthlySnapshot, Transaction } from '../../../components/Objects/Budget/BudgetTypes';
import { ExpenseContext } from '../../../components/Objects/Expense/ExpenseContext';
import { OtherExpense, type AnyExpense } from '../../../components/Objects/Expense/models';

/**
 * react-datasheet-grid doesn't render meaningfully in jsdom; stub it but
 * capture the `columns` + `onChange` it receives so we can exercise the
 * read-only (auto-reconcile source-of-truth) logic directly.
 */
interface GridRow {
    monthNum: number;
    hasTransactions: boolean;
    [key: string]: string | number | boolean;
}
interface GridColumn {
    key: string;
    disabled?: boolean | ((opt: { rowData: GridRow }) => boolean);
}
let capturedColumns: GridColumn[] = [];
let capturedOnChange: ((rows: GridRow[]) => void) | undefined;

vi.mock('react-datasheet-grid', () => ({
    DataSheetGrid: (props: { columns: GridColumn[]; onChange: (rows: GridRow[]) => void }) => {
        capturedColumns = props.columns;
        capturedOnChange = props.onChange;
        return <div data-testid="datasheet-grid" />;
    },
    keyColumn: (key: string, column: object) => ({ key, ...column }),
    floatColumn: {},
    textColumn: {},
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

const txn = (id: string, amount: number, expenseId?: string): Transaction => ({
    id,
    date: new Date(2025, 0, 5),
    description: id,
    amount,
    expenseId,
});

const renderHistoryTab = (budget: Partial<BudgetState> & { months: MonthlySnapshot[] }, expenses: AnyExpense[], dispatch = vi.fn()) => {
    const budgetValue = {
        importSettings: {
            dateColumn: 'Date',
            amountColumn: 'Amount',
            descriptionColumn: 'Description',
            categoryMappings: [],
            savedCSVFormats: [],
            autoCreateRules: false,
        },
        selectedMonth: 1,
        selectedYear: 2025,
        projectFuture: false,
        dispatch,
        getOrCreateMonth: () => makeSnapshot(1, 2025),
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
    return { dispatch, ...render(<HistoryTab />, { wrapper }) };
};

const rent = new OtherExpense('rent', 'Rent', 1000, 'Monthly', new Date(2024, 0, 1));

const expenseColumn = () => capturedColumns.find(c => c.key === 'exp_rent');

const isDisabled = (col: GridColumn | undefined, rowData: GridRow): boolean => {
    const d = col?.disabled;
    return typeof d === 'function' ? d({ rowData }) : !!d;
};

describe('HistoryTab — read-only for transaction-tracked months (A2)', () => {
    beforeEach(() => {
        capturedColumns = [];
        capturedOnChange = undefined;
    });

    it('disables the expense cell for a month that has transactions', () => {
        renderHistoryTab(
            {
                selectedYear: 2025,
                months: [makeSnapshot(1, 2025, { transactions: [txn('t1', -50, 'rent')] })],
            },
            [rent],
        );

        const col = expenseColumn();
        // January (monthNum 1) is tracked from transactions → disabled.
        expect(isDisabled(col, { monthNum: 1, hasTransactions: true })).toBe(true);
    });

    it('keeps the expense cell editable for an empty/manual month', () => {
        renderHistoryTab(
            {
                selectedYear: 2025,
                months: [makeSnapshot(2, 2025, { spending: { rent: 900 } })],
            },
            [rent],
        );

        const col = expenseColumn();
        // February has manual spending but no transactions → editable.
        expect(isDisabled(col, { monthNum: 2, hasTransactions: false })).toBe(false);
        // The Avg row is always read-only.
        expect(isDisabled(col, { monthNum: 0, hasTransactions: false })).toBe(true);
    });

    it('shows the info note when any month is tracked from transactions', () => {
        renderHistoryTab(
            {
                selectedYear: 2025,
                months: [makeSnapshot(1, 2025, { transactions: [txn('t1', -50, 'rent')] })],
            },
            [rent],
        );

        expect(screen.getByText(/tracked from transactions are read-only/i)).toBeInTheDocument();
    });

    it('hides the info note when no month has transactions', () => {
        renderHistoryTab(
            {
                selectedYear: 2025,
                months: [makeSnapshot(2, 2025, { spending: { rent: 900 } })],
            },
            [rent],
        );

        expect(screen.queryByText(/tracked from transactions are read-only/i)).not.toBeInTheDocument();
    });

    it('does not dispatch UPDATE_SPENDING when a tracked month cell is changed', () => {
        const { dispatch } = renderHistoryTab(
            {
                selectedYear: 2025,
                months: [makeSnapshot(1, 2025, { transactions: [txn('t1', -50, 'rent')], spending: { rent: 50 } })],
            },
            [rent],
        );

        // Simulate the grid emitting an edited row for tracked January.
        const editedRows = [
            { month: 'Jan', monthNum: 1, year: 2025, hasTransactions: true, total: 50, budget: 1000, difference: 950, exp_rent: 99999 },
        ];
        capturedOnChange?.(editedRows);

        const spendingDispatches = dispatch.mock.calls.filter(
            ([action]) => action?.type === 'UPDATE_SPENDING',
        );
        expect(spendingDispatches).toHaveLength(0);
    });

    it('still dispatches UPDATE_SPENDING for an editable (manual) month', () => {
        const { dispatch } = renderHistoryTab(
            {
                selectedYear: 2025,
                months: [makeSnapshot(3, 2025, { spending: { rent: 100 } })],
            },
            [rent],
        );

        // Row index must line up with the rendered rows (Jan=0 ... Mar=2).
        const rows = [
            { month: 'Jan', monthNum: 1, year: 2025, hasTransactions: false, total: 0, budget: 1000, difference: 1000, exp_rent: 0 },
            { month: 'Feb', monthNum: 2, year: 2025, hasTransactions: false, total: 0, budget: 1000, difference: 1000, exp_rent: 0 },
            { month: 'Mar', monthNum: 3, year: 2025, hasTransactions: false, total: 100, budget: 1000, difference: 900, exp_rent: 555 },
        ];
        capturedOnChange?.(rows);

        const spendingDispatches = dispatch.mock.calls.filter(
            ([action]) => action?.type === 'UPDATE_SPENDING',
        );
        expect(spendingDispatches.length).toBeGreaterThan(0);
        expect(spendingDispatches[0][0].payload.amount).toBe(555);
    });
});
