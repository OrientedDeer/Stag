import React, { useState, useContext, useMemo, useEffect } from 'react';
import { runSimulation } from '../../components/Objects/Assumptions/useSimulation';
import { AssumptionsContext, AssumptionsState } from '../../components/Objects/Assumptions/AssumptionsContext';
import { SimulationYear } from '../../components/Objects/Assumptions/SimulationEngine';
import { InvestedAccount, PropertyAccount, SavedAccount } from '../../components/Objects/Accounts/models';
import { MortgageExpense } from '../../components/Objects/Expense/models';
import { SimulationContext } from '../../components/Objects/Assumptions/SimulationContext';
import { AccountContext } from '../../components/Objects/Accounts/AccountContext';
import { IncomeContext } from '../../components/Objects/Income/IncomeContext';
import { ExpenseContext } from '../../components/Objects/Expense/ExpenseContext';
import { TaxContext } from '../../components/Objects/Taxes/TaxContext';

// --- Charts ---
import { AssetsStreamChart } from '../../components/Charts/AssetsStreamChart';

// --- Tabs ---
import { OverviewTab } from './tabs/OverviewTab';
import { CashflowTab } from './tabs/CashflowTabs';
import { DebtTab } from './tabs/DebtTab';
import { DataTab } from './tabs/DataTab';

const future_tabs = ["Overview", "Cashflow", "Assets", "Debt", "Data"];

// --- Inline Assets Tab ---
const AssetsTab = ({ simulationData }: { simulationData: SimulationYear[] }) => {
    const { data, keys } = useMemo(() => {
        const allKeys = new Set<string>();
        const mappedData = simulationData.map(year => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const datum: any = { year: year.year };
            year.accounts.forEach(acc => {
                // Include only asset accounts (Saved, Invested, Property)
                if (acc instanceof SavedAccount || acc instanceof InvestedAccount || acc instanceof PropertyAccount) {
                    let val = acc.amount;
                    if (acc instanceof PropertyAccount) {
                        // @ts-ignore
                        val -= (acc.loanAmount || 0);
                    }
                    datum[acc.name] = val;
                    allKeys.add(acc.name);
                }
            });
            return datum;
        });
        return { data: mappedData, keys: Array.from(allKeys) };
    }, [simulationData]);

    const colors = useMemo(() => {
        const palette = [
            '#60a5fa', '#34d399', '#f472b6', '#fbbf24', '#a78bfa', 
            '#2dd4bf', '#fb7185', '#c084fc', '#a3e635', '#22d3ee'
        ];
        const map: Record<string, string> = {};
        keys.forEach((key, i) => {
            map[key] = palette[i % palette.length];
        });
        return map;
    }, [keys]);

    return (
        <div className="h-125 w-full">
            <AssetsStreamChart data={data} keys={keys} colors={colors} />
        </div>
    );
};

// --- Financial Independence Logic ---
const findFinancialIndependenceYear = (simulation: SimulationYear[], assumptions: AssumptionsState): number | null => {
    for (let i = 1; i < simulation.length; i++) {
        const lastYear = simulation[i - 1];
        const currentYear = simulation[i];

        const startingInvestedAssets = lastYear.accounts
            .filter(acc => acc instanceof InvestedAccount)
            .reduce((sum, acc) => sum + acc.amount, 0);

        const safeWithdrawalAmount = startingInvestedAssets * (assumptions.investments.withdrawalRate / 100);

        const annualLivingExpenses = currentYear.expenses.reduce((sum, exp) => {
            if (exp instanceof MortgageExpense) {
                return sum + exp.calculateAnnualAmortization(currentYear.year).totalPayment;
            }
            return sum + exp.getAnnualAmount(currentYear.year);
        }, 0);

        const estimatedTaxRate = 0.15;
        const grossWithdrawalNeeded = annualLivingExpenses / (1 - estimatedTaxRate);

        if (safeWithdrawalAmount >= grossWithdrawalNeeded) {
            return currentYear.year;
        }
    }
    return null;
};

