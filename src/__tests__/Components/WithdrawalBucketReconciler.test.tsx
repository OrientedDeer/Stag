import { describe, it, expect, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { act, useContext, ReactNode } from 'react';
import { WithdrawalBucketReconciler } from '../../components/WithdrawalBucketReconciler';
import { AccountProvider } from '../../components/Objects/Accounts/AccountProvider';
import { AssumptionsContext } from '../../components/Objects/Assumptions/AssumptionsContext';
import { AssumptionsProvider } from '../../components/Objects/Assumptions/AssumptionsProvider';

/**
 * The bucket↔account sync must run app-wide (not on Withdrawal-tab visit):
 * when it only ran on tab visit, opening the tab after a cloud backup rewrote
 * assumptions.withdrawalStrategy and falsely lit "Unsaved changes".
 */

function BucketProbe({ onBuckets }: { onBuckets: (b: unknown[]) => void }) {
    const { state } = useContext(AssumptionsContext);
    onBuckets(state.withdrawalStrategy);
    return null;
}

const wrap = (children: ReactNode) => (
    <AccountProvider>
        <AssumptionsProvider>{children}</AssumptionsProvider>
    </AccountProvider>
);

describe('WithdrawalBucketReconciler', () => {
    beforeEach(() => {
        localStorage.clear();
        // Seed the accounts store the way AccountProvider hydrates it.
        localStorage.setItem('user_accounts_data', JSON.stringify({
            accounts: [{ id: 'acc-1', name: 'Brokerage', amount: 50_000, className: 'InvestedAccount' }],
        }));
    });

    it('injects buckets for hydrated eligible accounts without visiting the Withdrawal tab', async () => {
        let latest: unknown[] = [];
        render(wrap(
            <>
                <WithdrawalBucketReconciler />
                <BucketProbe onBuckets={(b) => { latest = b; }} />
            </>
        ));

        await waitFor(() => {
            expect(latest).toEqual([
                { id: 'withdrawal-acc-1', name: 'Brokerage', accountId: 'acc-1' },
            ]);
        });
    });

    it('settles after one sync — no dispatch loop and no duplicate buckets', async () => {
        let latest: unknown[] = [];
        let observations = 0;
        render(wrap(
            <>
                <WithdrawalBucketReconciler />
                <BucketProbe onBuckets={(b) => { latest = b; observations++; }} />
            </>
        ));

        await waitFor(() => expect(latest).toHaveLength(1));
        const settledObservations = observations;

        // Flush any queued effects; a loop would keep dispatching new arrays.
        await act(async () => { await Promise.resolve(); });
        await act(async () => { await Promise.resolve(); });

        expect(latest).toHaveLength(1);
        expect(observations).toBe(settledObservations);
    });
});
