import { useContext, useEffect, useRef } from 'react';
import { AccountContext, AccountDispatchContext } from './Objects/Accounts/AccountContext';
import { ExpenseContext, ExpenseDispatchContext } from './Objects/Expense/ExpenseContext';
import { linkOrphanLoanExpenses } from '../services/simulation/linkOrphanLoanExpenses';

/**
 * One-time, boot-time repair of orphaned loan expenses (#124 / #136).
 *
 * Net worth and total debt are sourced from ACCOUNTS only (calculateNetWorth /
 * getAccountTotals). The import and scenario-load paths already re-link orphaned
 * MortgageExpense/LoanExpense to paired accounts via linkOrphanLoanExpenses, but
 * localStorage BOOT hydration was the remaining gap: AccountProvider and
 * ExpenseProvider hydrate INDEPENDENTLY from separate keys, so a pre-existing orphan
 * in saved state (older app version, hand-edit, a deleted paired account) would be
 * silently dropped from net worth — and shift when NET_WORTH/TOTAL_DEBT milestones
 * fire.
 *
 * This component is the shared chokepoint that path lacked: mounted INSIDE both the
 * Account and Expense providers, it reads both hydrated sets once after boot, runs
 * the guard, and — if anything was orphaned — dispatches the repaired accounts and
 * expenses back to their contexts. Because the dispatch flows through the persisted
 * reducers, the repair is written back to localStorage: the saved state SELF-HEALS,
 * so the fix is one-shot per install rather than re-run every boot.
 *
 * Loop/re-run safety:
 *   - A one-shot ref ensures the reconciliation body runs at most once per mount.
 *   - It only dispatches when the guard actually produced repairs (notices non-empty).
 *     The repaired state has no orphans, so even without the ref a re-render would be
 *     a no-op — the ref just avoids re-scanning on every render.
 *   - usePersistedReducer hydrates synchronously in the reducer initializer, so the
 *     account/expense state read on mount is the hydrated localStorage data, not the
 *     empty initial state.
 *
 * Renders nothing.
 */
export function OrphanLoanReconciler(): null {
    const { accounts, amountHistory } = useContext(AccountContext);
    const { dispatch: accountDispatch } = useContext(AccountDispatchContext);
    const { expenses } = useContext(ExpenseContext);
    const expenseDispatch = useContext(ExpenseDispatchContext);

    const hasRun = useRef(false);

    useEffect(() => {
        if (hasRun.current) return;
        hasRun.current = true;

        const { accounts: repairedAccounts, expenses: repairedExpenses, notices } =
            linkOrphanLoanExpenses(accounts, expenses);

        // No orphans => nothing to persist; leave saved state untouched.
        if (notices.length === 0) return;

        // linkOrphanLoanExpenses appended the newly-created paired accounts and
        // mutated the orphan expenses' linkedAccountId in place. Persist both halves
        // so the repair survives the next reload.
        accountDispatch({
            type: 'SET_BULK_DATA',
            payload: { accounts: repairedAccounts, amountHistory },
        });
        expenseDispatch({
            type: 'SET_BULK_DATA',
            payload: { expenses: repairedExpenses },
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot boot reconcile; intentionally reads the hydrated state once and must not re-run when contexts change.
    }, []);

    return null;
}
