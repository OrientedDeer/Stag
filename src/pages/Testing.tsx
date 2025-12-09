import TopBar from "../components/TopBar";
import Saved from "./CurrentTabs/Saved";
import Invested from "./CurrentTabs/Invested";
import { useMemo, useState} from 'react';
import { useAccounts } from '../context/AccountsContext';
import { Account, ACCOUNT_CATEGORIES } from '../types';
import Property from "./CurrentTabs/Property";
import Debt from "./CurrentTabs/Debt";


type TestingProps = {
  setIsOpen: React.Dispatch<React.SetStateAction<boolean>>;
};

export default function Testing({setIsOpen}: TestingProps ) {
    const { accounts} = useAccounts();

    const getSpecificTabTotal = (category: string) => {
    if (category === 'All') {
        return accounts.reduce((sum, acc) => acc.category == ACCOUNT_CATEGORIES[3] ? sum + acc.balance * -1 : sum + acc.balance, 0);
    }
    return accounts.reduce((sum, acc) => acc.category == category ? sum + acc.balance : sum, 0);
    };

    const { categoryTotals, totalAssetsMagnitude } = useMemo(() => { // 👈 Renamed totalAssets to totalAssetsMagnitude
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

    const tabs = [...ACCOUNT_CATEGORIES];

    const [activeTab, setActiveTab] =  useState(tabs[0]);
    
    const tabContent = {
        Saved: (
            <div>
                <Saved/>
            </div>
        ),
        Invested: (
            <div>
                <Invested/>
            </div>
        ),
        Property: (
            <div>
                <Property/>
            </div>
        ),
        Debt: (
            <div>
                <Debt/>
            </div>
        )
    }


      
    return (
    <div className="w-full h-full bg-gray-950 text-white">
        <TopBar setIsOpen={setIsOpen} title="Testing"/>
        <div className="bg-gray-950 rounded-lg p-2">
            <div className="flex justify-center items-center text-sm mb-2">
                <span className="font-medium">Networth ${total.toLocaleString()}</span>
            </div>
            <div className="mb-2">
                {/* The Main Stacked Bar */}
                <div className="w-full h-2 flex rounded-lg overflow-hidden">
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
                <div className="mt-2 flex flex-wrap gap-x-2 gap-y-2 text-sm justify-center">
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
                        <span>
                            {category} (${Math.abs(total).toLocaleString()})
                        </span>
                        </div>
                    );
                    })}
                </div>
            </div>
        </div>
        <div className="w-full h-full flex bg-gray-950 justify-center">
            <div className="">
                <div className="bg-gray-900 rounded-lg mt-1 overflow-hidden">
                    {tabs.map((tab) =>
                        <button key={tab}
                        className={`w-1/4 px-2 font-semibold p-2 rounded ${
                            activeTab === tab ? "text-green-300 bg-gray-600" : "text-White hover:bg-gray-600"
                        }`}
                        onClick={() => setActiveTab(tab)}
                        >
                            {tab}
                        </button>
                    )}
                </div>
                <div className="">
                    {tabContent[activeTab]}
                </div>
            </div>
        </div>
    </div>
    );
}