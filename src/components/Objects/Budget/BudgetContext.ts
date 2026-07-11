import { createContext, type Dispatch } from 'react';

// Re-export types and constants for backward compatibility
export {
    INCOME_CATEGORIES,
    TRANSFER_CATEGORY_ID,
    getFrequencyDivisor,
} from './BudgetTypes';

export type {
    IncomeCategory,
    TransactionFrequency,
    Transaction,
    CategoryMapping,
    SavedCSVMapping,
    MonthlySnapshot,
    BudgetState,
} from './BudgetTypes';

import type {
    Transaction,
    CategoryMapping,
    SavedCSVMapping,
    MonthlySnapshot,
    BudgetState,
} from './BudgetTypes';

// Shared id minter (utils/id) so CSVImportService and backupMerge mint ids the same way.
import { generateId } from '../../../utils/id';
// Local-date parsing for date-only transaction fields. The backup path serializes
// Dates via jsonDateReplacer as local 'YYYY-MM-DD'; parsing those with the raw
// `new Date('YYYY-MM-DD')` UTC constructor shifts them a day earlier for west-of-UTC
// users, ratcheting every transaction date one day per export/import cycle (#182).
import { parseDate } from '../modelUtils';

const now = new Date();

export const initialState: BudgetState = {
    months: [],
    importSettings: {
        dateColumn: 'Date',
        amountColumn: 'Amount',
        descriptionColumn: 'Description',
        categoryMappings: [],
        savedCSVFormats: [],
        autoCreateRules: false,
    },
    selectedMonth: now.getMonth() + 1,
    selectedYear: now.getFullYear(),
};

export type BudgetAction =
    | { type: 'SET_SELECTED_MONTH'; payload: { month: number; year: number } }
    | { type: 'ADD_MONTH'; payload: MonthlySnapshot }
    | { type: 'UPDATE_MONTH'; payload: { id: string; updates: Partial<MonthlySnapshot> } }
    | { type: 'DELETE_MONTH'; payload: { id: string } }
    | { type: 'UPDATE_SPENDING'; payload: { monthId: string; expenseId: string; amount: number | null } }
    | { type: 'UPDATE_ACCOUNT_BALANCE'; payload: { monthId: string; accountId: string; balance: number } }
    | { type: 'UPDATE_CONTRIBUTION'; payload: { monthId: string; accountId: string; amount: number } }
    | { type: 'ADD_TRANSACTION'; payload: { monthId: string; transaction: Transaction } }
    | { type: 'UPDATE_TRANSACTION'; payload: { monthId: string; transactionId: string; updates: Partial<Transaction> } }
    | { type: 'MOVE_TRANSACTION'; payload: { fromMonthId: string; transactionId: string; toMonth: number; toYear: number; updates?: Partial<Transaction> } }
    | { type: 'DELETE_TRANSACTION'; payload: { monthId: string; transactionId: string } }
    | { type: 'CLEAR_ALL_TRANSACTIONS'; payload: { monthId: string } }
    | { type: 'BULK_ADD_TRANSACTIONS'; payload: { monthId: string; transactions: Transaction[] } }
    | { type: 'ADD_CATEGORY_MAPPING'; payload: CategoryMapping }
    | { type: 'UPDATE_CATEGORY_MAPPING'; payload: { id: string; updates: Partial<CategoryMapping> } }
    | { type: 'DELETE_CATEGORY_MAPPING'; payload: { id: string } }
    | { type: 'APPLY_CATEGORY_RULE'; payload: CategoryMapping & { expenseStart?: Date | string | null; expenseEnd?: Date | string | null } }
    | { type: 'ADD_CSV_FORMAT'; payload: SavedCSVMapping }
    | { type: 'UPDATE_CSV_FORMAT'; payload: { id: string; updates: Partial<SavedCSVMapping> } }
    | { type: 'DELETE_CSV_FORMAT'; payload: { id: string } }
    | { type: 'SET_AUTO_CREATE_RULES'; payload: boolean }
    | { type: 'SET_PROJECT_FUTURE'; payload: boolean }
    | { type: 'SET_BULK_DATA'; payload: Partial<BudgetState> };

