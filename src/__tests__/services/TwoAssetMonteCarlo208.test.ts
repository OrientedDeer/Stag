/**
 * #208 — two-asset Monte Carlo.
 *
 * Bonds used to be risk-free in the MC path: one drawn series was treated as the stock
 * return and the bond leg was a constant. That understated volatility for bond-bearing
 * portfolios and deleted the bond sleeve's downside entirely — worst exactly where the
 * #207 glidepath puts people (bonds, during drawdown).
 *
 * The load-bearing test here is the same one that anchored #207: a 100%-stock plan must
 * be bit-identical for a fixed seed. That's what makes the change safe, and it depends on
 * the stream discipline in `generateCorrelatedReturns` (full stock series first, bond
 * series from the continued stream).
 */
import { describe, it, expect } from 'vitest';
import { SeededRandom } from '../../services/RandomGenerator';
import { blendedPortfolioStdDev, blendedMonteCarloReturn, planHasBondExposure } from '../../services/simulation/allocation';
import {
    defaultMonteCarloConfig,
    getBondStdDev,
    getStockBondCorrelation,
    RETURN_PRESETS,
    type MonteCarloConfig,
} from '../../services/MonteCarloTypes';
import { validateConfig } from '../../services/MonteCarloEngine';
import { HISTORICAL_STATS } from '../../data/HistoricalReturns';
import { defaultAssumptions, type AssumptionsState } from '../../components/Objects/Assumptions/AssumptionsContext';

const sd = (x: number[]) => {
    const m = x.reduce((a, c) => a + c, 0) / x.length;
    return Math.sqrt(x.reduce((a, c) => a + (c - m) ** 2, 0) / x.length);
};
const mean = (x: number[]) => x.reduce((a, c) => a + c, 0) / x.length;
const corr = (x: number[], y: number[]) => {
    const mx = mean(x), my = mean(y);
    let cov = 0, vx = 0, vy = 0;
    for (let i = 0; i < x.length; i++) {
        const dx = x[i] - mx, dy = y[i] - my;
        cov += dx * dy; vx += dx * dx; vy += dy * dy;
    }
    return cov / Math.sqrt(vx * vy);
};

describe('#208 correlated return generation', () => {
    it('leaves the STOCK series byte-identical to the single-asset generator', () => {
        // The whole backward-compatibility claim rests on this. Interleaving the two
        // draws per year would shift every stock draw and silently invalidate every
        // fixed-seed expectation in the suite.
        const legacy = new SeededRandom(42).generateReturns(40, 7, 18);
        const twoAsset = new SeededRandom(42).generateCorrelatedReturns(40, 7, 18, 2, 7, 0.1);
        expect(twoAsset.stock).toEqual(legacy);
    });

    it('reproduces the configured stock and bond moments', () => {
        const { stock, bond } = new SeededRandom(7)
            .generateCorrelatedReturns(20_000, 7, 18, 2, 7, 0.1);
        expect(mean(stock)).toBeCloseTo(7, 0);
        expect(sd(stock)).toBeCloseTo(18, 0);
        expect(mean(bond)).toBeCloseTo(2, 0);
        expect(sd(bond)).toBeCloseTo(7, 0);
    });

    it('reproduces the configured correlation', () => {
        for (const rho of [-0.5, 0, 0.3, 0.8]) {
            const { stock, bond } = new SeededRandom(11)
                .generateCorrelatedReturns(20_000, 7, 18, 2, 7, rho);
            expect(corr(stock, bond)).toBeCloseTo(rho, 1);
        }
    });

    it('produces a perfectly correlated bond leg at rho = 1 and clamps beyond', () => {
        const { stock, bond } = new SeededRandom(3)
            .generateCorrelatedReturns(5_000, 7, 18, 2, 7, 1);
        expect(corr(stock, bond)).toBeCloseTo(1, 5);
        // Out-of-range correlation must clamp rather than produce NaN via √(1−ρ²).
        const beyond = new SeededRandom(3).generateCorrelatedReturns(100, 7, 18, 2, 7, 5);
        expect(beyond.bond.every(Number.isFinite)).toBe(true);
    });

    it('floors both legs at -100% so a growth factor can never go negative', () => {
        const { stock, bond } = new SeededRandom(5)
            .generateCorrelatedReturns(5_000, 0, 400, 0, 400, 0);
        expect(Math.min(...stock)).toBeGreaterThanOrEqual(-100);
        expect(Math.min(...bond)).toBeGreaterThanOrEqual(-100);
    });
});

