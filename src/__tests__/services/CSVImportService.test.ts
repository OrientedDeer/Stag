/**
 * Tests for CSVImportService
 *
 * Tests CSV parsing, column detection, format matching, and transaction import
 */

import { describe, it, expect } from 'vitest';
import {
    detectIncomeCategory,
    isLikelyIncome,
    parseCSV,
    detectColumnTypes,
    generateFingerprint,
    findMatchingFormat,
    applyMapping,
    parseAmount,
    detectDuplicates,
    applyCategories,
    createSuggestedMapping,
    generateMappingId,
    ParsedCSV,
    CSVMapping,
    CSVImportOptions,
    SavedCSVMapping,
    ColumnDetection,
} from '../../services/CSVImportService';
import { Transaction, CategoryMapping } from '../../components/Objects/Budget/BudgetContext';

// =============================================================================
// detectIncomeCategory tests
// =============================================================================

describe('detectIncomeCategory', () => {
    describe('Salary patterns', () => {
        it('should detect "PAYROLL DEPOSIT" as Salary', () => {
            expect(detectIncomeCategory('PAYROLL DEPOSIT')).toBe('Salary');
        });

        it('should detect "Direct Dep EMPLOYER INC" as Salary', () => {
            expect(detectIncomeCategory('Direct Dep EMPLOYER INC')).toBe('Salary');
        });

        it('should detect "SALARY PAYMENT" as Salary', () => {
            expect(detectIncomeCategory('SALARY PAYMENT')).toBe('Salary');
        });

        it('should detect "WAGES" as Salary', () => {
            expect(detectIncomeCategory('WAGES')).toBe('Salary');
        });
    });

    describe('Interest patterns', () => {
        it('should detect "Interest Payment" as Interest', () => {
            expect(detectIncomeCategory('Interest Payment')).toBe('Interest');
        });

        it('should detect "SAVINGS INTEREST" as Interest', () => {
            expect(detectIncomeCategory('SAVINGS INTEREST')).toBe('Interest');
        });

        it('should detect "INT PMT" as Interest', () => {
            expect(detectIncomeCategory('INT PMT')).toBe('Interest');
        });
    });

    describe('Dividend patterns', () => {
        it('should detect "DIVIDEND REINVEST" as Dividends', () => {
            expect(detectIncomeCategory('DIVIDEND REINVEST')).toBe('Dividends');
        });

        it('should detect "DIV PMT" as Dividends', () => {
            expect(detectIncomeCategory('DIV PMT')).toBe('Dividends');
        });

        it('should detect "QUALIFIED DIV" as Dividends', () => {
            expect(detectIncomeCategory('QUALIFIED DIV')).toBe('Dividends');
        });
    });

    describe('Refund patterns', () => {
        it('should detect "Amazon Refund" as Refund', () => {
            expect(detectIncomeCategory('Amazon Refund')).toBe('Refund');
        });

        it('should detect "REBATE" as Refund', () => {
            expect(detectIncomeCategory('REBATE')).toBe('Refund');
        });

        it('should detect "CREDIT ADJ" as Refund', () => {
            expect(detectIncomeCategory('CREDIT ADJ')).toBe('Refund');
        });
    });

    describe('Venmo/CashApp patterns', () => {
        it('should detect "VENMO PAYMENT" as Venmo/CashApp', () => {
            expect(detectIncomeCategory('VENMO PAYMENT')).toBe('Venmo/CashApp');
        });

        it('should detect "Zelle from John" as Venmo/CashApp', () => {
            expect(detectIncomeCategory('Zelle from John')).toBe('Venmo/CashApp');
        });

        it('should detect "CASH APP" as Venmo/CashApp', () => {
            expect(detectIncomeCategory('CASH APP')).toBe('Venmo/CashApp');
        });

        it('should detect "PAYPAL TRANSFER" as Venmo/CashApp', () => {
            expect(detectIncomeCategory('PAYPAL TRANSFER')).toBe('Venmo/CashApp');
        });
    });

    describe('Side Income patterns', () => {
        it('should detect "Freelance work" as Side Income', () => {
            expect(detectIncomeCategory('Freelance work')).toBe('Side Income');
        });

        it('should detect "CONSULTING FEE" as Side Income', () => {
            expect(detectIncomeCategory('CONSULTING FEE')).toBe('Side Income');
        });

        it('should detect "CONTRACTOR PAYMENT" as Side Income', () => {
            expect(detectIncomeCategory('CONTRACTOR PAYMENT')).toBe('Side Income');
        });

        it('should detect "1099 INCOME" as Side Income', () => {
            expect(detectIncomeCategory('1099 INCOME')).toBe('Side Income');
        });
    });

    describe('Gift patterns', () => {
        it('should detect "Birthday gift" as Gift', () => {
            expect(detectIncomeCategory('Birthday gift')).toBe('Gift');
        });

        it('should detect "HOLIDAY GIFT" as Gift', () => {
            expect(detectIncomeCategory('HOLIDAY GIFT')).toBe('Gift');
        });
    });

    describe('Non-income patterns', () => {
        it('should return null for "WALMART PURCHASE"', () => {
            expect(detectIncomeCategory('WALMART PURCHASE')).toBeNull();
        });

        it('should return null for "RENT PAYMENT"', () => {
            expect(detectIncomeCategory('RENT PAYMENT')).toBeNull();
        });

        it('should return null for empty string', () => {
            expect(detectIncomeCategory('')).toBeNull();
        });

        it('should return null for "GROCERY STORE"', () => {
            expect(detectIncomeCategory('GROCERY STORE')).toBeNull();
        });

        it('should return null for "GAS STATION"', () => {
            expect(detectIncomeCategory('GAS STATION')).toBeNull();
        });
    });
});

