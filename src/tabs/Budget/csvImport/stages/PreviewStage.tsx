import React from 'react';
import type { Dispatch } from 'react';
import { formatCurrency } from '../../../../components/Objects/Budget/budgetUtils';
import type { Transaction, SavedCSVMapping } from '../../../../components/Objects/Budget/BudgetContext';
import type { CSVImportAction } from '../csvImportReducer';

interface PreviewStageProps {
    transactions: Transaction[];
    duplicates: Transaction[];
    autoCategorizedCount: number;
    matchedFormat: SavedCSVMapping | null;
    matchConfidence: number;
    dispatch: Dispatch<CSVImportAction>;
    handleImport: () => void;
}

export const PreviewStage: React.FC<PreviewStageProps> = ({
    transactions,
    duplicates,
    autoCategorizedCount,
    matchedFormat,
    matchConfidence,
    dispatch,
    handleImport,
}) => {
    return (
        <div className="space-y-4">
            {matchedFormat && matchConfidence >= 0.9 && (
                <div className="flex items-center gap-2 text-green-400 mb-4">
                    <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="20"
                        height="20"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        viewBox="0 0 24 24"
                    >
                        <path d="M20 6L9 17l-5-5" />
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
                                    <td className="px-3 py-2 text-white truncate max-w-62.5">
                                        {txn.description}
                                    </td>
                                    <td
                                        className={`px-3 py-2 text-right ${
                                            txn.amount < 0 ? 'text-red-400' : 'text-green-400'
                                        }`}
                                    >
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
                        <span className="text-green-400">{autoCategorizedCount}</span> will be
                        auto-categorized
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
                    onClick={() => dispatch({ type: 'EDIT_MAPPING' })}
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
    );
};
