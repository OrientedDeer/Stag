import React, { useContext, useState } from 'react';
import { AccountContext } from './AccountContext';
import { ExpenseContext } from '../Expense/ExpenseContext';
import { DebtAccount, PropertyAccount } from './models';
import { ConfirmDialog } from '../../Layout/ConfirmDialog';

interface DeleteControlProps {
    accountId: string;
    accountName?: string;
}

const DeleteAccountControl: React.FC<DeleteControlProps> = ({ accountId, accountName }) => {
    const { accounts, dispatch: accountDispatch } = useContext(AccountContext);
    const { dispatch: expenseDispatch } = useContext(ExpenseContext);
    const [isConfirmOpen, setIsConfirmOpen] = useState(false);

    const account = accounts.find(acc => acc.id === accountId);

    const handleDeleteClick = () => {
        setIsConfirmOpen(true);
    };

    const handleConfirm = () => {
        // Delete linked expense if this is a debt or property account
        if (account instanceof DebtAccount || account instanceof PropertyAccount) {
            if (account.linkedAccountId) {
                expenseDispatch({
                    type: 'DELETE_EXPENSE',
                    payload: { id: account.linkedAccountId }
                });
            }
        }

        accountDispatch({
            type: 'DELETE_ACCOUNT',
            payload: { id: accountId }
        });
        setIsConfirmOpen(false);
    };

    const handleCancel = () => {
        setIsConfirmOpen(false);
    };

    // Determine if this account has a linked expense
    const hasLinkedExpense = account instanceof DebtAccount || account instanceof PropertyAccount;
    const message = hasLinkedExpense
        ? "This will permanently delete this account and its linked expense (mortgage/loan payment). This action cannot be undone."
        : "This will permanently delete this account. This action cannot be undone.";

    return (
        <>
            <button
                onClick={handleDeleteClick}
                aria-label={accountName ? `Delete ${accountName} account` : "Delete account"}
                className="p-1 rounded-full text-red-400 hover:text-red-300 transition-colors"
            >
                <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="20"
                    height="20"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                >
                    <path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                </svg>
            </button>

            <ConfirmDialog
                isOpen={isConfirmOpen}
                title="Delete Account"
                message={message}
                confirmLabel="Delete"
                cancelLabel="Cancel"
                onConfirm={handleConfirm}
                onCancel={handleCancel}
                variant="danger"
            />
        </>
    );
};

export default DeleteAccountControl;
