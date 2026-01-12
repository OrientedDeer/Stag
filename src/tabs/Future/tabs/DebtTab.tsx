import React, { useState, useMemo } from 'react';
import { SimulationYear } from '../../../components/Objects/Assumptions/SimulationEngine';
import { DebtAccount } from '../../../components/Objects/Accounts/models';
import { LoanExpense, MortgageExpense } from '../../../components/Objects/Expense/models';
import { DebtStreamChart } from '../../../components/Charts/DebtStreamChart';
import { RangeSlider } from '../../../components/Layout/InputFields/RangeSlider';

interface DebtTabProps {
    simulationData: SimulationYear[];
}

export const DebtTab: React.FC<DebtTabProps> = React.memo(({ simulationData }) => {
    // --- RANGE SLIDER STATE ---
    const minYear = simulationData.length > 0 ? simulationData[0].year : 2025;
    const maxYear = simulationData.length > 0 ? simulationData[simulationData.length - 1].year : 2060;
    const [range, setRange] = useState<[number, number]>([minYear, Math.min(maxYear, minYear + 32)]);

    const { data, keys, debtFreeYear } = useMemo(() => {
        let debtFreeYear: number | null = null;
        
        // 1. Calculate stable keys and debtFreeYear from FULL data
        const allKeys = new Set<string>();
        simulationData.forEach(year => {
            let yearTotalDebt = 0;
            year.expenses.forEach(exp => {
                if (exp instanceof LoanExpense || exp instanceof MortgageExpense) {
                    const balance = exp instanceof LoanExpense ? exp.amount : exp.loan_balance;
                    if (balance > 0) {
                        allKeys.add(exp.name);
                        yearTotalDebt += balance;
                    }
                }
            });
            year.accounts.forEach(acc => {
                if (acc instanceof DebtAccount && acc.amount > 0) {
                    allKeys.add(acc.name);
                    yearTotalDebt += acc.amount;
                }
            });

            if (yearTotalDebt <= 1 && debtFreeYear === null) debtFreeYear = year.year;
        });

        // 2. Filter simulation data for the chart range
        const filteredSim = simulationData.filter(d => d.year >= range[0] && d.year <= range[1]);

        // 3. Map ONLY the filtered data for the chart
        const mappedData = filteredSim.map(year => {
            const datum: any = { year: year.year };
            allKeys.forEach(key => datum[key] = 0);

            year.expenses.forEach(exp => {
                if (exp instanceof LoanExpense || exp instanceof MortgageExpense) {
                    const balance = exp instanceof LoanExpense ? exp.amount : exp.loan_balance;
                    if (balance > 0) datum[exp.name] = balance;
                }
            });
            year.accounts.forEach(acc => {
                if (acc instanceof DebtAccount && acc.amount > 0) datum[acc.name] = acc.amount;
            });

            return datum;
        });

        return { data: mappedData, keys: Array.from(allKeys), debtFreeYear };
    }, [simulationData, range]);

    const colors = useMemo(() => {
        const palette = ['#f87171', '#fb923c', '#facc15', '#a3a3a3', '#ef4444', '#f97316'];
        const map: Record<string, string> = {};
        keys.forEach((key, i) => map[key] = palette[i % palette.length]);
        return map;
    }, [keys]);

    if (keys.length === 0) return <div className="p-4 text-white text-center">No debt to track. You're debt free!</div>;

    return (
        <div className="p-4 text-white h-[500px] flex flex-col gap-4">
            <div className="flex justify-between items-center px-2 gap-8">
                <div className="grow">
                    <RangeSlider 
                        label="Timeline"
                        value={range}
                        min={minYear}
                        max={maxYear}
                        onChange={setRange}
                    />
                </div>
                <h3 className="text-lg font-bold whitespace-nowrap shrink-0"> {/* Added these classes */}
                    Debt Free Year: {debtFreeYear ? <span className='text-green-400'>{debtFreeYear}</span> : 'Beyond Simulation'}
                </h3>
            </div>
            
            <div className="grow w-full">
                <DebtStreamChart data={data} keys={keys} colors={colors} />
            </div>
        </div>
    );
});