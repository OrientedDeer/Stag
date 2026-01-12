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
        const u1 = this.next();
        const u2 = this.next();

        // Box-Muller transform
        const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);

        return z0 * stdDev + mean;
    }

    /**
     * Generate random number from lognormal distribution
     * Useful for modeling investment returns (can't go below -100%)
     * @param mean - Desired arithmetic mean of the distribution
     * @param stdDev - Desired standard deviation
     * @returns Value that's always > 0, with specified mean/stdDev
     */
    lognormal(mean: number, stdDev: number): number {
        // Convert arithmetic mean/stdDev to log-space parameters
        // For lognormal: E[X] = exp(mu + sigma^2/2)
        //                Var[X] = (exp(sigma^2) - 1) * exp(2*mu + sigma^2)
        const variance = stdDev * stdDev;
        const meanSquared = mean * mean;

        const sigma2 = Math.log(1 + variance / meanSquared);
        const mu = Math.log(mean) - sigma2 / 2;

        const normalSample = this.normal(mu, Math.sqrt(sigma2));
        return Math.exp(normalSample);
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
            returns.push(annualReturn);
        }

        return returns;
    }

    /**
     * Generate array of returns using lognormal distribution
     * Better for modeling actual market behavior (prevents >-100% returns)
     * @param years - Number of years to generate
     * @param meanReturn - Expected annual return percentage (e.g., 7 for 7%)
     * @param stdDev - Annual volatility percentage (e.g., 15 for 15%)
     * @returns Array of return percentages
     */
    generateLognormalReturns(years: number, meanReturn: number, stdDev: number): number[] {
        const returns: number[] = [];

        // Convert percentage return to growth factor
        // E.g., 7% mean return -> 1.07 growth factor
        const meanFactor = 1 + meanReturn / 100;
        const stdDevFactor = stdDev / 100;

        for (let i = 0; i < years; i++) {
            // Generate lognormal growth factor
            const growthFactor = this.lognormal(meanFactor, stdDevFactor);
            // Convert back to return percentage
            const annualReturn = (growthFactor - 1) * 100;
            returns.push(annualReturn);
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
