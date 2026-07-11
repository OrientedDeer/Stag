import { describe, it, expect, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { useContext, type ReactNode } from 'react';
import { BudgetSpendingReconciler } from '../../components/BudgetSpendingReconciler';
import { BudgetContext } from '../../components/Objects/Budget/BudgetContext';
import { BudgetProvider } from '../../components/Objects/Budget/BudgetProvider';

/**
 * The transaction→spending auto-reconcile must run app-wide (not on Budget-tab
 * visit): when it only ran on tab visit, restoring a cloud backup whose stored
 * spending drifted from what current code computes and then merely OPENING the
 * Budget tab dispatched UPDATE_SPENDING and falsely lit "Unsaved changes".
 */

function SpendingProbe({ onSpending }: { onSpending: (s: Record<string, number>) => void }) {
    const { months } = useContext(BudgetContext);
    onSpending(months[0]?.spending ?? {});
    return null;
}

const wrap = (children: ReactNode) => <BudgetProvider>{children}</BudgetProvider>;

describe('BudgetSpendingReconciler', () => {
    beforeEach(() => {
        localStorage.clear();
        // A hydrated month whose stored spending ($100) drifts from its
        // categorized transactions ($60) — e.g. an old cloud blob.
        localStorage.setItem('user_budget_data', JSON.stringify({
            months: [{
                id: 'M-2026-6',
                month: 6,
                year: 2026,
                spending: { 'exp-food': 100 },
                accountBalances: {},
                contributions: {},
                transactions: [
                    { id: 't1', date: '2026-06-10T00:00:00', description: 'Groceries', amount: -60, expenseId: 'exp-food' },
                ],
                reconciled: false,
                createdAt: '2026-06-01T00:00:00',
                updatedAt: '2026-06-01T00:00:00',
            }],
        }));
    });

    it('syncs stored spending with transaction totals at mount, without visiting the Budget tab', async () => {
        let latest: Record<string, number> = {};
        render(wrap(
            <>
                <BudgetSpendingReconciler />
                <SpendingProbe onSpending={(s) => { latest = s; }} />
            </>
        ));

        await waitFor(() => {
            expect(latest['exp-food']).toBe(60);
        });
    });
});
