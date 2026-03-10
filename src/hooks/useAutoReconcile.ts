import { useEffect, Dispatch } from 'react';
import { MonthlySnapshot } from '../components/Objects/Budget/BudgetTypes';
import { BudgetAction } from '../components/Objects/Budget/BudgetContext';
import { calculateCategoryTotalsFromTransactions } from '../components/Objects/Budget/budgetUtils';

/**
 * Auto-reconcile spending totals from transactions.
 * Syncs the spending record with calculated totals from categorized transactions.
 */
export function useAutoReconcile(
    months: MonthlySnapshot[],
    dispatch: Dispatch<BudgetAction>
): void {
    useEffect(() => {
        months.forEach(snapshot => {
            if (!snapshot.transactions || snapshot.transactions.length === 0) return;

            const categoryTotals = calculateCategoryTotalsFromTransactions(snapshot.transactions);

            Object.entries(categoryTotals).forEach(([expenseId, { gross, reimbursements }]) => {
                const netSpending = gross - reimbursements;
                const currentAmount = snapshot.spending[expenseId] ?? 0;

                if (Math.abs(currentAmount - netSpending) > 0.01) {
                    dispatch({
                        type: 'UPDATE_SPENDING',
                        payload: {
                            monthId: snapshot.id,
                            expenseId,
                            amount: netSpending,
                        },
                    });
                }
            });

            // Clean up stale spending entries that no longer have matching transactions
            // (e.g., transactions recategorized from expense to contribution)
            Object.keys(snapshot.spending).forEach(expenseId => {
                if (!categoryTotals[expenseId] && snapshot.spending[expenseId] !== 0) {
                    dispatch({
                        type: 'UPDATE_SPENDING',
                        payload: { monthId: snapshot.id, expenseId, amount: null },
                    });
                }
            });
        });
    }, [months, dispatch]);
}
