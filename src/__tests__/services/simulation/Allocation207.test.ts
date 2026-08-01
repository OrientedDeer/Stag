import { describe, it, expect } from 'vitest';
import {
    blendRate,
    defaultStockPctForYear,
    resolveStockPct,
    blendedRoR,
    defaultBlendedRoR,
    effectiveRoR,
    blendedMonteCarloReturn,
} from '../../../services/simulation/allocation';
import { defaultAssumptions, type AssumptionsState } from '../../../components/Objects/Assumptions/AssumptionsContext';

/**
 * #207 asset allocation resolver.
 *
 * The load-bearing claim under test is BACKWARD COMPATIBILITY: at the default 100% stock
 * allocation every accessor must return the bare `ror`, so pre-#207 plans and the golden
 * masters are unchanged. The rest covers the glidepath interpolation and the precedence
 * rules (customROR > per-account allocation > glidepath > default).
 */

const BIRTH_YEAR = 1985;

function makeAssumptions(overrides: {
    ror?: number;
    bondRor?: number;
    stockPct?: number;
    glidepath?: AssumptionsState['investments']['allocationGlidepath'];
    inflationAdjusted?: boolean;
    inflationRate?: number;
} = {}): AssumptionsState {
    const base = structuredClone(defaultAssumptions);
    base.investments.returnRates.ror = overrides.ror ?? 6;
    base.investments.returnRates.bondRor = overrides.bondRor ?? 2;
    base.investments.defaultAllocation = { stockPct: overrides.stockPct ?? 100 };
    base.investments.allocationGlidepath = overrides.glidepath;
    base.macro.inflationAdjusted = overrides.inflationAdjusted ?? false;
    base.macro.inflationRate = overrides.inflationRate ?? 2.5;
    // getBirthYear reads the BIRTH milestone; pin it so age math is deterministic.
    base.milestones = base.milestones.map(m =>
        m.conditions?.[0]?.type === 'YEAR'
            ? { ...m, conditions: [{ ...m.conditions[0], value: BIRTH_YEAR }] }
            : m,
    );
    return base;
}

