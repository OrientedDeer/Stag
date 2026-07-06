/**
 * Tests for RandomGenerator utilities
 *
 * Tests the SeededRandom class and statistical helper functions
 * used in Monte Carlo simulations.
 */

import { describe, it, expect } from 'vitest';
import {
    SeededRandom,
    createRandomSeed,
    calculateMean,
    calculateStdDev
} from '../../services/RandomGenerator';

// =============================================================================
// SeededRandom class tests
// =============================================================================

describe('SeededRandom', () => {
    describe('determinism', () => {
        it('should produce same first 10 values with same seed', () => {
            const seed = 12345;
            const rng1 = new SeededRandom(seed);
            const rng2 = new SeededRandom(seed);

            const values1: number[] = [];
            const values2: number[] = [];

            for (let i = 0; i < 10; i++) {
                values1.push(rng1.next());
                values2.push(rng2.next());
            }

            expect(values1).toEqual(values2);
        });

        it('should produce different sequences with different seeds', () => {
            const rng1 = new SeededRandom(12345);
            const rng2 = new SeededRandom(54321);

            const values1: number[] = [];
            const values2: number[] = [];

            for (let i = 0; i < 10; i++) {
                values1.push(rng1.next());
                values2.push(rng2.next());
            }

            // At least one value should be different
            const allSame = values1.every((v, i) => v === values2[i]);
            expect(allSame).toBe(false);
        });

        it('should produce same sequence after reset', () => {
            const seed = 99999;
            const rng = new SeededRandom(seed);

            const firstRun: number[] = [];
            for (let i = 0; i < 5; i++) {
                firstRun.push(rng.next());
            }

            rng.reset(seed);

            const secondRun: number[] = [];
            for (let i = 0; i < 5; i++) {
                secondRun.push(rng.next());
            }

            expect(firstRun).toEqual(secondRun);
        });
    });

    describe('next()', () => {
        it('should return values >= 0 and < 1 (1000 samples)', () => {
            const rng = new SeededRandom(42);

            for (let i = 0; i < 1000; i++) {
                const value = rng.next();
                expect(value).toBeGreaterThanOrEqual(0);
                expect(value).toBeLessThan(1);
            }
        });

        it('should produce different values on sequential calls', () => {
            const rng = new SeededRandom(12345);

            const value1 = rng.next();
            const value2 = rng.next();
            const value3 = rng.next();

            // All three should be different
            expect(value1).not.toBe(value2);
            expect(value2).not.toBe(value3);
            expect(value1).not.toBe(value3);
        });
    });

    describe('normal() - Gaussian distribution', () => {
        it('should return approximately normal distribution with mean close to 0', () => {
            const rng = new SeededRandom(123456);
            const samples: number[] = [];

            for (let i = 0; i < 1000; i++) {
                samples.push(rng.normal(0, 1));
            }

            const mean = calculateMean(samples);
            // Mean should be close to 0 (within 0.1)
            expect(Math.abs(mean)).toBeLessThan(0.1);
        });

        it('should return approximately normal distribution with stdDev close to 1', () => {
            const rng = new SeededRandom(654321);
            const samples: number[] = [];

            for (let i = 0; i < 1000; i++) {
                samples.push(rng.normal(0, 1));
            }

            const stdDev = calculateStdDev(samples);
            // StdDev should be close to 1 (within 0.2)
            expect(Math.abs(stdDev - 1)).toBeLessThan(0.2);
        });

        it('should respect specified mean', () => {
            const rng = new SeededRandom(111);
            const targetMean = 100;
            const samples: number[] = [];

            for (let i = 0; i < 1000; i++) {
                samples.push(rng.normal(targetMean, 10));
            }

            const mean = calculateMean(samples);
            // Mean should be close to target (within 2)
            expect(Math.abs(mean - targetMean)).toBeLessThan(2);
        });

        it('should respect specified stdDev', () => {
            const rng = new SeededRandom(222);
            const targetStdDev = 15;
            const samples: number[] = [];

            for (let i = 0; i < 1000; i++) {
                samples.push(rng.normal(0, targetStdDev));
            }

            const stdDev = calculateStdDev(samples);
            // StdDev should be close to target (within 3)
            expect(Math.abs(stdDev - targetStdDev)).toBeLessThan(3);
        });
    });

    describe('generateReturns()', () => {
        it('should return correct number of years', () => {
            const rng = new SeededRandom(12345);
            const returns = rng.generateReturns(30, 7, 15);
            expect(returns.length).toBe(30);
        });

        it('should have mean close to specified meanReturn', () => {
            const rng = new SeededRandom(54321);
            const returns = rng.generateReturns(1000, 7, 15);
            const mean = calculateMean(returns);
            // Mean should be close to 7 (within 1)
            expect(Math.abs(mean - 7)).toBeLessThan(1);
        });
    });

    describe('generateReturns() - sub--100% floor', () => {
        it('never returns a value below -100% even at extreme volatility', () => {
            // At stdDev 50 (UI-reachable) an unbounded Normal draws below -100%
            // for ~1.6% of years; those turn a growth factor negative. The floor
            // clamps them at exactly -100% (growth factor 0).
            const rng = new SeededRandom(1234567);
            const returns = rng.generateReturns(100000, 7, 50);
            let sawFloor = false;
            for (const r of returns) {
                expect(r).toBeGreaterThanOrEqual(-100);
                if (r === -100) sawFloor = true;
            }
            // Sanity: at this volatility the floor should actually engage.
            expect(sawFloor).toBe(true);
        });

        it('leaves default-volatility draws (stdDev 15) untouched', () => {
            // At the default stdDev a sub--100% draw is ~7 sigma — effectively
            // unreachable — so the clamp is a no-op and golden masters are safe.
            const rng = new SeededRandom(54321);
            const returns = rng.generateReturns(100000, 7, 15);
            for (const r of returns) {
                expect(r).toBeGreaterThan(-100);
            }
        });
    });

    describe('getState()', () => {
        it('should return current state', () => {
            const rng = new SeededRandom(12345);
            rng.next();
            rng.next();
            const state = rng.getState();
            expect(typeof state).toBe('number');
            expect(state).not.toBe(12345); // State should have changed
        });
    });
});

