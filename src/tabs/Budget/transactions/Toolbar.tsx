import { memo } from 'react';
import { TRANSFER_CATEGORY_ID } from '../../../components/Objects/Budget/BudgetContext';
import { AnyExpense } from '../../../components/Objects/Expense/models';
import {
    formatCurrency,
    formatMonthYear,
} from '../../../components/Objects/Budget/budgetUtils';
import { Tooltip } from '../../../components/Layout/InputFields/Tooltip';

interface ToolbarProps {
    selectedMonth: number;
    selectedYear: number;
    totalTransactions: number;
    uncategorizedCount: number;
    totalIncome: number;
    totalSpending: number;
    netCashFlow: number;
    groupByCategory: boolean;
    onToggleGroupBy: () => void;
    allSectionsExpanded: boolean;
    onExpandAll: () => void;
    onCollapseAll: () => void;
    autoCreateRules: boolean;
    onToggleAutoCreateRules: () => void;
    selectedIdsSize: number;
    bulkCategory: string;
    setBulkCategory: (value: string) => void;
    onBulkApply: () => void;
    onClearSelection: () => void;
    activeExpenses: AnyExpense[];
    hasAnyTransactions: boolean;
    onClearAll: () => void;
    onImport: () => void;
    onAdd: () => void;
}

/**
 * Header for the transactions tab: month / stats on the left, toggles + bulk
 * actions + the main CTAs on the right. Pure presentational — state lives
 * in the parent / hooks.
 */
function ToolbarInner({
    selectedMonth,
    selectedYear,
    totalTransactions,
    uncategorizedCount,
    totalIncome,
    totalSpending,
    netCashFlow,
    groupByCategory,
    onToggleGroupBy,
    allSectionsExpanded,
    onExpandAll,
    onCollapseAll,
    autoCreateRules,
    onToggleAutoCreateRules,
    selectedIdsSize,
    bulkCategory,
    setBulkCategory,
    onBulkApply,
    onClearSelection,
    activeExpenses,
    hasAnyTransactions,
    onClearAll,
    onImport,
    onAdd,
}: ToolbarProps) {
    return (
        <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
                <h3 className="text-lg font-semibold text-white">
                    Transactions for {formatMonthYear(selectedMonth, selectedYear)}
                </h3>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                    {totalIncome > 0 && (
                        <span className="text-green-400">
                            Income: {formatCurrency(totalIncome, { cents: true })}
                        </span>
                    )}
                    {totalSpending > 0 && (
                        <span className="text-gray-400">
                            Spending: {formatCurrency(totalSpending, { cents: true })} (net)
                        </span>
                    )}
                    {(totalIncome > 0 || totalSpending > 0) && (
                        <span className={netCashFlow >= 0 ? 'text-green-400' : 'text-red-400'}>
                            Net: {netCashFlow >= 0 ? '+' : ''}{formatCurrency(netCashFlow, { cents: true })}
                        </span>
                    )}
                </div>
                <p className="text-sm text-gray-500">
                    {totalTransactions} transactions
                    {uncategorizedCount > 0 && (
                        <span className="text-yellow-400 ml-2">
                            ({uncategorizedCount} uncategorized)
                        </span>
                    )}
                </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap justify-end">
                <div className="flex items-center gap-2 text-sm text-gray-400 mr-2">
                    <button
                        type="button"
                        onClick={onToggleGroupBy}
                        className={`relative inline-flex items-center h-5 rounded-full w-9 shrink-0 transition-colors duration-200 ${groupByCategory ? 'bg-green-600' : 'bg-gray-600'}`}
                    >
                        <span className={`inline-block w-3.5 h-3.5 transform bg-white rounded-full transition-transform duration-200 ${groupByCategory ? 'translate-x-4.5' : 'translate-x-0.5'}`} />
                    </button>
                    <span>Group by category</span>
                </div>
                {groupByCategory && hasAnyTransactions && (
                    <button
                        type="button"
                        onClick={allSectionsExpanded ? onCollapseAll : onExpandAll}
                        className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-white transition-colors mr-2"
                        title={allSectionsExpanded ? 'Collapse all sections' : 'Expand all sections'}
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                            {allSectionsExpanded ? (
                                <path d="M18 15l-6-6-6 6" />
                            ) : (
                                <path d="M6 9l6 6 6-6" />
                            )}
                        </svg>
                        {allSectionsExpanded ? 'Collapse all' : 'Expand all'}
                    </button>
                )}
                <div className="w-px h-6 bg-gray-700" />
                <div className="flex items-center gap-2 text-sm text-gray-400 mr-2">
                    <button
                        type="button"
                        onClick={onToggleAutoCreateRules}
                        className={`relative inline-flex items-center h-5 rounded-full w-9 shrink-0 transition-colors duration-200 ${autoCreateRules ? 'bg-green-600' : 'bg-gray-600'}`}
                    >
                        <span className={`inline-block w-3.5 h-3.5 transform bg-white rounded-full transition-transform duration-200 ${autoCreateRules ? 'translate-x-4.5' : 'translate-x-0.5'}`} />
                    </button>
                    <span>Auto-create rules</span>
                    <Tooltip text="When enabled, categorizing a transaction will automatically create a rule to apply the same category to future transactions with matching descriptions" />
                </div>
                <div className="w-px h-6 bg-gray-700" />
                {selectedIdsSize > 0 && (
                    <>
                        <span className="text-blue-400 text-sm font-medium">
                            {selectedIdsSize} selected
                        </span>
                        <select
                            name="bulk-category"
                            value={bulkCategory}
                            onChange={(e) => setBulkCategory(e.target.value)}
                            className="bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
                        >
                            <option value="">Uncategorized</option>
                            <option value={TRANSFER_CATEGORY_ID}>Transfer</option>
                            {activeExpenses.map(exp => (
                                <option key={exp.id} value={exp.id}>{exp.name}</option>
                            ))}
                        </select>
                        <button
                            onClick={onBulkApply}
                            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-medium transition-colors text-sm"
                        >
                            Apply
                        </button>
                        <button
                            onClick={onClearSelection}
                            className="px-3 py-2 text-gray-400 hover:text-white text-sm"
                        >
                            Cancel
                        </button>
                        <div className="w-px h-6 bg-gray-600" />
                    </>
                )}
                {hasAnyTransactions && (
                    <button
                        onClick={onClearAll}
                        className="px-4 py-2 bg-gray-700 hover:bg-red-600 text-gray-300 hover:text-white rounded-lg font-medium transition-colors"
                        title="Delete all transactions for this month"
                    >
                        Clear All
                    </button>
                )}
                <button
                    onClick={onImport}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-medium transition-colors flex items-center gap-2"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                        <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12"/>
                    </svg>
                    Import CSV
                </button>
                <button
                    onClick={onAdd}
                    className="px-4 py-2 bg-green-600 hover:bg-green-500 text-white rounded-lg font-medium transition-colors"
                >
                    Add Transaction
                </button>
            </div>
        </div>
    );
}

export const Toolbar = memo(ToolbarInner);
