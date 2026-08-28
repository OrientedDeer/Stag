import { type AnyExpense } from '../Expense/models';
import { type SimulationYear } from '../Assumptions/SimulationEngine';
import { type AnyAccount } from '../Accounts/models';
// Imported from BudgetTypes (the source of truth) rather than BudgetContext:
// BudgetContext imports this module for its transaction reducers, so going
// through the re-export would make the two files a runtime import cycle.
import { type MonthlySnapshot, type Transaction, type IncomeCategory, getFrequencyDivisor } from './BudgetTypes';
import { MONTH_NAMES } from '../Expense/annualCadence';

/**
 * Get the effective monthly amount for a transaction
 * Annual transactions are divided by 12, quarterly by 3, etc.
 */
export function getTransactionMonthlyAmount(transaction: Transaction): number {
    const divisor = getFrequencyDivisor(transaction.frequency);
    return transaction.amount / divisor;
}

/**
 * Month names for display.
 *
 * Re-exported from the single source of truth in annualCadence.ts (#85/#88) so
 * the Budget tabs and the expense create/edit paths share one canonical list and
 * can't drift. Kept as a named re-export here to preserve the existing import
 * paths (Budget tabs and csvImport import MONTH_NAMES from budgetUtils).
 */
export { MONTH_NAMES };

/**
 * Format month and year for display
 */
export function formatMonthYear(month: number, year: number): string {
    return `${MONTH_NAMES[month - 1]} ${year}`;
}

/**
 * Get the budgeted amount for an expense in a specific month (1-12).
 *
 * Weekly/Monthly expenses spread evenly. Annually expenses depend on their
 * `annualMode`:
 * - 'sinkingFund' → amount/12 every month (save up for it).
 * - 'lump' (default) → the full amount only in its `dueMonth`, $0 otherwise.
 *   When `dueMonth` is unset (e.g. data created before this feature) we fall
 *   back to the expense's start-date month, which is far less surprising than
 *   dumping everything into January.
 *
 * Long-term goals return 0: they're funded as savings (a fund account + savings
 * priority), not as a spending expense, so they don't belong in expense budgets.
 * (`getMonthlyAmount`/`getAnnualAmount` already return 0 for goals.)
 */
export function getExpenseMonthlyBudget(expense: AnyExpense, month: number): number {
    if (expense.frequency === 'Annually' && expense.annualMode !== 'sinkingFund') {
        const dueMonth = expense.dueMonth ?? ((expense.startDate?.getMonth() ?? 0) + 1);
        return month === dueMonth ? expense.getAnnualAmount() : 0;
    }
    return expense.getMonthlyAmount();
}

/**
 * Get all expenses that are active in a given month/year
 */
export function getActiveExpenses(
    expenses: AnyExpense[],
    month: number,
    year: number
): AnyExpense[] {
    return expenses.filter(expense => {
        const startDate = expense.startDate || new Date(0);
        const endDate = expense.endDate;

        // Create a date representing the middle of the target month
        const targetDate = new Date(year, month - 1, 15);

        // Check if the expense is active during this month
        if (startDate > targetDate) return false;
        if (endDate && endDate < targetDate) return false;

        return true;
    });
}

/**
 * Calculate total monthly budget from all active expenses
 */
export function calculateTotalMonthlyBudget(
    expenses: AnyExpense[],
    month: number,
    year: number
): number {
    const activeExpenses = getActiveExpenses(expenses, month, year);
    return activeExpenses.reduce((total, expense) => total + getExpenseMonthlyBudget(expense, month), 0);
}

/**
 * Sum of monthly non-discretionary expenses active in this month.
 * Used to project "committed" spending into future months — discretionary is left out
 * because it's not yet decided.
 */
export function getNonDiscretionaryMonthlyBudget(
    expenses: AnyExpense[],
    month: number,
    year: number
): number {
    return getActiveExpenses(expenses, month, year)
        .filter(exp => !exp.isDiscretionary)
        .reduce((total, exp) => total + getExpenseMonthlyBudget(exp, month), 0);
}

/**
 * Calculate budget summary for a month
 */
export interface BudgetSummary {
    totalBudget: number;
    totalSpent: number;
    remaining: number;
    isUnderBudget: boolean;
    percentSpent: number;
}

/**
 * Calculate uncategorized spending from a snapshot's transactions.
 * These are non-transfer, non-contribution, non-income expenses with no expenseId.
 */
