import { describe, it, expect } from 'vitest';
import { parseBalancesCSV, autoMatchAccount } from '../../services/simplefinBalances';

const HEADER = 'FetchedAt,Org,Account,Balance,AvailableBalance,BalanceDate,Currency';

describe('parseBalancesCSV', () => {
    it('parses a basic file into one row per account', () => {
        const csv = [
            HEADER,
            '2026-05-31 18:45:28,First Bank,Savings Account (1111),1000.00,1000.00,2026-05-31,USD',
            '2026-05-31 18:45:28,Second Bank,Rewards Card (2222),-500.00,0.00,2026-05-31,USD',
        ].join('\n');

        const { rows, errors } = parseBalancesCSV(csv);

        expect(errors).toHaveLength(0);
        expect(rows).toHaveLength(2);
        const savings = rows.find((r) => r.account === 'Savings Account (1111)');
        expect(savings?.balance).toBe(1000.0);
        expect(savings?.org).toBe('First Bank');
        const card = rows.find((r) => r.account === 'Rewards Card (2222)');
        expect(card?.balance).toBe(-500.0); // negatives preserved
    });

    it('collapses multiple snapshots to the newest by FetchedAt', () => {
        const csv = [
            HEADER,
            '2026-05-31 18:45:28,First Bank,Savings Account (1111),100.00,100.00,2026-05-31,USD',
            '2026-05-31 18:55:45,First Bank,Savings Account (1111),250.00,250.00,2026-05-31,USD',
        ].join('\n');

        const { rows } = parseBalancesCSV(csv);
        expect(rows).toHaveLength(1);
        expect(rows[0].balance).toBe(250.0); // later FetchedAt wins
    });

    it('handles quoted account names containing commas', () => {
        const csv = [
            HEADER,
            '2026-05-31 18:45:28,Acme Provider,"ACME CORP PROFIT SHARING 401(K) PLAN (3333)",50000.00,0.00,2026-05-31,USD',
        ].join('\n');

        const { rows } = parseBalancesCSV(csv);
        expect(rows).toHaveLength(1);
        expect(rows[0].account).toBe('ACME CORP PROFIT SHARING 401(K) PLAN (3333)');
        expect(rows[0].balance).toBe(50000.0);
    });

    it('reports an error when required columns are missing', () => {
        const csv = ['Foo,Bar', 'a,b'].join('\n');
        const { rows, errors } = parseBalancesCSV(csv);
        expect(rows).toHaveLength(0);
        expect(errors[0]).toMatch(/Missing expected column/);
    });

    it('flags unparseable balances but keeps good rows', () => {
        const csv = [
            HEADER,
            '2026-05-31 18:45:28,First Bank,Savings Account (1111),notanumber,0,2026-05-31,USD',
            '2026-05-31 18:45:28,Second Bank,Checking (1),50.00,50.00,2026-05-31,USD',
        ].join('\n');
        const { rows, errors } = parseBalancesCSV(csv);
        expect(rows).toHaveLength(1);
        expect(rows[0].account).toBe('Checking (1)');
        expect(errors.length).toBeGreaterThan(0);
    });
});

describe('autoMatchAccount', () => {
    const appAccounts = [
        { id: 'a1', name: 'Primary Savings' },
        { id: 'a2', name: 'Roth IRA' },
        { id: 'a3', name: 'Brokerage' },
    ];

    it('matches when one name contains the other, ignoring masked digits', () => {
        expect(autoMatchAccount('Savings Account (1111)', appAccounts)).toBe(null); // no overlap
        expect(autoMatchAccount('ROTH IRA (4444)', appAccounts)).toBe('a2');
        expect(autoMatchAccount('Brokerage (5555)', appAccounts)).toBe('a3');
    });

    it('returns null when there is no confident match', () => {
        expect(autoMatchAccount('Generic Card (6666)', appAccounts)).toBe(null);
    });
});
