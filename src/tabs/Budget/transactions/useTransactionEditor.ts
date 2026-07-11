import { useCallback, useContext, useState } from 'react';
import {
    BudgetContext,
    type Transaction,
    TRANSFER_CATEGORY_ID,
    type IncomeCategory,
} from '../../../components/Objects/Budget/BudgetContext';
import { ExpenseContext } from '../../../components/Objects/Expense/ExpenseContext';
import { useReceiptToast } from '../../../components/Layout/Overlays/ReceiptToast';
import { formatCurrency } from '../../../components/Objects/Budget/budgetUtils';
import { CONTRIBUTION_PREFIX, toLocalDateString } from './utils';

export interface NewTransactionForm {
    description: string;
    amount: string;
    expenseId: string;
    date: string;
    isCredit: boolean;
    creditType: 'income' | 'reimbursement' | 'transfer';
    incomeCategory: IncomeCategory | '';
    source: string; // free-text card/account label this transaction came from (optional; '' = none)
}

function emptyForm(): NewTransactionForm {
    return {
        description: '',
        amount: '',
        expenseId: '',
        date: toLocalDateString(new Date()),
        isCredit: false,
        creditType: 'income',
        incomeCategory: '',
        source: '',
    };
}

function makeId(prefix: string): string {
    return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}

/**
 * Owns all transaction-mutation actions for the current month plus the new-
 * transaction form state. Encapsulates the auto-categorize rule side-effect
 * so the rendering layer doesn't have to know about category mappings.
 *
 * Consumes BudgetContext + ExpenseContext directly so the parent doesn't
 * have to thread dispatch through props.
 */
