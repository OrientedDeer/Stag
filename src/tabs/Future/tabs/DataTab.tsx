import React, { useMemo, useContext, useState, useCallback } from 'react';
import { CHART_MONEY } from '../../../components/Charts/chartColors';
import { ResponsiveLine } from '@nivo/line';
import { type SimulationYear } from '../../../components/Objects/Assumptions/SimulationEngine';
import { DebtAccount } from '../../../components/Objects/Accounts/models';
import { LoanExpense, MortgageExpense } from '../../../components/Objects/Expense/models';
import { AssumptionsContext } from '../../../components/Objects/Assumptions/AssumptionsContext';
import { AccountContext } from '../../../components/Objects/Accounts/AccountContext';
import { IncomeContext } from '../../../components/Objects/Income/IncomeContext';
import { ExpenseContext } from '../../../components/Objects/Expense/ExpenseContext';
import { TaxContext } from '../../../components/Objects/Taxes/TaxContext';
import { MonteCarloContext } from '../../../components/Objects/Assumptions/MonteCarloContext';
import { exportToExcel, type ExportData } from '../../../services/ExcelExportService';
import { captureChart, collectReportData, generatePDFReport } from '../../../services/PDFReportService';
import { formatCompactCurrency, formatCurrency, getNetWorthBreakdown } from './FutureUtils';
import { totalTaxesOf } from '../../../components/Charts/taxTotals';

import { Button } from "../../../components/Layout/Primitives";
interface DataTabProps {
    simulationData: SimulationYear[];
    birthYear: number;
}

