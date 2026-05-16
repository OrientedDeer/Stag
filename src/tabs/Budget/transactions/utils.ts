/**
 * Pure functions extracted from TransactionsTab. Each one was previously a
 * useMemo body inside the component; lifting them here keeps the component
 * focused on orchestration and makes the grouping logic independently
 * testable.
 */
import { Transaction, MonthlySnapshot, IncomeCategory, INCOME_CATEGORIES, TRANSFER_CATEGORY_ID } from '../../../components/Objects/Budget/BudgetContext';
import { AnyExpense } from '../../../components/Objects/Expense/models';
import { AnyAccount } from '../../../components/Objects/Accounts/models';
import { PriorityBucket } from '../../../components/Objects/Assumptions/AssumptionsContext';
import { sortTransactionsByDateThenAmount } from '../../../components/Objects/Budget/budgetUtils';

/**
 * Special expense-id prefix used by the form/edit dropdowns to mean
 * "this is a contribution to a priority bucket whose account id follows".
 * The reducer never sees this — handlers strip the prefix before dispatching.
 */
export const CONTRIBUTION_PREFIX = '__CONTRIB__';

/** Format a Date as YYYY-MM-DD using local timezone (avoids UTC shift from toISOString) */
export function toLocalDateString(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export interface ExpenseCategoryGroup {
    expense: AnyExpense | null;
    transactions: Transaction[];
    total: number;
    gross?: number;
    reimbursements?: number;
    net?: number;
    isTransfer?: boolean;
}

/**
 * Group transactions by expense category, tracking reimbursements separately
 * so each expense group reports both gross spending and net-of-reimbursement.
 *
 * Income transactions are filtered out (handled by groupIncomeByCategory).
 * Contribution transactions (with `targetAccountId`) are filtered out
 * (handled by groupContributionsByPriority).
 */
export function groupTransactionsByCategory(
    transactions: Transaction[],
    expenses: AnyExpense[]
): Record<string, ExpenseCategoryGroup> {
    const groups: Record<string, ExpenseCategoryGroup> = {};

    groups['uncategorized'] = { expense: null, transactions: [], total: 0 };
    groups[TRANSFER_CATEGORY_ID] = { expense: null, transactions: [], total: 0, isTransfer: true };

    expenses.forEach(exp => {
        groups[exp.id] = { expense: exp, transactions: [], total: 0, gross: 0, reimbursements: 0, net: 0 };
    });

    transactions.forEach(t => {
        if (t.targetAccountId) {
            // Contribution — handled elsewhere
            return;
        }

        if (t.isTransfer) {
            groups[TRANSFER_CATEGORY_ID].transactions.push(t);
            groups[TRANSFER_CATEGORY_ID].total += Math.abs(t.amount);
        } else if (t.amount > 0 && !t.isReimbursement && t.incomeCategory) {
            // True income — handled by groupIncomeByCategory
            return;
        } else if (t.expenseId) {
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
            groups['uncategorized'].transactions.push(t);
            groups['uncategorized'].total += Math.abs(t.amount);
        }
    });

    Object.values(groups).forEach(group => {
        if (group.gross !== undefined) {
            group.net = group.gross - (group.reimbursements || 0);
        }
        group.transactions.sort(sortTransactionsByDateThenAmount);
    });

    return groups;
}

/**
 * Starting-balance lookup for priority buckets, used by the contributions
 * progress display. Preference order: Dec of prev year → Jan of current year
 * → the account's current balance. Anchoring on the real Jan 1 balance keeps
 * the "% funded" number stable as the user scrubs through months.
 */
export function computeStartingBalances(
    months: MonthlySnapshot[],
    selectedYear: number,
    priorities: PriorityBucket[],
    accounts: AnyAccount[]
): Record<string, number> {
    const balances: Record<string, number> = {};

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
}

export interface ContributionGroup {
    accountId: string;
    accountName: string;
    bucketName: string;
    transactions: Transaction[];
    total: number;
    annualTarget: number;
    startingBalance: number;
    actualBalance: number;
}

/**
 * Group contribution transactions by their target priority bucket. Each
 * bucket comes pre-populated with annual target, starting balance, and
 * actual balance so the rendering layer can show progress without
 * re-fetching context.
 */
export function groupContributionsByPriority(
    transactions: Transaction[],
    priorities: PriorityBucket[],
    accounts: AnyAccount[],
    expectedContributions: Record<string, number>,
    startingBalances: Record<string, number>,
    currentSnapshot: MonthlySnapshot | undefined,
): Record<string, ContributionGroup> {
    const groups: Record<string, ContributionGroup> = {};

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

    transactions.forEach(t => {
        if (t.targetAccountId && groups[t.targetAccountId]) {
            groups[t.targetAccountId].transactions.push(t);
            groups[t.targetAccountId].total += Math.abs(t.amount);
        }
    });

    Object.values(groups).forEach(group => {
        group.transactions.sort(sortTransactionsByDateThenAmount);
    });

    return groups;
}

export interface IncomeGroupTotals {
    transactions: Transaction[];
    total: number;
}

/**
 * Group income transactions by their `incomeCategory`. Excludes transfers
 * and reimbursements; an income-categorized credit must have an
 * `incomeCategory` to land here.
 */
export function groupIncomeByCategory(
    transactions: Transaction[]
): Record<IncomeCategory, IncomeGroupTotals> {
    const groups = {} as Record<IncomeCategory, IncomeGroupTotals>;

    INCOME_CATEGORIES.forEach(cat => {
        groups[cat] = { transactions: [], total: 0 };
    });

    transactions.forEach(t => {
        if (t.amount > 0 && !t.isTransfer && !t.isReimbursement && t.incomeCategory) {
            groups[t.incomeCategory].transactions.push(t);
            groups[t.incomeCategory].total += t.amount;
        }
    });

    Object.values(groups).forEach(group => {
        group.transactions.sort(sortTransactionsByDateThenAmount);
    });

    return groups;
}
