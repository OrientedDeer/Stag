import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import PriorityTab from '../../../tabs/Future/PriorityTab';
import { AccountContext } from '../../../components/Objects/Accounts/AccountContext';
import { DebtAccount, DeficitDebtAccount, InvestedAccount, SavedAccount, AnyAccount } from '../../../components/Objects/Accounts/models';
import { AssumptionsContext, defaultAssumptions, PriorityBucket } from '../../../components/Objects/Assumptions/AssumptionsContext';
import { IncomeContext } from '../../../components/Objects/Income/IncomeContext';
import { ExpenseContext } from '../../../components/Objects/Expense/ExpenseContext';
import { WorkIncome } from '../../../components/Objects/Income/models';
import { OtherExpense } from '../../../components/Objects/Expense/models';
import { ReceiptToastProvider } from '../../../components/Layout/Overlays/ReceiptToast';

/**
 * #60 C (redesign): unlinked DebtAccounts are offered in the Allocation priority
 * list as a "Pay down: <name>" destination; linked debts (accelerated via the
 * loan's extra_payment) and the system DeficitDebt are NOT offered.
 *
 * The destination picker is a CustomDropdown (button + portal'd option buttons),
 * so we open it and assert on the rendered option labels.
 */
describe('PriorityTab debt-paydown offering', () => {
    const accounts = [
        new DebtAccount('cc', 'Credit Card', 5000, '', 22),             // unlinked — offered
        new DebtAccount('loan-debt', 'Auto Loan', 8000, 'exp-auto', 6), // linked — NOT offered
        new DeficitDebtAccount('system-deficit-debt', 'Uncovered Deficit', 0), // system — NOT offered
        new InvestedAccount('brok', 'Brokerage', 100000, 0, 0, 0.1, 'Brokerage'),
    ];

    function renderTab() {
        return render(
            <AccountContext.Provider value={{ accounts, amountHistory: {} }}>
                <PriorityTab />
            </AccountContext.Provider>
        );
    }

    it('offers an unlinked debt as a "Pay down" destination but hides linked + deficit debts', () => {
        renderTab();

        // Open the inline add form, then open the destination dropdown.
        fireEvent.click(screen.getByText('Add Priority'));
        fireEvent.click(screen.getByLabelText('Destination Account'));

        // The unlinked credit card is offered as a "Pay down: …" destination.
        expect(screen.getAllByText('Pay down: Credit Card').length).toBeGreaterThan(0);

        // The linked auto loan and the system deficit debt are NEVER offered —
        // not as a plain name and not as a "Pay down:" entry.
        expect(screen.queryByText(/Auto Loan/)).not.toBeInTheDocument();
        expect(screen.queryByText(/Uncovered Deficit/)).not.toBeInTheDocument();
    });
});

/**
 * Review-3: the waterfall PREVIEW must agree with the engine for debt buckets —
 * correct units ([2]), post-interest sizing ([4]), linked-debt exclusion ([5]),
 * and a deleted-account stale bucket must not act like a real REMAINDER ([3]).
 */
