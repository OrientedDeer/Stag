import React, { useMemo, useContext, useState, useCallback } from 'react';
import { ResponsiveLine } from '@nivo/line';
import { SimulationYear } from '../../../components/Objects/Assumptions/SimulationEngine';
import { AnyAccount, DebtAccount, PropertyAccount } from '../../../components/Objects/Accounts/models';
import { LoanExpense, MortgageExpense } from '../../../components/Objects/Expense/models';
import { AssumptionsContext } from '../../../components/Objects/Assumptions/AssumptionsContext';
import { AccountContext } from '../../../components/Objects/Accounts/AccountContext';
import { IncomeContext } from '../../../components/Objects/Income/IncomeContext';
import { ExpenseContext } from '../../../components/Objects/Expense/ExpenseContext';
import { TaxContext } from '../../../components/Objects/Taxes/TaxContext';
import { MonteCarloContext } from '../../../components/Objects/Assumptions/MonteCarloContext';
import { exportToExcel, ExportData } from '../../../services/ExcelExportService';
import { captureChart, collectReportData, generatePDFReport } from '../../../services/PDFReportService';
import { formatCompactCurrency, formatCurrency } from './FutureUtils';

interface DataTabProps {
    simulationData: SimulationYear[];
    birthYear: number;
}

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

