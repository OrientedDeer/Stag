import React, { useContext, useState } from 'react';
import { ExpenseContext } from './ExpenseContext';
import { AccountContext } from '../Accounts/AccountContext';
import { MortgageExpense, LoanExpense } from './models';
import { ConfirmDialog } from '../../Layout/ConfirmDialog';

interface DeleteControlProps {
    expenseId: string;
}

const DeleteExpenseControl: React.FC<DeleteControlProps> = ({ expenseId }) => {
    const { expenses, dispatch: expenseDispatch } = useContext(ExpenseContext);
    const { dispatch: accountDispatch } = useContext(AccountContext);
    const [isConfirmOpen, setIsConfirmOpen] = useState(false);

    const expense = expenses.find(exp => exp.id === expenseId);

    const handleDeleteClick = () => {
        setIsConfirmOpen(true);
    };

    const handleConfirm = () => {
        // Delete linked account if this is a mortgage or loan expense
        if (expense instanceof MortgageExpense || expense instanceof LoanExpense) {
            if (expense.linkedAccountId) {
                accountDispatch({
                    type: 'DELETE_ACCOUNT',
                    payload: { id: expense.linkedAccountId }
                });
            }
        }

        expenseDispatch({
            type: 'DELETE_EXPENSE',
            payload: { id: expenseId }
        });
        setIsConfirmOpen(false);
    };

    const handleCancel = () => {
        setIsConfirmOpen(false);
    };

    // Determine if this expense has a linked account
    const hasLinkedAccount = expense instanceof MortgageExpense || expense instanceof LoanExpense;
    const message = hasLinkedAccount
        ? "This will permanently delete this expense and its linked account (property/debt). This action cannot be undone."
        : "This will permanently delete this expense. This action cannot be undone.";

    return (
        <>
            <button
                onClick={handleDeleteClick}
                title="Delete Expense"
                className="p-1 rounded-full text-red-400 hover:text-red-300 transition-colors"
            >
                <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="20"
                    height="20"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                >
                    <path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                </svg>
            </button>

            <ConfirmDialog
                isOpen={isConfirmOpen}
                title="Delete Expense"
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

export default DeleteExpenseControl;
