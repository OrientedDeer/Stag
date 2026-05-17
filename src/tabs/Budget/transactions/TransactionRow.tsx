import { memo, useState } from 'react';
import {
    Transaction,
    TRANSFER_CATEGORY_ID,
    INCOME_CATEGORIES,
    IncomeCategory,
} from '../../../components/Objects/Budget/BudgetContext';
import { AnyExpense } from '../../../components/Objects/Expense/models';
import { AnyAccount } from '../../../components/Objects/Accounts/models';
import { PriorityBucket } from '../../../components/Objects/Assumptions/AssumptionsContext';
import { formatCurrency } from '../../../components/Objects/Budget/budgetUtils';
import { CONTRIBUTION_PREFIX, toLocalDateString } from './utils';

interface TransactionRowProps {
    transaction: Transaction;
    expenses: AnyExpense[];
    activeExpenses: AnyExpense[];
    accounts: AnyAccount[];
    priorities: PriorityBucket[];
    isEditing: boolean;
    isSelected: boolean;
    onEdit: (id: string) => void;
    onUpdate: (id: string, updates: Partial<Transaction>) => void;
    onDelete: (id: string) => void;
    onCancel: () => void;
    onToggleSelect: (id: string) => void;
    showCategory?: boolean;
}

type EditCreditType = 'income' | 'reimbursement' | 'transfer' | 'contribution';

