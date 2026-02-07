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
} from '../../services/ExcelExportService';

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
// Refactoring Notes for exportToExcel
// =============================================================================

describe('exportToExcel (not tested - browser dependency)', () => {
    it.skip('NOTE: exportToExcel requires XLSX.writeFile which needs browser APIs', () => {
        // To make this testable, consider refactoring to:
        //
        // 1. Extract workbook building into a separate function:
        //    export function buildWorkbook(data: ExportData): XLSX.WorkBook
        //
        // 2. Keep exportToExcel as a thin wrapper:
        //    export function exportToExcel(data: ExportData): void {
        //        const workbook = buildWorkbook(data);
        //        XLSX.writeFile(workbook, generateFilename());
        //    }
        //
        // 3. Then we can test buildWorkbook without browser dependencies
        //
        // Alternative: Mock XLSX.writeFile in tests:
        //    vi.mock('xlsx', () => ({
        //        utils: { book_new: vi.fn(), book_append_sheet: vi.fn(), aoa_to_sheet: vi.fn() },
        //        writeFile: vi.fn(),
        //    }));
    });
});
