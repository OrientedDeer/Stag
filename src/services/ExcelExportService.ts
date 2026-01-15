// Excel Export Service for Stag Financial Planning
// Version 1.0 - Sheet Registry Pattern for extensibility

import * as XLSX from 'xlsx';
import { SimulationYear } from '../components/Objects/Assumptions/SimulationEngine';
import { MonteCarloSummary, MonteCarloConfig } from './MonteCarloTypes';
import { AnyAccount, InvestedAccount, SavedAccount, PropertyAccount, DebtAccount, DeficitDebtAccount } from '../components/Objects/Accounts/models';
import { AnyIncome } from '../components/Objects/Income/models';
import { AnyExpense } from '../components/Objects/Expense/models';
import { TaxState } from '../components/Objects/Taxes/TaxContext';
import { AssumptionsState } from '../components/Objects/Assumptions/AssumptionsContext';

// ============================================================================
// Types
// ============================================================================

export interface ExportData {
    simulation: SimulationYear[];
    assumptions: AssumptionsState;
    taxState: TaxState;
    currentAccounts: AnyAccount[];
    currentIncomes: AnyIncome[];
    currentExpenses: AnyExpense[];
    monteCarloSummary?: MonteCarloSummary;
    monteCarloConfig?: MonteCarloConfig;
}

interface SheetBuilder {
    name: string;
    build: (data: ExportData) => XLSX.WorkSheet | null;
    required: boolean;
    condition?: (data: ExportData) => boolean;
}

// ============================================================================
// Utility Functions
// ============================================================================

function formatCurrency(value: number): number {
    return Math.round(value * 100) / 100;
}

function getAge(year: number, assumptions: AssumptionsState): number {
    return assumptions.demographics.startAge + (year - assumptions.demographics.startYear);
}

function generateFilename(): string {
    const date = new Date().toISOString().split('T')[0];
    return `stag_financial_plan_${date}.xlsx`;
}

function addMetadataRow(data: unknown[][], simulation: SimulationYear[]): void {
    const startYear = simulation[0]?.year || 'N/A';
    const endYear = simulation[simulation.length - 1]?.year || 'N/A';
    const date = new Date().toISOString().split('T')[0];
    data.unshift([`Stag Export v1.0 | Generated: ${date} | Simulation Years: ${startYear}-${endYear}`]);
}

function collectUniqueNames<T>(
    simulation: SimulationYear[],
    extractor: (year: SimulationYear) => T[],
    nameGetter: (item: T) => string
): string[] {
    const names = new Set<string>();
    for (const year of simulation) {
        for (const item of extractor(year)) {
            names.add(nameGetter(item));
        }
    }
    return Array.from(names).sort();
}

// Currency format string for Excel
const CURRENCY_FORMAT = '"$"#,##0.00';
const PERCENT_FORMAT = '0.0"%"';

/**
 * Apply currency formatting to specific columns in a worksheet.
 * @param ws - The worksheet to format
 * @param currencyColumns - Array of column indices (0-based) that should be currency formatted
 * @param percentColumns - Array of column indices (0-based) that should be percent formatted
 * @param startRow - First data row (0-based, after headers/metadata)
 * @param endRow - Last data row (0-based, inclusive)
 */
function applyNumberFormats(
    ws: XLSX.WorkSheet,
    currencyColumns: number[],
    percentColumns: number[],
    startRow: number,
    endRow: number
): void {
    const colToLetter = (col: number): string => {
        let letter = '';
        let temp = col;
        while (temp >= 0) {
            letter = String.fromCharCode((temp % 26) + 65) + letter;
            temp = Math.floor(temp / 26) - 1;
        }
        return letter;
    };

    for (let row = startRow; row <= endRow; row++) {
        for (const col of currencyColumns) {
            const cellRef = colToLetter(col) + (row + 1); // Excel is 1-indexed
            if (ws[cellRef] && typeof ws[cellRef].v === 'number') {
                ws[cellRef].z = CURRENCY_FORMAT;
            }
        }
        for (const col of percentColumns) {
            const cellRef = colToLetter(col) + (row + 1);
            if (ws[cellRef] && typeof ws[cellRef].v === 'number') {
                ws[cellRef].z = PERCENT_FORMAT;
            }
        }
    }
}

