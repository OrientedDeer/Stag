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
        return this.standardNormal() * stdDev + mean;
    }

    /**
     * One draw from the STANDARD normal (mean 0, sd 1), consuming exactly two
     * uniforms. `normal()` is this scaled and shifted — split out so correlated
     * generation (#208) can reuse the standardized value without altering how many
     * uniforms an ordinary call consumes, which would shift every downstream draw
     * and break fixed-seed reproducibility.
     */
    standardNormal(): number {
        let u1 = this.next();
        const u2 = this.next();

        // next() can return exactly 0 for some seeds (Mulberry32 state hitting 0),
        // which would make Math.log(u1) = -Infinity and poison the result with
        // -Infinity/NaN. Clamp only the degenerate 0 draw to the smallest positive
        // double so ordinary draws (and their golden-master output) are unchanged.
        if (u1 === 0) u1 = Number.MIN_VALUE;

        // Box-Muller transform
        return Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
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
     * Generate CORRELATED annual stock and bond return series (#208).
     *
     * Bonds are not risk-free: an aggregate bond fund carries real volatility
     * (duration risk), and in the REAL terms this app models, inflation surprises
     * add more. Modeling the bond leg as a constant deletes the bond sleeve's
     * downside scenarios entirely — see #208 for why that matters most exactly
     * where the glidepath puts people.
     *
     * The two series are linked by a 2x2 Cholesky factorization, which for the
     * bivariate case reduces to `zb = rho*zs + sqrt(1 - rho^2)*z2`: the bond draw
     * inherits `rho` of the stock shock and adds an independent remainder scaled to
     * preserve unit variance.
     *
     * STREAM DISCIPLINE (load-bearing): the stock series is drawn FIRST, in its
     * entirety, using exactly the same call sequence as `generateReturns` — so a
     * 100%-stock plan produces a byte-identical stock path for a given seed, and
     * the golden masters don't move. Only then does the bond pass consume from the
     * continued stream, correlating against each year's STORED standardized stock
     * draw. Interleaving the two draws per year would shift every stock draw and
     * silently invalidate every fixed-seed expectation in the suite.
     *
     * @param years - Number of years to generate
     * @param stockMean - Expected annual stock return (e.g., 7 for 7%)
     * @param stockStdDev - Annual stock volatility (e.g., 18 for 18%)
     * @param bondMean - Expected annual bond return (e.g., 2 for 2%)
     * @param bondStdDev - Annual bond volatility (e.g., 7 for 7%)
     * @param correlation - Stock/bond correlation in [-1, 1]
     */
    generateCorrelatedReturns(
        years: number,
        stockMean: number,
        stockStdDev: number,
        bondMean: number,
        bondStdDev: number,
        correlation: number,
    ): { stock: number[]; bond: number[] } {
        const rho = Math.min(1, Math.max(-1, correlation));
        const stock: number[] = [];
        const bond: number[] = [];
        // Standardized stock draws, retained so the bond pass can correlate against
        // them without re-drawing (which would consume the stream out of order).
        const zStock: number[] = [];

        for (let i = 0; i < years; i++) {
            const z = this.standardNormal();
            zStock.push(z);
            // Same flooring rationale as generateReturns: a growth factor must never
            // go negative and multiply a balance into a phantom negative asset.
            stock.push(Math.max(z * stockStdDev + stockMean, -100));
        }

        const independentWeight = Math.sqrt(Math.max(0, 1 - rho * rho));
        for (let i = 0; i < years; i++) {
            const zb = rho * zStock[i] + independentWeight * this.standardNormal();
            bond.push(Math.max(zb * bondStdDev + bondMean, -100));
        }

        return { stock, bond };
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
