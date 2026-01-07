import React, { useMemo } from 'react';
import { SimulationYear } from '../../../components/Objects/Assumptions/SimulationEngine';
import { LoanExpense, MortgageExpense } from '../../../components/Objects/Expense/models';
import { DebtStreamChart } from '../../../components/Charts/DebtStreamChart';

interface DebtTabProps {
    simulationData: SimulationYear[];
}

export const DebtTab: React.FC<DebtTabProps> = ({ simulationData }) => {
    const { data, keys, debtFreeYear } = useMemo(() => {
        let debtFreeYear: number | null = null;
        const allDebtNames = new Set<string>();

        // First pass: find all unique debt names
        simulationData.forEach(year => {
            year.expenses.forEach(exp => {
                if (exp instanceof LoanExpense || exp instanceof MortgageExpense) {
                    allDebtNames.add(exp.name);
                }
            });
        });

        // Second pass: build the data for the stream chart
        const mappedData = simulationData.map(year => {
            const datum: any = { year: year.year };
            let totalDebtThisYear = 0;

            allDebtNames.forEach(name => {
                const expense = year.expenses.find(exp => exp.name === name);
                let balance = 0;
                if (expense && (expense instanceof LoanExpense || expense instanceof MortgageExpense)) {
                    balance = expense instanceof LoanExpense ? expense.amount : expense.loan_balance;
                }
                datum[name] = balance > 0 ? balance : 0;
                totalDebtThisYear += datum[name];
            });

            if (totalDebtThisYear <= 0 && debtFreeYear === null) {
                debtFreeYear = year.year;
            }

            return datum;
        });

        // If all debt is paid off from year 0
        if (debtFreeYear === null && mappedData.length > 0) {
            const initialTotalDebt = Object.values(mappedData[0]).reduce((sum: any, val: any) => typeof val === 'number' && val > 0 ? sum + val : sum, 0);
            if(initialTotalDebt === 0) {
                debtFreeYear = mappedData[0].year;
            }
        }


        return { data: mappedData, keys: Array.from(allDebtNames), debtFreeYear };
    }, [simulationData]);

    // Generate a consistent color map for the accounts
    const colors = useMemo(() => {
        const palette = [
            '#ef4444', '#f97316', '#eab308', '#84cc16', '#22c55e',
            '#10b981', '#14b8a6', '#06b6d4', '#0ea5e9', '#3b82f6'
        ].reverse(); // Debt colors can be "hotter"
        const map: Record<string, string> = {};
        keys.forEach((key, i) => {
            map[key] = palette[i % palette.length];
        });
        return map;
    }, [keys]);


    if (keys.length === 0) {
        return (
            <div className="p-6 text-center text-gray-300">
                <h3 className="text-2xl font-bold text-green-400">Congratulations!</h3>
                <p className="mt-2">You are completely debt-free.</p>
            </div>
        );
    }

    return (
        <div className="w-full h-full flex flex-col">
             {/* Header */}
             <div className="mb-4 p-4 bg-gray-900 rounded-xl border border-gray-800 text-center shadow-lg">
                <h2 className="text-lg font-semibold text-gray-400 uppercase tracking-wider">Debt Free Year</h2>
                <p className={`text-4xl font-bold mt-1 ${debtFreeYear ? 'text-green-400' : 'text-amber-400'}`}>
                    {debtFreeYear ? debtFreeYear : 'Beyond Simulation'}
                </p>
             </div>
            
            {/* Chart */}
            <div className="flex-1 min-h-0 h-[400px]">
                <DebtStreamChart data={data} keys={keys} colors={colors} />
            </div>
        </div>
    );
};
