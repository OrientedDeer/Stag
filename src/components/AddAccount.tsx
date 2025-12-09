import { Account, ACCOUNT_CATEGORIES, ACCOUNT_COLORS_BACKGROUND, ACCOUNT_COLORS_TEXT} from '../types';
import { useAccounts } from '../context/AccountsContext';
import { useState} from 'react';

type AddAccountProps = {
  category: Account['category'];
};

export default function AddAccount({category}: AddAccountProps) {

    const {addAccount} = useAccounts();
    const [name, setName] = useState('');
    const [balance, setBalance] = useState('');

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!name || !balance) return;
        const newAccount: Account = {
          id: crypto.randomUUID(),
          name,
          balance:  parseFloat(balance),
          bgcolor: ACCOUNT_COLORS_BACKGROUND[ACCOUNT_CATEGORIES.indexOf(category)],
          txcolor: ACCOUNT_COLORS_TEXT[ACCOUNT_CATEGORIES.indexOf(category)],
          category,
        };
    
        addAccount(newAccount);
        setName('');
        setBalance('');
      };

    return (
        <div className="rounded-lg p-6">
            <h2 className="text-lg font-semibold mb-4">Add New Account</h2>
            <form onSubmit={handleSubmit} className="flex gap-4 items-end">
            <div className="flex-1">
                <label className="block text-sm font-medium text-white mb-1">Name</label>
                <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full p-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="e.g. Chase Checking"
                />
            </div>
            <div className="w-48">
                <label className="block text-sm font-medium text-white mb-1">Balance</label>
                <input
                type="number"
                value={balance}
                onChange={(e) => setBalance(e.target.value)}
                className="w-full p-2"
                placeholder="0.00"
                />
            </div>
            <button
                type="submit"
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
            >
                Add
            </button>
            </form>
        </div>
    );
}