import { describe, it, expect, vi, afterEach } from 'vitest';
import {
    getCombinedMarginalRate,
    calculateCapitalGainsTax,
    calculateTotalFederalTax,
} from '../../components/Objects/Taxes/TaxService';
import * as parametersModule from '../../components/Objects/Taxes/taxService/parameters';
import { getTaxParameters } from '../../components/Objects/Taxes/taxService/parameters';
import { TaxState } from '../../components/Objects/Taxes/TaxContext';
import { defaultAssumptions, AssumptionsState } from '../../components/Objects/Assumptions/AssumptionsContext';

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

// =====================================================================
// ISSUE 2 — standalone calculateCapitalGainsTax must agree with the
// canonical engine LTCG path (calculateTotalFederalTax STEP 5).
// =====================================================================
describe('ISSUE 2 — calculateCapitalGainsTax delegates to the engine LTCG path', () => {
    const engineLtcg = (gains: number, ordinaryTaxable: number, ts: TaxState, year: number) => {
        const fedParams = getTaxParameters(year, ts.filingStatus, 'federal', undefined, noInflationAssumptions)!;
        // Reconstruct the standalone contract: ordinaryTaxable is ALREADY after the
        // standard deduction, so feed (ordinaryTaxable + stdDed) as pre-deduction
        // ordinary income, gains as LTCG, everything else zero.
        return calculateTotalFederalTax(
            ordinaryTaxable + fedParams.standardDeduction,
            0, // SS
            0, // STCG
            gains, // LTCG
            0, // preTaxDeductions
            ts.filingStatus,
            fedParams,
        ).ltcgTax;
    };

    it('matches the engine for gains above the 20% threshold (was a flat-15% divergence risk)', () => {
        const ts = createTaxState({ filingStatus: 'Single' });
        // 2025 Single LTCG: 0% @0, 15% @48,350, 20% @533,400.
        // Ordinary taxable 500k, 50k gains: 33,400 @15% + 16,600 @20%.
        const standalone = calculateCapitalGainsTax(50000, 500000, ts, 2025, noInflationAssumptions);
        const engine = engineLtcg(50000, 500000, ts, 2025);

        expect(standalone).toBeCloseTo(engine, 4);
        // And it is NOT the old flat-15% answer (50000 * 0.15 = 7500).
        expect(standalone).not.toBeCloseTo(7500, 0);
        expect(standalone).toBeCloseTo((33400 * 0.15) + (16600 * 0.20), 0);
    });

    it('matches the engine when gains span the 0% and 15% brackets (bracket-floor refinement)', () => {
        const ts = createTaxState({ filingStatus: 'Single' });
        const standalone = calculateCapitalGainsTax(20000, 40000, ts, 2025, noInflationAssumptions);
        const engine = engineLtcg(20000, 40000, ts, 2025);
        expect(standalone).toBeCloseTo(engine, 4);
    });

    it('matches the engine across all three LTCG brackets at once', () => {
        const ts = createTaxState({ filingStatus: 'Married Filing Jointly' });
        // Start ordinary low so gains stack from 0% all the way through 20%.
        const standalone = calculateCapitalGainsTax(700000, 10000, ts, 2025, noInflationAssumptions);
        const engine = engineLtcg(700000, 10000, ts, 2025);
        expect(standalone).toBeCloseTo(engine, 4);
    });

    it('returns 0 for non-positive gains', () => {
        const ts = createTaxState();
        expect(calculateCapitalGainsTax(0, 50000, ts, 2025, noInflationAssumptions)).toBe(0);
        expect(calculateCapitalGainsTax(-1000, 50000, ts, 2025, noInflationAssumptions)).toBe(0);
    });

    describe('missing capitalGainsBrackets fallback', () => {
        afterEach(() => {
            vi.restoreAllMocks();
        });

        it('mirrors the engine (no LTCG tax) instead of the old flat-15% fallback when brackets are absent', () => {
            const ts = createTaxState({ filingStatus: 'Single' });
            const real = getTaxParameters(2025, 'Single', 'federal', undefined, noInflationAssumptions)!;
            // Federal params with the LTCG brackets stripped: the engine STEP 5 guard
            // (`&& params.capitalGainsBrackets`) yields ltcgTax = 0, so the delegated
            // standalone must also be 0 — NOT the old `gains * 0.15` = 7,500.
            const noLtcgBrackets = { ...real, capitalGainsBrackets: undefined };
            vi.spyOn(parametersModule, 'getTaxParameters').mockReturnValue(noLtcgBrackets);

            const result = calculateCapitalGainsTax(50000, 100000, ts, 2025, noInflationAssumptions);
            expect(result).toBe(0);
            expect(result).not.toBeCloseTo(50000 * 0.15, 0);
        });
    });
});