function TransactionRowInner({
    transaction,
    expenses,
    activeExpenses,
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
}: TransactionRowProps) {
    const [editDate, setEditDate] = useState(() => toLocalDateString(new Date(transaction.date)));
    const [editDescription, setEditDescription] = useState(transaction.description);
    const [editAmount, setEditAmount] = useState(Math.abs(transaction.amount).toString());
    const [isCredit, setIsCredit] = useState(transaction.amount > 0);

    const getInitialCreditType = (): EditCreditType => {
        if (transaction.targetAccountId) return 'contribution';
        if (transaction.isTransfer) return 'transfer';
        if (transaction.isReimbursement) return 'reimbursement';
        if (transaction.incomeCategory) return 'income';
        return 'income';
    };

    const [editCreditType, setEditCreditType] = useState<EditCreditType>(getInitialCreditType);
    // For contributions, the expense dropdown uses CONTRIBUTION_PREFIX + accountId as the value
    const [editExpenseId, setEditExpenseId] = useState(
        transaction.targetAccountId
            ? CONTRIBUTION_PREFIX + transaction.targetAccountId
            : (transaction.expenseId || ''),
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
            if (editCreditType === 'transfer') {
                onUpdate(transaction.id, {
                    date: new Date(editDate + 'T00:00:00'),
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
                onUpdate(transaction.id, {
                    date: new Date(editDate + 'T00:00:00'),
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
                onUpdate(transaction.id, {
                    date: new Date(editDate + 'T00:00:00'),
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
                onUpdate(transaction.id, {
                    date: new Date(editDate + 'T00:00:00'),
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
            const isTransfer = editExpenseId === TRANSFER_CATEGORY_ID;
            const isContribution = editExpenseId.startsWith(CONTRIBUTION_PREFIX);
            const targetAccountId = isContribution ? editExpenseId.replace(CONTRIBUTION_PREFIX, '') : undefined;

            onUpdate(transaction.id, {
                date: new Date(editDate + 'T00:00:00'),
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

    if (isEditing) {
        return (
            <div className="px-4 py-3 hover:bg-gray-700/30 bg-gray-800/50">
                <div className="space-y-2">
                    <div className="flex items-center gap-2 flex-wrap">
                        <input
                            type="date"
                            name="edit-txn-date"
                            value={editDate}
                            onChange={(e) => setEditDate(e.target.value)}
                            className="w-32 bg-gray-900 border border-gray-600 rounded px-2 py-1.5 text-sm text-white focus:border-green-500 focus:outline-none"
                        />
                        <input
                            type="text"
                            name="edit-txn-description"
                            value={editDescription}
                            onChange={(e) => setEditDescription(e.target.value)}
                            placeholder="Description"
                            className="flex-1 min-w-30 bg-gray-900 border border-gray-600 rounded px-2 py-1.5 text-sm text-white focus:border-green-500 focus:outline-none"
                        />
                        <input
                            type="number"
                            name="edit-txn-amount"
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
                                <span className={`inline-block w-3.5 h-3.5 transform bg-white rounded-full transition-transform duration-200 ${isCredit ? 'translate-x-4.5' : 'translate-x-0.5'}`} />
                            </span>
                            Credit
                        </button>
                    </div>

                    <div className="flex items-center gap-2 flex-wrap">
                        {isCredit ? (
                            <>
                                <select
                                    name="edit-txn-credit-type"
                                    value={editCreditType}
                                    onChange={(e) => setEditCreditType(e.target.value as EditCreditType)}
                                    className="bg-gray-900 border border-gray-600 rounded px-2 py-1.5 text-sm text-white focus:border-green-500 focus:outline-none"
                                >
                                    <option value="income">Income</option>
                                    <option value="reimbursement">Reimbursement</option>
                                    <option value="contribution">Contribution</option>
                                    <option value="transfer">Transfer</option>
                                </select>
                                {editCreditType === 'income' && (
                                    <select
                                        name="edit-txn-income-category"
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
                                        name="edit-txn-reimbursement-expense"
                                        value={editExpenseId}
                                        onChange={(e) => setEditExpenseId(e.target.value)}
                                        className="bg-gray-900 border border-gray-600 rounded px-2 py-1.5 text-sm text-white focus:border-green-500 focus:outline-none"
                                    >
                                        <option value="">Select expense to offset...</option>
                                        {activeExpenses.map(exp => (
                                            <option key={exp.id} value={exp.id}>{exp.name}</option>
                                        ))}
                                        {editExpenseId && !activeExpenses.find(e => e.id === editExpenseId) && (() => {
                                            const inactiveExp = expenses.find(e => e.id === editExpenseId);
                                            return inactiveExp ? <option value={inactiveExp.id}>{inactiveExp.name} (ended)</option> : null;
                                        })()}
                                    </select>
                                )}
                                {editCreditType === 'contribution' && (
                                    <select
                                        name="edit-txn-target-account"
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
                                name="edit-txn-expense-category"
                                value={editExpenseId}
                                onChange={(e) => setEditExpenseId(e.target.value)}
                                className="bg-gray-900 border border-gray-600 rounded px-2 py-1.5 text-sm text-white focus:border-green-500 focus:outline-none"
                            >
                                <option value="">Uncategorized</option>
                                <option value={TRANSFER_CATEGORY_ID}>Transfer</option>
                                <optgroup label="Expenses">
                                    {activeExpenses.map(exp => (
                                        <option key={exp.id} value={exp.id}>{exp.name}</option>
                                    ))}
                                    {editExpenseId && !activeExpenses.find(e => e.id === editExpenseId) && (() => {
                                        const inactiveExp = expenses.find(e => e.id === editExpenseId);
                                        return inactiveExp ? <option value={inactiveExp.id}>{inactiveExp.name} (ended)</option> : null;
                                    })()}
                                </optgroup>
                                {priorities.filter(p => p.accountId).length > 0 && (
                                    <optgroup label="Contributions">
                                        {priorities.filter(p => p.accountId).map(p => {
                                            const account = accounts.find(a => a.id === p.accountId);
                                            return (
                                                <option key={p.accountId} value={CONTRIBUTION_PREFIX + p.accountId!}>
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
            </div>
        );
    }

    return (
        <div className="px-4 py-3 hover:bg-gray-700/30">
            <div className="flex items-center gap-4">
                <label className="flex items-center justify-center px-4 -ml-4 cursor-pointer">
                    <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => onToggleSelect(transaction.id)}
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
                                onToggleSelect(transaction.id);
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
                    onClick={() => onEdit(transaction.id)}
                    className="text-gray-500 hover:text-gray-300 text-xs"
                >
                    Edit
                </button>
                <button
                    onClick={() => onDelete(transaction.id)}
                    className="text-gray-500 hover:text-red-400 text-xs"
                >
                    Delete
                </button>
            </div>
        </div>
    );
}

export const TransactionRow = memo(TransactionRowInner);
