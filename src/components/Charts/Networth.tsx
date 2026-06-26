import { useContext, useMemo } from 'react';
import { ResponsiveLine } from '@nivo/line';
import { CHART_MONEY } from './chartColors';
import { useChartTheme } from './useChartTheme';
import { ChartFrame } from "./ChartFrame";
import { Panel, SectionHeader } from '../Layout/Primitives';
import { AccountContext } from '../Objects/Accounts/AccountContext';
import { DebtAccount, InvestedAccount, PropertyAccount } from '../Objects/Accounts/models';
import { ExpenseContext } from '../Objects/Expense/ExpenseContext';
import { MortgageExpense } from '../Objects/Expense/models';
import { AssumptionsContext } from '../Objects/Assumptions/AssumptionsContext';
import { formatCompactCurrency, getNetWorthBreakdown } from '../../tabs/Future/tabs/FutureUtils';

export const NetWorthCard = () => {
    const { accounts, amountHistory } = useContext(AccountContext);
    const { expenses } = useContext(ExpenseContext);
    const { state: assumptions } = useContext(AssumptionsContext);
    const { resolve } = useChartTheme();
    const forceExact = assumptions.display?.useCompactCurrency === false;
    // 1. Calculate Current Stats — single-sourced from getNetWorthBreakdown (#143)
    //    so the Dashboard card cannot drift from the Overview/Data tabs:
    //      headline       = VESTED net worth (gross − unvested match)
    //      "Gross Assets" = breakdown.assets (assets − debt is the gross net worth)
    //      tooltip        = Unvested + Gross Net Worth (gross)
    //    This is a pure refactor — the visible output is byte-identical to the
    //    prior inline `totalAssets / totalDebt − totalNonVested` math.
    const stats = useMemo(() => {
        const { assets, liabilities, vested, unvested } = getNetWorthBreakdown(accounts);
        return {
            totalAssets: assets,
            totalDebt: liabilities,
            netWorth: vested,
            totalNonVested: unvested,
        };
    }, [accounts]);

    // 2. Generate Historical Chart Data
    const chartData = useMemo(() => {
        const allDates = new Set<string>();
        Object.values(amountHistory).forEach(history => {
            history.forEach(entry => allDates.add(entry.date));
        });

        const sortedDates = Array.from(allDates).sort();

        // Collapse to one point per calendar month: the latest entry in each month.
        // Daily updates make the recent stretch a blob of overlapping dots, so we
        // keep only each month's most recent value (for the current month, that's
        // the most recent overall). Months with no entries simply have no point.
        const lastDateByMonth = new Map<string, string>();
        sortedDates.forEach(date => {
            // date is "YYYY-MM-DD"; key on the "YYYY-MM" prefix. Ascending order
            // means the last write per month wins.
            lastDateByMonth.set(date.slice(0, 7), date);
        });
        const monthlyDates = Array.from(lastDateByMonth.values());

        const dataPoints = monthlyDates.map(date => {
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
                color: resolve(CHART_MONEY),
                data: dataPoints,
            },
        ];
    }, [accounts, amountHistory, expenses, resolve]);

    return (
        <Panel padding="none" className="p-4 sm:p-6 shadow-2xl h-full flex flex-col">
            <div className="flex flex-col mb-4">
                <SectionHeader className="mb-1">Current Net Worth</SectionHeader>
                <div className="flex items-baseline gap-2 sm:gap-3 flex-wrap">
                    <p className={`text-3xl sm:text-5xl font-black tracking-tight max-w-full overflow-hidden text-ellipsis ${stats.netWorth >= 0 ? 'text-positive' : 'text-negative'}`}>
                        {formatCompactCurrency(stats.netWorth, { forceExact })}
                    </p>
                    {stats.totalNonVested > 0 && (
                        <span
                            className="text-xs text-content-muted font-medium bg-surface-overlay px-2 py-1 rounded-full cursor-help relative group"
                            title={`Unvested: ${formatCompactCurrency(stats.totalNonVested, { forceExact })}\nGross Net Worth: ${formatCompactCurrency(stats.netWorth + stats.totalNonVested, { forceExact })}`}
                        >
                            Vested
                            <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 hidden group-hover:block z-50">
                                <div className="bg-surface-overlay border border-border-default rounded-lg p-2 shadow-xl whitespace-nowrap text-xs">
                                    <div className="text-content-muted">Unvested: <span className="text-warning font-semibold">{formatCompactCurrency(stats.totalNonVested, { forceExact })}</span></div>
                                    <div className="text-content-muted">Gross Net Worth: <span className="text-positive font-semibold">{formatCompactCurrency(stats.netWorth + stats.totalNonVested, { forceExact })}</span></div>
                                </div>
                                <div className="absolute left-1/2 -translate-x-1/2 top-full w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-border-default" />
                            </div>
                        </span>
                    )}
                </div>
            </div>

            {/* Historical Line Chart */}
            <div className="flex-1 min-h-36 w-full mt-2">
                {chartData[0].data.length > 1 ? (
                    <ChartFrame><ResponsiveLine
                        data={chartData}
                        margin={{ top: 10, right: 15, bottom: 20, left: 15 }}
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
                        colors={[resolve(CHART_MONEY)]}
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
                                ticks: { text: { fill: 'var(--c-content-subtle)', fontSize: 10 } }
                            },
                            grid: { line: { stroke: 'var(--c-border-default)' } },
                            crosshair: { line: { stroke: 'var(--color-chart-money)', strokeWidth: 1 } },
                            tooltip: { container: { color: '#000', zIndex: 9999 } }
                        }}
                        tooltip={({ point }: any) => (
                            <div className="bg-surface-overlay border border-border-default p-2 rounded shadow-xl text-xs whitespace-nowrap">
                                <span className="text-content-muted">{point.data.xFormatted}: </span>
                                <span className="text-positive font-bold">${point.data.y.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</span>
                            </div>
                        )}
                    /></ChartFrame>
                ) : (
                    <div className='flex flex-col items-center justify-center text-center p-12 border-2 border-dashed border-border-subtle rounded-2xl'>
                        <div className="text-content-muted text-lg mb-2">No account history available</div>
                        <p className="text-content-muted text-sm max-w-xs">
                        The Line chart requires account history to visualize your networth over time.
                        </p>
                  </div>
                )}
            </div>

            <div className="grid grid-cols-2 gap-4 sm:gap-8 mt-4 sm:mt-6 pt-4 sm:pt-6 border-t border-border-subtle">
                <div>
                    <div className="flex items-center gap-2 mb-1">
                        <div className="w-2 h-2 rounded-full bg-accent-soft" />
                        <p className="text-content-muted text-[10px] font-bold uppercase">Gross Assets</p>
                    </div>
                    <p className="text-base sm:text-xl font-mono font-bold text-content-bright truncate">
                        {formatCompactCurrency(stats.totalAssets, { forceExact })}
                    </p>
                </div>
                <div>
                    <div className="flex items-center gap-2 mb-1">
                        <div className="w-2 h-2 rounded-full bg-negative-soft" />
                        <p className="text-content-muted text-[10px] font-bold uppercase">Total Debt</p>
                    </div>
                    <p className="text-base sm:text-xl font-mono font-bold text-content-bright truncate">
                        {formatCompactCurrency(stats.totalDebt, { forceExact })}
                    </p>
                </div>
            </div>
        </Panel>
    );
};