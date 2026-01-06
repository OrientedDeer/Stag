import { useMemo } from 'react';
import { ResponsiveLine } from '@nivo/line';
import { SimulationYear } from '../../../components/Objects/Assumptions/SimulationEngine';
import { DebtAccount } from '../../../components/Objects/Accounts/models';
import { LoanExpense, MortgageExpense } from '../../../components/Objects/Expense/models';

export const DebtTab = ({ simulationData }: { simulationData: SimulationYear[] }) => {
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