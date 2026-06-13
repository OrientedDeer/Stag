import { useCallback } from 'react';
import type { Dispatch } from 'react';
import { useReceiptToast } from '../../../components/Layout/Overlays/ReceiptToast';
import { MONTH_NAMES } from '../../../components/Objects/Budget/budgetUtils';
import {
    parseCSV,
    detectColumnTypes,
    generateFingerprint,
    findMatchingFormat,
    applyMapping,
    detectDuplicates,
    applyCategories,
    createSuggestedMapping,
    generateMappingId,
} from '../../../services/CSVImportService';
import type { CSVMapping, CSVImportOptions } from '../../../services/CSVImportService';
import type {
    Transaction,
    SavedCSVMapping,
    BudgetState,
    MonthlySnapshot,
    BudgetAction,
} from '../../../components/Objects/Budget/BudgetContext';
import type { CSVImportState, CSVImportAction } from './csvImportReducer';

export interface CSVImportActions {
    processFile: (content: string) => void;
    applyMappingAndPreview: () => void;
    handleImport: () => void;
}

interface UseCSVImportFlowArgs {
    state: CSVImportState;
    dispatch: Dispatch<CSVImportAction>;
    importSettings: BudgetState['importSettings'];
    existingTransactions: Transaction[];
    budgetDispatch: Dispatch<BudgetAction>;
    getOrCreateMonth: (month: number, year: number) => MonthlySnapshot;
}

/**
 * Encapsulates the side-effectful operations that drive the CSV import wizard:
 * parsing, mapping/preview, and final dispatch into the budget store. The
 * reducer owns "what state can be in"; this hook owns "what happens when the
 * user takes an action."
 */
