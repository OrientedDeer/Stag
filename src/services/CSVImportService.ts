/**
 * CSVImportService - Handles CSV parsing, column detection, and format matching
 */

import type {
    Transaction,
    CategoryMapping,
    IncomeCategory,
    FormatFingerprint,
    CSVMapping,
    CSVImportOptions,
    SavedCSVMapping,
} from '../components/Objects/Budget/BudgetTypes';

// ============================================================================
// Types
// ============================================================================

// Persistence-bound types live in BudgetTypes.ts (they're stored in
// BudgetState.importSettings.savedCSVFormats). Re-export them here so existing
// `from '.../CSVImportService'` consumers don't have to switch paths.
export type {
    FormatFingerprint,
    CSVMapping,
    CSVImportOptions,
    SavedCSVMapping,
} from '../components/Objects/Budget/BudgetTypes';

export interface ParsedCSV {
    headers: string[];
    rows: string[][];
    hasHeaders: boolean;
}

export interface ColumnDetection {
    columnIndex: number;
    type: 'date' | 'description' | 'amount' | 'debit' | 'credit' | 'balance' | 'transaction_type' | 'unknown';
    confidence: number; // 0-1
    detectedFormat?: string; // For dates: "M/D/YYYY", etc.
}

export interface FormatMatch {
    mapping: SavedCSVMapping;
    confidence: number; // 1.0 = exact match, 0.7-0.99 = fuzzy match
}

export interface ImportResult {
    transactions: Transaction[];
    autoCategorized: number;
    duplicates: Transaction[];
    errors: string[];
}

// ============================================================================
// Date Pattern Detection
// ============================================================================

const DATE_PATTERNS: { regex: RegExp; format: string }[] = [
    { regex: /^\d{1,2}\/\d{1,2}\/\d{4}$/, format: 'M/D/YYYY' },
    { regex: /^\d{4}-\d{2}-\d{2}$/, format: 'YYYY-MM-DD' },
    { regex: /^\d{1,2}\/\d{1,2}\/\d{2}$/, format: 'M/D/YY' },
    { regex: /^\d{1,2}-\d{1,2}-\d{4}$/, format: 'M-D-YYYY' },
    { regex: /^\d{1,2}-\d{1,2}-\d{2}$/, format: 'M-D-YY' },
    { regex: /^\d{4}\/\d{2}\/\d{2}$/, format: 'YYYY/MM/DD' },
    { regex: /^[A-Za-z]{3}\s+\d{1,2},?\s+\d{4}$/, format: 'MMM D, YYYY' }, // "Jan 15, 2025"
];

const AMOUNT_PATTERN = /^[$\-()\d,.]+$/;

// ============================================================================
// Income Detection Patterns
// ============================================================================

/**
 * Patterns for detecting likely income transactions during import.
 * Each pattern maps to an income category suggestion.
 */
const INCOME_PATTERNS: { patterns: RegExp[]; category: IncomeCategory }[] = [
    {
        patterns: [
            /payroll/i,
            /direct\s*dep(osit)?/i,
            /salary/i,
            /wages/i,
            /pay\s*check/i,
            /employer/i,
            /\bpay\b.*\bdep\b/i,
        ],
        category: 'Salary',
    },
    {
        patterns: [
            /interest\s*(payment|paid|earned)?/i,
            /\bint\s*pmt\b/i,
            /\bapy\b/i,
            /savings\s*interest/i,
        ],
        category: 'Interest',
    },
    {
        patterns: [
            /dividend/i,
            /\bdiv\s*(pmt|payment)?\b/i,
            /qualified\s*div/i,
            /stock\s*div/i,
        ],
        category: 'Dividends',
    },
    {
        patterns: [
            /refund/i,
            /rebate/i,
            /credit\s*adj/i,
            /return\s*(credit)?/i,
            /price\s*adj/i,
        ],
        category: 'Refund',
    },
    {
        patterns: [
            /venmo/i,
            /cash\s*app/i,
            /\bzelle\b/i,
            /paypal/i,
            /\bp2p\b/i,
        ],
        category: 'Venmo/CashApp',
    },
    {
        patterns: [
            /freelance/i,
            /consulting/i,
            /contractor/i,
            /side\s*(hustle|gig|job)/i,
            /\b1099\b/i,
        ],
        category: 'Side Income',
    },
    {
        patterns: [
            /gift/i,
            /birthday/i,
            /holiday\s*(gift)?/i,
        ],
        category: 'Gift',
    },
];

