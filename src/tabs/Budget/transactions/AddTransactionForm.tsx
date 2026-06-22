import { Dispatch, SetStateAction } from 'react';
import {
    INCOME_CATEGORIES,
    IncomeCategory,
    TRANSFER_CATEGORY_ID,
} from '../../../components/Objects/Budget/BudgetContext';
import { AnyExpense } from '../../../components/Objects/Expense/models';
import { AnyAccount } from '../../../components/Objects/Accounts/models';
import { PriorityBucket } from '../../../components/Objects/Assumptions/AssumptionsContext';
import { CONTRIBUTION_PREFIX } from './utils';
import { NewTransactionForm } from './useTransactionEditor';

import { Button } from "../../../components/Layout/Primitives";
interface AddTransactionFormProps {
    formData: NewTransactionForm;
    setFormData: Dispatch<SetStateAction<NewTransactionForm>>;
    activeExpenses: AnyExpense[];
    accounts: AnyAccount[];
    priorities: PriorityBucket[];
    sourceSuggestions: string[];
    onSubmit: () => void;
    onCancel: () => void;
}

/**
 * The add-transaction form, displayed inline when the user clicks "Add
 * Transaction." Owns no state of its own — everything lives in the
 * `formData` value/setter pair from useTransactionEditor.
 */