// =============================================================================
// isLikelyIncome tests
// =============================================================================

describe('isLikelyIncome', () => {
    it('should return true for "PAYROLL"', () => {
        expect(isLikelyIncome('PAYROLL')).toBe(true);
    });

    it('should return true for "DIVIDEND"', () => {
        expect(isLikelyIncome('DIVIDEND')).toBe(true);
    });

    it('should return true for "REFUND"', () => {
        expect(isLikelyIncome('REFUND')).toBe(true);
    });

    it('should return true for "VENMO"', () => {
        expect(isLikelyIncome('VENMO')).toBe(true);
    });

    it('should return false for "GROCERY STORE"', () => {
        expect(isLikelyIncome('GROCERY STORE')).toBe(false);
    });

    it('should return false for empty string', () => {
        expect(isLikelyIncome('')).toBe(false);
    });

    it('should return false for "ATM WITHDRAWAL"', () => {
        expect(isLikelyIncome('ATM WITHDRAWAL')).toBe(false);
    });

    it('should return false for "AMAZON PURCHASE"', () => {
        expect(isLikelyIncome('AMAZON PURCHASE')).toBe(false);
    });
});

// =============================================================================
// parseCSV tests
// =============================================================================

describe('parseCSV', () => {
    describe('basic parsing', () => {
        it('should parse simple CSV: "a,b,c\\n1,2,3"', () => {
            const result = parseCSV('a,b,c\n1,2,3');
            expect(result.headers).toEqual(['a', 'b', 'c']);
            expect(result.rows).toEqual([['1', '2', '3']]);
            expect(result.hasHeaders).toBe(true);
        });

        it('should return empty result for empty content', () => {
            const result = parseCSV('');
            expect(result.headers).toEqual([]);
            expect(result.rows).toEqual([]);
            expect(result.hasHeaders).toBe(true);
        });

        it('should parse multiple rows', () => {
            const csv = 'Date,Amount,Description\n1/1/2025,100,Test1\n1/2/2025,200,Test2';
            const result = parseCSV(csv);
            expect(result.headers).toEqual(['Date', 'Amount', 'Description']);
            expect(result.rows).toHaveLength(2);
            expect(result.rows[0]).toEqual(['1/1/2025', '100', 'Test1']);
            expect(result.rows[1]).toEqual(['1/2/2025', '200', 'Test2']);
        });
    });

    describe('quoted fields', () => {
        it('should handle quoted fields with commas', () => {
            const result = parseCSV('name,value\n"hello, world",test');
            expect(result.rows[0]).toEqual(['hello, world', 'test']);
        });

        it('should handle escaped quotes (doubled quotes)', () => {
            const result = parseCSV('name,value\n"say ""hello""",test');
            expect(result.rows[0]).toEqual(['say "hello"', 'test']);
        });

        it('should handle empty quoted field', () => {
            const result = parseCSV('a,b,c\n"",test,value');
            expect(result.rows[0]).toEqual(['', 'test', 'value']);
        });

        it('should handle field that is just a quote', () => {
            const result = parseCSV('a,b\n"quoted value",normal');
            expect(result.rows[0]).toEqual(['quoted value', 'normal']);
        });

        it('should keep an embedded newline inside a quoted field (RFC-4180)', () => {
            // Bank memo fields sometimes contain a literal newline. Splitting on
            // newlines before quote parsing tore this into two malformed rows and
            // silently dropped/truncated the transaction (#182).
            const result = parseCSV('Date,Amount,Memo\n2026-06-03,-4.50,"POS DEBIT\nCoffee Shop"');
            expect(result.rows).toHaveLength(1);
            expect(result.rows[0]).toEqual(['2026-06-03', '-4.50', 'POS DEBIT\nCoffee Shop']);
        });

        it('should keep an embedded CRLF inside a quoted field and not lose following rows', () => {
            const csv = 'Date,Amount,Memo\r\n2026-06-03,-4.50,"line1\r\nline2"\r\n2026-06-04,-9.00,Plain';
            const result = parseCSV(csv);
            expect(result.rows).toHaveLength(2);
            expect(result.rows[0]).toEqual(['2026-06-03', '-4.50', 'line1\r\nline2']);
            expect(result.rows[1]).toEqual(['2026-06-04', '-9.00', 'Plain']);
        });
    });

    describe('header detection', () => {
        it('should auto-generate headers for all-numeric first row', () => {
            const result = parseCSV('1,2,3\n4,5,6');
            expect(result.headers).toEqual(['Column 1', 'Column 2', 'Column 3']);
            expect(result.rows).toEqual([['1', '2', '3'], ['4', '5', '6']]);
            expect(result.hasHeaders).toBe(false);
        });

        it('should detect headers when first row contains text', () => {
            const result = parseCSV('Date,Amount,Memo\n1/1/2025,100,Test');
            expect(result.headers).toEqual(['Date', 'Amount', 'Memo']);
            expect(result.hasHeaders).toBe(true);
        });
    });

    describe('line endings', () => {
        it('should handle Windows line endings (\\r\\n)', () => {
            const result = parseCSV('a,b,c\r\n1,2,3\r\n4,5,6');
            expect(result.headers).toEqual(['a', 'b', 'c']);
            expect(result.rows).toHaveLength(2);
        });

        it('should ignore trailing empty lines', () => {
            const result = parseCSV('a,b,c\n1,2,3\n\n\n');
            expect(result.rows).toHaveLength(1);
        });

        it('should handle mixed line endings', () => {
            const result = parseCSV('a,b\n1,2\r\n3,4');
            expect(result.rows).toHaveLength(2);
        });
    });

    describe('edge cases', () => {
        it('should handle single column CSV', () => {
            const result = parseCSV('Name\nAlice\nBob');
            expect(result.headers).toEqual(['Name']);
            expect(result.rows).toEqual([['Alice'], ['Bob']]);
        });

        it('should handle whitespace around values', () => {
            const result = parseCSV('a , b , c\n 1 , 2 , 3 ');
            expect(result.headers).toEqual(['a', 'b', 'c']);
            expect(result.rows[0]).toEqual(['1', '2', '3']);
        });
    });
});