describe('#208 bond-exposure gate (stream discipline)', () => {
    const withAllocation = (stockPct?: number, glide?: AssumptionsState['investments']['allocationGlidepath']) => ({
        ...defaultAssumptions,
        investments: {
            ...defaultAssumptions.investments,
            defaultAllocation: stockPct === undefined ? undefined : { stockPct },
            allocationGlidepath: glide,
        },
    } as AssumptionsState);

    it('is false for an all-stock plan, so the bond pass is skipped entirely', () => {
        // Load-bearing: the two legs share one RNG stream. Drawing bonds for an all-stock
        // plan would consume extra uniforms and shift every LATER scenario's stock draws,
        // changing results for users who hold no bonds.
        expect(planHasBondExposure([], withAllocation(100))).toBe(false);
        expect(planHasBondExposure([{}], withAllocation(undefined))).toBe(false);
        expect(planHasBondExposure([{ stockPct: 100 }], withAllocation(100))).toBe(false);
    });

    it('is true when the default allocation holds bonds', () => {
        expect(planHasBondExposure([], withAllocation(60))).toBe(true);
    });

    it('is true when a per-account override holds bonds', () => {
        expect(planHasBondExposure([{ stockPct: 40 }], withAllocation(100))).toBe(true);
    });

    it('is true when a glidepath dips below 100% at EITHER endpoint', () => {
        const glide = { enabled: true, startAge: 40, endAge: 65, startStockPct: 100, endStockPct: 60 };
        expect(planHasBondExposure([], withAllocation(100, glide))).toBe(true);
        // Disabled glidepath must not count.
        expect(planHasBondExposure([], withAllocation(100, { ...glide, enabled: false }))).toBe(false);
    });
});

describe('#208 portfolio volatility', () => {
    it('matches the two-asset formula', () => {
        // 60/40, σs=18, σb=6, ρ=0.1 → √(0.36·324 + 0.16·36 + 2·0.6·0.4·0.1·18·6)
        expect(blendedPortfolioStdDev(0.6, 18, 6, 0.1)).toBeCloseTo(11.2953, 3);
        // 25/75 — the case the old `w·σs` model understated by about a third.
        expect(blendedPortfolioStdDev(0.25, 18, 6, 0.1)).toBeCloseTo(6.6746, 3);
    });

    it('reduces to w·stockStdDev when bonds carry no risk (the pre-#208 expression)', () => {
        expect(blendedPortfolioStdDev(0.6, 18, 0, 0)).toBeCloseTo(10.8, 10);
        expect(blendedPortfolioStdDev(1, 18, 7, 0.1)).toBeCloseTo(18, 10);
    });

    it('exceeds the old w·stockStdDev model for bond-bearing portfolios', () => {
        for (const w of [0.25, 0.4, 0.6, 0.8]) {
            expect(blendedPortfolioStdDev(w, 18, 7, 0.1)).toBeGreaterThan(w * 18);
        }
    });

    it('stays finite at rho = -1, where the analytic variance can go slightly negative', () => {
        const s = blendedPortfolioStdDev(0.5, 10, 10, -1);
        expect(Number.isFinite(s)).toBe(true);
        expect(s).toBeCloseTo(0, 10);
    });
});