// ============================================================================
// Sheet Builders
// ============================================================================

function buildSummarySheet(data: ExportData): XLSX.WorkSheet {
    const { simulation, assumptions } = data;

    const rows: unknown[][] = [];
    addMetadataRow(rows, simulation);

    // Headers
    rows.push(['Year', 'Age', 'Gross Income', 'Total Taxes', 'Eff Tax %', 'Living Expenses', 'Net Savings', 'Net Worth']);

    for (const year of simulation) {
        const age = getAge(year.year, assumptions);
        const grossIncome = year.cashflow.totalIncome;
        const totalTaxes = year.taxDetails.fed + year.taxDetails.state + year.taxDetails.fica + year.taxDetails.capitalGains;
        const effTaxRate = grossIncome > 0 ? (totalTaxes / grossIncome) * 100 : 0;
        const livingExpenses = year.cashflow.totalExpense - totalTaxes;
        const netSavings = year.cashflow.totalInvested;

        // Calculate net worth from accounts
        let netWorth = 0;
        for (const acc of year.accounts) {
            if (acc instanceof DebtAccount || acc instanceof DeficitDebtAccount) {
                netWorth -= acc.amount;
            } else {
                netWorth += acc.amount;
            }
        }

        rows.push([
            year.year,
            age,
            formatCurrency(grossIncome),
            formatCurrency(totalTaxes),
            formatCurrency(effTaxRate),
            formatCurrency(livingExpenses),
            formatCurrency(netSavings),
            formatCurrency(netWorth)
        ]);
    }

    const ws = XLSX.utils.aoa_to_sheet(rows);
    // Apply formatting: columns 2,3,5,6,7 are currency; column 4 is percent
    // Data starts at row 2 (0-indexed: row 0=metadata, row 1=headers)
    applyNumberFormats(ws, [2, 3, 5, 6, 7], [4], 2, rows.length - 1);
    return ws;
}

function buildAccountsSheet(data: ExportData): XLSX.WorkSheet {
    const { simulation, assumptions } = data;

    // Collect all unique account names
    const accountNames = collectUniqueNames(
        simulation,
        (year) => year.accounts,
        (acc) => acc.name
    );

    const rows: unknown[][] = [];
    addMetadataRow(rows, simulation);

    // Headers
    rows.push(['Year', 'Age', ...accountNames, 'Total Assets', 'Total Debt', 'Net Worth']);

    for (const year of simulation) {
        const age = getAge(year.year, assumptions);
        const accountBalances: number[] = [];
        let totalAssets = 0;
        let totalDebt = 0;

        for (const name of accountNames) {
            const account = year.accounts.find(a => a.name === name);
            let balance = 0;

            if (account) {
                if (account instanceof DebtAccount || account instanceof DeficitDebtAccount) {
                    balance = -account.amount;
                    totalDebt += account.amount;
                } else {
                    balance = account.amount;
                    totalAssets += balance;
                }
            }

            accountBalances.push(formatCurrency(balance));
        }

        rows.push([
            year.year,
            age,
            ...accountBalances,
            formatCurrency(totalAssets),
            formatCurrency(totalDebt),
            formatCurrency(totalAssets - totalDebt)
        ]);
    }

    const ws = XLSX.utils.aoa_to_sheet(rows);
    // All columns from index 2 onwards are currency (accounts + totals)
    const currencyCols = Array.from({ length: accountNames.length + 3 }, (_, i) => i + 2);
    applyNumberFormats(ws, currencyCols, [], 2, rows.length - 1);
    return ws;
}

