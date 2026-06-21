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

    it('keeps an omitted-but-real account in its CHOSEN position via a synthesized stub', () => {
        // The optimizer owns the order under Tax Optimization and can place a sellable account the
        // user left OUT of withdrawalStrategy ('d'). Its accountId is real (in validAccountIds) but
        // has no item in the user's strategy — it must survive in its chosen slot, not be dropped and
        // re-appended at the tail. Regression for the MC/chart drawdown-order desync.
        const res = applyChosenWithdrawalOrder(
            assumptions,
            [{ accountId: 'a' }, { accountId: 'd', name: 'Traditional IRA' }, { accountId: 'c' }, { accountId: 'b' }],
            new Set(['a', 'b', 'c', 'd']),
        );
        expect(res.withdrawalStrategy.map(w => w.accountId)).toEqual(['a', 'd', 'c', 'b']);
        // The omitted account is a synthesized stub carrying the chosen name + real accountId.
        expect(res.withdrawalStrategy[1]).toMatchObject({ accountId: 'd', name: 'Traditional IRA' });
    });

    it('drops a STALE chosen id even when validAccountIds is supplied', () => {
        // 'zzz' is not a current account (absent from the set), so it is dropped, not synthesized.
        const res = applyChosenWithdrawalOrder(
            assumptions,
            [{ accountId: 'zzz' }, { accountId: 'b' }],
            new Set(['a', 'b', 'c']),
        );
        expect(res.withdrawalStrategy.map(w => w.accountId)).toEqual(['b', 'a', 'c']);
    });
});
