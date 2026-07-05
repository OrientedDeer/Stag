import { useContext, useEffect, useMemo } from 'react';
import { AssumptionsContext } from './Objects/Assumptions/AssumptionsContext';
import { ExpenseContext } from './Objects/Expense/ExpenseContext';
import { isLongTermGoal } from './Objects/Expense/models';

/**
 * Legacy migration, run app-wide: goals used to create a savings-priority
 * bucket; goal funding is now a committed transfer inside the simulation, so
 * any surviving goal-fund bucket is removed (the sim already zeroes them).
 *
 * This prune used to live in PriorityTab's mount effect. `priorities` is
 * BACKED-UP state, so restoring an old cloud blob that still carried a
 * goal-fund bucket and then visiting the Allocation tab dispatched
 * REMOVE_PRIORITY — lighting "Unsaved changes" with no user edit. Running it
 * here (inside the providers in App) the prune fires at boot / right after an
 * import, inside the post-restore rebaseline window.
 *
 * Renders nothing.
 */
export function GoalPriorityReconciler(): null {
    const { state, dispatch } = useContext(AssumptionsContext);
    const { expenses } = useContext(ExpenseContext);

    const goalFundIds = useMemo(() =>
        new Set(expenses.filter(e => isLongTermGoal(e) && e.goalAccountId).map(e => e.goalAccountId!)),
    [expenses]);

    useEffect(() => {
        state.priorities
            .filter(p => p.accountId && goalFundIds.has(p.accountId))
            .forEach(p => dispatch({ type: 'REMOVE_PRIORITY', payload: p.id }));
    }, [state.priorities, goalFundIds, dispatch]);

    return null;
}
