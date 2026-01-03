import React, { useState, useContext, useMemo } from 'react';
import { useSimulation } from '../../components/Objects/Assumptions/useSimulation';
import { AssumptionsContext, AssumptionsState } from '../../components/Objects/Assumptions/AssumptionsContext';
import { SimulationYear } from '../../components/Objects/Assumptions/SimulationEngine';
import { InvestedAccount, DebtAccount, PropertyAccount, SavedAccount, AnyAccount } from '../../components/Objects/Accounts/models';
import { LoanExpense, MortgageExpense } from '../../components/Objects/Expense/models';
import { ResponsiveLine } from '@nivo/line';
import { ResponsiveBar } from '@nivo/bar';

const future_tabs = ["Overview", "Cashflow", "Assets", "Debt", "Data"];

// --- Helper Functions ---
const getAccountTotals = (accounts: AnyAccount[]) => {
    const assets = accounts.reduce((total, acc) => {
        if (acc instanceof DebtAccount) return total;
        return total + acc.amount;
    }, 0);
    const liabilities = accounts.reduce((total, acc) => {
        if (acc instanceof DebtAccount) return total + acc.amount;
        return total;
    }, 0);
    return { assets, liabilities, netWorth: assets - liabilities };
};

const calculateNetWorth = (accounts: AnyAccount[]) => {
    return getAccountTotals(accounts).netWorth;
}

const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(value);
}

// --- Chart Components ---

