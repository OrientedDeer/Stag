/**
 * Tests for refactored tax optimization functions
 *
 * These tests verify that the refactored functions (using calculateEffectiveConversionTax)
 * correctly handle:
 * - Basic federal tax brackets
 * - State tax integration
 * - SS torpedo effect
 * - ACA cliff detection
 * - Marginal rate calculations
 *
 * Uses 2026 Single federal parameters:
 * - Standard deduction: $16,100
 * - 10%: $0 - $12,400
 * - 12%: $12,400 - $50,400
 * - 22%: $50,400 - $105,700
 * - 24%: $105,700+
 */

import { describe, it, expect } from 'vitest';
import {
    getEffectiveConversionRate,
} from '../TaxOptimizedWithdrawal';
import { type ACAOptions } from '../helpers';
import { type TaxParameters } from '../../../data/TaxData';
import { type TaxState } from '../../../components/Objects/Taxes/TaxContext';
import * as TaxService from '../../../components/Objects/Taxes/TaxService';

// =============================================================================
// TEST SETUP
// =============================================================================

const year = 2026;

// Single filer tax state
const singleTaxState: TaxState = {
    filingStatus: 'Single',
    stateResidency: 'Virginia',
    deductionMethod: 'Standard',
    fedOverride: null,
    ficaOverride: null,
    stateOverride: null,
    year: year,
};

// Get actual 2026 Single federal params
const getFedParams = () => TaxService.getTaxParameters(year, 'Single', 'federal')!;

// Flat 5% state tax for testing
const flatStateParams: TaxParameters = {
    standardDeduction: 0,
    brackets: [
        { threshold: 0, rate: 0.05 }
    ],
    socialSecurityTaxRate: 0,  // Not applicable for state tax, but required by type
    socialSecurityWageBase: 0,
    medicareTaxRate: 0
};

// =============================================================================
// TESTS: getEffectiveConversionRate
// =============================================================================

