import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import DeleteAccountControl from '../../../../components/Objects/Accounts/DeleteAccountUI';
import { AccountContext, AccountDispatchContext } from '../../../../components/Objects/Accounts/AccountContext';
import { ExpenseDispatchContext } from '../../../../components/Objects/Expense/ExpenseContext';
import { IncomeContext } from '../../../../components/Objects/Income/IncomeContext';
import { AssumptionsContext, defaultAssumptions } from '../../../../components/Objects/Assumptions/AssumptionsContext';
import type { AssumptionsState, PriorityBucket, WithdrawalBucket } from '../../../../components/Objects/Assumptions/AssumptionsContext';
import { SavedAccount } from '../../../../components/Objects/Accounts/models';
import type { AnyIncome } from '../../../../components/Objects/Income/models';
import { WorkIncome } from '../../../../components/Objects/Income/models';
import { ReceiptToastProvider } from '../../../../components/Layout/Overlays/ReceiptToast';
import { MemoryRouter } from 'react-router-dom';

const ACCOUNT_ID = 'ACC-1';

function renderControl({
    priorities = [],
    withdrawalStrategy = [],
    incomes = [],
}: {
    priorities?: PriorityBucket[];
    withdrawalStrategy?: WithdrawalBucket[];
    incomes?: AnyIncome[];
} = {}) {
    const accountDispatch = vi.fn();
    const expenseDispatch = vi.fn();
    const assumptionsDispatch = vi.fn();
    const assumptionsState: AssumptionsState = { ...defaultAssumptions, priorities, withdrawalStrategy };

    render(
        <MemoryRouter>
        <ReceiptToastProvider>
        <AccountContext.Provider value={{ accounts: [new SavedAccount(ACCOUNT_ID, 'Brokerage', 1000)], amountHistory: {} }}>
            <AccountDispatchContext.Provider value={{ dispatch: accountDispatch, exportData: () => {}, importData: () => {} }}>
                <ExpenseDispatchContext.Provider value={expenseDispatch}>
                    <IncomeContext.Provider value={{ incomes }}>
                        <AssumptionsContext.Provider value={{ state: assumptionsState, dispatch: assumptionsDispatch }}>
                            <DeleteAccountControl accountId={ACCOUNT_ID} accountName="Brokerage" />
                        </AssumptionsContext.Provider>
                    </IncomeContext.Provider>
                </ExpenseDispatchContext.Provider>
            </AccountDispatchContext.Provider>
        </AccountContext.Provider>
        </ReceiptToastProvider>
        </MemoryRouter>
    );

    return { accountDispatch, expenseDispatch, assumptionsDispatch };
}

const openDialog = () => fireEvent.click(screen.getByRole('button', { name: 'Delete Brokerage account' }));