const OverviewTab = ({ simulationData }: { simulationData: SimulationYear[] }) => {
    const chartData = useMemo(() => {
        const assetsSeries = { id: 'Assets', data: [] as { x: number; y: number }[] };
        const liabilitiesSeries = { id: 'Liabilities', data: [] as { x: number; y: number }[] };
        const netWorthSeries = { id: 'Net Worth', data: [] as { x: number; y: number }[] };

        simulationData.forEach(year => {
            const { assets, liabilities, netWorth } = getAccountTotals(year.accounts);
            assetsSeries.data.push({ x: year.year, y: assets });
            liabilitiesSeries.data.push({ x: year.year, y: liabilities });
            netWorthSeries.data.push({ x: year.year, y: netWorth });
        });

        return [netWorthSeries, assetsSeries, liabilitiesSeries];
    }, [simulationData]);

    const CustomTooltip = (props: any) => {
        const { point } = props;
        const year = point.data.x;

        const yearData: Record<string, number> = {};
        chartData.forEach(series => {
            const dataPoint = series.data.find(d => d.x === year);
            if (dataPoint) {
                yearData[series.id] = dataPoint.y;
            }
        });

        return (
            <div style={{ background: '#2d2d2d', color: '#fff', padding: '12px 16px', borderRadius: '3px' }}>
                <div style={{
                    borderBottom: `1px solid #555`,
                    paddingBottom: '5px',
                    marginBottom: '5px',
                    fontWeight: 'bold'
                }}>
                    Year: {year}
                </div>
                {Object.entries(yearData).map(([seriesId, value]) => (
                    <div key={seriesId} style={{ display: 'flex', alignItems: 'center', padding: '3px 0' }}>
                        <div style={{
                            width: 12,
                            height: 12,
                            backgroundColor: point.serieId === seriesId ? point.serieColor : '#888',
                            marginRight: 8,
                        }}></div>
                        <span>{seriesId}:</span>
                        <span style={{ marginLeft: 'auto', fontWeight: 'bold' }}>
                            {formatCurrency(value)}
                        </span>
                    </div>
                ))}
            </div>
        );
    };

    return (
        <div className="p-4 text-white h-[400px]">
            <ResponsiveLine
                data={chartData}
                margin={{ top: 50, right: 110, bottom: 50, left: 80 }}
                xScale={{ type: 'point' }}
                yScale={{
                    type: 'linear',
                    min: 'auto',
                    max: 'auto',
                    stacked: false,
                    reverse: false
                }}
                axisTop={null}
                axisRight={null}
                axisBottom={{
                    tickSize: 5,
                    tickPadding: 5,
                    tickRotation: 0,
                    legend: 'Year',
                    legendOffset: 36,
                    legendPosition: 'middle',
                }}
                axisLeft={{
                    tickSize: 5,
                    tickPadding: 5,
                    tickRotation: 0,
                    legend: 'Amount ($)',
                    legendOffset: -70,
                    legendPosition: 'middle',
                    format: " >-$,.0f"
                }}
                enableGridX={false}
                gridYValues={5}
                colors={{ scheme: 'category10' }}
                lineWidth={2}
                pointSize={6}
                pointColor={{ theme: 'background' }}
                pointBorderWidth={2}
                pointBorderColor={{ from: 'serieColor' }}
                enableArea={true}
                areaOpacity={0.15}
                useMesh={true}
                legends={[
                    {
                        anchor: 'bottom-right',
                        direction: 'column',
                        justify: false,
                        translateX: 100,
                        translateY: 0,
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
                    "background": "#09090b",
                    "text": { "fontSize": 12, "fill": "#ffffff" },
                    "axis": { "legend": { "text": { "fill": "#ffffff" } }, "ticks": { "text": { "fill": "#dddddd" } } },
                    "grid": { "line": { "stroke": "#444444", "strokeWidth": 1 } },
                    "tooltip": { "container": { "background": "#222222", "color": "#ffffff", "fontSize": 12 } }
                }}
                defs={[
                    {
                        id: 'gradientA',
                        type: 'linearGradient',
                        colors: [{ offset: 0, color: 'inherit' }, { offset: 100, color: 'inherit', opacity: 0 }],
                    },
                ]}
                fill={[{ match: '*', id: 'gradientA' }]}
                tooltip={CustomTooltip}
            />
        </div>
    );
};

const CashflowTab = ({ simulationData }: { simulationData: SimulationYear[] }) => {
    const [view, setView] = useState('Annual');
    const divisor = view === 'Annual' ? 1 : 12;
    const keys = ['Gross Income', 'Taxes', 'Living Expenses', 'Insurance', 'Savings'];

    const chartData = useMemo(() => {
        return simulationData.map(year => {
            const totalTaxes = year.taxDetails.fed + year.taxDetails.state + year.taxDetails.fica;
            const totalLivingExpenses = year.expenses.reduce((sum, exp) => sum + exp.getAnnualAmount(), 0);
            const totalSavings = year.cashflow.investedUser + year.cashflow.discretionary;

            return {
                year: year.year,
                'Gross Income': year.cashflow.totalIncome / divisor,
                'Taxes': -totalTaxes / divisor,
                'Living Expenses': -totalLivingExpenses / divisor,
                'Insurance': -year.taxDetails.insurance / divisor,
                'Savings': -totalSavings / divisor,
            };
        });
    }, [simulationData, divisor]);

    return (
        <div className="p-4 text-white h-[400px] flex flex-col">
            <div className="flex justify-end mb-2">
                <button onClick={() => setView('Annual')} className={`px-3 py-1 text-xs rounded-l-md ${view === 'Annual' ? 'bg-green-600' : 'bg-gray-700'}`}>Annual</button>
                <button onClick={() => setView('Monthly')} className={`px-3 py-1 text-xs rounded-r-md ${view === 'Monthly' ? 'bg-green-600' : 'bg-gray-700'}`}>Monthly</button>
            </div>
            <div className='grow'>
                <ResponsiveBar
                    data={chartData}
                    keys={keys}
                    indexBy="year"
                    margin={{ top: 50, right: 60, bottom: 60, left: 80 }}
                    padding={0.3}
                    groupMode="stacked"
                    valueScale={{ type: 'linear' }}
                    indexScale={{ type: 'band', round: true }}
                    colors={{ scheme: 'nivo' }}
                    valueFormat=" >-$,.0f"
                    axisTop={null}
                    axisRight={null}
                    axisBottom={{
                        tickSize: 5,
                        tickPadding: 5,
                        tickRotation: 0,
                        legend: 'Year',
                        legendPosition: 'middle',
                        legendOffset: 32
                    }}
                    axisLeft={{
                        tickSize: 5,
                        tickPadding: 5,
                        tickRotation: 0,
                        legend: `Amount (${view})`,
                        legendPosition: 'middle',
                        legendOffset: -70,
                        format: " >-$,.0f"
                    }}
                    labelSkipWidth={12}
                    labelSkipHeight={12}
                    labelTextColor={{
                        from: 'color',
                        modifiers: [['darker', 1.6]]
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
                        "background": "#09090b",
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

            if (totalDebt <= 0 && debtFreeYear === null) {
                debtFreeYear = year.year;
            }

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

    if (data.length === 0) {
        return <div className="p-4 text-white">No debt to track. You're debt free!</div>;
    }

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
                    axisBottom={{
                        tickSize: 5,
                        tickPadding: 5,
                        tickRotation: 0,
                        legend: 'Year',
                        legendOffset: 36,
                        legendPosition: 'middle',
                    }}
                    axisLeft={{
                        tickSize: 5,
                        tickPadding: 5,
                        tickRotation: 0,
                        legend: 'Balance ($)',
                        legendOffset: -70,
                        legendPosition: 'middle',
                        format: " >-$,.0f"
                    }}
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
                            justify: false,
                            translateX: 100,
                            translateY: 0,
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
                        "background": "#09090b",
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
                valueScale={{ type: 'linear' }}
                indexScale={{ type: 'band', round: true }}
                colors={{ scheme: 'set2' }}
                valueFormat=" >-$,.0f"
                axisTop={null}
                axisRight={null}
                axisBottom={{
                    tickSize: 5,
                    tickPadding: 5,
                    tickRotation: 0,
                    legend: 'Year',
                    legendPosition: 'middle',
                    legendOffset: 32
                }}
                axisLeft={{
                    tickSize: 5,
                    tickPadding: 5,
                    tickRotation: 0,
                    legend: 'Asset Value',
                    legendPosition: 'middle',
                    legendOffset: -70,
                    format: " >-$,.0f"
                }}
                labelSkipWidth={12}
                labelSkipHeight={12}
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
                    "background": "#09090b",
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
            const netWorth = getAccountTotals(year.accounts).netWorth;

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

const findFinancialIndependenceYear = (simulation: SimulationYear[], assumptions: AssumptionsState): number | null => {
    for (let i = 1; i < simulation.length; i++) {
        const lastYear = simulation[i - 1];
        const currentYear = simulation[i];

        const lastYearInvestments = lastYear.accounts
            .filter(acc => acc instanceof InvestedAccount)
            .reduce((sum, acc) => sum + acc.amount, 0);

        const currentYearInvestments = currentYear.accounts
            .filter(acc => acc instanceof InvestedAccount)
            .reduce((sum, acc) => sum + acc.amount, 0);

        const contributions = currentYear.cashflow.investedUser + currentYear.cashflow.investedMatch;
        const investmentReturns = currentYearInvestments - lastYearInvestments - contributions;

        // Financial independence is reached when the withdrawal from investments can cover all expenses.
        if (lastYearInvestments * (assumptions.investments.withdrawalRate / 100) > currentYear.cashflow.totalExpense) {
            return currentYear.year;
        }
    }
    return null;
};

export default function FutureTab() {
    const simulation = useSimulation(30);
    const { state: assumptions } = useContext(AssumptionsContext);
    const [activeTab, setActiveTab] = useState('Overview');

    const startYear = simulation.length > 0 ? simulation[0].year : new Date().getFullYear();
    const [selectedYear, setSelectedYear] = useState(startYear);

    const fiYear = findFinancialIndependenceYear(simulation, assumptions);

    if (simulation.length === 0) {
        return <div className="p-4 text-white bg-gray-950">Loading simulation...</div>;
    }

    const selectedYearIndex = simulation.findIndex(s => s.year === selectedYear);
    const selectedYearData = simulation[selectedYearIndex];

    if (!selectedYearData) {
        return (
            <div className="p-4 text-white bg-gray-950">
                Could not find data for year {selectedYear}.
            </div>
        );
    }

    const netWorth = calculateNetWorth(selectedYearData.accounts);
    const age = assumptions.personal.startAge + selectedYearIndex;
    const endYear = simulation[simulation.length - 1].year;

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
                <div className="mb-6 p-4 bg-gray-900 rounded-xl border border-gray-800 text-center">
                    <h2 className="text-xl font-bold text-white">Financial Independence</h2>
                    <p className="text-3xl font-bold text-green-400">{fiYear ? `Year: ${fiYear}` : 'Not Yet Reached'}</p>
                </div>

                {/* Tab System */}
                <div className="bg-gray-900 rounded-lg overflow-hidden mb-1 flex border border-gray-800">
                    {future_tabs.map((tab) => (
                        <button
                            key={tab}
                            className={`flex-1 font-semibold p-3 transition-colors duration-200 ${activeTab === tab
                                ? "text-green-300 bg-gray-900 border-b-2 border-green-300"
                                : "text-gray-400 hover:bg-gray-800 hover:text-white"
                                }`}
                            onClick={() => setActiveTab(tab)}
                        >
                            {tab}
                        </button>
                    ))}
                </div>
                <div className="bg-[#09090b] border border-gray-800 rounded-xl min-h-[400px] mb-4">
                    {tabContent[activeTab]}
                </div>

                {/* Year Slider and Detail Card */}
                <div className="p-4 bg-gray-900 rounded-xl border border-gray-800">
                    <h3 className="text-lg font-bold text-white mb-2">Year Details: {selectedYearData.year}</h3>
                    <div className='flex items-center gap-4'>
                        <input
                            type="range"
                            min={startYear}
                            max={endYear}
                            value={selectedYear}
                            onChange={(e) => setSelectedYear(parseInt(e.target.value, 10))}
                            className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer"
                        />
                        <div className="flex gap-4 text-white">
                            <div>
                                <span className="font-bold">Net Worth:</span>
                                <span className='text-green-400'> {formatCurrency(netWorth)}</span>
                            </div>
                            <div>
                                <span className="font-bold">Age:</span> {age}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}