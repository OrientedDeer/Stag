import { useState, useMemo } from 'react';
import { ResponsiveBar } from '@nivo/bar';
import { SimulationYear } from '../../../components/Objects/Assumptions/SimulationEngine';
import { SavedAccount, InvestedAccount, PropertyAccount, DebtAccount } from '../../../components/Objects/Accounts/models';
import { formatCurrency } from './FutureUtils';
import { LoanExpense, MortgageExpense } from '../../../components/Objects/Expense/models';

export const OverviewTab = ({ simulationData }: { simulationData: SimulationYear[] }) => {
    const chartData = useMemo(() => {
        return simulationData.map(year => {
            const invested = year.accounts
                .filter(acc => acc instanceof InvestedAccount)
                .reduce((sum, acc) => sum + (acc.amount), 0);

            const saved = year.accounts
                .filter(acc => acc instanceof SavedAccount)
                .reduce((sum, acc) => sum + (acc.amount), 0);

            const property = year.accounts
                .filter(acc => acc instanceof PropertyAccount)
                .reduce((sum, acc) => sum + (acc.amount), 0);

            let debt = 0;
            year.expenses.forEach(exp => {
                if (exp instanceof LoanExpense) {
                    debt += (exp.amount);
                } else if (exp instanceof MortgageExpense) {
                    // Use loan_balance for mortgages in simulation snapshots
                    debt += (exp.loan_balance);
                }
            });

            return {
                year: year.year,
                Invested: invested,
                Saved: saved,
                Property: property,
                Debt: -Math.abs(debt) // Ensure debt is negative and not NaN
            };
        });
    }, [simulationData]);

    const keys = ['Invested', 'Saved', 'Property', 'Debt'];

    const CustomTooltip = (props: any) => {
        const { data } = props;
        const totalNetWorth = (data.Invested || 0) + (data.Saved || 0) + (data.Property || 0) + (data.Debt || 0);

        return (
            <div className="bg-gray-800 p-3 rounded border border-gray-700 shadow-xl text-xs min-w-[150px]">
                <div className="font-bold text-white mb-2 pb-1 border-b border-gray-600">
                    Year: {data.year}
                </div>
                <div className="flex flex-col gap-1">
                    <div className="flex justify-between gap-4">
                        <span className="text-gray-400">Invested:</span>
                        <span className="text-emerald-400 font-mono">{formatCurrency(data.Invested)}</span>
                    </div>
                    <div className="flex justify-between gap-4">
                        <span className="text-gray-400">Saved:</span>
                        <span className="text-blue-400 font-mono">{formatCurrency(data.Saved)}</span>
                    </div>
                    <div className="flex justify-between gap-4">
                        <span className="text-gray-400">Property:</span>
                        <span className="text-amber-400 font-mono">{formatCurrency(data.Property)}</span>
                    </div>
                    <div className="flex justify-between gap-4">
                        <span className="text-gray-400">Debt:</span>
                        <span className="text-red-400 font-mono">{formatCurrency(data.Debt)}</span>
                    </div>
                    
                    <div className="border-t border-gray-600 my-1"></div>
                    
                    <div className="flex justify-between gap-4">
                        <span className="text-white font-bold">Net Worth:</span>
                        <span className={`font-mono font-bold ${totalNetWorth >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                            {formatCurrency(totalNetWorth)}
                        </span>
                    </div>
                </div>
            </div>
        );
    };

    return (
        <div className="h-[400px] w-full text-white">
            <ResponsiveBar
                data={chartData}
                keys={keys}
                indexBy="year"
                margin={{ top: 20, right: 30, bottom: 50, left: 70 }}
                padding={0.3}
                groupMode="stacked"
                valueScale={{ type: 'linear' }}
                indexScale={{ type: 'band', round: true }}
                colors={({ id }) => {
                    if (id === 'Debt') return '#ef4444';
                    if (id === 'Invested') return '#10b981';
                    if (id === 'Saved') return '#3b82f6';
                    if (id === 'Property') return '#f59e0b';
                    return '#888888';
                }}
                enableLabel={false}
                axisTop={null}
                axisRight={null}
                axisBottom={{
                    tickSize: 0,
                    tickPadding: 12,
                    tickRotation: 0,
                    legend: 'Year',
                    legendPosition: 'middle',
                    legendOffset: 32
                }}
                axisLeft={{
                    tickSize: 0,
                    tickPadding: 12,
                    tickRotation: 0,
                    legendPosition: 'middle',
                    legendOffset: -50,
                    format: " >-$,.0f",
                    tickValues: 4
                }}
                legends={[]} // Removed legend to clean up UI, tooltip handles details
                theme={{
                    "background": "transparent", // Matches container
                    "text": { "fontSize": 12, "fill": "#9ca3af" },
                    "axis": { 
                        "legend": { "text": { "fill": "#9ca3af" } }, 
                        "ticks": { "text": { "fill": "#9ca3af" } } 
                    },
                    "grid": { "line": { "stroke": "#374151", "strokeWidth": 1, "strokeDasharray": "4 4" } },
                    "tooltip": { "container": { "background": "#1f2937", "color": "#ffffff", "fontSize": 12 } }
                }}
                tooltip={CustomTooltip}
            />
        </div>
    );
};