export function getUncategorizedSpending(snapshot: MonthlySnapshot | undefined): number {
    if (!snapshot?.transactions) return 0;
    return snapshot.transactions
        .filter(t => !t.isTransfer && !t.targetAccountId && !t.expenseId && t.amount < 0
            && !(t.amount > 0 && !t.isReimbursement && t.incomeCategory))
        .reduce((sum, t) => sum + Math.abs(t.amount), 0);
}

/**
 * Does this month snapshot hold anything the user actually tracked?
 *
 * The Budget tabs use this to decide whether a month is "tracked" (show its
 * actuals) or "empty" (fall back to the non-discretionary projection when
 * `projectFuture` is on). A snapshot can exist while being empty: adding a
 * transaction to a future month calls `getOrCreateMonth`, and the snapshot
 * outlives the transaction once it's deleted (#210). A snapshot whose only
 * `spending` entries are zeros (a hand-typed 0 in the History grid, or a
 * category whose reimbursements cancel its charges) is likewise not data — so
 * the mere presence of a key doesn't count, only a non-zero value.
 */
export function snapshotHasData(snapshot: MonthlySnapshot | undefined): snapshot is MonthlySnapshot {
    if (!snapshot) return false;
    if ((snapshot.transactions?.length ?? 0) > 0) return true;
    return Object.values(snapshot.spending ?? {}).some(amount => amount !== 0);
}

/**
 * Count uncategorized transactions in a snapshot.
 */
export function getUncategorizedCount(snapshot: MonthlySnapshot | undefined): number {
    if (!snapshot?.transactions) return 0;
    return snapshot.transactions
        .filter(t => !t.isTransfer && !t.targetAccountId && !t.expenseId && t.amount < 0)
        .length;
}

export function calculateBudgetSummary(
    expenses: AnyExpense[],
    snapshot: MonthlySnapshot | undefined,
    month: number,
    year: number
): BudgetSummary {
    const totalBudget = calculateTotalMonthlyBudget(expenses, month, year);
    const categorizedSpent = snapshot
        ? Object.values(snapshot.spending).reduce((sum, val) => sum + val, 0)
        : 0;
    const uncategorizedSpent = getUncategorizedSpending(snapshot);
    const totalSpent = categorizedSpent + uncategorizedSpent;
    const remaining = totalBudget - totalSpent;

    return {
        totalBudget,
        totalSpent,
        remaining,
        isUnderBudget: remaining >= 0,
        percentSpent: totalBudget > 0 ? (totalSpent / totalBudget) * 100 : 0,
    };
}

/**
 * Get expected account balance at a specific month based on simulation
 *
 * The simulation runs year-by-year, so we interpolate between current year (Year 0)
 * and next year (Year 1) based on the month.
 */
export function getExpectedAccountBalance(
    accountId: string,
    month: number,
    year: number,
    simulation: SimulationYear[]
): number | null {
    if (simulation.length === 0) return null;

    // Find the simulation years that bracket this date
    // Year 0 (current year) has current balances, Year 1 has projected end-of-year balances
    const currentYearData = simulation.find(s => s.year === year);
    const nextYearData = simulation.find(s => s.year === year + 1);

    if (!currentYearData) return null;

    const currentAccount = currentYearData.accounts.find(a => a.id === accountId);
    if (!currentAccount) return null;

    // Start balance is from current year (Year 0 = current balances)
    const startBalance = currentAccount.amount;

    // End balance is from next year's projection (after contributions and growth)
    const endBalance = nextYearData
        ? nextYearData.accounts.find(a => a.id === accountId)?.amount || startBalance
        : startBalance;

    // Prorate based on month (month is 1-12, so January = 1/12 through the year)
    const monthFraction = month / 12;
    const expectedBalance = startBalance + (endBalance - startBalance) * monthFraction;

    return expectedBalance;
}

/**
 * Get expected monthly contribution for an account based on simulation
 * This is calculated from the annual change divided by 12
 *
 * TODO: This function is exported and tested but not used in the app.
 * Either wire it up to the budget tracking UI or delete it.
 */
