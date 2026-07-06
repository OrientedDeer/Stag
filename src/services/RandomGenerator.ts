/**
 * Seeded Pseudo-Random Number Generator for Monte Carlo simulations
 * Uses Mulberry32 algorithm for deterministic, reproducible results
 */
export class SeededRandom {
    private state: number;

    constructor(seed: number) {
        // Ensure seed is a valid 32-bit integer
        this.state = seed >>> 0;
    }

    /**
     * Generate next random number in [0, 1)
     * Uses Mulberry32 - fast, high-quality PRNG
     */
    next(): number {
        let t = this.state += 0x6D2B79F5;
        t = Math.imul(t ^ t >>> 15, t | 1);
        t ^= t + Math.imul(t ^ t >>> 7, t | 61);
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    }

    /**
     * Generate random number from normal distribution
     * Uses Box-Muller transform
     * @param mean - Mean of the distribution
     * @param stdDev - Standard deviation of the distribution
     */
    normal(mean: number, stdDev: number): number {
        let u1 = this.next();
        const u2 = this.next();

        // next() can return exactly 0 for some seeds (Mulberry32 state hitting 0),
        // which would make Math.log(u1) = -Infinity and poison the result with
        // -Infinity/NaN. Clamp only the degenerate 0 draw to the smallest positive
        // double so ordinary draws (and their golden-master output) are unchanged.
        if (u1 === 0) u1 = Number.MIN_VALUE;

        // Box-Muller transform
        const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);

        return z0 * stdDev + mean;
    }

    /**
     * Generate array of annual investment returns
     * @param years - Number of years to generate
     * @param meanReturn - Expected annual return (e.g., 7 for 7%)
     * @param stdDev - Annual volatility (e.g., 15 for 15%)
     * @returns Array of return percentages (e.g., [8.2, -3.1, 12.5, ...])
     */
    generateReturns(years: number, meanReturn: number, stdDev: number): number[] {
        const returns: number[] = [];

        for (let i = 0; i < years; i++) {
            // Use normal distribution for simplicity
            // In practice, stock returns are approximately lognormal,
            // but for annual returns, normal is a reasonable approximation
            const annualReturn = this.normal(meanReturn, stdDev);
            // Floor at -100%: an unbounded Normal can draw below -100%, which
            // turns a growth factor (1 + return/100) NEGATIVE and multiplies an
            // account balance by a negative number — a phantom negative asset
            // that poisons percentile bands and success classification. At the
            // default stdDev (15) a sub--100% draw is effectively unreachable
            // (~7 sigma), so this leaves default-config golden masters
            // byte-for-byte unchanged; it only trims the unphysical high-vol
            // tail. Matches the DP policy solve, which floors factors at 0.
            returns.push(Math.max(annualReturn, -100));
        }

        return returns;
    }

    /**
     * Reset generator to original seed
     * Useful for reproducing exact same sequence
     */
    reset(seed: number): void {
        this.state = seed >>> 0;
    }

    /**
     * Get current state (for saving/restoring)
     */
    getState(): number {
        return this.state;
    }
}

/**
 * Create a simple one-off random number generator
 * Useful for quick seed generation
 */
export function createRandomSeed(): number {
    return Math.floor(Math.random() * 2147483647);
}

/**
 * Statistical utilities for validating distributions
 */
export function calculateMean(values: number[]): number {
    return values.reduce((sum, v) => sum + v, 0) / values.length;
}

export function calculateStdDev(values: number[]): number {
    const mean = calculateMean(values);
    const squaredDiffs = values.map(v => Math.pow(v - mean, 2));
    const variance = squaredDiffs.reduce((sum, v) => sum + v, 0) / values.length;
    return Math.sqrt(variance);
}
