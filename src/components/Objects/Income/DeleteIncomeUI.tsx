import React, { useContext, useState } from 'react';
import { IncomeContext } from './IncomeContext';
import { ConfirmDialog } from '../../Layout/ConfirmDialog';

interface DeleteControlProps {
    incomeId: string;
    incomeName?: string;
}

const DeleteIncomeControl: React.FC<DeleteControlProps> = ({ incomeId, incomeName }) => {
    const { dispatch } = useContext(IncomeContext);
    const [isConfirmOpen, setIsConfirmOpen] = useState(false);

    const handleDeleteClick = () => {
        setIsConfirmOpen(true);
    };

    const handleConfirm = () => {
        dispatch({
            type: 'DELETE_INCOME',
            payload: { id: incomeId }
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
                title="Delete Income"
                message="This will permanently delete this income source. This will affect your cashflow projections. This action cannot be undone."
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
