import { describe, it, expect } from 'vitest';
import { syncWithdrawalBuckets } from '../../services/withdrawalBucketSync';
import { type WithdrawalBucket } from '../../components/Objects/Assumptions/AssumptionsContext';

const acc = (id: string, name: string) => ({ id, name });
const bucket = (accountId: string, name: string): WithdrawalBucket => ({
    id: `withdrawal-${accountId}`,
    name,
    accountId,
});

describe('syncWithdrawalBuckets', () => {
    it('returns null when buckets already match the eligible accounts (no spurious writes)', () => {
        const accounts = [acc('a1', 'Brokerage'), acc('a2', 'Roth IRA')];
        const buckets = [bucket('a2', 'Roth IRA'), bucket('a1', 'Brokerage')]; // order ≠ account order — still in sync
        expect(syncWithdrawalBuckets(accounts, buckets)).toBeNull();
    });

    it('returns null for empty accounts + empty buckets', () => {
        expect(syncWithdrawalBuckets([], [])).toBeNull();
    });

    it('appends buckets for missing eligible accounts, preserving existing order', () => {
        const accounts = [acc('a1', 'Brokerage'), acc('a2', 'Roth IRA'), acc('a3', 'Cash')];
        const buckets = [bucket('a2', 'Roth IRA'), bucket('a1', 'Brokerage')];
        const synced = syncWithdrawalBuckets(accounts, buckets);
        expect(synced).toEqual([
            bucket('a2', 'Roth IRA'),
            bucket('a1', 'Brokerage'),
            { id: 'withdrawal-a3', name: 'Cash', accountId: 'a3' },
        ]);
    });

    it('drops buckets pointing at deleted accounts', () => {
        const accounts = [acc('a1', 'Brokerage')];
        const buckets = [bucket('gone', 'Old 401k'), bucket('a1', 'Brokerage')];
        expect(syncWithdrawalBuckets(accounts, buckets)).toEqual([bucket('a1', 'Brokerage')]);
    });

    it('handles add + drop in one pass', () => {
        const accounts = [acc('a1', 'Brokerage'), acc('a2', 'Roth IRA')];
        const buckets = [bucket('gone', 'Old 401k'), bucket('a1', 'Brokerage')];
        expect(syncWithdrawalBuckets(accounts, buckets)).toEqual([
            bucket('a1', 'Brokerage'),
            bucket('a2', 'Roth IRA'),
        ]);
    });
});
