import React, { useContext, useState } from 'react';
import { AccountContext, AccountDispatchContext } from './AccountContext';
import { ExpenseDispatchContext } from '../Expense/ExpenseContext';
import { IncomeContext } from '../Income/IncomeContext';
import { AssumptionsContext } from '../Assumptions/AssumptionsContext';
import { DebtAccount, PropertyAccount } from './models';
import { WorkIncome } from '../Income/models';
import { ConfirmDialog } from '../../Layout/ConfirmDialog';
import { useReceiptToast } from '../../Layout/Overlays/ReceiptToast';

interface DeleteControlProps {
    accountId: string;
    accountName?: string;
}

const DeleteAccountControl: React.FC<DeleteControlProps> = ({ accountId, accountName }) => {
    const { accounts } = useContext(AccountContext);
    const { dispatch: accountDispatch } = useContext(AccountDispatchContext);
    const expenseDispatch = useContext(ExpenseDispatchContext);
    const { incomes } = useContext(IncomeContext);
    const { state: assumptions, dispatch: assumptionsDispatch } = useContext(AssumptionsContext);
    const receiptToast = useReceiptToast();
    const [isConfirmOpen, setIsConfirmOpen] = useState(false);

    const account = accounts.find(acc => acc.id === accountId);

    // References to this account elsewhere in the plan
    const referencingPriorities = assumptions.priorities.filter(p => p.accountId === accountId);
    const referencingWithdrawals = assumptions.withdrawalStrategy.filter(w => w.accountId === accountId);
    const payrollRoutedIncomes = incomes.filter(
        (i): i is WorkIncome => i instanceof WorkIncome
            && (i.matchAccountId === accountId || i.esppAccountId === accountId)
    );
    const hasCleanup = referencingPriorities.length > 0 || referencingWithdrawals.length > 0;
    const hasReferences = hasCleanup || payrollRoutedIncomes.length > 0;

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

        // Clean up plan objects that point at this account. Payroll routings
        // (401k match / ESPP) are intentionally NOT auto-cleared — the user
        // must pick a replacement account on the income itself.
        referencingPriorities.forEach(p => {
            assumptionsDispatch({ type: 'REMOVE_PRIORITY', payload: p.id });
        });
        if (referencingWithdrawals.length > 0) {
            assumptionsDispatch({
                type: 'SET_WITHDRAWAL_STRATEGY',
                payload: assumptions.withdrawalStrategy.filter(w => w.accountId !== accountId)
            });
        }

        accountDispatch({
            type: 'DELETE_ACCOUNT',
            payload: { id: accountId }
        });

        // Deletion receipt: confirm everything that went with the account.
        // Deliberately no link — there's nothing to navigate to afterwards.
        const extras: string[] = [];
        if ((account instanceof DebtAccount || account instanceof PropertyAccount) && account.linkedAccountId) {
            extras.push(account instanceof PropertyAccount ? 'its mortgage expense' : 'its loan expense');
        }
        if (referencingPriorities.length > 0) {
            extras.push(`${referencingPriorities.length} allocation ${referencingPriorities.length === 1 ? 'bucket' : 'buckets'}`);
        }
        if (referencingWithdrawals.length > 0) {
            extras.push(`${referencingWithdrawals.length} withdrawal-order ${referencingWithdrawals.length === 1 ? 'entry' : 'entries'}`);
        }
        receiptToast.show({
            message: extras.length > 0
                ? `Deleted '${account?.name ?? accountName ?? 'account'}' along with ${extras.join(', ')}`
                : `Deleted '${account?.name ?? accountName ?? 'account'}'`,
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

    const impactDetails = hasReferences ? (
        <div className="bg-yellow-900/30 border border-yellow-700/50 rounded-lg p-3 text-yellow-300 text-sm space-y-2">
            {hasCleanup && (
                <div>
                    <p>Deleting this account also removes:</p>
                    <ul className="list-disc list-inside mt-1 space-y-0.5">
                        {referencingPriorities.map(p => (
                            <li key={`pri-${p.id}`}>Allocation priority: <span className="font-medium">{p.name}</span></li>
                        ))}
                        {referencingWithdrawals.map(w => (
                            <li key={`wd-${w.id}`}>Withdrawal order entry: <span className="font-medium">{w.name}</span></li>
                        ))}
                    </ul>
                </div>
            )}
            {payrollRoutedIncomes.length > 0 && (
                <div>
                    <p>Payroll routing (401k match / ESPP) points at this account — reassign these incomes afterward:</p>
                    <ul className="list-disc list-inside mt-1 space-y-0.5">
                        {payrollRoutedIncomes.map(i => (
                            <li key={`inc-${i.id}`}>{i.name}</li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    ) : undefined;

    return (
        <>
            <button
                onClick={handleDeleteClick}
                aria-label={accountName ? `Delete ${accountName} account` : "Delete account"}
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
                title="Delete Account"
                message={message}
                confirmLabel="Delete"
                cancelLabel="Cancel"
                onConfirm={handleConfirm}
                onCancel={handleCancel}
                variant="danger"
                details={impactDetails}
            />
        </>
    );
};

export default DeleteAccountControl;
