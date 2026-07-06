/**
 * Tests for ExcelExportService
 *
 * Tests the sheet registry pattern for Excel export extensibility.
 * Note: exportToExcel is NOT tested as it requires browser APIs (XLSX.writeFile).
 */

import { describe, it, expect } from 'vitest';
import {
    registerSheetBuilder,
    getRegisteredSheets,
    buildSummarySheet,
    buildAccountsSheet,
    buildTaxSheet,
    ExportData,
} from '../../services/ExcelExportService';
import { PropertyAccount } from '../../components/Objects/Accounts/models';
import { SimulationYear } from '../../services/simulation/types';

// =============================================================================
// Note on Testing Approach
// =============================================================================
// The ExcelExportService has module-level state (sheetBuilders array) that
// persists across tests. The default sheets are registered at module load time.
// We test the registry functions without resetting state, which means:
// 1. getRegisteredSheets will return default sheets + any we register
// 2. registerSheetBuilder appends to the existing registry
//
// For exportToExcel: This function calls XLSX.writeFile which triggers a
// browser file download. To properly test workbook generation, we would need to:
// - Extract workbook-building logic into a separate testable function
// - Mock the XLSX library
// This is flagged as a potential refactoring opportunity.

// =============================================================================
// Default Sheets (from module initialization)
// =============================================================================

const DEFAULT_SHEETS = [
    'Summary',
    'Accounts',
    'Income',
    'Expenses',
    'Taxes',
    'Cashflow',
    'Withdrawals',
    'Monte Carlo',
    'Current State',
];

// =============================================================================
// getRegisteredSheets tests
// =============================================================================

describe('getRegisteredSheets', () => {
    it('should return an array', () => {
        const sheets = getRegisteredSheets();
        expect(Array.isArray(sheets)).toBe(true);
    });

    it('should return default sheets from module initialization', () => {
        const sheets = getRegisteredSheets();

        // Check that all default sheets are present
        for (const defaultSheet of DEFAULT_SHEETS) {
            expect(sheets).toContain(defaultSheet);
        }
    });

    it('should include at least the 9 default sheets', () => {
        const sheets = getRegisteredSheets();
        expect(sheets.length).toBeGreaterThanOrEqual(9);
    });

    it('should return strings for all sheet names', () => {
        const sheets = getRegisteredSheets();
        for (const sheet of sheets) {
            expect(typeof sheet).toBe('string');
        }
    });
});

// =============================================================================
// registerSheetBuilder tests
// =============================================================================

describe('registerSheetBuilder', () => {
    it('should register a new sheet builder', () => {
        const initialCount = getRegisteredSheets().length;

        registerSheetBuilder({
            name: 'Test Sheet 1',
            build: () => null,
            required: false,
        });

        const sheets = getRegisteredSheets();
        expect(sheets.length).toBe(initialCount + 1);
        expect(sheets).toContain('Test Sheet 1');
    });

    it('should allow registering multiple builders', () => {
        const initialCount = getRegisteredSheets().length;

        registerSheetBuilder({
            name: 'Test Sheet 2',
            build: () => null,
            required: false,
        });

        registerSheetBuilder({
            name: 'Test Sheet 3',
            build: () => null,
            required: true,
        });

        const sheets = getRegisteredSheets();
        expect(sheets.length).toBe(initialCount + 2);
        expect(sheets).toContain('Test Sheet 2');
        expect(sheets).toContain('Test Sheet 3');
    });

    it('should register builder with condition function', () => {
        const initialCount = getRegisteredSheets().length;

        registerSheetBuilder({
            name: 'Conditional Sheet',
            build: () => null,
            required: false,
            condition: () => true,
        });

        const sheets = getRegisteredSheets();
        expect(sheets.length).toBe(initialCount + 1);
        expect(sheets).toContain('Conditional Sheet');
    });

    it('should preserve existing sheets when registering new ones', () => {
        // Verify default sheets still exist after registering custom ones
        const sheets = getRegisteredSheets();

        for (const defaultSheet of DEFAULT_SHEETS) {
            expect(sheets).toContain(defaultSheet);
        }
    });
});

