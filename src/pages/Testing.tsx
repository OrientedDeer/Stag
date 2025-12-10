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
        <div className="w-32 h-32 bg-chart-blue-50 text-black p-4">
            test block
        </div>
    </div>
    );
}