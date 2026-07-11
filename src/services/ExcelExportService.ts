// Excel Export Service for Stag Financial Planning
// Version 1.0 - Sheet Registry Pattern for extensibility

import ExcelJS from 'exceljs';
import { type SimulationYear } from '../components/Objects/Assumptions/SimulationEngine';
import { type MonteCarloSummary, type MonteCarloConfig } from './MonteCarloTypes';
import { type AnyAccount, InvestedAccount, SavedAccount, PropertyAccount, DebtAccount, DeficitDebtAccount } from '../components/Objects/Accounts/models';
import { getAccountTotals } from '../components/Objects/Accounts/accountTotals';
import { type AnyIncome } from '../components/Objects/Income/models';
import { type AnyExpense } from '../components/Objects/Expense/models';
import { type TaxState } from '../components/Objects/Taxes/TaxContext';
import { type AssumptionsState, getRetirementAge, getLifeExpectancy, getBirthYear } from '../components/Objects/Assumptions/AssumptionsContext';
import { totalTaxesOf } from '../components/Charts/taxTotals';

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
    build: (data: ExportData) => SheetContent | null;
    required: boolean;
    condition?: (data: ExportData) => boolean;
}

// A number-format directive applied to a rectangular block of cells after the
// rows have been written. Row/column indices are 0-based and inclusive.
interface CellFormat {
    columns: number[];
    numFmt: string;
    startRow: number;
    endRow: number;
}

// Decoupled representation of a worksheet: the raw rows plus the number formats
// to apply. Builders return this rather than a live worksheet so they stay
// independent of the workbook (and trivially unit-testable).
interface SheetContent {
    rows: unknown[][];
    formats: CellFormat[];
}

// ============================================================================
// Utility Functions
// ============================================================================

function formatCurrency(value: number): number {
    return Math.round(value * 100) / 100;
}