function buildIncomeSheet(data: ExportData): XLSX.WorkSheet {
    const { simulation, assumptions } = data;

    // Collect all unique income names
    const incomeNames = collectUniqueNames(
        simulation,
        (year) => year.incomes,
        (inc) => inc.name
    );

    const rows: unknown[][] = [];
    addMetadataRow(rows, simulation);

    // Headers
    rows.push(['Year', 'Age', ...incomeNames, 'Total Income']);

    for (const year of simulation) {
        const age = getAge(year.year, assumptions);
        const incomeValues: number[] = [];
        let totalIncome = 0;

        for (const name of incomeNames) {
            const income = year.incomes.find(i => i.name === name);
            const value = income?.getAnnualAmount(year.year) || 0;
            incomeValues.push(formatCurrency(value));
            totalIncome += value;
        }

        rows.push([
            year.year,
            age,
            ...incomeValues,
            formatCurrency(totalIncome)
        ]);
    }

    const ws = XLSX.utils.aoa_to_sheet(rows);
    // All columns from index 2 onwards are currency (incomes + total)
    const currencyCols = Array.from({ length: incomeNames.length + 1 }, (_, i) => i + 2);
    applyNumberFormats(ws, currencyCols, [], 2, rows.length - 1);
    return ws;
}

function buildExpenseSheet(data: ExportData): XLSX.WorkSheet {
    const { simulation, assumptions } = data;

    // Collect all unique expense names
    const expenseNames = collectUniqueNames(
        simulation,
        (year) => year.expenses,
        (exp) => exp.name
    );

    const rows: unknown[][] = [];
    addMetadataRow(rows, simulation);

    // Headers
    rows.push(['Year', 'Age', ...expenseNames, 'Total Expenses']);

    for (const year of simulation) {
        const age = getAge(year.year, assumptions);
        const expenseValues: number[] = [];
        let totalExpenses = 0;

        for (const name of expenseNames) {
            const expense = year.expenses.find(e => e.name === name);
            const value = expense?.getAnnualAmount(year.year) || 0;
            expenseValues.push(formatCurrency(value));
            totalExpenses += value;
        }

        rows.push([
            year.year,
            age,
            ...expenseValues,
            formatCurrency(totalExpenses)
        ]);
    }

    const ws = XLSX.utils.aoa_to_sheet(rows);
    // All columns from index 2 onwards are currency (expenses + total)
    const currencyCols = Array.from({ length: expenseNames.length + 1 }, (_, i) => i + 2);
    applyNumberFormats(ws, currencyCols, [], 2, rows.length - 1);
    return ws;
}

function buildTaxSheet(data: ExportData): XLSX.WorkSheet {
    const { simulation, assumptions } = data;

    const rows: unknown[][] = [];
    addMetadataRow(rows, simulation);

    // Headers
    rows.push(['Year', 'Age', 'Federal', 'State', 'FICA', 'Capital Gains', 'Total Taxes', 'PreTax Deductions', 'Insurance']);

    for (const year of simulation) {
        const age = getAge(year.year, assumptions);
        const { fed, state, fica, capitalGains, preTax, insurance } = year.taxDetails;
        const totalTaxes = fed + state + fica + capitalGains;

        rows.push([
            year.year,
            age,
            formatCurrency(fed),
            formatCurrency(state),
            formatCurrency(fica),
            formatCurrency(capitalGains),
            formatCurrency(totalTaxes),
            formatCurrency(preTax),
            formatCurrency(insurance)
        ]);
    }

    const ws = XLSX.utils.aoa_to_sheet(rows);
    // Columns 2-8 are all currency
    applyNumberFormats(ws, [2, 3, 4, 5, 6, 7, 8], [], 2, rows.length - 1);
    return ws;
}

function buildCashflowSheet(data: ExportData): XLSX.WorkSheet {
    const { simulation, assumptions } = data;

    const rows: unknown[][] = [];
    addMetadataRow(rows, simulation);

    // Headers
    rows.push([
        'Year', 'Age', 'Total Income', 'Total Expense', 'Discretionary',
        'User Invested', 'Employer Match', 'Bucket Allocations', 'Withdrawals'
    ]);

    for (const year of simulation) {
        const age = getAge(year.year, assumptions);
        const cf = year.cashflow;

        rows.push([
            year.year,
            age,
            formatCurrency(cf.totalIncome),
            formatCurrency(cf.totalExpense),
            formatCurrency(cf.discretionary),
            formatCurrency(cf.investedUser),
            formatCurrency(cf.investedMatch),
            formatCurrency(cf.bucketAllocations),
            formatCurrency(cf.withdrawals)
        ]);
    }

    const ws = XLSX.utils.aoa_to_sheet(rows);
    // Columns 2-8 are all currency
    applyNumberFormats(ws, [2, 3, 4, 5, 6, 7, 8], [], 2, rows.length - 1);
    return ws;
}

