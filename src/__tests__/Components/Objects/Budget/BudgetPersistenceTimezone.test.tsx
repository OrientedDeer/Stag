import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { useContext, useEffect } from 'react';
import { BudgetProvider } from '../../../../components/Objects/Budget/BudgetProvider';
import { BudgetContext, STORAGE_KEY } from '../../../../components/Objects/Budget/BudgetContext';
import type { MonthlySnapshot, Transaction } from '../../../../components/Objects/Budget/BudgetTypes';

// The budget's localStorage persistence used bare JSON.stringify, which writes
// local-midnight transaction dates as UTC ISO instants. East of UTC that instant
// falls on the PREVIOUS calendar day ("2026-07-01T00:00+02:00" -> "2026-06-30T22:00Z"),
// and parseDate reads the date portion back as local, so every reload walked each
// transaction (and its posted/statement date) one day earlier.
describe('Budget localStorage persistence keeps date-only fields in an east-of-UTC timezone', () => {
    let originalTZ: string | undefined;
    beforeAll(() => {
        originalTZ = process.env.TZ;
        process.env.TZ = 'Europe/Berlin';
    });
    afterAll(() => {
        if (originalTZ === undefined) delete process.env.TZ;
        else process.env.TZ = originalTZ;
    });
    beforeEach(() => {
        localStorage.clear();
    });

    let latest: MonthlySnapshot[] = [];
    const capture = (months: MonthlySnapshot[]) => { latest = months; };
    function Probe({ seed, onMonths }: { seed?: MonthlySnapshot; onMonths: (m: MonthlySnapshot[]) => void }) {
        const { months, dispatch } = useContext(BudgetContext);
        useEffect(() => {
            if (seed) dispatch({ type: 'ADD_MONTH', payload: seed });
        }, [seed, dispatch]);
        useEffect(() => { onMonths(months); }, [months, onMonths]);
        return null;
    }

    it('round-trips transaction date/postedDate/statementDate across reloads with no day shift', () => {
        expect(new Date(2026, 6, 1).getTimezoneOffset()).toBeLessThan(0);

        const txn: Transaction = {
            id: 't1',
            date: new Date(2026, 6, 1),
            postedDate: new Date(2026, 6, 3),
            statementDate: new Date(2026, 6, 15),
            description: 'Rent',
            amount: -2000,
        } as Transaction;
        const seed: MonthlySnapshot = {
            id: 'M-2026-7', month: 7, year: 2026,
            spending: {}, accountBalances: {}, contributions: {},
            transactions: [txn], reconciled: false,
            createdAt: new Date(), updatedAt: new Date(),
        };

        const first = render(<BudgetProvider><Probe seed={seed} onMonths={capture} /></BudgetProvider>);
        act(() => first.unmount()); // unmount flushes the persisted write synchronously
        expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull();

        for (let reload = 0; reload < 2; reload++) {
            const r = render(<BudgetProvider><Probe onMonths={capture} /></BudgetProvider>);
            const t = latest.find(m => m.id === 'M-2026-7')!.transactions[0];
            const d = t.date as Date;
            expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2026, 6, 1]);
            expect((t.postedDate as Date).getDate()).toBe(3);
            expect((t.statementDate as Date).getDate()).toBe(15);
            act(() => r.unmount());
        }
    });
});