/**
 * Detect if a transaction description matches income patterns
 * Returns the suggested income category or null if no match
 */
export function detectIncomeCategory(description: string): IncomeCategory | null {
    for (const { patterns, category } of INCOME_PATTERNS) {
        for (const pattern of patterns) {
            if (pattern.test(description)) {
                return category;
            }
        }
    }
    return null;
}

/**
 * Check if a description looks like income based on patterns
 */
export function isLikelyIncome(description: string): boolean {
    return detectIncomeCategory(description) !== null;
}

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Parse a CSV string into headers and rows
 */
export function parseCSV(content: string): ParsedCSV {
    // Strip UTF-8 BOM if present (common in bank CSV downloads)
    const cleaned = content.replace(/^\uFEFF/, '');
    const lines = cleaned.split(/\r?\n/).filter(line => line.trim());

    if (lines.length === 0) {
        return { headers: [], rows: [], hasHeaders: true };
    }

    // Parse each line, handling quoted fields
    const parsedRows = lines.map(line => parseCSVLine(line));

    // Detect if first row is headers (contains mostly text, not numbers)
    const hasHeaders = detectHeaders(parsedRows[0] || []);

    if (hasHeaders && parsedRows.length > 0) {
        return {
            headers: parsedRows[0],
            rows: parsedRows.slice(1),
            hasHeaders: true,
        };
    }

    // Auto-generate column headers
    const colCount = parsedRows[0]?.length || 0;
    const headers = Array.from({ length: colCount }, (_, i) => `Column ${i + 1}`);

    return {
        headers,
        rows: parsedRows,
        hasHeaders: false,
    };
}

/**
 * Parse a single CSV line, respecting quoted fields
 */
function parseCSVLine(line: string): string[] {
    const fields: string[] = [];
    let field = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        const nextChar = line[i + 1];

        if (char === '"') {
            if (inQuotes && nextChar === '"') {
                // Escaped quote
                field += '"';
                i++;
            } else {
                // Toggle quote state
                inQuotes = !inQuotes;
            }
        } else if (char === ',' && !inQuotes) {
            fields.push(field.trim());
            field = '';
        } else {
            field += char;
        }
    }

    // Add last field
    fields.push(field.trim());

    return fields;
}

/**
 * Detect if a row is likely a header row
 */
function detectHeaders(row: string[]): boolean {
    if (!row || row.length === 0) return false;

    let textLikeCount = 0;
    let numberLikeCount = 0;

    for (const cell of row) {
        const trimmed = cell.trim();
        if (!trimmed) continue;

        // If it looks like a pure number or currency, it's probably data
        if (AMOUNT_PATTERN.test(trimmed) && !isNaN(parseAmount(trimmed))) {
            numberLikeCount++;
        } else if (/[a-zA-Z]/.test(trimmed)) {
            textLikeCount++;
        }
    }

    // Headers should be mostly text
    return textLikeCount > numberLikeCount;
}

/**
 * Detect column types from sample data
 */
export function detectColumnTypes(csv: ParsedCSV): ColumnDetection[] {
    const { headers, rows } = csv;
    const detections: ColumnDetection[] = [];

    for (let colIndex = 0; colIndex < headers.length; colIndex++) {
        const columnValues = rows.map(row => row[colIndex] || '');
        const detection = detectSingleColumnType(colIndex, headers[colIndex], columnValues);
        detections.push(detection);
    }

    // Post-process to distinguish debit/credit columns
    distinguishDebitCredit(detections, rows);

    return detections;
}

/**
 * Detect the type of a single column
 */
