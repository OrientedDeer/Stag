import type { ParsedCSV, CSVMapping, CSVImportOptions } from '../../../services/CSVImportService';
import type { Transaction, SavedCSVMapping } from '../../../components/Objects/Budget/BudgetContext';

export type ImportStage = 'upload' | 'mapping' | 'preview' | 'result';

export interface CSVImportState {
    stage: ImportStage;

    // Upload-stage outputs (parsed CSV + auto-match results)
    csvContent: ParsedCSV | null;
    matchedFormat: SavedCSVMapping | null;
    matchConfidence: number;

    // Mapping form state (user-edited in mapping stage)
    mapping: Partial<CSVMapping>;
    options: Partial<CSVImportOptions>;
    useDebitCredit: boolean;
    formatName: string;
    saveFormat: boolean;

    // Source/card label stamped onto every imported transaction (defaults to
    // the CSV format name; editable in the preview stage).
    assignSource: string;

    // Preview-stage outputs
    transactions: Transaction[];
    duplicates: Transaction[];
    autoCategorizedCount: number;

    // UI
    error: string | null;
}

export const initialCSVImportState: CSVImportState = {
    stage: 'upload',
    csvContent: null,
    matchedFormat: null,
    matchConfidence: 0,
    mapping: {},
    options: {
        dateFormat: 'M/D/YYYY',
        negativeIsExpense: true,
        hasHeaderRow: true,
        skipRows: 0,
    },
    useDebitCredit: false,
    formatName: '',
    saveFormat: true,
    assignSource: '',
    transactions: [],
    duplicates: [],
    autoCategorizedCount: 0,
    error: null,
};

export type CSVImportAction =
    | { type: 'RESET' }
    | { type: 'SET_ERROR'; error: string }
    | { type: 'CLEAR_ERROR' }
    | { type: 'BACK_TO_UPLOAD' }
    | {
          type: 'PARSE_NEEDS_MAPPING';
          csv: ParsedCSV;
          mapping: Partial<CSVMapping>;
          dateFormat: string | undefined;
          useDebitCredit: boolean;
      }
    | {
          type: 'PARSE_AUTO_MATCHED';
          csv: ParsedCSV;
          matchedFormat: SavedCSVMapping;
          confidence: number;
          transactions: Transaction[];
          autoCategorizedCount: number;
          duplicates: Transaction[];
      }
    | { type: 'UPDATE_MAPPING'; mapping: Partial<CSVMapping> }
    | { type: 'UPDATE_OPTIONS'; options: Partial<CSVImportOptions> }
    | { type: 'SET_USE_DEBIT_CREDIT'; value: boolean }
    | { type: 'SET_FORMAT_NAME'; value: string }
    | { type: 'SET_SAVE_FORMAT'; value: boolean }
    | { type: 'SET_ASSIGN_SOURCE'; value: string }
    | {
          type: 'PREVIEW_READY';
          transactions: Transaction[];
          autoCategorizedCount: number;
          duplicates: Transaction[];
      }
    | { type: 'EDIT_MAPPING' }
    | { type: 'IMPORT_COMPLETED' };

export function csvImportReducer(state: CSVImportState, action: CSVImportAction): CSVImportState {
    switch (action.type) {
        case 'RESET':
            return initialCSVImportState;

        case 'SET_ERROR':
            return { ...state, error: action.error };

        case 'CLEAR_ERROR':
            return { ...state, error: null };

        case 'BACK_TO_UPLOAD':
            return { ...state, stage: 'upload' };

        case 'PARSE_NEEDS_MAPPING':
            return {
                ...state,
                csvContent: action.csv,
                mapping: action.mapping,
                options: action.dateFormat
                    ? { ...state.options, dateFormat: action.dateFormat }
                    : state.options,
                useDebitCredit: action.useDebitCredit,
                error: null,
                stage: 'mapping',
            };

        case 'PARSE_AUTO_MATCHED':
            return {
                ...state,
                csvContent: action.csv,
                matchedFormat: action.matchedFormat,
                matchConfidence: action.confidence,
                transactions: action.transactions,
                autoCategorizedCount: action.autoCategorizedCount,
                duplicates: action.duplicates,
                // Default the source tag to the matched format's name unless the
                // user already typed one.
                assignSource: state.assignSource || action.matchedFormat.name,
                error: null,
                stage: 'preview',
            };

        case 'UPDATE_MAPPING':
            return { ...state, mapping: { ...state.mapping, ...action.mapping } };

        case 'UPDATE_OPTIONS':
            return { ...state, options: { ...state.options, ...action.options } };

        case 'SET_USE_DEBIT_CREDIT':
            return { ...state, useDebitCredit: action.value };

        case 'SET_FORMAT_NAME':
            return { ...state, formatName: action.value };

        case 'SET_SAVE_FORMAT':
            return { ...state, saveFormat: action.value };

        case 'SET_ASSIGN_SOURCE':
            return { ...state, assignSource: action.value };

        case 'PREVIEW_READY':
            return {
                ...state,
                transactions: action.transactions,
                autoCategorizedCount: action.autoCategorizedCount,
                duplicates: action.duplicates,
                // Default the source tag to the format name the user entered
                // during mapping unless they already set one explicitly.
                assignSource: state.assignSource || state.formatName,
                error: null,
                stage: 'preview',
            };

        case 'EDIT_MAPPING': {
            // Go to the mapping stage to adjust columns. If we got here from an
            // auto-matched preview, populate the form from the matched format and
            // clear matchedFormat so the import flow treats this as a fresh mapping.
            if (state.matchedFormat) {
                return {
                    ...state,
                    mapping: state.matchedFormat.mapping,
                    options: state.matchedFormat.options,
                    useDebitCredit:
                        state.matchedFormat.mapping.debitColumn !== undefined &&
                        state.matchedFormat.mapping.creditColumn !== undefined,
                    formatName: state.matchedFormat.name,
                    matchedFormat: null,
                    stage: 'mapping',
                };
            }
            return { ...state, stage: 'mapping' };
        }

        case 'IMPORT_COMPLETED':
            return { ...state, stage: 'result' };
    }
}