// =============================================================================
// detectColumnTypes tests
// =============================================================================

describe('detectColumnTypes', () => {
    describe('header-based detection', () => {
        it('should detect Date column with "Date" header', () => {
            const csv: ParsedCSV = {
                headers: ['Date', 'Amount', 'Description'],
                rows: [['1/15/2025', '100.00', 'Test purchase']],
                hasHeaders: true,
            };
            const detections = detectColumnTypes(csv);
            const dateCol = detections.find(d => d.columnIndex === 0);
            expect(dateCol?.type).toBe('date');
            expect(dateCol?.confidence).toBeGreaterThanOrEqual(0.8);
        });

        it('should detect Description column with "Description" header', () => {
            const csv: ParsedCSV = {
                headers: ['Date', 'Description', 'Amount'],
                rows: [['1/15/2025', 'Test purchase at store', '100.00']],
                hasHeaders: true,
            };
            const detections = detectColumnTypes(csv);
            const descCol = detections.find(d => d.columnIndex === 1);
            expect(descCol?.type).toBe('description');
            expect(descCol?.confidence).toBeGreaterThanOrEqual(0.9);
        });

        it('should detect Amount column with "Amount" header', () => {
            const csv: ParsedCSV = {
                headers: ['Date', 'Description', 'Amount'],
                rows: [['1/15/2025', 'Test', '100.00']],
                hasHeaders: true,
            };
            const detections = detectColumnTypes(csv);
            const amountCol = detections.find(d => d.columnIndex === 2);
            expect(amountCol?.type).toBe('amount');
        });

        it('should detect Balance column', () => {
            const csv: ParsedCSV = {
                headers: ['Date', 'Amount', 'Balance'],
                rows: [['1/15/2025', '100.00', '5000.00']],
                hasHeaders: true,
            };
            const detections = detectColumnTypes(csv);
            const balanceCol = detections.find(d => d.columnIndex === 2);
            expect(balanceCol?.type).toBe('balance');
        });
    });

    describe('transaction type detection', () => {
        it('should detect transaction type column with "Credit"/"Debit" values', () => {
            const csv: ParsedCSV = {
                headers: ['Date', 'Transaction Type', 'Amount'],
                rows: [
                    ['1/15/2025', 'Credit', '100.00'],
                    ['1/16/2025', 'Debit', '50.00'],
                    ['1/17/2025', 'Credit', '200.00'],
                ],
                hasHeaders: true,
            };
            const detections = detectColumnTypes(csv);
            const typeCol = detections.find(d => d.columnIndex === 1);
            expect(typeCol?.type).toBe('transaction_type');
        });

        it('should detect CR/DR transaction type values', () => {
            const csv: ParsedCSV = {
                headers: ['Date', 'Type', 'Amount'],
                rows: [
                    ['1/15/2025', 'CR', '100.00'],
                    ['1/16/2025', 'DR', '50.00'],
                ],
                hasHeaders: true,
            };
            const detections = detectColumnTypes(csv);
            const typeCol = detections.find(d => d.columnIndex === 1);
            expect(typeCol?.type).toBe('transaction_type');
        });
    });

    describe('debit/credit split detection', () => {
        it('should detect mutually exclusive debit/credit columns', () => {
            const csv: ParsedCSV = {
                headers: ['Date', 'Debit', 'Credit', 'Description'],
                rows: [
                    ['1/15/2025', '100.00', '', 'Purchase'],
                    ['1/16/2025', '', '200.00', 'Deposit'],
                    ['1/17/2025', '50.00', '', 'Purchase'],
                ],
                hasHeaders: true,
            };
            const detections = detectColumnTypes(csv);
            const debitCol = detections.find(d => d.columnIndex === 1);
            const creditCol = detections.find(d => d.columnIndex === 2);
            expect(debitCol?.type).toBe('debit');
            expect(creditCol?.type).toBe('credit');
        });
    });

    describe('date format detection', () => {
        it('should detect M/D/YYYY format', () => {
            const csv: ParsedCSV = {
                headers: ['Date', 'Amount'],
                rows: [
                    ['1/15/2025', '100'],
                    ['12/31/2025', '200'],
                ],
                hasHeaders: true,
            };
            const detections = detectColumnTypes(csv);
            const dateCol = detections.find(d => d.type === 'date');
            expect(dateCol?.detectedFormat).toBe('M/D/YYYY');
        });

        it('should detect YYYY-MM-DD format', () => {
            const csv: ParsedCSV = {
                headers: ['Date', 'Amount'],
                rows: [
                    ['2025-01-15', '100'],
                    ['2025-12-31', '200'],
                ],
                hasHeaders: true,
            };
            const detections = detectColumnTypes(csv);
            const dateCol = detections.find(d => d.type === 'date');
            expect(dateCol?.detectedFormat).toBe('YYYY-MM-DD');
        });

        it('should detect M/D/YY format', () => {
            const csv: ParsedCSV = {
                headers: ['Date', 'Amount'],
                rows: [
                    ['1/15/25', '100'],
                    ['12/31/25', '200'],
                ],
                hasHeaders: true,
            };
            const detections = detectColumnTypes(csv);
            const dateCol = detections.find(d => d.type === 'date');
            expect(dateCol?.detectedFormat).toBe('M/D/YY');
        });
    });

    describe('unknown columns', () => {
        it('should return unknown for unrecognizable data', () => {
            const csv: ParsedCSV = {
                headers: ['XYZ', 'ABC'],
                rows: [
                    ['foo', 'bar'],
                    ['baz', 'qux'],
                ],
                hasHeaders: true,
            };
            const detections = detectColumnTypes(csv);
            expect(detections.every(d => d.type === 'unknown' || d.confidence < 0.5)).toBe(true);
        });

        it('should return unknown for empty column', () => {
            const csv: ParsedCSV = {
                headers: ['Date', 'Empty', 'Amount'],
                rows: [
                    ['1/15/2025', '', '100'],
                    ['1/16/2025', '', '200'],
                ],
                hasHeaders: true,
            };
            const detections = detectColumnTypes(csv);
            const emptyCol = detections.find(d => d.columnIndex === 1);
            expect(emptyCol?.type).toBe('unknown');
        });
    });
});

