import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { Account, AccountHistoryEntry } from '../types';

interface AccountsContextType {
  accounts: Account[];
  history: AccountHistoryEntry[];
  addAccount: (account: Account) => void;
  removeAccount: (id: string) => void;
  updateAccount: (updatedAccount: Account) => void;
  getCatTotal: (category: string) => number;
  getFilteredAccount: (category: string) => Account[];
}
const AccountsContext = createContext<AccountsContextType | undefined>(undefined);

export function AccountsProvider({ children }: { children: ReactNode }) {
  const [history, setHistory] = useState<AccountHistoryEntry[]>(() => {
    const saved = localStorage.getItem('user_accounts_history');
    return saved ? JSON.parse(saved) : [];
  });  
  const [accounts, setAccounts] = useState<Account[]>(() => {
    const saved = localStorage.getItem('user_accounts');
    return saved ? JSON.parse(saved) : [];
  });

  useEffect(() => {
    localStorage.setItem('user_accounts', JSON.stringify(accounts));
    localStorage.setItem('user_accounts_history', JSON.stringify(history));
  }, [accounts]);

  const addAccount = (account: Account) => {
    var temp = new Date()
    temp.setHours(0, 0, 0, 0)
    setAccounts(prevAccounts => [...prevAccounts, account]);

    const initialHistoryEntry: AccountHistoryEntry = {
      accountId: account.id,
      balance: account.balance,
      timestamp: temp, 
  };
  setHistory(prevHistory => [...prevHistory, initialHistoryEntry]);
};

const removeAccount = (id: string) => {
  setAccounts(prevAccounts => prevAccounts.filter(acc => acc.id !== id));

  setHistory(prevHistory => 
    prevHistory.filter(entry => entry.accountId !== id)
  );

  console.log(`Account ID: ${id} and all associated history records have been removed.`);
};

  const updateAccount = (updatedAccount: Account) => {
  setAccounts(prevAccounts => 
    prevAccounts.map(account => {
      if (account.id === updatedAccount.id) {
        if (account.balance !== updatedAccount.balance) {
          const newHistoryEntry: AccountHistoryEntry = {
            accountId: updatedAccount.id,
            balance: updatedAccount.balance,
            timestamp: new Date(),
          };
          
          setHistory(prevHistory => [...prevHistory, newHistoryEntry]);
        }
        return updatedAccount;
      }
      return account;
    })
  );
};

  
  const getFilteredAccount = (category: string) =>{
    if (category === "All"){
      return accounts
    }
    return accounts.filter(acc => acc.category === category);
  }

  const getCatTotal = (category: string) => {
    if (category === "All") {
       return accounts.reduce((sum, acc) => acc.category == "Debt" ? sum + acc.balance * -1 : sum + acc.balance, 0);
    }
    else {
       return accounts.reduce((sum, acc) => acc.category == category ? sum + acc.balance : sum, 0);
    }
  }

  return (
    <AccountsContext.Provider value={{accounts, history, addAccount, removeAccount, updateAccount, getCatTotal, getFilteredAccount}}>
      {children}
    </AccountsContext.Provider>
  );
}

export function useAccounts() {
  const context = useContext(AccountsContext);
  if (context === undefined) {
    throw new Error('useAccounts must be used within an AccountsProvider');
  }
  return context;
}