// =============================================================================
// createRandomSeed tests
// =============================================================================

describe('createRandomSeed', () => {
    it('should return a number', () => {
        const seed = createRandomSeed();
        expect(typeof seed).toBe('number');
    });

    it('should return positive integer', () => {
        const seed = createRandomSeed();
        expect(seed).toBeGreaterThanOrEqual(0);
        expect(Number.isInteger(seed)).toBe(true);
    });

    it('should return value < 2147483647', () => {
        for (let i = 0; i < 100; i++) {
            const seed = createRandomSeed();
            expect(seed).toBeLessThan(2147483647);
        }
    });

    it('should return different values on most calls (at least 9 of 10 different)', () => {
        const seeds = new Set<number>();
        for (let i = 0; i < 10; i++) {
            seeds.add(createRandomSeed());
        }
        // At least 9 out of 10 should be unique
        expect(seeds.size).toBeGreaterThanOrEqual(9);
    });
});

// =============================================================================
// calculateMean tests
// =============================================================================

describe('calculateMean', () => {
    it('should calculate mean of [1, 2, 3, 4, 5] as 3', () => {
        expect(calculateMean([1, 2, 3, 4, 5])).toBe(3);
    });

    it('should calculate mean of single value [10] as 10', () => {
        expect(calculateMean([10])).toBe(10);
    });

    it('should calculate mean of [-5, 5] as 0', () => {
        expect(calculateMean([-5, 5])).toBe(0);
    });

    it('should calculate mean of [0, 0, 0] as 0', () => {
        expect(calculateMean([0, 0, 0])).toBe(0);
    });

    it('should handle large numbers: [1000000, 2000000] → 1500000', () => {
        expect(calculateMean([1000000, 2000000])).toBe(1500000);
    });

    it('should handle negative numbers', () => {
        expect(calculateMean([-10, -20, -30])).toBe(-20);
    });

    it('should handle decimals', () => {
        expect(calculateMean([1.5, 2.5, 3.0])).toBeCloseTo(2.333, 2);
    });
});

// =============================================================================
// calculateStdDev tests
// =============================================================================

describe('calculateStdDev', () => {
    it('should return 0 for uniform values [5, 5, 5, 5]', () => {
        expect(calculateStdDev([5, 5, 5, 5])).toBe(0);
    });

    it('should return ~1.414 for [1, 2, 3, 4, 5]', () => {
        // Population stddev of [1,2,3,4,5] is sqrt(2) ≈ 1.414
        const stdDev = calculateStdDev([1, 2, 3, 4, 5]);
        expect(stdDev).toBeCloseTo(Math.sqrt(2), 3);
    });

    it('should return 0 for single value [10]', () => {
        expect(calculateStdDev([10])).toBe(0);
    });

    it('should return ~1.414 for [-2, -1, 0, 1, 2]', () => {
        // Population stddev of [-2,-1,0,1,2] is sqrt(2) ≈ 1.414
        const stdDev = calculateStdDev([-2, -1, 0, 1, 2]);
        expect(stdDev).toBeCloseTo(Math.sqrt(2), 3);
    });

    it('should calculate known dataset stddev correctly', () => {
        // Dataset: [2, 4, 4, 4, 5, 5, 7, 9]
        // Mean = 5
        // Variance = ((2-5)² + (4-5)² + (4-5)² + (4-5)² + (5-5)² + (5-5)² + (7-5)² + (9-5)²) / 8
        //         = (9 + 1 + 1 + 1 + 0 + 0 + 4 + 16) / 8 = 32 / 8 = 4
        // StdDev = sqrt(4) = 2
        expect(calculateStdDev([2, 4, 4, 4, 5, 5, 7, 9])).toBe(2);
    });

    it('should handle large numbers', () => {
        // [1000000, 2000000, 3000000]
        // Mean = 2000000
        // Variance = ((1M-2M)² + (2M-2M)² + (3M-2M)²) / 3 = (1T + 0 + 1T) / 3 = 2T/3
        // StdDev = sqrt(2T/3) ≈ 816496.58
        const stdDev = calculateStdDev([1000000, 2000000, 3000000]);
        expect(stdDev).toBeCloseTo(816496.58, 0);
    });
});