// =============================================================================
// #195: Total Taxes must sum all components; net worth must net out the mortgage
// =============================================================================

/** A retiree year: a $500k home financed with a $200k mortgage, drawing $100k
 *  gross from a Traditional IRA against $20k of Social Security. The bulk of the
 *  tax bill lives in the withdrawal/cap-gains components. */
function makeRetireeExportData(): ExportData {
    const home = new PropertyAccount('p1', 'Home', 500_000, 'Financed', 200_000, 250_000, '', 3);
    const year: SimulationYear = {
        year: 2050,
        incomes: [],
        expenses: [],
        accounts: [home],
        cashflow: {
            totalIncome: 20_000,
            totalExpense: 130_000,
            livingExpenses: 100_000,
            discretionary: 0,
            investedUser: 0,
            investedMatch: 0,
            totalInvested: 0,
            bucketAllocations: 0,
            bucketDetail: {},
            withdrawals: 100_000,
            withdrawalDetail: {},
        },
        taxDetails: {
            fed: 5_000, state: 0, fica: 0,
            preTax: 0, insurance: 0, postTax: 0,
            capitalGains: 3_000, withdrawalOrdinaryTax: 22_000, niit: 0,
        },
        magi: 120_000,
        logs: [],
    };
    return {
        simulation: [year],
        // getAge only needs milestones; an empty list falls back to a default birth year.
        assumptions: { milestones: [] } as unknown as ExportData['assumptions'],
        taxState: {} as unknown as ExportData['taxState'],
        currentAccounts: [home],
        currentIncomes: [],
        currentExpenses: [],
    };
}

describe('ExcelExportService retirement taxes + mortgage net worth (#195)', () => {
    it('Summary Total Taxes sums all 8 components, not the 4-part partial', () => {
        const { rows } = buildSummarySheet(makeRetireeExportData());
        // rows[0]=metadata, rows[1]=headers, rows[2]=first data year.
        // headers: [Year, Age, Gross Income, Total Taxes, Eff Tax %, Living, Net Savings, Net Worth]
        // 5000 + 3000 + 22000 = 30,000 (old partial fed+state+fica+capGains = 8,000).
        expect(rows[2][3]).toBe(30_000);
    });

    it('Summary Eff Tax % rates against magi so it stays sane (no >100%)', () => {
        const { rows } = buildSummarySheet(makeRetireeExportData());
        // 30,000 / 120,000 magi = 25% (old code divided by $20k income => 150%).
        expect(rows[2][4]).toBeCloseTo(25);
    });

    it('Summary Net Worth subtracts the outstanding mortgage principal', () => {
        const { rows } = buildSummarySheet(makeRetireeExportData());
        // $500k home value − $200k mortgage = $300k (old code showed the full $500k).
        expect(rows[2][7]).toBe(300_000);
    });

    it('Accounts sheet Total Debt / Net Worth account for the mortgage', () => {
        const { rows } = buildAccountsSheet(makeRetireeExportData());
        // headers: [Year, Age, Home, Total Assets, Total Debt, Net Worth]
        expect(rows[2][3]).toBe(500_000); // Total Assets (home value)
        expect(rows[2][4]).toBe(200_000); // Total Debt (mortgage) — was 0
        expect(rows[2][5]).toBe(300_000); // Net Worth — was 500,000
    });

    it('Tax sheet Total Taxes carries the full retirement-era bill', () => {
        const { rows } = buildTaxSheet(makeRetireeExportData());
        // headers: [..., Capital Gains, Withdrawal Tax, NIIT, IRMAA, ACA, Total Taxes, ...]
        expect(rows[2][6]).toBe(22_000); // Withdrawal Tax column (newly broken out)
        expect(rows[2][10]).toBe(30_000); // Total Taxes (old partial was 8,000)
    });
});

