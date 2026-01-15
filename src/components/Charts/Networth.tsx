import { useContext, useMemo } from 'react';
import { ResponsiveLine } from '@nivo/line';
import { AccountContext } from '../Objects/Accounts/AccountContext';
import { DebtAccount, InvestedAccount, PropertyAccount } from '../Objects/Accounts/models';
import { ExpenseContext } from '../Objects/Expense/ExpenseContext';
import { MortgageExpense } from '../Objects/Expense/models';
import { AssumptionsContext } from '../Objects/Assumptions/AssumptionsContext';
import { formatCompactCurrency } from '../../tabs/Future/tabs/FutureUtils';

export const NetWorthCard = () => {
    const { accounts, amountHistory } = useContext(AccountContext);
    const { expenses } = useContext(ExpenseContext);
    const { state: assumptions } = useContext(AssumptionsContext);
    const forceExact = assumptions.display?.useCompactCurrency === false;
    // 1. Calculate Current Stats
    const stats = useMemo(() => {
        let totalAssets = 0;
        let totalDebt = 0;
        let totalNonVested = 0;

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

            // FIX: Subtract ONLY the unvested portion. 
            // Previously this was subtracting 'acc.employerBalance' (All Match).
            if (acc instanceof InvestedAccount){
                totalNonVested += acc.nonVestedAmount;
            }
        });

        // Net Worth = (User + Total Match) - Debt - Unvested Match
        //           = User + Vested Match - Debt
        const netWorth = totalAssets - totalDebt - totalNonVested;
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
                if (entry == null) return;
                
                const assetValue = entry.num;

                if (acc instanceof DebtAccount) {
                     const debtValue = assetValue;
                    historicalNetWorth -= debtValue;
                } else if (acc instanceof PropertyAccount) {
                    const linkedMortgage = expenses.find(
                        ex => ex.id === acc.linkedAccountId && ex instanceof MortgageExpense
                    ) as MortgageExpense | undefined;

                    if (linkedMortgage) {
                        const calculatedDebt = linkedMortgage.getBalanceAtDate(date);
                        historicalNetWorth += (assetValue - calculatedDebt);
                    } else {
                        historicalNetWorth += assetValue;
                    }
                } else if (acc instanceof InvestedAccount) {
                    // FIX: Apply the current "Vested Ratio" to historical data.
                    // This ensures the chart tracks "Vested Net Worth" roughly over time
                    // and converges with the Big Number at the end.
                    const currentTotal = acc.amount || 1; 
                    const currentVested = acc.vestedAmount;
                    const vestedRatio = Math.max(0, Math.min(1, currentVested / currentTotal));
                    
                    historicalNetWorth += (assetValue * vestedRatio);
                } else {
                    historicalNetWorth += assetValue;
                }
            });

            const adjustedDate = new Date(date);
            adjustedDate.setMinutes(adjustedDate.getMinutes() + adjustedDate.getTimezoneOffset());
            return { x: adjustedDate, y: historicalNetWorth };
        });

        return [
            {
                id: 'Net Worth',
                color: '#4ade80',
                data: dataPoints,
            },
        ];
    }, [accounts, amountHistory, expenses]);

    return (
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 sm:p-6 shadow-2xl h-full flex flex-col">
            <div className="flex flex-col mb-4">
                <h3 className="text-gray-400 text-xs font-bold uppercase tracking-widest mb-1">
                    Current Net Worth
                </h3>
                <div className="flex items-baseline gap-2 sm:gap-3 flex-wrap">
                    <p className={`text-3xl sm:text-5xl font-black tracking-tight max-w-full overflow-hidden text-ellipsis ${stats.netWorth >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {formatCompactCurrency(stats.netWorth, { forceExact })}
                    </p>
                    <span className="text-xs text-gray-400 font-medium bg-gray-800 px-2 py-1 rounded-full">
                        Vested
                    </span>
                </div>
            </div>

            {/* Historical Line Chart */}
            <div className="flex-1 min-h-36 w-full mt-2">
                {chartData[0].data.length > 1 ? (
                    <ResponsiveLine
                        data={chartData}
                        margin={{ top: 0, right: 15, bottom: 20, left: 15 }}
                        xScale={{
                            type: 'time',
                            useUTC: false,
                            precision: 'day',
                        }}
                        xFormat="time:%Y-%m-%d"
                        yScale={{ type: 'linear', min: 'auto', max: 'auto' }}
                        axisBottom={{
                            tickSize: 0,
                            tickPadding: 5,
                            format: '%b %d',
                            tickValues: 'every 3 month',
                        }}
                        enableGridX={false}
                        enableGridY={false}
                        colors={['#10b981']}
                        lineWidth={3}
                        axisLeft={null}
                        curve={'monotoneX'}
                        
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
                            tooltip: { container: { color: '#000' } }
                        }}
                        tooltip={({ point }: any) => (
                            <div className="bg-gray-800 border border-gray-700 p-2 rounded shadow-xl text-xs">
                                <span className="text-gray-400">{point.data.xFormatted}: </span>
                                <span className="text-green-400 font-bold">${point.data.y.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                            </div>
                        )}
                    />
                ) : (
                    <div className='flex flex-col items-center justify-center text-center p-12 border-2 border-dashed border-gray-800 rounded-2xl'>
                        <div className="text-gray-400 text-lg mb-2">No account history available</div>
                        <p className="text-gray-400 text-sm max-w-xs">
                        The Line chart requires account history to visualize your networth over time.
                        </p>
                  </div>
                )}
            </div>

            <div className="grid grid-cols-2 gap-4 sm:gap-8 mt-4 sm:mt-6 pt-4 sm:pt-6 border-t border-gray-800">
                <div>
                    <div className="flex items-center gap-2 mb-1">
                        <div className="w-2 h-2 rounded-full bg-blue-500" />
                        <p className="text-gray-400 text-[10px] font-bold uppercase">Gross Assets</p>
                    </div>
                    <p className="text-base sm:text-xl font-mono font-bold text-gray-100 truncate">
                        {formatCompactCurrency(stats.totalAssets, { forceExact })}
                    </p>
                </div>
                <div>
                    <div className="flex items-center gap-2 mb-1">
                        <div className="w-2 h-2 rounded-full bg-red-500" />
                        <p className="text-gray-400 text-[10px] font-bold uppercase">Total Debt</p>
                    </div>
                    <p className="text-base sm:text-xl font-mono font-bold text-gray-100 truncate">
                        {formatCompactCurrency(stats.totalDebt, { forceExact })}
                    </p>
                </div>
            </div>
        </div>
    );
};