// --- Main Component ---
export default function FutureTab() {
    const { state: assumptions } = useContext(AssumptionsContext);
    const { simulation, dispatch: dispatchSimulation } = useContext(SimulationContext);
    const { accounts } = useContext(AccountContext);
    const { incomes } = useContext(IncomeContext);
    const { expenses } = useContext(ExpenseContext);
    const { state: taxState } = useContext(TaxContext);
    const [activeTab, setActiveTab] = useState('Overview');

    // 1. Check for Missing Remainder Bucket
    const hasRemainderBucket = useMemo(() => {
        return assumptions.priorities.some(p => p.capType === 'REMAINDER');
    }, [assumptions.priorities]);

    const handleRecalculate = () => {
        const newSimulation = runSimulation(
            assumptions.demographics.lifeExpectancy - assumptions.demographics.startAge - 19,
            accounts,
            incomes,
            expenses,
            assumptions,
            taxState
        );
        dispatchSimulation({ type: 'SET_SIMULATION', payload: newSimulation });
    };

    // Auto-recalculate simulation on mount if we have data but no simulation
    // This fixes the issue where localStorage data loads but simulation is stale/empty
    useEffect(() => {
        const hasData = accounts.length > 0 || incomes.length > 0 || expenses.length > 0;
        const hasNoSimulation = simulation.length === 0;

        if (hasData && hasNoSimulation) {
            const newSimulation = runSimulation(
                assumptions.demographics.lifeExpectancy - assumptions.demographics.startAge - 19,
                accounts,
                incomes,
                expenses,
                assumptions,
                taxState
            );
            dispatchSimulation({ type: 'SET_SIMULATION', payload: newSimulation });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []); // Only run on mount - we want to check localStorage state once

    const fiYear = findFinancialIndependenceYear(simulation, assumptions);

    if (simulation.length === 0) {
        return (
            <div className="p-4 text-white bg-gray-950 text-center">
                <p className="mb-4">No simulation data. Click the button to run a new simulation based on your current inputs.</p>
                <button
                    onClick={handleRecalculate}
                    className="px-6 py-2 bg-green-600 hover:bg-green-700 text-white font-bold rounded-lg transition-colors"
                >
                    Recalculate Simulation
                </button>
            </div>
        );
    }

    const tabContent: Record<string, React.ReactNode> = {
        "Overview": <OverviewTab simulationData={simulation} />,
        "Cashflow": <CashflowTab simulationData={simulation} />,
        "Assets": <AssetsTab simulationData={simulation} />,
        "Debt": <DebtTab simulationData={simulation} />,
        "Data": <DataTab simulationData={simulation} startAge={assumptions.demographics.startAge} />,
    };

    return (
        <div className="w-full min-h-full flex bg-gray-950 justify-center pt-6">
            <div className="w-full px-8 max-w-screen-2xl">
                
                {/* 2. Warning Banner */}
                {!hasRemainderBucket && (
                    <div className="mb-6 p-4 bg-amber-900/40 border border-amber-600 text-amber-200 rounded-xl flex items-start gap-3 shadow-lg">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                        </svg>
                        <div>
                            <h3 className="font-bold text-lg">Warning: Disappearing Money</h3>
                            <p className="text-sm mt-1">
                                You do not have a <strong>"Remainder"</strong> bucket set up in your Priorities. 
                                Any unallocated cash (surplus income) will disappear from the simulation instead of being saved.
                                <br/>
                                Please go to the <strong>Priorities</strong> tab and create a bucket with Cap Type: <strong>"Remainder"</strong>.
                            </p>
                        </div>
                    </div>
                )}

                {/* Hero Section */}
                <div className="mb-6 p-4 bg-gray-900 rounded-xl border border-gray-800 text-center shadow-lg flex justify-between items-center">
                    <div>
                        <h2 className="text-xl font-bold text-white">Financial Independence</h2>
                        <p className="text-3xl font-bold text-green-400">{fiYear ? `Year: ${fiYear}` : 'Not Yet Reached'}</p>
                    </div>
                    <button
                        onClick={handleRecalculate}
                        className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg transition-colors"
                    >
                        Recalculate Simulation
                    </button>
                </div>

                {/* Tab System */}
                <div className="bg-gray-900 rounded-lg overflow-hidden mb-1 flex border border-gray-800">
                    {future_tabs.map((tab) => (
                        <button
                            key={tab}
                            className={`flex-1 font-semibold p-3 transition-colors duration-200 ${activeTab === tab
                                ? "text-green-300 bg-gray-800 border-b-2 border-green-300"
                                : "text-gray-400 hover:bg-gray-800 hover:text-white"
                                }`}
                            onClick={() => setActiveTab(tab)}
                        >
                            {tab}
                        </button>
                    ))}
                </div>

                {/* Main Content */}
                <div className="bg-gray-900 border border-gray-800 rounded-2xl shadow-2xl min-h-100 mb-4 p-6">
                    {tabContent[activeTab]}
                </div>
            </div>
        </div>
    );
}