export function getExpectedMonthlyContribution(
    accountId: string,
    year: number,
    simulation: SimulationYear[]
): number | null {
    if (simulation.length === 0) return null;

    const yearData = simulation.find(s => s.year === year);
    const prevYearData = simulation.find(s => s.year === year - 1);

    if (!yearData) return null;

    const account = yearData.accounts.find(a => a.id === accountId);
    if (!account) return null;

    // Get the contributions/additions for this year from the year data
    // For now, use the difference between years divided by 12
    const prevBalance = prevYearData
        ? prevYearData.accounts.find(a => a.id === accountId)?.amount || 0
        : 0;

    const annualChange = account.amount - prevBalance;

    // This is a rough approximation - actual contributions come from priorities
    // A more accurate approach would track contributions separately in simulation
    return annualChange / 12;
}

/**
 * Calculate the difference between actual and expected values
 *
 * TODO: This function is exported and tested but not used in the app.
 * Either wire it up to the budget tracking UI or delete it.
 */
export interface VarianceResult {
    actual: number;
    expected: number;
    difference: number;
    percentVariance: number;
    isOnTrack: boolean;
}

export function calculateVariance(
    actual: number,
    expected: number,
    tolerancePercent: number = 5
): VarianceResult {
    const difference = actual - expected;
    const percentVariance = expected !== 0 ? (difference / expected) * 100 : 0;
    const isOnTrack = Math.abs(percentVariance) <= tolerancePercent;

    return {
        actual,
        expected,
        difference,
        percentVariance,
        isOnTrack,
    };
}

/**
 * Get spending by category for a month
 *
 * TODO: This function is exported and tested but not used in the app.
 * Either wire it up to the budget tracking UI or delete it.
 */
export interface CategorySpending {
    expenseId: string;
    expenseName: string;
    budget: number;
    actual: number;
    difference: number;
    percentUsed: number;
}

export function getCategorySpending(
    expenses: AnyExpense[],
    snapshot: MonthlySnapshot | undefined,
    month: number,
    year: number
): CategorySpending[] {
    const activeExpenses = getActiveExpenses(expenses, month, year);

    return activeExpenses.map(expense => {
        const budget = getExpenseMonthlyBudget(expense, month);
        const actual = snapshot?.spending[expense.id] || 0;
        const difference = budget - actual;

        return {
            expenseId: expense.id,
            expenseName: expense.name,
            budget,
            actual,
            difference,
            percentUsed: budget > 0 ? (actual / budget) * 100 : 0,
        };
    });
}

/**
 * Get account balances for a month compared to expected
 *
 * TODO: This function is exported and tested but not used in the app.
 * Either wire it up to the budget tracking UI or delete it.
 */
export interface AccountBalance {
    accountId: string;
    accountName: string;
    previousBalance: number | null;
    expectedBalance: number | null;
    actualBalance: number | null;
    difference: number | null;
    isMarketDriven: boolean;
}

export function getAccountBalances(
    accounts: AnyAccount[],
    snapshot: MonthlySnapshot | undefined,
    prevSnapshot: MonthlySnapshot | undefined,
    month: number,
    year: number,
    simulation: SimulationYear[]
): AccountBalance[] {
    return accounts.map(account => {
        const previousBalance = prevSnapshot?.accountBalances[account.id] ?? null;
        const expectedBalance = getExpectedAccountBalance(account.id, month, year, simulation);
        const actualBalance = snapshot?.accountBalances[account.id] ?? null;

        let difference: number | null = null;
        if (actualBalance !== null && expectedBalance !== null) {
            difference = actualBalance - expectedBalance;
        }

        // Invested accounts are considered "market driven"
        const isMarketDriven = account.constructor.name === 'InvestedAccount'
            || account.constructor.name === 'ESPPAccount'
            || account.constructor.name === 'RSUAccount';

        return {
            accountId: account.id,
            accountName: account.name,
            previousBalance,
            expectedBalance,
            actualBalance,
            difference,
            isMarketDriven,
        };
    });
}

/**
 * Navigate to previous or next month
 */
export function navigateMonth(
    currentMonth: number,
    currentYear: number,
    direction: 'prev' | 'next'
): { month: number; year: number } {
    if (direction === 'prev') {
        if (currentMonth === 1) {
            return { month: 12, year: currentYear - 1 };
        }
        return { month: currentMonth - 1, year: currentYear };
    } else {
        if (currentMonth === 12) {
            return { month: 1, year: currentYear + 1 };
        }
        return { month: currentMonth + 1, year: currentYear };
    }
}

/**
 * Format currency for display.
 *
 * Defaults to whole dollars (no cents). Pass `{ cents: true }` to keep two
 * decimal places — used on the Transactions tab where exact amounts matter.
 */