function getAge(year: number, assumptions: AssumptionsState): number {
    return year - getBirthYear(assumptions.milestones);
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
 * Build number-format directives for a worksheet.
 * @param currencyColumns - Column indices (0-based) that should be currency formatted
 * @param percentColumns - Column indices (0-based) that should be percent formatted
 * @param startRow - First data row (0-based, after headers/metadata)
 * @param endRow - Last data row (0-based, inclusive)
 */
function numberFormats(
    currencyColumns: number[],
    percentColumns: number[],
    startRow: number,
    endRow: number
): CellFormat[] {
    const formats: CellFormat[] = [];
    if (currencyColumns.length > 0) {
        formats.push({ columns: currencyColumns, numFmt: CURRENCY_FORMAT, startRow, endRow });
    }
    if (percentColumns.length > 0) {
        formats.push({ columns: percentColumns, numFmt: PERCENT_FORMAT, startRow, endRow });
    }
    return formats;
}

// ============================================================================
// Sheet Builders
// ============================================================================

export function buildSummarySheet(data: ExportData): SheetContent {
    const { simulation, assumptions } = data;

    const rows: unknown[][] = [];
    addMetadataRow(rows, simulation);

    // Headers
    rows.push(['Year', 'Age', 'Gross Income', 'Total Taxes', 'Eff Tax %', 'Living Expenses', 'Net Savings', 'Net Worth']);

    for (const year of simulation) {
        const age = getAge(year.year, assumptions);
        const grossIncome = year.cashflow.totalIncome;
        // Sum ALL tax components (fed/state/FICA + withdrawal ordinary, cap-gains,
        // NIIT, IRMAA, ACA) so a retiree drawing a Traditional IRA doesn't export
        // ~$0 taxes. Single-sourced with the Data tab / Sankey via totalTaxesOf (#189/#195).
        const totalTaxes = totalTaxesOf(year.taxDetails);
        // Rate against the year's AGI-equivalent tax base (magi) — the income that
        // GENERATED those taxes. cashflow.totalIncome excludes the gross account
        // withdrawals the withdrawal/cap-gains taxes are levied on, so dividing by
        // it produced an impossible >100% rate. Fall back for pre-magi snapshots.
        const taxBase = year.magi
            ?? (grossIncome + (year.rothConversion?.amount || 0) + year.cashflow.withdrawals);
        const effTaxRate = taxBase > 0 ? (totalTaxes / taxBase) * 100 : 0;
        const livingExpenses = year.cashflow.totalExpense - totalTaxes;
        const netSavings = year.cashflow.totalInvested;

        // Net worth via the canonical math (mortgage principal counts as a liability).
        const netWorth = getAccountTotals(year.accounts).netWorth;

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

    // Columns 2,3,5,6,7 are currency; column 4 is percent.
    // Data starts at row 2 (0-indexed: row 0=metadata, row 1=headers)
    return { rows, formats: numberFormats([2, 3, 5, 6, 7], [4], 2, rows.length - 1) };
}

export function buildAccountsSheet(data: ExportData): SheetContent {
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

        for (const name of accountNames) {
            const account = year.accounts.find(a => a.name === name);
            let balance = 0;

            if (account) {
                if (account instanceof DebtAccount || account instanceof DeficitDebtAccount) {
                    balance = -account.amount;
                } else {
                    balance = account.amount;
                }
            }

            accountBalances.push(formatCurrency(balance));
        }

        // Totals via the canonical net-worth math so a financed home's outstanding
        // mortgage (PropertyAccount.loanAmount) lands in Total Debt and doesn't
        // overstate Net Worth. Iterates the real accounts (not the deduped name
        // list), so same-named accounts are all counted.
        const { assets: totalAssets, liabilities: totalDebt, netWorth } = getAccountTotals(year.accounts);

        rows.push([
            year.year,
            age,
            ...accountBalances,
            formatCurrency(totalAssets),
            formatCurrency(totalDebt),
            formatCurrency(netWorth)
        ]);
    }

    // All columns from index 2 onwards are currency (accounts + totals)
    const currencyCols = Array.from({ length: accountNames.length + 3 }, (_, i) => i + 2);
    return { rows, formats: numberFormats(currencyCols, [], 2, rows.length - 1) };
}

function buildIncomeSheet(data: ExportData): SheetContent {
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

    // All columns from index 2 onwards are currency (incomes + total)
    const currencyCols = Array.from({ length: incomeNames.length + 1 }, (_, i) => i + 2);
    return { rows, formats: numberFormats(currencyCols, [], 2, rows.length - 1) };
}

function buildExpenseSheet(data: ExportData): SheetContent {
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

    // All columns from index 2 onwards are currency (expenses + total)
    const currencyCols = Array.from({ length: expenseNames.length + 1 }, (_, i) => i + 2);
    return { rows, formats: numberFormats(currencyCols, [], 2, rows.length - 1) };
}

export function buildTaxSheet(data: ExportData): SheetContent {
    const { simulation, assumptions } = data;

    const rows: unknown[][] = [];
    addMetadataRow(rows, simulation);

    // Headers. The retirement-era components (withdrawal ordinary tax, NIIT,
    // IRMAA, ACA repayment) are broken out so 'Total Taxes' is transparent and
    // self-consistent — previously they were omitted entirely and a retiree's
    // total read ~$0 (#189/#195).
    rows.push(['Year', 'Age', 'Federal', 'State', 'FICA', 'Capital Gains', 'Withdrawal Tax', 'NIIT', 'IRMAA', 'ACA Repayment', 'Total Taxes', 'PreTax Deductions', 'Insurance']);

    for (const year of simulation) {
        const age = getAge(year.year, assumptions);
        const { fed, state, fica, capitalGains, withdrawalOrdinaryTax, niit, irmaa, aca, preTax, insurance } = year.taxDetails;
        const totalTaxes = totalTaxesOf(year.taxDetails);

        rows.push([
            year.year,
            age,
            formatCurrency(fed),
            formatCurrency(state),
            formatCurrency(fica),
            formatCurrency(capitalGains),
            formatCurrency(withdrawalOrdinaryTax || 0),
            formatCurrency(niit || 0),
            formatCurrency(irmaa || 0),
            formatCurrency(aca || 0),
            formatCurrency(totalTaxes),
            formatCurrency(preTax),
            formatCurrency(insurance)
        ]);
    }

    // Columns 2-12 are all currency
    return { rows, formats: numberFormats([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], [], 2, rows.length - 1) };
}

function buildCashflowSheet(data: ExportData): SheetContent {
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

    // Columns 2-8 are all currency
    return { rows, formats: numberFormats([2, 3, 4, 5, 6, 7, 8], [], 2, rows.length - 1) };
}

function buildWithdrawalSheet(data: ExportData): SheetContent {
    const { simulation, assumptions } = data;

    // withdrawalDetail is keyed by account ID (#142). Collect the unique account
    // ids that appear in any year's withdrawals, and resolve each id -> display
    // name from the per-year account snapshots (last name seen wins, so renamed
    // accounts show their latest label). Accounts that drop out of the snapshots
    // fall back to the raw id.
    const accountIds = new Set<string>();
    for (const year of simulation) {
        if (year.cashflow.withdrawalDetail) {
            for (const id of Object.keys(year.cashflow.withdrawalDetail)) {
                accountIds.add(id);
            }
        }
    }
    // Resolve id -> display name ONLY for the withdrawal-bearing ids (last name seen
    // wins, so a renamed account shows its latest label) instead of naming every
    // account in every year. Ids absent from all snapshots fall back to the raw id.
    const idToName = new Map<string, string>();
    for (const year of simulation) {
        for (const acc of year.accounts) {
            if (accountIds.has(acc.id)) idToName.set(acc.id, acc.name);
        }
    }
    // Sort columns by display name for a stable, human-readable header order.
    const sortedAccountIds = Array.from(accountIds).sort((a, b) =>
        (idToName.get(a) ?? a).localeCompare(idToName.get(b) ?? b)
    );
    const sortedAccountNames = sortedAccountIds.map(id => idToName.get(id) ?? id);

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
        const accountWithdrawals = sortedAccountIds.map(id => {
            const amount = year.cashflow.withdrawalDetail?.[id] || 0;
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

    // Columns 3-4 are percent (Target Rate, Actual Rate)
    // Columns 5 onwards are currency (account withdrawals + totals)
    const currencyCols = Array.from({ length: sortedAccountNames.length + 4 }, (_, i) => i + 5);
    return { rows, formats: numberFormats(currencyCols, [3, 4], 2, rows.length - 1) };
}

function buildMonteCarloSheet(data: ExportData): SheetContent | null {
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

    // Apply currency format to percentile data (columns 1-5: P10, P25, P50, P75, P90)
    const formats = percentileStartRow >= 0
        ? numberFormats([1, 2, 3, 4, 5], [], percentileStartRow, rows.length - 1)
        : [];

    return { rows, formats };
}

function buildCurrentStateSheet(data: ExportData): SheetContent {
    const { assumptions, taxState, currentAccounts, currentIncomes, currentExpenses } = data;

    const rows: unknown[][] = [];
    const date = new Date().toISOString().split('T')[0];
    rows.push([`Stag Current State Export v1.0 | Generated: ${date}`]);
    rows.push([]);

    // Demographics
    rows.push(['Demographics']);
    rows.push(['Setting', 'Value']);
    rows.push(['Birth Year', getBirthYear(assumptions.milestones)]);
    rows.push(['Retirement Age', getRetirementAge(assumptions.milestones)]);
    rows.push(['Life Expectancy', getLifeExpectancy(assumptions.milestones)]);
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

    // Apply currency formatting to column 2 (Balance/Amount) in each table
    const formats: CellFormat[] = [];
    if (currentAccounts.length > 0) {
        formats.push(...numberFormats([2], [], accountsStartRow, accountsEndRow));
    }
    if (currentIncomes.length > 0) {
        formats.push(...numberFormats([2], [], incomesStartRow, incomesEndRow));
    }
    if (currentExpenses.length > 0) {
        formats.push(...numberFormats([2], [], expensesStartRow, expensesEndRow));
    }

    return { rows, formats };
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

// Write a builder's rows into a new worksheet and apply its number formats.
function materializeSheet(workbook: ExcelJS.Workbook, name: string, content: SheetContent): void {
    const ws = workbook.addWorksheet(name);
    ws.addRows(content.rows as ExcelJS.CellValue[][]);

    for (const format of content.formats) {
        for (let row = format.startRow; row <= format.endRow; row++) {
            for (const col of format.columns) {
                const cell = ws.getCell(row + 1, col + 1); // ExcelJS is 1-indexed
                if (typeof cell.value === 'number') {
                    cell.numFmt = format.numFmt;
                }
            }
        }
    }
}

export async function exportToExcel(data: ExportData): Promise<void> {
    const workbook = new ExcelJS.Workbook();

    for (const builder of sheetBuilders) {
        // Skip conditional sheets that don't meet their condition
        if (builder.condition && !builder.condition(data)) {
            continue;
        }

        const content = builder.build(data);

        if (content) {
            materializeSheet(workbook, builder.name, content);
        } else if (builder.required) {
            console.warn(`Required sheet "${builder.name}" returned null`);
        }
    }

    // Generate the file and trigger a browser download
    const filename = generateFilename();
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
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