export function budgetReducer(state: BudgetState, action: BudgetAction): BudgetState {
    switch (action.type) {
        case 'SET_SELECTED_MONTH':
            return {
                ...state,
                selectedMonth: action.payload.month,
                selectedYear: action.payload.year,
            };

        case 'ADD_MONTH':
            return {
                ...state,
                months: [...state.months, action.payload],
            };

        case 'UPDATE_MONTH':
            return {
                ...state,
                months: state.months.map(m =>
                    m.id === action.payload.id
                        ? { ...m, ...action.payload.updates, updatedAt: new Date() }
                        : m
                ),
            };

        case 'DELETE_MONTH':
            return {
                ...state,
                months: state.months.filter(m => m.id !== action.payload.id),
            };

        case 'UPDATE_SPENDING': {
            const { monthId, expenseId, amount } = action.payload;
            return {
                ...state,
                months: state.months.map(m => {
                    if (m.id !== monthId) return m;
                    const newSpending = { ...m.spending };
                    if (amount === null || amount === undefined) {
                        delete newSpending[expenseId];
                    } else {
                        newSpending[expenseId] = amount;
                    }
                    return { ...m, spending: newSpending, updatedAt: new Date() };
                }),
            };
        }

        case 'UPDATE_ACCOUNT_BALANCE':
            return {
                ...state,
                months: state.months.map(m =>
                    m.id === action.payload.monthId
                        ? {
                            ...m,
                            accountBalances: { ...m.accountBalances, [action.payload.accountId]: action.payload.balance },
                            updatedAt: new Date(),
                        }
                        : m
                ),
            };

        case 'UPDATE_CONTRIBUTION':
            return {
                ...state,
                months: state.months.map(m =>
                    m.id === action.payload.monthId
                        ? {
                            ...m,
                            contributions: { ...m.contributions, [action.payload.accountId]: action.payload.amount },
                            updatedAt: new Date(),
                        }
                        : m
                ),
            };

        case 'ADD_TRANSACTION':
            return {
                ...state,
                months: state.months.map(m =>
                    m.id === action.payload.monthId
                        ? {
                            ...m,
                            transactions: [...m.transactions, action.payload.transaction],
                            updatedAt: new Date(),
                        }
                        : m
                ),
            };

        case 'UPDATE_TRANSACTION':
            return {
                ...state,
                months: state.months.map(m =>
                    m.id === action.payload.monthId
                        ? {
                            ...m,
                            transactions: m.transactions.map(t =>
                                t.id === action.payload.transactionId
                                    ? { ...t, ...action.payload.updates }
                                    : t
                            ),
                            updatedAt: new Date(),
                        }
                        : m
                ),
            };

        case 'MOVE_TRANSACTION': {
            const { fromMonthId, transactionId, toMonth, toYear, updates } = action.payload;

            // Find the transaction to move
            const sourceMonth = state.months.find(m => m.id === fromMonthId);
            const transaction = sourceMonth?.transactions.find(t => t.id === transactionId);
            if (!transaction) return state;

            // Apply any updates to the transaction
            const updatedTransaction = { ...transaction, ...updates };

            // Find or prepare the target month
            let targetMonth = state.months.find(m => m.month === toMonth && m.year === toYear);
            const targetMonthId = targetMonth?.id;

            // If target month doesn't exist, we need to create it
            if (!targetMonth) {
                const newMonthId = generateId('MONTH');
                targetMonth = {
                    id: newMonthId,
                    month: toMonth,
                    year: toYear,
                    spending: {},
                    accountBalances: {},
                    contributions: {},
                    transactions: [updatedTransaction],
                    reconciled: false,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                };

                // Remove from source, add new target month
                return {
                    ...state,
                    months: [
                        ...state.months.map(m =>
                            m.id === fromMonthId
                                ? {
                                    ...m,
                                    transactions: m.transactions.filter(t => t.id !== transactionId),
                                    updatedAt: new Date(),
                                }
                                : m
                        ),
                        targetMonth,
                    ],
                };
            }

            // Both months exist - remove from source and add to target
            return {
                ...state,
                months: state.months.map(m => {
                    if (m.id === fromMonthId) {
                        return {
                            ...m,
                            transactions: m.transactions.filter(t => t.id !== transactionId),
                            updatedAt: new Date(),
                        };
                    }
                    if (m.id === targetMonthId) {
                        return {
                            ...m,
                            transactions: [...m.transactions, updatedTransaction],
                            updatedAt: new Date(),
                        };
                    }
                    return m;
                }),
            };
        }

        case 'DELETE_TRANSACTION':
            return {
                ...state,
                months: state.months.map(m =>
                    m.id === action.payload.monthId
                        ? {
                            ...m,
                            transactions: m.transactions.filter(t => t.id !== action.payload.transactionId),
                            updatedAt: new Date(),
                        }
                        : m
                ),
            };

        case 'CLEAR_ALL_TRANSACTIONS':
            return {
                ...state,
                months: state.months.map(m =>
                    m.id === action.payload.monthId
                        ? {
                            ...m,
                            transactions: [],
                            updatedAt: new Date(),
                        }
                        : m
                ),
            };

        case 'BULK_ADD_TRANSACTIONS':
            return {
                ...state,
                months: state.months.map(m =>
                    m.id === action.payload.monthId
                        ? {
                            ...m,
                            transactions: [...m.transactions, ...action.payload.transactions],
                            updatedAt: new Date(),
                        }
                        : m
                ),
            };

        case 'ADD_CATEGORY_MAPPING':
            return {
                ...state,
                importSettings: {
                    ...state.importSettings,
                    categoryMappings: [...state.importSettings.categoryMappings, action.payload],
                },
            };

        case 'UPDATE_CATEGORY_MAPPING':
            return {
                ...state,
                importSettings: {
                    ...state.importSettings,
                    categoryMappings: state.importSettings.categoryMappings.map(m =>
                        m.id === action.payload.id ? { ...m, ...action.payload.updates } : m
                    ),
                },
            };

        case 'DELETE_CATEGORY_MAPPING':
            return {
                ...state,
                importSettings: {
                    ...state.importSettings,
                    categoryMappings: state.importSettings.categoryMappings.filter(m => m.id !== action.payload.id),
                },
            };

        case 'APPLY_CATEGORY_RULE': {
            // Apply a category rule to all matching uncategorized transactions
            const { expenseStart, expenseEnd, ...rule } = action.payload;
            const matchesRule = (description: string): boolean => {
                if (rule.isRegex) {
                    try {
                        return new RegExp(rule.pattern, 'i').test(description);
                    } catch {
                        return false;
                    }
                }
                return description.toLowerCase().includes(rule.pattern.toLowerCase());
            };

            // Check if the target expense is active for a given month
            const isActiveForMonth = (month: number, year: number): boolean => {
                const targetDate = new Date(year, month - 1, 15);
                if (expenseStart && new Date(expenseStart) > targetDate) return false;
                if (expenseEnd && new Date(expenseEnd) < targetDate) return false;
                return true;
            };

            // Don't categorize transactions that already belong elsewhere: transfers,
            // contributions, and true income. Tagging income with an expenseId creates a
            // contradictory state that the reconcile reads as a (negative) reimbursement.
            const isCategorizable = (t: Transaction): boolean =>
                !t.expenseId
                && !t.isTransfer
                && !t.targetAccountId
                && !(t.amount > 0 && !t.isReimbursement && t.incomeCategory);

            return {
                ...state,
                months: state.months.map(month => ({
                    ...month,
                    transactions: month.transactions.map(t =>
                        isCategorizable(t) && matchesRule(t.description) && isActiveForMonth(month.month, month.year)
                            ? { ...t, expenseId: rule.expenseId }
                            : t
                    ),
                })),
            };
        }

        case 'ADD_CSV_FORMAT':
            return {
                ...state,
                importSettings: {
                    ...state.importSettings,
                    savedCSVFormats: [...state.importSettings.savedCSVFormats, action.payload],
                },
            };

        case 'UPDATE_CSV_FORMAT':
            return {
                ...state,
                importSettings: {
                    ...state.importSettings,
                    savedCSVFormats: state.importSettings.savedCSVFormats.map(f =>
                        f.id === action.payload.id ? { ...f, ...action.payload.updates } : f
                    ),
                },
            };

        case 'DELETE_CSV_FORMAT':
            return {
                ...state,
                importSettings: {
                    ...state.importSettings,
                    savedCSVFormats: state.importSettings.savedCSVFormats.filter(f => f.id !== action.payload.id),
                },
            };

        case 'SET_AUTO_CREATE_RULES':
            return {
                ...state,
                importSettings: {
                    ...state.importSettings,
                    autoCreateRules: action.payload,
                },
            };

        case 'SET_PROJECT_FUTURE':
            return { ...state, projectFuture: action.payload };

        case 'SET_BULK_DATA':
            return { ...state, ...action.payload };

        default:
            return state;
    }
}

