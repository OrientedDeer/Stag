import { memo } from 'react';
import { TRANSFER_CATEGORY_ID } from '../../../components/Objects/Budget/BudgetContext';
import { AnyExpense } from '../../../components/Objects/Expense/models';
import {
    formatCurrency,
    formatMonthYear,
} from '../../../components/Objects/Budget/budgetUtils';
import { Tooltip } from '../../../components/Layout/InputFields/Tooltip';

import { Button } from "../../../components/Layout/Primitives";
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
    bulkSource: string;
    setBulkSource: (value: string) => void;
    onBulkApplySource: () => void;
    sourceSuggestions: string[];
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
    bulkSource,
    setBulkSource,
    onBulkApplySource,
    sourceSuggestions,
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
                        <span className="text-positive">
                            Income: {formatCurrency(totalIncome, { cents: true })}
                        </span>
                    )}
                    {totalSpending > 0 && (
                        <span className="text-content-muted">
                            Spending: {formatCurrency(totalSpending, { cents: true })} (net)
                        </span>
                    )}
                    {(totalIncome > 0 || totalSpending > 0) && (
                        <span className={netCashFlow >= 0 ? 'text-positive' : 'text-negative'}>
                            Net: {netCashFlow >= 0 ? '+' : ''}{formatCurrency(netCashFlow, { cents: true })}
                        </span>
                    )}
                </div>
                <p className="text-sm text-content-subtle">
                    {totalTransactions} transactions
                    {uncategorizedCount > 0 && (
                        <span className="text-warning ml-2">
                            ({uncategorizedCount} uncategorized)
                        </span>
                    )}
                </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap justify-end">
                <div className="flex items-center gap-2 text-sm text-content-muted mr-2">
                    <button
                        type="button"
                        onClick={onToggleGroupBy}
                        className={`relative inline-flex items-center h-5 rounded-full w-9 shrink-0 transition-colors duration-200 ${groupByCategory ? 'bg-positive-solid' : 'bg-surface-hover'}`}
                    >
                        <span className={`inline-block w-3.5 h-3.5 transform bg-white rounded-full transition-transform duration-200 ${groupByCategory ? 'translate-x-4.5' : 'translate-x-0.5'}`} />
                    </button>
                    <span>Group by category</span>
                </div>
                {groupByCategory && hasAnyTransactions && (
                    <button
                        type="button"
                        onClick={allSectionsExpanded ? onCollapseAll : onExpandAll}
                        className="flex items-center gap-1.5 text-sm text-content-muted hover:text-white transition-colors mr-2"
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
                <div className="w-px h-6 bg-surface-input" />
                <div className="flex items-center gap-2 text-sm text-content-muted mr-2">
                    <button
                        type="button"
                        onClick={onToggleAutoCreateRules}
                        className={`relative inline-flex items-center h-5 rounded-full w-9 shrink-0 transition-colors duration-200 ${autoCreateRules ? 'bg-positive-solid' : 'bg-surface-hover'}`}
                    >
                        <span className={`inline-block w-3.5 h-3.5 transform bg-white rounded-full transition-transform duration-200 ${autoCreateRules ? 'translate-x-4.5' : 'translate-x-0.5'}`} />
                    </button>
                    <span>Auto-create rules</span>
                    <Tooltip text="When enabled, categorizing a transaction will automatically create a rule to apply the same category to future transactions with matching descriptions" />
                </div>
                <div className="w-px h-6 bg-surface-input" />
                {selectedIdsSize > 0 && (
                    <>
                        <span className="text-info text-sm font-medium">
                            {selectedIdsSize} selected
                        </span>
                        <select
                            name="bulk-category"
                            value={bulkCategory}
                            onChange={(e) => setBulkCategory(e.target.value)}
                            className="bg-surface-overlay border border-border-strong rounded-lg px-3 py-2 text-sm text-white focus:border-accent-soft focus:outline-none"
                        >
                            <option value="">Uncategorized</option>
                            <option value={TRANSFER_CATEGORY_ID}>Transfer</option>
                            {activeExpenses.map(exp => (
                                <option key={exp.id} value={exp.id}>{exp.name}</option>
                            ))}
                        </select>
                        <Button
                            onClick={onBulkApply}
                            variant="primary" className="text-white"
                        >
                            Apply
                        </Button>
                        <input
                            type="text"
                            name="bulk-source"
                            list="bulk-source-suggestions"
                            placeholder="Source / card"
                            value={bulkSource}
                            onChange={(e) => setBulkSource(e.target.value)}
                            className="w-36 bg-surface-overlay border border-border-strong rounded-lg px-3 py-2 text-sm text-white focus:border-accent-soft focus:outline-none"
                        />
                        <datalist id="bulk-source-suggestions">
                            {sourceSuggestions.map(s => <option key={s} value={s} />)}
                        </datalist>
                        <Button
                            onClick={onBulkApplySource}
                            variant="secondary"
                        >
                            Set source
                        </Button>
                        <button
                            onClick={onClearSelection}
                            className="px-3 py-2 text-content-muted hover:text-white text-sm"
                        >
                            Cancel
                        </button>
                        <div className="w-px h-6 bg-surface-hover" />
                    </>
                )}
                {hasAnyTransactions && (
                    <button
                        onClick={onClearAll}
                        className="px-4 py-2 bg-surface-input hover:bg-negative-solid text-content-default hover:text-white rounded-lg font-medium transition-colors"
                        title="Delete all transactions for this month"
                    >
                        Clear All
                    </button>
                )}
                <Button
                    onClick={onImport}
                    variant="primary" className="text-white flex items-center gap-2"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                        <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12"/>
                    </svg>
                    Import CSV
                </Button>
                <Button
                    onClick={onAdd}
                    variant="positive"
                >
                    Add Transaction
                </Button>
            </div>
        </div>
    );
}

export const Toolbar = memo(ToolbarInner);