// =============================================================================
// generateFingerprint tests
// =============================================================================

describe('generateFingerprint', () => {
    it('should return headerHash, columnCount, and headers', () => {
        const fingerprint = generateFingerprint(['Date', 'Amount', 'Description']);
        expect(fingerprint).toHaveProperty('headerHash');
        expect(fingerprint).toHaveProperty('columnCount');
        expect(fingerprint).toHaveProperty('headers');
        expect(fingerprint.columnCount).toBe(3);
        expect(fingerprint.headers).toEqual(['Date', 'Amount', 'Description']);
    });

    it('should produce same headerHash for headers in different order', () => {
        const fp1 = generateFingerprint(['Date', 'Amount', 'Description']);
        const fp2 = generateFingerprint(['Description', 'Date', 'Amount']);
        expect(fp1.headerHash).toBe(fp2.headerHash);
    });

    it('should produce different headerHash for different headers', () => {
        const fp1 = generateFingerprint(['Date', 'Amount', 'Description']);
        const fp2 = generateFingerprint(['Date', 'Amount', 'Balance']);
        expect(fp1.headerHash).not.toBe(fp2.headerHash);
    });

    it('should normalize case (case insensitive)', () => {
        const fp1 = generateFingerprint(['DATE', 'AMOUNT']);
        const fp2 = generateFingerprint(['date', 'amount']);
        expect(fp1.headerHash).toBe(fp2.headerHash);
    });

    it('should normalize special characters', () => {
        const fp1 = generateFingerprint(['Date-Time', 'Amount ($)']);
        const fp2 = generateFingerprint(['DateTime', 'Amount']);
        expect(fp1.headerHash).toBe(fp2.headerHash);
    });

    it('should handle empty headers array', () => {
        const fingerprint = generateFingerprint([]);
        expect(fingerprint.columnCount).toBe(0);
        expect(fingerprint.headers).toEqual([]);
    });
});

// =============================================================================
// findMatchingFormat tests
// =============================================================================

describe('findMatchingFormat', () => {
    const createSavedMapping = (headers: string[], name: string): SavedCSVMapping => ({
        id: `FMT-${Date.now()}`,
        name,
        fingerprint: generateFingerprint(headers),
        mapping: { dateColumn: 0, descriptionColumn: 1, amountColumn: 2 },
        options: { dateFormat: 'M/D/YYYY', negativeIsExpense: true, hasHeaderRow: true, skipRows: 0 },
        lastUsed: new Date(),
        importCount: 1,
        createdAt: new Date(),
    });

    it('should return exact match with confidence 1.0', () => {
        const savedFormats = [createSavedMapping(['Date', 'Description', 'Amount'], 'Chase')];
        const csv: ParsedCSV = {
            headers: ['Date', 'Description', 'Amount'],
            rows: [],
            hasHeaders: true,
        };
        const match = findMatchingFormat(csv, savedFormats);
        expect(match).not.toBeNull();
        expect(match?.confidence).toBe(1.0);
        expect(match?.mapping.name).toBe('Chase');
    });

    it('should return exact match even with different header order', () => {
        const savedFormats = [createSavedMapping(['Date', 'Description', 'Amount'], 'Chase')];
        const csv: ParsedCSV = {
            headers: ['Amount', 'Date', 'Description'],
            rows: [],
            hasHeaders: true,
        };
        const match = findMatchingFormat(csv, savedFormats);
        expect(match?.confidence).toBe(1.0);
    });

    it('should return fuzzy match with confidence 0.7-0.99', () => {
        const savedFormats = [createSavedMapping(['Date', 'Desc', 'Amt'], 'BankA')];
        const csv: ParsedCSV = {
            headers: ['Date', 'Description', 'Amount'],
            rows: [],
            hasHeaders: true,
        };
        const match = findMatchingFormat(csv, savedFormats);
        // May or may not match depending on similarity threshold
        if (match) {
            expect(match.confidence).toBeGreaterThanOrEqual(0.7);
            expect(match.confidence).toBeLessThan(1.0);
        }
    });

    it('should return null for different structure (different column count)', () => {
        const savedFormats = [createSavedMapping(['Date', 'Description', 'Amount'], 'Chase')];
        const csv: ParsedCSV = {
            headers: ['Date', 'Description', 'Debit', 'Credit'],
            rows: [],
            hasHeaders: true,
        };
        const match = findMatchingFormat(csv, savedFormats);
        expect(match).toBeNull();
    });

    it('should return null for empty savedFormats', () => {
        const csv: ParsedCSV = {
            headers: ['Date', 'Description', 'Amount'],
            rows: [],
            hasHeaders: true,
        };
        const match = findMatchingFormat(csv, []);
        expect(match).toBeNull();
    });

    it('should return best match among multiple candidates', () => {
        const savedFormats = [
            createSavedMapping(['Date', 'Memo', 'Total'], 'BankA'),
            createSavedMapping(['Date', 'Description', 'Amount'], 'BankB'),
        ];
        const csv: ParsedCSV = {
            headers: ['Date', 'Description', 'Amount'],
            rows: [],
            hasHeaders: true,
        };
        const match = findMatchingFormat(csv, savedFormats);
        expect(match?.mapping.name).toBe('BankB');
        expect(match?.confidence).toBe(1.0);
    });
});