export function useTransactionEditor(selectedMonth: number, selectedYear: number) {
    const {
        months,
        dispatch,
        getOrCreateMonth,
        importSettings,
    } = useContext(BudgetContext);
    const { expenses } = useContext(ExpenseContext);
    const { show: showReceipt } = useReceiptToast();

    const currentSnapshot = months.find(
        m => m.month === selectedMonth && m.year === selectedYear,
    );

    const [formData, setFormData] = useState<NewTransactionForm>(emptyForm);
    const resetForm = useCallback(() => setFormData(emptyForm()), []);

    /**
     * Auto-create a categorization rule from a single transaction whose
     * `expenseId` was just set, but only if (a) auto-create is enabled,
     * (b) no existing rule matches the description, and (c) the caller
     * supplies the resolved expenseId. Returns true if a rule was created.
     */
    const maybeCreateCategoryRule = useCallback((
        transaction: Transaction | undefined,
        expenseId: string,
        skipPatterns?: Set<string>,
    ): boolean => {
        if (!importSettings.autoCreateRules || !transaction || !expenseId) return false;

        const patternLower = transaction.description.toLowerCase();
        if (skipPatterns?.has(patternLower)) return false;

        const existingRule = importSettings.categoryMappings.find(
            r => r.pattern.toLowerCase() === patternLower,
        );
        if (existingRule) return false;

        const ruleExpense = expenses.find(e => e.id === expenseId);
        const newRule = {
            id: makeId('RULE'),
            pattern: transaction.description,
            expenseId,
            isRegex: false,
        };
        dispatch({ type: 'ADD_CATEGORY_MAPPING', payload: newRule });
        dispatch({
            type: 'APPLY_CATEGORY_RULE',
            payload: {
                ...newRule,
                expenseStart: ruleExpense?.startDate,
                expenseEnd: ruleExpense?.endDate,
            },
        });
        skipPatterns?.add(patternLower);
        return true;
    }, [importSettings.autoCreateRules, importSettings.categoryMappings, expenses, dispatch]);

    const add = useCallback(() => {
        if (!formData.description || !formData.amount) return;

        const snapshot = currentSnapshot || getOrCreateMonth(selectedMonth, selectedYear);
        const amount = parseFloat(formData.amount);
        const source = formData.source.trim() || undefined;
        let newTransaction: Transaction;

        if (formData.isCredit) {
            const base = {
                id: makeId('TXN'),
                date: new Date(formData.date + 'T00:00:00'),
                description: formData.description,
                amount: Math.abs(amount),
                source,
            };
            if (formData.creditType === 'transfer') {
                newTransaction = { ...base, isTransfer: true };
            } else if (formData.creditType === 'reimbursement') {
                newTransaction = {
                    ...base,
                    expenseId: formData.expenseId || undefined,
                    isReimbursement: true,
                };
            } else {
                newTransaction = {
                    ...base,
                    incomeCategory: formData.incomeCategory || undefined,
                };
            }
        } else {
            const isTransfer = formData.expenseId === TRANSFER_CATEGORY_ID;
            const isContribution = formData.expenseId.startsWith(CONTRIBUTION_PREFIX);
            const targetAccountId = isContribution
                ? formData.expenseId.replace(CONTRIBUTION_PREFIX, '')
                : undefined;
            newTransaction = {
                id: makeId('TXN'),
                date: new Date(formData.date + 'T00:00:00'),
                description: formData.description,
                amount: -Math.abs(amount),
                expenseId: (isTransfer || isContribution) ? undefined : (formData.expenseId || undefined),
                isTransfer: isTransfer || isContribution,
                targetAccountId,
                source,
            };
        }

        dispatch({
            type: 'ADD_TRANSACTION',
            payload: { monthId: snapshot.id, transaction: newTransaction },
        });
        // Keep the chosen source sticky so adding several rows from the same
        // card/statement doesn't require re-selecting it each time.
        setFormData({ ...emptyForm(), source: formData.source });
    }, [formData, currentSnapshot, getOrCreateMonth, selectedMonth, selectedYear, dispatch]);

    const update = useCallback((transactionId: string, updates: Partial<Transaction>) => {
        if (!currentSnapshot) return;

        const cleanedUpdates = {
            ...updates,
            expenseId: updates.expenseId === '' ? undefined : updates.expenseId,
        };

        // If the date moved to a different month, route through MOVE_TRANSACTION
        if (cleanedUpdates.date) {
            const newDate = new Date(cleanedUpdates.date);
            const newMonth = newDate.getMonth() + 1;
            const newYear = newDate.getFullYear();
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

        if (cleanedUpdates.expenseId) {
            const transaction = currentSnapshot.transactions.find(t => t.id === transactionId);
            maybeCreateCategoryRule(transaction, cleanedUpdates.expenseId);
        }
    }, [currentSnapshot, dispatch, selectedMonth, selectedYear, maybeCreateCategoryRule]);

    const remove = useCallback((transactionId: string) => {
        if (!currentSnapshot) return;
        // Capture the removed row so the receipt can re-add it (Undo). The
        // reducer deletes by id, so a clean undo is just an add of the same row.
        const removed = currentSnapshot.transactions.find(t => t.id === transactionId);
        const monthId = currentSnapshot.id;
        dispatch({
            type: 'DELETE_TRANSACTION',
            payload: { monthId, transactionId },
        });

        if (removed) {
            const desc = removed.description || 'transaction';
            const amt = formatCurrency(Math.abs(removed.amount), { cents: true });
            showReceipt({
                message: `Deleted "${desc}" ${amt}`,
                actionLabel: 'Undo',
                onAction: () => {
                    dispatch({
                        type: 'ADD_TRANSACTION',
                        payload: { monthId, transaction: removed },
                    });
                },
            });
        }
    }, [currentSnapshot, dispatch, showReceipt]);

    const clearAllForMonth = useCallback(() => {
        if (!currentSnapshot) return;
        dispatch({
            type: 'CLEAR_ALL_TRANSACTIONS',
            payload: { monthId: currentSnapshot.id },
        });
    }, [currentSnapshot, dispatch]);

    const bulkSetCategory = useCallback((selectedIds: Set<string>, bulkCategory: string) => {
        if (!currentSnapshot || selectedIds.size === 0) return;

        const isTransfer = bulkCategory === TRANSFER_CATEGORY_ID;
        const expenseId = bulkCategory === '' || isTransfer ? undefined : bulkCategory;
        const createdRulePatterns = new Set<string>();

        selectedIds.forEach(transactionId => {
            dispatch({
                type: 'UPDATE_TRANSACTION',
                payload: {
                    monthId: currentSnapshot.id,
                    transactionId,
                    updates: { expenseId, isTransfer },
                },
            });

            if (expenseId) {
                const transaction = currentSnapshot.transactions.find(t => t.id === transactionId);
                maybeCreateCategoryRule(transaction, expenseId, createdRulePatterns);
            }
        });
    }, [currentSnapshot, dispatch, maybeCreateCategoryRule]);

    const bulkSetSource = useCallback((selectedIds: Set<string>, source: string) => {
        if (!currentSnapshot || selectedIds.size === 0) return;

        const cleaned = source.trim() || undefined;
        selectedIds.forEach(transactionId => {
            dispatch({
                type: 'UPDATE_TRANSACTION',
                payload: {
                    monthId: currentSnapshot.id,
                    transactionId,
                    updates: { source: cleaned },
                },
            });
        });
    }, [currentSnapshot, dispatch]);

    return {
        currentSnapshot,
        formData,
        setFormData,
        resetForm,
        add,
        update,
        remove,
        clearAllForMonth,
        bulkSetCategory,
        bulkSetSource,
    };
}
