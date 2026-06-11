import { describe, it, expect } from 'vitest';
import { getCombinedMarginalRate } from '../../components/Objects/Taxes/TaxService';
import { TaxState } from '../../components/Objects/Taxes/TaxContext';
import { defaultAssumptions, AssumptionsState } from '../../components/Objects/Assumptions/AssumptionsContext';

// --- Test Helpers (mirror TaxOptimization.test.ts) ---

const createTaxState = (overrides: Partial<TaxState> = {}): TaxState => ({
    filingStatus: 'Single',
    stateResidency: 'Texas', // no state income tax -> isolate federal + FICA
    deductionMethod: 'Standard',
    fedOverride: null,
    ficaOverride: null,
    stateOverride: null,
    year: 2025,
    ...overrides,
});

const noInflationAssumptions: AssumptionsState = {
    ...defaultAssumptions,
    macro: {
        ...defaultAssumptions.macro,
        inflationAdjusted: false,
        inflationRate: 0,
    },
};

describe('PR #55 #1 — Additional Medicare 0.9% surtax in combined marginal rate', () => {
    it('includes the 0.9% surtax above the Single threshold (260k => fica ≈ 0.0235)', () => {
        const result = getCombinedMarginalRate(
            260000,
            0,
            createTaxState({ filingStatus: 'Single' }),
            2025,
            noInflationAssumptions,
            true,
        );

        // Above SS wage base: Medicare 1.45% + Additional Medicare 0.9% = 2.35%
        expect(result.fica).toBeCloseTo(0.0235, 6);
        // combined must include the surtax (fica is one of its addends)
        expect(result.combined).toBeCloseTo(result.federal + result.state + result.fica, 6);
        expect(result.combined).toBeGreaterThanOrEqual(0.0235);
    });

    it('does NOT include the 0.9% surtax below the threshold (150k)', () => {
        const result = getCombinedMarginalRate(
            150000,
            0,
            createTaxState({ filingStatus: 'Single' }),
            2025,
            noInflationAssumptions,
            true,
        );

        // 150k < 200k Single threshold and < SS wage base:
        // SS 6.2% + Medicare 1.45% = 7.65%, no 0.9% surtax.
        expect(result.fica).toBeCloseTo(0.0765, 6);
        // Explicitly: no surtax baked in.
        expect(result.fica).toBeLessThan(0.0766);
    });

    it('respects the MFJ 250k threshold', () => {
        const below = getCombinedMarginalRate(
            240000,
            0,
            createTaxState({ filingStatus: 'Married Filing Jointly' }),
            2025,
            noInflationAssumptions,
            true,
        );
        // 240k < 250k MFJ threshold but > SS wage base -> Medicare only, no surtax
        expect(below.fica).toBeCloseTo(0.0145, 6);

        const above = getCombinedMarginalRate(
            260000,
            0,
            createTaxState({ filingStatus: 'Married Filing Jointly' }),
            2025,
            noInflationAssumptions,
            true,
        );
        expect(above.fica).toBeCloseTo(0.0235, 6);
    });

    it('omits the surtax entirely when FICA is excluded', () => {
        const result = getCombinedMarginalRate(
            260000,
            0,
            createTaxState({ filingStatus: 'Single' }),
            2025,
            noInflationAssumptions,
            false,
        );
        expect(result.fica).toBe(0);
    });
});
