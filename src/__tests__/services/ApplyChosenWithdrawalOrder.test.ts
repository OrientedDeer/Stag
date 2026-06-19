import { describe, it, expect } from 'vitest';
import { applyChosenWithdrawalOrder } from '../../services/simulation/EngineDirectConversionSearch';

/**
 * #1 — Monte Carlo runs every path off the passed `assumptions`, so to make the MC bands drain in
 * the SAME order the deterministic optimizer chose (and the chart shows), the MC trigger reorders
 * `assumptions.withdrawalStrategy` to `simulationData[0].chosenWithdrawalOrder` via this helper.
 * Identity preservation in the no-op cases is load-bearing: the worker's policy cache is keyed off
 * `assumptions`, so a needless new object would cause spurious cache misses.
 */
describe('applyChosenWithdrawalOrder (#1)', () => {
    const ws = [
        { accountId: 'a', name: 'Brokerage' },
        { accountId: 'b', name: 'Traditional 401k' },
        { accountId: 'c', name: 'Roth IRA' },
    ];
    const assumptions = { withdrawalStrategy: ws, somethingElse: 42 };

    it('returns the SAME object when there is no chosen order', () => {
        expect(applyChosenWithdrawalOrder(assumptions, undefined)).toBe(assumptions);
        expect(applyChosenWithdrawalOrder(assumptions, [])).toBe(assumptions);
    });

    it('returns the SAME object when the chosen order already matches (cache-key stable)', () => {
        const res = applyChosenWithdrawalOrder(assumptions, [
            { accountId: 'a' }, { accountId: 'b' }, { accountId: 'c' },
        ]);
        expect(res).toBe(assumptions);
    });

    it('reorders to the chosen order, keeping the FULL strategy items and other fields', () => {
        const res = applyChosenWithdrawalOrder(assumptions, [
            { accountId: 'c' }, { accountId: 'a' }, { accountId: 'b' },
        ]);
        expect(res).not.toBe(assumptions);
        expect(res.withdrawalStrategy.map(w => w.accountId)).toEqual(['c', 'a', 'b']);
        // Full item carried over from the lossy {accountId} chosen order, not a stub.
        expect(res.withdrawalStrategy[0]).toEqual({ accountId: 'c', name: 'Roth IRA' });
        expect(res.somethingElse).toBe(42);
        // Source is not mutated.
        expect(assumptions.withdrawalStrategy.map(w => w.accountId)).toEqual(['a', 'b', 'c']);
    });

    it('appends strategy items not named in the chosen order (defensive — never drops accounts)', () => {
        const res = applyChosenWithdrawalOrder(assumptions, [{ accountId: 'c' }]);
        expect(res.withdrawalStrategy.map(w => w.accountId)).toEqual(['c', 'a', 'b']);
    });

    it('ignores chosen accountIds that no longer exist in the strategy', () => {
        const res = applyChosenWithdrawalOrder(assumptions, [
            { accountId: 'zzz' }, { accountId: 'b' },
        ]);
        // 'zzz' is dropped; 'b' moves first; 'a'/'c' keep their relative order after.
        expect(res.withdrawalStrategy.map(w => w.accountId)).toEqual(['b', 'a', 'c']);
    });
});
