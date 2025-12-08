import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { Account } from '../types';

interface AccountsContextType {
  accounts: Account[];
  addAccount: (account: Account) => void;
  removeAccount: (id: string) => void;
  updateAccount: (updatedAccount: Account) => void;
  getTotalBalance: () => number;
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

  const getTotalBalance = () => {
    return accounts.reduce((sum, acc) => acc.category == "Debt" ? sum + acc.balance * -1 : sum + acc.balance, 0);
  };

  return (
    <AccountsContext.Provider value={{ accounts, addAccount, removeAccount, updateAccount, getTotalBalance }}>
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