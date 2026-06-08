/**
 * Tests for estimateFixedIncomeAtRMD
 *
 * This function projects SS and pension income from current age to RMD age
 * using COLA (Cost of Living Adjustment) rates.
 */

import { describe, it, expect } from 'vitest';
import {
    estimateFixedIncomeAtRMD,
    DEFAULT_SS_COLA,
    DEFAULT_PENSION_COLA,
} from '../../../services/simulation/helpers';

describe('estimateFixedIncomeAtRMD', () => {

    describe('SS projection with COLA', () => {
        it('projects current SS income forward with 2% COLA', () => {
            // Person age 67, receiving $30k/year SS, RMD at 75
            // 8 years of 2% COLA: $30,000 × 1.02^8 = $35,149.78
            const result = estimateFixedIncomeAtRMD(
                30000,  // currentSSIncome
                0,      // futureSS_PIA (already receiving)
                0,      // currentPensionIncome
                67,     // currentAge
                75,     // rmdStartAge
                67,     // ssClaimingAge
                0.02,   // ssCola
                0.02    // pensionCola
            );

            expect(result.ssAtRMD).toBeCloseTo(35149.78, 0);
            expect(result.yearsProjected).toBe(8);
        });

        it('projects SS with 3% COLA', () => {
            // Person age 65, receiving $36k/year SS, RMD at 75
            // 10 years of 3% COLA: $36,000 × 1.03^10
            const expectedSS = 36000 * Math.pow(1.03, 10);
            const result = estimateFixedIncomeAtRMD(
                36000,  // currentSSIncome
                0,      // futureSS_PIA
                0,      // currentPensionIncome
                65,     // currentAge
                75,     // rmdStartAge
                65,     // ssClaimingAge
                0.03,   // ssCola
                0.02    // pensionCola
            );

            expect(result.ssAtRMD).toBeCloseTo(expectedSS, 2);
            expect(result.yearsProjected).toBe(10);
        });

        it('uses PIA × 12 when not yet receiving SS', () => {
            // Person age 55, not receiving SS yet
            // PIA = $2,500/month, claiming at 67, RMD at 75
            // Annual SS at claiming: $30,000
            // 8 years of COLA from 67 to 75: $30,000 × 1.02^8 = $35,149.78
            const result = estimateFixedIncomeAtRMD(
                0,      // currentSSIncome (not receiving yet)
                2500,   // futureSS_PIA (monthly)
                0,      // currentPensionIncome
                55,     // currentAge
                75,     // rmdStartAge
                67,     // ssClaimingAge
                0.02,   // ssCola
                0.02    // pensionCola
            );

            expect(result.ssAtRMD).toBeCloseTo(35149.78, 0);
            expect(result.yearsProjected).toBe(20);
        });

        it('defaults to $0 SS when no SS info available', () => {
            // Person age 50, no SS info
            const result = estimateFixedIncomeAtRMD(
                0,      // currentSSIncome
                0,      // futureSS_PIA (none)
                0,      // currentPensionIncome
                50,     // currentAge
                75,     // rmdStartAge
                67,     // ssClaimingAge
                0.02,   // ssCola
                0.02    // pensionCola
            );

            expect(result.ssAtRMD).toBe(0);  // No SS info = $0
            expect(result.yearsProjected).toBe(25);
        });
    });

    describe('pension projection with COLA', () => {
        it('projects current pension income forward with COLA', () => {
            // Person age 60, receiving $40k/year pension, RMD at 75
            // 15 years of 2% COLA: $40,000 × 1.02^15
            const expectedPension = 40000 * Math.pow(1.02, 15);
            const result = estimateFixedIncomeAtRMD(
                0,      // currentSSIncome
                2500,   // futureSS_PIA
                40000,  // currentPensionIncome
                60,     // currentAge
                75,     // rmdStartAge
                67,     // ssClaimingAge
                0.02,   // ssCola
                0.02    // pensionCola
            );

            expect(result.pensionAtRMD).toBeCloseTo(expectedPension, 2);
            expect(result.yearsProjected).toBe(15);
        });

        it('handles zero pension (not receiving)', () => {
            const result = estimateFixedIncomeAtRMD(
                30000,  // currentSSIncome
                0,      // futureSS_PIA
                0,      // currentPensionIncome (none)
                65,     // currentAge
                75,     // rmdStartAge
                65,     // ssClaimingAge
                0.02,   // ssCola
                0.02    // pensionCola
            );

            expect(result.pensionAtRMD).toBe(0);
        });

        it('projects pension with different COLA rate', () => {
            // Pension with 1.5% COLA (some FERS scenarios)
            // Age 62, $50k pension, RMD at 75
            // 13 years of 1.5% COLA: $50,000 × 1.015^13
            const expectedPension = 50000 * Math.pow(1.015, 13);
            const result = estimateFixedIncomeAtRMD(
                0,      // currentSSIncome
                2000,   // futureSS_PIA
                50000,  // currentPensionIncome
                62,     // currentAge
                75,     // rmdStartAge
                67,     // ssClaimingAge
                0.02,   // ssCola
                0.015   // pensionCola (1.5%)
            );

            expect(result.pensionAtRMD).toBeCloseTo(expectedPension, 2);
        });
    });

    describe('edge cases', () => {
        it('returns current values when already at RMD age', () => {
            const result = estimateFixedIncomeAtRMD(
                36000,  // currentSSIncome
                0,      // futureSS_PIA
                45000,  // currentPensionIncome
                75,     // currentAge (at RMD)
                75,     // rmdStartAge
                67,     // ssClaimingAge
                0.02,   // ssCola
                0.02    // pensionCola
            );

            expect(result.ssAtRMD).toBe(36000);
            expect(result.pensionAtRMD).toBe(45000);
            expect(result.yearsProjected).toBe(0);
        });

        it('returns current values when past RMD age', () => {
            const result = estimateFixedIncomeAtRMD(
                38000,  // currentSSIncome
                0,      // futureSS_PIA
                48000,  // currentPensionIncome
                80,     // currentAge (past RMD)
                75,     // rmdStartAge
                67,     // ssClaimingAge
                0.02,   // ssCola
                0.02    // pensionCola
            );

            expect(result.ssAtRMD).toBe(38000);
            expect(result.pensionAtRMD).toBe(48000);
            expect(result.yearsProjected).toBe(0);
        });

        it('handles claiming age after RMD age (late claimer)', () => {
            // Person claims SS at 70, RMD at 73
            // They're currently 65, not receiving SS yet
            // At RMD (73), they'll have had 3 years of COLA (70→73)
            // PIA = $3,000/month = $36,000/year
            // $36,000 × 1.02^3
            const expectedSS = 36000 * Math.pow(1.02, 3);
            const result = estimateFixedIncomeAtRMD(
                0,      // currentSSIncome
                3000,   // futureSS_PIA
                0,      // currentPensionIncome
                65,     // currentAge
                73,     // rmdStartAge (born 1955-1959)
                70,     // ssClaimingAge (delayed)
                0.02,   // ssCola
                0.02    // pensionCola
            );

            expect(result.ssAtRMD).toBeCloseTo(expectedSS, 2);
            expect(result.yearsProjected).toBe(8);
        });

        it('handles RMD age 72 (older birth years)', () => {
            // Person born 1950, RMD at 72
            // Currently 68, receiving $32k SS
            // 4 years of COLA: $32,000 × 1.02^4
            const expectedSS = 32000 * Math.pow(1.02, 4);
            const expectedPension = 25000 * Math.pow(1.02, 4);
            const result = estimateFixedIncomeAtRMD(
                32000,  // currentSSIncome
                0,      // futureSS_PIA
                25000,  // currentPensionIncome
                68,     // currentAge
                72,     // rmdStartAge
                66,     // ssClaimingAge
                0.02,   // ssCola
                0.02    // pensionCola
            );

            expect(result.ssAtRMD).toBeCloseTo(expectedSS, 2);
            expect(result.pensionAtRMD).toBeCloseTo(expectedPension, 2);
            expect(result.yearsProjected).toBe(4);
        });

        it('handles zero COLA (no inflation adjustment)', () => {
            const result = estimateFixedIncomeAtRMD(
                30000,  // currentSSIncome
                0,      // futureSS_PIA
                40000,  // currentPensionIncome
                65,     // currentAge
                75,     // rmdStartAge
                65,     // ssClaimingAge
                0,      // ssCola (0%)
                0       // pensionCola (0%)
            );

            expect(result.ssAtRMD).toBe(30000);
            expect(result.pensionAtRMD).toBe(40000);
            expect(result.yearsProjected).toBe(10);
        });
    });

    describe('combined SS and pension', () => {
        it('projects both SS and pension correctly', () => {
            // Person age 60, SS at $28k, pension at $35k, RMD at 75
            // 15 years of 2% COLA
            const expectedSS = 28000 * Math.pow(1.02, 15);
            const expectedPension = 35000 * Math.pow(1.02, 15);
            const result = estimateFixedIncomeAtRMD(
                28000,  // currentSSIncome
                0,      // futureSS_PIA
                35000,  // currentPensionIncome
                60,     // currentAge
                75,     // rmdStartAge
                60,     // ssClaimingAge
                0.02,   // ssCola
                0.02    // pensionCola
            );

            expect(result.ssAtRMD).toBeCloseTo(expectedSS, 2);
            expect(result.pensionAtRMD).toBeCloseTo(expectedPension, 2);

            // Total fixed income at RMD
            const totalFixedIncome = result.ssAtRMD + result.pensionAtRMD;
            expect(totalFixedIncome).toBeCloseTo(expectedSS + expectedPension, 2);
        });
    });

    describe('default COLA constants', () => {
        it('has expected default SS COLA of 2%', () => {
            expect(DEFAULT_SS_COLA).toBe(0.02);
        });

        it('has expected default pension COLA of 2%', () => {
            expect(DEFAULT_PENSION_COLA).toBe(0.02);
        });

        it('uses defaults when called without explicit COLA rates', () => {
            // Test that default parameters work
            const result = estimateFixedIncomeAtRMD(
                30000,  // currentSSIncome
                0,      // futureSS_PIA
                40000,  // currentPensionIncome
                65,     // currentAge
                75      // rmdStartAge
                // ssClaimingAge, ssCola, pensionCola use defaults
            );

            // 10 years of 2% COLA
            expect(result.ssAtRMD).toBeCloseTo(30000 * Math.pow(1.02, 10), 0);
            expect(result.pensionAtRMD).toBeCloseTo(40000 * Math.pow(1.02, 10), 0);
        });
    });
});
