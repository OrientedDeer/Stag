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
 * list as a "Pay down: <name>" destination. #60 (linked-debt rework): EVERY user
 * debt is a LoanExpense↔DebtAccount pair, so LINKED debts are offered too; only
 * the system DeficitDebt is excluded.
 *
 * The destination picker is a CustomDropdown (button + portal'd option buttons),
 * so we open it and assert on the rendered option labels.
 */
describe('PriorityTab debt-paydown offering', () => {
    const accounts = [
        new DebtAccount('loan-debt', 'Auto Loan', 8000, 'exp-auto', 6), // linked — OFFERED now
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

    it('offers a LINKED debt as a "Pay down" destination; hides the system deficit debt', () => {
        renderTab();

        // Open the inline add form, then open the destination dropdown.
        fireEvent.click(screen.getByText('Add Priority'));
        fireEvent.click(screen.getByLabelText('Destination Account'));

        // The linked auto loan is offered as a "Pay down: …" destination.
        expect(screen.getAllByText('Pay down: Auto Loan').length).toBeGreaterThan(0);

        // The system deficit debt is NEVER offered.
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

    it('a debt bucket renders as a normal "Pay down" capped bucket', () => {
        // #60 rework: a debt bucket is a normal capped bucket (cap = balance), not
        // a one-time callout. It shows a "Pay down <name>" line.
        const accounts = [
            new DebtAccount('cc', 'Credit Card', 5000, '', 22),
            new SavedAccount('sav', 'Savings', 0),
        ];
        renderWithState(accounts, [
            { id: 'p-cc', name: 'Pay down: Credit Card', type: 'DEBT', accountId: 'cc', capType: 'REMAINDER' },
            { id: 'p-sav', name: 'Monthly savings', type: 'SAVINGS', accountId: 'sav', capType: 'FIXED', capValue: 500 },
        ]);

        expect(screen.getByText('Pay down Credit Card')).toBeInTheDocument();
        // No leftover one-time-line wording from the superseded #137 workaround.
        expect(screen.queryByText(/one-time/)).not.toBeInTheDocument();
    });

    it('[4] a $0-balance debt is still OFFERED in the destination dropdown', () => {
        // A paid-off loan the user keeps: offerable (balance varies over the
        // projection) even though the engine won't pay a $0 debt at sim time.
        const accounts = [new DebtAccount('cc', 'Paid Card', 0, 'exp-x', 22)];
        render(
            <AccountContext.Provider value={{ accounts, amountHistory: {} }}>
                <PriorityTab />
            </AccountContext.Provider>
        );
        fireEvent.click(screen.getByText('Add Priority'));
        fireEvent.click(screen.getByLabelText('Destination Account'));

        expect(screen.getAllByText('Pay down: Paid Card').length).toBeGreaterThan(0);
    });

    it('[#60] a LINKED debt is now offered and rendered as a paydown (the rework)', () => {
        // Every debt is a LoanExpense↔DebtAccount pair, so a LINKED debt is the
        // normal eligible case now — it must render as a "Pay down" bucket.
        const accounts = [
            new DebtAccount('loan-debt', 'Auto Loan', 8000, 'exp-auto', 6), // linked
            new SavedAccount('sav', 'Savings', 0),
        ];
        renderWithState(accounts, [
            { id: 'p-loan', name: 'Pay down: Auto Loan', type: 'DEBT', accountId: 'loan-debt', capType: 'REMAINDER' },
            { id: 'p-sav', name: 'Monthly savings', type: 'SAVINGS', accountId: 'sav', capType: 'FIXED', capValue: 500 },
        ]);

        expect(screen.getByText('Pay down Auto Loan')).toBeInTheDocument();
        expect(screen.queryByText('Not funded')).not.toBeInTheDocument();
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

    it('[5] the bucket type is DERIVED from the account kind (SavedAccount → SAVINGS, not INVESTMENT)', () => {
        // The add and edit handlers both derive PriorityBucket.type from the
        // resolved account via the same helper, so adding a SavedAccount bucket
        // proves the SAVINGS derivation (the [5] bug was a hardcoded INVESTMENT).
        const dispatch = vi.fn();
        const accounts = [new SavedAccount('sav', 'Savings', 0)];
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

        fireEvent.click(screen.getByText('Add Priority'));
        fireEvent.click(screen.getByRole('button', { name: 'Add' }));

        expect(dispatch).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'ADD_PRIORITY',
                payload: expect.objectContaining({ accountId: 'sav', type: 'SAVINGS' }),
            })
        );
    });
});
