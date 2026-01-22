/**
 * Income categories for true income (not reimbursements)
 */
export const INCOME_CATEGORIES = [
    'Salary',
    'Interest',
    'Dividends',
    'Refund',
    'Venmo/CashApp',
    'Side Income',
    'Gift',
    'Other Income',
] as const;

export type IncomeCategory = typeof INCOME_CATEGORIES[number];

/**
 * Transaction frequency for recurring items
 */
export const TRANSACTION_FREQUENCIES = ['one-time', 'monthly', 'quarterly', 'annual'] as const;
export type TransactionFrequency = typeof TRANSACTION_FREQUENCIES[number];

/**
 * Get the monthly divisor for a frequency (how many months to spread the amount over)
 */
export function getFrequencyDivisor(frequency: TransactionFrequency | undefined): number {
    switch (frequency) {
        case 'annual': return 12;
        case 'quarterly': return 3;
        case 'monthly': return 1;
        case 'one-time':
        default: return 1; // one-time transactions are not spread
    }
}

/**
 * Transaction from bank/credit card import
 */
export interface Transaction {
    id: string;
    date: Date;
    description: string;
    amount: number; // negative for expenses, positive for income/credits
    expenseId?: string; // which expense category this belongs to (for expenses OR reimbursements)
    accountId?: string; // which account (credit card, checking) it came from
    statementDate?: Date; // credit card statement date for timing
    isPossibleCredit?: boolean; // flag for imported positive amounts that might be credits/refunds
    isTransfer?: boolean; // flag for transfers between accounts (excluded from spending)
    isReimbursement?: boolean; // true = credit that reduces an expense category (uses expenseId)
    incomeCategory?: IncomeCategory; // for true income (when amount > 0 and not reimbursement)
    frequency?: TransactionFrequency; // for recurring transactions (annual subscriptions, etc.)
    targetAccountId?: string; // for contribution transfers - which account is being contributed to
}

// Special category ID for transfers
export const TRANSFER_CATEGORY_ID = '__TRANSFER__';

/**
 * Auto-categorization rule for transactions
 */
export interface CategoryMapping {
    id: string;
    pattern: string; // text to match in description
    expenseId: string; // expense category to assign
    isRegex?: boolean; // treat pattern as regex
}

/**
 * Fingerprint for identifying CSV formats
 */
export interface FormatFingerprint {
    headerHash: string;      // Hash of normalized, sorted headers
    columnCount: number;     // Number of columns
    headers: string[];       // Original header names
}

/**
 * Saved CSV format mapping for a specific bank/source
 */
export interface SavedCSVMapping {
    id: string;
    name: string;                    // User-provided name, e.g., "Chase Checking"
    fingerprint: FormatFingerprint;
    mapping: {
        dateColumn: number;          // Column index for date
        descriptionColumn: number;   // Column index for description
        amountColumn?: number;       // Single amount column (negative = expense)
        debitColumn?: number;        // OR separate debit column
        creditColumn?: number;       // OR separate credit column
    };
    options: {
        dateFormat: string;          // "M/D/YYYY", "YYYY-MM-DD", etc.
        negativeIsExpense: boolean;  // How to interpret negative amounts
        hasHeaderRow: boolean;       // Does first row contain headers?
        skipRows: number;            // Extra rows to skip after header
    };
    lastUsed: Date;
    importCount: number;             // Usage tracking
    createdAt: Date;
}

/**
 * Monthly snapshot of actual spending and account balances
 */
export interface MonthlySnapshot {
    id: string;
    month: number; // 1-12
    year: number;

    // Actual spending by expense ID (maps to existing Expense objects)
    spending: Record<string, number>; // expenseId -> actual amount spent

    // Account balances at end of month
    accountBalances: Record<string, number>; // accountId -> balance

    // Contributions/investments made this month (for behavior tracking)
    contributions: Record<string, number>; // accountId -> amount contributed

    // Raw transactions (optional, for reconciliation)
    transactions: Transaction[];

    // Reconciliation status
    reconciled: boolean;
    discrepancy?: number; // difference between calculated and actual balance

    // Notes for the month
    notes?: string;

    // Timestamps
    createdAt: Date;
    updatedAt: Date;
}

/**
 * Budget state
 */
export interface BudgetState {
    // Monthly snapshots of actual data
    months: MonthlySnapshot[];

    // Import settings
    importSettings: {
        dateColumn: string;
        amountColumn: string;
        descriptionColumn: string;
        categoryMappings: CategoryMapping[];
        savedCSVFormats: SavedCSVMapping[];    // Saved format mappings for CSV import
        autoCreateRules: boolean;              // Auto-create rules when categorizing transactions
    };

    // UI state
    selectedMonth: number; // 1-12
    selectedYear: number;
}
