import { describe, it, expect } from 'vitest';
import {
    computeStatementCompare,
    getKnownSources,
} from '../../../tabs/Budget/reconcile/reconcileUtils';
import { type Transaction, type MonthlySnapshot } from '../../../components/Objects/Budget/BudgetContext';

function txn(partial: Partial<Transaction> & Pick<Transaction, 'id' | 'date' | 'amount'>): Transaction {
    return { description: '', ...partial };
}

function snapshot(month: number, year: number, transactions: Transaction[]): MonthlySnapshot {
    return {
        id: `M-${year}-${month}`,
        month,
        year,
        spending: {},
        accountBalances: {},
        contributions: {},
        transactions,
        reconciled: false,
        createdAt: new Date(year, month - 1, 1),
        updatedAt: new Date(year, month - 1, 1),
    };
}

describe('computeStatementCompare', () => {
    it('sums charges, credits and net for the matching source', () => {
        const months = [
            snapshot(1, 2026, [
                txn({ id: 'a', date: new Date(2026, 0, 5), amount: -100, source: 'Rewards Card' }),
                txn({ id: 'b', date: new Date(2026, 0, 10), amount: -25, source: 'Rewards Card' }),
                txn({ id: 'c', date: new Date(2026, 0, 12), amount: 30, source: 'Rewards Card' }), // refund
                txn({ id: 'd', date: new Date(2026, 0, 12), amount: -999, source: 'Travel Card' }), // other card
            ]),
        ];

        const r = computeStatementCompare(months, { source: 'Rewards Card' });
        expect(r.count).toBe(3);
        expect(r.charges).toBe(125);
        expect(r.credits).toBe(30);
        expect(r.net).toBe(95);
        expect(r.transactions.map(t => t.id)).toEqual(['a', 'b', 'c']);
    });

    it('gathers transactions across month snapshots when the window straddles months', () => {
        const months = [
            snapshot(1, 2026, [
                txn({ id: 'jan', date: new Date(2026, 0, 20), amount: -40, source: 'Rewards Card' }),
            ]),
            snapshot(2, 2026, [
                txn({ id: 'feb', date: new Date(2026, 1, 8), amount: -60, source: 'Rewards Card' }),
            ]),
        ];

        const r = computeStatementCompare(months, {
            source: 'Rewards Card',
            start: new Date(2026, 0, 15),
            end: new Date(2026, 1, 14),
        });
        expect(r.count).toBe(2);
        expect(r.charges).toBe(100);
    });

    it('treats the date range as inclusive on both ends', () => {
        const months = [
            snapshot(1, 2026, [
                txn({ id: 'before', date: new Date(2026, 0, 4), amount: -10, source: 'Rewards Card' }),
                txn({ id: 'start', date: new Date(2026, 0, 5), amount: -10, source: 'Rewards Card' }),
                txn({ id: 'end', date: new Date(2026, 0, 15), amount: -10, source: 'Rewards Card' }),
                txn({ id: 'after', date: new Date(2026, 0, 16), amount: -10, source: 'Rewards Card' }),
            ]),
        ];

        const r = computeStatementCompare(months, {
            source: 'Rewards Card',
            start: new Date(2026, 0, 5),
            end: new Date(2026, 0, 15),
        });
        expect(r.transactions.map(t => t.id)).toEqual(['start', 'end']);
    });

    it('matches untagged transactions when source is empty, and excludes them otherwise', () => {
        const months = [
            snapshot(1, 2026, [
                txn({ id: 'tagged', date: new Date(2026, 0, 5), amount: -10, source: 'Rewards Card' }),
                txn({ id: 'untagged', date: new Date(2026, 0, 6), amount: -20 }),
            ]),
        ];

        expect(computeStatementCompare(months, { source: 'Rewards Card' }).transactions.map(t => t.id)).toEqual(['tagged']);
        expect(computeStatementCompare(months, { source: '' }).transactions.map(t => t.id)).toEqual(['untagged']);
    });

    it('windows and sorts on postedDate when present, falling back to date (#163)', () => {
        // Swiped June 30, posted July 2 — belongs to a July 1–31 statement.
        const straddler = txn({
            id: 'straddler', date: new Date(2026, 5, 30), postedDate: new Date(2026, 6, 2),
            amount: -50, source: 'Rewards Card',
        });
        // Posted-date-less row (pre-#163 or bank sent no transacted_at): date IS the posted date.
        const plain = txn({ id: 'plain', date: new Date(2026, 6, 10), amount: -20, source: 'Rewards Card' });
        const months = [
            snapshot(6, 2026, [straddler]),
            snapshot(7, 2026, [plain]),
        ];

        // June window: the straddler posted in July, so it must NOT appear.
        const june = computeStatementCompare(months, {
            source: 'Rewards Card', start: new Date(2026, 5, 1), end: new Date(2026, 5, 30),
        });
        expect(june.count).toBe(0);

        // July window: both rows, ordered by posted basis (Jul 2 before Jul 10).
        const july = computeStatementCompare(months, {
            source: 'Rewards Card', start: new Date(2026, 6, 1), end: new Date(2026, 6, 31),
        });
        expect(july.transactions.map(t => t.id)).toEqual(['straddler', 'plain']);
        expect(july.charges).toBe(70);
    });

    it('returns zeros when nothing matches', () => {
        const months = [snapshot(1, 2026, [txn({ id: 'a', date: new Date(2026, 0, 5), amount: -10, source: 'Rewards Card' })])];
        const r = computeStatementCompare(months, { source: 'Nope' });
        expect(r).toMatchObject({ count: 0, charges: 0, credits: 0, net: 0 });
    });
});

describe('getKnownSources', () => {
    it('returns distinct, non-empty source labels sorted case-insensitively', () => {
        const months = [
            snapshot(1, 2026, [
                txn({ id: 'a', date: new Date(2026, 0, 1), amount: -1, source: 'travel card' }),
                txn({ id: 'b', date: new Date(2026, 0, 2), amount: -1, source: 'Rewards Card' }),
                txn({ id: 'c', date: new Date(2026, 0, 3), amount: -1, source: 'travel card' }),
                txn({ id: 'd', date: new Date(2026, 0, 4), amount: -1, source: '  ' }),
                txn({ id: 'e', date: new Date(2026, 0, 5), amount: -1 }),
            ]),
        ];
        expect(getKnownSources(months)).toEqual(['Rewards Card', 'travel card']);
    });
});
