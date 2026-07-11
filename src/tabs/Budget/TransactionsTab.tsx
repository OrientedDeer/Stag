import { useCallback, useContext, useMemo, useState } from 'react';
import type { Transaction } from '../../components/Objects/Budget/BudgetTypes';
import {
    BudgetContext,
    INCOME_CATEGORIES,
    TRANSFER_CATEGORY_ID,
} from '../../components/Objects/Budget/BudgetContext';
import { AccountContext } from '../../components/Objects/Accounts/AccountContext';
import { ExpenseContext } from '../../components/Objects/Expense/ExpenseContext';
import { useAssumptions } from '../../components/Objects/Assumptions/AssumptionsContext';
import { SimulationContext } from '../../components/Objects/Assumptions/SimulationContext';
import {
    formatCurrency,
    calculateNetCashFlow,
    sortTransactionsByDateThenAmount,
    getActiveExpenses,
} from '../../components/Objects/Budget/budgetUtils';

import CSVImportModal from './CSVImportModal';
import {
    groupTransactionsByCategory,
    computeStartingBalances,
    groupContributionsByPriority,
    groupIncomeByCategory,
} from './transactions/utils';
import { getKnownSources } from './reconcile/reconcileUtils';
import { useBulkSelection } from './transactions/useBulkSelection';
import { useCollapsedCategories } from './transactions/useCollapsedCategories';
import { useTransactionEditor } from './transactions/useTransactionEditor';
import { TransactionRow } from './transactions/TransactionRow';
import { CollapsibleSection } from './transactions/CollapsibleSection';
import { ClearAllDialog } from './transactions/ClearAllDialog';
import { AddTransactionForm } from './transactions/AddTransactionForm';
import { Toolbar } from './transactions/Toolbar';

