import { useContext, useMemo } from 'react';
import { ResponsiveLine } from '@nivo/line';
import { AccountContext } from '../Accounts/AccountContext';
import { DebtAccount, PropertyAccount } from '../Accounts/models';

export const NetWorthCard = () => {
    const { accounts, amountHistory } = useContext(AccountContext);
    const Line = ResponsiveLine as any;
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
                const value = entry ? entry.num : 0;

                if (acc instanceof DebtAccount) {
                    historicalNetWorth -= value;
                } else if (acc instanceof PropertyAccount) {
                    // Subtract current loanAmount (assuming static loan for history simplicity)
                    historicalNetWorth += (value - (acc.loanAmount || 0));
                } else {
                    historicalNetWorth += value;
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
                    <Line
                        data={chartData}
                        margin={{ top: 10, right: 10, bottom: 25, left: 0 }}
                        xScale={{
                            type: 'time',
                            format: '%Y-%m-%d',
                            precision: 'day',
                        }}
                        xFormat="time:%Y-%m-%d"
                        yScale={{ type: 'linear', min: 'auto', max: 'auto' }}
                        axisBottom={{
                            tickSize: 0,
                            tickPadding: 10,
                            format: '%b %d',
                            tickValues: 5,
                        }}
                        enableGridX={false}
                        enableGridY={false}
                        colors={['#10b981']}
                        lineWidth={3}
                        
                        // --- Points Configuration ---
                        enablePoints={true}
                        pointSize={0} // Invisible by default
                        activePointSize={12} // Pops up on hover
                        useMesh={true} // Required for the hover effect
                        
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
                    <div className="h-full w-full flex items-center justify-center border border-dashed border-gray-800 rounded-xl text-gray-600 text-xs italic">
                        Not enough history to display chart
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