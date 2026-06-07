import { describe, it, expect } from 'vitest';
import {
    applyTransactions,
    applyBalances,
    makeTransaction,
    MergeBlob,
} from '../../services/backupMerge';
import type { Transaction, MonthlySnapshot } from '../../components/Objects/Budget/BudgetTypes';

// --- builders -------------------------------------------------------------

function txn(p: { id: string; date: string; amount: number; description: string } & Partial<Omit<Transaction, 'date'>>): Transaction {
    // Blob transactions carry ISO-string dates at runtime (post JSON.parse); the
    // Transaction type declares Date, so cast at this test boundary.
    return { ...p } as unknown as Transaction;
}

function month(p: Partial<MonthlySnapshot> & { id: string; month: number; year: number; transactions: Transaction[] }): MonthlySnapshot {
    return {
        spending: {}, accountBalances: {}, contributions: {},
        reconciled: false, createdAt: new Date(), updatedAt: new Date(),
        ...p,
    } as MonthlySnapshot;
}

function v2Blob(): MergeBlob {
    return {
        version: 2,
        accounts: [
            { id: 'acct-checking', name: 'Checking Account', amount: 1000 },
            { id: 'roth', name: 'Roth 401k', amount: 30000 },
            { id: 'trad', name: 'Traditional 401k', amount: 90000 },
        ],
        amountHistory: {},
        budget: {
            months: [
                month({
                    id: 'M1', month: 1, year: 2026,
                    transactions: [
                        txn({ id: 'e1', date: '2026-01-05', amount: -42.0, description: 'WHOLE FOODS MARKET' }),
                    ],
                }),
            ],
            importSettings: {
                dateColumn: '', amountColumn: '', descriptionColumn: '',
                categoryMappings: [{ id: 'r1', pattern: 'whole foods', expenseId: 'groceries' }],
                savedCSVFormats: [], autoCreateRules: false,
            },
            selectedMonth: 1, selectedYear: 2026,
        },
        balanceAccountMap: {
            'Checking Account (1234)': ['acct-checking'],
            'Brokerage 401(k)': ['roth', 'trad'],
        },
    };
}

// --- applyTransactions ----------------------------------------------------

describe('applyTransactions', () => {
    it('categorizes, dedupes against existing, buckets by month, and appends', () => {
        const blob = v2Blob();
        const incoming: Transaction[] = [
            // Duplicate of the existing WHOLE FOODS txn (same date, amount, desc).
            txn({ id: 'n1', date: '2026-01-05', amount: -42.0, description: 'WHOLE FOODS MARKET' }),
            // New, matches the category rule -> auto-categorized to 'groceries'.
            txn({ id: 'n2', date: '2026-01-09', amount: -18.5, description: 'WHOLE FOODS MARKET' }),
            // New, different month -> creates a Feb snapshot.
            txn({ id: 'n3', date: '2026-02-02', amount: -75.0, description: 'SHELL GAS' }),
        ];

        const report = applyTransactions(blob, incoming);

        expect(report.duplicatesSkipped).toBe(1);
        expect(report.added).toBe(2);
        expect(report.autoCategorized).toBe(2); // both WHOLE FOODS rows match the rule
        expect(report.byMonth).toEqual({ '2026-1': 1, '2026-2': 1 });

        const jan = blob.budget!.months.find(m => m.month === 1 && m.year === 2026)!;
        const feb = blob.budget!.months.find(m => m.month === 2 && m.year === 2026)!;
        expect(jan.transactions.map(t => t.id)).toEqual(['e1', 'n2']);
        expect(jan.transactions.find(t => t.id === 'n2')!.expenseId).toBe('groceries');
        expect(feb).toBeDefined();
        expect(feb.transactions.map(t => t.id)).toEqual(['n3']);
    });

    it('id-dedup keeps distinct same-day/same-amount charges, drops true re-fetches', () => {
        const blob = v2Blob();
        // Two genuinely distinct $5 coffees same day, plus a re-fetch of an existing id.
        const c1 = makeTransaction({ id: 'sf-100', date: '2026-01-12', amount: -5, description: 'BLUE BOTTLE' });
        const c2 = makeTransaction({ id: 'sf-101', date: '2026-01-12', amount: -5, description: 'BLUE BOTTLE' });
        applyTransactions(blob, [c1, c2], { dedup: 'id' });

        // Re-run with the same two ids plus a new one — only the new one lands.
        const c3 = makeTransaction({ id: 'sf-102', date: '2026-01-13', amount: -5, description: 'BLUE BOTTLE' });
        const report = applyTransactions(blob, [c1, c2, c3], { dedup: 'id' });

        expect(report.added).toBe(1);
        expect(report.duplicatesSkipped).toBe(2);
        const jan = blob.budget!.months.find(m => m.month === 1 && m.year === 2026)!;
        expect(jan.transactions.filter(t => t.description === 'BLUE BOTTLE').map(t => t.id))
            .toEqual(['sf-100', 'sf-101', 'sf-102']);
    });

    it('makeTransaction flags credits and builds a local-midnight date', () => {
        const expense = makeTransaction({ id: 'a', date: '2026-04-01', amount: -20, description: 'TARGET' });
        expect(expense.isPossibleCredit).toBe(false);
        expect(expense.incomeCategory).toBeUndefined();
        // Local midnight -> getMonth() is April (3) regardless of runner TZ offset.
        expect((expense.date as Date).getMonth()).toBe(3);
        expect((expense.date as Date).getDate()).toBe(1);

        const credit = makeTransaction({ id: 'b', date: '2026-04-02', amount: 1500, description: 'ACME PAYROLL DIRECT DEP' });
        expect(credit.isPossibleCredit).toBe(true);
    });

    it('tolerates a v1 blob with no budget container', () => {
        const blob: MergeBlob = { version: 1, accounts: [], amountHistory: {} };
        const report = applyTransactions(blob, [
            txn({ id: 'a', date: '2026-03-01', amount: -10, description: 'COFFEE' }),
        ]);
        expect(report.added).toBe(1);
        expect(blob.budget!.months[0].transactions[0].id).toBe('a');
    });
});