export function useCSVImportFlow({
    state,
    dispatch,
    importSettings,
    existingTransactions,
    budgetDispatch,
    getOrCreateMonth,
}: UseCSVImportFlowArgs): CSVImportActions {
    const { show: showReceipt } = useReceiptToast();

    const processFile = useCallback(
        (content: string) => {
            try {
                const csv = parseCSV(content);
                if (csv.rows.length === 0) {
                    dispatch({ type: 'SET_ERROR', error: 'No data found in CSV file.' });
                    return;
                }

                const match = findMatchingFormat(csv, importSettings.savedCSVFormats);
                if (match && match.confidence >= 0.9) {
                    const txns = applyMapping(
                        csv,
                        match.mapping.mapping,
                        match.mapping.options
                    );
                    const { categorized, autoCategorizedCount } = applyCategories(
                        txns,
                        importSettings.categoryMappings
                    );
                    const dupes = detectDuplicates(categorized, existingTransactions);
                    dispatch({
                        type: 'PARSE_AUTO_MATCHED',
                        csv,
                        matchedFormat: match.mapping,
                        confidence: match.confidence,
                        transactions: categorized,
                        autoCategorizedCount,
                        duplicates: dupes,
                    });
                } else {
                    const columnDetections = detectColumnTypes(csv);
                    const suggested = createSuggestedMapping(columnDetections);
                    dispatch({
                        type: 'PARSE_NEEDS_MAPPING',
                        csv,
                        mapping: suggested.mapping,
                        dateFormat: suggested.options.dateFormat,
                        useDebitCredit:
                            suggested.mapping.debitColumn !== undefined &&
                            suggested.mapping.creditColumn !== undefined,
                    });
                }
            } catch (e) {
                const detail = e instanceof Error ? e.message : String(e);
                dispatch({ type: 'SET_ERROR', error: `Failed to parse CSV file: ${detail}` });
            }
        },
        [dispatch, importSettings, existingTransactions]
    );

    const applyMappingAndPreview = useCallback(() => {
        if (!state.csvContent) return;

        const hasAmount = state.useDebitCredit
            ? state.mapping.debitColumn !== undefined && state.mapping.creditColumn !== undefined
            : state.mapping.amountColumn !== undefined;

        if (
            state.mapping.dateColumn === undefined ||
            state.mapping.descriptionColumn === undefined ||
            !hasAmount
        ) {
            dispatch({
                type: 'SET_ERROR',
                error: 'Please select Date, Description, and Amount columns.',
            });
            return;
        }

        const fullMapping: CSVMapping = {
            dateColumn: state.mapping.dateColumn,
            descriptionColumn: state.mapping.descriptionColumn,
            ...(state.useDebitCredit
                ? {
                      debitColumn: state.mapping.debitColumn,
                      creditColumn: state.mapping.creditColumn,
                  }
                : { amountColumn: state.mapping.amountColumn }),
            ...(state.mapping.transactionTypeColumn !== undefined && {
                transactionTypeColumn: state.mapping.transactionTypeColumn,
            }),
        };

        const fullOptions: CSVImportOptions = {
            dateFormat: state.options.dateFormat || 'M/D/YYYY',
            negativeIsExpense: state.options.negativeIsExpense ?? true,
            hasHeaderRow: state.options.hasHeaderRow ?? true,
            skipRows: state.options.skipRows ?? 0,
        };

        const txns = applyMapping(state.csvContent, fullMapping, fullOptions);
        if (txns.length === 0) {
            dispatch({
                type: 'SET_ERROR',
                error: 'No valid transactions found. Please check your column mappings.',
            });
            return;
        }

        const { categorized, autoCategorizedCount } = applyCategories(
            txns,
            importSettings.categoryMappings
        );
        const dupes = detectDuplicates(categorized, existingTransactions);

        dispatch({
            type: 'PREVIEW_READY',
            transactions: categorized,
            autoCategorizedCount,
            duplicates: dupes,
        });
    }, [
        state.csvContent,
        state.mapping,
        state.options,
        state.useDebitCredit,
        dispatch,
        importSettings,
        existingTransactions,
    ]);

    const handleImport = useCallback(() => {
        if (state.transactions.length === 0) return;

        const toImport = state.transactions.filter(
            (t) => !state.duplicates.some((d) => d.id === t.id)
        );

        // Group by month/year so each transaction lands in the correct snapshot
        const byMonth: Record<string, Transaction[]> = {};
        for (const txn of toImport) {
            const txnDate = new Date(txn.date);
            const month = txnDate.getMonth() + 1;
            const year = txnDate.getFullYear();
            const key = `${year}-${month}`;
            if (!byMonth[key]) byMonth[key] = [];
            byMonth[key].push(txn);
        }

        const monthLabels: string[] = [];
        for (const [key, txns] of Object.entries(byMonth)) {
            const [yearStr, monthStr] = key.split('-');
            const month = parseInt(monthStr, 10);
            const year = parseInt(yearStr, 10);
            const snapshot = getOrCreateMonth(month, year);
            budgetDispatch({
                type: 'BULK_ADD_TRANSACTIONS',
                payload: { monthId: snapshot.id, transactions: txns },
            });
            monthLabels.push(`${MONTH_NAMES[month - 1]} ${year}`);
        }

        const importedCount = toImport.length;
        // A newly-saved CSV format lands on the Settings tab; surface it via the
        // receipt link so the side-effect isn't invisible.
        const savedNewFormat =
            state.saveFormat &&
            state.formatName.trim().length > 0 &&
            !!state.csvContent &&
            !state.matchedFormat;

        if (importedCount > 0) {
            const txnLabel = `${importedCount} transaction${importedCount === 1 ? '' : 's'}`;
            // Name the destination month when everything landed in one; otherwise
            // report the spread without listing every month.
            const monthPart =
                monthLabels.length === 1
                    ? ` to ${monthLabels[0]}`
                    : ` across ${monthLabels.length} months`;
            let message = `Imported ${txnLabel}${monthPart}`;
            if (savedNewFormat) {
                message += ` · saved CSV format "${state.formatName.trim()}"`;
            }
            showReceipt(
                savedNewFormat
                    ? { message, linkTo: '/budget?tab=Settings', linkLabel: 'View Settings' }
                    : { message },
            );
        }

        if (
            state.saveFormat &&
            state.formatName.trim() &&
            state.csvContent &&
            !state.matchedFormat
        ) {
            const fullMapping: CSVMapping = {
                dateColumn: state.mapping.dateColumn!,
                descriptionColumn: state.mapping.descriptionColumn!,
                ...(state.useDebitCredit
                    ? {
                          debitColumn: state.mapping.debitColumn,
                          creditColumn: state.mapping.creditColumn,
                      }
                    : { amountColumn: state.mapping.amountColumn }),
                ...(state.mapping.transactionTypeColumn !== undefined && {
                    transactionTypeColumn: state.mapping.transactionTypeColumn,
                }),
            };

            const fullOptions: CSVImportOptions = {
                dateFormat: state.options.dateFormat || 'M/D/YYYY',
                negativeIsExpense: state.options.negativeIsExpense ?? true,
                hasHeaderRow: state.options.hasHeaderRow ?? true,
                skipRows: state.options.skipRows ?? 0,
            };

            const newFormat: SavedCSVMapping = {
                id: generateMappingId(),
                name: state.formatName.trim(),
                fingerprint: generateFingerprint(state.csvContent.headers),
                mapping: fullMapping,
                options: fullOptions,
                lastUsed: new Date(),
                importCount: 1,
                createdAt: new Date(),
            };

            budgetDispatch({ type: 'ADD_CSV_FORMAT', payload: newFormat });
        } else if (state.matchedFormat) {
            budgetDispatch({
                type: 'UPDATE_CSV_FORMAT',
                payload: {
                    id: state.matchedFormat.id,
                    updates: {
                        lastUsed: new Date(),
                        importCount: state.matchedFormat.importCount + 1,
                    },
                },
            });
        }

        dispatch({ type: 'IMPORT_COMPLETED' });
    }, [state, dispatch, budgetDispatch, getOrCreateMonth, showReceipt]);

    return { processFile, applyMappingAndPreview, handleImport };
}
