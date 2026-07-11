/**
 * Projection memory capture (#63): freeze the projected net-worth curve once a
 * month so we can later compare predictions to reality.
 */
import { describe, it, expect } from 'vitest';
import { captureSnapshot, extractNetWorthCurve, actualNetWorthByYear, type ProjectionSnapshot } from '../../services/projectionHistory';
import { SavedAccount, DebtAccount } from '../../components/Objects/Accounts/models';
import type { SimulationYear } from '../../components/Objects/Assumptions/SimulationEngine';

function year(y: number, cash: number, debt = 0, isEOY = false): SimulationYear {
    return {
        year: y,
        isEndOfYearProjection: isEOY,
        accounts: [
            new SavedAccount('a', 'Cash', cash, 0),
            ...(debt > 0 ? [new DebtAccount('d', 'Loan', debt, 'EXP', 5)] : []),
        ],
        // The capture only reads .year / .isEndOfYearProjection / .accounts.
    } as unknown as SimulationYear;
}

const sim = [year(2026, 100000), year(2027, 110000, 10000), year(2028, 120000), year(2029, 130000, 0, true)];

describe('extractNetWorthCurve', () => {
    it('computes net worth per real year and drops EOY rows', () => {
        const curve = extractNetWorthCurve(sim);
        expect(curve).toEqual([
            { year: 2026, netWorth: 100000 },
            { year: 2027, netWorth: 100000 }, // 110k cash − 10k debt
            { year: 2028, netWorth: 120000 },
        ]);
    });
});

describe('captureSnapshot', () => {
    const jan = new Date(2026, 0, 15);
    const febSameYear = new Date(2026, 1, 3);

    it('appends a snapshot for a month not yet captured', () => {
        const next = captureSnapshot(sim, [], jan);
        expect(next).toHaveLength(1);
        expect(next[0].capturedYearMonth).toBe('2026-01');
        expect(next[0].netWorthByYear).toHaveLength(3);
    });

    it('is a no-op (same reference) when this month is already captured', () => {
        const first = captureSnapshot(sim, [], jan);
        const again = captureSnapshot(sim, first, new Date(2026, 0, 28)); // still Jan
        expect(again).toBe(first);
    });

    it('captures a new month', () => {
        const first = captureSnapshot(sim, [], jan);
        const second = captureSnapshot(sim, first, febSameYear);
        expect(second).toHaveLength(2);
        expect(second.map(s => s.capturedYearMonth)).toEqual(['2026-01', '2026-02']);
    });

    it('does nothing for an empty simulation', () => {
        const existing: ProjectionSnapshot[] = [];
        expect(captureSnapshot([], existing, jan)).toBe(existing);
    });

    it('caps the history, dropping the oldest', () => {
        let history: ProjectionSnapshot[] = [];
        // 130 monthly captures > MAX (120)
        for (let i = 0; i < 130; i++) {
            history = captureSnapshot(sim, history, new Date(2026 + Math.floor(i / 12), i % 12, 10));
        }
        expect(history.length).toBe(120);
        // oldest dropped: first kept is 10 months in
        expect(history[0].capturedYearMonth).toBe(`${2026}-11`);
    });
});

describe('actualNetWorthByYear', () => {
    const accounts = [
        new SavedAccount('cash', 'Cash', 0, 0),
        new DebtAccount('loan', 'Loan', 0, 'EXP', 5),
    ];

    it('sums the latest balance per year, debts negative', () => {
        const history = {
            cash: [{ date: '2025-03-01', num: 100000 }, { date: '2025-09-01', num: 110000 }, { date: '2026-02-01', num: 130000 }],
            loan: [{ date: '2025-03-01', num: 20000 }, { date: '2026-01-15', num: 15000 }],
        };
        expect(actualNetWorthByYear(accounts, history)).toEqual([
            { year: 2025, netWorth: 110000 - 20000 }, // latest 2025 entries: cash 110k (Sep), loan 20k (Mar, latest ≤ Sep)
            { year: 2026, netWorth: 130000 - 15000 },
        ]);
    });

    it('carries an account forward when it has no entry in a later year', () => {
        const history = {
            cash: [{ date: '2025-06-01', num: 50000 }],
            loan: [{ date: '2026-06-01', num: 8000 }],
        };
        // 2026: cash carries its 2025 balance (latest ≤ 2026-06-01), loan is 8k
        expect(actualNetWorthByYear(accounts, history)).toEqual([
            { year: 2025, netWorth: 50000 },
            { year: 2026, netWorth: 50000 - 8000 },
        ]);
    });

    it('returns empty when there is no history', () => {
        expect(actualNetWorthByYear(accounts, {})).toEqual([]);
    });
});
