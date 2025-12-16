import React, { useContext } from 'react';
import { ExpenseContext } from './ExpenseContext';

interface DeleteControlProps {
    ExpenseId: string;
}

const DeleteExpenseControl: React.FC<DeleteControlProps> = ({ ExpenseId }) => {
    const { dispatch } = useContext(ExpenseContext);

    const handleDelete = () => {
        dispatch({ 
            type: 'DELETE_EXPENSE', 
            payload: { id: ExpenseId } 
        });
    };

    return (
        <button 
            onClick={handleDelete}
            title="Delete Expense"
            className="p-1 rounded-full text-red-400 hover:text-green-300 transition-colors"
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
    );
};

export default DeleteExpenseControl;