export const DataTab: React.FC<DataTabProps> = React.memo(({ simulationData, birthYear }) => {
    const { state: assumptions } = useContext(AssumptionsContext);
    const { accounts } = useContext(AccountContext);
    const { incomes } = useContext(IncomeContext);
    const { expenses } = useContext(ExpenseContext);
    const { state: taxState } = useContext(TaxContext);
    const { state: monteCarloState } = useContext(MonteCarloContext);
    const forceExact = assumptions.display?.useCompactCurrency === false;

    // PDF export state (button hidden, keeping code for potential future use)
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const [_pdfLoading, _setPdfLoading] = useState(false);

    // Chart data for PDF capture (simple net worth line). Vested net worth (#143)
    // to match the table's Net Worth column and the Dashboard card.
    const pdfChartData = useMemo(() => {
        return [{
            id: 'Net Worth',
            data: simulationData.map((year) => ({
                x: year.year,
                y: getNetWorthBreakdown(year.accounts).vested,
                age: year.year - birthYear,
            }))
        }];
    }, [simulationData, birthYear]);

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
    const _handleExportPDF = useCallback(async () => { // eslint-disable-line @typescript-eslint/no-unused-vars
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
    }, [simulationData, assumptions, monteCarloState.summary]);

    // 1. Prepare Table Data (Summary View)
    const tableData = useMemo(() => {
        return simulationData.map((year) => {
            // Sum ALL tax components (fed/state/FICA + withdrawal ordinary, cap-gains,
            // NIIT, IRMAA, ACA) so a retiree drawing a Traditional IRA doesn't show ~$0
            // taxes. Single-sourced with the Sankey and CSV via totalTaxesOf.
            const totalTaxes = totalTaxesOf(year.taxDetails);
            // Pass the row's year so amounts that are year-aware (e.g. a loan's
            // payment capped by amortization in its payoff year, date proration)
            // match what the charts and the simulation itself report.
            const livingExpenses = year.expenses.reduce((sum, exp) => sum + exp.getAnnualAmount(year.year), 0);
            
            // "Debt Load" column: the outstanding loan/mortgage balances the user is
            // paying down (expense side — DebtAccount + LoanExpense.amount +
            // MortgageExpense.loan_balance). This is deliberately a "what am I still paying
            // off" view, NOT the balance-sheet liability that nets into Net Worth — for a
            // linked mortgage the engine keeps the two in sync, but they are distinct
            // concepts. The reconciling Total Assets − Total Debt − Unvested = Net Worth
            // identity lives in the CSV, where Total Debt uses the account-side basis below.
            let totalDebt = 0;
            year.accounts.forEach(acc => {
                if (acc instanceof DebtAccount) totalDebt += acc.amount;
            });
            year.expenses.forEach(exp => {
                if (exp instanceof LoanExpense) totalDebt += exp.amount;
                if (exp instanceof MortgageExpense) totalDebt += exp.loan_balance;
            });

            // Net Worth column is VESTED (gross − unvested employer match), matching
            // the Dashboard card and the Overview tooltip (#143). The Unvested column
            // keeps the arithmetic visible against the CSV's gross Total Assets/Total Debt.
            const { unvested, vested } = getNetWorthBreakdown(year.accounts);

            // Eff. Tax % must rate the full tax bill against the income that
            // GENERATED it. totalTaxes now sums the withdrawal/cap-gains/NIIT/
            // IRMAA/ACA components (#189), but cashflow.totalIncome excludes the
            // gross account withdrawals those taxes are levied on — so a retiree
            // drawing a Traditional IRA showed an impossible >100% rate. Use the
            // year's AGI-equivalent tax base (magi: ordinary income + taxable SS
            // + Roth conversions + Traditional/RMD withdrawals + realized gains).
            // Fall back to income + conversions + gross withdrawals for older
            // simulation snapshots that predate the magi field.
            const conversionAmount = year.rothConversion?.amount || 0;
            const taxableIncomeBase = year.magi
                ?? (year.cashflow.totalIncome + conversionAmount + year.cashflow.withdrawals);
            const effectiveTaxRate = taxableIncomeBase > 0
                ? (totalTaxes / taxableIncomeBase) * 100
                : 0;

            return {
                year: year.year,
                // Derive age from the row's calendar year, not the array index — with
                // priorYearMode the array starts a year early, so index-based ages were
                // off by one for every row (table, CSV, and PDF chart).
                age: year.year - birthYear,
                grossIncome: year.cashflow.totalIncome,
                effectiveTaxRate,
                totalTaxes,
                livingExpenses,
                totalDebt,
                totalSaved: year.cashflow.totalInvested,
                unvested,
                netWorth: vested,
            };
        });
    }, [simulationData, birthYear]);

    // 2. Detailed CSV Generator
    const handleExportCSV = () => {
        if (simulationData.length === 0) return;

        // RFC-4180 field escaping: quote any value containing a comma, quote, or
        // newline (a comma in an account/expense name would otherwise shift every
        // column right for that row).
        const csvField = (v: string | number) => {
            const s = String(v);
            return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        };

        // Step A: Collect ALL detail columns across the simulation, keyed by item id
        // (id -> display name). Keying by id — not name — keeps same-named accounts,
        // incomes, or expenses as distinct columns instead of silently collapsing them.
        const accountCols = new Map<string, string>();
        const expenseCols = new Map<string, string>();
        const incomeCols = new Map<string, string>();

        simulationData.forEach(year => {
            year.accounts.forEach(acc => accountCols.set(acc.id, acc.name));
            year.expenses.forEach(exp => expenseCols.set(exp.id, exp.name));
            year.incomes.forEach(inc => incomeCols.set(inc.id, inc.name));
        });

        // Sort columns by display name for a stable, readable layout; id ties break
        // deterministically so two same-named items keep a fixed order.
        const byName = (a: [string, string], b: [string, string]) =>
            a[1].localeCompare(b[1]) || a[0].localeCompare(b[0]);
        const sortedIncCols = Array.from(incomeCols.entries()).sort(byName);
        const sortedExpCols = Array.from(expenseCols.entries()).sort(byName);
        const sortedAccCols = Array.from(accountCols.entries()).sort(byName);

        // Step B: Build Header Row
        const headers = [
            "Year", "Age",
            "Net Worth", "Total Assets", "Total Debt", "Unvested",
            "Gross Income", "Total Taxes", "Total Expenses",
            ...sortedIncCols.map(([, name]) => `INC: ${name}`),
            ...sortedExpCols.map(([, name]) => `EXP: ${name}`),
            ...sortedAccCols.map(([, name]) => `ACC: ${name}`)
        ];

        const csvRows = [headers.map(csvField).join(',')];

        // Step C: Build Data Rows
        simulationData.forEach((year) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const row: any[] = [];

            row.push(year.year);
            row.push(year.year - birthYear);

            // Net Worth is VESTED (#143); Total Assets / Total Debt stay gross. All four
            // columns share the SAME account-side basis as getNetWorthBreakdown, so the
            // identity holds for any user: Total Assets − Total Debt − Unvested = Net Worth.
            // (Total Debt is the balance-sheet liability — DebtAccount balances +
            // PropertyAccount.loanAmount — NOT the expense-side loan/mortgage payment
            // balances; sourcing debt from the expenses diverged from the gross net worth
            // that drives the Net Worth column, breaking the identity for mortgage/loan users.)
            const { assets, liabilities, unvested, vested } = getNetWorthBreakdown(year.accounts);
            row.push(vested);
            row.push(assets);
            row.push(liabilities);
            row.push(unvested);

            row.push(year.cashflow.totalIncome);
            // Full 8-component tax sum (matches the table + Sankey), not just fed/state/FICA.
            row.push(totalTaxesOf(year.taxDetails));
            row.push(year.cashflow.totalExpense);

            // Detailed Columns — keyed by id. Income is annualized (a $3,000 bi-weekly
            // salary must export as its ~$78k annual, not the per-period amount) so it
            // sits alongside the annual Gross Income column consistently.
            const incMap = new Map(year.incomes.map(i => [i.id, i.getAnnualAmount(year.year)]));
            sortedIncCols.forEach(([id]) => row.push(incMap.get(id) || 0));

            // Year-aware for the same reason as the table's livingExpenses sum.
            const expMap = new Map(year.expenses.map(e => [e.id, e.getAnnualAmount(year.year)]));
            sortedExpCols.forEach(([id]) => row.push(expMap.get(id) || 0));

            const accMap = new Map(year.accounts.map(a => [a.id, a.amount]));
            sortedAccCols.forEach(([id]) => row.push(accMap.get(id) || 0));

            csvRows.push(row.map(csvField).join(','));
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

    const handleExportExcel = async () => {
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

        await exportToExcel(exportData);
    };

    return (
        <div className="p-4 text-white flex flex-col h-full">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-4 shrink-0 gap-2">
                <div className="text-content-muted text-sm">
                    <p className="italic">Export includes detailed breakdowns for every account and expense.</p>
                    <p className="text-xs text-content-subtle mt-1">Note: JSON/CSV exports are read-only. To backup and restore data, use Export on the Accounts page.</p>
                </div>
                <div className="flex gap-3">
                    <button onClick={handleExportJSON} className="px-4 py-2 bg-surface-input hover:bg-surface-hover text-content-emphasis text-sm font-bold rounded-lg border border-border-strong">
                        JSON
                    </button>
                    <button onClick={handleExportCSV} className="px-4 py-2 bg-surface-input hover:bg-surface-hover text-content-emphasis text-sm font-bold rounded-lg border border-border-strong">
                        CSV
                    </button>
                    <Button onClick={() => { void handleExportExcel(); }} variant="positive" className="font-bold shadow-lg">
                        Excel
                    </Button>
                </div>
            </div>

            <div className="grow overflow-auto custom-scrollbar border border-border-subtle rounded-lg">
                <table className="w-full text-left border-collapse relative">
                    <thead className="sticky top-0 bg-surface-raised z-10 shadow-sm">
                        <tr>
                            <th className="p-3 border-b border-border-default text-content-muted font-semibold text-sm">Year</th>
                            <th className="p-3 border-b border-border-default text-content-muted font-semibold text-sm">Age</th>
                            <th className="p-3 border-b border-border-default text-content-muted font-semibold text-sm text-right">Gross Income</th>
                            <th className="p-3 border-b border-border-default text-content-muted font-semibold text-sm text-right">Eff. Tax %</th>
                            <th className="p-3 border-b border-border-default text-content-muted font-semibold text-sm text-right">Total Taxes</th>
                            <th className="p-3 border-b border-border-default text-content-muted font-semibold text-sm text-right">Expenses</th>
                            <th className="p-3 border-b border-border-default text-content-muted font-semibold text-sm text-right">Debt Load</th>
                            <th className="p-3 border-b border-border-default text-content-muted font-semibold text-sm text-right">Invested</th>
                            <th className="p-3 border-b border-border-default text-content-muted font-semibold text-sm text-right">Unvested</th>
                            <th className="p-3 border-b border-border-default text-content-emphasis font-bold text-sm text-right bg-surface-overlay">Net Worth</th>
                        </tr>
                    </thead>
                    <tbody>
                        {tableData.map((row) => (
                            <tr key={row.year} className="hover:bg-surface-overlay/50 transition-colors border-b border-border-subtle/50">
                                <td className="p-3 text-sm text-content-default">{row.year}</td>
                                <td className="p-3 text-sm text-content-muted">{row.age}</td>
                                <td className="p-3 text-sm text-right font-mono text-positive">{formatCompactCurrency(row.grossIncome, { forceExact })}</td>
                                <td className="p-3 text-sm text-right font-mono text-content-muted">{row.effectiveTaxRate.toFixed(1)}%</td>
                                <td className="p-3 text-sm text-right font-mono text-negative">{formatCompactCurrency(row.totalTaxes, { forceExact })}</td>
                                <td className="p-3 text-sm text-right font-mono text-cat-orange-bright">{formatCompactCurrency(row.livingExpenses, { forceExact })}</td>
                                <td className="p-3 text-sm text-right font-mono text-negative-soft">{row.totalDebt > 0 ? formatCompactCurrency(row.totalDebt, { forceExact }) : '-'}</td>
                                <td className="p-3 text-sm text-right font-mono text-info">{formatCompactCurrency(row.totalSaved, { forceExact })}</td>
                                <td className="p-3 text-sm text-right font-mono text-warning">{row.unvested > 0 ? formatCompactCurrency(row.unvested, { forceExact }) : '-'}</td>
                                <td className="p-3 text-sm text-right font-mono font-bold text-white bg-surface-overlay/30">{formatCompactCurrency(row.netWorth, { forceExact })}</td>
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
                    backgroundColor: 'var(--c-surface-raised)',
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
                            colors={[CHART_MONEY]}
                            lineWidth={3}
                            enablePoints={true}
                            pointSize={6}
                            pointColor="var(--color-chart-money)"
                            enableGridX={false}
                            enableArea={true}
                            areaOpacity={0.15}
                            theme={{
                                background: 'var(--c-surface-raised)',
                                text: { fontSize: 12, fill: 'var(--c-content-emphasis)' },
                                axis: {
                                    legend: { text: { fill: 'var(--c-content-emphasis)', fontSize: 14 } },
                                    ticks: { text: { fill: 'var(--c-content-muted)', fontSize: 11 } },
                                },
                                grid: { line: { stroke: 'var(--c-border-default)', strokeWidth: 1 } },
                            }}
                        />
                    )}
                </div>
            </div>
        </div>
    );
});