function detectSingleColumnType(
    columnIndex: number,
    header: string,
    values: string[]
): ColumnDetection {
    const nonEmpty = values.filter(v => v.trim());

    if (nonEmpty.length === 0) {
        return { columnIndex, type: 'unknown', confidence: 0 };
    }

    // Check header hints
    const headerLower = header.toLowerCase();

    // Date column hints
    if (/date|trans|posted|time/i.test(headerLower)) {
        const dateFormat = detectDateFormat(nonEmpty);
        if (dateFormat) {
            return { columnIndex, type: 'date', confidence: 0.95, detectedFormat: dateFormat };
        }
    }

    // Description hints
    if (/desc|description|memo|merchant|payee|details|narrative/i.test(headerLower)) {
        return { columnIndex, type: 'description', confidence: 0.95 };
    }

    // Amount hints
    if (/amount|total|sum|value|price/i.test(headerLower)) {
        const amountConf = checkAmountColumn(nonEmpty);
        if (amountConf > 0.5) {
            return { columnIndex, type: 'amount', confidence: amountConf };
        }
    }

    // Transaction type column (e.g., "Credit" or "Debit" values)
    if (/transaction\s*type|trans\s*type|type/i.test(headerLower)) {
        const isTransactionType = checkTransactionTypeColumn(nonEmpty);
        if (isTransactionType) {
            return { columnIndex, type: 'transaction_type', confidence: 0.95 };
        }
    }

    // Debit/credit hints
    if (/debit|withdrawal|payment|charge|expense/i.test(headerLower)) {
        return { columnIndex, type: 'debit', confidence: 0.9 };
    }
    if (/credit|deposit|income/i.test(headerLower)) {
        return { columnIndex, type: 'credit', confidence: 0.9 };
    }

    // Balance hint
    if (/balance|running|total\s*balance/i.test(headerLower)) {
        return { columnIndex, type: 'balance', confidence: 0.9 };
    }

    // Auto-detect based on content
    const dateFormat = detectDateFormat(nonEmpty);
    if (dateFormat) {
        return { columnIndex, type: 'date', confidence: 0.8, detectedFormat: dateFormat };
    }

    const amountConf = checkAmountColumn(nonEmpty);
    if (amountConf > 0.7) {
        return { columnIndex, type: 'amount', confidence: amountConf };
    }

    // Check for description (long text, variety of content)
    const avgLength = nonEmpty.reduce((s, v) => s + v.length, 0) / nonEmpty.length;
    const hasVariety = new Set(nonEmpty).size > nonEmpty.length * 0.5;
    if (avgLength > 15 && hasVariety && nonEmpty.every(v => !/^\d+$/.test(v))) {
        return { columnIndex, type: 'description', confidence: Math.min(avgLength / 30, 0.9) };
    }

    return { columnIndex, type: 'unknown', confidence: 0 };
}

/**
 * Detect date format from sample values
 */
function detectDateFormat(values: string[]): string | null {
    for (const { regex, format } of DATE_PATTERNS) {
        const matches = values.filter(v => regex.test(v.trim()));
        if (matches.length >= values.length * 0.8) {
            return format;
        }
    }
    return null;
}

/**
 * Check if column looks like amounts
 */
function checkAmountColumn(values: string[]): number {
    const nonEmpty = values.filter(v => v.trim());
    const amountMatches = nonEmpty.filter(v => {
        const trimmed = v.trim();
        if (!AMOUNT_PATTERN.test(trimmed)) return false;
        const parsed = parseAmount(trimmed);
        return !isNaN(parsed);
    });

    return amountMatches.length / nonEmpty.length;
}

/**
 * Check if column contains transaction type values (Credit/Debit)
 */
function checkTransactionTypeColumn(values: string[]): boolean {
    const nonEmpty = values.filter(v => v.trim());
    if (nonEmpty.length === 0) return false;

    const validTypes = nonEmpty.filter(v => {
        const lower = v.trim().toLowerCase();
        return lower === 'credit' || lower === 'debit' ||
               lower === 'cr' || lower === 'dr' ||
               lower === 'c' || lower === 'd';
    });

    return validTypes.length >= nonEmpty.length * 0.8;
}

/**
 * Distinguish between debit/credit split columns
 */
function distinguishDebitCredit(detections: ColumnDetection[], rows: string[][]): void {
    // Find amount columns that might be split debit/credit
    const amountCols = detections.filter(d => d.type === 'amount');

    if (amountCols.length >= 2) {
        // Check if columns are mutually exclusive (one has value when other is empty)
        for (let i = 0; i < amountCols.length - 1; i++) {
            for (let j = i + 1; j < amountCols.length; j++) {
                const col1 = amountCols[i].columnIndex;
                const col2 = amountCols[j].columnIndex;

                let mutuallyExclusive = 0;
                let total = 0;

                for (const row of rows) {
                    const val1 = row[col1]?.trim();
                    const val2 = row[col2]?.trim();
                    const has1 = val1 && parseAmount(val1) !== 0;
                    const has2 = val2 && parseAmount(val2) !== 0;

                    if ((has1 && !has2) || (!has1 && has2)) {
                        mutuallyExclusive++;
                    }
                    total++;
                }

                if (mutuallyExclusive / total > 0.7) {
                    // Mark as debit/credit pair
                    detections[col1].type = 'debit';
                    detections[col1].confidence = 0.85;
                    detections[col2].type = 'credit';
                    detections[col2].confidence = 0.85;
                }
            }
        }
    }
}

