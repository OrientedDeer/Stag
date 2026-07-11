import { describe, it, expect } from 'vitest';
import { getCombinedMarginalRate } from '../../components/Objects/Taxes/TaxService';
import { type TaxState } from '../../components/Objects/Taxes/TaxContext';
import { defaultAssumptions, type AssumptionsState } from '../../components/Objects/Assumptions/AssumptionsContext';

// --- Helpers (mirror ReviewFixes_PR55_marginalRates.test.ts) ---

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

// =====================================================================
// ISSUE 1 — FICA marginal-rate wage-base test must use EARNED income
// (net of FICA exemptions), not total gross income.
// =====================================================================
describe('ISSUE 1 — FICA wage-base test uses earned income, not gross', () => {
    // 2025 Single SS wage base = $176,100. SS rate 6.2% + Medicare 1.45% = 7.65%.
    // A still-working person earning $120k wages who ALSO collects $60k of SS/pension
    // has gross $180k (above the base) but earned $120k (below the base). The next
    // earned dollar still owes the 6.2% SS portion, so FICA marginal must be 7.65%.
    it('keeps the 6.2% SS rate when EARNED income is below the wage base even though gross is above it', () => {
        const result = getCombinedMarginalRate(
            180000, // grossIncome (wages 120k + SS/pension 60k) — above the 176,100 base
            0,
            createTaxState({ filingStatus: 'Single' }),
            2025,
            noInflationAssumptions,
            true, // includesFICA
            120000, // earnedIncome (net of FICA exemptions) — BELOW the base
        );

        // Earned $120k < $176,100 base -> SS 6.2% still applies: 6.2% + 1.45% = 7.65%.
        // (Gross $180k > $200k Single Additional-Medicare threshold? No: 180k < 200k.)
        expect(result.fica).toBeCloseTo(0.0765, 6);
    });

    it('drops the 6.2% SS rate once EARNED income clears the wage base', () => {
        const result = getCombinedMarginalRate(
            300000, // gross
            0,
            createTaxState({ filingStatus: 'Single' }),
            2025,
            noInflationAssumptions,
            true,
            200000, // earned > 176,100 base -> SS portion gone
        );

        // Above the base: Medicare 1.45% only (earned 200k also hits the 200k Single
        // Additional-Medicare threshold, but at exactly the threshold the >= surtax test
        // fires off gross which is 300k >= 200k, so +0.9%). Medicare 1.45% + 0.9% = 2.35%.
        expect(result.fica).toBeCloseTo(0.0235, 6);
    });

    it('defaults earnedIncome to grossIncome (backward compatible) when omitted', () => {
        // Gross == earned for a worker with only wages: 150k < 176,100 base -> 7.65%.
        const below = getCombinedMarginalRate(
            150000, 0, createTaxState({ filingStatus: 'Single' }), 2025, noInflationAssumptions, true,
        );
        expect(below.fica).toBeCloseTo(0.0765, 6);

        // 200k gross-only earner above the base -> Medicare 1.45%, and gross 200k >= 200k
        // surtax threshold -> +0.9% => 2.35%.
        const above = getCombinedMarginalRate(
            200000, 0, createTaxState({ filingStatus: 'Single' }), 2025, noInflationAssumptions, true,
        );
        expect(above.fica).toBeCloseTo(0.0235, 6);
    });
});