export default function TransactionsTab() {
    const { months, selectedMonth, selectedYear, dispatch, importSettings } = useContext(BudgetContext);
    const { expenses } = useContext(ExpenseContext);
    const { accounts } = useContext(AccountContext);
    const { assumptions } = useAssumptions();
    const priorities = assumptions.priorities;
    const { simulation } = useContext(SimulationContext);

    const editor = useTransactionEditor(selectedMonth, selectedYear);
    const bulk = useBulkSelection();
    const collapse = useCollapsedCategories(selectedMonth, selectedYear, expenses);

    const [showAddForm, setShowAddForm] = useState(false);
    const [showImportModal, setShowImportModal] = useState(false);
    const [showClearConfirm, setShowClearConfirm] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [groupByCategory, setGroupByCategory] = useState(true);
    const [bulkCategory, setBulkCategory] = useState('');
    const [bulkSource, setBulkSource] = useState('');

    // Autocomplete pool for the "source / card" tag: labels already used on
    // transactions plus the user's account names (so an existing account is
    // one click) — deduped and sorted.
    const sourceSuggestions = useMemo(() => {
        const merged = new Set<string>([...getKnownSources(months), ...accounts.map(a => a.name)]);
        return Array.from(merged).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    }, [months, accounts]);

    // Pull expected annual bucket allocations from the simulation. Year 0
    // (current year) is the baseline with empty bucketDetail, so prefer next
    // year's plan; fall back to current year only if it happens to have data.
    const expectedContributions = useMemo(() => {
        const nextYearSim = simulation.find(s => s.year === selectedYear + 1);
        if (nextYearSim?.cashflow.bucketDetail && Object.keys(nextYearSim.cashflow.bucketDetail).length > 0) {
            return nextYearSim.cashflow.bucketDetail;
        }
        const currentYearSim = simulation.find(s => s.year === selectedYear);
        return currentYearSim?.cashflow.bucketDetail || {};
    }, [simulation, selectedYear]);

    const activeExpenses = useMemo(
        () => getActiveExpenses(expenses, selectedMonth, selectedYear),
        [expenses, selectedMonth, selectedYear],
    );

    const transactions = editor.currentSnapshot?.transactions || [];

    const groupedTransactions = useMemo(
        () => groupTransactionsByCategory(transactions, expenses),
        [transactions, expenses],
    );

    const startingBalances = useMemo(
        () => computeStartingBalances(months, selectedYear, priorities, accounts),
        [months, selectedYear, priorities, accounts],
    );

    const contributionGroups = useMemo(
        () => groupContributionsByPriority(
            transactions,
            priorities,
            accounts,
            expectedContributions,
            startingBalances,
            editor.currentSnapshot,
        ),
        [transactions, priorities, accounts, expectedContributions, startingBalances, editor.currentSnapshot],
    );

    const incomeGroups = useMemo(
        () => groupIncomeByCategory(transactions),
        [transactions],
    );

    const cashFlowSummary = useMemo(() => calculateNetCashFlow(transactions), [transactions]);
    const sortedTransactions = useMemo(
        () => [...transactions].sort(sortTransactionsByDateThenAmount),
        [transactions],
    );

    const totalTransactions = transactions.length;
    const uncategorizedCount = groupedTransactions['uncategorized'].transactions.length;
    const totalIncome = cashFlowSummary.income;
    const totalSpending = cashFlowSummary.spending;
    const netCashFlow = cashFlowSummary.net;
    const hasIncome = Object.values(incomeGroups).some(g => g.transactions.length > 0);
    const hasContributions = Object.values(contributionGroups).some(g => g.transactions.length > 0);

    const handleAdd = () => {
        editor.add();
        setShowAddForm(false);
    };

    const handleClearAllConfirm = () => {
        editor.clearAllForMonth();
        setShowClearConfirm(false);
    };

    const handleBulkApply = () => {
        editor.bulkSetCategory(bulk.selectedIds, bulkCategory);
        bulk.clear();
        setBulkCategory('');
    };

    const handleBulkApplySource = () => {
        editor.bulkSetSource(bulk.selectedIds, bulkSource);
        bulk.clear();
        setBulkSource('');
    };

    const handleRowEdit = useCallback((id: string) => setEditingId(id), []);
    const handleRowCancel = useCallback(() => setEditingId(null), []);
    // Alias the (individually memoized) editor method to a plain identifier so
    // the memoization is preserved — `editor` itself is a fresh object each
    // render, so depending on it would recompute this callback every render.
    const updateTransaction = editor.update;
    const handleRowUpdate = useCallback((id: string, updates: Partial<Transaction>) => {
        updateTransaction(id, updates);
        setEditingId(null);
    }, [updateTransaction]);

    const handleToggleGroupBy = useCallback(() => setGroupByCategory(g => !g), []);
    const handleToggleAutoCreateRules = useCallback(
        () => dispatch({ type: 'SET_AUTO_CREATE_RULES', payload: !importSettings.autoCreateRules }),
        [dispatch, importSettings.autoCreateRules],
    );
    const handleClearAllClick = useCallback(() => setShowClearConfirm(true), []);
    const handleImportClick = useCallback(() => setShowImportModal(true), []);
    const handleAddClick = useCallback(() => setShowAddForm(true), []);
    const handleImportClose = useCallback(() => setShowImportModal(false), []);

    const renderRow = (t: Transaction, showCategory: boolean) => (
        <TransactionRow
            key={t.id}
            transaction={t}
            expenses={expenses}
            activeExpenses={activeExpenses}
            accounts={accounts}
            priorities={priorities}
            sourceSuggestions={sourceSuggestions}
            isEditing={editingId === t.id}
            isSelected={bulk.selectedIds.has(t.id)}
            onEdit={handleRowEdit}
            onUpdate={handleRowUpdate}
            onDelete={editor.remove}
            onCancel={handleRowCancel}
            onToggleSelect={bulk.toggle}
            showCategory={showCategory}
        />
    );

    return (
        <div className="space-y-6">
            <Toolbar
                selectedMonth={selectedMonth}
                selectedYear={selectedYear}
                totalTransactions={totalTransactions}
                uncategorizedCount={uncategorizedCount}
                totalIncome={totalIncome}
                totalSpending={totalSpending}
                netCashFlow={netCashFlow}
                groupByCategory={groupByCategory}
                onToggleGroupBy={handleToggleGroupBy}
                allSectionsExpanded={collapse.allExpanded}
                onExpandAll={collapse.expandAll}
                onCollapseAll={collapse.collapseAll}
                autoCreateRules={importSettings.autoCreateRules}
                onToggleAutoCreateRules={handleToggleAutoCreateRules}
                selectedIdsSize={bulk.selectedIds.size}
                bulkCategory={bulkCategory}
                setBulkCategory={setBulkCategory}
                onBulkApply={handleBulkApply}
                bulkSource={bulkSource}
                setBulkSource={setBulkSource}
                onBulkApplySource={handleBulkApplySource}
                sourceSuggestions={sourceSuggestions}
                onClearSelection={bulk.clear}
                activeExpenses={activeExpenses}
                hasAnyTransactions={transactions.length > 0}
                onClearAll={handleClearAllClick}
                onImport={handleImportClick}
                onAdd={handleAddClick}
            />

            {showAddForm && (
                <AddTransactionForm
                    formData={editor.formData}
                    setFormData={editor.setFormData}
                    activeExpenses={activeExpenses}
                    accounts={accounts}
                    priorities={priorities}
                    sourceSuggestions={sourceSuggestions}
                    onSubmit={handleAdd}
                    onCancel={() => setShowAddForm(false)}
                />
            )}

            <CSVImportModal
                isOpen={showImportModal}
                onClose={handleImportClose}
            />

            {showClearConfirm && (
                <ClearAllDialog
                    transactionCount={transactions.length}
                    selectedMonth={selectedMonth}
                    selectedYear={selectedYear}
                    onConfirm={handleClearAllConfirm}
                    onCancel={() => setShowClearConfirm(false)}
                />
            )}

            {transactions.length === 0 ? (
                <div className="bg-info-tint/20 border border-info-strong/50 rounded-lg p-6 text-center">
                    <p className="text-info font-medium mb-2">No transactions yet</p>
                    <p className="text-content-muted text-sm">
                        Add transactions manually or import them from a CSV file.
                    </p>
                </div>
            ) : !groupByCategory ? (
                <div className="bg-surface-overlay rounded-xl border border-border-default overflow-hidden">
                    <div className="divide-y divide-border-default">
                        {sortedTransactions.map(t => renderRow(t, true))}
                    </div>
                </div>
            ) : (
                <div className="space-y-4">
                    {groupedTransactions['uncategorized'].transactions.length > 0 && (
                        <CollapsibleSection
                            theme="yellow"
                            label="Uncategorized"
                            count={groupedTransactions['uncategorized'].transactions.length}
                            headerRight={
                                <span className="text-warning">
                                    {formatCurrency(groupedTransactions['uncategorized'].total, { cents: true })}
                                </span>
                            }
                            collapsed={collapse.collapsed.has('uncategorized')}
                            onToggle={() => collapse.toggle('uncategorized')}
                        >
                            {groupedTransactions['uncategorized'].transactions.map(t => renderRow(t, false))}
                        </CollapsibleSection>
                    )}

                    {hasIncome && (
                        <CollapsibleSection
                            theme="green"
                            label="Income"
                            headerRight={
                                <span className="text-positive">
                                    {formatCurrency(totalIncome, { cents: true })}
                                </span>
                            }
                            collapsed={collapse.collapsed.has('income')}
                            onToggle={() => collapse.toggle('income')}
                        >
                            {INCOME_CATEGORIES.map(cat => {
                                const group = incomeGroups[cat];
                                if (!group || group.transactions.length === 0) return null;
                                return (
                                    <div key={cat} className="divide-y divide-positive-strong/20">
                                        <div className="px-4 py-2 bg-positive-tint/10 flex items-center justify-between">
                                            <span className="text-sm font-medium text-positive-bright">{cat}</span>
                                            <span className="text-sm text-positive">{formatCurrency(group.total, { cents: true })}</span>
                                        </div>
                                        {group.transactions.map(t => renderRow(t, false))}
                                    </div>
                                );
                            })}
                        </CollapsibleSection>
                    )}

                    {groupedTransactions[TRANSFER_CATEGORY_ID].transactions.length > 0 && (
                        <CollapsibleSection
                            theme="transfers"
                            label="Transfers"
                            count={groupedTransactions[TRANSFER_CATEGORY_ID].transactions.length}
                            headerRight={
                                <span className="text-content-muted">
                                    {formatCurrency(groupedTransactions[TRANSFER_CATEGORY_ID].total, { cents: true })}
                                    <span className="text-xs ml-2 text-content-subtle">(not counted)</span>
                                </span>
                            }
                            collapsed={collapse.collapsed.has('transfers')}
                            onToggle={() => collapse.toggle('transfers')}
                        >
                            {groupedTransactions[TRANSFER_CATEGORY_ID].transactions.map(t => renderRow(t, false))}
                        </CollapsibleSection>
                    )}

                    {expenses.map(exp => {
                        const group = groupedTransactions[exp.id];
                        if (!group || group.transactions.length === 0) return null;

                        const hasReimbursements = (group.reimbursements || 0) > 0;

                        return (
                            <CollapsibleSection
                                key={exp.id}
                                theme="expense"
                                label={exp.name}
                                count={group.transactions.length}
                                headerRight={
                                    hasReimbursements ? (
                                        <span className="text-content-muted">
                                            <span className="text-content-subtle">{formatCurrency(group.gross || 0, { cents: true })}</span>
                                            <span className="text-positive mx-1">- {formatCurrency(group.reimbursements || 0, { cents: true })}</span>
                                            <span className="text-white">= {formatCurrency(group.net || 0, { cents: true })} net</span>
                                        </span>
                                    ) : (
                                        <span className="text-content-muted">
                                            {formatCurrency(group.gross || 0, { cents: true })}
                                        </span>
                                    )
                                }
                                collapsed={collapse.collapsed.has(exp.id)}
                                onToggle={() => collapse.toggle(exp.id)}
                            >
                                {group.transactions.map(t => renderRow(t, false))}
                            </CollapsibleSection>
                        );
                    })}

                    {hasContributions && (
                        <CollapsibleSection
                            theme="blue"
                            label="Contributions"
                            headerRight={
                                <span className="text-info">
                                    {formatCurrency(Object.values(contributionGroups).reduce((sum, g) => sum + g.total, 0), { cents: true })}
                                </span>
                            }
                            collapsed={collapse.collapsed.has('contributions')}
                            onToggle={() => collapse.toggle('contributions')}
                        >
                            {priorities.filter(p => p.accountId).map(p => {
                                const group = contributionGroups[p.accountId!];
                                if (!group || group.transactions.length === 0) return null;
                                return (
                                    <div key={p.accountId} className="divide-y divide-info-strong/20">
                                        <div className="px-4 py-2 bg-info-tint/10 flex items-center justify-between">
                                            <div>
                                                <span className="text-sm font-medium text-info-bright">{group.bucketName}</span>
                                                <span className="text-xs text-info/70 ml-2">→ {group.accountName}</span>
                                            </div>
                                            <div className="text-sm text-right">
                                                <span className="text-info">{formatCurrency(group.total, { cents: true })}</span>
                                                <span className="text-info/50 text-xs ml-2">
                                                    / {formatCurrency(group.annualTarget)} annual
                                                </span>
                                            </div>
                                        </div>
                                        {group.transactions.map(t => renderRow(t, false))}
                                    </div>
                                );
                            })}
                        </CollapsibleSection>
                    )}
                </div>
            )}
        </div>
    );
}
