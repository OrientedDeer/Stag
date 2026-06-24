/**
 * Regression test: Box-Muller log(0) guard in SeededRandom.normal()
 *
 * Mulberry32 next() can return EXACTLY 0 for certain seeds. Seed 2463401483
 * returns 0 on its FIRST draw, which lands on the u1 slot of normal()'s
 * Box-Muller transform. Math.log(0) = -Infinity then makes normal() (and the
 * generated returns built on it) non-finite, which would propagate Infinity/NaN
 * into Monte Carlo account growth.
 *
 * These tests pin the degenerate draw and verify the guard keeps normal()/
 * generateReturns() finite, while leaving ordinary seeds byte-for-byte unchanged
 * (golden-master safety).
 */

import { describe, it, expect } from 'vitest';
import { SeededRandom } from '../../services/RandomGenerator';

// Proven by direct evaluation of the Mulberry32 recurrence: next() === 0 on the
// first draw, so it occupies normal()'s u1 (even-index) slot.
const DEGENERATE_SEED = 2463401483;

describe('SeededRandom Box-Muller log(0) guard', () => {
    it('confirms the degenerate seed returns exactly 0 on the first next() draw', () => {
        // Documents the failing precondition this regression guards against.
        const rng = new SeededRandom(DEGENERATE_SEED);
        expect(rng.next()).toBe(0);
    });

    it('normal() stays finite for the degenerate (u1 === 0) seed', () => {
        const rng = new SeededRandom(DEGENERATE_SEED);
        const z = rng.normal(7, 15);
        // Pre-fix this was -Infinity (Math.log(0)).
        expect(Number.isFinite(z)).toBe(true);
    });

    it('generateReturns() produces only finite values for the degenerate seed', () => {
        const rng = new SeededRandom(DEGENERATE_SEED);
        const returns = rng.generateReturns(30, 7, 15);
        expect(returns).toHaveLength(30);
        for (const r of returns) {
            expect(Number.isFinite(r)).toBe(true);
        }
    });

    it('generateLognormalReturns() stays finite for the degenerate seed', () => {
        const rng = new SeededRandom(DEGENERATE_SEED);
        const returns = rng.generateLognormalReturns(30, 7, 15);
        expect(returns).toHaveLength(30);
        for (const r of returns) {
            expect(Number.isFinite(r)).toBe(true);
        }
    });

    it('pins an ordinary seed to its exact normal() value (golden-master anchor)', () => {
        // Hardcoded golden value: the clamp-if-zero guard must NOT change this.
        // (If the guard were `1 - next()` it would shift this number, breaking MC
        // golden masters.) Value captured from the canonical Box-Muller formula.
        const rng = new SeededRandom(12345);
        expect(rng.normal(7, 15)).toBe(5.9402788826111195);
    });

    it('does not alter normal() output for ordinary seeds (golden-master safety)', () => {
        // For seeds whose next() never hits exactly 0, the guard is a no-op.
        // We re-derive the expected Box-Muller value from the same raw draws the
        // generator would consume, so the assertion is independent of the guard's
        // internal form (clamp-if-zero, etc.).
        const seeds = [12345, 54321, 7, 99999, 2718281828];
        for (const seed of seeds) {
            const draws = new SeededRandom(seed);
            const u1 = draws.next();
            const u2 = draws.next();
            // Guard against a false-negative: this branch only validates seeds
            // whose first draw is non-zero (the ordinary, golden-master case).
            expect(u1).not.toBe(0);
            const expected =
                Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2) * 15 + 7;

            const rng = new SeededRandom(seed);
            expect(rng.normal(7, 15)).toBe(expected);
        }
    });
});
