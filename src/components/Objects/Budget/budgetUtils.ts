import { AnyExpense, isExpenseActiveInCurrentMonth } from '../Expense/models';
import { SimulationYear } from '../Assumptions/SimulationEngine';
import { AnyAccount } from '../Accounts/models';
import { MonthlySnapshot, Transaction, IncomeCategory, getFrequencyDivisor } from './BudgetContext';

/**
 * Get the effective monthly amount for a transaction
 * Annual transactions are divided by 12, quarterly by 3, etc.
 */
export function getTransactionMonthlyAmount(transaction: Transaction): number {
    const divisor = getFrequencyDivisor(transaction.frequency);
    return transaction.amount / divisor;
}

/**
 * Month names for display
 */
export const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
];

/**
 * Format month and year for display
 */
export function formatMonthYear(month: number, year: number): string {
    return `${MONTH_NAMES[month - 1]} ${year}`;
}

/**
 * Get the monthly budget amount for an expense
 * Handles conversion from different frequencies (weekly, monthly, annually)
 */
export function getExpenseMonthlyBudget(expense: AnyExpense): number {
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
 * Get expenses that are currently active (for current month)
 */
export function getCurrentlyActiveExpenses(expenses: AnyExpense[]): AnyExpense[] {
    return expenses.filter(isExpenseActiveInCurrentMonth);
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
    return activeExpenses.reduce((total, expense) => total + getExpenseMonthlyBudget(expense), 0);
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

export function calculateBudgetSummary(
    expenses: AnyExpense[],
    snapshot: MonthlySnapshot | undefined,
    month: number,
    year: number
): BudgetSummary {
    const totalBudget = calculateTotalMonthlyBudget(expenses, month, year);
    const totalSpent = snapshot
        ? Object.values(snapshot.spending).reduce((sum, val) => sum + val, 0)
        : 0;
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
        const budget = getExpenseMonthlyBudget(expense);
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
            || account.constructor.name === 'ESPPAccount';

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
 * Generate a unique ID for months
 */
export function generateMonthId(month: number, year: number): string {
    return `MONTH-${year}-${month.toString().padStart(2, '0')}-${Date.now()}`;
}

/**
 * Format currency for display
 */
export function formatCurrency(amount: number): string {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    }).format(amount);
}

/**
 * Format percentage for display
 */
export function formatPercent(value: number): string {
    return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;
}

/**
 * Get status color class based on variance
 */
export function getStatusColor(isOnTrack: boolean, isUnder: boolean): string {
    if (isOnTrack) return 'text-green-400';
    return isUnder ? 'text-green-400' : 'text-yellow-400';
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

/**
 * Get income transactions grouped by category
 */
export function getIncomeTransactions(transactions: Transaction[]): Transaction[] {
    return transactions.filter(t =>
        t.amount > 0 && !t.isTransfer && !t.isReimbursement && t.incomeCategory
    );
}

/**
 * Get reimbursement transactions
 */
export function getReimbursementTransactions(transactions: Transaction[]): Transaction[] {
    return transactions.filter(t => t.amount > 0 && t.isReimbursement && t.expenseId);
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