// ============================================================================
// Format Fingerprinting & Matching
// ============================================================================

/**
 * Generate a fingerprint for a CSV format
 */
export function generateFingerprint(headers: string[]): FormatFingerprint {
    const normalized = headers
        .map(h => h.toLowerCase().trim().replace(/[^a-z0-9]/g, ''))
        .sort()
        .join('|');

    return {
        headerHash: simpleHash(normalized),
        columnCount: headers.length,
        headers: headers,
    };
}

/**
 * Simple string hash function
 */
function simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36);
}

/**
 * Find a matching saved format for the given CSV
 */
export function findMatchingFormat(
    csv: ParsedCSV,
    savedFormats: SavedCSVMapping[]
): FormatMatch | null {
    const fingerprint = generateFingerprint(csv.headers);

    // 1. Exact header hash match
    const exactMatch = savedFormats.find(f =>
        f.fingerprint.headerHash === fingerprint.headerHash
    );
    if (exactMatch) {
        return { mapping: exactMatch, confidence: 1.0 };
    }

    // 2. Fuzzy match: same column count + similar headers
    const fuzzyMatches = savedFormats
        .filter(f => f.fingerprint.columnCount === fingerprint.columnCount)
        .map(f => ({
            mapping: f,
            similarity: calculateHeaderSimilarity(f.fingerprint.headers, csv.headers)
        }))
        .filter(m => m.similarity > 0.7)
        .sort((a, b) => b.similarity - a.similarity);

    if (fuzzyMatches.length > 0) {
        return {
            mapping: fuzzyMatches[0].mapping,
            confidence: fuzzyMatches[0].similarity
        };
    }

    return null;
}

/**
 * Calculate similarity between two sets of headers
 */
function calculateHeaderSimilarity(headers1: string[], headers2: string[]): number {
    if (headers1.length !== headers2.length) return 0;

    const normalize = (h: string) => h.toLowerCase().trim().replace(/[^a-z0-9]/g, '');
    const set1 = new Set(headers1.map(normalize));
    const set2 = new Set(headers2.map(normalize));

    let matches = 0;
    for (const h of set1) {
        if (set2.has(h)) matches++;
    }

    return matches / Math.max(set1.size, set2.size);
}

// ============================================================================
// Transaction Conversion
// ============================================================================

/**
 * Check if a transaction type value indicates credit
 */
function isTransactionTypeCredit(value: string): boolean {
    const lower = value.trim().toLowerCase();
    return lower === 'credit' || lower === 'cr' || lower === 'c';
}

/**
 * Apply mapping to convert CSV rows to transactions
 */
