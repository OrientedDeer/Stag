/**
 * Tests for MonteCarloTypes utility functions
 */

import { describe, it, expect } from 'vitest';
import {
    getPresetReturnMean,
    RETURN_PRESETS,
    type ReturnPresetKey
} from '../../services/MonteCarloTypes';

describe('getPresetReturnMean', () => {
    // The named presets' inflation-OFF (real) returns. The nominal return is
    // derived from these as `real + simInflation` (#109), so they anchor every
    // expectation below.
    const HISTORICAL_REAL = RETURN_PRESETS.historical.returnMeanReal; // 8.4
    const CONSERVATIVE_REAL = RETURN_PRESETS.conservative.returnMeanReal; // 4

    describe('Historical preset', () => {
        it('returns the real return when inflationAdjusted is false (ignores the inflation rate)', () => {
            expect(getPresetReturnMean('historical', false, 3)).toBe(HISTORICAL_REAL);
            expect(getPresetReturnMean('historical', false)).toBe(HISTORICAL_REAL);
        });

        it('derives nominal as real + sim inflation when inflationAdjusted is true', () => {
            // Acceptance: with inflation at X%, Historical Mean = round(8.4 + X).
            expect(getPresetReturnMean('historical', true, 0)).toBe(8.4);
            expect(getPresetReturnMean('historical', true, 2)).toBe(10.4);
            expect(getPresetReturnMean('historical', true, 3)).toBe(11.4);
        });

        it('tracks the sim inflation rate (the #109 symptom: it used to be frozen)', () => {
            const lowInflation = getPresetReturnMean('historical', true, 1);
            const highInflation = getPresetReturnMean('historical', true, 5);
            expect(highInflation).toBeGreaterThan(lowInflation);
            expect(highInflation - lowInflation).toBeCloseTo(4, 5);
        });

        it('no longer returns the frozen historic-CPI nominal (~11.8) regardless of sim inflation', () => {
            // returnMeanNominal is now only a seed default; the derived value at a
            // typical 2% sim inflation must NOT equal the old frozen 11.8.
            expect(getPresetReturnMean('historical', true, 2)).not.toBe(RETURN_PRESETS.historical.returnMeanNominal);
        });

        it('should have nominal > real for historical when inflation is positive', () => {
            const nominal = getPresetReturnMean('historical', true, 2);
            const real = getPresetReturnMean('historical', false, 2);
            expect(nominal).toBeGreaterThan(real);
        });
    });

    describe('Conservative preset', () => {
        it('returns the real return (4%) when inflationAdjusted is false', () => {
            expect(getPresetReturnMean('conservative', false, 3)).toBe(CONSERVATIVE_REAL);
            expect(getPresetReturnMean('conservative', false)).toBe(4);
        });

        it('derives nominal as 4 + sim inflation when inflationAdjusted is true', () => {
            // Acceptance: with inflation at X%, Conservative Mean = round(4 + X).
            expect(getPresetReturnMean('conservative', true, 0)).toBe(4);
            expect(getPresetReturnMean('conservative', true, 2)).toBe(6);
            expect(getPresetReturnMean('conservative', true, 3)).toBe(7);
        });

        it('no longer bakes in the frozen 2% inflation (was a static nominal 6)', () => {
            expect(getPresetReturnMean('conservative', true, 4)).toBe(8);
            expect(getPresetReturnMean('conservative', true, 4)).not.toBe(RETURN_PRESETS.conservative.returnMeanNominal);
        });

        it('should have nominal > real for conservative when inflation is positive', () => {
            const nominal = getPresetReturnMean('conservative', true, 2);
            const real = getPresetReturnMean('conservative', false, 2);
            expect(nominal).toBeGreaterThan(real);
        });
    });

    describe('Custom preset', () => {
        it('returns the real value (7%) when inflationAdjusted is false', () => {
            const result = getPresetReturnMean('custom', false, 3);
            expect(result).toBe(RETURN_PRESETS.custom.returnMeanReal);
            expect(result).toBe(7);
        });

        it('derives nominal as 7 + sim inflation when inflationAdjusted is true', () => {
            expect(getPresetReturnMean('custom', true, 0)).toBe(7);
            expect(getPresetReturnMean('custom', true, 2)).toBe(9);
        });
    });

    describe('Default sim inflation rate', () => {
        const presetKeys: ReturnPresetKey[] = ['historical', 'conservative', 'custom'];

        it.each(presetKeys)('degrades to the real return when no rate is supplied (preset %s)', (preset) => {
            // A missing sim inflation rate must not throw or NaN — it falls back to
            // the real return (real + 0).
            expect(getPresetReturnMean(preset, true)).toBe(RETURN_PRESETS[preset].returnMeanReal);
        });
    });

    describe('Comparison across presets', () => {
        it('should have historical nominal >= conservative nominal at the same inflation rate', () => {
            const historical = getPresetReturnMean('historical', true, 2);
            const conservative = getPresetReturnMean('conservative', true, 2);
            expect(historical).toBeGreaterThanOrEqual(conservative);
        });

        it('should return different values for different presets', () => {
            const historicalNominal = getPresetReturnMean('historical', true, 2);
            const conservativeNominal = getPresetReturnMean('conservative', true, 2);
            const customNominal = getPresetReturnMean('custom', true, 2);

            // At least one pair should be different
            const allSame = historicalNominal === conservativeNominal &&
                            conservativeNominal === customNominal;
            expect(allSame).toBe(false);
        });
    });

    describe('All preset keys', () => {
        const presetKeys: ReturnPresetKey[] = ['historical', 'conservative', 'custom'];

        it.each(presetKeys)('should return a number for preset %s with inflationAdjusted=true', (preset) => {
            const result = getPresetReturnMean(preset, true, 2);
            expect(typeof result).toBe('number');
            expect(Number.isFinite(result)).toBe(true);
        });

        it.each(presetKeys)('should return a number for preset %s with inflationAdjusted=false', (preset) => {
            const result = getPresetReturnMean(preset, false, 2);
            expect(typeof result).toBe('number');
            expect(Number.isFinite(result)).toBe(true);
        });

        it.each(presetKeys)('should return positive values for preset %s', (preset) => {
            const nominal = getPresetReturnMean(preset, true, 2);
            const real = getPresetReturnMean(preset, false, 2);
            expect(nominal).toBeGreaterThan(0);
            expect(real).toBeGreaterThan(0);
        });
    });
});

