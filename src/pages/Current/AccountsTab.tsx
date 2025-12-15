import React, { useState, useContext, useEffect } from 'react';
import { AccountProvider, AccountContext } from '../../components/Accounts/AccountContext';
import { 
  SavedAccount, 
  InvestedAccount, 
  PropertyAccount, 
  DebtAccount, 
} from '../../components/Accounts/models';
import AccountCard from '../../components/Accounts/AccountCard';
import HorizontalBarChart from '../../components/Accounts/HorizontalBarChart';
import AddAccountControl from '../../components/Accounts/AddAccountUI';


const AccountList = ({ type }: { type: any }) => {
  const { accounts } = useContext(AccountContext);
  const filteredAccounts = accounts.filter((acc) => acc instanceof type);

  if (filteredAccounts.length === 0) {
    return;
  }

  return (
    <div className="space-y-6">
      {filteredAccounts.map((account) => (
        <AccountCard key={`${account.id}-${account.constructor.name}`} account={account} />
      ))}
    </div>
  );
};

const TabsContent = () => {
    const { accounts, dispatch } = useContext(AccountContext);
    const [activeTab, setActiveTab] = useState<string>('Saved');

    const allAccounts = accounts; 
    const savedAccounts = accounts.filter(acc => acc instanceof SavedAccount);
    const investedAccounts = accounts.filter(acc => acc instanceof InvestedAccount);
    const propertyAccounts = accounts.filter(acc => acc instanceof PropertyAccount);
    const debtAccounts = accounts.filter(acc => acc instanceof DebtAccount);

    const tabs = ['Saved', 'Invested', 'Property', 'Debt'];

    const tabContent: Record<string, React.ReactNode> = {
        Saved: (
            <div className="p-4">
                <AccountList type={SavedAccount} />
                <AddAccountControl 
                    AccountClass={SavedAccount} 
                    title="Savings" 
                />
            </div>
        ),
        Invested: (
            <div className="p-4">
                <AccountList type={InvestedAccount} />
                 <AddAccountControl 
                    AccountClass={InvestedAccount} 
                    title="Investment" 
                    defaultArgs={[0]}
                />
            </div>
        ),
        Property: (
            <div className="p-4">
                <AccountList type={PropertyAccount} />
                <AddAccountControl 
                    AccountClass={PropertyAccount} 
                    title="Property" 
                    defaultArgs={['Owned', 0, 0, 'Simple', 0]} 
                />
            </div>
        ),
        Debt: (
            <div className="p-4">
                <AccountList type={DebtAccount} />
                <AddAccountControl 
                    AccountClass={DebtAccount} 
                    title="Debt" 
                    defaultArgs={[0, 'Simple', 0]} 
                />
            </div>
        ),
    };

    return (
        <div className="w-full min-h-full flex bg-gray-950 justify-center pt-10">
            <div className="w-3/4 max-w-5xl">
                <h1 className="text-3xl text-white font-bold mb-6">Financial Dashboard Overview</h1>
                <div className="space-y-4 mb-8 p-4 bg-gray-900 rounded-xl border border-gray-800">
                    <h2 className="text-xl font-bold text-white mb-4 border-b border-gray-700 pb-2">Portfolio Breakdown</h2>
                    <HorizontalBarChart 
                        type="Total Net Worth" 
                        accountList={allAccounts}
                    />
                    <div className="grid grid-cols-2 gap-4 pt-2">
                        <HorizontalBarChart 
                            type="Saved Accounts" 
                            accountList={savedAccounts}
                        />
                        <HorizontalBarChart 
                            type="Investment Accounts" 
                            accountList={investedAccounts}
                        />
                        <HorizontalBarChart 
                            type="Property Accounts" 
                            accountList={propertyAccounts}
                        />
                        <HorizontalBarChart 
                            type="Debt Accounts" 
                            accountList={debtAccounts}
                        />
                    </div>
                </div>
                <div className="bg-gray-900 rounded-lg overflow-hidden mb-4 flex border border-gray-800">
                    {tabs.map((tab) => (
                        <button
                            key={tab}
                            className={`flex-1 font-semibold p-3 transition-colors duration-200 ${
                                activeTab === tab
                                    ? 'text-green-300 bg-gray-900 border-b-2 border-green-300'
                                    : 'text-gray-400 hover:bg-gray-900 hover:text-white'
                            }`}
                            onClick={() => setActiveTab(tab)}
                        >
                            {tab}
                        </button>
                    ))}
                </div>
                <div className="bg-[#09090b] border border-gray-800 rounded-xl min-h-[400px]">
                    {tabContent[activeTab]}
                </div>

            </div>
        </div>
    );
}

export default function AccountsTab() {
  return (
    <AccountProvider>
        <TabsContent />
    </AccountProvider>
  );
}