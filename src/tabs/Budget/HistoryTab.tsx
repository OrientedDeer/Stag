import { useContext, useMemo } from 'react';
import {
    DataSheetGrid,
    keyColumn,
} from 'react-datasheet-grid';
import 'react-datasheet-grid/dist/style.css';
import { BudgetContext } from '../../components/Objects/Budget/BudgetContext';
import { ExpenseContext } from '../../components/Objects/Expense/ExpenseContext';
import {
    MONTH_NAMES,
    formatCurrency,
    getExpenseMonthlyBudget,
} from '../../components/Objects/Budget/budgetUtils';
import { currencyColumn, readOnlyTextColumn } from '../../components/Layout/DataSheetColumns';

interface HistoryRow {
    month: string;
    monthNum: number;
    year: number;
    total: number;
    budget: number;
    difference: number;
    // True when the month is tracked from transactions (auto-reconciled), so its
    // spending cells are read-only — edits would be overwritten by reconcile.
    hasTransactions: boolean;
    [key: string]: string | number | boolean; // Dynamic expense columns
}

export default function HistoryTab() {
    const { months, selectedYear, dispatch } = useContext(BudgetContext);
    const { expenses } = useContext(ExpenseContext);

    // Get all months for the selected year plus an average row
    const rows: HistoryRow[] = useMemo(() => {
        const monthRows = MONTH_NAMES.map((name, idx) => {
            const monthNum = idx + 1;
            const snapshot = months.find(m => m.month === monthNum && m.year === selectedYear);

            // Calculate budget for this month
            const monthBudget = expenses.reduce((sum, exp) => {
                const startDate = exp.startDate || new Date(0);
                const endDate = exp.endDate;
                const targetDate = new Date(selectedYear, monthNum - 1, 15);

                if (startDate > targetDate) return sum;
                if (endDate && endDate < targetDate) return sum;

                return sum + getExpenseMonthlyBudget(exp, monthNum);
            }, 0);

            // Calculate total spent
            const totalSpent = snapshot
                ? Object.values(snapshot.spending).reduce((s, v) => s + v, 0)
                : 0;

            const row: HistoryRow = {
                month: name.slice(0, 3),
                monthNum,
                year: selectedYear,
                total: totalSpent,
                budget: monthBudget,
                difference: monthBudget - totalSpent,
                hasTransactions: (snapshot?.transactions?.length ?? 0) > 0,
            };

            // Add each expense category as a column
            expenses.forEach(exp => {
                row[`exp_${exp.id}`] = snapshot?.spending[exp.id] ?? 0;
            });

            return row;
        });

        // Add average row. NOTE: divides by a fixed 12 months even for partial
        // years (see the "of 12 months" note rendered below the grid).
        const avgRow: HistoryRow = {
            month: 'Avg',
            monthNum: 0,
            year: selectedYear,
            total: monthRows.reduce((s, r) => s + r.total, 0) / 12,
            budget: monthRows.reduce((s, r) => s + r.budget, 0) / 12,
            difference: monthRows.reduce((s, r) => s + r.difference, 0) / 12,
            hasTransactions: false,
        };
        expenses.forEach(exp => {
            avgRow[`exp_${exp.id}`] = monthRows.reduce((s, r) => s + ((r[`exp_${exp.id}`] as number) || 0), 0) / 12;
        });
        monthRows.push(avgRow);

        return monthRows;
    }, [months, selectedYear, expenses]);

    // Build columns dynamically based on expenses. The datasheet-grid column
    // shapes don't unify cleanly across mixed cell types, so the column list is
    // built untyped (matching the existing `as any` return below).
    const columns = useMemo(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const cols: any[] = [
            {
                ...keyColumn('month', readOnlyTextColumn),
                title: 'Month',
                disabled: true,
                minWidth: 60,
                maxWidth: 60,
            },
        ];

        // Add expense columns. Spending is read-only for any month tracked from
        // transactions (auto-reconcile owns those values); editable only for
        // empty/manual months. The Avg row (monthNum 0) is always read-only.
        expenses.forEach(exp => {
            cols.push({
                ...keyColumn(`exp_${exp.id}`, currencyColumn),
                title: exp.name.length > 12 ? exp.name.slice(0, 10) + '...' : exp.name,
                minWidth: 90,
                disabled: ({ rowData }: { rowData: HistoryRow }) =>
                    rowData.monthNum === 0 || rowData.hasTransactions,
            });
        });

        // Add summary columns
        cols.push(
            {
                ...keyColumn('total', currencyColumn),
                title: 'Total',
                disabled: true,
                minWidth: 90,
            },
            {
                ...keyColumn('budget', currencyColumn),
                title: 'Budget',
                disabled: true,
                minWidth: 90,
            },
            {
                ...keyColumn('difference', currencyColumn),
                title: '+/-',
                disabled: true,
                minWidth: 80,
            }
        );

        return cols;
    }, [expenses]);

    // Handle changes to the grid
    const handleChange = (newRows: HistoryRow[]) => {
        newRows.forEach((row, idx) => {
            // Skip the average row (not editable)
            if (row.monthNum === 0) return;
            // Skip months tracked from transactions — their spending is owned by
            // auto-reconcile and any hand-edit here would be silently reverted.
            if (row.hasTransactions) return;

            const originalRow = rows[idx];

            // Check each expense column for changes
            expenses.forEach(exp => {
                const key = `exp_${exp.id}`;
                const newValue = row[key] as number;
                const oldValue = originalRow[key] as number;

                if (newValue !== oldValue) {
                    // Get or create the month snapshot
                    let snapshot = months.find(m => m.month === row.monthNum && m.year === row.year);

                    if (!snapshot) {
                        // Create new month
                        const newMonth = {
                            id: `MONTH-${row.year}-${row.monthNum.toString().padStart(2, '0')}-${Date.now()}`,
                            month: row.monthNum,
                            year: row.year,
                            spending: {},
                            accountBalances: {},
                            contributions: {},
                            transactions: [],
                            reconciled: false,
                            createdAt: new Date(),
                            updatedAt: new Date(),
                        };
                        dispatch({ type: 'ADD_MONTH', payload: newMonth });
                        snapshot = newMonth;
                    }

                    dispatch({
                        type: 'UPDATE_SPENDING',
                        payload: {
                            monthId: snapshot.id,
                            expenseId: exp.id,
                            amount: newValue || 0,
                        },
                    });
                }
            });
        });
    };

    // Calculate totals row (exclude the average row)
    const totals = useMemo(() => {
        const result: Record<string, number> = {
            total: 0,
            budget: 0,
            difference: 0,
        };

        expenses.forEach(exp => {
            result[`exp_${exp.id}`] = 0;
        });

        rows.filter(row => row.monthNum !== 0).forEach(row => {
            result.total += row.total;
            result.budget += row.budget;
            result.difference += row.difference;
            expenses.forEach(exp => {
                result[`exp_${exp.id}`] += (row[`exp_${exp.id}`] as number) || 0;
            });
        });

        return result;
    }, [rows, expenses]);

    const hasTrackedMonths = useMemo(
        () => rows.some(row => row.monthNum !== 0 && row.hasTransactions),
        [rows],
    );

    if (expenses.length === 0) {
        return (
            <div className="text-center py-12">
                <div className="text-content-muted mb-4">
                    No expense categories found.
                </div>
                <p className="text-content-subtle text-sm">
                    Add expenses in the Current &gt; Expenses tab to start tracking your budget.
                </p>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            <h3 className="text-lg font-semibold text-white">{selectedYear} Spending History</h3>

            {hasTrackedMonths && (
                <div className="bg-blue-900/20 border border-blue-700/50 rounded-lg p-3">
                    <p className="text-sm text-blue-400">
                        Months tracked from transactions are read-only here — their
                        spending is calculated from categorized transactions. Edit them in
                        the Transactions tab. Empty/manual months stay editable.
                    </p>
                </div>
            )}

            <div className="bg-surface-overlay rounded-lg border border-border-default overflow-hidden">
                <div className="budget-grid">
                    <DataSheetGrid
                        value={rows}
                        onChange={handleChange}
                        columns={columns}
                        lockRows
                        rowHeight={36}
                        headerRowHeight={40}
                        height={556}
                    />
                </div>
            </div>

            <p className="text-xs text-content-subtle">
                The <span className="text-content-muted font-medium">Avg</span> row divides each total by 12 months (a full year), even for partial years.
            </p>

            {/* Year Totals */}
            <div className="bg-surface-overlay rounded-lg border border-border-default px-4 py-2">
                <div className="flex items-center gap-6 flex-wrap">
                    <span className="text-sm text-content-muted">Year Totals:</span>
                    <div className="flex items-center gap-1">
                        <span className="text-xs text-content-subtle">Spent</span>
                        <span className="text-sm font-bold text-white">{formatCurrency(totals.total)}</span>
                    </div>
                    <div className="flex items-center gap-1">
                        <span className="text-xs text-content-subtle">Budget</span>
                        <span className="text-sm font-bold text-white">{formatCurrency(totals.budget)}</span>
                    </div>
                    <div className="flex items-center gap-1">
                        <span className="text-xs text-content-subtle">+/-</span>
                        <span className={`text-sm font-bold ${totals.difference >= 0 ? 'text-positive' : 'text-warning'}`}>
                            {totals.difference >= 0 ? '+' : ''}{formatCurrency(totals.difference)}
                        </span>
                    </div>
                </div>
            </div>
        </div>
    );
}