describe('RETURN_PRESETS', () => {
    it('should have all required presets', () => {
        expect(RETURN_PRESETS).toHaveProperty('historical');
        expect(RETURN_PRESETS).toHaveProperty('conservative');
        expect(RETURN_PRESETS).toHaveProperty('custom');
    });

    it('should have valid structure for each preset', () => {
        for (const key of Object.keys(RETURN_PRESETS) as ReturnPresetKey[]) {
            const preset = RETURN_PRESETS[key];
            expect(preset).toHaveProperty('key');
            expect(preset).toHaveProperty('label');
            expect(preset).toHaveProperty('description');
            expect(preset).toHaveProperty('returnMeanNominal');
            expect(preset).toHaveProperty('returnMeanReal');
            expect(preset).toHaveProperty('returnStdDev');

            expect(preset.key).toBe(key);
            expect(typeof preset.label).toBe('string');
            expect(typeof preset.description).toBe('string');
            expect(typeof preset.returnMeanNominal).toBe('number');
            expect(typeof preset.returnMeanReal).toBe('number');
            expect(typeof preset.returnStdDev).toBe('number');
        }
    });

    it('should have positive standard deviations', () => {
        for (const key of Object.keys(RETURN_PRESETS) as ReturnPresetKey[]) {
            expect(RETURN_PRESETS[key].returnStdDev).toBeGreaterThan(0);
        }
    });
});