export const STORAGE_KEY = 'user_budget_data';

interface BudgetContextProps extends BudgetState {
    dispatch: Dispatch<BudgetAction>;
    getOrCreateMonth: (month: number, year: number) => MonthlySnapshot;
    getCurrentMonth: () => MonthlySnapshot | undefined;
}

export const BudgetContext = createContext<BudgetContextProps>({
    ...initialState,
    dispatch: () => null,
    getOrCreateMonth: () => ({} as MonthlySnapshot),
    getCurrentMonth: () => undefined,
});

/**
 * Reconstitute the date fields of a parsed budget payload's months. JSON
 * serializes Date as ISO strings; this converts transactions' date/statementDate
 * and each month's createdAt/updatedAt back into Date instances. Used by both
 * localStorage hydration and the global backup-import path (useFileManager) so
 * imported budgets get the same Date typing as persisted ones.
 */
export function reconstituteBudgetMonths(rawMonths: unknown): MonthlySnapshot[] {
    return ((rawMonths as unknown[]) || []).map((m: unknown) => {
        const month = m as Record<string, unknown>;
        const transactions = ((month.transactions as unknown[]) || []).map((t: unknown) => {
            const trans = t as Record<string, unknown>;
            return {
                ...trans,
                // Transaction dates are date-only values (serialized as local
                // 'YYYY-MM-DD' by jsonDateReplacer on backup). parseDate reads that
                // portion as LOCAL midnight so a west-of-UTC export/import round-trip
                // doesn't walk the date a day earlier and defeat dedupe (#182).
                date: trans.date ? parseDate(trans.date, new Date()) : new Date(),
                postedDate: trans.postedDate ? parseDate(trans.postedDate) : undefined,
                statementDate: trans.statementDate ? parseDate(trans.statementDate) : undefined,
            } as Transaction;
        });
        return {
            ...month,
            createdAt: month.createdAt ? new Date(month.createdAt as string) : new Date(),
            updatedAt: month.updatedAt ? new Date(month.updatedAt as string) : new Date(),
            transactions,
        } as MonthlySnapshot;
    });
}

