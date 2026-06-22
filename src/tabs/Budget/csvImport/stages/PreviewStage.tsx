import React from 'react';
import type { Dispatch } from 'react';
import { formatCurrency } from '../../../../components/Objects/Budget/budgetUtils';
import type { Transaction, SavedCSVMapping } from '../../../../components/Objects/Budget/BudgetContext';
import type { CSVImportAction } from '../csvImportReducer';

import { Button } from "../../../../components/Layout/Primitives";
interface PreviewStageProps {
    transactions: Transaction[];
    duplicates: Transaction[];
    autoCategorizedCount: number;
    matchedFormat: SavedCSVMapping | null;
    matchConfidence: number;
    assignSource: string;
    sourceSuggestions: string[];
    dispatch: Dispatch<CSVImportAction>;
    handleImport: () => void;
}

export const PreviewStage: React.FC<PreviewStageProps> = ({
    transactions,
    duplicates,
    autoCategorizedCount,
    matchedFormat,
    matchConfidence,
    assignSource,
    sourceSuggestions,
    dispatch,
    handleImport,
}) => {
    return (
        <div className="space-y-4">
            {matchedFormat && matchConfidence >= 0.9 && (
                <div className="flex items-center gap-2 text-positive mb-4">
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
                <h4 className="text-sm font-medium text-content-muted mb-2">
                    Preview ({Math.min(5, transactions.length)} of {transactions.length} transactions)
                </h4>
                <div className="overflow-x-auto bg-surface-overlay/50 rounded-lg">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-border-default">
                                <th className="text-left px-3 py-2 text-content-muted">Date</th>
                                <th className="text-left px-3 py-2 text-content-muted">Description</th>
                                <th className="text-right px-3 py-2 text-content-muted">Amount</th>
                            </tr>
                        </thead>
                        <tbody>
                            {transactions.slice(0, 5).map((txn, i) => (
                                <tr key={i} className="border-b border-border-default/50">
                                    <td className="px-3 py-2 text-content-default">
                                        {txn.date.toLocaleDateString()}
                                    </td>
                                    <td className="px-3 py-2 text-white truncate max-w-62.5">
                                        {txn.description}
                                    </td>
                                    <td
                                        className={`px-3 py-2 text-right ${
                                            txn.amount < 0 ? 'text-negative' : 'text-positive'
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

            {/* Source / card tag */}
            <div>
                <label htmlFor="import-source" className="block text-sm font-medium text-content-muted mb-1">
                    Tag as source / card
                </label>
                <input
                    type="text"
                    id="import-source"
                    name="import-source"
                    list="import-source-suggestions"
                    placeholder="e.g. Rewards Card"
                    value={assignSource}
                    onChange={(e) => dispatch({ type: 'SET_ASSIGN_SOURCE', value: e.target.value })}
                    className="w-full bg-surface-overlay border border-border-strong rounded-lg px-3 py-2 text-sm text-white focus:border-accent-soft focus:outline-none"
                />
                <datalist id="import-source-suggestions">
                    {sourceSuggestions.map(s => <option key={s} value={s} />)}
                </datalist>
                <p className="text-xs text-content-subtle mt-1">
                    Stamps every imported transaction with this label so you can reconcile it against a statement. Defaults to the format name; clear it to skip.
                </p>
            </div>

            {/* Summary */}
            <div className="bg-surface-overlay/50 rounded-lg p-4 space-y-2">
                <p className="text-white">
                    <strong>{transactions.length}</strong> transactions found
                </p>
                {autoCategorizedCount > 0 && (
                    <p className="text-content-muted">
                        <span className="text-positive">{autoCategorizedCount}</span> will be
                        auto-categorized
                    </p>
                )}
                {duplicates.length > 0 && (
                    <p className="text-warning">
                        {duplicates.length} possible duplicate(s) detected
                    </p>
                )}
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-3 pt-4">
                <button
                    onClick={() => dispatch({ type: 'EDIT_MAPPING' })}
                    className="px-4 py-2 text-content-muted hover:text-white transition-colors"
                >
                    {matchedFormat ? 'Use Different Format' : 'Back'}
                </button>
                <Button
                    onClick={handleImport}
                    variant="positive" size="lg"
                >
                    Import {transactions.length - duplicates.length} Transactions
                </Button>
            </div>
        </div>
    );
};
