import React, { useContext } from 'react';
import { AccountContext } from '../../components/Accounts/AccountContext';

interface DeleteControlProps {
    accountId: string;
}

const DeleteAccountControl: React.FC<DeleteControlProps> = ({ accountId }) => {
    const { dispatch } = useContext(AccountContext);

    const handleDelete = () => {
        dispatch({ 
            type: 'DELETE_ACCOUNT', 
            payload: { id: accountId } 
        });
    };

    return (
        <button 
            onClick={handleDelete}
            title="Delete Account"
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

export default DeleteAccountControl;