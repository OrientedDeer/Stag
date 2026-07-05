import { useEffect, Dispatch } from 'react';
import { MonthlySnapshot } from '../components/Objects/Budget/BudgetTypes';
import { BudgetAction } from '../components/Objects/Budget/BudgetContext';
import { computeSpendingReconciliation } from '../components/Objects/Budget/budgetUtils';

/**
 * Auto-reconcile spending totals from transactions.
 * Syncs the spending record with calculated totals from categorized transactions.
 *
 * The decision logic lives in computeSpendingReconciliation (budgetUtils), shared
 * with the headless stag-feed importer (backupMerge.applyTransactions) so the
 * overnight merge writes blobs that are already reconciled — the app should never
 * find drift in freshly-imported data.
 */
export function useAutoReconcile(
    months: MonthlySnapshot[],
    dispatch: Dispatch<BudgetAction>
): void {
    useEffect(() => {
        months.forEach(snapshot => {
            computeSpendingReconciliation(snapshot.transactions, snapshot.spending)
                .forEach(({ expenseId, amount }) => {
                    dispatch({
                        type: 'UPDATE_SPENDING',
                        payload: { monthId: snapshot.id, expenseId, amount },
                    });
                });
        });
    }, [months, dispatch]);
}