export function applyMapping(
    csv: ParsedCSV,
    mapping: CSVMapping,
    options: CSVImportOptions
): Transaction[] {
    const transactions: Transaction[] = [];

    for (const row of csv.rows) {
        const dateStr = row[mapping.dateColumn];
        const description = row[mapping.descriptionColumn] || '';

        // Parse date
        const date = parseDate(dateStr, options.dateFormat);
        if (!date) continue;

        // Parse amount
        let amount: number;
        let isPossibleCredit = false;

        // Check if we have a transaction type column
        const hasTransactionType = mapping.transactionTypeColumn !== undefined;
        const transactionTypeValue = hasTransactionType
            ? row[mapping.transactionTypeColumn!] || ''
            : '';
        const isCredit = hasTransactionType && isTransactionTypeCredit(transactionTypeValue);

        if (mapping.amountColumn !== undefined) {
            amount = parseAmount(row[mapping.amountColumn] || '0');
            // Make amount positive first, then apply sign based on type
            amount = Math.abs(amount);

            if (hasTransactionType) {
                // Use transaction type column to determine sign
                if (isCredit) {
                    // Credit = positive (income/refund)
                    isPossibleCredit = true;
                } else {
                    // Debit = negative (expense)
                    amount = -amount;
                }
            } else if (options.negativeIsExpense) {
                // Original logic: Negative amounts are expenses (standard bank format)
                const originalAmount = parseAmount(row[mapping.amountColumn] || '0');
                if (originalAmount > 0) {
                    isPossibleCredit = true;
                    amount = originalAmount;
                } else {
                    amount = originalAmount;
                }
            } else {
                // Positive amounts are expenses - convert to negative
                // Negative amounts are credits/income - flag them for review
                const originalAmount = parseAmount(row[mapping.amountColumn] || '0');
                if (originalAmount > 0) {
                    amount = -originalAmount;
                } else if (originalAmount < 0) {
                    isPossibleCredit = true;
                    amount = -originalAmount; // Make positive since it's income
                }
            }
        } else if (mapping.debitColumn !== undefined && mapping.creditColumn !== undefined) {
            const debit = parseAmount(row[mapping.debitColumn] || '0');
            const credit = parseAmount(row[mapping.creditColumn] || '0');
            // Debits are expenses (negative), credits are income (positive)
            if (debit > 0) {
                amount = -debit;
            } else if (credit > 0) {
                amount = credit;
                isPossibleCredit = true;
            } else {
                continue;
            }
        } else {
            continue;
        }

        if (isNaN(amount) || amount === 0) continue;

        // For credit transactions, try to detect income category
        let detectedIncomeCategory: IncomeCategory | undefined;
        if (isPossibleCredit || amount > 0) {
            const detected = detectIncomeCategory(description);
            if (detected) {
                detectedIncomeCategory = detected;
            }
        }

        transactions.push({
            id: `TXN-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
            date,
            description: description.trim(),
            amount,
            isPossibleCredit,
            incomeCategory: detectedIncomeCategory,
        });
    }

    return transactions;
}

/**
 * Parse a date string using the detected format
 */
function parseDate(dateStr: string, format: string): Date | null {
    if (!dateStr) return null;

    const trimmed = dateStr.trim();

    try {
        switch (format) {
            case 'YYYY-MM-DD':
                return new Date(trimmed + 'T00:00:00');
            case 'M/D/YYYY':
            case 'M-D-YYYY': {
                const sep = format.includes('/') ? '/' : '-';
                const parts = trimmed.split(sep);
                if (parts.length === 3) {
                    const [month, day, year] = parts.map(p => parseInt(p, 10));
                    return new Date(year, month - 1, day);
                }
                break;
            }
            case 'M/D/YY':
            case 'M-D-YY': {
                const sep = format.includes('/') ? '/' : '-';
                const parts = trimmed.split(sep);
                if (parts.length === 3) {
                    const [month, day, year] = parts.map(p => parseInt(p, 10));
                    const fullYear = year < 50 ? 2000 + year : 1900 + year;
                    return new Date(fullYear, month - 1, day);
                }
                break;
            }
            case 'YYYY/MM/DD': {
                const parts = trimmed.split('/');
                if (parts.length === 3) {
                    const [year, month, day] = parts.map(p => parseInt(p, 10));
                    return new Date(year, month - 1, day);
                }
                break;
            }
            case 'MMM D, YYYY': {
                return new Date(trimmed);
            }
            default:
                return new Date(trimmed);
        }
    } catch {
        return null;
    }

    return null;
}

/**
 * Parse an amount string, handling various formats
 */
export function parseAmount(amountStr: string): number {
    if (!amountStr) return 0;

    let cleaned = amountStr.trim();

    // Check for parentheses (negative)
    const isParenthesized = cleaned.startsWith('(') && cleaned.endsWith(')');
    if (isParenthesized) {
        cleaned = cleaned.slice(1, -1);
    }

    // Remove currency symbols and commas
    cleaned = cleaned.replace(/[$€£¥,]/g, '');

    // Handle negative sign
    const isNegative = cleaned.startsWith('-') || isParenthesized;
    cleaned = cleaned.replace(/^-/, '');

    const value = parseFloat(cleaned);

    return isNegative ? -value : value;
}

// ============================================================================
// Duplicate Detection
// ============================================================================

/**
 * Detect potential duplicate transactions
 */
export function detectDuplicates(
    newTransactions: Transaction[],
    existingTransactions: Transaction[]
): Transaction[] {
    const duplicates: Transaction[] = [];

    for (const newTxn of newTransactions) {
        const isDuplicate = existingTransactions.some(existing => {
            // Same date
            const sameDate = new Date(existing.date).toDateString() === new Date(newTxn.date).toDateString();
            // Same amount
            const sameAmount = Math.abs(existing.amount - newTxn.amount) < 0.01;
            // Similar description (at least 80% match)
            const descSimilarity = calculateStringSimilarity(
                existing.description.toLowerCase(),
                newTxn.description.toLowerCase()
            );

            return sameDate && sameAmount && descSimilarity > 0.8;
        });

        if (isDuplicate) {
            duplicates.push(newTxn);
        }
    }

    return duplicates;
}

/**
 * Calculate string similarity (Levenshtein-based)
 */
function calculateStringSimilarity(s1: string, s2: string): number {
    const longer = s1.length > s2.length ? s1 : s2;
    const shorter = s1.length > s2.length ? s2 : s1;

    if (longer.length === 0) return 1.0;

    // Quick check: if shorter is contained in longer, high similarity
    if (longer.includes(shorter)) {
        return shorter.length / longer.length;
    }

    // Simple word-based overlap
    const words1 = s1.split(/\s+/);
    const words2 = s2.split(/\s+/);
    const commonWords = words1.filter(w => words2.includes(w));

    return commonWords.length / Math.max(words1.length, words2.length);
}

// ============================================================================
// Auto-categorization
// ============================================================================

/**
 * Apply category rules to transactions
 */
export function applyCategories(
    transactions: Transaction[],
    rules: CategoryMapping[]
): { categorized: Transaction[]; autoCategorizedCount: number } {
    let autoCategorizedCount = 0;

    const categorized = transactions.map(txn => {
        for (const rule of rules) {
            const matches = rule.isRegex
                ? new RegExp(rule.pattern, 'i').test(txn.description)
                : txn.description.toLowerCase().includes(rule.pattern.toLowerCase());

            if (matches) {
                autoCategorizedCount++;
                return { ...txn, expenseId: rule.expenseId };
            }
        }
        return txn;
    });

    return { categorized, autoCategorizedCount };
}

// ============================================================================
// Helper to create suggested mapping from detections
// ============================================================================

/**
 * Create a suggested mapping based on auto-detection
 */
export function createSuggestedMapping(detections: ColumnDetection[]): {
    mapping: Partial<CSVMapping>;
    options: Partial<CSVImportOptions>;
    complete: boolean;
} {
    const mapping: Partial<CSVMapping> = {};
    const options: Partial<CSVImportOptions> = {
        hasHeaderRow: true,
        skipRows: 0,
        negativeIsExpense: true,
    };

    // Find date column
    const dateCol = detections.find(d => d.type === 'date' && d.confidence > 0.5);
    if (dateCol) {
        mapping.dateColumn = dateCol.columnIndex;
        options.dateFormat = dateCol.detectedFormat;
    }

    // Find description column
    const descCol = detections.find(d => d.type === 'description' && d.confidence > 0.5);
    if (descCol) {
        mapping.descriptionColumn = descCol.columnIndex;
    }

    // Find transaction type column (e.g., Checking "Transaction Type")
    const transTypeCol = detections.find(d => d.type === 'transaction_type' && d.confidence > 0.5);
    if (transTypeCol) {
        mapping.transactionTypeColumn = transTypeCol.columnIndex;
    }

    // Find amount columns
    const amountCol = detections.find(d => d.type === 'amount' && d.confidence > 0.5);
    const debitCol = detections.find(d => d.type === 'debit' && d.confidence > 0.5);
    const creditCol = detections.find(d => d.type === 'credit' && d.confidence > 0.5);

    if (amountCol) {
        mapping.amountColumn = amountCol.columnIndex;
    } else if (debitCol && creditCol) {
        mapping.debitColumn = debitCol.columnIndex;
        mapping.creditColumn = creditCol.columnIndex;
    }

    // Check if mapping is complete
    const hasDate = mapping.dateColumn !== undefined;
    const hasDesc = mapping.descriptionColumn !== undefined;
    const hasAmount = mapping.amountColumn !== undefined ||
                      (mapping.debitColumn !== undefined && mapping.creditColumn !== undefined);

    return {
        mapping,
        options,
        complete: hasDate && hasDesc && hasAmount,
    };
}

/**
 * Generate unique ID for saved mapping
 */
export function generateMappingId(): string {
    return `FMT-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}
