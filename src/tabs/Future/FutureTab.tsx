import React, { useState, useContext, useMemo } from 'react';
import { runSimulation } from '../../components/Objects/Assumptions/useSimulation';
import { AssumptionsContext, AssumptionsState } from '../../components/Objects/Assumptions/AssumptionsContext';
import { SimulationYear } from '../../components/Objects/Assumptions/SimulationEngine';
import { InvestedAccount, DebtAccount, PropertyAccount, SavedAccount, AnyAccount } from '../../components/Objects/Accounts/models';
import { LoanExpense, MortgageExpense } from '../../components/Objects/Expense/models';
import { SimulationContext } from '../../components/Objects/Assumptions/SimulationContext';
import { AccountContext } from '../../components/Objects/Accounts/AccountContext';
import { IncomeContext } from '../../components/Objects/Income/IncomeContext';
import { ExpenseContext } from '../../components/Objects/Expense/ExpenseContext';
import { TaxContext } from '../../components/Objects/Taxes/TaxContext';

// Imports from the new sub-folders
import { OverviewTab } from './tabs/OverviewTab';
import { CashflowTab } from './tabs/CashflowTabs';
import { AssetsStreamChart } from '../../components/Charts/AssetsStreamChart';
import { DebtStreamChart } from '../../components/Charts/DebtStreamChart'; // <--- Import the new chart

const future_tabs = ["Overview", "Cashflow", "Assets", "Debt", "Data"];

const calculateNetWorth = (accounts: AnyAccount[]) => {
    let assets = 0;
    let liabilities = 0;
    accounts.forEach(acc => {
        const val = acc.amount || 0;
        if (acc instanceof DebtAccount) liabilities += val;
        else {
            assets += val;
             // @ts-ignore
            if (acc.loanAmount) liabilities += acc.loanAmount;
        }
    });
    return assets - liabilities;
}

const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}

// --- Inline Components for Assets, Debt, Data ---

const DebtTab = ({ simulationData }: { simulationData: SimulationYear[] }) => {
    const { data, keys, debtFreeYear } = useMemo(() => {
        let debtFreeYear: number | null = null;
        const allKeys = new Set<string>();

        const mappedData = simulationData.map(year => {
            const datum: any = { year: year.year };
            let yearTotalDebt = 0;

            // 1. Check Expenses (Mortgages & Loans)
            year.expenses.forEach(exp => {
                if (exp instanceof LoanExpense || exp instanceof MortgageExpense) {
                    const balance = exp instanceof LoanExpense ? exp.amount : exp.loan_balance;
                    if (balance > 0) {
                        datum[exp.name] = balance;
                        yearTotalDebt += balance;
                        allKeys.add(exp.name);
                    }
                }
            });

            // 2. Check Accounts (Debt Accounts / Credit Cards)
            year.accounts.forEach(acc => {
                if (acc instanceof DebtAccount) {
                    if (acc.amount > 0) {
                        datum[acc.name] = acc.amount;
                        yearTotalDebt += acc.amount;
                        allKeys.add(acc.name);
                    }
                }
            });

            // Track Debt Free Year
            if (yearTotalDebt <= 1 && debtFreeYear === null) { // tolerance for float math
                debtFreeYear = year.year;
            }

            return datum;
        });

        return { data: mappedData, keys: Array.from(allKeys), debtFreeYear };
    }, [simulationData]);

    // Generate colors consistent with AssetsTab
    const colors = useMemo(() => {
        // Red/Orange/Yellow/Gray spectrum for Debts usually looks better, 
        // but using a distinct palette from Assets helps differentiate.
        const palette = [
            '#f87171', '#fb923c', '#facc15', '#a3a3a3', '#ef4444', 
            '#f97316', '#eab308', '#737373', '#b91c1c', '#c2410c'
        ];
        const map: Record<string, string> = {};
        keys.forEach((key, i) => {
            map[key] = palette[i % palette.length];
        });
        return map;
    }, [keys]);

    if (keys.length === 0) return <div className="p-4 text-white">No debt to track. You're debt free!</div>;

    return (
        <div className="p-4 text-white h-[500px] flex flex-col">
            <h3 className="text-lg font-bold text-center mb-2">
                Debt Free Year: {debtFreeYear ? <span className='text-green-400'>{debtFreeYear}</span> : 'Beyond Simulation'}
            </h3>
            <div className="grow w-full">
                <DebtStreamChart data={data} keys={keys} colors={colors} />
            </div>
        </div>
    );
};