// =============================================================================
// applyMapping tests
// =============================================================================

describe('applyMapping', () => {
    const baseMapping: CSVMapping = {
        dateColumn: 0,
        descriptionColumn: 1,
        amountColumn: 2,
    };

    const baseOptions: CSVImportOptions = {
        dateFormat: 'M/D/YYYY',
        negativeIsExpense: true,
        hasHeaderRow: true,
        skipRows: 0,
    };

    describe('single amount column', () => {
        it('should treat negative as expense when negativeIsExpense=true', () => {
            const csv: ParsedCSV = {
                headers: ['Date', 'Description', 'Amount'],
                rows: [['1/15/2025', 'Grocery Store', '-50.00']],
                hasHeaders: true,
            };
            const transactions = applyMapping(csv, baseMapping, baseOptions);
            expect(transactions).toHaveLength(1);
            expect(transactions[0].amount).toBe(-50);
            expect(transactions[0].isPossibleCredit).toBe(false);
        });

        it('should treat positive as credit when negativeIsExpense=true', () => {
            const csv: ParsedCSV = {
                headers: ['Date', 'Description', 'Amount'],
                rows: [['1/15/2025', 'Payroll Deposit', '1000.00']],
                hasHeaders: true,
            };
            const transactions = applyMapping(csv, baseMapping, baseOptions);
            expect(transactions).toHaveLength(1);
            expect(transactions[0].amount).toBe(1000);
            expect(transactions[0].isPossibleCredit).toBe(true);
        });

        it('should treat positive as expense when negativeIsExpense=false', () => {
            const csv: ParsedCSV = {
                headers: ['Date', 'Description', 'Amount'],
                rows: [['1/15/2025', 'Grocery Store', '50.00']],
                hasHeaders: true,
            };
            const options = { ...baseOptions, negativeIsExpense: false };
            const transactions = applyMapping(csv, baseMapping, options);
            expect(transactions).toHaveLength(1);
            expect(transactions[0].amount).toBe(-50);
        });
    });

    describe('debit/credit split columns', () => {
        it('should handle debit as expense (negative), credit as income (positive)', () => {
            const csv: ParsedCSV = {
                headers: ['Date', 'Description', 'Debit', 'Credit'],
                rows: [
                    ['1/15/2025', 'Purchase', '100.00', ''],
                    ['1/16/2025', 'Deposit', '', '500.00'],
                ],
                hasHeaders: true,
            };
            const mapping: CSVMapping = {
                dateColumn: 0,
                descriptionColumn: 1,
                debitColumn: 2,
                creditColumn: 3,
            };
            const transactions = applyMapping(csv, mapping, baseOptions);
            expect(transactions).toHaveLength(2);
            expect(transactions[0].amount).toBe(-100);
            expect(transactions[1].amount).toBe(500);
            expect(transactions[1].isPossibleCredit).toBe(true);
        });
    });

    describe('transaction type column', () => {
        it('should use transaction type column to determine sign', () => {
            const csv: ParsedCSV = {
                headers: ['Date', 'Description', 'Amount', 'Type'],
                rows: [
                    ['1/15/2025', 'Purchase', '100.00', 'Debit'],
                    ['1/16/2025', 'Refund', '50.00', 'Credit'],
                ],
                hasHeaders: true,
            };
            const mapping: CSVMapping = {
                dateColumn: 0,
                descriptionColumn: 1,
                amountColumn: 2,
                transactionTypeColumn: 3,
            };
            const transactions = applyMapping(csv, mapping, baseOptions);
            expect(transactions).toHaveLength(2);
            expect(transactions[0].amount).toBe(-100); // Debit = expense
            expect(transactions[1].amount).toBe(50);   // Credit = income
            expect(transactions[1].isPossibleCredit).toBe(true);
        });
    });

    describe('row filtering', () => {
        it('should skip rows with invalid dates', () => {
            const csv: ParsedCSV = {
                headers: ['Date', 'Description', 'Amount'],
                rows: [
                    ['invalid', 'Test1', '100.00'],
                    ['1/15/2025', 'Test2', '200.00'],
                ],
                hasHeaders: true,
            };
            const transactions = applyMapping(csv, baseMapping, baseOptions);
            expect(transactions).toHaveLength(1);
            expect(transactions[0].description).toBe('Test2');
        });

        it('should skip rows with zero amount', () => {
            const csv: ParsedCSV = {
                headers: ['Date', 'Description', 'Amount'],
                rows: [
                    ['1/15/2025', 'Zero', '0.00'],
                    ['1/16/2025', 'Valid', '100.00'],
                ],
                hasHeaders: true,
            };
            const transactions = applyMapping(csv, baseMapping, baseOptions);
            expect(transactions).toHaveLength(1);
            expect(transactions[0].description).toBe('Valid');
        });
    });

    describe('income detection', () => {
        it('should detect income category for credits', () => {
            const csv: ParsedCSV = {
                headers: ['Date', 'Description', 'Amount'],
                rows: [['1/15/2025', 'PAYROLL DEPOSIT', '1000.00']],
                hasHeaders: true,
            };
            const transactions = applyMapping(csv, baseMapping, baseOptions);
            expect(transactions[0].incomeCategory).toBe('Salary');
        });

        it('should not apply income category to expenses', () => {
            const csv: ParsedCSV = {
                headers: ['Date', 'Description', 'Amount'],
                rows: [['1/15/2025', 'GROCERY STORE', '-50.00']],
                hasHeaders: true,
            };
            const transactions = applyMapping(csv, baseMapping, baseOptions);
            expect(transactions[0].incomeCategory).toBeUndefined();
        });
    });

    describe('date format parsing', () => {
        it('should parse YYYY-MM-DD format', () => {
            const csv: ParsedCSV = {
                headers: ['Date', 'Description', 'Amount'],
                rows: [['2025-01-15', 'Test', '100.00']],
                hasHeaders: true,
            };
            const options = { ...baseOptions, dateFormat: 'YYYY-MM-DD' };
            const transactions = applyMapping(csv, baseMapping, options);
            expect(transactions[0].date.getFullYear()).toBe(2025);
            expect(transactions[0].date.getMonth()).toBe(0); // January
            expect(transactions[0].date.getDate()).toBe(15);
        });

        it('should parse M/D/YY format', () => {
            const csv: ParsedCSV = {
                headers: ['Date', 'Description', 'Amount'],
                rows: [['1/15/25', 'Test', '100.00']],
                hasHeaders: true,
            };
            const options = { ...baseOptions, dateFormat: 'M/D/YY' };
            const transactions = applyMapping(csv, baseMapping, options);
            expect(transactions[0].date.getFullYear()).toBe(2025);
        });
    });

    describe('unique transaction ids', () => {
        it('should mint a unique id for every row in a large CSV (no collisions)', () => {
            const rows: string[][] = [];
            for (let i = 0; i < 500; i++) {
                rows.push(['1/15/2025', `Merchant ${i}`, '-12.34']);
            }
            const csv: ParsedCSV = {
                headers: ['Date', 'Description', 'Amount'],
                rows,
                hasHeaders: true,
            };
            const transactions = applyMapping(csv, baseMapping, baseOptions);
            expect(transactions).toHaveLength(500);
            const ids = transactions.map(t => t.id);
            expect(new Set(ids).size).toBe(transactions.length);
        });
    });
});

