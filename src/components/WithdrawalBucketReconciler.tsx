import { useContext, useEffect } from 'react';
import { AccountContext } from './Objects/Accounts/AccountContext';
import { AssumptionsContext } from './Objects/Assumptions/AssumptionsContext';
import { SavedAccount, InvestedAccount, ESPPAccount, RSUAccount } from './Objects/Accounts/models';
import { syncWithdrawalBuckets } from '../services/withdrawalBucketSync';

/**
 * Keeps `assumptions.withdrawalStrategy` (the burn-order buckets) in sync with
 * the withdrawal-eligible accounts, app-wide.
 *
 * This sync used to live in WithdrawalTab's mount effect, which meant the
 * buckets were only reconciled when the user happened to VISIT that tab. A
 * cloud backup taken before the visit therefore excluded the synced buckets,
 * and the first visit afterwards rewrote a backed-up field — lighting the
 * "Unsaved changes" indicator with no user edit. Running the reconciliation
 * here (mounted once in App, inside the providers) means the state is already
 * normalized whenever a backup is taken, and any bucket change coincides with
 * a real account edit in the same session.
 *
 * Loop safety: after a sync dispatch the helper returns null (state matches
 * accounts), so the effect settles in one pass.
 *
 * Renders nothing.
 */
export function WithdrawalBucketReconciler(): null {
    const { accounts } = useContext(AccountContext);
    const { state, dispatch } = useContext(AssumptionsContext);

    useEffect(() => {
        const eligibleAccounts = accounts.filter(
            acc => acc instanceof SavedAccount || acc instanceof InvestedAccount
                || acc instanceof ESPPAccount || acc instanceof RSUAccount
        );
        const synced = syncWithdrawalBuckets(eligibleAccounts, state.withdrawalStrategy);
        if (synced) {
            dispatch({ type: 'SET_WITHDRAWAL_STRATEGY', payload: synced });
        }
    }, [accounts, state.withdrawalStrategy, dispatch]);

    return null;
}