const AssetsTab = ({ simulationData }: { simulationData: SimulationYear[] }) => {
    const { data, keys } = useMemo(() => {
        const allKeys = new Set<string>();
        const mappedData = simulationData.map(year => {
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

    // Generate a consistent color map for the accounts
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
        <div className="h-[500px] w-full">
            <AssetsStreamChart data={data} keys={keys} colors={colors} />
        </div>
    );
};

const DataTab = ({ simulationData, startAge }: { simulationData: SimulationYear[], startAge: number }) => {
    const tableData = useMemo(() => {
        return simulationData.map((year, index) => {
            const totalTaxes = year.taxDetails.fed + year.taxDetails.state + year.taxDetails.fica;
            const livingExpenses = year.expenses.reduce((sum, exp) => sum + exp.getAnnualAmount(), 0);
            const totalSaved = year.cashflow.investedUser + year.cashflow.discretionary;
            const netWorth = calculateNetWorth(year.accounts);

            return {
                year: year.year,
                age: startAge + index,
                grossIncome: year.cashflow.totalIncome,
                totalTaxes,
                livingExpenses,
                totalSaved,
                netWorth,
            };
        });
    }, [simulationData, startAge]);

    const handleExportCSV = () => {
        const headers = ["Year", "Age", "Gross Income", "Total Taxes", "Living Expenses", "Total Saved", "Net Worth"];
        const keys: (keyof typeof tableData[0])[] = ["year", "age", "grossIncome", "totalTaxes", "livingExpenses", "totalSaved", "netWorth"];
        const csvRows = [headers.join(',')];

        tableData.forEach(row => {
            const values = keys.map(key => row[key]);
            csvRows.push(values.join(','));
        });

        const csvString = csvRows.join('\n');
        const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.setAttribute('href', url);
        link.setAttribute('download', 'simulation_data.csv');
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    return (
        <div className="p-4 text-white">
            <div className="flex justify-end mb-4">
                <button
                    onClick={handleExportCSV}
                    className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white font-bold rounded-lg transition-colors"
                >
                    Export to CSV
                </button>
            </div>
            <div className="overflow-y-auto h-[350px]">
                <table className="w-full text-left border-collapse">
                    <thead className="sticky top-0 bg-gray-900">
                        <tr>
                            <th className="p-2 border-b border-gray-700">Year</th>
                            <th className="p-2 border-b border-gray-700">Age</th>
                            <th className="p-2 border-b border-gray-700">Gross Income</th>
                            <th className="p-2 border-b border-gray-700">Total Taxes</th>
                            <th className="p-2 border-b border-gray-700">Living Expenses</th>
                            <th className="p-2 border-b border-gray-700">Total Saved</th>
                            <th className="p-2 border-b border-gray-700">Net Worth</th>
                        </tr>
                    </thead>
                    <tbody>
                        {tableData.map((row) => (
                            <tr key={row.year} className="hover:bg-gray-800">
                                <td className="p-2 border-b border-gray-800">{row.year}</td>
                                <td className="p-2 border-b border-gray-800">{row.age}</td>
                                <td className="p-2 border-b border-gray-800">{formatCurrency(row.grossIncome)}</td>
                                <td className="p-2 border-b border-gray-800">{formatCurrency(row.totalTaxes)}</td>
                                <td className="p-2 border-b border-gray-800">{formatCurrency(row.livingExpenses)}</td>
                                <td className="p-2 border-b border-gray-800">{formatCurrency(row.totalSaved)}</td>
                                <td className="p-2 border-b border-gray-800">{formatCurrency(row.netWorth)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

// --- Main Component ---

const findFinancialIndependenceYear = (simulation: SimulationYear[], assumptions: AssumptionsState): number | null => {
    // We start at index 1 because we need the "Previous Year's" ending balance 
    // to determine if it can support "Current Year's" expenses.
    for (let i = 1; i < simulation.length; i++) {
        const lastYear = simulation[i - 1];
        const currentYear = simulation[i];

        // 1. Calculate Starting Assets (End of Last Year)
        const startingInvestedAssets = lastYear.accounts
            .filter(acc => acc instanceof InvestedAccount)
            .reduce((sum, acc) => sum + acc.amount, 0);

        // 2. Calculate Safe Withdrawal Amount (Gross)
        const safeWithdrawalAmount = startingInvestedAssets * (assumptions.investments.withdrawalRate / 100);

        // 3. Calculate True Living Expenses
        // We exclude Savings, Working Taxes (FICA/State/Fed on salary), and Insurance (often tied to work).
        // If Health Insurance is an expense, it should be added as a recurring expense in the input.
        const annualLivingExpenses = currentYear.expenses.reduce((sum, exp) => {
            if (exp instanceof MortgageExpense) {
                // Use smart amortization to handle years where mortgage is paid off
                return sum + exp.calculateAnnualAmortization(currentYear.year).totalPayment;
            }
            // Use prorated annual amount to handle expenses starting/ending
            return sum + exp.getAnnualAmount(currentYear.year);
        }, 0);

        // 4. Estimate Retirement Tax Burden
        // We assume an effective tax rate of 15% on withdrawals (Cap Gains + Income).
        // Formula: NetNeed = GrossWithdrawal * (1 - TaxRate)
        // Therefore: GrossWithdrawalNeeded = NetNeed / (1 - TaxRate)
        const estimatedTaxRate = 0.15;
        const grossWithdrawalNeeded = annualLivingExpenses / (1 - estimatedTaxRate);

        // 5. The Check
        if (safeWithdrawalAmount >= grossWithdrawalNeeded) {
            return currentYear.year;
        }
    }
    return null;
};

export default function FutureTab() {
    const { state: assumptions } = useContext(AssumptionsContext);
    const { simulation, dispatch: dispatchSimulation } = useContext(SimulationContext);
    const { accounts } = useContext(AccountContext);
    const { incomes } = useContext(IncomeContext);
    const { expenses } = useContext(ExpenseContext);
    const { state: taxState } = useContext(TaxContext);
    const [activeTab, setActiveTab] = useState('Overview');

    const handleRecalculate = () => {
        const newSimulation = runSimulation(
            assumptions.demographics.lifeExpectancy - assumptions.personal.startAge - 19,
            accounts,
            incomes,
            expenses,
            assumptions,
            taxState
        );
        dispatchSimulation({ type: 'SET_SIMULATION', payload: newSimulation });
    };

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
        "Data": <DataTab simulationData={simulation} startAge={assumptions.personal.startAge} />,
    };

    return (
        <div className="w-full min-h-full flex bg-gray-950 justify-center pt-6">
            <div className="w-full px-8 max-w-screen-2xl">

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

                {/* Main Content Container - Matches Networth.tsx aesthetics */}
                <div className="bg-gray-900 border border-gray-800 rounded-2xl shadow-2xl min-h-[400px] mb-4 p-6">
                    {tabContent[activeTab]}
                </div>
            </div>
        </div>
    );
}