export function formatCurrency(amount: number, options?: { cents?: boolean }): string {
    const fractionDigits = options?.cents ? 2 : 0;
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: fractionDigits,
        maximumFractionDigits: fractionDigits,
    }).format(amount);
}

// ============================================================================
// Income & Reimbursement Tracking
// ============================================================================

/**
 * Category spending with gross, reimbursements, and net amounts
 */
export interface CategorySpendingWithReimbursements {
    expenseId: string;
    gross: number;         // Total expenses (absolute value)
    reimbursements: number; // Total reimbursements
    net: number;           // gross - reimbursements
}

/**
 * Calculate net spending by category, accounting for reimbursements
 * Uses actual transaction amounts
 */
export function getNetSpendingByCategory(transactions: Transaction[]): Record<string, CategorySpendingWithReimbursements> {
    const result: Record<string, CategorySpendingWithReimbursements> = {};

    transactions.forEach(t => {
        if (t.isTransfer) return;
        if (t.targetAccountId) return; // Exclude contributions (transfers to accounts)
        if (!t.expenseId) return;
        // True income that also carries a (stale) expenseId is not a reimbursement —
        // exclude it so it can't drive a category's net spending negative.
        if (t.amount > 0 && !t.isReimbursement && t.incomeCategory) return;

        if (!result[t.expenseId]) {
            result[t.expenseId] = { expenseId: t.expenseId, gross: 0, reimbursements: 0, net: 0 };
        }

        if (t.amount < 0) {
            // Expense - use actual amount
            result[t.expenseId].gross += Math.abs(t.amount);
        } else {
            // Any positive amount with expenseId is a credit that offsets spending
            result[t.expenseId].reimbursements += t.amount;
        }
    });

    // Calculate net
    Object.values(result).forEach(cat => {
        cat.net = cat.gross - cat.reimbursements;
    });

    return result;
}

/**
 * Calculate income by category
 * Uses actual transaction amounts
 *
 * TODO: This function is exported and tested but not used in the app.
 * Either wire it up to the budget tracking UI or delete it.
 */
export function getIncomeByCategory(transactions: Transaction[]): Record<IncomeCategory, number> {
    const result: Partial<Record<IncomeCategory, number>> = {};

    transactions.forEach(t => {
        if (t.amount > 0 && !t.isTransfer && !t.isReimbursement && t.incomeCategory) {
            result[t.incomeCategory] = (result[t.incomeCategory] || 0) + t.amount;
        }
    });

    return result as Record<IncomeCategory, number>;
}

/**
 * Calculate total income from transactions
 * Uses actual transaction amounts
 */
export function getTotalIncome(transactions: Transaction[]): number {
    return transactions
        .filter(t => t.amount > 0 && !t.isTransfer && !t.isReimbursement && !t.targetAccountId && t.incomeCategory)
        .reduce((sum, t) => sum + t.amount, 0);
}

/**
 * Calculate total net spending (gross expenses - reimbursements)
 */
export function getTotalNetSpending(transactions: Transaction[]): number {
    const categorySpending = getNetSpendingByCategory(transactions);
    return Object.values(categorySpending).reduce((sum, cat) => sum + cat.net, 0);
}

/**
 * Calculate net cash flow (income - net spending)
 */
export function calculateNetCashFlow(transactions: Transaction[]): {
    income: number;
    spending: number;
    net: number;
} {
    const income = getTotalIncome(transactions);
    const spending = getTotalNetSpending(transactions);
    return {
        income,
        spending,
        net: income - spending,
    };
}

// ============================================================================
// Auto-Reconcile Utilities
// ============================================================================

/**
 * Category totals for auto-reconciliation
 */
export interface CategoryTotals {
    gross: number;
    reimbursements: number;
}

/**
 * Calculate category spending totals from transactions for auto-reconciliation.
 * Returns a map of expenseId to { gross, reimbursements }.
 * Excludes transfers and contributions (targetAccountId).
 */