describe('#208 drawn bond leg in the blend', () => {
    const assumptions: AssumptionsState = {
        ...defaultAssumptions,
        macro: { ...defaultAssumptions.macro, inflationAdjusted: true, inflationRate: 3 },
        investments: {
            ...defaultAssumptions.investments,
            returnRates: { ror: 7, bondRor: 2 },
            defaultAllocation: { stockPct: 50 },
        },
    };

    it('uses the drawn bond return as-is, without re-adding inflation', () => {
        // A drawn bond leg is already in the same nominal units as the drawn stock leg.
        // 0.5*20 + 0.5*4 = 12.
        expect(blendedMonteCarloReturn({}, assumptions, { stock: 20, bond: 4 }, 2030))
            .toBeCloseTo(12, 10);
    });

    it('still inflation-adjusts the DETERMINISTIC fallback for a scalar draw', () => {
        // 0.5*20 + 0.5*(2 + 3) = 12.5 — the pre-#208 path, unchanged.
        expect(blendedMonteCarloReturn({}, assumptions, 20, 2030)).toBeCloseTo(12.5, 10);
    });

    it('ignores the bond leg entirely at 100% stock', () => {
        const allStock = {
            ...assumptions,
            investments: { ...assumptions.investments, defaultAllocation: { stockPct: 100 } },
        };
        expect(blendedMonteCarloReturn({}, allStock, { stock: 20, bond: -50 }, 2030)).toBe(20);
    });
});

describe('#208 config', () => {
    it('defaults the bond risk parameters from historical data', () => {
        expect(defaultMonteCarloConfig.bondReturnStdDev)
            .toBeCloseTo(RETURN_PRESETS.historical.bondStdDev, 10);
        expect(defaultMonteCarloConfig.stockBondCorrelation)
            .toBe(HISTORICAL_STATS.stockBondCorrelation);
        // Bonds are not risk-free — the whole point of this issue.
        expect(getBondStdDev(defaultMonteCarloConfig)).toBeGreaterThan(0);
    });

    it('resolves absent fields on a pre-#208 persisted config without a migration', () => {
        const legacy = { ...defaultMonteCarloConfig };
        delete legacy.bondReturnStdDev;
        delete legacy.stockBondCorrelation;
        expect(getBondStdDev(legacy)).toBe(RETURN_PRESETS.historical.bondStdDev);
        expect(getStockBondCorrelation(legacy)).toBe(HISTORICAL_STATS.stockBondCorrelation);
    });

    it('does not read `preset` at run time (it is UI tracking only)', () => {
        const a: MonteCarloConfig = { ...defaultMonteCarloConfig, preset: 'conservative' };
        const b: MonteCarloConfig = { ...defaultMonteCarloConfig, preset: 'historical' };
        expect(getBondStdDev(a)).toBe(getBondStdDev(b));
    });

    it('clamps an out-of-range stored correlation', () => {
        expect(getStockBondCorrelation({ ...defaultMonteCarloConfig, stockBondCorrelation: 4 })).toBe(1);
        expect(getStockBondCorrelation({ ...defaultMonteCarloConfig, stockBondCorrelation: -4 })).toBe(-1);
    });

    it('validates the new fields', () => {
        expect(validateConfig({ ...defaultMonteCarloConfig, bondReturnStdDev: -1 })).toMatch(/bond volatility/i);
        expect(validateConfig({ ...defaultMonteCarloConfig, bondReturnStdDev: 101 })).toMatch(/bond volatility/i);
        expect(validateConfig({ ...defaultMonteCarloConfig, stockBondCorrelation: 1.5 })).toMatch(/correlation/i);
        expect(validateConfig({ ...defaultMonteCarloConfig, stockBondCorrelation: -1 })).toBeNull();
        expect(validateConfig(defaultMonteCarloConfig)).toBeNull();
    });
});

describe('#208 historical bond statistics', () => {
    it('exposes a non-zero bond volatility from the Treasury series', () => {
        // ~7.9% on 1928-2024. If this ever reads 0, the two-asset model is inert.
        expect(HISTORICAL_STATS.bonds.stdDev).toBeGreaterThan(4);
        expect(HISTORICAL_STATS.bonds.stdDev).toBeLessThan(12);
    });

    it('derives the stock/bond correlation from the data', () => {
        // Historically near zero — bonds diversified equity risk well ON AVERAGE.
        expect(HISTORICAL_STATS.stockBondCorrelation).toBeGreaterThan(-0.5);
        expect(HISTORICAL_STATS.stockBondCorrelation).toBeLessThan(0.5);
    });
});
