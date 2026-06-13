import React, { useContext, useState } from 'react';
import { IncomeContext, IncomeDispatchContext } from './IncomeContext';
import { AccountContext } from '../Accounts/AccountContext';
import { FERSPensionIncome, CSRSPensionIncome } from './models';
import { ESPPAccount } from '../Accounts/models';
import { ConfirmDialog } from '../../Layout/ConfirmDialog';
import { useReceiptToast } from '../../Layout/Overlays/ReceiptToast';

interface DeleteControlProps {
    incomeId: string;
    incomeName?: string;
}

const DeleteIncomeControl: React.FC<DeleteControlProps> = ({ incomeId, incomeName }) => {
    const { incomes } = useContext(IncomeContext);
    const { accounts } = useContext(AccountContext);
    const dispatch = useContext(IncomeDispatchContext);
    const receiptToast = useReceiptToast();
    const [isConfirmOpen, setIsConfirmOpen] = useState(false);

    const income = incomes.find(inc => inc.id === incomeId);

    // Objects that reference this income elsewhere in the plan. The links are
    // NOT auto-cleared — a pension's High-3 tracking and an ESPP account's
    // purchase source need a replacement the user must pick — so the dialog
    // warns and the objects keep a dangling reference until reassigned.
    const referencingPensions = incomes.filter(
        (inc): inc is FERSPensionIncome | CSRSPensionIncome =>
            (inc instanceof FERSPensionIncome || inc instanceof CSRSPensionIncome)
            && inc.linkedIncomeId === incomeId
    );
    const referencingESPPAccounts = accounts.filter(
        (acc): acc is ESPPAccount => acc instanceof ESPPAccount && acc.linkedIncomeId === incomeId
    );
    const hasReferences = referencingPensions.length > 0 || referencingESPPAccounts.length > 0;

    const handleDeleteClick = () => {
        setIsConfirmOpen(true);
    };

    const handleConfirm = () => {
        dispatch({
            type: 'DELETE_INCOME',
            payload: { id: incomeId }
        });

        // Deletion receipt — deliberately no link (nothing to navigate to).
        receiptToast.show({
            message: hasReferences
                ? `Deleted '${income?.name ?? incomeName ?? 'income'}' — review the linked pension/ESPP references it left behind`
                : `Deleted '${income?.name ?? incomeName ?? 'income'}'`,
        });
        setIsConfirmOpen(false);
    };

    const handleCancel = () => {
        setIsConfirmOpen(false);
    };

    return (
        <>
            <button
                onClick={handleDeleteClick}
                aria-label={incomeName ? `Delete ${incomeName} income` : "Delete income"}
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
                title="Delete Income"
                message="This will permanently delete this income source. This will affect your cashflow projections. This action cannot be undone."
                details={hasReferences ? (
                    <div className="bg-yellow-900/30 border border-yellow-700/50 rounded-lg p-3 text-sm text-yellow-300">
                        <p className="font-semibold">Other items link to this income:</p>
                        <ul className="mt-1 list-disc list-inside">
                            {referencingPensions.map(p => (
                                <li key={p.id}>{p.name} — uses this income's salary for its High-3 calculation</li>
                            ))}
                            {referencingESPPAccounts.map(a => (
                                <li key={a.id}>{a.name} — ESPP account fed by this income</li>
                            ))}
                        </ul>
                        <p className="mt-1">They won't be deleted, but you should reassign them afterward.</p>
                    </div>
                ) : undefined}
                confirmLabel="Delete"
                cancelLabel="Cancel"
                onConfirm={handleConfirm}
                onCancel={handleCancel}
                variant="danger"
            />
        </>
    );
};

export default DeleteIncomeControl;
