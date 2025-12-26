import { useContext, useMemo } from 'react';
import { ResponsiveLine } from '@nivo/line';
import { AccountContext } from '../Accounts/AccountContext';
import { DebtAccount, PropertyAccount } from '../Accounts/models';
import { ExpenseContext } from '../Expense/ExpenseContext';
import { MortgageExpense } from '../Expense/models';

export const NetWorthCard = () => {
    const { accounts, amountHistory } = useContext(AccountContext);
    
    const { expenses } = useContext(ExpenseContext);
    // 1. Calculate Current Stats
    const stats = useMemo(() => {
        let totalAssets = 0;
        let totalDebt = 0;

        accounts.forEach(acc => {
            // Property logic: amount is asset, loanAmount is debt
            if (acc instanceof PropertyAccount && acc.loanAmount) {
                totalDebt += acc.loanAmount;
            }
            
            // Debt logic: amount is the debt itself
            if (acc instanceof DebtAccount && acc.amount) {
                totalDebt += acc.amount;
            } else {
                // Everything else (Saved, Invested, Property Value) is an asset
                totalAssets += acc.amount;
            }
        });

        const netWorth = totalAssets - totalDebt;
        return { totalAssets, totalDebt, netWorth };
    }, [accounts]);

    // 2. Generate Historical Chart Data
    const chartData = useMemo(() => {
        const allDates = new Set<string>();
        Object.values(amountHistory).forEach(history => {
            history.forEach(entry => allDates.add(entry.date));
        });

        const sortedDates = Array.from(allDates).sort();

        const dataPoints = sortedDates.map(date => {
            let historicalNetWorth = 0;

            accounts.forEach(acc => {
                const history = amountHistory[acc.id] || [];
                // Find latest snapshot on or before this date
                const entry = [...history].reverse().find(e => e.date <= date);
                const assetValue = entry ? entry.num : 0;

                if (acc instanceof DebtAccount) {
                    // For simple debt, we still rely on the snapshot
                     const debtValue = entry ? (entry.num) : 0;
                    historicalNetWorth -= debtValue;
                } else if (acc instanceof PropertyAccount) {
                    // 3. Find linked mortgage and calculate balance dynamically
                    const linkedMortgage = expenses.find(
                        ex => ex.id === acc.linkedAccountId && ex instanceof MortgageExpense
                    ) as MortgageExpense | undefined;

                    if (linkedMortgage) {
                        const calculatedDebt = linkedMortgage.getBalanceAtDate(date);
                        historicalNetWorth += (assetValue - calculatedDebt);
                    } else {
                        // Fallback if no linked mortgage found (or use snapshot if you prefer)
                        const snapshotDebt = entry?.loan_balance || 0;
                        historicalNetWorth += (assetValue - snapshotDebt);
                    }
                } else {
                    historicalNetWorth += assetValue;
                }
            });

            return { x: date, y: historicalNetWorth };
        });

        return [
            {
                id: 'Net Worth',
                color: '#4ade80',
                data: dataPoints,
            },
        ];
    }, [accounts, amountHistory]);

    return (
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 shadow-2xl">
            <div className="flex flex-col mb-4">
                <h3 className="text-gray-500 text-xs font-bold uppercase tracking-widest mb-1">
                    Current Net Worth
                </h3>
                <div className="flex items-baseline gap-3">
                    <p className={`text-5xl font-black tracking-tight ${stats.netWorth >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        ${stats.netWorth.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </p>
                </div>
            </div>

            {/* Historical Line Chart */}
            <div className="h-48 w-full mt-2">
                {chartData[0].data.length > 1 ? (
                    <ResponsiveLine
                        data={chartData}
                        margin={{ top: 0, right: 15, bottom: 20, left: 15 }}
                        xScale={{
                            type: 'time',
                            format: '%Y-%m-%d',
                            precision: 'day',
                        }}
                        xFormat="time:%Y-%m-%d"
                        yScale={{ type: 'linear', min: 'auto', max: 'auto' }}
                        axisBottom={{
                            tickSize: 0,
                            tickPadding: 5,
                            format: '%b %d',
                            tickValues: 6,
                        }}
                        enableGridX={false}
                        enableGridY={false}
                        colors={['#10b981']}
                        lineWidth={3}
                        axisLeft={null}
                        
                        // --- Points Configuration ---
                        enablePoints={true}
                        pointSize={6}
                        useMesh={true} 
                        enableArea={true}
                        areaOpacity={0.1}
                        theme={{
                            axis: {
                                ticks: { text: { fill: '#6b7280', fontSize: 10 } }
                            },
                            grid: { line: { stroke: '#374151' } },
                            crosshair: { line: { stroke: '#10b981', strokeWidth: 1 } },
                            tooltip: { container: { color: '#000' } } // Fix tooltip text color
                        }}
                        tooltip={({ point }: any) => (
                            <div className="bg-gray-800 border border-gray-700 p-2 rounded shadow-xl text-xs">
                                <span className="text-gray-400">{point.data.xFormatted}: </span>
                                <span className="text-green-400 font-bold">${point.data.y.toLocaleString()}</span>
                            </div>
                        )}
                    />
                ) : (
                    <div className='flex flex-col items-center justify-center text-center p-12 border-2 border-dashed border-gray-800 rounded-2xl'>
                        <div className="text-gray-500 text-lg mb-2">No account history available</div>
                        <p className="text-gray-600 text-sm max-w-xs">
                        The Line chart requires account history to visualize your networth over time.
                        </p>
                  </div>
                )}
            </div>

            <div className="grid grid-cols-2 gap-8 mt-6 pt-6 border-t border-gray-800">
                <div>
                    <div className="flex items-center gap-2 mb-1">
                        <div className="w-2 h-2 rounded-full bg-blue-500" />
                        <p className="text-gray-500 text-[10px] font-bold uppercase">Gross Assets</p>
                    </div>
                    <p className="text-xl font-mono font-bold text-gray-100">
                        ${stats.totalAssets.toLocaleString()}
                    </p>
                </div>
                <div>
                    <div className="flex items-center gap-2 mb-1">
                        <div className="w-2 h-2 rounded-full bg-red-500" />
                        <p className="text-gray-500 text-[10px] font-bold uppercase">Total Debt</p>
                    </div>
                    <p className="text-xl font-mono font-bold text-gray-100">
                        ${stats.totalDebt.toLocaleString()}
                    </p>
                </div>
            </div>
        </div>
    );
};