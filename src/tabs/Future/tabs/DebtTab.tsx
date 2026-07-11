import React, { useState, useMemo, useRef } from 'react';
import { type SimulationYear } from '../../../components/Objects/Assumptions/SimulationEngine';
import { DebtAccount } from '../../../components/Objects/Accounts/models';
import { LoanExpense, MortgageExpense } from '../../../components/Objects/Expense/models';
import { DebtStreamChart, type DebtStreamData } from '../../../components/Charts/DebtStreamChart';
import { RangeSlider } from '../../../components/Layout/InputFields/RangeSlider';
import { useArrowKeyAdjust } from '../../../hooks/useKeyboardShortcuts';

interface DebtTabProps {
    simulationData: SimulationYear[];
}

export const DebtTab: React.FC<DebtTabProps> = React.memo(({ simulationData }) => {
    // --- RANGE SLIDER STATE ---
    const minYear = simulationData.length > 0 ? simulationData[0].year : 2025;
    const maxYear = simulationData.length > 0 ? simulationData[simulationData.length - 1].year : 2060;

    // Calculate debtFreeYear and keys from full simulation data (independent of range)
    const { keys, debtFreeYear } = useMemo(() => {
        let debtFreeYear: number | null = null;
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

        return { keys: Array.from(allKeys), debtFreeYear };
    }, [simulationData]);

    // Default range end: debtFreeYear + 2, or full range if no debt-free year
    const defaultEnd = debtFreeYear ? Math.min(maxYear, debtFreeYear + 2) : maxYear;
    const [range, setRange] = useState<[number, number]>([minYear, defaultEnd]);
    const containerRef = useRef<HTMLDivElement>(null);
    useArrowKeyAdjust(
        range,
        (v) => setRange(v as [number, number]),
        { min: minYear, max: maxYear, step: 1, containerRef }
    );

    // Update range if defaultEnd changes (e.g., debts added/removed)
    const [prevDefaultEnd, setPrevDefaultEnd] = useState(defaultEnd);
    if (prevDefaultEnd !== defaultEnd) {
        setPrevDefaultEnd(defaultEnd);
        setRange([minYear, defaultEnd]);
    }

    // Filter and map simulation data for the chart based on slider range
    const data = useMemo(() => {
        const filteredSim = simulationData.filter(d => d.year >= range[0] && d.year <= range[1]);

        return filteredSim.map(year => {
            const datum: DebtStreamData = { year: year.year };
            keys.forEach(key => datum[key] = 0);

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
    }, [simulationData, range, keys]);

    const colors = useMemo(() => {
        const palette = ['var(--c-negative)', 'var(--c-cat-orange)', 'var(--c-warning)', 'var(--c-content-muted)', 'var(--c-negative-soft)', 'var(--c-cat-orange-soft)'];
        const map: Record<string, string> = {};
        keys.forEach((key, i) => map[key] = palette[i % palette.length]);
        return map;
    }, [keys]);

    if (keys.length === 0) return <div className="p-4 text-white text-center">No debt to track. You're debt free!</div>;

    return (
        <div ref={containerRef} className="p-4 text-white h-[500px] flex flex-col gap-4">
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
                    Debt Free Year: {debtFreeYear ? <span className='text-positive'>{debtFreeYear}</span> : 'Beyond Simulation'}
                </h3>
            </div>
            
            <div className="grow w-full">
                <DebtStreamChart data={data} keys={keys} colors={colors} />
            </div>
        </div>
    );
});