describe('PriorityTab debt-paydown waterfall preview', () => {
    // A salary big enough to leave clear monthly surplus after the small expense.
    const income = [new WorkIncome('inc', 'Job', 120000, 'Annually', 'Yes', 0, 0, 0, 0, '', null, 'FIXED')];
    const expenses = [new OtherExpense('e1', 'Rent', 1000, 'Monthly', new Date(2024, 0, 1))];

    function renderWithState(accounts: AnyAccount[], priorities: PriorityBucket[]) {
        const state = { ...defaultAssumptions, priorities };
        return render(
            <ReceiptToastProvider>
                <AssumptionsContext.Provider value={{ state, dispatch: vi.fn() }}>
                    <AccountContext.Provider value={{ accounts, amountHistory: {} }}>
                        <IncomeContext.Provider value={{ incomes: income }}>
                            <ExpenseContext.Provider value={{ expenses }}>
                                <PriorityTab />
                            </ExpenseContext.Provider>
                        </IncomeContext.Provider>
                    </AccountContext.Provider>
                </AssumptionsContext.Provider>
            </ReceiptToastProvider>
        );
    }

    it('[2] a debt bucket does not starve a lower monthly bucket', () => {
        // $5000 @ 22% card ranked ABOVE a $500/mo fixed savings bucket. The card
        // is a ONE-TIME annual payoff spread over 12 months in the preview, so it
        // must NOT zero out the recurring $500/mo savings below it.
        const accounts = [
            new DebtAccount('cc', 'Credit Card', 5000, '', 22),
            new SavedAccount('sav', 'Savings', 0),
        ];
        renderWithState(accounts, [
            { id: 'p-cc', name: 'Pay down: Credit Card', type: 'DEBT', accountId: 'cc', capType: 'REMAINDER' },
            { id: 'p-sav', name: 'Monthly savings', type: 'SAVINGS', accountId: 'sav', capType: 'FIXED', capValue: 500 },
        ]);

        // The debt line is labeled as a paydown (not "Everything remaining").
        expect(screen.getByText('Pay down Credit Card')).toBeInTheDocument();

        // The lower savings bucket is NOT flagged "Never funded" (it would be if
        // the debt bucket consumed the whole monthly surplus as a lump).
        expect(screen.queryByText(/Never funded/)).not.toBeInTheDocument();
    });

    it('[5] a LINKED debt placed in priorities is NOT rendered as a paydown', () => {
        const accounts = [
            new DebtAccount('loan-debt', 'Auto Loan', 8000, 'exp-auto', 6), // linked
        ];
        renderWithState(accounts, [
            { id: 'p-loan', name: 'Linked loan bucket', type: 'DEBT', accountId: 'loan-debt', capType: 'REMAINDER' },
        ]);

        // It must NOT show a "Pay down" line — the engine skips linked debts, so
        // the preview falls through to the normal REMAINDER label instead.
        expect(screen.queryByText('Pay down Auto Loan')).not.toBeInTheDocument();
        expect(screen.getByText('Everything remaining')).toBeInTheDocument();
    });

    it('[3] a REMAINDER bucket whose account was deleted does not starve lower buckets', () => {
        // 'ghost' has NO matching account (deleted). Persisted capType REMAINDER.
        // It must be treated as DEAD (ignored), so the savings bucket below is NOT
        // flagged "Never funded".
        const accounts = [new SavedAccount('sav', 'Savings', 0)];
        renderWithState(accounts, [
            { id: 'p-ghost', name: 'Deleted account', type: 'INVESTMENT', accountId: 'ghost-deleted', capType: 'REMAINDER' },
            { id: 'p-sav', name: 'Monthly savings', type: 'SAVINGS', accountId: 'sav', capType: 'FIXED', capValue: 500 },
        ]);

        expect(screen.queryByText(/Never funded/)).not.toBeInTheDocument();
    });

    it('persists type:DEBT when adding a debt-paydown bucket ([8])', () => {
        const dispatch = vi.fn();
        const accounts = [new DebtAccount('cc', 'Credit Card', 5000, '', 22)];
        render(
            <ReceiptToastProvider>
                <AssumptionsContext.Provider value={{ state: { ...defaultAssumptions }, dispatch }}>
                    <AccountContext.Provider value={{ accounts, amountHistory: {} }}>
                        <IncomeContext.Provider value={{ incomes: income }}>
                            <ExpenseContext.Provider value={{ expenses }}>
                                <PriorityTab />
                            </ExpenseContext.Provider>
                        </IncomeContext.Provider>
                    </AccountContext.Provider>
                </AssumptionsContext.Provider>
            </ReceiptToastProvider>
        );

        // Open the add form; the only allocatable account (the card) preselects.
        fireEvent.click(screen.getByText('Add Priority'));
        fireEvent.click(screen.getByRole('button', { name: 'Add' }));

        expect(dispatch).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'ADD_PRIORITY',
                payload: expect.objectContaining({ type: 'DEBT', accountId: 'cc', capType: 'REMAINDER' }),
            })
        );
    });
});