export function calculateCategoryTotalsFromTransactions(
    transactions: Transaction[]
): Record<string, CategoryTotals> {
    const categoryTotals: Record<string, CategoryTotals> = {};

    transactions.forEach(t => {
        if (t.isTransfer || t.targetAccountId || !t.expenseId) return;
        // True income that also carries a (stale) expenseId is not a reimbursement —
        // exclude it so it can't drive a category's net spending negative.
        if (t.amount > 0 && !t.isReimbursement && t.incomeCategory) return;

        if (!categoryTotals[t.expenseId]) {
            categoryTotals[t.expenseId] = { gross: 0, reimbursements: 0 };
        }

        if (t.amount < 0) {
            categoryTotals[t.expenseId].gross += Math.abs(t.amount);
        } else {
            categoryTotals[t.expenseId].reimbursements += t.amount;
        }
    });

    return categoryTotals;
}

/**
 * Rewrite the `spending` entries for the categories a transaction mutation
 * touched, from the transactions that remain in the month.
 *
 * `spending` is a DERIVED cache of the month's categorized transactions, so the
 * transaction reducers (delete / clear / move / update) have to maintain it —
 * `computeSpendingReconciliation` deliberately leaves a month with no
 * transactions alone (those months' totals are hand-entered in the History
 * grid), which is exactly why deleting the last transaction of a month used to
 * strand its spending total in the Overview/Spending/History tabs and make an
 * otherwise-empty future month look tracked (#210).
 *
 * Only the listed categories are recomputed; every other entry is left as-is.
 * Returns the original record unchanged (same reference) when nothing moved.
 */
export function recomputeSpendingForCategories(
    transactions: Transaction[],
    spending: Record<string, number>,
    expenseIds: Iterable<string | undefined>,
): Record<string, number> {
    const affected = new Set<string>();
    for (const id of expenseIds) {
        if (id) affected.add(id);
    }
    if (affected.size === 0) return spending;

    const categoryTotals = calculateCategoryTotalsFromTransactions(transactions);
    const next = { ...spending };
    let changed = false;

    affected.forEach(expenseId => {
        const totals = categoryTotals[expenseId];
        if (!totals) {
            // Nothing left in this category — drop the derived entry entirely.
            if (expenseId in next) {
                delete next[expenseId];
                changed = true;
            }
            return;
        }
        const netSpending = totals.gross - totals.reimbursements;
        if (next[expenseId] !== netSpending) {
            next[expenseId] = netSpending;
            changed = true;
        }
    });

    return changed ? next : spending;
}

/** One spending correction: `amount: null` means "delete the stale entry". */
export interface SpendingReconciliationDiff {
    expenseId: string;
    amount: number | null;
}

/**
 * The auto-reconcile decision core, shared by the app (BudgetSpendingReconciler /
 * useAutoReconcile) and the headless stag-feed importer (backupMerge) so the two
 * can't drift: given a month's transactions and its stored per-category
 * `spending` record, return the corrections needed to make the stored record
 * match the transaction-derived totals. Empty array = already in sync.
 *
 * Mirrors useAutoReconcile exactly: months with no transactions are left alone
 * (their totals are hand-entered in the History grid — clearing those here would
 * eat manual data; removing the last transaction from a month instead cleans up
 * its derived entries in the reducer, see recomputeSpendingForCategories);
 * a category is rewritten when it drifts by more than a cent; a stored non-zero
 * category with no matching transactions is deleted.
 */
export function computeSpendingReconciliation(
    transactions: Transaction[] | undefined,
    spending: Record<string, number>,
): SpendingReconciliationDiff[] {
    if (!transactions || transactions.length === 0) return [];

    const categoryTotals = calculateCategoryTotalsFromTransactions(transactions);
    const diffs: SpendingReconciliationDiff[] = [];

    Object.entries(categoryTotals).forEach(([expenseId, { gross, reimbursements }]) => {
        const netSpending = gross - reimbursements;
        const currentAmount = spending[expenseId] ?? 0;
        if (Math.abs(currentAmount - netSpending) > 0.01) {
            diffs.push({ expenseId, amount: netSpending });
        }
    });

    Object.keys(spending).forEach(expenseId => {
        if (!categoryTotals[expenseId] && spending[expenseId] !== 0) {
            diffs.push({ expenseId, amount: null });
        }
    });

    return diffs;
}

// ============================================================================
// Transaction Sorting
// ============================================================================

/**
 * Sort transactions by date (newest first), then by amount (largest first)
 */
export function sortTransactionsByDateThenAmount(a: Transaction, b: Transaction): number {
    const dateA = new Date(a.date).getTime();
    const dateB = new Date(b.date).getTime();
    if (dateB !== dateA) return dateB - dateA;
    return Math.abs(b.amount) - Math.abs(a.amount);
}
