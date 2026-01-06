import React, { useState, useContext, useMemo } from 'react';
import { useSimulation } from '../../components/Objects/Assumptions/useSimulation';
import { AssumptionsContext, AssumptionsState } from '../../components/Objects/Assumptions/AssumptionsContext';
import { SimulationYear } from '../../components/Objects/Assumptions/SimulationEngine';
import { InvestedAccount, DebtAccount, PropertyAccount, SavedAccount, AnyAccount } from '../../components/Objects/Accounts/models';
import { LoanExpense, MortgageExpense } from '../../components/Objects/Expense/models';
import { ResponsiveLine } from '@nivo/line';
import { ResponsiveBar } from '@nivo/bar';

// Imports from the new sub-folders
import { OverviewTab } from './tabs/OverviewTab';
import { CashflowTab } from './tabs/CashflowTabs';

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
    const { data, debtFreeYear } = useMemo(() => {
        let debtFreeYear: number | null = null;
        const allDebtNames = new Set<string>();
        simulationData.forEach(year => {
            year.expenses.forEach(exp => {
                if (exp instanceof LoanExpense || exp instanceof MortgageExpense) {
                    allDebtNames.add(exp.name);
                }
            });
        });

        const debtSeries: { [key: string]: { id: string, data: { x: number, y: number }[] } } = {};
        allDebtNames.forEach(name => {
            debtSeries[name] = { id: name, data: [] };
        });

        simulationData.forEach(year => {
            const debtAccounts = year.accounts.filter(acc => acc instanceof DebtAccount);
            const totalDebt = debtAccounts.reduce((sum, acc) => sum + acc.amount, 0);
            if (totalDebt <= 0 && debtFreeYear === null) debtFreeYear = year.year;

            const yearlyExpenseMap = new Map(year.expenses.map(exp => [exp.name, exp]));
            allDebtNames.forEach(name => {
                const exp = yearlyExpenseMap.get(name);
                let balance = 0;
                if (exp && (exp instanceof LoanExpense || exp instanceof MortgageExpense)) {
                    balance = exp instanceof LoanExpense ? exp.amount : exp.loan_balance;
                }
                debtSeries[name].data.push({ x: year.year, y: balance });
            });
        });

        return { data: Object.values(debtSeries), debtFreeYear };
    }, [simulationData]);

    if (data.length === 0) return <div className="p-4 text-white">No debt to track. You're debt free!</div>;

    return (
        <div className="p-4 text-white h-[400px] flex flex-col">
            <h3 className="text-lg font-bold text-center mb-2">
                Debt Free Year: {debtFreeYear ? <span className='text-green-400'>{debtFreeYear}</span> : 'Beyond Simulation'}
            </h3>
            <div className="grow">
                <ResponsiveLine
                    data={data}
                    margin={{ top: 50, right: 110, bottom: 50, left: 80 }}
                    xScale={{ type: 'point' }}
                    yScale={{ type: 'linear', min: 0, max: 'auto' }}
                    curve="monotoneX"
                    axisTop={null}
                    axisRight={null}
                    enableGridX={false}
                    colors={{ scheme: 'category10' }}
                    lineWidth={2}
                    pointSize={6}
                    pointColor={{ theme: 'background' }}
                    pointBorderWidth={2}
                    pointBorderColor={{ from: 'serieColor' }}
                    useMesh={true}
                    legends={[
                        {
                            anchor: 'bottom-right',
                            direction: 'column',
                            translateX: 100,
                            itemsSpacing: 0,
                            itemDirection: 'left-to-right',
                            itemWidth: 80,
                            itemHeight: 20,
                            itemOpacity: 0.75,
                            symbolSize: 12,
                            symbolShape: 'circle',
                        }
                    ]}
                    theme={{
                        "background": "transparent",
                        "text": { "fontSize": 12, "fill": "#ffffff" },
                        "axis": { "legend": { "text": { "fill": "#ffffff" } }, "ticks": { "text": { "fill": "#dddddd" } } },
                        "grid": { "line": { "stroke": "#444444", "strokeWidth": 1 } },
                        "tooltip": { "container": { "background": "#222222", "color": "#ffffff", "fontSize": 12 } }
                    }}
                />
            </div>
        </div>
    );
};

const AssetsTab = ({ simulationData }: { simulationData: SimulationYear[] }) => {
    const keys = ['Property', 'Invested', 'Saved'];
    const chartData = useMemo(() => {
        return simulationData.map(year => {
            const saved = year.accounts.filter(acc => acc instanceof SavedAccount).reduce((sum, acc) => sum + acc.amount, 0);
            const invested = year.accounts.filter(acc => acc instanceof InvestedAccount).reduce((sum, acc) => sum + acc.amount, 0);
            const property = year.accounts.filter(acc => acc instanceof PropertyAccount).reduce((sum, acc) => sum + acc.amount, 0);
            return {
                year: year.year,
                Saved: saved,
                Invested: invested,
                Property: property,
            };
        });
    }, [simulationData]);

    return (
        <div className="p-4 text-white h-[400px]">
            <ResponsiveBar
                data={chartData}
                keys={keys}
                indexBy="year"
                margin={{ top: 50, right: 60, bottom: 60, left: 80 }}
                padding={0.3}
                groupMode="stacked"
                colors={{ scheme: 'set2' }}
                valueFormat=" >-$,.0f"
                axisLeft={{
                    tickSize: 5,
                    tickPadding: 5,
                    tickRotation: 0,
                    legend: 'Asset Value',
                    legendPosition: 'middle',
                    legendOffset: -70,
                    format: " >-$,.0f"
                }}
                legends={[
                    {
                        dataFrom: 'keys',
                        anchor: 'bottom',
                        direction: 'row',
                        justify: false,
                        translateX: 20,
                        translateY: 50,
                        itemsSpacing: 2,
                        itemWidth: 100,
                        itemHeight: 20,
                        itemDirection: 'left-to-right',
                        itemOpacity: 0.85,
                        symbolSize: 20,
                    }
                ]}
                theme={{
                    "background": "transparent",
                    "text": { "fontSize": 12, "fill": "#ffffff" },
                    "axis": { "legend": { "text": { "fill": "#ffffff" } }, "ticks": { "text": { "fill": "#dddddd" } } },
                    "grid": { "line": { "stroke": "#444444", "strokeWidth": 1 } },
                    "tooltip": { "container": { "background": "#222222", "color": "#ffffff", "fontSize": 12 } }
                }}
            />
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
    const [activeTab, setActiveTab] = useState('Overview');
    const simulation = useSimulation(assumptions.demographics.lifeExpectancy-assumptions.personal.startAge-19);

    const fiYear = findFinancialIndependenceYear(simulation, assumptions);

    if (simulation.length === 0) {
        return <div className="p-4 text-white bg-gray-950">Loading simulation...</div>;
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
                <div className="mb-6 p-4 bg-gray-900 rounded-xl border border-gray-800 text-center shadow-lg">
                    <h2 className="text-xl font-bold text-white">Financial Independence</h2>
                    <p className="text-3xl font-bold text-green-400">{fiYear ? `Year: ${fiYear}` : 'Not Yet Reached'}</p>
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