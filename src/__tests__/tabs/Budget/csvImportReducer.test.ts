import { describe, it, expect } from 'vitest';
import {
    csvImportReducer,
    initialCSVImportState,
    type CSVImportState,
    type CSVImportAction,
} from '../../../tabs/Budget/csvImport/csvImportReducer';
import type { ParsedCSV, CSVMapping } from '../../../services/CSVImportService';
import type { Transaction, SavedCSVMapping } from '../../../components/Objects/Budget/BudgetContext';

// --- test fixtures ---

const sampleCSV: ParsedCSV = {
    headers: ['Date', 'Description', 'Amount'],
    rows: [
        ['1/1/2026', 'Coffee', '-4.50'],
        ['1/2/2026', 'Paycheck', '2500'],
    ],
};

const sampleMatchedFormat: SavedCSVMapping = {
    id: 'fmt-1',
    name: 'Chase Checking',
    fingerprint: { headerHash: 'h', columnCount: 3, headers: ['Date', 'Description', 'Amount'] },
    mapping: { dateColumn: 0, descriptionColumn: 1, amountColumn: 2 },
    options: {
        dateFormat: 'M/D/YYYY',
        negativeIsExpense: true,
        hasHeaderRow: true,
        skipRows: 0,
    },
    lastUsed: new Date('2026-01-01'),
    importCount: 5,
    createdAt: new Date('2025-01-01'),
};

const sampleMatchedDebitCreditFormat: SavedCSVMapping = {
    ...sampleMatchedFormat,
    id: 'fmt-2',
    name: 'Checking',
    mapping: { dateColumn: 0, descriptionColumn: 1, debitColumn: 2, creditColumn: 3 },
};

function makeTransaction(id: string, amount: number, expenseId?: string): Transaction {
    return {
        id,
        date: new Date('2026-01-15'),
        description: `txn-${id}`,
        amount,
        expenseId,
    };
}