describe('#207 allocation resolver', () => {
    describe('blendRate', () => {
        it('returns the stock rate EXACTLY at 100% (no floating-point drift)', () => {
            // Not `toBeCloseTo` on purpose: the golden masters depend on bit-identity,
            // which `1.0 * r + 0 * b` does not guarantee.
            expect(blendRate(100, 7.3, 2.1)).toBe(7.3);
            expect(Object.is(blendRate(100, 0.1 + 0.2, 2), 0.1 + 0.2)).toBe(true);
        });

        it('returns the bond rate exactly at 0%', () => {
            expect(blendRate(0, 7.3, 2.1)).toBe(2.1);
        });

        it('interpolates linearly in between', () => {
            expect(blendRate(60, 10, 0)).toBeCloseTo(6, 10);
            expect(blendRate(25, 8, 4)).toBeCloseTo(5, 10);
        });

        it('clamps out-of-range percentages', () => {
            expect(blendRate(150, 7, 2)).toBe(7);
            expect(blendRate(-20, 7, 2)).toBe(2);
        });
    });

    describe('defaults and backward compatibility', () => {
        it('an absent defaultAllocation reads as 100% stock', () => {
            const a = makeAssumptions();
            delete a.investments.defaultAllocation;
            expect(defaultStockPctForYear(a, 2030)).toBe(100);
            expect(defaultBlendedRoR(a, 2030)).toBe(a.investments.returnRates.ror);
        });

        it('an absent bondRor never changes an all-stock result', () => {
            const a = makeAssumptions({ ror: 6 });
            delete a.investments.returnRates.bondRor;
            expect(blendedRoR({}, a, 2030)).toBe(6);
        });

        it('blendedRoR equals ror at the default allocation', () => {
            const a = makeAssumptions({ ror: 5.9, bondRor: 2 });
            expect(blendedRoR({}, a, 2030)).toBe(5.9);
        });
    });

    describe('per-account override', () => {
        it('uses the account stockPct over the default', () => {
            const a = makeAssumptions({ ror: 10, bondRor: 0, stockPct: 100 });
            expect(blendedRoR({ stockPct: 40 }, a, 2030)).toBeCloseTo(4, 10);
        });

        it('clamps and ignores non-finite per-account values', () => {
            const a = makeAssumptions({ ror: 10, bondRor: 0, stockPct: 50 });
            expect(resolveStockPct({ stockPct: 120 }, a, 2030)).toBe(100);
            expect(resolveStockPct({ stockPct: NaN }, a, 2030)).toBe(50);
        });
    });

    describe('glidepath', () => {
        const glidepath = {
            enabled: true,
            startAge: 40,
            endAge: 60,
            startStockPct: 100,
            endStockPct: 50,
        };

        it('holds flat before the start age and after the end age', () => {
            const a = makeAssumptions({ glidepath });
            expect(defaultStockPctForYear(a, BIRTH_YEAR + 30)).toBe(100);
            expect(defaultStockPctForYear(a, BIRTH_YEAR + 40)).toBe(100);
            expect(defaultStockPctForYear(a, BIRTH_YEAR + 60)).toBe(50);
            expect(defaultStockPctForYear(a, BIRTH_YEAR + 80)).toBe(50);
        });

        it('interpolates linearly across the band', () => {
            const a = makeAssumptions({ glidepath });
            expect(defaultStockPctForYear(a, BIRTH_YEAR + 50)).toBeCloseTo(75, 10);
            expect(defaultStockPctForYear(a, BIRTH_YEAR + 45)).toBeCloseTo(87.5, 10);
        });

        it('is ignored when disabled', () => {
            const a = makeAssumptions({ stockPct: 80, glidepath: { ...glidepath, enabled: false } });
            expect(defaultStockPctForYear(a, BIRTH_YEAR + 50)).toBe(80);
        });

        it('falls back to the flat default when no year is supplied', () => {
            // increment()'s `currentYear` defaults to 0; that must not be read as an age
            // of -BIRTH_YEAR and clamped to the start of the glidepath.
            const a = makeAssumptions({ stockPct: 80, glidepath });
            expect(defaultStockPctForYear(a, 0)).toBe(80);
            expect(defaultStockPctForYear(a)).toBe(80);
        });

        it('resolves a degenerate band (endAge <= startAge) to the end allocation', () => {
            const a = makeAssumptions({ glidepath: { ...glidepath, startAge: 60, endAge: 40 } });
            expect(defaultStockPctForYear(a, BIRTH_YEAR + 50)).toBe(50);
        });

        it('does NOT apply to an account with its own allocation', () => {
            const a = makeAssumptions({ glidepath });
            expect(resolveStockPct({ stockPct: 90 }, a, BIRTH_YEAR + 60)).toBe(90);
            expect(resolveStockPct({}, a, BIRTH_YEAR + 60)).toBe(50);
        });
    });

    describe('effectiveRoR precedence', () => {
        it('customROR wins over any allocation', () => {
            const a = makeAssumptions({ ror: 10, bondRor: 0, stockPct: 20 });
            expect(effectiveRoR({ customROR: 4.2, stockPct: 60 }, a, 2030)).toBe(4.2);
        });

        it('falls through to the blend when customROR is unset', () => {
            const a = makeAssumptions({ ror: 10, bondRor: 0 });
            expect(effectiveRoR({ stockPct: 60 }, a, 2030)).toBeCloseTo(6, 10);
        });
    });

    describe('blendedMonteCarloReturn', () => {
        it('passes the drawn return through untouched at 100% stock', () => {
            const a = makeAssumptions({ stockPct: 100 });
            expect(blendedMonteCarloReturn({}, a, 23.7, 2030)).toBe(23.7);
        });

        it('blends the drawn return against the bond rate', () => {
            const a = makeAssumptions({ bondRor: 2, stockPct: 50, inflationAdjusted: false });
            // 0.5 * 20 + 0.5 * 2
            expect(blendedMonteCarloReturn({}, a, 20, 2030)).toBeCloseTo(11, 10);
        });

        it('adds inflation to the bond leg when the plan runs nominal', () => {
            // The drawn series is already nominal (the MC preset mean includes inflation),
            // while bondRor is stored real — without this the bond leg undershoots by the
            // inflation rate in MC only.
            const a = makeAssumptions({
                bondRor: 2, stockPct: 50, inflationAdjusted: true, inflationRate: 3,
            });
            // 0.5 * 20 + 0.5 * (2 + 3)
            expect(blendedMonteCarloReturn({}, a, 20, 2030)).toBeCloseTo(12.5, 10);
        });

        it('dampens a drawn loss for a bond-heavy account', () => {
            const a = makeAssumptions({ bondRor: 2, stockPct: 25, inflationAdjusted: false });
            // 0.25 * -30 + 0.75 * 2
            expect(blendedMonteCarloReturn({}, a, -30, 2030)).toBeCloseTo(-6, 10);
        });
    });
});
