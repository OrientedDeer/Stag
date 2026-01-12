import React, { useMemo } from 'react';
import { SimulationYear } from '../../../components/Objects/Assumptions/SimulationEngine';
import { AnyAccount, DebtAccount, PropertyAccount } from '../../../components/Objects/Accounts/models';
import { LoanExpense, MortgageExpense } from '../../../components/Objects/Expense/models';

interface DataTabProps {
    simulationData: SimulationYear[];
    startAge: number;
}

// Helper: Format Currency
const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(value);
};

// Helper: Calculate Net Worth
const calculateNetWorth = (accounts: AnyAccount[]) => {
    let assets = 0;
    let liabilities = 0;
    accounts.forEach(acc => {
        const val = acc.amount || 0;
        if (acc instanceof DebtAccount) {
            liabilities += val;
        } else {
            assets += val;
            // PropertyAccount has a loan that counts as liability
            if (acc instanceof PropertyAccount && acc.loanAmount) {
                liabilities += acc.loanAmount;
            }
        }
    });
    return assets - liabilities;
};

export const DataTab: React.FC<DataTabProps> = React.memo(({ simulationData, startAge }) => {
    
    // 1. Prepare Table Data (Summary View)
    const tableData = useMemo(() => {
        return simulationData.map((year, index) => {
            const totalTaxes = year.taxDetails.fed + year.taxDetails.state + year.taxDetails.fica;
            const livingExpenses = year.expenses.reduce((sum, exp) => sum + exp.getAnnualAmount(), 0);
            
            // Calculate Total Debt for the year
            let totalDebt = 0;
            year.accounts.forEach(acc => {
                if (acc instanceof DebtAccount) totalDebt += acc.amount;
            });
            year.expenses.forEach(exp => {
                if (exp instanceof LoanExpense) totalDebt += exp.amount;
                if (exp instanceof MortgageExpense) totalDebt += exp.loan_balance;
            });

            const netWorth = calculateNetWorth(year.accounts);
            const effectiveTaxRate = year.cashflow.totalIncome > 0 
                ? (totalTaxes / year.cashflow.totalIncome) * 100 
                : 0;

            return {
                year: year.year,
                age: startAge + index,
                grossIncome: year.cashflow.totalIncome,
                effectiveTaxRate, 
                totalTaxes,
                livingExpenses,
                totalDebt,
                totalSaved: year.cashflow.totalInvested,
                netWorth,
            };
        });
    }, [simulationData, startAge]);

    // 2. Detailed CSV Generator
    const handleExportCSV = () => {
        if (simulationData.length === 0) return;

        // Step A: Collect ALL unique headers across the simulation
        const accountKeys = new Set<string>();
        const expenseKeys = new Set<string>();
        const incomeKeys = new Set<string>();

        simulationData.forEach(year => {
            year.accounts.forEach(acc => accountKeys.add(acc.name));
            year.expenses.forEach(exp => expenseKeys.add(exp.name));
            year.incomes.forEach(inc => incomeKeys.add(inc.name));
        });

        const sortedAccKeys = Array.from(accountKeys).sort();
        const sortedExpKeys = Array.from(expenseKeys).sort();
        const sortedIncKeys = Array.from(incomeKeys).sort();

        // Step B: Build Header Row
        const headers = [
            "Year", "Age", 
            "Net Worth", "Total Assets", "Total Debt",
            "Gross Income", "Total Taxes", "Total Expenses",
            ...sortedIncKeys.map(k => `INC: ${k}`),
            ...sortedExpKeys.map(k => `EXP: ${k}`),
            ...sortedAccKeys.map(k => `ACC: ${k}`)
        ];

        const csvRows = [headers.join(',')];

        // Step C: Build Data Rows
        simulationData.forEach((year, index) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const row: any[] = [];
            
            row.push(year.year);
            row.push(startAge + index);

            const nw = calculateNetWorth(year.accounts);
            row.push(nw);
            
            let assets = 0; 
            let debt = 0;
            year.accounts.forEach(acc => {
                if (acc instanceof DebtAccount) debt += acc.amount;
                else assets += acc.amount;
            });
            year.expenses.forEach(exp => {
                if (exp instanceof LoanExpense) debt += exp.amount;
                if (exp instanceof MortgageExpense) debt += exp.loan_balance;
            });
            row.push(assets);
            row.push(debt);

            row.push(year.cashflow.totalIncome);
            const tax = year.taxDetails.fed + year.taxDetails.state + year.taxDetails.fica;
            row.push(tax);
            row.push(year.cashflow.totalExpense); 

            // Detailed Columns
            const incMap = new Map(year.incomes.map(i => [i.name, i.amount]));
            sortedIncKeys.forEach(key => row.push(incMap.get(key) || 0));

            const expMap = new Map(year.expenses.map(e => [e.name, e.getAnnualAmount()]));
            sortedExpKeys.forEach(key => row.push(expMap.get(key) || 0));

            const accMap = new Map(year.accounts.map(a => [a.name, a.amount]));
            sortedAccKeys.forEach(key => row.push(accMap.get(key) || 0));

            csvRows.push(row.join(','));
        });

        const csvString = csvRows.join('\n');
        const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.setAttribute('href', url);
        link.setAttribute('download', 'simulation_detailed.csv');
        link.click();
    };

    const handleExportJSON = () => {
        const jsonString = JSON.stringify(simulationData, null, 2);
        const blob = new Blob([jsonString], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.setAttribute('href', url);
        link.setAttribute('download', 'simulation_full_data.json');
        link.click();
    };

    return (
        <div className="p-4 text-white flex flex-col h-full">
            <div className="flex justify-between items-center mb-4 shrink-0">
                <p className="text-gray-400 text-sm italic">
                    Export includes detailed breakdowns for every account and expense.
                </p>
                <div className="flex gap-3">
                    <button onClick={handleExportJSON} className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-200 text-sm font-bold rounded-lg border border-gray-600">
                        JSON
                    </button>
                    <button onClick={handleExportCSV} className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-bold rounded-lg shadow-lg">
                        CSV
                    </button>
                </div>
            </div>

            <div className="grow overflow-auto custom-scrollbar border border-gray-800 rounded-lg">
                <table className="w-full text-left border-collapse relative">
                    <thead className="sticky top-0 bg-gray-900 z-10 shadow-sm">
                        <tr>
                            <th className="p-3 border-b border-gray-700 text-gray-400 font-semibold text-sm">Year</th>
                            <th className="p-3 border-b border-gray-700 text-gray-400 font-semibold text-sm">Age</th>
                            <th className="p-3 border-b border-gray-700 text-gray-400 font-semibold text-sm text-right">Gross Income</th>
                            <th className="p-3 border-b border-gray-700 text-gray-400 font-semibold text-sm text-right">Eff. Tax %</th>
                            <th className="p-3 border-b border-gray-700 text-gray-400 font-semibold text-sm text-right">Total Taxes</th>
                            <th className="p-3 border-b border-gray-700 text-gray-400 font-semibold text-sm text-right">Expenses</th>
                            <th className="p-3 border-b border-gray-700 text-gray-400 font-semibold text-sm text-right">Debt Load</th>
                            <th className="p-3 border-b border-gray-700 text-gray-400 font-semibold text-sm text-right">Invested</th>
                            <th className="p-3 border-b border-gray-700 text-gray-200 font-bold text-sm text-right bg-gray-800">Net Worth</th>
                        </tr>
                    </thead>
                    <tbody>
                        {tableData.map((row) => (
                            <tr key={row.year} className="hover:bg-gray-800/50 transition-colors border-b border-gray-800/50">
                                <td className="p-3 text-sm text-gray-300">{row.year}</td>
                                <td className="p-3 text-sm text-gray-400">{row.age}</td>
                                <td className="p-3 text-sm text-right font-mono text-emerald-400">{formatCurrency(row.grossIncome)}</td>
                                <td className="p-3 text-sm text-right font-mono text-gray-400">{row.effectiveTaxRate.toFixed(1)}%</td>
                                <td className="p-3 text-sm text-right font-mono text-red-400">{formatCurrency(row.totalTaxes)}</td>
                                <td className="p-3 text-sm text-right font-mono text-orange-300">{formatCurrency(row.livingExpenses)}</td>
                                <td className="p-3 text-sm text-right font-mono text-red-500">{row.totalDebt > 0 ? formatCurrency(row.totalDebt) : '-'}</td>
                                <td className="p-3 text-sm text-right font-mono text-blue-400">{formatCurrency(row.totalSaved)}</td>
                                <td className="p-3 text-sm text-right font-mono font-bold text-white bg-gray-800/30">{formatCurrency(row.netWorth)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
});