export function AddTransactionForm({
    formData,
    setFormData,
    activeExpenses,
    accounts,
    priorities,
    sourceSuggestions,
    onSubmit,
    onCancel,
}: AddTransactionFormProps) {
    const update = <K extends keyof NewTransactionForm>(key: K, value: NewTransactionForm[K]) => {
        setFormData(prev => ({ ...prev, [key]: value }));
    };

    return (
        <div className="bg-surface-overlay rounded-xl p-4 border border-border-default">
            <h4 className="text-sm font-semibold text-white mb-4">Add Transaction</h4>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <input
                    type="date"
                    name="txn-date"
                    value={formData.date}
                    onChange={(e) => update('date', e.target.value)}
                    className="bg-surface-raised border border-border-default rounded-lg px-3 py-2 text-white text-sm focus:border-positive-soft focus:outline-none"
                />
                <input
                    type="text"
                    name="txn-description"
                    placeholder="Description"
                    value={formData.description}
                    onChange={(e) => update('description', e.target.value)}
                    className="bg-surface-raised border border-border-default rounded-lg px-3 py-2 text-white text-sm focus:border-positive-soft focus:outline-none"
                />
                <input
                    type="number"
                    name="txn-amount"
                    placeholder="Amount"
                    value={formData.amount}
                    onChange={(e) => update('amount', e.target.value)}
                    className="bg-surface-raised border border-border-default rounded-lg px-3 py-2 text-white text-sm focus:border-positive-soft focus:outline-none"
                />
                <button
                    type="button"
                    onClick={() => update('isCredit', !formData.isCredit)}
                    className="flex items-center gap-2 text-sm text-content-default"
                >
                    <span className={`relative inline-flex items-center h-5 rounded-full w-9 shrink-0 transition-colors duration-200 ${formData.isCredit ? 'bg-positive-solid' : 'bg-surface-hover'}`}>
                        <span className={`inline-block w-3.5 h-3.5 transform bg-white rounded-full transition-transform duration-200 ${formData.isCredit ? 'translate-x-4.5' : 'translate-x-0.5'}`} />
                    </span>
                    {formData.isCredit ? 'Credit/Income' : 'Expense'}
                </button>
            </div>

            {formData.isCredit ? (
                <div className="mt-4 space-y-3">
                    <div className="flex items-center gap-4 flex-wrap">
                        <label className="text-sm text-content-muted">Type:</label>
                        <div className="flex gap-4 flex-wrap">
                            <label className="flex items-center gap-2 text-sm text-content-default cursor-pointer">
                                <input
                                    type="radio"
                                    name="creditType"
                                    checked={formData.creditType === 'income'}
                                    onChange={() => setFormData(prev => ({ ...prev, creditType: 'income', expenseId: '' }))}
                                    className="text-positive-soft focus:ring-positive-soft"
                                />
                                Income
                            </label>
                            <label className="flex items-center gap-2 text-sm text-content-default cursor-pointer">
                                <input
                                    type="radio"
                                    name="creditType"
                                    checked={formData.creditType === 'reimbursement'}
                                    onChange={() => setFormData(prev => ({ ...prev, creditType: 'reimbursement', incomeCategory: '' }))}
                                    className="text-positive-soft focus:ring-positive-soft"
                                />
                                Reimbursement
                            </label>
                            <label className="flex items-center gap-2 text-sm text-content-default cursor-pointer">
                                <input
                                    type="radio"
                                    name="creditType"
                                    checked={formData.creditType === 'transfer'}
                                    onChange={() => setFormData(prev => ({ ...prev, creditType: 'transfer', expenseId: '', incomeCategory: '' }))}
                                    className="text-positive-soft focus:ring-positive-soft"
                                />
                                Transfer
                            </label>
                        </div>
                    </div>
                    {formData.creditType === 'income' && (
                        <select
                            name="txn-income-category"
                            value={formData.incomeCategory}
                            onChange={(e) => update('incomeCategory', e.target.value as IncomeCategory | '')}
                            className="bg-surface-raised border border-border-default rounded-lg px-3 py-2 text-white text-sm focus:border-positive-soft focus:outline-none"
                        >
                            <option value="">Select income category...</option>
                            {INCOME_CATEGORIES.map(cat => (
                                <option key={cat} value={cat}>{cat}</option>
                            ))}
                        </select>
                    )}
                    {formData.creditType === 'reimbursement' && (
                        <select
                            name="txn-reimbursement-expense"
                            value={formData.expenseId}
                            onChange={(e) => update('expenseId', e.target.value)}
                            className="bg-surface-raised border border-border-default rounded-lg px-3 py-2 text-white text-sm focus:border-positive-soft focus:outline-none"
                        >
                            <option value="">Select expense to offset...</option>
                            {activeExpenses.map(exp => (
                                <option key={exp.id} value={exp.id}>{exp.name}</option>
                            ))}
                        </select>
                    )}
                </div>
            ) : (
                <div className="mt-4">
                    <select
                        name="txn-expense-category"
                        value={formData.expenseId}
                        onChange={(e) => update('expenseId', e.target.value)}
                        className="bg-surface-raised border border-border-default rounded-lg px-3 py-2 text-white text-sm focus:border-positive-soft focus:outline-none"
                    >
                        <option value="">Select category...</option>
                        <option value={TRANSFER_CATEGORY_ID}>Transfer</option>
                        <optgroup label="Expenses">
                            {activeExpenses.map(exp => (
                                <option key={exp.id} value={exp.id}>{exp.name}</option>
                            ))}
                        </optgroup>
                        {priorities.filter(p => p.accountId).length > 0 && (
                            <optgroup label="Contributions (Annual Goals)">
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
                </div>
            )}

            <div className="mt-4">
                <label htmlFor="txn-source" className="block text-xs text-content-muted mb-1">
                    Source / card (optional)
                </label>
                <input
                    type="text"
                    id="txn-source"
                    name="txn-source"
                    list="txn-source-suggestions"
                    placeholder="e.g. Rewards Card"
                    value={formData.source}
                    onChange={(e) => update('source', e.target.value)}
                    className="w-full md:w-72 bg-surface-raised border border-border-default rounded-lg px-3 py-2 text-white text-sm focus:border-positive-soft focus:outline-none"
                />
                <datalist id="txn-source-suggestions">
                    {sourceSuggestions.map(s => <option key={s} value={s} />)}
                </datalist>
            </div>

            <div className="flex gap-2 mt-4">
                <Button
                    onClick={onSubmit}
                    variant="positive"
                >
                    Add
                </Button>
                <Button
                    onClick={onCancel}
                    variant="secondary"
                >
                    Cancel
                </Button>
            </div>
        </div>
    );
}
