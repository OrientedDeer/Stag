import { useContext, useEffect, useRef, useState } from 'react';
import { BudgetContext } from '../../components/Objects/Budget/BudgetContext';
import { formatMonthYear, navigateMonth } from '../../components/Objects/Budget/budgetUtils';
import { useAutoReconcile } from '../../hooks/useAutoReconcile';
import { useSubTabDeepLink } from '../../hooks/useSubTabDeepLink';
import { useSubTabKeyboardNav } from '../../hooks/useKeyboardShortcuts';
import SpendingTab from './SpendingTab';
import OverviewTab from './OverviewTab';
import HistoryTab from './HistoryTab';
import TrendsTab from './TrendsTab';
import TransactionsTab from './TransactionsTab';
import SettingsTab from './SettingsTab';
import { Panel, Button } from "../../components/Layout/Primitives";

const tabs = ['Overview', 'Spending', 'Transactions', 'History', 'Trends', 'Settings'];

export default function BudgetTab() {
    const { months, selectedMonth, selectedYear, dispatch } = useContext(BudgetContext);

    // Auto-reconcile - sync spending with transaction totals (runs once for all sub-tabs)
    useAutoReconcile(months, dispatch);
    const [activeTab, setActiveTab] = useState(() => {
        const saved = localStorage.getItem('stag_budget_tab');
        return saved && tabs.includes(saved) ? saved : 'Overview';
    });

    const handleTabChange = (tab: string) => {
        setActiveTab(tab);
        localStorage.setItem('stag_budget_tab', tab);
    };

    // Receipt links arrive as /budget?tab=Settings — select that sub-tab
    // instead of whatever localStorage last saved.
    useSubTabDeepLink(tabs, handleTabChange);

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

    // Plain ←/→ swap months. Shift+←/→ falls through to the sub-tab hook below.
    // Held-key repeat is throttled so months don't fly past.
    const lastArrowNavRef = useRef(0);
    useEffect(() => {
        const REPEAT_INTERVAL_MS = 250;
        const handler = (e: KeyboardEvent) => {
            if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
            if (e.shiftKey) return; // sub-tab nav handles this
            if (e.metaKey || e.ctrlKey || e.altKey) return;
            const target = e.target as HTMLElement | null;
            if (target) {
                const tag = target.tagName;
                if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
                if (target.isContentEditable) return;
            }
            const t = Date.now();
            if (e.repeat && t - lastArrowNavRef.current < REPEAT_INTERVAL_MS) return;
            lastArrowNavRef.current = t;
            const direction = e.key === 'ArrowLeft' ? 'prev' : 'next';
            const { month, year } = navigateMonth(selectedMonth, selectedYear, direction);
            dispatch({ type: 'SET_SELECTED_MONTH', payload: { month, year } });
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [selectedMonth, selectedYear, dispatch]);

    useSubTabKeyboardNav(tabs, activeTab, handleTabChange);

    return (
        <div className="w-full flex bg-surface-base justify-center pt-6 pb-24">
            <div className="w-full px-4 sm:px-8 max-w-screen-2xl">
                {/* Month Selector */}
                <Panel className="mb-6 shadow-lg">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <Button
                                onClick={handlePrevMonth}
                                variant="ghost" size="none" className="p-2"
                                aria-label="Previous month"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <polyline points="15 18 9 12 15 6" />
                                </svg>
                            </Button>
                            <h1 className="text-2xl font-bold text-white w-52 text-center">
                                {formatMonthYear(selectedMonth, selectedYear)}
                            </h1>
                            <Button
                                onClick={handleNextMonth}
                                variant="ghost" size="none" className="p-2"
                                aria-label="Next month"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <polyline points="9 18 15 12 9 6" />
                                </svg>
                            </Button>
                        </div>
                        <button
                            onClick={handleCurrentMonth}
                            className="px-3 py-1 text-sm rounded-lg bg-surface-overlay hover:bg-surface-input text-content-default hover:text-white transition-colors"
                        >
                            Today
                        </button>
                    </div>
                </Panel>

                {/* Tab Navigation */}
                <Panel padding="none" className="rounded-lg mb-1 flex overflow-x-auto custom-scrollbar">
                    {tabs.map((tab) => (
                        <button
                            key={tab}
                            role="tab"
                            aria-selected={activeTab === tab}
                            className={`flex-1 min-w-fit font-semibold px-4 py-3 transition-colors duration-200 whitespace-nowrap ${
                                activeTab === tab
                                    ? "text-positive-bright bg-surface-overlay border-b-2 border-positive-bright"
                                    : "text-content-muted hover:bg-surface-overlay hover:text-white"
                            }`}
                            onClick={() => handleTabChange(tab)}
                        >
                            {tab}
                        </button>
                    ))}
                </Panel>

                {/* Tab Content */}
                <Panel padding="lg" className="shadow-2xl mb-4 overflow-visible">
                    <div data-sub-tab-content>
                        {activeTab === 'Overview' && <OverviewTab />}
                        {activeTab === 'Spending' && <SpendingTab />}
                        {activeTab === 'Transactions' && <TransactionsTab />}
                        {activeTab === 'History' && <HistoryTab />}
                        {activeTab === 'Trends' && <TrendsTab />}
                        {activeTab === 'Settings' && <SettingsTab />}
                    </div>
                </Panel>
            </div>
        </div>
    );
}