function buildWithdrawalSheet(data: ExportData): XLSX.WorkSheet {
    const { simulation, assumptions } = data;

    // Collect unique account names from withdrawal details
    const accountNames = new Set<string>();
    for (const year of simulation) {
        if (year.cashflow.withdrawalDetail) {
            for (const name of Object.keys(year.cashflow.withdrawalDetail)) {
                accountNames.add(name);
            }
        }
    }
    const sortedAccountNames = Array.from(accountNames).sort();

    const rows: unknown[][] = [];
    addMetadataRow(rows, simulation);

    // Headers
    rows.push([
        'Year', 'Age', 'Strategy', 'Target Rate %', 'Actual Rate %',
        ...sortedAccountNames,
        'Total Withdrawal', 'GK Adjustment', 'Roth Conversion', 'Roth Tax Cost'
    ]);

    for (const year of simulation) {
        const age = getAge(year.year, assumptions);

        // Only include years with withdrawals or retirement years
        if (!year.strategyWithdrawal && !year.rothConversion && year.cashflow.withdrawals === 0) {
            continue;
        }

        const withdrawal = year.strategyWithdrawal;
        const accountWithdrawals = sortedAccountNames.map(name => {
            const amount = year.cashflow.withdrawalDetail?.[name] || 0;
            return formatCurrency(amount);
        });

        const gkAdjustment = year.strategyAdjustment?.actualAdjustment || 0;
        const rothConversion = year.rothConversion?.amount || 0;
        const rothTaxCost = year.rothConversion?.taxCost || 0;

        rows.push([
            year.year,
            age,
            assumptions.investments.withdrawalStrategy || '',
            formatCurrency(withdrawal?.targetWithdrawalRate || 0),
            formatCurrency(withdrawal?.currentWithdrawalRate || 0),
            ...accountWithdrawals,
            formatCurrency(withdrawal?.amount || 0),
            formatCurrency(gkAdjustment),
            formatCurrency(rothConversion),
            formatCurrency(rothTaxCost)
        ]);
    }

    // If no withdrawal years, add a note
    if (rows.length <= 2) {
        rows.push(['No retirement withdrawals in simulation period']);
    }

    const ws = XLSX.utils.aoa_to_sheet(rows);
    // Columns 3-4 are percent (Target Rate, Actual Rate)
    // Columns 5 onwards are currency (account withdrawals + totals)
    const currencyCols = Array.from({ length: sortedAccountNames.length + 4 }, (_, i) => i + 5);
    applyNumberFormats(ws, currencyCols, [3, 4], 2, rows.length - 1);
    return ws;
}

