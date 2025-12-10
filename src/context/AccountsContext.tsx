import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { Account, ACCOUNT_CATEGORIES } from '../types';

interface AccountsContextType {
  accounts: Account[];
  addAccount: (account: Account) => void;
  removeAccount: (id: string) => void;
  updateAccount: (updatedAccount: Account) => void;
  getCatTotal: (category: string) => number;
  getFilteredAccount: (category: string) => Account[];
}
const AccountsContext = createContext<AccountsContextType | undefined>(undefined);

export function AccountsProvider({ children }: { children: ReactNode }) {
  const [accounts, setAccounts] = useState<Account[]>(() => {
    const saved = localStorage.getItem('user_accounts');
    return saved ? JSON.parse(saved) : [];
  });

  useEffect(() => {
    localStorage.setItem('user_accounts', JSON.stringify(accounts));
  }, [accounts]);

  const addAccount = (account: Account) => {
    ACCOUNT_CATEGORIES as ReadonlyArray<string>
    setAccounts([...accounts, account]);
  };

  const removeAccount = (id: string) => {
    setAccounts(accounts.filter(acc => acc.id !== id));
  };

  const updateAccount = (updatedAccount: Account) => {
    setAccounts(prevAccounts => 
      prevAccounts.map(account =>
        account.id === updatedAccount.id ? updatedAccount : account
      )
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
    <AccountsContext.Provider value={{accounts, addAccount, removeAccount, updateAccount, getCatTotal, getFilteredAccount}}>
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