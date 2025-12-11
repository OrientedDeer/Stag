import Saved from "./AccountsTab/Saved";
import Invested from "./AccountsTab/Invested";
import {useState} from 'react';
import {ACCOUNT_CATEGORIES} from '../../types';
import Property from "./AccountsTab/Property";
import Debt from "./AccountsTab/Debt";
import HorizontalBarChart from "../../components/Accounts/HorizontalBarChart";
import { useAccounts } from '../../context/AccountsContext';



export default function AccountsTab() {
    const {getCatTotal, getFilteredAccount} = useAccounts();
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

        
    const total = getCatTotal("All");

    return (
    <div className="w-full min-h-full bg-gray-950 text-white">
        
        <div className="bg-gray-950 rounded-lg p-2">
            <div className="w-7/8 mx-auto">
                <div className="flex justify-center items-center text-sm mb-2">
                    <span className="font-medium">Networth ${total.toLocaleString()}</span>
                </div>
                {getFilteredAccount('All').length > 0 &&
                    <HorizontalBarChart type="All" accountList={getFilteredAccount('All')}/>
                }
                {getFilteredAccount('Saved').length > 0 &&
                    <HorizontalBarChart type="Saved" accountList={getFilteredAccount('Saved')}/>
                }
                {getFilteredAccount('Invested').length > 0 &&
                    <HorizontalBarChart type="Invested" accountList={getFilteredAccount('Invested')}/>
                }
                {getFilteredAccount('Property').length > 0 &&
                    <HorizontalBarChart type="Property" accountList={getFilteredAccount('Property')}/>
                }
                {getFilteredAccount('Debt').length > 0 &&
                    <HorizontalBarChart type="Debt" accountList={getFilteredAccount('Debt')}/>
                }
            </div>
        </div>
        <div className="w-full h-full flex bg-gray-950 justify-center">
            <div className="w-3/4">
                <div className="bg-gray-900 rounded-lg mt-1 overflow-hidden mb-1">
                    {tabs.map((tab) =>
                        <button key={tab}
                        className={`w-1/4  font-semibold p-2 rounded ${
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