function buildMonteCarloSheet(data: ExportData): XLSX.WorkSheet | null {
    const { monteCarloSummary, monteCarloConfig } = data;

    if (!monteCarloSummary) return null;

    const rows: unknown[][] = [];

    // Metadata
    const date = new Date().toISOString().split('T')[0];
    rows.push([`Stag Monte Carlo Export v1.0 | Generated: ${date}`]);
    rows.push([]);

    // Summary metrics
    rows.push(['Monte Carlo Summary']);
    rows.push(['Metric', 'Value']);
    rows.push(['Success Rate', `${(monteCarloSummary.successRate).toFixed(1)}%`]);
    rows.push(['Total Scenarios', monteCarloSummary.totalScenarios]);
    rows.push(['Successful Scenarios', monteCarloSummary.successfulScenarios]);
    rows.push(['Average Final Net Worth', formatCurrency(monteCarloSummary.averageFinalNetWorth)]);
    rows.push(['Median Final Net Worth', formatCurrency(monteCarloSummary.medianCase?.finalNetWorth || 0)]);

    if (monteCarloConfig) {
        rows.push(['Seed', monteCarloConfig.seed]);
        rows.push(['Return Std Dev', `${monteCarloConfig.returnStdDev}%`]);
        rows.push(['Return Mean', `${monteCarloConfig.returnMean}%`]);
    }

    rows.push([]);

    // Percentile data over time
    const percentiles = monteCarloSummary.percentiles;
    let percentileStartRow = -1;
    if (percentiles && percentiles.p50 && percentiles.p50.length > 0) {
        rows.push(['Percentile Bands Over Time']);
        rows.push(['Year', 'P10', 'P25', 'P50 (Median)', 'P75', 'P90']);
        percentileStartRow = rows.length; // Data starts after headers

        // Iterate over the years using p50 as the reference
        for (let i = 0; i < percentiles.p50.length; i++) {
            rows.push([
                percentiles.p50[i].year,
                formatCurrency(percentiles.p10[i]?.netWorth || 0),
                formatCurrency(percentiles.p25[i]?.netWorth || 0),
                formatCurrency(percentiles.p50[i]?.netWorth || 0),
                formatCurrency(percentiles.p75[i]?.netWorth || 0),
                formatCurrency(percentiles.p90[i]?.netWorth || 0)
            ]);
        }
    }

    const ws = XLSX.utils.aoa_to_sheet(rows);

    // Apply currency format to percentile data (columns 1-5: P10, P25, P50, P75, P90)
    if (percentileStartRow >= 0) {
        applyNumberFormats(ws, [1, 2, 3, 4, 5], [], percentileStartRow, rows.length - 1);
    }

    return ws;
}

function buildCurrentStateSheet(data: ExportData): XLSX.WorkSheet {
    const { assumptions, taxState, currentAccounts, currentIncomes, currentExpenses } = data;

    const rows: unknown[][] = [];
    const date = new Date().toISOString().split('T')[0];
    rows.push([`Stag Current State Export v1.0 | Generated: ${date}`]);
    rows.push([]);

    // Demographics
    rows.push(['Demographics']);
    rows.push(['Setting', 'Value']);
    rows.push(['Start Age', assumptions.demographics.startAge]);
    rows.push(['Retirement Age', assumptions.demographics.retirementAge]);
    rows.push(['Life Expectancy', assumptions.demographics.lifeExpectancy]);
    rows.push(['Start Year', assumptions.demographics.startYear]);
    rows.push([]);

    // Growth Rates
    rows.push(['Growth Rates']);
    rows.push(['Setting', 'Value']);
    rows.push(['Inflation Rate', `${assumptions.macro.inflationRate}%`]);
    rows.push(['Investment Return', `${assumptions.investments.returnRates.ror}%`]);
    rows.push(['Salary Growth', `${assumptions.income.salaryGrowth}%`]);
    rows.push(['Healthcare Inflation', `${assumptions.macro.healthcareInflation}%`]);
    rows.push([]);

    // Tax Settings
    rows.push(['Tax Settings']);
    rows.push(['Setting', 'Value']);
    rows.push(['Filing Status', taxState.filingStatus]);
    rows.push(['State', taxState.stateResidency]);
    rows.push(['Deduction Method', taxState.deductionMethod]);
    rows.push([]);

    // Withdrawal Settings
    rows.push(['Withdrawal Settings']);
    rows.push(['Setting', 'Value']);
    rows.push(['Strategy', assumptions.investments.withdrawalStrategy]);
    rows.push(['Withdrawal Rate', `${assumptions.investments.withdrawalRate}%`]);
    rows.push(['Auto Roth Conversions', assumptions.investments.autoRothConversions ? 'Enabled' : 'Disabled']);
    rows.push([]);

    // Current Accounts Summary
    rows.push(['Current Accounts']);
    rows.push(['Name', 'Type', 'Balance']);
    const accountsStartRow = rows.length;
    for (const acc of currentAccounts) {
        let balance = 0;
        let accountType = '';

        if (acc instanceof InvestedAccount) {
            balance = acc.amount;
            accountType = `Invested (${acc.taxType})`;
        } else if (acc instanceof SavedAccount) {
            balance = acc.amount;
            accountType = 'Savings';
        } else if (acc instanceof PropertyAccount) {
            balance = acc.amount;
            accountType = 'Property';
        } else {
            // DebtAccount or DeficitDebtAccount (extends DebtAccount)
            balance = -acc.amount;
            accountType = acc instanceof DeficitDebtAccount ? 'Deficit' : 'Debt';
        }

        rows.push([acc.name, accountType, formatCurrency(balance)]);
    }
    const accountsEndRow = rows.length - 1;
    rows.push([]);

    // Current Incomes Summary
    rows.push(['Current Incomes']);
    rows.push(['Name', 'Type', 'Amount']);
    const incomesStartRow = rows.length;
    const currentYear = new Date().getFullYear();
    for (const inc of currentIncomes) {
        const amount = inc.getAnnualAmount(currentYear);
        // Determine type from class name or constructor
        const incomeType = inc.constructor.name.replace('Income', '');
        rows.push([inc.name, incomeType, formatCurrency(amount)]);
    }
    const incomesEndRow = rows.length - 1;
    rows.push([]);

    // Current Expenses Summary
    rows.push(['Current Expenses']);
    rows.push(['Name', 'Type', 'Amount']);
    const expensesStartRow = rows.length;
    for (const exp of currentExpenses) {
        const amount = exp.getAnnualAmount(currentYear);
        // Determine type from class name or constructor
        const expenseType = exp.constructor.name.replace('Expense', '');
        rows.push([exp.name, expenseType, formatCurrency(amount)]);
    }
    const expensesEndRow = rows.length - 1;

    const ws = XLSX.utils.aoa_to_sheet(rows);

    // Apply currency formatting to column 2 (Balance/Amount) in each table
    if (currentAccounts.length > 0) {
        applyNumberFormats(ws, [2], [], accountsStartRow, accountsEndRow);
    }
    if (currentIncomes.length > 0) {
        applyNumberFormats(ws, [2], [], incomesStartRow, incomesEndRow);
    }
    if (currentExpenses.length > 0) {
        applyNumberFormats(ws, [2], [], expensesStartRow, expensesEndRow);
    }

    return ws;
}