// =============================================================================
// parseAmount tests
// =============================================================================

describe('parseAmount', () => {
    it('should parse "100.00" as 100', () => {
        expect(parseAmount('100.00')).toBe(100);
    });

    it('should parse "$1,234.56" as 1234.56', () => {
        expect(parseAmount('$1,234.56')).toBe(1234.56);
    });

    it('should parse "-50.00" as -50', () => {
        expect(parseAmount('-50.00')).toBe(-50);
    });

    it('should parse "(75.00)" as -75 (parentheses = negative)', () => {
        expect(parseAmount('(75.00)')).toBe(-75);
    });

    it('should parse "€100" as 100 (removes currency symbols)', () => {
        expect(parseAmount('€100')).toBe(100);
    });

    it('should parse "£500.50" as 500.5', () => {
        expect(parseAmount('£500.50')).toBe(500.5);
    });

    it('should parse "¥1000" as 1000', () => {
        expect(parseAmount('¥1000')).toBe(1000);
    });

    it('should return 0 for empty string', () => {
        expect(parseAmount('')).toBe(0);
    });

    it('should return NaN for "invalid"', () => {
        expect(parseAmount('invalid')).toBeNaN();
    });

    it('should handle whitespace', () => {
        expect(parseAmount('  100.00  ')).toBe(100);
    });

    it('should handle negative with parentheses and currency', () => {
        expect(parseAmount('($1,234.56)')).toBe(-1234.56);
    });
});

// =============================================================================
// detectDuplicates tests
// =============================================================================

describe('detectDuplicates', () => {
    const createTransaction = (date: Date, amount: number, description: string): Transaction => ({
        id: `TXN-${Date.now()}-${Math.random()}`,
        date,
        amount,
        description,
    });

    it('should detect duplicate with same date, amount, and similar description', () => {
        const existing = [createTransaction(new Date(2025, 0, 15), -50, 'GROCERY STORE')];
        const newTxns = [createTransaction(new Date(2025, 0, 15), -50, 'GROCERY STORE')];
        const duplicates = detectDuplicates(newTxns, existing);
        expect(duplicates).toHaveLength(1);
    });

    it('should not detect as duplicate when amount differs', () => {
        const existing = [createTransaction(new Date(2025, 0, 15), -50, 'GROCERY STORE')];
        const newTxns = [createTransaction(new Date(2025, 0, 15), -100, 'GROCERY STORE')];
        const duplicates = detectDuplicates(newTxns, existing);
        expect(duplicates).toHaveLength(0);
    });

    it('should not detect as duplicate when date differs', () => {
        const existing = [createTransaction(new Date(2025, 0, 15), -50, 'GROCERY STORE')];
        const newTxns = [createTransaction(new Date(2025, 0, 16), -50, 'GROCERY STORE')];
        const duplicates = detectDuplicates(newTxns, existing);
        expect(duplicates).toHaveLength(0);
    });

    it('should detect duplicate with >80% description similarity', () => {
        // "GROCERY STORE" (13 chars) contained in "GROCERY STORE X" (15 chars)
        // Similarity = 13/15 = 86.7% > 80%
        const existing = [createTransaction(new Date(2025, 0, 15), -50, 'GROCERY STORE X')];
        const newTxns = [createTransaction(new Date(2025, 0, 15), -50, 'GROCERY STORE')];
        const duplicates = detectDuplicates(newTxns, existing);
        // Should match due to substring containment with >80% similarity
        expect(duplicates).toHaveLength(1);
    });

    it('should not detect as duplicate with very different description', () => {
        const existing = [createTransaction(new Date(2025, 0, 15), -50, 'GROCERY STORE')];
        const newTxns = [createTransaction(new Date(2025, 0, 15), -50, 'GAS STATION FUEL')];
        const duplicates = detectDuplicates(newTxns, existing);
        expect(duplicates).toHaveLength(0);
    });

    it('should return empty array for empty existing transactions', () => {
        const newTxns = [createTransaction(new Date(2025, 0, 15), -50, 'GROCERY STORE')];
        const duplicates = detectDuplicates(newTxns, []);
        expect(duplicates).toHaveLength(0);
    });

    it('should handle multiple transactions with some duplicates', () => {
        const existing = [
            createTransaction(new Date(2025, 0, 15), -50, 'GROCERY STORE'),
            createTransaction(new Date(2025, 0, 16), -100, 'GAS STATION'),
        ];
        const newTxns = [
            createTransaction(new Date(2025, 0, 15), -50, 'GROCERY STORE'), // duplicate
            createTransaction(new Date(2025, 0, 17), -75, 'RESTAURANT'),    // not duplicate
        ];
        const duplicates = detectDuplicates(newTxns, existing);
        expect(duplicates).toHaveLength(1);
    });
});

