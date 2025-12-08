import TopBar from "../components/TopBar";
import { useState, useMemo} from 'react';
import { useAccounts } from '../context/AccountsContext';
import { Account, ACCOUNT_CATEGORIES } from '../types';


type CurrentProps = {
  setIsOpen: React.Dispatch<React.SetStateAction<boolean>>;
};
type AccountTabs = 'All' | Account['category'];

export default function Current({setIsOpen}: CurrentProps ) {
  const { accounts, addAccount, removeAccount, updateAccount} = useAccounts();
  const [activeTab, setActiveTab] = useState<AccountTabs>('Saved');
  const [name, setName] = useState('');
  const [balance, setBalance] = useState('');
  const [category, setCategory] = useState<Account['category']>(ACCOUNT_CATEGORIES[0]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !balance) return;
    const newAccount: Account = {
      id: crypto.randomUUID(),
      name,
      balance:  parseFloat(balance),
      category,
    };

    addAccount(newAccount);
    setName('');
    setBalance('');
  };

  const filteredAccounts = accounts.filter(account => {
    if (activeTab === 'All') {
      return true;
    }
    return account.category === activeTab;
  });

  const getTabTotal = () => {
    return filteredAccounts.reduce((sum, acc) => acc.category == ACCOUNT_CATEGORIES[3] ? sum + acc.balance * -1 : sum + acc.balance, 0);
  };

  
  const getSpecificTabTotal = (category: string) => {
    if (category === 'All') {
      return accounts.reduce((sum, acc) => acc.category == ACCOUNT_CATEGORIES[3] ? sum + acc.balance * -1 : sum + acc.balance, 0);
    }
    return accounts.reduce((sum, acc) => acc.category == category ? sum + acc.balance : sum, 0);
  };

  const tabTotal = getTabTotal();
  const tabs: AccountTabs[] = [...ACCOUNT_CATEGORIES];
  const [editingNameId, setEditingNameId] = useState<string | null>(null);
  const [editingBalanceId, setEditingBalanceId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [editingBalance, setEditingBalance] = useState('');

  // Handler to save the changes
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

  const { categoryTotals, maxBalance, totalAssetsMagnitude } = useMemo(() => { // 👈 Renamed totalAssets to totalAssetsMagnitude
  const totals = ACCOUNT_CATEGORIES.reduce((acc, category) => {
    acc[category] = accounts
      .filter(a => a.category === category)
      .reduce((sum, a) => sum + a.balance, 0);
    return acc;
  }, {} as Record<Account['category'], number>);
  
  // Calculate the sum of the absolute values of ALL categories (Assets + Debt magnitude)
  const assetsMagnitude = ACCOUNT_CATEGORIES.reduce((sum, category) => sum + Math.abs(totals[category]), 0);

  // Find the largest absolute value (for legacy use or if needed)
  const absoluteTotals = Object.values(totals).map(Math.abs);
  const max = Math.max(...absoluteTotals, 1); 

  return { 
    categoryTotals: totals, 
    maxBalance: max,
    totalAssetsMagnitude: assetsMagnitude // 👈 Use this for the 100% baseline
  };
}, [accounts]);

  const total = getSpecificTabTotal('All');

  return (
    <div className="space-y-6">
      <TopBar setIsOpen={setIsOpen} title="Current"/>

      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        {/* <h2 className="text-lg font-semibold mb-4">Balance Distribution (Magnitude)</h2> */}
        
        <div className="flex justify-between items-center text-sm mb-2">
          <span className="font-medium text-gray-600">Networth</span>
          <span className="font-semibold text-gray-900">
            ${total.toLocaleString()}
          </span>
        </div>
        
        {/* The Main Stacked Bar */}
        <div className="w-full h-4 flex rounded-lg overflow-hidden border border-gray-300">
          {/* Loop over ALL categories, including Debt */}
          {ACCOUNT_CATEGORIES.map((category) => {
            const total = categoryTotals[category];
            const isDebt = category === 'Debt';
            
            // Calculate the segment width based on the total magnitude
            const widthPercentage = totalAssetsMagnitude === 0 ? 0 : (Math.abs(total) / totalAssetsMagnitude) * 100;
            
            // Define colors for visualization
            let colorClass = 'bg-gray-400';
            if (isDebt) colorClass = 'bg-red-500'; // Debt is Red
            else if (category === 'Saved') colorClass = 'bg-blue-500';
            else if (category === 'Invested') colorClass = 'bg-yellow-500';
            else if (category === 'Property') colorClass = 'bg-purple-500';
            
            return (
              <div
                key={category}
                className={`${colorClass} h-full transition-all duration-700 ease-out`}
                style={{ width: `${widthPercentage}%` }}
                title={`${category}: $${total.toLocaleString()}`}
              ></div>
            );
          })}
        </div>
        
        {/* Legend is simplified to reflect all categories */}
        <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm">
          {ACCOUNT_CATEGORIES.map((category) => {
            const total = categoryTotals[category];
            const isDebt = category === 'Debt';
            
            let colorClass = 'bg-gray-400';
            if (isDebt) colorClass = 'bg-red-500';
            else if (category === 'Saved') colorClass = 'bg-blue-500';
            else if (category === 'Invested') colorClass = 'bg-yellow-500';
            else if (category === 'Property') colorClass = 'bg-purple-500';

            return (
              <div key={category} className="flex items-center gap-2">
                <span className={`w-3 h-3 rounded-full ${colorClass}`}></span>
                <span className="text-gray-600">
                  {category} (${Math.abs(total).toLocaleString()})
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <h2 className="text-lg font-semibold mb-4">Account Holdings Breakdown</h2>
        
        <div className="space-y-6">
          {ACCOUNT_CATEGORIES.map((category) => {
            const categoryTotal = categoryTotals[category];
            const accountsInCategory = accounts.filter(a => a.category === category);
            const isDebt = category === 'Debt';

            // Only render a chart if there are accounts in the category
            if (accountsInCategory.length === 0) {
              return null;
            }
            
            // Determine the outer bar color based on category
            let categoryColor = 'bg-gray-400';
            if (isDebt) categoryColor = 'bg-red-500'; 
            else if (category === 'Saved') categoryColor = 'bg-blue-500';
            else if (category === 'Invested') categoryColor = 'bg-yellow-500';
            else if (category === 'Property') categoryColor = 'bg-purple-500';
            
            return (
              <div key={category}>
                {/* Header for the individual category chart */}
                <div className="flex justify-between items-center text-sm mb-2">
                  <span className="font-medium text-gray-700">{category} Total:</span>
                  <span className={`font-semibold ${isDebt ? 'text-red-600' : 'text-green-600'}`}>
                    ${Math.abs(categoryTotal).toLocaleString()}
                  </span>
                </div>

                {/* Stacked Bar for Accounts within this Category */}
                <div className="w-full h-6 flex rounded-lg overflow-hidden border border-gray-300">
                  {accountsInCategory.map((account, index) => {
                    const widthPercentage = categoryTotal === 0 ? 0 : (Math.abs(account.balance) / Math.abs(categoryTotal)) * 100;
                    
                    // Define a set of valid colors for segments
                    const ASSET_SHADES = ['bg-blue-600', 'bg-blue-400', 'bg-blue-300', 'bg-blue-200', 'bg-blue-100'];
                    const LIABILITY_SHADES = ['bg-red-600', 'bg-red-400', 'bg-red-300', 'bg-red-200', 'bg-red-100'];

                    // 1. Determine the palette based on debt status
                    const shadePalette = isDebt ? LIABILITY_SHADES : ASSET_SHADES;
                    
                    // 2. Select a color using the index, cycling back if needed
                    //    The modulo operator (%) ensures the index wraps around to the beginning of the array if there are more than 5 accounts.
                    const segmentColor = shadePalette[index % shadePalette.length]; 
                    
                    return (
                      <div
                        key={account.id}
                        className={`${segmentColor} h-full`} // 👈 Use the defined color
                        style={{ width: `${widthPercentage}%` }}
                        title={`${account.name}: $${account.balance.toLocaleString()}`}
                      >
                        {/* ... rest of the segment JSX ... */}
                      </div>
                    );
                  })}
                </div>
                
                {/* Optional: Simple Legend for Account Names/Balances */}
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
                  {accountsInCategory.map(account => (
                    <span key={account.id}>
                      {account.name}: ${account.balance.toLocaleString()}
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex border-b border-gray-200 mb-6">
        {tabs.map((tab) => (
          <button
            key={tab}
            onClick={() => (setActiveTab(tab), setCategory(tab as Account['category']))}
            className={`
              px-4 py-2 text-sm font-medium transition-colors duration-150 ease-in-out
              ${activeTab === tab 
                ? 'text-blue-600 border-b-2 border-blue-600' 
                : 'text-gray-500 hover:text-gray-700'
              }
            `}
          >
            <div className="flex">
            {tab} ${getSpecificTabTotal(tab).toLocaleString()}
            </div>
          </button>
        ))}
      </div>
      
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
        <div className="p-4 border-b border-gray-200 bg-gray-50 flex justify-between items-center">
          <h2 className="font-semibold text-gray-700">{activeTab} Accounts List</h2>
          <span className="text-sm text-gray-500">{filteredAccounts.length} Accounts</span> 
        </div>
        
        <div className="divide-y divide-gray-200">
          {filteredAccounts.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              No {activeTab.toLowerCase()} accounts yet. Add one below!
            </div>
          ) : (
            filteredAccounts.map((account) => (
              <div key={account.id} className="p-4 flex items-center justify-between hover:bg-gray-50 group">
                <div className="flex items-center gap-4">
                  <div className={`w-2 h-12 rounded-full ${
                    account.category === ACCOUNT_CATEGORIES[3] ? 'bg-red-500' : 'bg-green-500'
                  }`}></div>
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
                      
                      className="font-medium text-gray-900 border-b border-blue-500 bg-transparent focus:outline-none"
                      autoFocus 
                    /> ) : (
                    <h3 
                      className="font-medium text-gray-900 cursor-pointer hover:underline"
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
                      
                      className={`font-bold border-b border-blue-500 bg-transparent text-right focus:outline-none w-24 ${
                        account.category === 'Debt' ? 'text-red-600' : 'text-gray-900'
                      }`}
                      autoFocus
                    />
                  ) : (
                    <span
                      className={`font-bold cursor-pointer hover:underline ${
                        account.category === 'Debt' ? 'text-red-600' : 'text-gray-900'
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
            ))
          )}
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <h2 className="text-lg font-semibold mb-4">Add New Account</h2>
        <form onSubmit={handleSubmit} className="flex gap-4 items-end">
          <div className="flex-1">
            <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value == 'All' ? ACCOUNT_CATEGORIES[0] : e.target.value)}
              className="w-full p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
              placeholder="e.g. Chase Checking"
            />
          </div>
          <div className="w-48">
            <label className="block text-sm font-medium text-gray-700 mb-1">Balance</label>
            <input
              type="number"
              value={balance}
              onChange={(e) => setBalance(e.target.value)}
              className="w-full p-2 border border-gray-300 rounded-md"
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
    </div>
  );
}