/**
 * Reconstitute a parsed budget payload (Date strings -> Date) for import via
 * SET_BULK_DATA. Returns a Partial<BudgetState> with months' dates rehydrated.
 * Mirrors the month/importSettings date handling in hydrateBudgetState without
 * the localStorage-specific selectedMonth/selectedYear defaulting.
 */
export function reconstituteBudgetState(parsed: unknown): Partial<BudgetState> {
    const data = (parsed as Record<string, unknown>) || {};
    const months = reconstituteBudgetMonths(data.months);

    const importSettingsData = (data.importSettings as Record<string, unknown>) || undefined;
    if (!importSettingsData) {
        return { ...data, months };
    }

    const savedCSVFormats = ((importSettingsData.savedCSVFormats as unknown[]) || []).map((f: unknown) => {
        const format = f as Record<string, unknown>;
        return {
            ...format,
            lastUsed: format.lastUsed ? new Date(format.lastUsed as string) : new Date(),
            createdAt: format.createdAt ? new Date(format.createdAt as string) : new Date(),
        } as SavedCSVMapping;
    });

    return {
        ...data,
        months,
        importSettings: {
            ...(importSettingsData as unknown as BudgetState['importSettings']),
            // Older/hand-edited backups may omit categoryMappings; default it so the
            // SettingsTab and the category-mapping reducers never spread/map/filter
            // undefined (mirrors hydrateBudgetState).
            categoryMappings: (importSettingsData.categoryMappings as CategoryMapping[]) || [],
            savedCSVFormats,
        },
    };
}

export function hydrateBudgetState(parsed: unknown, initial: BudgetState): BudgetState {
    const data = parsed as Record<string, unknown>;
    if (!data) return initial;

    const months = reconstituteBudgetMonths(data.months);

    const importSettingsData = (data.importSettings as Record<string, unknown>) || {};
    const savedCSVFormats = ((importSettingsData.savedCSVFormats as unknown[]) || []).map((f: unknown) => {
        const format = f as Record<string, unknown>;
        return {
            ...format,
            lastUsed: format.lastUsed ? new Date(format.lastUsed as string) : new Date(),
            createdAt: format.createdAt ? new Date(format.createdAt as string) : new Date(),
        } as SavedCSVMapping;
    });

    return {
        ...initial,
        ...data,
        months,
        importSettings: {
            ...initial.importSettings,
            ...importSettingsData,
            categoryMappings: (importSettingsData.categoryMappings as CategoryMapping[]) || [],
            savedCSVFormats,
        },
        selectedMonth: (data.selectedMonth as number) || initial.selectedMonth,
        selectedYear: (data.selectedYear as number) || initial.selectedYear,
    };
}