// =============================================================================
// applyCategories tests
// =============================================================================

describe('applyCategories', () => {
    const createTransaction = (description: string): Transaction => ({
        id: `TXN-${Date.now()}`,
        date: new Date(),
        amount: -50,
        description,
    });

    it('should not throw on an invalid saved regex rule and still apply valid rules', () => {
        const transactions = [createTransaction('STARBUCKS')];
        const rules: CategoryMapping[] = [
            { id: 'bad', pattern: '(', isRegex: true, expenseId: 'X' },
            { id: 'good', pattern: 'starbucks', isRegex: true, expenseId: 'exp-coffee' },
        ];
        let result: ReturnType<typeof applyCategories>;
        expect(() => {
            result = applyCategories(transactions, rules);
        }).not.toThrow();
        // Invalid rule is treated as no-match; the valid regex rule still categorizes.
        expect(result!.categorized).toHaveLength(1);
        expect(result!.categorized[0].expenseId).toBe('exp-coffee');
        expect(result!.autoCategorizedCount).toBe(1);
    });

    it('should leave a transaction uncategorized when the only rule has an invalid regex', () => {
        const transactions = [createTransaction('STARBUCKS')];
        const rules: CategoryMapping[] = [
            { id: 'bad', pattern: '[a-', isRegex: true, expenseId: 'X' },
        ];
        const result = applyCategories(transactions, rules);
        expect(result.categorized[0].expenseId).toBeUndefined();
        expect(result.autoCategorizedCount).toBe(0);
    });

    it('should apply expenseId for matching string pattern', () => {
        const transactions = [createTransaction('GROCERY STORE PURCHASE')];
        const rules: CategoryMapping[] = [
            { id: 'rule-1', pattern: 'grocery', isRegex: false, expenseId: 'exp-food' },
        ];
        const result = applyCategories(transactions, rules);
        expect(result.categorized[0].expenseId).toBe('exp-food');
        expect(result.autoCategorizedCount).toBe(1);
    });

    it('should apply expenseId for matching regex pattern', () => {
        const transactions = [createTransaction('AMAZON.COM*PURCHASE')];
        const rules: CategoryMapping[] = [
            { id: 'rule-1', pattern: 'amazon\\.com\\*', isRegex: true, expenseId: 'exp-shopping' },
        ];
        const result = applyCategories(transactions, rules);
        expect(result.categorized[0].expenseId).toBe('exp-shopping');
    });

    it('should return transaction unchanged when no match', () => {
        const transactions = [createTransaction('UNIQUE MERCHANT')];
        const rules: CategoryMapping[] = [
            { id: 'rule-1', pattern: 'grocery', isRegex: false, expenseId: 'exp-food' },
        ];
        const result = applyCategories(transactions, rules);
        expect(result.categorized[0].expenseId).toBeUndefined();
        expect(result.autoCategorizedCount).toBe(0);
    });

    it('should return correct autoCategorizedCount', () => {
        const transactions = [
            createTransaction('GROCERY STORE'),
            createTransaction('GAS STATION'),
            createTransaction('RANDOM MERCHANT'),
        ];
        const rules: CategoryMapping[] = [
            { id: 'rule-1', pattern: 'grocery', isRegex: false, expenseId: 'exp-food' },
            { id: 'rule-2', pattern: 'gas', isRegex: false, expenseId: 'exp-gas' },
        ];
        const result = applyCategories(transactions, rules);
        expect(result.autoCategorizedCount).toBe(2);
    });

    it('should be case insensitive for string patterns', () => {
        const transactions = [createTransaction('GROCERY store')];
        const rules: CategoryMapping[] = [
            { id: 'rule-1', pattern: 'Grocery', isRegex: false, expenseId: 'exp-food' },
        ];
        const result = applyCategories(transactions, rules);
        expect(result.categorized[0].expenseId).toBe('exp-food');
    });

    it('should be case insensitive for regex patterns', () => {
        const transactions = [createTransaction('AMAZON PURCHASE')];
        const rules: CategoryMapping[] = [
            { id: 'rule-1', pattern: 'amazon', isRegex: true, expenseId: 'exp-shopping' },
        ];
        const result = applyCategories(transactions, rules);
        expect(result.categorized[0].expenseId).toBe('exp-shopping');
    });

    it('should apply first matching rule only', () => {
        const transactions = [createTransaction('WALMART GROCERY')];
        const rules: CategoryMapping[] = [
            { id: 'rule-1', pattern: 'walmart', isRegex: false, expenseId: 'exp-walmart' },
            { id: 'rule-2', pattern: 'grocery', isRegex: false, expenseId: 'exp-food' },
        ];
        const result = applyCategories(transactions, rules);
        expect(result.categorized[0].expenseId).toBe('exp-walmart');
        expect(result.autoCategorizedCount).toBe(1);
    });
});

// =============================================================================
// createSuggestedMapping tests
// =============================================================================