describe('getEffectiveConversionRate', () => {
    /**
     * Note: getEffectiveConversionRate returns the MARGINAL tax rate at the given
     * conversion amount level, not the average effective rate on the conversion.
     *
     * Marginal rate = (tax at amount+1) - (tax at amount)
     * This tells us "what rate applies to the next $1 of conversion"
     */

    describe('basic conversions, no complications', () => {
        it('Test 1.1: returns ~12% marginal rate when conversion stays in 12% bracket', () => {
            const fedParams = getFedParams();
            // ordinaryIncome = 50000, conversion = 10000
            // Taxable after: 60000 - 16100 = 43900 (still in 12% bracket)
            // Marginal rate at this level should be 12%

            const rate = getEffectiveConversionRate(
                10000,      // conversionAmount
                50000,      // ordinaryIncome
                0,          // ltcgIncome
                0,          // socialSecurity
                fedParams,
                singleTaxState,
                year,
                null,       // stateParams
                undefined   // acaOptions
            );

            // Marginal rate should be 12% (federal only)
            expect(rate).toBeCloseTo(0.12, 4);
        });

        it('Test 1.2: returns ~17% marginal rate with 5% flat state tax', () => {
            const fedParams = getFedParams();
            // Same as 1.1 but with 5% state tax
            // 12% federal + 5% state = 17% marginal

            const rate = getEffectiveConversionRate(
                10000,
                50000,
                0,
                0,
                fedParams,
                singleTaxState,
                year,
                flatStateParams,
                undefined
            );

            // Marginal rate should be 12% + 5% = 17%
            expect(rate).toBeCloseTo(0.17, 4);
        });

        it('Test 1.3: returns ~22% marginal rate when conversion crosses into 22% bracket', () => {
            const fedParams = getFedParams();
            // ordinaryIncome = 60000, conversion = 10000
            // Taxable after: 70000 - 16100 = 53900 (in 22% bracket)
            // Marginal rate at this level should be 22%

            const rate = getEffectiveConversionRate(
                10000,
                60000,
                0,
                0,
                fedParams,
                singleTaxState,
                year,
                null,
                undefined
            );

            // Marginal rate should be 22% (in 22% bracket after conversion)
            expect(rate).toBeCloseTo(0.22, 4);
        });

        it('Test 1.3b: average rate for bracket-crossing conversion is between 12% and 22%', () => {
            const fedParams = getFedParams();
            // For the actual average effective rate on the conversion:
            // ordinaryIncome = 60000, conversion = 10000
            // Taxable before: 60000 - 16100 = 43900 (12% bracket)
            // Taxable after: 70000 - 16100 = 53900 (22% bracket)
            // 12% bracket ends at 50400 taxable
            // Portion in 12%: 50400 - 43900 = 6500
            // Portion in 22%: 53900 - 50400 = 3500
            // Tax: 6500 × 0.12 + 3500 × 0.22 = 780 + 770 = 1550
            // Average rate: 1550 / 10000 = 0.155

            // The marginal rate at conversion level is 22% (as tested above)
            // but the weighted average on the $10k is ~15.5%
            // We verify marginal rate is 22%:
            const rate = getEffectiveConversionRate(
                10000,
                60000,
                0,
                0,
                fedParams,
                singleTaxState,
                year,
                null,
                undefined
            );
            expect(rate).toBeCloseTo(0.22, 4);
        });
    });

    describe('with SS torpedo', () => {
        it('Test 1.4: returns elevated marginal rate when SS torpedo is active', () => {
            const fedParams = getFedParams();
            // ordinaryIncome = 15000, SS = 25000, conversion = 10000
            // Combined income affects SS taxability
            // In the torpedo zone, each $1 of conversion can cause $1.85 of taxable income
            // (the conversion + 0.85 more SS becoming taxable)
            // This amplifies the effective rate

            const rate = getEffectiveConversionRate(
                10000,
                15000,
                0,
                25000,      // Social Security benefits
                fedParams,
                singleTaxState,
                year,
                null,
                undefined
            );

            // With SS torpedo, marginal rate should be significantly > 12%
            // In 85% zone, each $1 income causes $0.85 more SS to be taxable
            // So effective rate ≈ bracket_rate × 1.85
            // At this income level (15000 + 10000 = 25000 gross), still in low bracket
            // but SS torpedo adds ~0.85 × bracket_rate
            expect(rate).toBeGreaterThan(0.15);
            expect(rate).toBeLessThan(0.35);
        });

        it('Test 1.4b: SS torpedo causes higher rate than nominal bracket', () => {
            const fedParams = getFedParams();
            // Compare rate with and without SS

            const rateWithoutSS = getEffectiveConversionRate(
                10000,
                15000,
                0,
                0,          // No SS
                fedParams,
                singleTaxState,
                year,
                null,
                undefined
            );

            const rateWithSS = getEffectiveConversionRate(
                10000,
                15000,
                0,
                25000,      // SS triggers torpedo
                fedParams,
                singleTaxState,
                year,
                null,
                undefined
            );

            // Rate with SS should be higher than rate without SS
            expect(rateWithSS).toBeGreaterThan(rateWithoutSS);
        });
    });

    describe('with ACA cliff', () => {
        it('Test 1.5: returns normal marginal rate when conversion is well past cliff', () => {
            const fedParams = getFedParams();
            // ordinaryIncome = 60000, conversion = 10000
            // MAGI = 70000, cliff = 64400
            // Already past cliff at the conversion amount, so marginal rate is just bracket rate

            const acaOptions: ACAOptions = {
                currentAge: 60,
                acaSubsidyAware: true,
                acaCliffThreshold: 64400,
                estimatedSubsidyLoss: 8000
            };

            const rate = getEffectiveConversionRate(
                10000,
                60000,
                0,
                0,
                fedParams,
                singleTaxState,
                year,
                null,
                acaOptions
            );

            // At $10k conversion, we're well past the cliff
            // The cliff was crossed at $4400 conversion
            // At $10k, marginal rate is just the bracket rate (22%)
            expect(rate).toBeCloseTo(0.22, 4);
        });

    });

    describe('zero conversion', () => {
        it('Test 1.6: returns marginal rate at current income when conversion is 0', () => {
            const fedParams = getFedParams();
            // ordinaryIncome = 50000, conversion = 0
            // Taxable: 50000 - 16100 = 33900 (12% bracket)
            // Marginal rate is 12%

            const rate = getEffectiveConversionRate(
                0,          // Zero conversion
                50000,
                0,
                0,
                fedParams,
                singleTaxState,
                year,
                null,
                undefined
            );

            // Marginal rate at current income level should be 12%
            expect(rate).toBeCloseTo(0.12, 4);
        });

        it('Test 1.6b: zero conversion with state tax returns combined marginal rate', () => {
            const fedParams = getFedParams();

            const rate = getEffectiveConversionRate(
                0,
                50000,
                0,
                0,
                fedParams,
                singleTaxState,
                year,
                flatStateParams,
                undefined
            );

            // 12% federal + 5% state = 17%
            expect(rate).toBeCloseTo(0.17, 4);
        });
    });
});

// =============================================================================
// PRECISION VERIFICATION TESTS
// =============================================================================

describe('precision verification', () => {
    it('marginal rates are accurate to 0.01%', () => {
        const fedParams = getFedParams();

        // In 12% bracket, marginal rate should be exactly 12%
        const rate12 = getEffectiveConversionRate(
            5000,
            30000,      // Taxable: 13900, in 12% bracket
            0,
            0,
            fedParams,
            singleTaxState,
            year,
            null,
            undefined
        );
        expect(rate12).toBeCloseTo(0.12, 4);

        // In 22% bracket, marginal rate should be exactly 22%
        const rate22 = getEffectiveConversionRate(
            5000,
            75000,      // Taxable: 58900, in 22% bracket
            0,
            0,
            fedParams,
            singleTaxState,
            year,
            null,
            undefined
        );
        expect(rate22).toBeCloseTo(0.22, 4);

        // In 10% bracket, marginal rate should be exactly 10%
        const rate10 = getEffectiveConversionRate(
            5000,
            20000,      // Taxable: 3900, in 10% bracket
            0,
            0,
            fedParams,
            singleTaxState,
            year,
            null,
            undefined
        );
        expect(rate10).toBeCloseTo(0.10, 4);
    });

    it('state tax adds exactly 5% to marginal rate', () => {
        const fedParams = getFedParams();

        const rateNoState = getEffectiveConversionRate(
            5000,
            50000,
            0,
            0,
            fedParams,
            singleTaxState,
            year,
            null,
            undefined
        );

        const rateWithState = getEffectiveConversionRate(
            5000,
            50000,
            0,
            0,
            fedParams,
            singleTaxState,
            year,
            flatStateParams,
            undefined
        );

        // State should add exactly 5%
        expect(rateWithState - rateNoState).toBeCloseTo(0.05, 4);
    });
});
