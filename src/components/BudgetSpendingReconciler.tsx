import { useContext } from 'react';
import { BudgetContext } from './Objects/Budget/BudgetContext';
import { useAutoReconcile } from '../hooks/useAutoReconcile';

/**
 * Runs the transaction→spending auto-reconcile app-wide instead of on
 * Budget-tab visit.
 *
 * useAutoReconcile syncs each month's `spending` record with the totals
 * computed from its categorized transactions — a write into BACKED-UP state.
 * When it only ran on Budget-tab mount, restoring a cloud backup and then
 * merely opening the Budget tab could dispatch UPDATE_SPENDING (stored totals
 * drifting from what current code computes) and light the "Unsaved changes"
 * indicator with no user edit. Mounted here (inside BudgetProvider in App),
 * the reconcile runs at boot and immediately after an import — inside the
 * post-restore rebaseline window — so the baseline hash and later live hashes
 * see the same normalized state.
 *
 * Renders nothing.
 */
export function BudgetSpendingReconciler(): null {
    const { months, dispatch } = useContext(BudgetContext);
    useAutoReconcile(months, dispatch);
    return null;
}