describe('DeleteAccountControl impact summary', () => {
    it('shows the plain confirm with no reference warnings when nothing references the account', () => {
        const { accountDispatch, assumptionsDispatch } = renderControl();

        openDialog();
        expect(screen.getByRole('alertdialog')).toBeInTheDocument();
        expect(screen.queryByText(/allocation priorit/i)).not.toBeInTheDocument();
        expect(screen.queryByText(/withdrawal/i)).not.toBeInTheDocument();
        expect(screen.queryByText(/payroll/i)).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
        expect(accountDispatch).toHaveBeenCalledWith({ type: 'DELETE_ACCOUNT', payload: { id: ACCOUNT_ID } });
        expect(assumptionsDispatch).not.toHaveBeenCalled();
    });

    it('lists referencing priorities, withdrawal entries, and payroll routings by name', () => {
        renderControl({
            priorities: [
                { id: 'P-1', name: 'Fill Brokerage', type: 'SAVINGS', accountId: ACCOUNT_ID, capType: 'FIXED', capValue: 500 },
                { id: 'P-2', name: 'Other bucket', type: 'SAVINGS', accountId: 'ACC-OTHER', capType: 'FIXED', capValue: 100 },
            ],
            withdrawalStrategy: [
                { id: 'W-1', name: 'Taxable first', accountId: ACCOUNT_ID },
                { id: 'W-2', name: 'Then 401k', accountId: 'ACC-OTHER' },
            ],
            incomes: [
                new WorkIncome('INC-1', 'My Job', 100000, 'Monthly', 'Yes', 0, 0, 0, 0, ACCOUNT_ID),
            ],
        });

        openDialog();

        // Referencing objects listed by name; unrelated ones absent
        expect(screen.getByText('Fill Brokerage')).toBeInTheDocument();
        expect(screen.getByText('Taxable first')).toBeInTheDocument();
        expect(screen.queryByText('Other bucket')).not.toBeInTheDocument();
        expect(screen.queryByText('Then 401k')).not.toBeInTheDocument();

        // Payroll routing gets a reassignment note naming the income
        expect(screen.getByText('My Job')).toBeInTheDocument();
        expect(screen.getByText(/reassign/i)).toBeInTheDocument();
    });

    it('cleans up priorities and withdrawal entries on confirm, but never auto-clears payroll routing', () => {
        const { accountDispatch, assumptionsDispatch } = renderControl({
            priorities: [
                { id: 'P-1', name: 'Fill Brokerage', type: 'SAVINGS', accountId: ACCOUNT_ID, capType: 'FIXED', capValue: 500 },
                { id: 'P-1b', name: 'Brokerage extra', type: 'SAVINGS', accountId: ACCOUNT_ID, capType: 'REMAINDER' },
                { id: 'P-2', name: 'Other bucket', type: 'SAVINGS', accountId: 'ACC-OTHER', capType: 'FIXED', capValue: 100 },
            ],
            withdrawalStrategy: [
                { id: 'W-1', name: 'Taxable first', accountId: ACCOUNT_ID },
                { id: 'W-2', name: 'Then 401k', accountId: 'ACC-OTHER' },
            ],
            incomes: [
                new WorkIncome('INC-1', 'My Job', 100000, 'Monthly', 'Yes', 0, 0, 0, 0, ACCOUNT_ID),
            ],
        });

        openDialog();
        fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

        // One REMOVE_PRIORITY per referencing bucket
        expect(assumptionsDispatch).toHaveBeenCalledWith({ type: 'REMOVE_PRIORITY', payload: 'P-1' });
        expect(assumptionsDispatch).toHaveBeenCalledWith({ type: 'REMOVE_PRIORITY', payload: 'P-1b' });
        expect(assumptionsDispatch).not.toHaveBeenCalledWith({ type: 'REMOVE_PRIORITY', payload: 'P-2' });

        // Withdrawal order replaced with the filtered list
        expect(assumptionsDispatch).toHaveBeenCalledWith({
            type: 'SET_WITHDRAWAL_STRATEGY',
            payload: [{ id: 'W-2', name: 'Then 401k', accountId: 'ACC-OTHER' }],
        });

        // Account itself deleted
        expect(accountDispatch).toHaveBeenCalledWith({ type: 'DELETE_ACCOUNT', payload: { id: ACCOUNT_ID } });
    });

    it('does not dispatch SET_WITHDRAWAL_STRATEGY when no withdrawal entry references the account', () => {
        const { assumptionsDispatch } = renderControl({
            priorities: [
                { id: 'P-1', name: 'Fill Brokerage', type: 'SAVINGS', accountId: ACCOUNT_ID, capType: 'FIXED', capValue: 500 },
            ],
            withdrawalStrategy: [
                { id: 'W-2', name: 'Then 401k', accountId: 'ACC-OTHER' },
            ],
        });

        openDialog();
        fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

        expect(assumptionsDispatch).toHaveBeenCalledWith({ type: 'REMOVE_PRIORITY', payload: 'P-1' });
        expect(assumptionsDispatch).not.toHaveBeenCalledWith(
            expect.objectContaining({ type: 'SET_WITHDRAWAL_STRATEGY' })
        );
    });

    it('detects ESPP account routing on a WorkIncome', () => {
        const espp = new WorkIncome('INC-2', 'Tech Job', 150000, 'Monthly', 'Yes', 0, 0, 0, 0, 'ACC-OTHER');
        espp.esppAccountId = ACCOUNT_ID;
        renderControl({ incomes: [espp] });

        openDialog();

        expect(screen.getByText('Tech Job')).toBeInTheDocument();
        expect(screen.getByText(/reassign/i)).toBeInTheDocument();
    });

    it('shows a deletion receipt toast (no link) summarizing what was removed', () => {
        renderControl({
            priorities: [
                { id: 'P-1', name: 'Emergency fund', type: 'SAVINGS', accountId: ACCOUNT_ID, capType: 'FIXED', capValue: 100 },
            ],
            withdrawalStrategy: [
                { id: 'W-1', name: 'Drain brokerage', accountId: ACCOUNT_ID },
            ],
        });

        openDialog();
        fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

        const toast = screen.getByText(/Deleted 'Brokerage' along with 1 allocation bucket, 1 withdrawal-order entry/);
        expect(toast).toBeInTheDocument();
        // Deletion receipts deliberately carry no navigation link.
        expect(screen.queryByRole('link')).not.toBeInTheDocument();
    });

    it('shows a plain deletion receipt when nothing else was removed', () => {
        renderControl();
        openDialog();
        fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
        expect(screen.getByText("Deleted 'Brokerage'")).toBeInTheDocument();
    });
});
