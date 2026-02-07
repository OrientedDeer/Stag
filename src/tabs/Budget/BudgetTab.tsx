import { useContext, useState } from 'react';
import { BudgetContext } from '../../components/Objects/Budget/BudgetContext';
import { formatMonthYear, navigateMonth } from '../../components/Objects/Budget/budgetUtils';
import SpendingTab from './SpendingTab';
import OverviewTab from './OverviewTab';
import HistoryTab from './HistoryTab';
import TrendsTab from './TrendsTab';
import TransactionsTab from './TransactionsTab';
import SettingsTab from './SettingsTab';

const tabs = ['Overview', 'Spending', 'Transactions', 'History', 'Trends', 'Settings'];

export default function BudgetTab() {
    const { selectedMonth, selectedYear, dispatch } = useContext(BudgetContext);
    const [activeTab, setActiveTab] = useState(() => {
        const saved = localStorage.getItem('stag_budget_tab');
        return saved && tabs.includes(saved) ? saved : 'Overview';
    });

    const handleTabChange = (tab: string) => {
        setActiveTab(tab);
        localStorage.setItem('stag_budget_tab', tab);
    };

    const handlePrevMonth = () => {
        const { month, year } = navigateMonth(selectedMonth, selectedYear, 'prev');
        dispatch({ type: 'SET_SELECTED_MONTH', payload: { month, year } });
    };

    const handleNextMonth = () => {
        const { month, year } = navigateMonth(selectedMonth, selectedYear, 'next');
        dispatch({ type: 'SET_SELECTED_MONTH', payload: { month, year } });
    };

    const handleCurrentMonth = () => {
        const now = new Date();
        dispatch({
            type: 'SET_SELECTED_MONTH',
            payload: { month: now.getMonth() + 1, year: now.getFullYear() }
        });
    };

    return (
        <div className="w-full flex bg-gray-950 justify-center pt-6 pb-24">
            <div className="w-full px-4 sm:px-8 max-w-screen-2xl">
                {/* Month Selector */}
                <div className="mb-6 p-4 bg-gray-900 rounded-xl border border-gray-800 shadow-lg">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <button
                                onClick={handlePrevMonth}
                                className="p-2 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-white transition-colors"
                                aria-label="Previous month"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <polyline points="15 18 9 12 15 6" />
                                </svg>
                            </button>
                            <h1 className="text-2xl font-bold text-white w-52 text-center">
                                {formatMonthYear(selectedMonth, selectedYear)}
                            </h1>
                            <button
                                onClick={handleNextMonth}
                                className="p-2 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-white transition-colors"
                                aria-label="Next month"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <polyline points="9 18 15 12 9 6" />
                                </svg>
                            </button>
                        </div>
                        <button
                            onClick={handleCurrentMonth}
                            className="px-3 py-1 text-sm rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white transition-colors"
                        >
                            Today
                        </button>
                    </div>
                </div>

                {/* Tab Navigation */}
                <div className="bg-gray-900 rounded-lg mb-1 flex border border-gray-800 overflow-x-auto custom-scrollbar">
                    {tabs.map((tab) => (
                        <button
                            key={tab}
                            className={`flex-1 min-w-fit font-semibold px-4 py-3 transition-colors duration-200 whitespace-nowrap ${
                                activeTab === tab
                                    ? "text-green-300 bg-gray-800 border-b-2 border-green-300"
                                    : "text-gray-400 hover:bg-gray-800 hover:text-white"
                            }`}
                            onClick={() => handleTabChange(tab)}
                        >
                            {tab}
                        </button>
                    ))}
                </div>

                {/* Tab Content */}
                <div className="bg-gray-900 border border-gray-800 rounded-2xl shadow-2xl mb-4 p-6 overflow-visible">
                    <div className={activeTab === 'Overview' ? '' : 'hidden'}>
                        <OverviewTab />
                    </div>
                    <div className={activeTab === 'Spending' ? '' : 'hidden'}>
                        <SpendingTab />
                    </div>
                    <div className={activeTab === 'Transactions' ? '' : 'hidden'}>
                        <TransactionsTab />
                    </div>
                    <div className={activeTab === 'History' ? '' : 'hidden'}>
                        <HistoryTab />
                    </div>
                    <div className={activeTab === 'Trends' ? '' : 'hidden'}>
                        <TrendsTab />
                    </div>
                    <div className={activeTab === 'Settings' ? '' : 'hidden'}>
                        <SettingsTab />
                    </div>
                </div>
            </div>
        </div>
    );
}
