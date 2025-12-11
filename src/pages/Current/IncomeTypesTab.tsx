import Work from "./IncomeTypesTab/Work";
import SocialSecurity from "./IncomeTypesTab/SocialSecurity";
import PassiveIncome from "./IncomeTypesTab/PassiveIncome";
import Pension from "./IncomeTypesTab/Pension";
import Annuities from "./IncomeTypesTab/Annuities";
import {useState} from 'react';
import {INCOME_TYPES} from '../../types';
import HorizontalBarChart from "../../components/Accounts/HorizontalBarChart";
import { useIncomes } from '../../context/IncomeTypesContext';



export default function IncomeTypesTab() {
    const {getTypeTotal, getFilteredType} = useIncomes();
    const tabs = [...INCOME_TYPES];
    const [activeTab, setActiveTab] =  useState(tabs[0]);
    const tabContent = {
        Work: (
            <div><Work /></div>
        ),
        "Social Security": (
            <div><SocialSecurity /></div>
        ),
        "Passive Income": (
            <div><PassiveIncome /></div>
        ),
        Pensions: (
            <div><Pension /></div>
        ),
        Annuities: (
            <div><Annuities /></div>
        ),
    }

        
    const total = getTypeTotal("All");

    return (
    <div className="w-full min-h-full bg-gray-950 text-white">
        
        {/* <div className="bg-gray-950 rounded-lg p-2">
            <div className="w-7/8 mx-auto">
                <div className="flex justify-center items-center text-sm mb-2">
                    <span className="font-medium">Networth ${total.toLocaleString()}</span>
                </div>
                {getFilteredType('All').length > 0 &&
                    <HorizontalBarChart type="All" accountList={getFilteredType('All')}/>
                }
                {getFilteredType('Saved').length > 0 &&
                    <HorizontalBarChart type="Saved" accountList={getFilteredType('Saved')}/>
                }
                {getFilteredType('Invested').length > 0 &&
                    <HorizontalBarChart type="Invested" accountList={getFilteredType('Invested')}/>
                }
                {getFilteredType('Property').length > 0 &&
                    <HorizontalBarChart type="Property" accountList={getFilteredType('Property')}/>
                }
                {getFilteredType('Debt').length > 0 &&
                    <HorizontalBarChart type="Debt" accountList={getFilteredType('Debt')}/>
                }
            </div>
        </div> */}
        <div className="w-full h-full flex bg-gray-950 justify-center">
            <div className="w-3/4">
                <div className="bg-gray-900 rounded-lg mt-1 overflow-hidden mb-1">
                    {tabs.map((tab) =>
                        <button key={tab}
                        className={`w-1/5  font-semibold p-2 rounded ${
                            activeTab === tab ? "text-green-300 bg-gray-600" : "text-White hover:bg-gray-600"
                        }`}
                        onClick={() => setActiveTab(tab)}
                        >
                            {tab}
                        </button>
                    )}
                </div>
                <div className="">
                    {tabContent[activeTab as keyof typeof tabContent]}
                </div>
            </div>
        </div>
    </div>
    );
}