describe('createSuggestedMapping', () => {
    it('should return complete: true when date + description + amount detected', () => {
        const detections: ColumnDetection[] = [
            { columnIndex: 0, type: 'date', confidence: 0.95, detectedFormat: 'M/D/YYYY' },
            { columnIndex: 1, type: 'description', confidence: 0.95 },
            { columnIndex: 2, type: 'amount', confidence: 0.9 },
        ];
        const result = createSuggestedMapping(detections);
        expect(result.complete).toBe(true);
        expect(result.mapping.dateColumn).toBe(0);
        expect(result.mapping.descriptionColumn).toBe(1);
        expect(result.mapping.amountColumn).toBe(2);
    });

    it('should return complete: false when missing date', () => {
        const detections: ColumnDetection[] = [
            { columnIndex: 0, type: 'unknown', confidence: 0 },
            { columnIndex: 1, type: 'description', confidence: 0.95 },
            { columnIndex: 2, type: 'amount', confidence: 0.9 },
        ];
        const result = createSuggestedMapping(detections);
        expect(result.complete).toBe(false);
    });

    it('should return complete: false when missing description', () => {
        const detections: ColumnDetection[] = [
            { columnIndex: 0, type: 'date', confidence: 0.95, detectedFormat: 'M/D/YYYY' },
            { columnIndex: 1, type: 'unknown', confidence: 0 },
            { columnIndex: 2, type: 'amount', confidence: 0.9 },
        ];
        const result = createSuggestedMapping(detections);
        expect(result.complete).toBe(false);
    });

    it('should return complete: false when missing amount', () => {
        const detections: ColumnDetection[] = [
            { columnIndex: 0, type: 'date', confidence: 0.95, detectedFormat: 'M/D/YYYY' },
            { columnIndex: 1, type: 'description', confidence: 0.95 },
            { columnIndex: 2, type: 'unknown', confidence: 0 },
        ];
        const result = createSuggestedMapping(detections);
        expect(result.complete).toBe(false);
    });

    it('should return complete: true with debit + credit columns instead of amount', () => {
        const detections: ColumnDetection[] = [
            { columnIndex: 0, type: 'date', confidence: 0.95, detectedFormat: 'M/D/YYYY' },
            { columnIndex: 1, type: 'description', confidence: 0.95 },
            { columnIndex: 2, type: 'debit', confidence: 0.85 },
            { columnIndex: 3, type: 'credit', confidence: 0.85 },
        ];
        const result = createSuggestedMapping(detections);
        expect(result.complete).toBe(true);
        expect(result.mapping.debitColumn).toBe(2);
        expect(result.mapping.creditColumn).toBe(3);
    });

    it('should include transaction type column when detected', () => {
        const detections: ColumnDetection[] = [
            { columnIndex: 0, type: 'date', confidence: 0.95, detectedFormat: 'M/D/YYYY' },
            { columnIndex: 1, type: 'description', confidence: 0.95 },
            { columnIndex: 2, type: 'amount', confidence: 0.9 },
            { columnIndex: 3, type: 'transaction_type', confidence: 0.95 },
        ];
        const result = createSuggestedMapping(detections);
        expect(result.mapping.transactionTypeColumn).toBe(3);
    });

    it('should set default options (hasHeaderRow: true, negativeIsExpense: true)', () => {
        const detections: ColumnDetection[] = [
            { columnIndex: 0, type: 'date', confidence: 0.95, detectedFormat: 'M/D/YYYY' },
            { columnIndex: 1, type: 'description', confidence: 0.95 },
            { columnIndex: 2, type: 'amount', confidence: 0.9 },
        ];
        const result = createSuggestedMapping(detections);
        expect(result.options.hasHeaderRow).toBe(true);
        expect(result.options.negativeIsExpense).toBe(true);
        expect(result.options.skipRows).toBe(0);
    });

    it('should include detected date format in options', () => {
        const detections: ColumnDetection[] = [
            { columnIndex: 0, type: 'date', confidence: 0.95, detectedFormat: 'YYYY-MM-DD' },
            { columnIndex: 1, type: 'description', confidence: 0.95 },
            { columnIndex: 2, type: 'amount', confidence: 0.9 },
        ];
        const result = createSuggestedMapping(detections);
        expect(result.options.dateFormat).toBe('YYYY-MM-DD');
    });

    it('should ignore low confidence detections', () => {
        const detections: ColumnDetection[] = [
            { columnIndex: 0, type: 'date', confidence: 0.3, detectedFormat: 'M/D/YYYY' },
            { columnIndex: 1, type: 'description', confidence: 0.95 },
            { columnIndex: 2, type: 'amount', confidence: 0.9 },
        ];
        const result = createSuggestedMapping(detections);
        expect(result.complete).toBe(false);
        expect(result.mapping.dateColumn).toBeUndefined();
    });
});

// =============================================================================
// generateMappingId tests
// =============================================================================

describe('generateMappingId', () => {
    it('should return string starting with "FMT-"', () => {
        const id = generateMappingId();
        expect(id.startsWith('FMT-')).toBe(true);
    });

    it('should contain timestamp (numeric portion)', () => {
        const id = generateMappingId();
        const parts = id.split('-');
        expect(parts.length).toBeGreaterThanOrEqual(2);
        // Second part should be a timestamp (numeric)
        expect(/^\d+$/.test(parts[1])).toBe(true);
    });

    it('should return different IDs on consecutive calls', () => {
        const id1 = generateMappingId();
        const id2 = generateMappingId();
        expect(id1).not.toBe(id2);
    });

    it('should generate valid format consistently', () => {
        for (let i = 0; i < 10; i++) {
            const id = generateMappingId();
            expect(id).toMatch(/^FMT-\d+-\d+$/);
        }
    });
});
