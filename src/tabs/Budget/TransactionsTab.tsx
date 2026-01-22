import { useContext, useMemo, useState, useCallback, useEffect } from 'react';
import { BudgetContext, Transaction, TRANSFER_CATEGORY_ID, INCOME_CATEGORIES, IncomeCategory } from '../../components/Objects/Budget/BudgetContext';
import { AccountContext } from '../../components/Objects/Accounts/AccountContext';
import { ExpenseContext } from '../../components/Objects/Expense/ExpenseContext';
import { useAssumptions } from '../../components/Objects/Assumptions/AssumptionsContext';
import { SimulationContext } from '../../components/Objects/Assumptions/SimulationContext';
import {
    formatCurrency,
    formatMonthYear,
    calculateNetCashFlow,
    sortTransactionsByDateThenAmount,
} from '../../components/Objects/Budget/budgetUtils';
import { Tooltip } from '../../components/Layout/InputFields/Tooltip';
import { ChevronIcon } from '../../components/Layout/Icons/ChevronIcon';
import CSVImportModal from './CSVImportModal';

// Special prefix for contribution categories
const CONTRIBUTION_PREFIX = '__CONTRIB__';

export default function TransactionsTab() {
    const { months, selectedMonth, selectedYear, dispatch, getOrCreateMonth, importSettings } = useContext(BudgetContext);
    const { expenses } = useContext(ExpenseContext);
    const { accounts } = useContext(AccountContext);
    const { assumptions } = useAssumptions();
    const priorities = assumptions.priorities;
    const { simulation } = useContext(SimulationContext);

    // Get expected contributions from simulation for display
    // Note: Year 0 (current year) is baseline and has empty bucketDetail
    // We need to look at Year 1+ to get the projected allocations
    const expectedContributions = useMemo(() => {
        // First try the next year (Year 1 in simulation terms)
        const nextYearSim = simulation.find(s => s.year === selectedYear + 1);
        if (nextYearSim?.cashflow.bucketDetail && Object.keys(nextYearSim.cashflow.bucketDetail).length > 0) {
            return nextYearSim.cashflow.bucketDetail;
        }
        // Fall back to current year if it has data
        const currentYearSim = simulation.find(s => s.year === selectedYear);
        return currentYearSim?.cashflow.bucketDetail || {};
    }, [simulation, selectedYear]);

    const [showAddForm, setShowAddForm] = useState(false);
    const [showImportModal, setShowImportModal] = useState(false);
    const [showClearConfirm, setShowClearConfirm] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [bulkCategory, setBulkCategory] = useState('');
    const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
    const [groupByCategory, setGroupByCategory] = useState(true);

    // For older months, collapse all categories by default
    useEffect(() => {
        const now = new Date();
        const currentMonth = now.getMonth() + 1;
        const currentYear = now.getFullYear();
        const isOlderMonth = selectedYear < currentYear ||
            (selectedYear === currentYear && selectedMonth < currentMonth);

        if (isOlderMonth) {
            // Collapse all categories for older months
            const allCategoryIds = new Set([
                'uncategorized',
                'income',
                'transfers',
                'contributions',
                ...expenses.map(e => e.id),
            ]);
            setCollapsedCategories(allCategoryIds);
        } else {
            // Expand all for current/future months
            setCollapsedCategories(new Set());
        }
    }, [selectedMonth, selectedYear, expenses]);

    const toggleCategoryCollapse = useCallback((categoryId: string) => {
        setCollapsedCategories(prev => {
            const next = new Set(prev);
            if (next.has(categoryId)) {
                next.delete(categoryId);
            } else {
                next.add(categoryId);
            }
            return next;
        });
    }, []);

    // Form state
    const [formData, setFormData] = useState({
        description: '',
        amount: '',
        expenseId: '',
        date: new Date().toISOString().split('T')[0],
        isCredit: false,
        creditType: 'income' as 'income' | 'reimbursement' | 'transfer',
        incomeCategory: '' as IncomeCategory | '',
    });

    const currentSnapshot = useMemo(() =>
        months.find(m => m.month === selectedMonth && m.year === selectedYear),
        [months, selectedMonth, selectedYear]
    );

    const transactions = useMemo(() =>
        currentSnapshot?.transactions || [],
        [currentSnapshot]
    );

    // Group transactions by expense category, income category, and track reimbursements
    const groupedTransactions = useMemo(() => {
        const groups: Record<string, {
            expense: typeof expenses[0] | null;
            transactions: Transaction[];
            total: number;
            gross?: number;
            reimbursements?: number;
            net?: number;
            isTransfer?: boolean;
        }> = {};

        // Initialize with uncategorized and transfers
        groups['uncategorized'] = { expense: null, transactions: [], total: 0 };
        groups[TRANSFER_CATEGORY_ID] = { expense: null, transactions: [], total: 0, isTransfer: true };

        // Initialize expense groups
        expenses.forEach(exp => {
            groups[exp.id] = { expense: exp, transactions: [], total: 0, gross: 0, reimbursements: 0, net: 0 };
        });

        // Group transactions (expenses and reimbursements go to expense categories)
        transactions.forEach(t => {
            // Contributions with targetAccountId are handled in contributionGroups
            if (t.targetAccountId) {
                return;
            }

            if (t.isTransfer) {
                groups[TRANSFER_CATEGORY_ID].transactions.push(t);
                groups[TRANSFER_CATEGORY_ID].total += Math.abs(t.amount);
            } else if (t.amount > 0 && !t.isReimbursement && t.incomeCategory) {
                // True income - handled separately in incomeGroups
                return;
            } else if (t.expenseId) {
                // Expense or credit with a category
                if (groups[t.expenseId]) {
                    groups[t.expenseId].transactions.push(t);
                    if (t.amount < 0) {
                        groups[t.expenseId].gross = (groups[t.expenseId].gross || 0) + Math.abs(t.amount);
                    } else {
                        // Any positive amount with expenseId is a credit that offsets spending
                        groups[t.expenseId].reimbursements = (groups[t.expenseId].reimbursements || 0) + t.amount;
                    }
                    groups[t.expenseId].total += Math.abs(t.amount);
                } else {
                    groups['uncategorized'].transactions.push(t);
                    groups['uncategorized'].total += Math.abs(t.amount);
                }
            } else {
                // Uncategorized
                groups['uncategorized'].transactions.push(t);
                groups['uncategorized'].total += Math.abs(t.amount);
            }
        });

        // Calculate net for expense categories
        Object.values(groups).forEach(group => {
            if (group.gross !== undefined) {
                group.net = group.gross - (group.reimbursements || 0);
            }
        });

        // Sort transactions within each group by date (newest first), then by amount (largest first)
        Object.values(groups).forEach(group => {
            group.transactions.sort(sortTransactionsByDateThenAmount);
        });

        return groups;
    }, [transactions, expenses]);

    // Get starting balances for contribution tracking (from balance history)
    const startingBalances = useMemo(() => {
        const balances: Record<string, number> = {};

        // Look for December of previous year or January of current year
        const decSnapshot = months.find(m => m.month === 12 && m.year === selectedYear - 1);
        const janSnapshot = months.find(m => m.month === 1 && m.year === selectedYear);

        priorities.filter(p => p.accountId).forEach(p => {
            const accountId = p.accountId!;
            if (decSnapshot?.accountBalances[accountId] !== undefined) {
                balances[accountId] = decSnapshot.accountBalances[accountId];
            } else if (janSnapshot?.accountBalances[accountId] !== undefined) {
                balances[accountId] = janSnapshot.accountBalances[accountId];
            } else {
                const account = accounts.find(a => a.id === accountId);
                balances[accountId] = account?.amount || 0;
            }
        });

        return balances;
    }, [months, selectedYear, priorities, accounts]);

    // Group contribution transactions by target account (priority bucket)
    const contributionGroups = useMemo(() => {
        const groups: Record<string, {
            accountId: string;
            accountName: string;
            bucketName: string;
            transactions: Transaction[];
            total: number;
            annualTarget: number;
            startingBalance: number;
            actualBalance: number;
        }> = {};

        // Initialize groups for each priority bucket that has an accountId
        priorities.forEach(p => {
            if (p.accountId) {
                const account = accounts.find(a => a.id === p.accountId);
                const annualTarget = expectedContributions[p.accountId] || 0;
                const startingBalance = startingBalances[p.accountId] || 0;
                const actualBalance = currentSnapshot?.accountBalances[p.accountId] ?? account?.amount ?? 0;

                groups[p.accountId] = {
                    accountId: p.accountId,
                    accountName: account?.name || 'Unknown Account',
                    bucketName: p.name,
                    transactions: [],
                    total: 0,
                    annualTarget,
                    startingBalance,
                    actualBalance,
                };
            }
        });

        // Group contribution transactions
        transactions.forEach(t => {
            if (t.targetAccountId && groups[t.targetAccountId]) {
                groups[t.targetAccountId].transactions.push(t);
                groups[t.targetAccountId].total += Math.abs(t.amount);
            }
        });

        // Sort transactions within each group
        Object.values(groups).forEach(group => {
            group.transactions.sort(sortTransactionsByDateThenAmount);
        });

        return groups;
    }, [transactions, priorities, accounts, expectedContributions, startingBalances, currentSnapshot]);

    // Group income transactions by income category
    const incomeGroups = useMemo(() => {
        const groups: Record<IncomeCategory, { transactions: Transaction[]; total: number }> = {} as any;

        // Initialize all income categories
        INCOME_CATEGORIES.forEach(cat => {
            groups[cat] = { transactions: [], total: 0 };
        });

        // Group income transactions
        transactions.forEach(t => {
            if (t.amount > 0 && !t.isTransfer && !t.isReimbursement && t.incomeCategory) {
                groups[t.incomeCategory].transactions.push(t);
                groups[t.incomeCategory].total += t.amount;
            }
        });

        // Sort transactions within each group
        Object.values(groups).forEach(group => {
            group.transactions.sort(sortTransactionsByDateThenAmount);
        });

        return groups;
    }, [transactions]);

    // Calculate cash flow summary
    const cashFlowSummary = useMemo(() => calculateNetCashFlow(transactions), [transactions]);

    // Transactions sorted by date (newest first)
    const sortedTransactions = useMemo(() => {
        return [...transactions].sort(sortTransactionsByDateThenAmount);
    }, [transactions]);

    const handleAddTransaction = useCallback(() => {
        if (!formData.description || !formData.amount) return;

        const snapshot = currentSnapshot || getOrCreateMonth(selectedMonth, selectedYear);
        const amount = parseFloat(formData.amount);

        let newTransaction: Transaction;

        if (formData.isCredit) {
            // Handle credit transactions
            if (formData.creditType === 'transfer') {
                newTransaction = {
                    id: `TXN-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
                    date: new Date(formData.date),
                    description: formData.description,
                    amount: Math.abs(amount),
                    isTransfer: true,
                };
            } else if (formData.creditType === 'reimbursement') {
                newTransaction = {
                    id: `TXN-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
                    date: new Date(formData.date),
                    description: formData.description,
                    amount: Math.abs(amount),
                    expenseId: formData.expenseId || undefined,
                    isReimbursement: true,
                };
            } else {
                // Income
                newTransaction = {
                    id: `TXN-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
                    date: new Date(formData.date),
                    description: formData.description,
                    amount: Math.abs(amount),
                    incomeCategory: formData.incomeCategory || undefined,
                };
            }
        } else {
            // Handle expense/contribution transactions
            const isTransfer = formData.expenseId === TRANSFER_CATEGORY_ID;
            const isContribution = formData.expenseId.startsWith(CONTRIBUTION_PREFIX);
            const targetAccountId = isContribution ? formData.expenseId.replace(CONTRIBUTION_PREFIX, '') : undefined;

            newTransaction = {
                id: `TXN-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
                date: new Date(formData.date),
                description: formData.description,
                amount: -Math.abs(amount), // Expenses/contributions are negative (money out)
                expenseId: (isTransfer || isContribution) ? undefined : (formData.expenseId || undefined),
                isTransfer: isTransfer || isContribution, // Contributions are also transfers
                targetAccountId,
            };
        }

        dispatch({
            type: 'ADD_TRANSACTION',
            payload: { monthId: snapshot.id, transaction: newTransaction },
        });

        // Reset form
        setFormData({
            description: '',
            amount: '',
            expenseId: '',
            date: new Date().toISOString().split('T')[0],
            isCredit: false,
            creditType: 'income',
            incomeCategory: '',
        });
        setShowAddForm(false);
    }, [formData, currentSnapshot, getOrCreateMonth, selectedMonth, selectedYear, dispatch]);

    const handleDeleteTransaction = useCallback((transactionId: string) => {
        if (!currentSnapshot) return;

        dispatch({
            type: 'DELETE_TRANSACTION',
            payload: { monthId: currentSnapshot.id, transactionId },
        });
    }, [currentSnapshot, dispatch]);

    const handleUpdateTransaction = useCallback((transactionId: string, updates: Partial<Transaction>) => {
        if (!currentSnapshot) return;

        // Clean up expenseId if empty string
        const cleanedUpdates = {
            ...updates,
            expenseId: updates.expenseId === '' ? undefined : updates.expenseId,
        };

        // Check if the date is changing to a different month
        if (cleanedUpdates.date) {
            const newDate = new Date(cleanedUpdates.date);
            const newMonth = newDate.getMonth() + 1;
            const newYear = newDate.getFullYear();

            // If moving to a different month, use MOVE_TRANSACTION
            if (newMonth !== selectedMonth || newYear !== selectedYear) {
                dispatch({
                    type: 'MOVE_TRANSACTION',
                    payload: {
                        fromMonthId: currentSnapshot.id,
                        transactionId,
                        toMonth: newMonth,
                        toYear: newYear,
                        updates: cleanedUpdates,
                    },
                });
                setEditingId(null);
                return;
            }
        }

        dispatch({
            type: 'UPDATE_TRANSACTION',
            payload: {
                monthId: currentSnapshot.id,
                transactionId,
                updates: cleanedUpdates,
            },
        });

        // Auto-create categorization rule if enabled and expenseId is being set
        if (importSettings.autoCreateRules && cleanedUpdates.expenseId) {
            const transaction = currentSnapshot.transactions.find(t => t.id === transactionId);
            if (transaction) {
                // Check if a rule with this exact pattern already exists
                const existingRule = importSettings.categoryMappings.find(
                    r => r.pattern.toLowerCase() === transaction.description.toLowerCase()
                );
                if (!existingRule) {
                    const newRule = {
                        id: `RULE-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
                        pattern: transaction.description,
                        expenseId: cleanedUpdates.expenseId,
                        isRegex: false,
                    };
                    dispatch({ type: 'ADD_CATEGORY_MAPPING', payload: newRule });
                    dispatch({ type: 'APPLY_CATEGORY_RULE', payload: newRule });
                }
            }
        }

        setEditingId(null);
    }, [currentSnapshot, dispatch, importSettings.autoCreateRules, importSettings.categoryMappings, selectedMonth, selectedYear]);

    const handleClearAllTransactions = useCallback(() => {
        if (!currentSnapshot) return;

        dispatch({
            type: 'CLEAR_ALL_TRANSACTIONS',
            payload: { monthId: currentSnapshot.id },
        });
        setShowClearConfirm(false);
    }, [currentSnapshot, dispatch]);

    const handleToggleSelect = useCallback((id: string) => {
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }
            return next;
        });
    }, []);

    const handleBulkCategoryChange = useCallback(() => {
        if (!currentSnapshot || selectedIds.size === 0) return;

        const isTransfer = bulkCategory === TRANSFER_CATEGORY_ID;
        const expenseId = bulkCategory === '' || isTransfer ? undefined : bulkCategory;

        // Track descriptions we've already created rules for (to avoid duplicates)
        const createdRulePatterns = new Set<string>();

        selectedIds.forEach(transactionId => {
            dispatch({
                type: 'UPDATE_TRANSACTION',
                payload: {
                    monthId: currentSnapshot.id,
                    transactionId,
                    updates: {
                        expenseId,
                        isTransfer,
                    },
                },
            });

            // Auto-create rules if enabled and setting an expense category
            if (importSettings.autoCreateRules && expenseId) {
                const transaction = currentSnapshot.transactions.find(t => t.id === transactionId);
                if (transaction) {
                    const patternLower = transaction.description.toLowerCase();
                    // Skip if we already created a rule for this description in this batch
                    if (!createdRulePatterns.has(patternLower)) {
                        // Check if a rule with this exact pattern already exists
                        const existingRule = importSettings.categoryMappings.find(
                            r => r.pattern.toLowerCase() === patternLower
                        );
                        if (!existingRule) {
                            createdRulePatterns.add(patternLower);
                            const newRule = {
                                id: `RULE-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
                                pattern: transaction.description,
                                expenseId,
                                isRegex: false,
                            };
                            dispatch({ type: 'ADD_CATEGORY_MAPPING', payload: newRule });
                            dispatch({ type: 'APPLY_CATEGORY_RULE', payload: newRule });
                        }
                    }
                }
            }
        });

        setSelectedIds(new Set());
        setBulkCategory('');
    }, [currentSnapshot, selectedIds, bulkCategory, dispatch, importSettings.autoCreateRules, importSettings.categoryMappings]);

    const handleClearSelection = useCallback(() => {
        setSelectedIds(new Set());
    }, []);

    const totalTransactions = transactions.length;
    const uncategorizedCount = groupedTransactions['uncategorized'].transactions.length;
    const totalIncome = cashFlowSummary.income;
    const totalSpending = cashFlowSummary.spending;
    const netCashFlow = cashFlowSummary.net;
    const hasIncome = Object.values(incomeGroups).some(g => g.transactions.length > 0);

    return (
        <div className="space-y-6">
            {/* Header with stats */}
            <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                    <h3 className="text-lg font-semibold text-white">
                        Transactions for {formatMonthYear(selectedMonth, selectedYear)}
                    </h3>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                        {totalIncome > 0 && (
                            <span className="text-green-400">
                                Income: {formatCurrency(totalIncome)}
                            </span>
                        )}
                        {totalSpending > 0 && (
                            <span className="text-gray-400">
                                Spending: {formatCurrency(totalSpending)} (net)
                            </span>
                        )}
                        {(totalIncome > 0 || totalSpending > 0) && (
                            <span className={netCashFlow >= 0 ? 'text-green-400' : 'text-red-400'}>
                                Net: {netCashFlow >= 0 ? '+' : ''}{formatCurrency(netCashFlow)}
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
                    {/* Group by category toggle */}
                    <div className="flex items-center gap-2 text-sm text-gray-400 mr-2">
                        <button
                            type="button"
                            onClick={() => setGroupByCategory(!groupByCategory)}
                            className={`relative inline-flex items-center h-5 rounded-full w-9 shrink-0 transition-colors duration-200 ${groupByCategory ? 'bg-green-600' : 'bg-gray-600'}`}
                        >
                            <span className={`inline-block w-3.5 h-3.5 transform bg-white rounded-full transition-transform duration-200 ${groupByCategory ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
                        </button>
                        <span>Group by category</span>
                    </div>
                    <div className="w-px h-6 bg-gray-700" />
                    {/* Auto-create rules toggle */}
                    <div className="flex items-center gap-2 text-sm text-gray-400 mr-2">
                        <button
                            type="button"
                            onClick={() => dispatch({ type: 'SET_AUTO_CREATE_RULES', payload: !importSettings.autoCreateRules })}
                            className={`relative inline-flex items-center h-5 rounded-full w-9 shrink-0 transition-colors duration-200 ${importSettings.autoCreateRules ? 'bg-green-600' : 'bg-gray-600'}`}
                        >
                            <span className={`inline-block w-3.5 h-3.5 transform bg-white rounded-full transition-transform duration-200 ${importSettings.autoCreateRules ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
                        </button>
                        <span>Auto-create rules</span>
                        <Tooltip text="When enabled, categorizing a transaction will automatically create a rule to apply the same category to future transactions with matching descriptions" />
                    </div>
                    <div className="w-px h-6 bg-gray-700" />
                    {/* Bulk actions - shown when items selected */}
                    {selectedIds.size > 0 && (
                        <>
                            <span className="text-blue-400 text-sm font-medium">
                                {selectedIds.size} selected
                            </span>
                            <select
                                value={bulkCategory}
                                onChange={(e) => setBulkCategory(e.target.value)}
                                className="bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
                            >
                                <option value="">Uncategorized</option>
                                <option value={TRANSFER_CATEGORY_ID}>Transfer</option>
                                {expenses.map(exp => (
                                    <option key={exp.id} value={exp.id}>{exp.name}</option>
                                ))}
                            </select>
                            <button
                                onClick={handleBulkCategoryChange}
                                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-medium transition-colors text-sm"
                            >
                                Apply
                            </button>
                            <button
                                onClick={handleClearSelection}
                                className="px-3 py-2 text-gray-400 hover:text-white text-sm"
                            >
                                Cancel
                            </button>
                            <div className="w-px h-6 bg-gray-600" />
                        </>
                    )}
                    {transactions.length > 0 && (
                        <button
                            onClick={() => setShowClearConfirm(true)}
                            className="px-4 py-2 bg-gray-700 hover:bg-red-600 text-gray-300 hover:text-white rounded-lg font-medium transition-colors"
                            title="Delete all transactions for this month"
                        >
                            Clear All
                        </button>
                    )}
                    <button
                        onClick={() => setShowImportModal(true)}
                        className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-medium transition-colors flex items-center gap-2"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12"/>
                        </svg>
                        Import CSV
                    </button>
                    <button
                        onClick={() => setShowAddForm(true)}
                        className="px-4 py-2 bg-green-600 hover:bg-green-500 text-white rounded-lg font-medium transition-colors"
                    >
                        Add Transaction
                    </button>
                </div>
            </div>

            {/* Add Transaction Form */}
            {showAddForm && (
                <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
                    <h4 className="text-sm font-semibold text-white mb-4">Add Transaction</h4>
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                        <input
                            type="date"
                            value={formData.date}
                            onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                            className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:border-green-500 focus:outline-none"
                        />
                        <input
                            type="text"
                            placeholder="Description"
                            value={formData.description}
                            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                            className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:border-green-500 focus:outline-none"
                        />
                        <input
                            type="number"
                            placeholder="Amount"
                            value={formData.amount}
                            onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                            className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:border-green-500 focus:outline-none"
                        />
                        <button
                            type="button"
                            onClick={() => setFormData({ ...formData, isCredit: !formData.isCredit })}
                            className="flex items-center gap-2 text-sm text-gray-300"
                        >
                            <span className={`relative inline-flex items-center h-5 rounded-full w-9 shrink-0 transition-colors duration-200 ${formData.isCredit ? 'bg-green-600' : 'bg-gray-600'}`}>
                                <span className={`inline-block w-3.5 h-3.5 transform bg-white rounded-full transition-transform duration-200 ${formData.isCredit ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
                            </span>
                            {formData.isCredit ? 'Credit/Income' : 'Expense'}
                        </button>
                    </div>

                    {/* Credit-specific options */}
                    {formData.isCredit ? (
                        <div className="mt-4 space-y-3">
                            <div className="flex items-center gap-4 flex-wrap">
                                <label className="text-sm text-gray-400">Type:</label>
                                <div className="flex gap-4 flex-wrap">
                                    <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
                                        <input
                                            type="radio"
                                            name="creditType"
                                            checked={formData.creditType === 'income'}
                                            onChange={() => setFormData({ ...formData, creditType: 'income', expenseId: '' })}
                                            className="text-green-500 focus:ring-green-500"
                                        />
                                        Income
                                    </label>
                                    <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
                                        <input
                                            type="radio"
                                            name="creditType"
                                            checked={formData.creditType === 'reimbursement'}
                                            onChange={() => setFormData({ ...formData, creditType: 'reimbursement', incomeCategory: '' })}
                                            className="text-green-500 focus:ring-green-500"
                                        />
                                        Reimbursement
                                    </label>
                                    <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
                                        <input
                                            type="radio"
                                            name="creditType"
                                            checked={formData.creditType === 'transfer'}
                                            onChange={() => setFormData({ ...formData, creditType: 'transfer', expenseId: '', incomeCategory: '' })}
                                            className="text-green-500 focus:ring-green-500"
                                        />
                                        Transfer
                                    </label>
                                </div>
                            </div>
                            {formData.creditType === 'income' && (
                                <select
                                    value={formData.incomeCategory}
                                    onChange={(e) => setFormData({ ...formData, incomeCategory: e.target.value as IncomeCategory | '' })}
                                    className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:border-green-500 focus:outline-none"
                                >
                                    <option value="">Select income category...</option>
                                    {INCOME_CATEGORIES.map(cat => (
                                        <option key={cat} value={cat}>{cat}</option>
                                    ))}
                                </select>
                            )}
                            {formData.creditType === 'reimbursement' && (
                                <select
                                    value={formData.expenseId}
                                    onChange={(e) => setFormData({ ...formData, expenseId: e.target.value })}
                                    className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:border-green-500 focus:outline-none"
                                >
                                    <option value="">Select expense to offset...</option>
                                    {expenses.map(exp => (
                                        <option key={exp.id} value={exp.id}>{exp.name}</option>
                                    ))}
                                </select>
                            )}
                        </div>
                    ) : (
                        <div className="mt-4">
                            <select
                                value={formData.expenseId}
                                onChange={(e) => setFormData({ ...formData, expenseId: e.target.value })}
                                className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:border-green-500 focus:outline-none"
                            >
                                <option value="">Select category...</option>
                                <option value={TRANSFER_CATEGORY_ID}>Transfer</option>
                                <optgroup label="Expenses">
                                    {expenses.map(exp => (
                                        <option key={exp.id} value={exp.id}>{exp.name}</option>
                                    ))}
                                </optgroup>
                                {priorities.filter(p => p.accountId).length > 0 && (
                                    <optgroup label="Contributions (Annual Goals)">
                                        {priorities.filter(p => p.accountId).map(p => {
                                            const account = accounts.find(a => a.id === p.accountId);
                                            return (
                                                <option key={p.accountId} value={CONTRIBUTION_PREFIX + p.accountId}>
                                                    {p.name} → {account?.name || 'Account'}
                                                </option>
                                            );
                                        })}
                                    </optgroup>
                                )}
                            </select>
                        </div>
                    )}

                    <div className="flex gap-2 mt-4">
                        <button
                            onClick={handleAddTransaction}
                            className="px-4 py-2 bg-green-600 hover:bg-green-500 text-white rounded-lg text-sm font-medium transition-colors"
                        >
                            Add
                        </button>
                        <button
                            onClick={() => setShowAddForm(false)}
                            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm font-medium transition-colors"
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            )}

            {/* CSV Import Modal */}
            <CSVImportModal
                isOpen={showImportModal}
                onClose={() => setShowImportModal(false)}
            />

            {/* Clear All Confirmation Dialog */}
            {showClearConfirm && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
                    <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 shadow-2xl max-w-sm w-full">
                        <div className="flex items-start gap-4">
                            <div className="shrink-0 w-10 h-10 rounded-full bg-red-900/50 flex items-center justify-center">
                                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" className="text-red-400">
                                    <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
                                </svg>
                            </div>
                            <div className="flex-1">
                                <h3 className="text-lg font-semibold text-white mb-2">Clear All Transactions?</h3>
                                <p className="text-sm text-gray-400">
                                    This will delete all {transactions.length} transactions for {formatMonthYear(selectedMonth, selectedYear)}. This cannot be undone.
                                </p>
                            </div>
                        </div>
                        <div className="flex justify-end gap-3 mt-6">
                            <button
                                onClick={() => setShowClearConfirm(false)}
                                className="px-4 py-2 text-gray-400 hover:text-white transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleClearAllTransactions}
                                className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded-lg font-medium transition-colors"
                            >
                                Delete All
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Transactions List */}
            {transactions.length === 0 ? (
                <div className="bg-blue-900/20 border border-blue-700/50 rounded-lg p-6 text-center">
                    <p className="text-blue-400 font-medium mb-2">No transactions yet</p>
                    <p className="text-gray-400 text-sm">
                        Add transactions manually or import them from a CSV file.
                    </p>
                </div>
            ) : !groupByCategory ? (
                /* Date-sorted view */
                <div className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
                    <div className="divide-y divide-gray-700">
                        {sortedTransactions.map(t => (
                            <TransactionRow
                                key={t.id}
                                transaction={t}
                                expenses={expenses}
                                accounts={accounts}
                                priorities={priorities}
                                isEditing={editingId === t.id}
                                isSelected={selectedIds.has(t.id)}
                                onEdit={() => setEditingId(t.id)}
                                onUpdate={(updates) => handleUpdateTransaction(t.id, updates)}
                                onDelete={() => handleDeleteTransaction(t.id)}
                                onCancel={() => setEditingId(null)}
                                onToggleSelect={() => handleToggleSelect(t.id)}
                                showCategory
                            />
                        ))}
                    </div>
                </div>
            ) : (
                <div className="space-y-4">
                    {/* Uncategorized first if any */}
                    {groupedTransactions['uncategorized'].transactions.length > 0 && (
                        <div className="bg-yellow-900/20 border border-yellow-700/50 rounded-xl overflow-hidden">
                            <button
                                onClick={() => toggleCategoryCollapse('uncategorized')}
                                className="w-full bg-yellow-900/30 px-4 py-3 border-b border-yellow-700/50 hover:bg-yellow-900/40 transition-colors"
                            >
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <span className="font-medium text-yellow-400">Uncategorized</span>
                                        <span className="text-yellow-500 text-sm">({groupedTransactions['uncategorized'].transactions.length})</span>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <span className="text-yellow-400">
                                            {formatCurrency(groupedTransactions['uncategorized'].total)}
                                        </span>
                                        <ChevronIcon expanded={!collapsedCategories.has('uncategorized')} className="text-yellow-400" />
                                    </div>
                                </div>
                            </button>
                            {!collapsedCategories.has('uncategorized') && (
                                <div className="divide-y divide-yellow-700/30">
                                    {groupedTransactions['uncategorized'].transactions.map(t => (
                                        <TransactionRow
                                            key={t.id}
                                            transaction={t}
                                            expenses={expenses}
                                            accounts={accounts}
                                            priorities={priorities}
                                            isEditing={editingId === t.id}
                                            isSelected={selectedIds.has(t.id)}
                                            onEdit={() => setEditingId(t.id)}
                                            onUpdate={(updates) => handleUpdateTransaction(t.id, updates)}
                                            onDelete={() => handleDeleteTransaction(t.id)}
                                            onCancel={() => setEditingId(null)}
                                            onToggleSelect={() => handleToggleSelect(t.id)}
                                        />
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Income Section */}
                    {hasIncome && (
                        <div className="bg-green-900/20 border border-green-700/50 rounded-xl overflow-hidden">
                            <button
                                onClick={() => toggleCategoryCollapse('income')}
                                className="w-full bg-green-900/30 px-4 py-3 border-b border-green-700/50 hover:bg-green-900/40 transition-colors"
                            >
                                <div className="flex items-center justify-between">
                                    <span className="font-medium text-green-400">Income</span>
                                    <div className="flex items-center gap-3">
                                        <span className="text-green-400">
                                            {formatCurrency(totalIncome)}
                                        </span>
                                        <ChevronIcon expanded={!collapsedCategories.has('income')} className="text-green-400" />
                                    </div>
                                </div>
                            </button>
                            {!collapsedCategories.has('income') && (
                                <div className="divide-y divide-green-700/30">
                                    {INCOME_CATEGORIES.map(cat => {
                                        const group = incomeGroups[cat];
                                        if (!group || group.transactions.length === 0) return null;

                                        return (
                                            <div key={cat} className="divide-y divide-green-700/20">
                                                <div className="px-4 py-2 bg-green-900/10 flex items-center justify-between">
                                                    <span className="text-sm font-medium text-green-300">{cat}</span>
                                                    <span className="text-sm text-green-400">{formatCurrency(group.total)}</span>
                                                </div>
                                                {group.transactions.map(t => (
                                                    <TransactionRow
                                                        key={t.id}
                                                        transaction={t}
                                                        expenses={expenses}
                                                        accounts={accounts}
                                                        priorities={priorities}
                                                        isEditing={editingId === t.id}
                                                        isSelected={selectedIds.has(t.id)}
                                                        onEdit={() => setEditingId(t.id)}
                                                        onUpdate={(updates) => handleUpdateTransaction(t.id, updates)}
                                                        onDelete={() => handleDeleteTransaction(t.id)}
                                                        onCancel={() => setEditingId(null)}
                                                        onToggleSelect={() => handleToggleSelect(t.id)}
                                                    />
                                                ))}
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Transfers */}
                    {groupedTransactions[TRANSFER_CATEGORY_ID].transactions.length > 0 && (
                        <div className="bg-gray-800/50 border border-gray-600 rounded-xl overflow-hidden">
                            <button
                                onClick={() => toggleCategoryCollapse('transfers')}
                                className="w-full bg-gray-700/50 px-4 py-3 border-b border-gray-600 hover:bg-gray-700/70 transition-colors"
                            >
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <span className="font-medium text-gray-300">Transfers</span>
                                        <span className="text-gray-500 text-sm">({groupedTransactions[TRANSFER_CATEGORY_ID].transactions.length})</span>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <span className="text-gray-400">
                                            {formatCurrency(groupedTransactions[TRANSFER_CATEGORY_ID].total)}
                                            <span className="text-xs ml-2 text-gray-500">(not counted)</span>
                                        </span>
                                        <ChevronIcon expanded={!collapsedCategories.has('transfers')} className="text-gray-400" />
                                    </div>
                                </div>
                            </button>
                            {!collapsedCategories.has('transfers') && (
                                <div className="divide-y divide-gray-700">
                                    {groupedTransactions[TRANSFER_CATEGORY_ID].transactions.map(t => (
                                        <TransactionRow
                                            key={t.id}
                                            transaction={t}
                                            expenses={expenses}
                                            accounts={accounts}
                                            priorities={priorities}
                                            isEditing={editingId === t.id}
                                            isSelected={selectedIds.has(t.id)}
                                            onEdit={() => setEditingId(t.id)}
                                            onUpdate={(updates) => handleUpdateTransaction(t.id, updates)}
                                            onDelete={() => handleDeleteTransaction(t.id)}
                                            onCancel={() => setEditingId(null)}
                                            onToggleSelect={() => handleToggleSelect(t.id)}
                                        />
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Categorized expense transactions */}
                    {expenses.map(exp => {
                        const group = groupedTransactions[exp.id];
                        if (!group || group.transactions.length === 0) return null;

                        const hasReimbursements = (group.reimbursements || 0) > 0;
                        const isCollapsed = collapsedCategories.has(exp.id);

                        return (
                            <div key={exp.id} className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
                                <button
                                    onClick={() => toggleCategoryCollapse(exp.id)}
                                    className="w-full bg-gray-750 px-4 py-3 border-b border-gray-700 hover:bg-gray-700 transition-colors"
                                >
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            <span className="font-medium text-white">{exp.name}</span>
                                            <span className="text-gray-500 text-sm">({group.transactions.length})</span>
                                        </div>
                                        <div className="flex items-center gap-3">
                                            {hasReimbursements ? (
                                                <span className="text-gray-400">
                                                    <span className="text-gray-500">{formatCurrency(group.gross || 0)}</span>
                                                    <span className="text-green-400 mx-1">- {formatCurrency(group.reimbursements || 0)}</span>
                                                    <span className="text-white">= {formatCurrency(group.net || 0)} net</span>
                                                </span>
                                            ) : (
                                                <span className="text-gray-400">
                                                    {formatCurrency(group.gross || 0)}
                                                </span>
                                            )}
                                            <ChevronIcon expanded={!isCollapsed} className="text-gray-400" />
                                        </div>
                                    </div>
                                </button>
                                {!isCollapsed && (
                                    <div className="divide-y divide-gray-700">
                                        {group.transactions.map(t => (
                                            <TransactionRow
                                                key={t.id}
                                                transaction={t}
                                                expenses={expenses}
                                                accounts={accounts}
                                                priorities={priorities}
                                                isEditing={editingId === t.id}
                                                isSelected={selectedIds.has(t.id)}
                                                onEdit={() => setEditingId(t.id)}
                                                onUpdate={(updates) => handleUpdateTransaction(t.id, updates)}
                                                onDelete={() => handleDeleteTransaction(t.id)}
                                                onCancel={() => setEditingId(null)}
                                                onToggleSelect={() => handleToggleSelect(t.id)}
                                            />
                                        ))}
                                    </div>
                                )}
                            </div>
                        );
                    })}

                    {/* Contribution transactions by priority bucket */}
                    {Object.values(contributionGroups).some(g => g.transactions.length > 0) && (
                        <div className="bg-blue-900/20 border border-blue-700/50 rounded-xl overflow-hidden">
                            <button
                                onClick={() => toggleCategoryCollapse('contributions')}
                                className="w-full bg-blue-900/30 px-4 py-3 border-b border-blue-700/50 hover:bg-blue-900/40 transition-colors"
                            >
                                <div className="flex items-center justify-between">
                                    <span className="font-medium text-blue-400">Contributions</span>
                                    <div className="flex items-center gap-3">
                                        <span className="text-blue-400">
                                            {formatCurrency(Object.values(contributionGroups).reduce((sum, g) => sum + g.total, 0))}
                                        </span>
                                        <ChevronIcon expanded={!collapsedCategories.has('contributions')} className="text-blue-400" />
                                    </div>
                                </div>
                            </button>
                            {!collapsedCategories.has('contributions') && (
                                <div className="divide-y divide-blue-700/30">
                                    {priorities.filter(p => p.accountId).map(p => {
                                        const group = contributionGroups[p.accountId!];
                                        if (!group || group.transactions.length === 0) return null;

                                        return (
                                            <div key={p.accountId} className="divide-y divide-blue-700/20">
                                                <div className="px-4 py-2 bg-blue-900/10 flex items-center justify-between">
                                                    <div>
                                                        <span className="text-sm font-medium text-blue-300">{group.bucketName}</span>
                                                        <span className="text-xs text-blue-400/70 ml-2">→ {group.accountName}</span>
                                                    </div>
                                                    <div className="text-sm text-right">
                                                        <span className="text-blue-400">{formatCurrency(group.total)}</span>
                                                        <span className="text-blue-400/50 text-xs ml-2">
                                                            / {formatCurrency(group.annualTarget)} annual
                                                        </span>
                                                    </div>
                                                </div>
                                                {group.transactions.map(t => (
                                                    <TransactionRow
                                                        key={t.id}
                                                        transaction={t}
                                                        expenses={expenses}
                                                        accounts={accounts}
                                                        priorities={priorities}
                                                        isEditing={editingId === t.id}
                                                        isSelected={selectedIds.has(t.id)}
                                                        onEdit={() => setEditingId(t.id)}
                                                        onUpdate={(updates) => handleUpdateTransaction(t.id, updates)}
                                                        onDelete={() => handleDeleteTransaction(t.id)}
                                                        onCancel={() => setEditingId(null)}
                                                        onToggleSelect={() => handleToggleSelect(t.id)}
                                                    />
                                                ))}
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

// Transaction row component
function TransactionRow({
    transaction,
    expenses,
    accounts,
    priorities,
    isEditing,
    isSelected,
    onEdit,
    onUpdate,
    onDelete,
    onCancel,
    onToggleSelect,
    showCategory = false,
}: {
    transaction: Transaction;
    expenses: any[];
    accounts: any[];
    priorities: any[];
    isEditing: boolean;
    isSelected: boolean;
    onEdit: () => void;
    onUpdate: (updates: Partial<Transaction>) => void;
    onDelete: () => void;
    onCancel: () => void;
    onToggleSelect: () => void;
    showCategory?: boolean;
}) {
    const [editDate, setEditDate] = useState(
        new Date(transaction.date).toISOString().split('T')[0]
    );
    const [editDescription, setEditDescription] = useState(transaction.description);
    const [editAmount, setEditAmount] = useState(Math.abs(transaction.amount).toString());
    const [isCredit, setIsCredit] = useState(transaction.amount > 0);

    // Determine initial credit type based on transaction properties
    const getInitialCreditType = (): 'income' | 'reimbursement' | 'transfer' | 'contribution' => {
        if (transaction.targetAccountId) return 'contribution';
        if (transaction.isTransfer) return 'transfer';
        if (transaction.isReimbursement) return 'reimbursement';
        if (transaction.incomeCategory) return 'income';
        return 'income'; // Default for unclassified credits
    };

    const [editCreditType, setEditCreditType] = useState<'income' | 'reimbursement' | 'transfer' | 'contribution'>(getInitialCreditType);
    // For contributions, the expense dropdown uses CONTRIBUTION_PREFIX + accountId as the value
    const [editExpenseId, setEditExpenseId] = useState(
        transaction.targetAccountId
            ? CONTRIBUTION_PREFIX + transaction.targetAccountId
            : (transaction.expenseId || '')
    );
    const [editIncomeCategory, setEditIncomeCategory] = useState<IncomeCategory | ''>(transaction.incomeCategory || '');
    const [editTargetAccountId, setEditTargetAccountId] = useState(transaction.targetAccountId || '');

    const dateStr = new Date(transaction.date).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
    });

    const handleSave = () => {
        const amount = parseFloat(editAmount) || 0;

        if (isCredit) {
            // Credit transaction
            if (editCreditType === 'transfer') {
                onUpdate({
                    date: new Date(editDate),
                    description: editDescription,
                    amount: Math.abs(amount),
                    isTransfer: true,
                    isReimbursement: false,
                    expenseId: undefined,
                    incomeCategory: undefined,
                    targetAccountId: undefined,
                    isPossibleCredit: false,
                });
            } else if (editCreditType === 'contribution') {
                onUpdate({
                    date: new Date(editDate),
                    description: editDescription,
                    amount: Math.abs(amount),
                    isTransfer: true,
                    isReimbursement: false,
                    expenseId: undefined,
                    incomeCategory: undefined,
                    targetAccountId: editTargetAccountId || undefined,
                    isPossibleCredit: false,
                });
            } else if (editCreditType === 'reimbursement') {
                onUpdate({
                    date: new Date(editDate),
                    description: editDescription,
                    amount: Math.abs(amount),
                    isTransfer: false,
                    isReimbursement: true,
                    expenseId: editExpenseId || undefined,
                    incomeCategory: undefined,
                    targetAccountId: undefined,
                    isPossibleCredit: false,
                });
            } else {
                // Income
                onUpdate({
                    date: new Date(editDate),
                    description: editDescription,
                    amount: Math.abs(amount),
                    isTransfer: false,
                    isReimbursement: false,
                    expenseId: undefined,
                    incomeCategory: editIncomeCategory || undefined,
                    targetAccountId: undefined,
                    isPossibleCredit: false,
                });
            }
        } else {
            // Expense or contribution transaction
            const isTransfer = editExpenseId === TRANSFER_CATEGORY_ID;
            const isContribution = editExpenseId.startsWith(CONTRIBUTION_PREFIX);
            const targetAccountId = isContribution ? editExpenseId.replace(CONTRIBUTION_PREFIX, '') : undefined;

            onUpdate({
                date: new Date(editDate),
                description: editDescription,
                amount: -Math.abs(amount),
                expenseId: (isTransfer || isContribution) ? undefined : (editExpenseId || undefined),
                isTransfer: isTransfer || isContribution,
                isReimbursement: false,
                incomeCategory: undefined,
                targetAccountId,
                isPossibleCredit: false,
            });
        }
    };

    const isPositiveAmount = transaction.amount > 0;

    return (
        <div className={`px-4 py-3 hover:bg-gray-700/30 ${isEditing ? 'bg-gray-800/50' : ''}`}>
            {isEditing ? (
                <div className="space-y-2">
                    <div className="flex items-center gap-2 flex-wrap">
                        <input
                            type="date"
                            value={editDate}
                            onChange={(e) => setEditDate(e.target.value)}
                            className="w-32 bg-gray-900 border border-gray-600 rounded px-2 py-1.5 text-sm text-white focus:border-green-500 focus:outline-none"
                        />
                        <input
                            type="text"
                            value={editDescription}
                            onChange={(e) => setEditDescription(e.target.value)}
                            placeholder="Description"
                            className="flex-1 min-w-[120px] bg-gray-900 border border-gray-600 rounded px-2 py-1.5 text-sm text-white focus:border-green-500 focus:outline-none"
                        />
                        <input
                            type="number"
                            value={editAmount}
                            onChange={(e) => setEditAmount(e.target.value)}
                            placeholder="Amount"
                            step="0.01"
                            className="w-24 bg-gray-900 border border-gray-600 rounded px-2 py-1.5 text-sm text-white focus:border-green-500 focus:outline-none"
                        />
                        <button
                            type="button"
                            onClick={() => setIsCredit(!isCredit)}
                            className="flex items-center gap-1.5 text-xs text-gray-300 whitespace-nowrap"
                        >
                            <span className={`relative inline-flex items-center h-5 rounded-full w-9 shrink-0 transition-colors duration-200 ${isCredit ? 'bg-green-600' : 'bg-gray-600'}`}>
                                <span className={`inline-block w-3.5 h-3.5 transform bg-white rounded-full transition-transform duration-200 ${isCredit ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
                            </span>
                            Credit
                        </button>
                    </div>

                    {/* Category/Type selection row */}
                    <div className="flex items-center gap-2 flex-wrap">
                        {isCredit ? (
                            <>
                                <select
                                    value={editCreditType}
                                    onChange={(e) => setEditCreditType(e.target.value as 'income' | 'reimbursement' | 'transfer' | 'contribution')}
                                    className="bg-gray-900 border border-gray-600 rounded px-2 py-1.5 text-sm text-white focus:border-green-500 focus:outline-none"
                                >
                                    <option value="income">Income</option>
                                    <option value="reimbursement">Reimbursement</option>
                                    <option value="contribution">Contribution</option>
                                    <option value="transfer">Transfer</option>
                                </select>
                                {editCreditType === 'income' && (
                                    <select
                                        value={editIncomeCategory}
                                        onChange={(e) => setEditIncomeCategory(e.target.value as IncomeCategory | '')}
                                        className="bg-gray-900 border border-gray-600 rounded px-2 py-1.5 text-sm text-white focus:border-green-500 focus:outline-none"
                                    >
                                        <option value="">Select income category...</option>
                                        {INCOME_CATEGORIES.map(cat => (
                                            <option key={cat} value={cat}>{cat}</option>
                                        ))}
                                    </select>
                                )}
                                {editCreditType === 'reimbursement' && (
                                    <select
                                        value={editExpenseId}
                                        onChange={(e) => setEditExpenseId(e.target.value)}
                                        className="bg-gray-900 border border-gray-600 rounded px-2 py-1.5 text-sm text-white focus:border-green-500 focus:outline-none"
                                    >
                                        <option value="">Select expense to offset...</option>
                                        {expenses.map(exp => (
                                            <option key={exp.id} value={exp.id}>{exp.name}</option>
                                        ))}
                                    </select>
                                )}
                                {editCreditType === 'contribution' && (
                                    <select
                                        value={editTargetAccountId}
                                        onChange={(e) => setEditTargetAccountId(e.target.value)}
                                        className="bg-gray-900 border border-gray-600 rounded px-2 py-1.5 text-sm text-white focus:border-green-500 focus:outline-none"
                                    >
                                        <option value="">Select account...</option>
                                        {accounts.map(acc => (
                                            <option key={acc.id} value={acc.id}>{acc.name}</option>
                                        ))}
                                    </select>
                                )}
                            </>
                        ) : (
                            <select
                                value={editExpenseId}
                                onChange={(e) => setEditExpenseId(e.target.value)}
                                className="bg-gray-900 border border-gray-600 rounded px-2 py-1.5 text-sm text-white focus:border-green-500 focus:outline-none"
                            >
                                <option value="">Uncategorized</option>
                                <option value={TRANSFER_CATEGORY_ID}>Transfer</option>
                                <optgroup label="Expenses">
                                    {expenses.map(exp => (
                                        <option key={exp.id} value={exp.id}>{exp.name}</option>
                                    ))}
                                </optgroup>
                                {priorities.filter((p: any) => p.accountId).length > 0 && (
                                    <optgroup label="Contributions">
                                        {priorities.filter((p: any) => p.accountId).map((p: any) => {
                                            const account = accounts.find(a => a.id === p.accountId);
                                            return (
                                                <option key={p.accountId} value={CONTRIBUTION_PREFIX + p.accountId}>
                                                    {p.name} → {account?.name || 'Account'}
                                                </option>
                                            );
                                        })}
                                    </optgroup>
                                )}
                            </select>
                        )}
                        <button
                            onClick={handleSave}
                            className="px-3 py-1.5 bg-green-600 hover:bg-green-500 text-white rounded text-xs font-medium"
                        >
                            Save
                        </button>
                        <button
                            onClick={onCancel}
                            className="px-3 py-1.5 bg-gray-600 hover:bg-gray-500 text-white rounded text-xs font-medium"
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            ) : (
                <div className="flex items-center gap-4">
                    <label className="flex items-center justify-center px-4 -ml-4 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={onToggleSelect}
                            onKeyDown={(e) => {
                                if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                                    e.preventDefault();
                                    const checkboxes = document.querySelectorAll<HTMLInputElement>('input[type="checkbox"][data-transaction-select]');
                                    const arr = Array.from(checkboxes);
                                    const idx = arr.indexOf(e.currentTarget);
                                    const next = e.key === 'ArrowDown' ? arr[idx + 1] : arr[idx - 1];
                                    next?.focus();
                                } else if (e.key === 'Enter') {
                                    e.preventDefault();
                                    onToggleSelect();
                                }
                            }}
                            data-transaction-select
                            className="w-4 h-4 rounded bg-gray-700 border-gray-600 text-blue-500 focus:ring-blue-500 cursor-pointer"
                        />
                    </label>
                    <div className="w-16 text-sm text-gray-400">{dateStr}</div>
                    {showCategory && (
                        <div className="w-28 text-xs text-gray-500 truncate">
                            {transaction.isTransfer && !transaction.targetAccountId ? 'Transfer' :
                             transaction.targetAccountId ? 'Contribution' :
                             transaction.incomeCategory ? transaction.incomeCategory :
                             transaction.expenseId ? expenses.find(e => e.id === transaction.expenseId)?.name || '—' :
                             '—'}
                        </div>
                    )}
                    <div className="flex-1 text-sm text-white truncate flex items-center gap-2">
                        {transaction.description}
                        {transaction.frequency && transaction.frequency !== 'one-time' && (
                            <span className="inline-flex items-center px-1.5 py-0.5 bg-purple-900/50 border border-purple-700/50 rounded text-xs text-purple-400">
                                {transaction.frequency === 'annual' ? 'Annual' : transaction.frequency === 'quarterly' ? 'Qtr' : 'Mo'}
                            </span>
                        )}
                        {transaction.targetAccountId && (
                            <span className="inline-flex items-center px-1.5 py-0.5 bg-blue-900/50 border border-blue-700/50 rounded text-xs text-blue-400">
                                → {accounts.find(a => a.id === transaction.targetAccountId)?.name || 'Account'}
                            </span>
                        )}
                        {transaction.isReimbursement && (
                            <span className="inline-flex items-center px-1.5 py-0.5 bg-green-900/50 border border-green-700/50 rounded text-xs text-green-400">
                                Reimb
                            </span>
                        )}
                        {transaction.isPossibleCredit && (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-blue-900/50 border border-blue-700/50 rounded text-xs text-blue-400" title="This may be a credit or refund">
                                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                                    <circle cx="12" cy="12" r="10"/>
                                    <path d="M12 16v-4M12 8h.01"/>
                                </svg>
                                Credit?
                            </span>
                        )}
                    </div>
                    <div className={`text-sm font-medium ${isPositiveAmount ? 'text-green-400' : 'text-white'}`}>
                        {isPositiveAmount ? '+' : ''}{formatCurrency(Math.abs(transaction.amount))}
                    </div>
                    <button
                        onClick={onEdit}
                        className="text-gray-500 hover:text-gray-300 text-xs"
                    >
                        Edit
                    </button>
                    <button
                        onClick={onDelete}
                        className="text-gray-500 hover:text-red-400 text-xs"
                    >
                        Delete
                    </button>
                </div>
            )}
        </div>
    );
}
