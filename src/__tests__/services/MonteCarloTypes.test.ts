/**
 * Tests for MonteCarloTypes utility functions
 */

import { describe, it, expect } from 'vitest';
import {
    getPresetReturnMean,
    RETURN_PRESETS,
    ReturnPresetKey
} from '../../services/MonteCarloTypes';

describe('getPresetReturnMean', () => {
    describe('Historical preset', () => {
        it('should return nominal return when inflationAdjusted is true', () => {
            const result = getPresetReturnMean('historical', true);
            expect(result).toBe(RETURN_PRESETS.historical.returnMeanNominal);
        });

        it('should return real return when inflationAdjusted is false', () => {
            const result = getPresetReturnMean('historical', false);
            expect(result).toBe(RETURN_PRESETS.historical.returnMeanReal);
        });

        it('should have nominal > real for historical (due to inflation)', () => {
            const nominal = getPresetReturnMean('historical', true);
            const real = getPresetReturnMean('historical', false);
            expect(nominal).toBeGreaterThan(real);
        });
    });

    describe('Conservative preset', () => {
        it('should return nominal return when inflationAdjusted is true', () => {
            const result = getPresetReturnMean('conservative', true);
            expect(result).toBe(RETURN_PRESETS.conservative.returnMeanNominal);
            expect(result).toBe(6);
        });

        it('should return real return when inflationAdjusted is false', () => {
            const result = getPresetReturnMean('conservative', false);
            expect(result).toBe(RETURN_PRESETS.conservative.returnMeanReal);
            expect(result).toBe(4);
        });

        it('should have nominal > real for conservative', () => {
            const nominal = getPresetReturnMean('conservative', true);
            const real = getPresetReturnMean('conservative', false);
            expect(nominal).toBeGreaterThan(real);
        });
    });

    describe('Custom preset', () => {
        it('should return nominal return when inflationAdjusted is true', () => {
            const result = getPresetReturnMean('custom', true);
            expect(result).toBe(RETURN_PRESETS.custom.returnMeanNominal);
            expect(result).toBe(7);
        });

        it('should return real return when inflationAdjusted is false', () => {
            const result = getPresetReturnMean('custom', false);
            expect(result).toBe(RETURN_PRESETS.custom.returnMeanReal);
            expect(result).toBe(7);
        });

        it('should have equal nominal and real for custom (same defaults)', () => {
            const nominal = getPresetReturnMean('custom', true);
            const real = getPresetReturnMean('custom', false);
            expect(nominal).toBe(real);
        });
    });

    describe('Comparison across presets', () => {
        it('should have historical nominal >= conservative nominal', () => {
            const historical = getPresetReturnMean('historical', true);
            const conservative = getPresetReturnMean('conservative', true);
            expect(historical).toBeGreaterThanOrEqual(conservative);
        });

        it('should return different values for different presets', () => {
            const historicalNominal = getPresetReturnMean('historical', true);
            const conservativeNominal = getPresetReturnMean('conservative', true);
            const customNominal = getPresetReturnMean('custom', true);

            // At least one pair should be different
            const allSame = historicalNominal === conservativeNominal &&
                            conservativeNominal === customNominal;
            expect(allSame).toBe(false);
        });
    });

    describe('All preset keys', () => {
        const presetKeys: ReturnPresetKey[] = ['historical', 'conservative', 'custom'];

        it.each(presetKeys)('should return a number for preset %s with inflationAdjusted=true', (preset) => {
            const result = getPresetReturnMean(preset, true);
            expect(typeof result).toBe('number');
            expect(Number.isFinite(result)).toBe(true);
        });

        it.each(presetKeys)('should return a number for preset %s with inflationAdjusted=false', (preset) => {
            const result = getPresetReturnMean(preset, false);
            expect(typeof result).toBe('number');
            expect(Number.isFinite(result)).toBe(true);
        });

        it.each(presetKeys)('should return positive values for preset %s', (preset) => {
            const nominal = getPresetReturnMean(preset, true);
            const real = getPresetReturnMean(preset, false);
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
