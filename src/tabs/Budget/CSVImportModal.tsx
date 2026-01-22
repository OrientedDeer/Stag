import React, { useState, useCallback, useContext, useMemo } from 'react';
import { BudgetContext, Transaction, SavedCSVMapping } from '../../components/Objects/Budget/BudgetContext';
import { ExpenseContext } from '../../components/Objects/Expense/ExpenseContext';
import { useModalAccessibility } from '../../hooks/useModalAccessibility';
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
    ParsedCSV,
    CSVMapping,
    CSVImportOptions,
} from '../../services/CSVImportService';
import { formatCurrency } from '../../components/Objects/Budget/budgetUtils';
import { DropdownInput } from '../../components/Layout/InputFields/DropdownInput';
import { ToggleInput } from '../../components/Layout/InputFields/ToggleInput';
import { NameInput } from '../../components/Layout/InputFields/NameInput';

type ImportStage = 'upload' | 'mapping' | 'preview' | 'result';

interface CSVImportModalProps {
    isOpen: boolean;
    onClose: () => void;
}

const CSVImportModal: React.FC<CSVImportModalProps> = ({ isOpen, onClose }) => {
    const { modalRef, handleKeyDown } = useModalAccessibility(isOpen, onClose);
    const {
        dispatch,
        getOrCreateMonth,
        selectedMonth,
        selectedYear,
        importSettings,
        months
    } = useContext(BudgetContext);
    const { expenses } = useContext(ExpenseContext);

    // State
    const [stage, setStage] = useState<ImportStage>('upload');
    const [csvContent, setCsvContent] = useState<ParsedCSV | null>(null);
    const [matchedFormat, setMatchedFormat] = useState<SavedCSVMapping | null>(null);
    const [matchConfidence, setMatchConfidence] = useState<number>(0);
    const [transactions, setTransactions] = useState<Transaction[]>([]);
    const [duplicates, setDuplicates] = useState<Transaction[]>([]);
    const [autoCategorizedCount, setAutoCategorizedCount] = useState(0);
    const [error, setError] = useState<string | null>(null);
    const [isDragging, setIsDragging] = useState(false);

    // Mapping form state
    const [formatName, setFormatName] = useState('');
    const [saveFormat, setSaveFormat] = useState(true);
    const [mapping, setMapping] = useState<Partial<CSVMapping>>({});
    const [options, setOptions] = useState<Partial<CSVImportOptions>>({
        dateFormat: 'M/D/YYYY',
        negativeIsExpense: true,
        hasHeaderRow: true,
        skipRows: 0,
    });
    const [useDebitCredit, setUseDebitCredit] = useState(false);

    // Get existing transactions for duplicate detection
    const existingTransactions = useMemo(() => {
        const snapshot = months.find(m => m.month === selectedMonth && m.year === selectedYear);
        return snapshot?.transactions || [];
    }, [months, selectedMonth, selectedYear]);

    // Reset state
    const resetState = useCallback(() => {
        setStage('upload');
        setCsvContent(null);
        setMatchedFormat(null);
        setMatchConfidence(0);
        setTransactions([]);
        setDuplicates([]);
        setAutoCategorizedCount(0);
        setError(null);
        setFormatName('');
        setSaveFormat(true);
        setMapping({});
        setOptions({
            dateFormat: 'M/D/YYYY',
            negativeIsExpense: true,
            hasHeaderRow: true,
            skipRows: 0,
        });
        setUseDebitCredit(false);
    }, []);

    const handleClose = useCallback(() => {
        resetState();
        onClose();
    }, [resetState, onClose]);

    // Process file
    const processFile = useCallback((content: string) => {
        try {
            const csv = parseCSV(content);
            if (csv.rows.length === 0) {
                setError('No data found in CSV file.');
                return;
            }

            setCsvContent(csv);
            const columnDetections = detectColumnTypes(csv);

            // Check for matching saved format
            const match = findMatchingFormat(csv, importSettings.savedCSVFormats);
            if (match && match.confidence >= 0.9) {
                setMatchedFormat(match.mapping);
                setMatchConfidence(match.confidence);

                // Apply the saved mapping
                const txns = applyMapping(csv, match.mapping.mapping as CSVMapping, match.mapping.options);
                const { categorized, autoCategorizedCount: catCount } = applyCategories(txns, importSettings.categoryMappings);
                const dupes = detectDuplicates(categorized, existingTransactions);

                setTransactions(categorized);
                setAutoCategorizedCount(catCount);
                setDuplicates(dupes);
                setStage('preview');
            } else {
                // Need manual mapping
                const suggested = createSuggestedMapping(columnDetections);
                setMapping(suggested.mapping);
                if (suggested.options.dateFormat) {
                    setOptions(prev => ({ ...prev, dateFormat: suggested.options.dateFormat }));
                }
                setUseDebitCredit(
                    suggested.mapping.debitColumn !== undefined &&
                    suggested.mapping.creditColumn !== undefined
                );
                setStage('mapping');
            }
        } catch (e) {
            setError('Failed to parse CSV file. Please check the file format.');
        }
    }, [importSettings, existingTransactions]);

    // Handle file drop
    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
        setError(null);

        const file = e.dataTransfer.files[0];
        if (!file) return;

        if (!file.name.toLowerCase().endsWith('.csv')) {
            setError('Please upload a CSV file.');
            return;
        }

        const reader = new FileReader();
        reader.onload = (event) => {
            const content = event.target?.result as string;
            processFile(content);
        };
        reader.onerror = () => setError('Failed to read file.');
        reader.readAsText(file);
    }, [processFile]);

    // Handle file select
    const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setError(null);

        const reader = new FileReader();
        reader.onload = (event) => {
            const content = event.target?.result as string;
            processFile(content);
        };
        reader.onerror = () => setError('Failed to read file.');
        reader.readAsText(file);
    }, [processFile]);

    // Apply mapping and go to preview
    const applyMappingAndPreview = useCallback(() => {
        if (!csvContent) return;

        const hasAmount = useDebitCredit
            ? mapping.debitColumn !== undefined && mapping.creditColumn !== undefined
            : mapping.amountColumn !== undefined;

        if (mapping.dateColumn === undefined || mapping.descriptionColumn === undefined || !hasAmount) {
            setError('Please select Date, Description, and Amount columns.');
            return;
        }

        const fullMapping: CSVMapping = {
            dateColumn: mapping.dateColumn,
            descriptionColumn: mapping.descriptionColumn,
            ...(useDebitCredit
                ? { debitColumn: mapping.debitColumn, creditColumn: mapping.creditColumn }
                : { amountColumn: mapping.amountColumn }
            ),
            ...(mapping.transactionTypeColumn !== undefined && { transactionTypeColumn: mapping.transactionTypeColumn }),
        };

        const fullOptions: CSVImportOptions = {
            dateFormat: options.dateFormat || 'M/D/YYYY',
            negativeIsExpense: options.negativeIsExpense ?? true,
            hasHeaderRow: options.hasHeaderRow ?? true,
            skipRows: options.skipRows ?? 0,
        };

        const txns = applyMapping(csvContent, fullMapping, fullOptions);
        if (txns.length === 0) {
            setError('No valid transactions found. Please check your column mappings.');
            return;
        }

        const { categorized, autoCategorizedCount: catCount } = applyCategories(txns, importSettings.categoryMappings);
        const dupes = detectDuplicates(categorized, existingTransactions);

        setTransactions(categorized);
        setAutoCategorizedCount(catCount);
        setDuplicates(dupes);
        setError(null);
        setStage('preview');
    }, [csvContent, mapping, options, useDebitCredit, importSettings, existingTransactions]);

    // Import transactions
    const handleImport = useCallback(() => {
        if (transactions.length === 0) return;

        // Filter out duplicates if not including them
        const toImport = transactions.filter(t => !duplicates.some(d => d.id === t.id));

        // Group transactions by month/year based on their date
        const byMonth: Record<string, Transaction[]> = {};
        for (const txn of toImport) {
            const txnDate = new Date(txn.date);
            const month = txnDate.getMonth() + 1; // 1-12
            const year = txnDate.getFullYear();
            const key = `${year}-${month}`;

            if (!byMonth[key]) {
                byMonth[key] = [];
            }
            byMonth[key].push(txn);
        }

        // Add transactions to the correct month snapshots
        for (const [key, txns] of Object.entries(byMonth)) {
            const [yearStr, monthStr] = key.split('-');
            const month = parseInt(monthStr, 10);
            const year = parseInt(yearStr, 10);

            const snapshot = getOrCreateMonth(month, year);
            dispatch({
                type: 'BULK_ADD_TRANSACTIONS',
                payload: { monthId: snapshot.id, transactions: txns },
            });
        }

        // Save format mapping if requested
        if (saveFormat && formatName.trim() && csvContent && !matchedFormat) {
            const fullMapping: CSVMapping = {
                dateColumn: mapping.dateColumn!,
                descriptionColumn: mapping.descriptionColumn!,
                ...(useDebitCredit
                    ? { debitColumn: mapping.debitColumn, creditColumn: mapping.creditColumn }
                    : { amountColumn: mapping.amountColumn }
                ),
                ...(mapping.transactionTypeColumn !== undefined && { transactionTypeColumn: mapping.transactionTypeColumn }),
            };

            const fullOptions: CSVImportOptions = {
                dateFormat: options.dateFormat || 'M/D/YYYY',
                negativeIsExpense: options.negativeIsExpense ?? true,
                hasHeaderRow: options.hasHeaderRow ?? true,
                skipRows: options.skipRows ?? 0,
            };

            const newFormat: SavedCSVMapping = {
                id: generateMappingId(),
                name: formatName.trim(),
                fingerprint: generateFingerprint(csvContent.headers),
                mapping: fullMapping,
                options: fullOptions,
                lastUsed: new Date(),
                importCount: 1,
                createdAt: new Date(),
            };

            dispatch({ type: 'ADD_CSV_FORMAT', payload: newFormat });
        } else if (matchedFormat) {
            // Update last used and count for existing format
            dispatch({
                type: 'UPDATE_CSV_FORMAT',
                payload: {
                    id: matchedFormat.id,
                    updates: {
                        lastUsed: new Date(),
                        importCount: matchedFormat.importCount + 1,
                    },
                },
            });
        }

        setStage('result');
    }, [transactions, duplicates, getOrCreateMonth, selectedMonth, selectedYear, dispatch, saveFormat, formatName, csvContent, matchedFormat, mapping, options, useDebitCredit]);

    // Column options for dropdowns
    const columnOptions = useMemo(() => {
        if (!csvContent) return [];
        return csvContent.headers.map((header, index) => ({
            value: String(index),
            label: header || `Column ${index + 1}`,
        }));
    }, [csvContent]);

    // Category breakdown for results
    const categoryBreakdown = useMemo(() => {
        const breakdown: Record<string, { name: string; count: number }> = {};
        for (const txn of transactions) {
            if (txn.expenseId) {
                if (!breakdown[txn.expenseId]) {
                    const exp = expenses.find(e => e.id === txn.expenseId);
                    breakdown[txn.expenseId] = { name: exp?.name || 'Unknown', count: 0 };
                }
                breakdown[txn.expenseId].count++;
            }
        }
        return Object.values(breakdown);
    }, [transactions, expenses]);

    if (!isOpen) return null;

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
        >
            <div
                ref={modalRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby="csv-import-modal-title"
                className="bg-gray-900 border border-gray-800 rounded-2xl shadow-2xl max-h-[90vh] overflow-y-auto text-white w-full max-w-2xl"
                onKeyDown={handleKeyDown}
            >
                {/* Header */}
                <div className="sticky top-0 bg-gray-900 border-b border-gray-800 px-6 py-4 flex items-center justify-between">
                    <h2 id="csv-import-modal-title" className="text-xl font-bold text-white">
                        Import Transactions
                    </h2>
                    <button
                        onClick={handleClose}
                        className="text-gray-400 hover:text-white transition-colors p-1"
                        aria-label="Close"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                            <path d="M18 6L6 18M6 6l12 12"/>
                        </svg>
                    </button>
                </div>

                <div className="p-6">
                    {/* Error Display */}
                    {error && (
                        <div className="mb-4 bg-red-900/20 border border-red-800 rounded-lg p-3 text-red-400 text-sm">
                            {error}
                        </div>
                    )}

                    {/* Stage: Upload */}
                    {stage === 'upload' && (
                        <div>
                            <div
                                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                                onDragLeave={() => setIsDragging(false)}
                                onDrop={handleDrop}
                                className={`
                                    border-2 border-dashed rounded-xl p-12 text-center transition-colors cursor-pointer
                                    ${isDragging ? 'border-green-500 bg-green-500/10' : 'border-gray-700 hover:border-gray-500'}
                                `}
                                onClick={() => document.getElementById('csv-file-input')?.click()}
                            >
                                <input
                                    id="csv-file-input"
                                    type="file"
                                    accept=".csv"
                                    onChange={handleFileSelect}
                                    className="hidden"
                                />
                                <div className="text-gray-400 mb-2">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" className="mx-auto mb-4">
                                        <path d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"/>
                                    </svg>
                                    <p className="text-lg font-medium">Drop CSV file here or click to browse</p>
                                </div>
                                <p className="text-gray-500 text-sm mt-2">
                                    Supported: Chase, Checking, Bank of America, or any CSV
                                </p>
                            </div>

                            {importSettings.savedCSVFormats.length > 0 && (
                                <div className="mt-6">
                                    <p className="text-sm text-gray-400 mb-2">
                                        Previously recognized formats: {importSettings.savedCSVFormats.map(f => f.name).join(', ')}
                                    </p>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Stage: Mapping */}
                    {stage === 'mapping' && csvContent && (
                        <div className="space-y-6">
                            <div>
                                <h3 className="text-lg font-semibold mb-4">Map Your CSV Columns</h3>

                                {/* Preview Table */}
                                <div className="overflow-x-auto mb-6">
                                    <table className="w-full text-sm">
                                        <thead>
                                            <tr className="border-b border-gray-700">
                                                {csvContent.headers.map((header, i) => (
                                                    <th key={i} className="text-left px-2 py-2 text-gray-400 font-medium">
                                                        {header}
                                                    </th>
                                                ))}
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {csvContent.rows.slice(0, 3).map((row, rowIndex) => (
                                                <tr key={rowIndex} className="border-b border-gray-800">
                                                    {row.map((cell, cellIndex) => (
                                                        <td key={cellIndex} className="px-2 py-2 text-gray-300 truncate max-w-[150px]">
                                                            {cell || '-'}
                                                        </td>
                                                    ))}
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>

                                {/* Column Mapping */}
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <DropdownInput
                                        id="date-column"
                                        label="Date Column"
                                        value={mapping.dateColumn !== undefined ? String(mapping.dateColumn) : ''}
                                        onChange={(val) => setMapping(prev => ({ ...prev, dateColumn: parseInt(val, 10) }))}
                                        options={columnOptions}
                                    />
                                    <DropdownInput
                                        id="desc-column"
                                        label="Description Column"
                                        value={mapping.descriptionColumn !== undefined ? String(mapping.descriptionColumn) : ''}
                                        onChange={(val) => setMapping(prev => ({ ...prev, descriptionColumn: parseInt(val, 10) }))}
                                        options={columnOptions}
                                    />

                                    <div className="col-span-full">
                                        <ToggleInput
                                            id="use-debit-credit"
                                            label="Separate Debit/Credit Columns"
                                            enabled={useDebitCredit}
                                            setEnabled={setUseDebitCredit}
                                            tooltip="Enable if your CSV has separate columns for debits and credits instead of a single amount column"
                                        />
                                    </div>

                                    {useDebitCredit ? (
                                        <>
                                            <DropdownInput
                                                id="debit-column"
                                                label="Debit Column"
                                                value={mapping.debitColumn !== undefined ? String(mapping.debitColumn) : ''}
                                                onChange={(val) => setMapping(prev => ({ ...prev, debitColumn: parseInt(val, 10) }))}
                                                options={columnOptions}
                                            />
                                            <DropdownInput
                                                id="credit-column"
                                                label="Credit Column"
                                                value={mapping.creditColumn !== undefined ? String(mapping.creditColumn) : ''}
                                                onChange={(val) => setMapping(prev => ({ ...prev, creditColumn: parseInt(val, 10) }))}
                                                options={columnOptions}
                                            />
                                        </>
                                    ) : (
                                        <>
                                            <DropdownInput
                                                id="amount-column"
                                                label="Amount Column"
                                                value={mapping.amountColumn !== undefined ? String(mapping.amountColumn) : ''}
                                                onChange={(val) => setMapping(prev => ({ ...prev, amountColumn: parseInt(val, 10) }))}
                                                options={columnOptions}
                                            />
                                            <DropdownInput
                                                id="transaction-type-column"
                                                label="Transaction Type Column"
                                                value={mapping.transactionTypeColumn !== undefined ? String(mapping.transactionTypeColumn) : '__NONE__'}
                                                onChange={(val) => setMapping(prev => ({
                                                    ...prev,
                                                    transactionTypeColumn: val === '__NONE__' ? undefined : parseInt(val, 10)
                                                }))}
                                                options={[{ value: '__NONE__', label: 'None (use amount sign)' }, ...columnOptions]}
                                                tooltip="Optional: Column that says Credit or Debit (e.g., Checking)"
                                            />
                                        </>
                                    )}

                                    {!useDebitCredit && mapping.transactionTypeColumn === undefined && (
                                        <ToggleInput
                                            id="negative-expense"
                                            label="Negative = Expense"
                                            enabled={options.negativeIsExpense ?? true}
                                            setEnabled={(val) => setOptions(prev => ({ ...prev, negativeIsExpense: val }))}
                                            tooltip="Check if negative amounts represent expenses (common for bank statements)"
                                        />
                                    )}
                                </div>

                                {/* Save Format Option */}
                                <div className="mt-6 pt-4 border-t border-gray-800">
                                    <ToggleInput
                                        id="save-format"
                                        label="Remember this mapping for future imports"
                                        enabled={saveFormat}
                                        setEnabled={setSaveFormat}
                                    />
                                    {saveFormat && (
                                        <div className="mt-3">
                                            <NameInput
                                                id="format-name"
                                                label="Format Name"
                                                value={formatName}
                                                onChange={setFormatName}
                                                placeholder="e.g., Chase Checking"
                                            />
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Actions */}
                            <div className="flex justify-end gap-3">
                                <button
                                    onClick={() => setStage('upload')}
                                    className="px-4 py-2 text-gray-400 hover:text-white transition-colors"
                                >
                                    Back
                                </button>
                                <button
                                    onClick={applyMappingAndPreview}
                                    className="px-5 py-2.5 bg-green-600 hover:bg-green-500 text-white rounded-lg font-medium transition-colors"
                                >
                                    Preview Import
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Stage: Preview */}
                    {stage === 'preview' && (
                        <div className="space-y-4">
                            {matchedFormat && matchConfidence >= 0.9 && (
                                <div className="flex items-center gap-2 text-green-400 mb-4">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                                        <path d="M20 6L9 17l-5-5"/>
                                    </svg>
                                    <span>Detected: {matchedFormat.name}</span>
                                </div>
                            )}

                            {/* Preview Table */}
                            <div>
                                <h4 className="text-sm font-medium text-gray-400 mb-2">
                                    Preview ({Math.min(5, transactions.length)} of {transactions.length} transactions)
                                </h4>
                                <div className="overflow-x-auto bg-gray-800/50 rounded-lg">
                                    <table className="w-full text-sm">
                                        <thead>
                                            <tr className="border-b border-gray-700">
                                                <th className="text-left px-3 py-2 text-gray-400">Date</th>
                                                <th className="text-left px-3 py-2 text-gray-400">Description</th>
                                                <th className="text-right px-3 py-2 text-gray-400">Amount</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {transactions.slice(0, 5).map((txn, i) => (
                                                <tr key={i} className="border-b border-gray-700/50">
                                                    <td className="px-3 py-2 text-gray-300">
                                                        {txn.date.toLocaleDateString()}
                                                    </td>
                                                    <td className="px-3 py-2 text-white truncate max-w-[250px]">
                                                        {txn.description}
                                                    </td>
                                                    <td className={`px-3 py-2 text-right ${txn.amount < 0 ? 'text-red-400' : 'text-green-400'}`}>
                                                        {formatCurrency(Math.abs(txn.amount))}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>

                            {/* Summary */}
                            <div className="bg-gray-800/50 rounded-lg p-4 space-y-2">
                                <p className="text-white">
                                    <strong>{transactions.length}</strong> transactions found
                                </p>
                                {autoCategorizedCount > 0 && (
                                    <p className="text-gray-400">
                                        <span className="text-green-400">{autoCategorizedCount}</span> will be auto-categorized
                                    </p>
                                )}
                                {duplicates.length > 0 && (
                                    <p className="text-yellow-400">
                                        {duplicates.length} possible duplicate(s) detected
                                    </p>
                                )}
                            </div>

                            {/* Actions */}
                            <div className="flex justify-end gap-3 pt-4">
                                <button
                                    onClick={() => {
                                        if (matchedFormat) {
                                            // Initialize mapping state with the matched format's values
                                            setMapping(matchedFormat.mapping);
                                            setOptions(matchedFormat.options);
                                            setUseDebitCredit(
                                                matchedFormat.mapping.debitColumn !== undefined &&
                                                matchedFormat.mapping.creditColumn !== undefined
                                            );
                                            setFormatName(matchedFormat.name);
                                            setMatchedFormat(null); // Clear so we can save as new format
                                        }
                                        setStage('mapping');
                                    }}
                                    className="px-4 py-2 text-gray-400 hover:text-white transition-colors"
                                >
                                    {matchedFormat ? 'Use Different Format' : 'Back'}
                                </button>
                                <button
                                    onClick={handleImport}
                                    className="px-5 py-2.5 bg-green-600 hover:bg-green-500 text-white rounded-lg font-medium transition-colors"
                                >
                                    Import {transactions.length - duplicates.length} Transactions
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Stage: Result */}
                    {stage === 'result' && (
                        <div className="space-y-4 text-center">
                            <div className="text-green-400 mb-4">
                                <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" className="mx-auto mb-2">
                                    <path d="M20 6L9 17l-5-5"/>
                                </svg>
                                <h3 className="text-xl font-semibold">Import Complete</h3>
                            </div>

                            <p className="text-white text-lg">
                                {transactions.length - duplicates.length} transactions imported
                            </p>

                            {categoryBreakdown.length > 0 && (
                                <div className="bg-gray-800/50 rounded-lg p-4 text-left">
                                    <h4 className="text-sm font-medium text-gray-400 mb-2">Auto-categorized:</h4>
                                    <ul className="space-y-1 text-sm">
                                        {categoryBreakdown.map((cat, i) => (
                                            <li key={i} className="text-gray-300">
                                                <span className="text-green-400">{cat.count}</span> &rarr; {cat.name}
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}

                            {transactions.length - autoCategorizedCount > 0 && (
                                <p className="text-gray-400">
                                    {transactions.length - autoCategorizedCount - duplicates.length} transactions need categorization
                                </p>
                            )}

                            <div className="flex justify-center gap-3 pt-4">
                                <button
                                    onClick={handleClose}
                                    className="px-5 py-2.5 bg-gray-700 hover:bg-gray-600 text-white rounded-lg font-medium transition-colors"
                                >
                                    Done
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default CSVImportModal;