export const DataTab: React.FC<DataTabProps> = React.memo(({ simulationData, birthYear }) => {
    const startAge = new Date().getFullYear() - birthYear;
    const { state: assumptions } = useContext(AssumptionsContext);
    const { accounts } = useContext(AccountContext);
    const { incomes } = useContext(IncomeContext);
    const { expenses } = useContext(ExpenseContext);
    const { state: taxState } = useContext(TaxContext);
    const { state: monteCarloState } = useContext(MonteCarloContext);
    const forceExact = assumptions.display?.useCompactCurrency === false;

    // PDF export state (button hidden, keeping code for potential future use)
    const [_pdfLoading, _setPdfLoading] = useState(false);

    // Chart data for PDF capture (simple net worth line)
    const pdfChartData = useMemo(() => {
        return [{
            id: 'Net Worth',
            data: simulationData.map((year, index) => ({
                x: year.year,
                y: calculateNetWorth(year.accounts),
                age: startAge + index,
            }))
        }];
    }, [simulationData, startAge]);

    // Calculate x-axis tick values to prevent label overlap
    const xTickValues = useMemo(() => {
        if (simulationData.length === 0) return undefined;
        const years = simulationData.map(d => d.year);
        const range = years.length;
        let step = 1;
        if (range > 40) step = 10;
        else if (range > 20) step = 5;
        else if (range > 10) step = 2;
        return years.filter((year, i) => {
            if (i === 0 || i === years.length - 1) return true;
            return (year - years[0]) % step === 0;
        });
    }, [simulationData]);

    // PDF export handler (button hidden, keeping code for potential future use)
    // @ts-expect-error - Intentionally unused, keeping for future use
    const _handleExportPDF = useCallback(async () => {
        if (simulationData.length === 0) return;

        _setPdfLoading(true);
        try {
            // Small delay to ensure chart is rendered
            await new Promise(resolve => setTimeout(resolve, 100));

            // Capture the hidden chart
            const chartImage = await captureChart('pdf-networth-chart');

            // Collect report data
            const reportData = collectReportData(
                simulationData,
                assumptions,
                monteCarloState.summary,
                chartImage
            );

            // Generate and download PDF
            await generatePDFReport(reportData);
        } catch (error) {
            console.error('PDF export failed:', error);
            alert('Failed to generate PDF. Please try again.');
        } finally {
            _setPdfLoading(false);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [simulationData, assumptions, monteCarloState.summary]);

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

            // Include Roth conversion amount in taxable income for effective rate calculation
            // Conversions are taxed but aren't included in cashflow.totalIncome (they're account transfers)
            const conversionAmount = year.rothConversion?.amount || 0;
            const taxableIncomeBase = year.cashflow.totalIncome + conversionAmount;
            const effectiveTaxRate = taxableIncomeBase > 0
                ? (totalTaxes / taxableIncomeBase) * 100
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

    const handleExportExcel = () => {
        if (simulationData.length === 0) return;

        const exportData: ExportData = {
            simulation: simulationData,
            assumptions: assumptions,
            taxState: taxState,
            currentAccounts: accounts,
            currentIncomes: incomes,
            currentExpenses: expenses,
            monteCarloSummary: monteCarloState.summary || undefined,
            monteCarloConfig: monteCarloState.config || undefined,
        };

        exportToExcel(exportData);
    };

    return (
        <div className="p-4 text-white flex flex-col h-full">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-4 shrink-0 gap-2">
                <div className="text-gray-400 text-sm">
                    <p className="italic">Export includes detailed breakdowns for every account and expense.</p>
                    <p className="text-xs text-gray-500 mt-1">Note: JSON/CSV exports are read-only. To backup and restore data, use Export on the Accounts page.</p>
                </div>
                <div className="flex gap-3">
                    <button onClick={handleExportJSON} className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-200 text-sm font-bold rounded-lg border border-gray-600">
                        JSON
                    </button>
                    <button onClick={handleExportCSV} className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-200 text-sm font-bold rounded-lg border border-gray-600">
                        CSV
                    </button>
                    <button onClick={handleExportExcel} className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-bold rounded-lg shadow-lg">
                        Excel
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
                                <td className="p-3 text-sm text-right font-mono text-emerald-400">{formatCompactCurrency(row.grossIncome, { forceExact })}</td>
                                <td className="p-3 text-sm text-right font-mono text-gray-400">{row.effectiveTaxRate.toFixed(1)}%</td>
                                <td className="p-3 text-sm text-right font-mono text-red-400">{formatCompactCurrency(row.totalTaxes, { forceExact })}</td>
                                <td className="p-3 text-sm text-right font-mono text-orange-300">{formatCompactCurrency(row.livingExpenses, { forceExact })}</td>
                                <td className="p-3 text-sm text-right font-mono text-red-500">{row.totalDebt > 0 ? formatCompactCurrency(row.totalDebt, { forceExact }) : '-'}</td>
                                <td className="p-3 text-sm text-right font-mono text-blue-400">{formatCompactCurrency(row.totalSaved, { forceExact })}</td>
                                <td className="p-3 text-sm text-right font-mono font-bold text-white bg-gray-800/30">{formatCompactCurrency(row.netWorth, { forceExact })}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {/* Hidden chart for PDF capture */}
            <div
                style={{
                    position: 'absolute',
                    left: '-9999px',
                    width: '800px',
                    height: '400px',
                    backgroundColor: '#1a202c',
                    padding: '20px',
                }}
            >
                <div id="pdf-networth-chart" style={{ width: '100%', height: '100%' }}>
                    {pdfChartData[0].data.length > 0 && (
                        <ResponsiveLine
                            data={pdfChartData}
                            margin={{ top: 20, right: 30, bottom: 60, left: 80 }}
                            xScale={{ type: 'point' }}
                            yScale={{
                                type: 'linear',
                                min: 'auto',
                                max: 'auto',
                            }}
                            curve="monotoneX"
                            axisTop={null}
                            axisRight={null}
                            axisBottom={{
                                tickSize: 0,
                                tickPadding: 12,
                                tickRotation: -45,
                                legend: 'Year',
                                legendOffset: 50,
                                legendPosition: 'middle',
                                tickValues: xTickValues,
                            }}
                            axisLeft={{
                                tickSize: 0,
                                tickPadding: 12,
                                tickRotation: 0,
                                legend: 'Net Worth',
                                legendOffset: -65,
                                legendPosition: 'middle',
                                format: (v: number) => formatCurrency(v),
                            }}
                            colors={['#10b981']}
                            lineWidth={3}
                            enablePoints={true}
                            pointSize={6}
                            pointColor="#10b981"
                            enableGridX={false}
                            enableArea={true}
                            areaOpacity={0.15}
                            theme={{
                                background: '#1a202c',
                                text: { fontSize: 12, fill: '#e2e8f0' },
                                axis: {
                                    legend: { text: { fill: '#e2e8f0', fontSize: 14 } },
                                    ticks: { text: { fill: '#a0aec0', fontSize: 11 } },
                                },
                                grid: { line: { stroke: '#374151', strokeWidth: 1 } },
                            }}
                        />
                    )}
                </div>
            </div>
        </div>
    );
});