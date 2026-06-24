import { describe, it, expect } from 'vitest';
import { distributeProportional } from '../../utils/distribute';

/**
 * distributeProportional is the shared "allocate a total across weights, last
 * item absorbs the remainder" idiom extracted from the cashflow per-income
 * deferral split and the SimpleFIN multi-target balance split (#126). These
 * tests pin the two contracts both call sites rely on: shares sum to the total
 * exactly, and the optional rounding hook matches the SimpleFIN cents behavior.
 */
describe('distributeProportional', () => {
    it('splits proportionally and the shares sum to the total exactly', () => {
        const shares = distributeProportional(40000, [30000, 10000]);
        expect(shares).toEqual([30000, 10000]);
        expect(shares.reduce((a, b) => a + b, 0)).toBeCloseTo(40000, 9);
    });

    it('hands the LAST item the remainder (no proportional-rounding drift)', () => {
        // 100 across equal thirds: exact thirds don't sum to 100, so the last
        // item must absorb the leftover.
        const shares = distributeProportional(100, [1, 1, 1]);
        expect(shares[0]).toBeCloseTo(100 / 3, 9);
        expect(shares[1]).toBeCloseTo(100 / 3, 9);
        expect(shares.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 9);
    });

    it('applies the round hook to each non-final share and the running total (cents split)', () => {
        const round2 = (n: number) => Math.round(n * 100) / 100;
        // 10.00 across 1:1:1 → 3.33, 3.33, remainder 3.34 (sums to 10.00 exactly).
        const shares = distributeProportional(10, [1, 1, 1], round2);
        expect(shares).toEqual([3.33, 3.33, 3.34]);
        expect(shares.reduce((a, b) => a + b, 0)).toBeCloseTo(10, 9);
    });

    it('falls back to an even split when all weights are zero', () => {
        const shares = distributeProportional(90, [0, 0, 0]);
        expect(shares).toEqual([30, 30, 30]);
        expect(shares.reduce((a, b) => a + b, 0)).toBeCloseTo(90, 9);
    });

    it('returns [] for no weights and the whole total for a single weight', () => {
        expect(distributeProportional(50, [])).toEqual([]);
        expect(distributeProportional(50, [7])).toEqual([50]);
    });
});
