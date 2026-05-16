import React, { useMemo } from 'react';
import type { Transaction } from '../../../../components/Objects/Budget/BudgetContext';
import type { AnyExpense } from '../../../../components/Objects/Expense/models';

interface ResultStageProps {
    transactions: Transaction[];
    duplicates: Transaction[];
    autoCategorizedCount: number;
    expenses: AnyExpense[];
    onClose: () => void;
}

export const ResultStage: React.FC<ResultStageProps> = ({
    transactions,
    duplicates,
    autoCategorizedCount,
    expenses,
    onClose,
}) => {
    const categoryBreakdown = useMemo(() => {
        const breakdown: Record<string, { name: string; count: number }> = {};
        for (const txn of transactions) {
            if (txn.expenseId) {
                if (!breakdown[txn.expenseId]) {
                    const exp = expenses.find((e) => e.id === txn.expenseId);
                    breakdown[txn.expenseId] = { name: exp?.name || 'Unknown', count: 0 };
                }
                breakdown[txn.expenseId].count++;
            }
        }
        return Object.values(breakdown);
    }, [transactions, expenses]);

    const importedCount = transactions.length - duplicates.length;
    const uncategorizedCount = transactions.length - autoCategorizedCount - duplicates.length;

    return (
        <div className="space-y-4 text-center">
            <div className="text-green-400 mb-4">
                <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="48"
                    height="48"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    viewBox="0 0 24 24"
                    className="mx-auto mb-2"
                >
                    <path d="M20 6L9 17l-5-5" />
                </svg>
                <h3 className="text-xl font-semibold">Import Complete</h3>
            </div>

            <p className="text-white text-lg">{importedCount} transactions imported</p>

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

            {uncategorizedCount > 0 && (
                <p className="text-gray-400">
                    {uncategorizedCount} transactions need categorization
                </p>
            )}

            <div className="flex justify-center gap-3 pt-4">
                <button
                    onClick={onClose}
                    className="px-5 py-2.5 bg-gray-700 hover:bg-gray-600 text-white rounded-lg font-medium transition-colors"
                >
                    Done
                </button>
            </div>
        </div>
    );
};