// ============================================================================
// Sheet Registry
// ============================================================================

const sheetBuilders: SheetBuilder[] = [
    { name: 'Summary', build: buildSummarySheet, required: true },
    { name: 'Accounts', build: buildAccountsSheet, required: true },
    { name: 'Income', build: buildIncomeSheet, required: true },
    { name: 'Expenses', build: buildExpenseSheet, required: true },
    { name: 'Taxes', build: buildTaxSheet, required: true },
    { name: 'Cashflow', build: buildCashflowSheet, required: true },
    { name: 'Withdrawals', build: buildWithdrawalSheet, required: true },
    { name: 'Monte Carlo', build: buildMonteCarloSheet, required: false, condition: (data) => !!data.monteCarloSummary },
    { name: 'Current State', build: buildCurrentStateSheet, required: true },
];

// ============================================================================
// Main Export Function
// ============================================================================

export function exportToExcel(data: ExportData): void {
    const workbook = XLSX.utils.book_new();

    for (const builder of sheetBuilders) {
        // Skip conditional sheets that don't meet their condition
        if (builder.condition && !builder.condition(data)) {
            continue;
        }

        const sheet = builder.build(data);

        if (sheet) {
            XLSX.utils.book_append_sheet(workbook, sheet, builder.name);
        } else if (builder.required) {
            console.warn(`Required sheet "${builder.name}" returned null`);
        }
    }

    // Generate and download the file
    const filename = generateFilename();
    XLSX.writeFile(workbook, filename);
}

// ============================================================================
// Future Extension Point: Register Custom Sheets
// ============================================================================

export function registerSheetBuilder(builder: SheetBuilder): void {
    sheetBuilders.push(builder);
}

export function getRegisteredSheets(): string[] {
    return sheetBuilders.map(b => b.name);
}
