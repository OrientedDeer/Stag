import React, { useContext, useState } from 'react';
import { ExpenseContext, ExpenseDispatchContext } from './ExpenseContext';
import { AccountDispatchContext } from '../Accounts/AccountContext';
import { AssumptionsContext } from '../Assumptions/AssumptionsContext';
import { MortgageExpense, LoanExpense, isLongTermGoal } from './models';
import { ConfirmDialog } from '../../Layout/ConfirmDialog';
import { useReceiptToast } from '../../Layout/Overlays/ReceiptToast';

interface DeleteControlProps {
    expenseId: string;
    expenseName?: string;
}

const DeleteExpenseControl: React.FC<DeleteControlProps> = ({ expenseId, expenseName }) => {
    const { expenses } = useContext(ExpenseContext);
    const expenseDispatch = useContext(ExpenseDispatchContext);
    const { dispatch: accountDispatch } = useContext(AccountDispatchContext);
    const { state: assumptions, dispatch: assumptionsDispatch } = useContext(AssumptionsContext);
    const receiptToast = useReceiptToast();
    const [isConfirmOpen, setIsConfirmOpen] = useState(false);

    const expense = expenses.find(exp => exp.id === expenseId);
    // A long-term goal owns an auto-created sinking-fund account + savings
    // priority; deleting the goal must clean both up or they fund a dead account.
    const isGoalWithFund = !!expense && isLongTermGoal(expense) && !!expense.goalAccountId;

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

        // Delete a goal's auto-created sinking-fund account (and any legacy
        // funding priority from before goal funding became a committed
        // transfer) so nothing keeps referencing a dead account.
        if (isGoalWithFund && expense?.goalAccountId) {
            const fundId = expense.goalAccountId;
            accountDispatch({ type: 'DELETE_ACCOUNT', payload: { id: fundId } });
            (assumptions.priorities || [])
                .filter(p => p.accountId === fundId)
                .forEach(p => assumptionsDispatch({ type: 'REMOVE_PRIORITY', payload: p.id }));
        }

        expenseDispatch({
            type: 'DELETE_EXPENSE',
            payload: { id: expenseId }
        });

        // Deletion receipt: confirm what went with the expense. Deliberately
        // no link — there's nothing to navigate to afterwards.
        const name = expense?.name ?? expenseName ?? 'expense';
        let message = `Deleted '${name}'`;
        if (expense instanceof MortgageExpense && expense.linkedAccountId) {
            message = `Deleted '${name}' along with its property account`;
        } else if (expense instanceof LoanExpense && expense.linkedAccountId) {
            message = `Deleted '${name}' along with its debt account`;
        } else if (isGoalWithFund) {
            message = `Deleted goal '${name}' along with its fund account`;
        }
        receiptToast.show({ message });
        setIsConfirmOpen(false);
    };

    const handleCancel = () => {
        setIsConfirmOpen(false);
    };

    // Determine if this expense has a linked account
    const hasLinkedAccount = expense instanceof MortgageExpense || expense instanceof LoanExpense;
    const message = hasLinkedAccount
        ? "This will permanently delete this expense and its linked account (property/debt). This action cannot be undone."
        : isGoalWithFund
            ? "This will permanently delete this goal and its sinking-fund account. This action cannot be undone."
            : "This will permanently delete this expense. This action cannot be undone.";

    return (
        <>
            <button
                onClick={handleDeleteClick}
                aria-label={expenseName ? `Delete ${expenseName} expense` : "Delete expense"}
                className="p-1 rounded-full text-negative hover:text-negative-bright transition-colors"
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
