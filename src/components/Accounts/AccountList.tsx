import { Account, ACCOUNT_CATEGORIES, CATEGORY_COLOR_BACKGROUND_MAP, CATEGORY_COLOR_TEXT_MAP} from '../../types';
import { useAccounts } from '../../context/AccountsContext';
import { useState} from 'react';

type AccountListProps = {
  filteredAccounts: Account[],
  category: Account["category"];
};

export default function AccountList({filteredAccounts, category}: AccountListProps) {
  const {removeAccount, updateAccount} = useAccounts();
  const [editingNameId, setEditingNameId] = useState<string | null>(null);
  const [editingBalanceId, setEditingBalanceId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [editingBalance, setEditingBalance] = useState('');

  const saveName = (account: Account) => {
    if (editingName.trim() === '' || editingName === account.name) {
      setEditingNameId(null);
      return;
    }
    
    const updatedAccount = { ...account, name: editingName };
    updateAccount(updatedAccount);
    setEditingNameId(null);
  };

  const saveBalance = (account: Account) => {
    const newBalance = parseFloat(editingBalance);
    if (isNaN(newBalance) || newBalance === account.balance) {
      setEditingBalanceId(null);
      return;
    }
    
    const updatedAccount = { ...account, balance: newBalance };
    updateAccount(updatedAccount);
    setEditingBalanceId(null);
  };

  return (
    <div className="rounded-lg shadow-sm overflow-hidden">
            <div className="divide-y divide-gray-900">
              {filteredAccounts.length === 0 ? (
                <div className="p-2 text-center text-white">
                  No {category.toLowerCase()} accounts yet. Add one below!
                </div>
              ) : (
                filteredAccounts.map((account) => {
                  const bgColorClass = CATEGORY_COLOR_BACKGROUND_MAP[account.category];
                  const txColorClass = CATEGORY_COLOR_TEXT_MAP[account.category];
                  return(
                  <div key={account.id} className="p-4 flex items-center justify-between hover:bg-gray-600 group">
                    <div className="flex items-center gap-4">
                      <div className={`w-2 h-12 rounded-full ${bgColorClass}`}></div>
                      {editingNameId === account.id ? (
                        <input
                          type="text"
                          value={editingName}
                          onChange={(e) => setEditingName(e.target.value)}
                          
                          // Save/Exit logic
                          onBlur={() => saveName(account)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              saveName(account);
                            }
                            if (e.key === 'Escape') setEditingNameId(null);
                          }}
                          
                          className="font-medium text-white bg-transparent focus:outline-none"
                          autoFocus 
                        /> ) : (
                        <h3 
                          className="font-medium text-white cursor-pointer hover:underline"
                          // Start edit logic
                          onClick={() => {
                            setEditingName(account.name);
                            setEditingNameId(account.id);
                          }}
                        >
                          {account.name}
                        </h3>
                      )}
                    </div>
                    <div className="flex items-center gap-6">
                      {editingBalanceId === account.id ? (
                        <input
                          type="number"
                          value={editingBalance}
                          onChange={(e) => setEditingBalance(e.target.value)}
                          
                          // Save/Exit logic
                          onBlur={() => saveBalance(account)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              saveBalance(account);
                            }
                            if (e.key === 'Escape') setEditingBalanceId(null);
                          }}
                          
                          className={`font-bold bg-transparent text-right focus:outline-none w-24 ${
                            txColorClass
                          }`}
                          autoFocus
                        />
                      ) : (
                        <span
                          className={`font-bold cursor-pointer hover:underline ${
                            txColorClass
                          }`}
                          // Start edit logic
                          onClick={() => {
                            setEditingBalance(account.balance.toFixed(2));
                            setEditingBalanceId(account.id);
                          }}
                        >
                          ${account.balance.toLocaleString()}
                        </span>
                      )}
                      <button
                        onClick={() => removeAccount(account.id)}
                        className="text-red-500 invisible group-hover:visible"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>
                        </svg>
                      </button>
                    </div>
                  </div>
                )})
              )}
            </div>
          </div>
  );
}