describe('csvImportReducer', () => {
    describe('initial state', () => {
        it('starts on the upload stage with sensible defaults', () => {
            expect(initialCSVImportState.stage).toBe('upload');
            expect(initialCSVImportState.csvContent).toBeNull();
            expect(initialCSVImportState.matchedFormat).toBeNull();
            expect(initialCSVImportState.mapping).toEqual({});
            expect(initialCSVImportState.options.dateFormat).toBe('M/D/YYYY');
            expect(initialCSVImportState.options.negativeIsExpense).toBe(true);
            expect(initialCSVImportState.useDebitCredit).toBe(false);
            expect(initialCSVImportState.saveFormat).toBe(true);
            expect(initialCSVImportState.transactions).toEqual([]);
            expect(initialCSVImportState.duplicates).toEqual([]);
            expect(initialCSVImportState.autoCategorizedCount).toBe(0);
            expect(initialCSVImportState.error).toBeNull();
        });
    });

    describe('RESET', () => {
        it('returns to initial state from a fully populated state', () => {
            const messy: CSVImportState = {
                ...initialCSVImportState,
                stage: 'preview',
                csvContent: sampleCSV,
                matchedFormat: sampleMatchedFormat,
                matchConfidence: 0.95,
                mapping: { dateColumn: 0, descriptionColumn: 1, amountColumn: 2 },
                formatName: 'Chase',
                useDebitCredit: true,
                transactions: [makeTransaction('a', -10)],
                duplicates: [makeTransaction('a', -10)],
                autoCategorizedCount: 1,
                error: 'something went wrong',
            };
            const result = csvImportReducer(messy, { type: 'RESET' });
            expect(result).toEqual(initialCSVImportState);
        });
    });

    describe('error handling', () => {
        it('SET_ERROR sets the error string', () => {
            const next = csvImportReducer(initialCSVImportState, {
                type: 'SET_ERROR',
                error: 'no rows found',
            });
            expect(next.error).toBe('no rows found');
            // doesn't touch the stage
            expect(next.stage).toBe('upload');
        });

        it('CLEAR_ERROR resets error to null', () => {
            const withError: CSVImportState = { ...initialCSVImportState, error: 'oops' };
            const next = csvImportReducer(withError, { type: 'CLEAR_ERROR' });
            expect(next.error).toBeNull();
        });
    });

    describe('BACK_TO_UPLOAD', () => {
        it('transitions to upload from mapping', () => {
            const onMapping: CSVImportState = { ...initialCSVImportState, stage: 'mapping' };
            const next = csvImportReducer(onMapping, { type: 'BACK_TO_UPLOAD' });
            expect(next.stage).toBe('upload');
        });

        it('does not clear the mapping form state (user can come back)', () => {
            const onMapping: CSVImportState = {
                ...initialCSVImportState,
                stage: 'mapping',
                mapping: { dateColumn: 0, descriptionColumn: 1, amountColumn: 2 },
                formatName: 'My Bank',
            };
            const next = csvImportReducer(onMapping, { type: 'BACK_TO_UPLOAD' });
            expect(next.mapping).toEqual({ dateColumn: 0, descriptionColumn: 1, amountColumn: 2 });
            expect(next.formatName).toBe('My Bank');
        });
    });

    describe('PARSE_NEEDS_MAPPING', () => {
        it('stores csv + suggested mapping and transitions to mapping', () => {
            const suggested: Partial<CSVMapping> = {
                dateColumn: 0,
                descriptionColumn: 1,
                amountColumn: 2,
            };
            const next = csvImportReducer(initialCSVImportState, {
                type: 'PARSE_NEEDS_MAPPING',
                csv: sampleCSV,
                mapping: suggested,
                dateFormat: 'YYYY-MM-DD',
                useDebitCredit: false,
            });
            expect(next.stage).toBe('mapping');
            expect(next.csvContent).toBe(sampleCSV);
            expect(next.mapping).toEqual(suggested);
            expect(next.options.dateFormat).toBe('YYYY-MM-DD');
            expect(next.useDebitCredit).toBe(false);
        });

        it('preserves existing options.dateFormat when none detected', () => {
            const next = csvImportReducer(initialCSVImportState, {
                type: 'PARSE_NEEDS_MAPPING',
                csv: sampleCSV,
                mapping: {},
                dateFormat: undefined,
                useDebitCredit: false,
            });
            expect(next.options.dateFormat).toBe('M/D/YYYY');
        });

        it('clears any prior error', () => {
            const withError: CSVImportState = { ...initialCSVImportState, error: 'previous err' };
            const next = csvImportReducer(withError, {
                type: 'PARSE_NEEDS_MAPPING',
                csv: sampleCSV,
                mapping: {},
                dateFormat: undefined,
                useDebitCredit: false,
            });
            expect(next.error).toBeNull();
        });

        it('respects useDebitCredit=true from suggester', () => {
            const next = csvImportReducer(initialCSVImportState, {
                type: 'PARSE_NEEDS_MAPPING',
                csv: sampleCSV,
                mapping: { dateColumn: 0, descriptionColumn: 1, debitColumn: 2, creditColumn: 3 },
                dateFormat: undefined,
                useDebitCredit: true,
            });
            expect(next.useDebitCredit).toBe(true);
        });
    });

    describe('PARSE_AUTO_MATCHED', () => {
        it('jumps straight to preview with matched format + computed results', () => {
            const txns = [makeTransaction('t1', -4.5), makeTransaction('t2', 2500)];
            const dupes = [makeTransaction('t1', -4.5)];
            const next = csvImportReducer(initialCSVImportState, {
                type: 'PARSE_AUTO_MATCHED',
                csv: sampleCSV,
                matchedFormat: sampleMatchedFormat,
                confidence: 0.92,
                transactions: txns,
                autoCategorizedCount: 1,
                duplicates: dupes,
            });
            expect(next.stage).toBe('preview');
            expect(next.csvContent).toBe(sampleCSV);
            expect(next.matchedFormat).toBe(sampleMatchedFormat);
            expect(next.matchConfidence).toBe(0.92);
            expect(next.transactions).toBe(txns);
            expect(next.autoCategorizedCount).toBe(1);
            expect(next.duplicates).toBe(dupes);
            expect(next.error).toBeNull();
        });
    });

    describe('UPDATE_MAPPING', () => {
        it('merges new fields into existing mapping (does not replace)', () => {
            const initial: CSVImportState = {
                ...initialCSVImportState,
                mapping: { dateColumn: 0, descriptionColumn: 1 },
            };
            const next = csvImportReducer(initial, {
                type: 'UPDATE_MAPPING',
                mapping: { amountColumn: 2 },
            });
            expect(next.mapping).toEqual({
                dateColumn: 0,
                descriptionColumn: 1,
                amountColumn: 2,
            });
        });

        it('overwrites an existing field when re-assigned', () => {
            const initial: CSVImportState = {
                ...initialCSVImportState,
                mapping: { dateColumn: 0 },
            };
            const next = csvImportReducer(initial, {
                type: 'UPDATE_MAPPING',
                mapping: { dateColumn: 5 },
            });
            expect(next.mapping.dateColumn).toBe(5);
        });

        it('can clear transactionTypeColumn via explicit undefined', () => {
            const initial: CSVImportState = {
                ...initialCSVImportState,
                mapping: { dateColumn: 0, transactionTypeColumn: 3 },
            };
            const next = csvImportReducer(initial, {
                type: 'UPDATE_MAPPING',
                mapping: { transactionTypeColumn: undefined },
            });
            expect(next.mapping.transactionTypeColumn).toBeUndefined();
            // other fields preserved
            expect(next.mapping.dateColumn).toBe(0);
        });
    });

    describe('UPDATE_OPTIONS', () => {
        it('merges option changes', () => {
            const next = csvImportReducer(initialCSVImportState, {
                type: 'UPDATE_OPTIONS',
                options: { negativeIsExpense: false },
            });
            expect(next.options.negativeIsExpense).toBe(false);
            // other defaults preserved
            expect(next.options.dateFormat).toBe('M/D/YYYY');
            expect(next.options.hasHeaderRow).toBe(true);
        });
    });

    describe('simple field setters', () => {
        it('SET_USE_DEBIT_CREDIT toggles the flag', () => {
            const next = csvImportReducer(initialCSVImportState, {
                type: 'SET_USE_DEBIT_CREDIT',
                value: true,
            });
            expect(next.useDebitCredit).toBe(true);
        });

        it('SET_FORMAT_NAME stores the typed name', () => {
            const next = csvImportReducer(initialCSVImportState, {
                type: 'SET_FORMAT_NAME',
                value: 'My Bank',
            });
            expect(next.formatName).toBe('My Bank');
        });

        it('SET_SAVE_FORMAT toggles the persist-format flag', () => {
            const next = csvImportReducer(initialCSVImportState, {
                type: 'SET_SAVE_FORMAT',
                value: false,
            });
            expect(next.saveFormat).toBe(false);
        });
    });

    describe('PREVIEW_READY', () => {
        it('stores preview results + transitions to preview from mapping', () => {
            const onMapping: CSVImportState = { ...initialCSVImportState, stage: 'mapping' };
            const txns = [makeTransaction('t1', -4.5)];
            const next = csvImportReducer(onMapping, {
                type: 'PREVIEW_READY',
                transactions: txns,
                autoCategorizedCount: 0,
                duplicates: [],
            });
            expect(next.stage).toBe('preview');
            expect(next.transactions).toBe(txns);
            expect(next.autoCategorizedCount).toBe(0);
            expect(next.duplicates).toEqual([]);
            expect(next.error).toBeNull();
        });

        it('clears prior validation error', () => {
            const withError: CSVImportState = {
                ...initialCSVImportState,
                stage: 'mapping',
                error: 'Please select Date, Description, and Amount columns.',
            };
            const next = csvImportReducer(withError, {
                type: 'PREVIEW_READY',
                transactions: [],
                autoCategorizedCount: 0,
                duplicates: [],
            });
            expect(next.error).toBeNull();
        });
    });

    describe('EDIT_MAPPING', () => {
        it('from manual-mapping preview: just returns to mapping (preserves form)', () => {
            const onPreview: CSVImportState = {
                ...initialCSVImportState,
                stage: 'preview',
                csvContent: sampleCSV,
                matchedFormat: null,
                mapping: { dateColumn: 0, descriptionColumn: 1, amountColumn: 2 },
                formatName: 'My CSV',
                useDebitCredit: false,
            };
            const next = csvImportReducer(onPreview, { type: 'EDIT_MAPPING' });
            expect(next.stage).toBe('mapping');
            // mapping form preserved
            expect(next.mapping).toEqual({ dateColumn: 0, descriptionColumn: 1, amountColumn: 2 });
            expect(next.formatName).toBe('My CSV');
        });

        it('from auto-matched preview: populates form from match and clears matchedFormat', () => {
            const onPreview: CSVImportState = {
                ...initialCSVImportState,
                stage: 'preview',
                csvContent: sampleCSV,
                matchedFormat: sampleMatchedFormat,
                matchConfidence: 0.95,
            };
            const next = csvImportReducer(onPreview, { type: 'EDIT_MAPPING' });
            expect(next.stage).toBe('mapping');
            expect(next.mapping).toEqual(sampleMatchedFormat.mapping);
            expect(next.options).toEqual(sampleMatchedFormat.options);
            expect(next.formatName).toBe(sampleMatchedFormat.name);
            expect(next.useDebitCredit).toBe(false);
            // matchedFormat cleared so import flow treats this as a new mapping
            expect(next.matchedFormat).toBeNull();
        });

        it('from auto-matched debit/credit preview: sets useDebitCredit=true', () => {
            const onPreview: CSVImportState = {
                ...initialCSVImportState,
                stage: 'preview',
                csvContent: sampleCSV,
                matchedFormat: sampleMatchedDebitCreditFormat,
                matchConfidence: 0.95,
            };
            const next = csvImportReducer(onPreview, { type: 'EDIT_MAPPING' });
            expect(next.useDebitCredit).toBe(true);
        });
    });

    describe('IMPORT_COMPLETED', () => {
        it('transitions to result without clearing prior results', () => {
            const onPreview: CSVImportState = {
                ...initialCSVImportState,
                stage: 'preview',
                transactions: [makeTransaction('a', -5, 'exp-1')],
                autoCategorizedCount: 1,
                duplicates: [],
            };
            const next = csvImportReducer(onPreview, { type: 'IMPORT_COMPLETED' });
            expect(next.stage).toBe('result');
            expect(next.transactions.length).toBe(1);
            expect(next.autoCategorizedCount).toBe(1);
        });
    });

    describe('immutability', () => {
        it('does not mutate the input state', () => {
            const initial: CSVImportState = {
                ...initialCSVImportState,
                mapping: { dateColumn: 0 },
            };
            const snapshot = JSON.stringify(initial);
            csvImportReducer(initial, { type: 'UPDATE_MAPPING', mapping: { amountColumn: 1 } });
            expect(JSON.stringify(initial)).toBe(snapshot);
        });

        it('produces a new state object for any state-changing action', () => {
            const action: CSVImportAction = { type: 'SET_FORMAT_NAME', value: 'x' };
            const next = csvImportReducer(initialCSVImportState, action);
            expect(next).not.toBe(initialCSVImportState);
        });
    });
});
