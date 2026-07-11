import { type WithdrawalBucket } from '../components/Objects/Assumptions/AssumptionsContext';

/** The minimal account shape the bucket sync needs. */
export interface EligibleAccountRef {
    id: string;
    name: string;
}

/**
 * Reconcile the withdrawal burn-order buckets with the current set of
 * withdrawal-eligible accounts: append a bucket for each eligible account that
 * lacks one, drop buckets pointing at deleted accounts, preserve the existing
 * order otherwise. Returns the new bucket list, or null when already in sync.
 *
 * Extracted from WithdrawalTab's on-visit effect so the sync can run app-wide
 * at boot/account-change time: when it only ran on tab visit, merely OPENING
 * the Withdrawal tab after a cloud backup mutated `assumptions.withdrawalStrategy`
 * (a backed-up field) and lit the "Unsaved changes" indicator with no user edit.
 */
export function syncWithdrawalBuckets(
    eligibleAccounts: readonly EligibleAccountRef[],
    buckets: readonly WithdrawalBucket[],
): WithdrawalBucket[] | null {
    const missingAccounts = eligibleAccounts.filter(
        acc => !buckets.some(bucket => bucket.accountId === acc.id)
    );
    const validBuckets = buckets.filter(
        bucket => eligibleAccounts.some(acc => acc.id === bucket.accountId)
    );

    const hasNewAccounts = missingAccounts.length > 0;
    const hasDeletedAccounts = validBuckets.length !== buckets.length;
    if (!hasNewAccounts && !hasDeletedAccounts) return null;

    const newBuckets: WithdrawalBucket[] = missingAccounts.map(acc => ({
        id: `withdrawal-${acc.id}`,
        name: acc.name,
        accountId: acc.id,
    }));
    return [...validBuckets, ...newBuckets];
}