// --- applyBalances --------------------------------------------------------

describe('applyBalances', () => {
    it('single-target: writes both account.amount and a history snapshot', () => {
        const blob = v2Blob();
        const report = applyBalances(blob, [{ account: 'Checking Account (1234)', balance: 1234.56 }], { date: '2026-06-01' });

        expect(blob.accounts.find(a => a.id === 'acct-checking')!.amount).toBe(1234.56);
        expect(blob.amountHistory['acct-checking']).toEqual([{ date: '2026-06-01', num: 1234.56 }]);
        expect(report.updated).toEqual([{ id: 'acct-checking', name: 'Checking Account', amount: 1234.56 }]);
        expect(report.flagged).toEqual([]);
    });

    it('same-day re-apply replaces the snapshot (idempotent per day)', () => {
        const blob = v2Blob();
        applyBalances(blob, [{ account: 'Checking Account (1234)', balance: 100 }], { date: '2026-06-01' });
        applyBalances(blob, [{ account: 'Checking Account (1234)', balance: 200 }], { date: '2026-06-01' });
        expect(blob.amountHistory['acct-checking']).toEqual([{ date: '2026-06-01', num: 200 }]);
        applyBalances(blob, [{ account: 'Checking Account (1234)', balance: 250 }], { date: '2026-06-02' });
        expect(blob.amountHistory['acct-checking']).toEqual([
            { date: '2026-06-01', num: 200 },
            { date: '2026-06-02', num: 250 },
        ]);
    });

    it('multi-target: splits by current-balance weight and sums exactly', () => {
        const blob = v2Blob(); // roth=30000, trad=90000 -> 25% / 75%
        const report = applyBalances(blob, [{ account: 'Brokerage 401(k)', balance: 200000 }], { date: '2026-06-01' });

        const roth = blob.accounts.find(a => a.id === 'roth')!.amount!;
        const trad = blob.accounts.find(a => a.id === 'trad')!.amount!;
        expect(roth).toBeCloseTo(50000, 2);
        expect(trad).toBeCloseTo(150000, 2);
        expect(round2(roth + trad)).toBe(200000);
        expect(report.flagged).toEqual([{ account: 'Brokerage 401(k)', reason: 'multi-target-split' }]);
    });

    it('flags unmapped rows and leaves accounts untouched', () => {
        const blob = v2Blob();
        const report = applyBalances(blob, [{ account: 'Unknown Bank XYZ', balance: 5 }], { date: '2026-06-01' });
        expect(report.updated).toEqual([]);
        expect(report.flagged).toEqual([{ account: 'Unknown Bank XYZ', reason: 'unmapped' }]);
    });
});

function round2(n: number): number {
    return Math.round(n * 100) / 100;
}
