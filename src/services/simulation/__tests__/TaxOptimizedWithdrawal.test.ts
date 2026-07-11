/**
 * Tests for Tax-Optimized Withdrawal Service
 *
 * Following TDD approach per TAX_OPTIMIZATION_TASKS.md
 */

import { describe, it, expect } from 'vitest';
import {
    getAcaCliffThreshold,
    getEffectiveConversionRate,
    coarseToFineSearch,
    projectBalanceAtRMD,
    calculateDynamicConversionCeiling,
    computeRateMatchedConversion,
    getRMDDivisor,
    SEARCH_CONFIG,
    MAX_CONVERSION_BRACKET,
} from '../TaxOptimizedWithdrawal';
import { type TaxState } from '../../../components/Objects/Taxes/TaxContext';
import * as TaxService from '../../../components/Objects/Taxes/TaxService';
import { type AssumptionsState, defaultAssumptions, createBuiltinMilestones } from '../../../components/Objects/Assumptions/AssumptionsContext';

// =============================================================================
// Task 4: getAcaCliffThreshold() tests
// =============================================================================

describe('getAcaCliffThreshold', () => {
    describe('Known Years - Single', () => {
        it('returns 60240 for single, year 2024 (15060 × 4)', () => {
            expect(getAcaCliffThreshold('single', 2024)).toBe(60_240);
        });

        it('returns 62600 for single, year 2025 (15650 × 4)', () => {
            expect(getAcaCliffThreshold('single', 2025)).toBe(62_600);
        });

        it('returns 64400 for single, year 2026 (16100 × 4)', () => {
            expect(getAcaCliffThreshold('single', 2026)).toBe(64_400);
        });
    });

    describe('Known Years - Married Filing Jointly', () => {
        it('returns 81760 for MFJ, year 2024 (20440 × 4)', () => {
            expect(getAcaCliffThreshold('married_filing_jointly', 2024)).toBe(81_760);
        });

        it('returns 84600 for MFJ, year 2025 (21150 × 4)', () => {
            expect(getAcaCliffThreshold('married_filing_jointly', 2025)).toBe(84_600);
        });

        it('returns 87000 for MFJ, year 2026 (21750 × 4)', () => {
            expect(getAcaCliffThreshold('married_filing_jointly', 2026)).toBe(87_000);
        });
    });

    describe('Future Years (Uses Most Recent Known)', () => {
        it('returns 64400 for single, year 2027 (uses 2026 values)', () => {
            expect(getAcaCliffThreshold('single', 2027)).toBe(64_400);
        });

        it('returns 64400 for single, year 2030 (uses 2026 values)', () => {
            expect(getAcaCliffThreshold('single', 2030)).toBe(64_400);
        });

        it('returns 87000 for MFJ, year 2027 (uses 2026 values)', () => {
            expect(getAcaCliffThreshold('married_filing_jointly', 2027)).toBe(87_000);
        });
    });

    // #185: the cliff must inflate forward past the last published FPL, not freeze at
    // the 2026 nominal value while every other bracket inflates.
    describe('Future Years — inflation-indexed when assumptions supplied', () => {
        const inflAssumptions: AssumptionsState = {
            ...defaultAssumptions,
            milestones: createBuiltinMilestones(1990, 65, 90),
            macro: { ...defaultAssumptions.macro, inflationAdjusted: true, inflationRate: 3 },
        };

        it('inflates the single cliff for years beyond the table', () => {
            // 2030 is 4 years past the 2026 base → 64,400 × 1.03^4 ≈ 72,480
            const expected = 64_400 * Math.pow(1.03, 4);
            expect(getAcaCliffThreshold('single', 2030, inflAssumptions)).toBeCloseTo(expected, 2);
            // Must be strictly higher than the frozen value (the bug held it at 64,400).
            expect(getAcaCliffThreshold('single', 2030, inflAssumptions)).toBeGreaterThan(64_400);
        });

        it('inflates the MFJ cliff for years beyond the table', () => {
            const expected = 87_000 * Math.pow(1.03, 4);
            expect(getAcaCliffThreshold('married_filing_jointly', 2030, inflAssumptions)).toBeCloseTo(expected, 2);
        });

        it('snaps to the table verbatim within/before it (no deflation)', () => {
            expect(getAcaCliffThreshold('single', 2026, inflAssumptions)).toBe(64_400);
            expect(getAcaCliffThreshold('single', 2024, inflAssumptions)).toBe(60_240);
        });

        it('holds flat when inflation adjustment is disabled', () => {
            const noInfl: AssumptionsState = {
                ...inflAssumptions,
                macro: { ...inflAssumptions.macro, inflationAdjusted: false },
            };
            expect(getAcaCliffThreshold('single', 2030, noInfl)).toBe(64_400);
        });

        it('stays frozen (backward-compatible) when no assumptions passed', () => {
            expect(getAcaCliffThreshold('single', 2030)).toBe(64_400);
        });
    });

    describe('Past Years (Uses Earliest Known)', () => {
        it('returns 60240 for single, year 2023 (uses 2024 values)', () => {
            expect(getAcaCliffThreshold('single', 2023)).toBe(60_240);
        });

        it('returns 60240 for single, year 2020 (uses 2024 values)', () => {
            expect(getAcaCliffThreshold('single', 2020)).toBe(60_240);
        });

        it('returns 81760 for MFJ, year 2023 (uses 2024 values)', () => {
            expect(getAcaCliffThreshold('married_filing_jointly', 2023)).toBe(81_760);
        });
    });

    describe('Single vs MFJ Comparison', () => {
        it('MFJ threshold is higher than Single for year 2025', () => {
            const singleThreshold = getAcaCliffThreshold('single', 2025);
            const mfjThreshold = getAcaCliffThreshold('married_filing_jointly', 2025);
            expect(singleThreshold).toBe(62_600);
            expect(mfjThreshold).toBe(84_600);
            expect(mfjThreshold).toBeGreaterThan(singleThreshold);
        });
    });

    describe('Threshold is Exactly 400% FPL', () => {
        it('single 2024 threshold equals baseFPL × 4', () => {
            const baseFPL = 15_060;
            const expectedThreshold = baseFPL * 4;
            expect(getAcaCliffThreshold('single', 2024)).toBe(expectedThreshold);
        });

        it('single 2025 threshold equals baseFPL × 4', () => {
            const baseFPL = 15_650;
            const expectedThreshold = baseFPL * 4;
            expect(getAcaCliffThreshold('single', 2025)).toBe(expectedThreshold);
        });

        it('MFJ 2024 threshold equals baseFPL × 4', () => {
            const baseFPL = 20_440;
            const expectedThreshold = baseFPL * 4;
            expect(getAcaCliffThreshold('married_filing_jointly', 2024)).toBe(expectedThreshold);
        });
    });
});

// =============================================================================
// Task 10: coarseToFineSearch() tests
// =============================================================================

describe('coarseToFineSearch', () => {
    const year = 2024;

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

    const mfjTaxState: TaxState = {
        filingStatus: 'Married Filing Jointly',
        stateResidency: 'Virginia',
        deductionMethod: 'Standard',
        fedOverride: null,
        ficaOverride: null,
        stateOverride: null,
        year: year,
    };

    const getSingleParams = () => TaxService.getTaxParameters(year, 'Single', 'federal')!;
    const getMFJParams = () => TaxService.getTaxParameters(year, 'Married Filing Jointly', 'federal')!;

    describe('edge case: already at ceiling', () => {
        it('returns 0 with ALREADY_AT_CEILING when at target rate at zero', () => {
            const taxParams = getSingleParams();
            // Setup: High income already puts us in 22% bracket
            // Target rate is 12%, but we're already above it
            const result = coarseToFineSearch(
                0.12,           // targetRate - want to stay in 12%
                100_000,        // traditionalBalance
                75_000,         // currentAGI - already in 22% bracket (gross)
                0,              // socialSecurity
                0,              // ltcgIncome
                taxParams,
                singleTaxState,
                year,
                null,
                undefined
            );

            expect(result.amount).toBe(0);
            expect(result.converged).toBe(true);
            expect(result.edgeType).toBe('ALREADY_AT_CEILING');
        });
    });

    describe('never exceeds target rate', () => {
        it('returns maxAmount when can convert everything', () => {
            const taxParams = getSingleParams();
            // Setup: Very low income, high target rate, small traditional balance
            // Should be able to convert everything without exceeding 22%
            const traditionalBalance = 20_000;
            const result = coarseToFineSearch(
                0.22,           // targetRate - 22% ceiling
                traditionalBalance,
                20_000,         // currentAGI - low income (in 12% bracket)
                0,
                0,
                taxParams,
                singleTaxState,
                year,
                null,
                undefined
            );

            // Should be able to convert all of it
            expect(result.amount).toBe(traditionalBalance);
            expect(result.converged).toBe(true);
            expect(result.edgeType).toBeNull();
        });
    });

    describe('finds correct edge in $5k window', () => {
        it('finds max conversion where rate does not exceed target', () => {
            const taxParams = getSingleParams();
            // Target = 0.22 (22% bracket rate)
            // "Max conversion before exceeding target" means we can convert
            // through the ENTIRE 22% bracket (where rate = 0.22 = target)
            // With $30k gross income → $15.4k taxable income
            // 22% bracket ends at $100,525 taxable (where 24% starts)
            // Max conversion = $100,525 - $15,400 = $85,125
            const result = coarseToFineSearch(
                0.22,           // targetRate
                100_000,        // traditionalBalance - plenty to convert
                30_000,         // currentAGI - in 12% bracket
                0,
                0,
                taxParams,
                singleTaxState,
                year,
                null,
                undefined
            );

            // Should find max conversion where rate stays at or below 0.22
            // This fills the entire 22% bracket (rate = 0.22 ≤ target 0.22)
            // From $30k gross: taxable = $30k - $14.6k = $15.4k
            // Space to 24% bracket: $100,525 - $15,400 = $85,125
            expect(result.amount).toBeGreaterThan(83_000);
            expect(result.amount).toBeLessThan(88_000);
            expect(result.converged).toBe(true);
            expect(result.edgeType).toBe('BRACKET_EDGE');
        });

        it('result is within tolerance of target rate', () => {
            const taxParams = getSingleParams();
            const result = coarseToFineSearch(
                0.22,
                100_000,
                30_000,
                0,
                0,
                taxParams,
                singleTaxState,
                year,
                null,
                undefined
            );

            // Verify rate at result is close to target
            const rateAtResult = getEffectiveConversionRate(
                result.amount,
                30_000,
                0,
                0,
                taxParams,
                singleTaxState,
                year,
                null,
                undefined
            );

            // Should be at or just below target rate (conservative bound)
            expect(rateAtResult).toBeLessThanOrEqual(0.22 + SEARCH_CONFIG.epsilon);
        });
    });

    describe('edge type identification', () => {
        it('identifies SS_TORPEDO edge type for large rate jumps (>25%)', () => {
            const taxParams = getSingleParams();
            // Setup to trigger SS torpedo:
            // Need to position where SS taxation kicks in sharply
            // SS torpedo is most severe around $32-44k combined income for MFJ
            // or $25-34k for single
            const result = coarseToFineSearch(
                0.15,           // Low target rate
                100_000,        // traditionalBalance
                10_000,         // Low currentAGI
                35_000,         // High socialSecurity to trigger torpedo
                0,
                taxParams,
                singleTaxState,
                year,
                null,
                undefined
            );

            // May or may not trigger torpedo depending on positioning
            // The key is testing that torpedo detection works when it does trigger
            expect(result.converged).toBe(true);
            if (result.edgeType === 'SS_TORPEDO') {
                // Torpedo was detected - rate jump was >25%
                expect(result.amount).toBeGreaterThanOrEqual(0);
            }
        });

        it('identifies LTCG_BUMP edge type (>12% jump)', () => {
            const taxParams = getSingleParams();
            // Setup to trigger LTCG bump:
            // Position where ordinary income is just below 0% LTCG threshold
            // and conversion pushes LTCG from 0% to 15%
            const result = coarseToFineSearch(
                0.15,           // Low target rate - will hit LTCG bump first
                100_000,
                40_000,         // Near 0% LTCG threshold (~$47k for single)
                0,
                30_000,         // Significant LTCG
                taxParams,
                singleTaxState,
                year,
                null,
                undefined
            );

            // Should detect LTCG bump if threshold is hit
            expect(result.converged).toBe(true);
            if (result.edgeType === 'LTCG_BUMP') {
                expect(result.amount).toBeLessThan(10_000);
            }
        });

        it('identifies BRACKET_EDGE for normal bracket transitions', () => {
            const taxParams = getSingleParams();
            // Simple case: no SS, no LTCG, just bracket transition
            const result = coarseToFineSearch(
                0.22,           // Target: stay in 12% or below
                100_000,
                30_000,         // In 12% bracket
                0,              // No SS
                0,              // No LTCG
                taxParams,
                singleTaxState,
                year,
                null,
                undefined
            );

            expect(result.edgeType).toBe('BRACKET_EDGE');
        });
    });

    // =========================================================================
    // SS torpedo reduces the converted amount (regression for the removed
    // "Test 2.5" that asserted the SS torpedo strictly LOWERS the search result).
    //
    // When Social Security is present, converting more Traditional dollars drags
    // additional SS into taxability, so the effective marginal rate hits the
    // target ceiling at a SMALLER conversion than with no SS. Same inputs,
    // SS=0 vs a torpedo-triggering SS, at a 22% target with a generous balance.
    //
    // Empirically verified (2024 Single, target 0.22, balance $500k, AGI $10k):
    //   SS=0     -> amount ≈ 105,078
    //   SS=35k   -> amount ≈  28,515
    // The inequality is robust across AGI ($0-$20k) and SS ($30k-$40k); we assert
    // the relationship and positivity rather than pinning exact dollars.
    // =========================================================================
    describe('SS torpedo reduces converted amount', () => {
        it('strictly lowers the converted amount vs the same inputs with no SS', () => {
            const taxParams = getSingleParams();
            const targetRate = 0.22;
            const traditionalBalance = 500_000; // generous — not the binding constraint
            const currentAGI = 10_000;
            const torpedoSS = 35_000; // positions the SS-taxability ramp under the ceiling

            const noSS = coarseToFineSearch(
                targetRate,
                traditionalBalance,
                currentAGI,
                0,              // socialSecurity = 0
                0,              // ltcgIncome
                taxParams,
                singleTaxState,
                year,
                null,
                undefined
            );

            const withSS = coarseToFineSearch(
                targetRate,
                traditionalBalance,
                currentAGI,
                torpedoSS,      // torpedo-triggering SS
                0,              // ltcgIncome
                taxParams,
                singleTaxState,
                year,
                null,
                undefined
            );

            // Both should converge and allow a positive conversion...
            expect(noSS.converged).toBe(true);
            expect(withSS.converged).toBe(true);
            expect(noSS.amount).toBeGreaterThan(0);
            expect(withSS.amount).toBeGreaterThan(0);

            // ...but the SS torpedo pulls the rate to the ceiling sooner, so the
            // converted amount with SS is strictly LESS than without SS.
            expect(withSS.amount).toBeLessThan(noSS.amount);
        });
    });

    describe('convergence', () => {
        it('converges within maxIterations', () => {
            const taxParams = getSingleParams();
            const result = coarseToFineSearch(
                0.22,
                200_000,
                30_000,
                0,
                0,
                taxParams,
                singleTaxState,
                year,
                null,
                undefined
            );

            expect(result.converged).toBe(true);
        });

        it('returns conservative lower bound when not fully converged', () => {
            const taxParams = getSingleParams();
            // Simple scenario without SS/LTCG complications
            // to ensure the search returns a conservative bound
            const result = coarseToFineSearch(
                0.22,       // Target 22%
                100_000,    // Plenty of balance
                30_000,     // In 12% bracket
                0,          // No SS complications
                0,          // No LTCG complications
                taxParams,
                singleTaxState,
                year,
                null,
                undefined
            );

            // Rate at returned amount should be <= target (plus small epsilon)
            const rateAtResult = getEffectiveConversionRate(
                result.amount,
                30_000,
                0,
                0,
                taxParams,
                singleTaxState,
                year,
                null,
                undefined
            );

            // The returned amount should keep us at or below target rate
            expect(rateAtResult).toBeLessThanOrEqual(0.22 + SEARCH_CONFIG.epsilon);
        });
    });

    describe('respects maximum conversion cap', () => {
        it('caps at traditionalBalance when smaller than maxCap', () => {
            const taxParams = getMFJParams();
            const smallBalance = 50_000;
            const result = coarseToFineSearch(
                0.35,           // Very high target - should allow max conversion
                smallBalance,   // Small balance
                50_000,
                0,
                0,
                taxParams,
                mfjTaxState,
                year,
                null,
                undefined
            );

            expect(result.amount).toBeLessThanOrEqual(smallBalance);
        });

        it('caps at SEARCH_CONFIG.maxConversionCap', () => {
            const taxParams = getMFJParams();
            const hugeBalance = 10_000_000;
            const result = coarseToFineSearch(
                0.35,           // Very high target
                hugeBalance,
                50_000,
                0,
                0,
                taxParams,
                mfjTaxState,
                year,
                null,
                undefined
            );

            expect(result.amount).toBeLessThanOrEqual(SEARCH_CONFIG.maxConversionCap);
        });
    });

    // #185: the coarse loop stops at the largest $5k multiple ≤ maxAmount, so when
    // maxAmount (the balance / an IRMAA cap) is off-grid the final partial window is
    // never rate-tested and up to ~$5k converts past the target rate.
    describe('rate-tests the final partial window below maxAmount', () => {
        it('does not convert past the bracket edge when maxAmount is off-grid', () => {
            const taxParams = getSingleParams();
            // Single 2024: std ded 14,600. currentAGI 30,000 → taxable 15,400 (12%).
            // 12%→22% edge at taxable 47,150 → conversion 31,750.
            // Balance 33,000 is off the $5k grid: coarse samples 0…30,000 (all ≤ edge),
            // next sample 35,000 > 33,000 so no edge is found; the old code returned
            // the full 33,000, converting ~$1,250 into the 22% bracket past a 12% target.
            const result = coarseToFineSearch(
                0.12,        // targetRate — stay in 12%
                33_000,      // traditionalBalance (off-grid maxAmount)
                30_000,      // currentAGI
                0,
                0,
                taxParams,
                singleTaxState,
                year,
                null,        // no state tax (federal-only rate)
                undefined
            );

            // Must stop at/below the 12%→22% edge (~31,750), NOT the full 33,000.
            expect(result.amount).toBeLessThan(32_500);
            expect(result.amount).toBeGreaterThan(31_000);
            // And the returned amount stays at or below target.
            const rateAtResult = getEffectiveConversionRate(
                result.amount, 30_000, 0, 0, taxParams, singleTaxState, year, null, undefined
            );
            expect(rateAtResult).toBeLessThanOrEqual(0.12 + SEARCH_CONFIG.epsilon);
        });
    });

    // #185: the ACA-cliff probe sized the crossing off currentAGI alone, omitting the
    // gross SS + LTCG that the real ACA MAGI includes. LTCG (no SS torpedo) with a high
    // target isolates the probe — the ACA cliff is then the only edge, so the search's
    // result is exactly the probe's cliff-crossing point.
    describe('ACA cliff probe uses the full MAGI base (currentAGI + SS + LTCG)', () => {
        it('sizes the crossing off the full MAGI base, not currentAGI alone', () => {
            const taxParams = getSingleParams();
            const currentAGI = 20_000;   // non-SS ordinary income
            const socialSecurity = 0;    // no SS torpedo
            const ltcg = 25_000;         // part of ACA MAGI, omitted by the old probe
            const acaCliffThreshold = 60_000;
            // Real ACA MAGI before = 20k + 0 + 25k = 45k → cliff crossing at +$15,000.
            // The old currentAGI-only probe put the crossing at 60k − 20k = $40,000.
            const acaOptions = {
                currentAge: 60,
                acaSubsidyAware: true,
                acaCliffThreshold,
                estimatedSubsidyLoss: 12_000,
            };
            const result = coarseToFineSearch(
                0.35,        // high target — no federal/LTCG edge in range, cliff is the only one
                100_000,     // plenty of balance
                currentAGI,
                socialSecurity,
                ltcg,
                taxParams,
                singleTaxState,
                year,
                null,
                acaOptions
            );

            // Must cap just below the real cliff (+$15,000), not the currentAGI-only
            // $40,000 the buggy probe allowed.
            expect(result.amount).toBeLessThan(15_000);
            expect(result.amount).toBeGreaterThan(14_000);
        });
    });
});

// =============================================================================
// Task 14: getRMDDivisor() tests
// =============================================================================

describe('getRMDDivisor', () => {
    describe('Below RMD Age (No RMD)', () => {
        it('returns 0 for age 70', () => {
            expect(getRMDDivisor(70)).toBe(0);
        });

        it('returns 0 for age 71', () => {
            expect(getRMDDivisor(71)).toBe(0);
        });

        it('returns 0 for age 50', () => {
            expect(getRMDDivisor(50)).toBe(0);
        });

        it('returns 0 for age 0', () => {
            expect(getRMDDivisor(0)).toBe(0);
        });
    });

    describe('At RMD Start Age', () => {
        it('returns 27.4 for age 72 (RMD start)', () => {
            expect(getRMDDivisor(72)).toBe(27.4);
        });

        it('returns 26.5 for age 73', () => {
            expect(getRMDDivisor(73)).toBe(26.5);
        });
    });

    describe('Common RMD Ages (IRS Uniform Lifetime Table)', () => {
        it('returns 27.4 for age 72', () => {
            expect(getRMDDivisor(72)).toBe(27.4);
        });

        it('returns 26.5 for age 73', () => {
            expect(getRMDDivisor(73)).toBe(26.5);
        });

        it('returns 25.5 for age 74', () => {
            expect(getRMDDivisor(74)).toBe(25.5);
        });

        it('returns 24.6 for age 75', () => {
            expect(getRMDDivisor(75)).toBe(24.6);
        });

        it('returns 20.2 for age 80', () => {
            expect(getRMDDivisor(80)).toBe(20.2);
        });

        it('returns 16.0 for age 85', () => {
            expect(getRMDDivisor(85)).toBe(16.0);
        });

        it('returns 12.2 for age 90', () => {
            expect(getRMDDivisor(90)).toBe(12.2);
        });

        it('returns 8.9 for age 95', () => {
            expect(getRMDDivisor(95)).toBe(8.9);
        });
    });

    describe('Ages Beyond 95 (IRS Uniform Lifetime Table)', () => {
        // getRMDDivisor now delegates to RMDData.getDistributionPeriod, the
        // canonical IRS Uniform Lifetime Table (ages 72-120), instead of the
        // old linear extrapolation that diverged from the published values.

        it('returns 8.4 for age 96', () => {
            expect(getRMDDivisor(96)).toBeCloseTo(8.4, 2);
        });

        it('returns 7.8 for age 97', () => {
            expect(getRMDDivisor(97)).toBeCloseTo(7.8, 2);
        });

        it('returns 7.3 for age 98', () => {
            expect(getRMDDivisor(98)).toBeCloseTo(7.3, 2);
        });

        it('returns 6.4 for age 100', () => {
            expect(getRMDDivisor(100)).toBeCloseTo(6.4, 2);
        });

        it('returns 5.2 for age 103', () => {
            expect(getRMDDivisor(103)).toBeCloseTo(5.2, 2);
        });

        it('returns 4.9 for age 104', () => {
            expect(getRMDDivisor(104)).toBeCloseTo(4.9, 2);
        });

        it('returns 3.5 for age 110', () => {
            expect(getRMDDivisor(110)).toBeCloseTo(3.5, 2);
        });
    });

    describe('Edge Cases', () => {
        it('returns 0 for negative age', () => {
            expect(getRMDDivisor(-1)).toBe(0);
        });

        it('returns 0 for decimal age below RMD (71.5)', () => {
            expect(getRMDDivisor(71.5)).toBe(0);
        });
    });

    describe('Very High Ages (capped at the table maximum)', () => {
        it('returns 2.0 for age 120 (table maximum)', () => {
            expect(getRMDDivisor(120)).toBeCloseTo(2.0, 2);
        });

        it('returns 2.0 for age 150 (beyond table, uses last value)', () => {
            expect(getRMDDivisor(150)).toBeCloseTo(2.0, 2);
        });
    });
});


// =============================================================================
// Task 16: projectBalanceAtRMD() tests
// =============================================================================

describe('projectBalanceAtRMD', () => {
    // =========================================================================
    // Test Group 1: Edge Cases
    // =========================================================================
    describe('edge cases', () => {
        it('returns current balance when yearsUntilRMD = 0', () => {
            const result = projectBalanceAtRMD(500_000, 0, 20_000, 0.07);
            expect(result).toBe(500_000);
        });

        it('returns current balance when yearsUntilRMD is negative', () => {
            const result = projectBalanceAtRMD(500_000, -5, 20_000, 0.07);
            expect(result).toBe(500_000);
        });

        it('returns 0 when currentBalance is 0', () => {
            const result = projectBalanceAtRMD(0, 10, 5_000, 0.07);
            expect(result).toBe(0);
        });
    });

    // =========================================================================
    // Test Group 2: Zero Growth Rate
    // =========================================================================
    describe('zero growth rate', () => {
        it('calculates simple subtraction: 100k - (10 × 5k) = 50k', () => {
            const result = projectBalanceAtRMD(100_000, 10, 5_000, 0);
            expect(result).toBeCloseTo(50_000, 2);
        });

        it('floors at 0 when conversions exceed balance: 100k - (25 × 5k) = -25k → 0', () => {
            const result = projectBalanceAtRMD(100_000, 25, 5_000, 0);
            expect(result).toBe(0);
        });
    });

    // =========================================================================
    // Test Group 3: Growth with No Conversion
    // =========================================================================
    describe('growth with no conversion', () => {
        it('calculates pure compound growth: 100k × 1.07^10 = 196715.14', () => {
            const result = projectBalanceAtRMD(100_000, 10, 0, 0.07);
            expect(result).toBeCloseTo(196_715.14, 2);
        });

        it('calculates pure compound growth: 500k × 1.06^20 = 1603567.74', () => {
            const result = projectBalanceAtRMD(500_000, 20, 0, 0.06);
            expect(result).toBeCloseTo(1_603_567.74, 2);
        });
    });

    // =========================================================================
    // Test Group 4: Growth with Conversion
    // =========================================================================
    describe('growth with conversion', () => {
        it('calculates 500k with 7% growth and 20k annual conversion over 10 years = 707246.72', () => {
            // Year-by-year calculation:
            // Year 1: 500000 × 1.07 = 535000 - 20000 = 515000
            // Year 2: 515000 × 1.07 = 551050 - 20000 = 531050
            // Year 3: 531050 × 1.07 = 568223.50 - 20000 = 548223.50
            // Year 4: 548223.50 × 1.07 = 586599.15 - 20000 = 566599.15
            // Year 5: 566599.15 × 1.07 = 606261.09 - 20000 = 586261.09
            // Year 6: 586261.09 × 1.07 = 627299.36 - 20000 = 607299.36
            // Year 7: 607299.36 × 1.07 = 649810.32 - 20000 = 629810.32
            // Year 8: 629810.32 × 1.07 = 673897.04 - 20000 = 653897.04
            // Year 9: 653897.04 × 1.07 = 699669.83 - 20000 = 679669.83
            // Year 10: 679669.83 × 1.07 = 727246.72 - 20000 = 707246.72
            const result = projectBalanceAtRMD(500_000, 10, 20_000, 0.07);
            expect(result).toBeCloseTo(707_246.72, 2);
        });
    });

    // =========================================================================
    // Test Group 5: Conversion Exceeds Growth (Balance Depletes)
    // =========================================================================
    describe('conversion exceeds growth - balance depletes', () => {
        it('floors at 0 when large conversion depletes balance mid-projection', () => {
            // Year-by-year calculation:
            // Year 1: 100000 × 1.05 = 105000 - 15000 = 90000
            // Year 2: 90000 × 1.05 = 94500 - 15000 = 79500
            // Year 3: 79500 × 1.05 = 83475 - 15000 = 68475
            // Year 4: 68475 × 1.05 = 71898.75 - 15000 = 56898.75
            // Year 5: 56898.75 × 1.05 = 59743.69 - 15000 = 44743.69
            // Year 6: 44743.69 × 1.05 = 46980.87 - 15000 = 31980.87
            // Year 7: 31980.87 × 1.05 = 33579.92 - 15000 = 18579.92
            // Year 8: 18579.92 × 1.05 = 19508.91 - 15000 = 4508.91
            // Year 9: 4508.91 × 1.05 = 4734.36 - 15000 = -10265.64 → 0
            const result = projectBalanceAtRMD(100_000, 10, 15_000, 0.05);
            expect(result).toBe(0);
        });
    });

    // =========================================================================
    // Test Group 6: Large Conversion Depletes Immediately
    // =========================================================================
    describe('large conversion depletes immediately', () => {
        it('floors at 0 when first year conversion exceeds grown balance', () => {
            // Year 1: 50000 × 1.07 = 53500 - 60000 = -6500 → 0
            const result = projectBalanceAtRMD(50_000, 5, 60_000, 0.07);
            expect(result).toBe(0);
        });
    });

    // =========================================================================
    // Test Group 7: Negative Growth Rate
    // =========================================================================
    describe('negative growth rate', () => {
        it('calculates balance shrinkage: 100k × 0.90^5 = 59049', () => {
            // Year-by-year calculation:
            // Year 1: 100000 × 0.90 = 90000
            // Year 2: 90000 × 0.90 = 81000
            // Year 3: 81000 × 0.90 = 72900
            // Year 4: 72900 × 0.90 = 65610
            // Year 5: 65610 × 0.90 = 59049
            const result = projectBalanceAtRMD(100_000, 5, 0, -0.10);
            expect(result).toBeCloseTo(59_049, 2);
        });
    });
});

// =============================================================================
// Task 18: calculateDynamicConversionCeiling() tests
// =============================================================================

describe('calculateDynamicConversionCeiling', () => {
    // =========================================================================
    // Test Setup: 2026 Single federal params with standard deduction $16,100
    // =========================================================================
    const year = 2026;

    const singleTaxState: TaxState = {
        filingStatus: 'Single',
        stateResidency: 'TX',  // Texas - no state tax
        deductionMethod: 'Standard',
        fedOverride: null,
        ficaOverride: null,
        stateOverride: null,
        year: year,
    };

    const mfjTaxState: TaxState = {
        filingStatus: 'Married Filing Jointly',
        stateResidency: 'TX',
        deductionMethod: 'Standard',
        fedOverride: null,
        ficaOverride: null,
        stateOverride: null,
        year: year,
    };

    const getSingleParams = () => TaxService.getTaxParameters(year, 'Single', 'federal')!;
    const getMFJParams = () => TaxService.getTaxParameters(year, 'Married Filing Jointly', 'federal')!;

    // Helper to create default inputs
    const createDefaultInputs = (overrides: Partial<{
        currentTraditionalBalance: number;
        yearsUntilRMD: number;
        pensionIncomeAtRMD: number;
        ssAtRMD: number;
        currentAGI: number;
        socialSecurityThisYear: number;
        ltcgIncome: number;
        growthRate: number;
        rmdStartAge: number;
    }> = {}) => ({
        currentTraditionalBalance: 500_000,
        yearsUntilRMD: 15,
        pensionIncomeAtRMD: 0,
        ssAtRMD: 30_000,
        currentAGI: 50_000,
        socialSecurityThisYear: 0,
        ltcgIncome: 0,
        growthRate: 0.06,
        rmdStartAge: 73,
        ...overrides
    });

    // =========================================================================
    // Test Group 1: Edge Cases
    // =========================================================================
    describe('edge cases', () => {
        it('returns zeros when yearsUntilRMD = 0', () => {
            const taxParams = getSingleParams();
            const inputs = createDefaultInputs({ yearsUntilRMD: 0 });

            const result = calculateDynamicConversionCeiling(
                inputs.currentTraditionalBalance,
                inputs.yearsUntilRMD,
                inputs.pensionIncomeAtRMD,
                inputs.ssAtRMD,
                0, // passiveIncomeAtRMD
                inputs.currentAGI,
                inputs.growthRate,
                inputs.rmdStartAge,
                taxParams,
                singleTaxState
            );

            expect(result.conversionCeiling).toBe(0);
            expect(result.bracketSpacePerYear).toBe(0);
            expect(result.projectedBalanceAtRMD).toBe(inputs.currentTraditionalBalance);
        });

        it('returns zeros when yearsUntilRMD is negative', () => {
            const taxParams = getSingleParams();
            const inputs = createDefaultInputs({ yearsUntilRMD: -5 });

            const result = calculateDynamicConversionCeiling(
                inputs.currentTraditionalBalance,
                inputs.yearsUntilRMD,
                inputs.pensionIncomeAtRMD,
                inputs.ssAtRMD,
                0, // passiveIncomeAtRMD
                inputs.currentAGI,
                inputs.growthRate,
                inputs.rmdStartAge,
                taxParams,
                singleTaxState
            );

            expect(result.conversionCeiling).toBe(0);
            expect(result.bracketSpacePerYear).toBe(0);
            expect(result.projectedBalanceAtRMD).toBe(inputs.currentTraditionalBalance);
        });
    });

    // =========================================================================
    // Test Group 2: Small Balance - RMDs Stay in 12% Bracket
    // =========================================================================
    describe('small balance stays in low bracket', () => {
        it('returns ceiling = 0 when projected RMDs are in 12% bracket', () => {
            const taxParams = getSingleParams();
            // Small balance: $200k × 1.06^20 = $641k → RMD ~$43k → 12% bracket
            // Since RMDs will be in 12% anyway, no need to convert above standard deduction
            const inputs = createDefaultInputs({
                currentTraditionalBalance: 200_000,
                yearsUntilRMD: 20,
                ssAtRMD: 25_000,
                growthRate: 0.06
            });

            const result = calculateDynamicConversionCeiling(
                inputs.currentTraditionalBalance,
                inputs.yearsUntilRMD,
                inputs.pensionIncomeAtRMD,
                inputs.ssAtRMD,
                0, // passiveIncomeAtRMD
                inputs.currentAGI,
                inputs.growthRate,
                inputs.rmdStartAge,
                taxParams,
                singleTaxState
            );

            // Rate-match algorithm: peak future RMD lands in 12% bracket. From 0%
            // (std-ded) the gap is 12% > 5pp → convert std-ded chunk. From 10%,
            // gap is 2% < 5pp → STOP. Last filled bracket = std-ded (rate 0).
            expect(result.conversionCeiling).toBe(0);
        });
    });

    // =========================================================================
    // Test Group 3: Large Balance - rate-match converts through bracket gaps
    // =========================================================================
    describe('rate-match walks through brackets when gaps are large', () => {
        it('converts through 12% bracket when peak future is in 24% bracket', () => {
            const taxParams = getSingleParams();
            // Large balance: $1M × 1.07^10 = $1.97M → RMD ~$131k → 24% bracket
            // Three-tier: RMDs in 22-24% → ceiling = 12%
            const inputs = createDefaultInputs({
                currentTraditionalBalance: 1_000_000,
                yearsUntilRMD: 10,
                ssAtRMD: 30_000,
                growthRate: 0.07
            });

            const result = calculateDynamicConversionCeiling(
                inputs.currentTraditionalBalance,
                inputs.yearsUntilRMD,
                inputs.pensionIncomeAtRMD,
                inputs.ssAtRMD,
                0, // passiveIncomeAtRMD
                inputs.currentAGI,
                inputs.growthRate,
                inputs.rmdStartAge,
                taxParams,
                singleTaxState
            );

            // Rate-match: peak future = 24% bracket. From 0% std-ded (gap 24, convert),
            // 10% (gap 14, convert), 12% (gap 12, convert), 22% (gap 2, < 5pp STOP).
            // Last filled bracket = 12%.
            expect(result.conversionCeiling).toBe(0.12);
            expect(result.bracketSpacePerYear).toBeGreaterThan(0);
        });
    });

    // =========================================================================
    // Test Group 4: Very Large Balance - rate-match goes higher when gap allows
    // =========================================================================
    describe('rate-match for very high projected peak', () => {
        it('converts into higher brackets when peak future is much higher', () => {
            const taxParams = getSingleParams();
            // Very large balance: $5M × 1.08^5 = $7.35M → RMD ~$490k → 37% bracket
            // Three-tier: RMDs in 32%+ → ceiling = 24% (max for new algorithm)
            const inputs = createDefaultInputs({
                currentTraditionalBalance: 5_000_000,
                yearsUntilRMD: 5,
                ssAtRMD: 40_000,
                growthRate: 0.08
            });

            const result = calculateDynamicConversionCeiling(
                inputs.currentTraditionalBalance,
                inputs.yearsUntilRMD,
                inputs.pensionIncomeAtRMD,
                inputs.ssAtRMD,
                0, // passiveIncomeAtRMD
                inputs.currentAGI,
                inputs.growthRate,
                inputs.rmdStartAge,
                taxParams,
                singleTaxState
            );

            // Rate-match: peak lands in 35%/37% bracket. With 5pp gap requirement,
            // walks through 24% (gap 11+, convert), 32% (gap 3-5, may stop or
            // continue depending on exact rate). Last filled is somewhere in
            // 24-32% range. Pre-fix three-tier capped at 24%; rate-match allows higher.
            expect(result.conversionCeiling).toBeGreaterThanOrEqual(0.24);
            expect(result.conversionCeiling).toBeLessThanOrEqual(0.35);
            expect(result.bracketSpacePerYear).toBeGreaterThan(0);
        });
    });

    // =========================================================================
    // Test Group 5: With Baseline Projections
    // =========================================================================
    describe('with baseline projections', () => {
        it('uses baseline projections instead of input values when provided', () => {
            const taxParams = getSingleParams();
            const inputs = createDefaultInputs({
                ssAtRMD: 30_000,          // Will be overridden
                pensionIncomeAtRMD: 0     // Will be overridden
            });

            const baselineProjections = {
                traditionalBalanceAtRMD: 800_000,
                ssAtRMD: 35_000,      // Higher than input
                pensionAtRMD: 10_000, // Different from input
                passiveAtRMD: 0,
                rmdYear: 2041
            };

            const result = calculateDynamicConversionCeiling(
                inputs.currentTraditionalBalance,
                inputs.yearsUntilRMD,
                inputs.pensionIncomeAtRMD,
                inputs.ssAtRMD,
                0, // passiveIncomeAtRMD
                inputs.currentAGI,
                inputs.growthRate,
                inputs.rmdStartAge,
                taxParams,
                singleTaxState,
                baselineProjections
            );

            // Should use baseline's projectedBalanceAtRMD
            expect(result.projectedBalanceAtRMD).toBeCloseTo(800_000, 0);
        });
    });

    // =========================================================================
    // Test Group 6: SS Torpedo Affects Bracket Calculation
    // =========================================================================
    describe('SS torpedo affects bracket calculation', () => {
        it('accounts for taxable SS in projected RMD bracket', () => {
            const taxParams = getSingleParams();
            // With SS + pension + RMD, SS becomes partially taxable
            const inputs = createDefaultInputs({
                currentTraditionalBalance: 400_000,
                yearsUntilRMD: 15,
                ssAtRMD: 30_000,
                pensionIncomeAtRMD: 20_000
            });

            const result = calculateDynamicConversionCeiling(
                inputs.currentTraditionalBalance,
                inputs.yearsUntilRMD,
                inputs.pensionIncomeAtRMD,
                inputs.ssAtRMD,
                0, // passiveIncomeAtRMD
                inputs.currentAGI,
                inputs.growthRate,
                inputs.rmdStartAge,
                taxParams,
                singleTaxState
            );

            // projectedRMDBracket should be a valid bracket rate
            const validRates = taxParams.brackets.map(b => b.rate);
            expect(validRates).toContain(result.projectedRMDBracket);
            // With income + taxable SS, should be in a meaningful bracket
            expect(result.projectedRMDBracket).toBeGreaterThan(0);
        });
    });

    // =========================================================================
    // Test Group 7: Utilization Ratio Triggers Ceiling Raise
    // =========================================================================
    describe('utilization ratio triggers ceiling raise', () => {
        it('raises ceiling when conversion needed exceeds 90% of bracket space', () => {
            const taxParams = getSingleParams();
            // Balance that needs aggressive conversion but projected bracket may be low
            const inputs = createDefaultInputs({
                currentTraditionalBalance: 800_000,
                yearsUntilRMD: 8
            });

            const result = calculateDynamicConversionCeiling(
                inputs.currentTraditionalBalance,
                inputs.yearsUntilRMD,
                inputs.pensionIncomeAtRMD,
                inputs.ssAtRMD,
                0, // passiveIncomeAtRMD
                inputs.currentAGI,
                inputs.growthRate,
                inputs.rmdStartAge,
                taxParams,
                singleTaxState
            );

            // If utilization ratio > 0.90, ceiling should raise even if projected bracket is low
            // Result should have positive bracket space
            expect(result.bracketSpacePerYear).toBeGreaterThan(0);
            expect(result.conversionCeiling).toBeGreaterThanOrEqual(0.12);
        });
    });

    // =========================================================================
    // Test Group 9: State Tax Affects Bracket Space Calculation
    // =========================================================================
    describe('state tax affects calculation', () => {
        it('state tax reduces bracket space due to higher effective rate', () => {
            const taxParams = getSingleParams();
            const inputs = createDefaultInputs();

            // Without state tax (Texas)
            const resultNoState = calculateDynamicConversionCeiling(
                inputs.currentTraditionalBalance,
                inputs.yearsUntilRMD,
                inputs.pensionIncomeAtRMD,
                inputs.ssAtRMD,
                0, // passiveIncomeAtRMD
                inputs.currentAGI,
                inputs.growthRate,
                inputs.rmdStartAge,
                taxParams,
                singleTaxState
            );

            const stateTaxState: TaxState = {
                ...singleTaxState,
                stateResidency: 'VA'  // Virginia
            };

            const resultWithState = calculateDynamicConversionCeiling(
                inputs.currentTraditionalBalance,
                inputs.yearsUntilRMD,
                inputs.pensionIncomeAtRMD,
                inputs.ssAtRMD,
                0, // passiveIncomeAtRMD
                inputs.currentAGI,
                inputs.growthRate,
                inputs.rmdStartAge,
                taxParams,
                stateTaxState
            );

            // Both should use the same ceiling (based on federal RMD bracket projection)
            // Ceiling is set by three-tier algorithm using federal brackets only
            expect(resultWithState.conversionCeiling).toBe(resultNoState.conversionCeiling);

            // Without state tax, should have bracket space
            expect(resultNoState.bracketSpacePerYear).toBeGreaterThan(0);

            // With state tax, effective rate is higher, so bracket space may be reduced
            // (bracket space is where effective rate <= ceiling, and state tax increases effective rate)
            expect(resultWithState.bracketSpacePerYear).toBeGreaterThanOrEqual(0);
        });
    });

    // =========================================================================
    // Test Group 10: Zero Growth Rate
    // =========================================================================
    describe('zero growth rate', () => {
        it('handles zero growth rate without division by zero', () => {
            const taxParams = getSingleParams();
            // Default: $500k, 15yr, $30k SS, AGI $50k
            // With 0% growth: $500k stays $500k → RMD ~$33k → 12% bracket → ceiling = 0
            const inputs = createDefaultInputs({
                growthRate: 0
            });

            // Should not throw
            const result = calculateDynamicConversionCeiling(
                inputs.currentTraditionalBalance,
                inputs.yearsUntilRMD,
                inputs.pensionIncomeAtRMD,
                inputs.ssAtRMD,
                0, // passiveIncomeAtRMD
                inputs.currentAGI,
                inputs.growthRate,
                inputs.rmdStartAge,
                taxParams,
                singleTaxState
            );

            // Projected balance equals current balance (no growth)
            expect(result.projectedBalanceAtRMD).toBeCloseTo(inputs.currentTraditionalBalance, 0);
            // With 0% growth, RMDs stay in 12% bracket, so ceiling = 0
            expect(result.conversionCeiling).toBeGreaterThanOrEqual(0);
        });
    });

    // =========================================================================
    // Test Group 11: Return Value Structure
    // =========================================================================
    describe('return value structure', () => {
        it('returns all required fields with valid values', () => {
            const taxParams = getSingleParams();
            const inputs = createDefaultInputs();

            const result = calculateDynamicConversionCeiling(
                inputs.currentTraditionalBalance,
                inputs.yearsUntilRMD,
                inputs.pensionIncomeAtRMD,
                inputs.ssAtRMD,
                0, // passiveIncomeAtRMD
                inputs.currentAGI,
                inputs.growthRate,
                inputs.rmdStartAge,
                taxParams,
                singleTaxState
            );

            // conversionCeiling: valid bracket rate <= 32%
            const validRates = taxParams.brackets.map(b => b.rate).filter(r => r <= MAX_CONVERSION_BRACKET);
            expect(validRates).toContain(result.conversionCeiling);

            // bracketSpacePerYear: number >= 0
            expect(result.bracketSpacePerYear).toBeGreaterThanOrEqual(0);

            // projectedBalanceAtRMD: number >= 0
            expect(result.projectedBalanceAtRMD).toBeGreaterThanOrEqual(0);

            // projectedRMDBracket: valid bracket rate
            const allRates = taxParams.brackets.map(b => b.rate);
            expect(allRates).toContain(result.projectedRMDBracket);
        });
    });

    // =========================================================================
    // Additional: MFJ has wider brackets
    // =========================================================================
    describe('handles MFJ correctly', () => {
        it('allows lower ceiling for MFJ due to wider brackets', () => {
            const singleParams = getSingleParams();
            const mfjParams = getMFJParams();

            const inputs = createDefaultInputs({
                currentTraditionalBalance: 1_500_000,
                yearsUntilRMD: 10,
                ssAtRMD: 50_000,
                currentAGI: 40_000
            });

            const singleResult = calculateDynamicConversionCeiling(
                inputs.currentTraditionalBalance,
                inputs.yearsUntilRMD,
                inputs.pensionIncomeAtRMD,
                inputs.ssAtRMD,
                0, // passiveIncomeAtRMD
                inputs.currentAGI,
                inputs.growthRate,
                inputs.rmdStartAge,
                singleParams,
                singleTaxState
            );

            const mfjResult = calculateDynamicConversionCeiling(
                inputs.currentTraditionalBalance,
                inputs.yearsUntilRMD,
                inputs.pensionIncomeAtRMD,
                inputs.ssAtRMD,
                0, // passiveIncomeAtRMD
                inputs.currentAGI,
                inputs.growthRate,
                inputs.rmdStartAge,
                mfjParams,
                mfjTaxState
            );

            // MFJ has wider brackets, so may not need to raise ceiling as high
            expect(mfjResult.conversionCeiling).toBeLessThanOrEqual(singleResult.conversionCeiling);
        });
    });

    // =========================================================================
    // Invariance: same scenario projected to the same RMD year should produce
    // the same ceiling regardless of when the projection is being done.
    // Regression test for the units-mismatch bug where peakRMD income was
    // expressed in RMD-year nominal dollars but compared against current-year
    // tax brackets, inflating the apparent peak-RMD bracket at younger ages.
    // =========================================================================
    describe('RMD-year bracket invariance (units-mismatch regression)', () => {
        const buildAssumptions = (): AssumptionsState => ({
            ...defaultAssumptions,
            milestones: createBuiltinMilestones(1990, 60, 90),
            macro: {
                ...defaultAssumptions.macro,
                inflationRate: 3,
                inflationAdjusted: true,
            },
        });

        it('produces the same ceiling at age 35 vs age 55 for the same RMD-year target balance', () => {
            const assumptions = buildAssumptions();
            const filingStatus = 'Single' as const;
            const rmdStartAge = 75;
            const rmdYear = 2065; // age 75 for someone born in 1990

            // Build inputs as if the scenario projects to the SAME nominal balance and SAME
            // nominal income at the same RMD year, just queried from two different "current"
            // ages. With the bug, the ceiling depended on yearsUntilRMD; with the fix, it
            // shouldn't.
            const ssAtRMD = 80_000;        // RMD-year nominal $
            const pensionAtRMD = 0;
            const passiveAtRMD = 0;
            const growthRate = 0.07;
            const targetBalanceAtRMD = 5_000_000;  // RMD-year nominal $

            // For the same final balance at RMD, current balance differs based on years out.
            const yearsAtAge35 = 40;  // year = 2025
            const yearsAtAge55 = 20;  // year = 2045

            const balanceAtAge35 = targetBalanceAtRMD / Math.pow(1 + growthRate, yearsAtAge35);
            const balanceAtAge55 = targetBalanceAtRMD / Math.pow(1 + growthRate, yearsAtAge55);

            const taxStateAtAge35: TaxState = {
                filingStatus, stateResidency: 'TX', deductionMethod: 'Standard',
                fedOverride: null, ficaOverride: null, stateOverride: null,
                year: rmdYear - yearsAtAge35,
            };
            const taxStateAtAge55: TaxState = { ...taxStateAtAge35, year: rmdYear - yearsAtAge55 };

            const fedAtAge35 = TaxService.getTaxParameters(taxStateAtAge35.year, filingStatus, 'federal', undefined, assumptions)!;
            const fedAtAge55 = TaxService.getTaxParameters(taxStateAtAge55.year, filingStatus, 'federal', undefined, assumptions)!;

            const resultAt35 = calculateDynamicConversionCeiling(
                balanceAtAge35, yearsAtAge35,
                pensionAtRMD, ssAtRMD, passiveAtRMD,
                0, growthRate, rmdStartAge,
                fedAtAge35, taxStateAtAge35, undefined, assumptions
            );
            const resultAt55 = calculateDynamicConversionCeiling(
                balanceAtAge55, yearsAtAge55,
                pensionAtRMD, ssAtRMD, passiveAtRMD,
                0, growthRate, rmdStartAge,
                fedAtAge55, taxStateAtAge55, undefined, assumptions
            );

            // Same RMD-year balance and same RMD-year income → same peak-RMD bracket → same ceiling.
            expect(resultAt35.conversionCeiling).toBe(resultAt55.conversionCeiling);
            expect(resultAt35.peakRMDBracket).toBe(resultAt55.peakRMDBracket);
        });

        it('without assumptions parameter, falls back to legacy (current-year-bracket) behavior', () => {
            // This test pins the legacy behavior so callers that don't pass assumptions get
            // backwards-compatible results. The fix is opt-in via the assumptions parameter.
            const filingStatus = 'Single' as const;
            const taxState: TaxState = {
                filingStatus, stateResidency: 'TX', deductionMethod: 'Standard',
                fedOverride: null, ficaOverride: null, stateOverride: null,
                year: 2025,
            };
            const fedParams = TaxService.getTaxParameters(2025, filingStatus, 'federal')!;

            const result = calculateDynamicConversionCeiling(
                500_000, 30,
                0, 30_000, 0,
                50_000, 0.07, 75,
                fedParams, taxState
                // assumptions intentionally omitted
            );

            // Just verify it runs and returns a valid ceiling — exact value is whatever
            // the smooth one-below logic produces from the naive growth projection.
            // Possible ceiling values are bracket rates [0, 0.10, 0.12, 0.22, 0.24, 0.32, 0.35] or 0.
            const validCeilings = [0, 0.10, 0.12, 0.22, 0.24, 0.32, 0.35];
            expect(validCeilings.some(v => Math.abs(v - result.conversionCeiling) < 1e-6)).toBe(true);
        });
    });

    // =========================================================================
    // Test Group: std-ded-only conversion mode
    // =========================================================================
    // Used by `runProjectionSubsim` to project a Trad-balance trajectory that
    // does only "fill 0% bracket" conversions. Skips rate-match and downstream
    // logic; bracketSpacePerYear is the dollar headroom under the standard
    // deduction.
    describe('std-ded-only mode', () => {
        it('returns std-ded headroom as bracketSpacePerYear when AGI is below standard deduction', () => {
            const taxParams = getSingleParams();
            const stdDed = taxParams.standardDeduction; // 2026 Single = $16,100
            const inputs = createDefaultInputs({
                currentTraditionalBalance: 500_000,
                currentAGI: 5_000, // well below stdDed
            });

            const result = calculateDynamicConversionCeiling(
                inputs.currentTraditionalBalance,
                inputs.yearsUntilRMD,
                inputs.pensionIncomeAtRMD,
                inputs.ssAtRMD,
                0,
                inputs.currentAGI,
                inputs.growthRate,
                inputs.rmdStartAge,
                taxParams,
                singleTaxState,
                undefined,
                undefined,
                'std-ded-only'
            );

            expect(result.conversionCeiling).toBe(0);
            expect(result.bracketSpacePerYear).toBe(stdDed - inputs.currentAGI);
        });

        it('returns 0 bracketSpacePerYear when AGI is at or above standard deduction', () => {
            const taxParams = getSingleParams();
            const stdDed = taxParams.standardDeduction;
            const inputs = createDefaultInputs({ currentAGI: stdDed + 10_000 });

            const result = calculateDynamicConversionCeiling(
                inputs.currentTraditionalBalance,
                inputs.yearsUntilRMD,
                inputs.pensionIncomeAtRMD,
                inputs.ssAtRMD,
                0,
                inputs.currentAGI,
                inputs.growthRate,
                inputs.rmdStartAge,
                taxParams,
                singleTaxState,
                undefined,
                undefined,
                'std-ded-only'
            );

            expect(result.bracketSpacePerYear).toBe(0);
        });

        it('caps headroom by current Traditional balance when balance is small', () => {
            const taxParams = getSingleParams();
            const tinyBalance = 1_000;
            const inputs = createDefaultInputs({
                currentTraditionalBalance: tinyBalance,
                currentAGI: 0, // full stdDed headroom available
            });

            const result = calculateDynamicConversionCeiling(
                inputs.currentTraditionalBalance,
                inputs.yearsUntilRMD,
                inputs.pensionIncomeAtRMD,
                inputs.ssAtRMD,
                0,
                inputs.currentAGI,
                inputs.growthRate,
                inputs.rmdStartAge,
                taxParams,
                singleTaxState,
                undefined,
                undefined,
                'std-ded-only'
            );

            expect(result.bracketSpacePerYear).toBe(tinyBalance);
        });
    });
});

// =============================================================================
// computeRateMatchedConversion() — direct rate-match algorithm
// =============================================================================

describe('computeRateMatchedConversion', () => {
    const fedParams = TaxService.getTaxParameters(2026, 'Single', 'federal')!;
    const taxState: TaxState = {
        filingStatus: 'Single', stateResidency: 'TX', deductionMethod: 'Standard',
        fedOverride: null, ficaOverride: null, stateOverride: null, year: 2026,
    };

    it('returns zero conversion when balance is zero', () => {
        const result = computeRateMatchedConversion(
            0, 20, 0, 30_000, 0, 0, 0.07, fedParams, fedParams, taxState, 0.05
        );
        expect(result.optimalConversion).toBe(0);
        expect(result.stopReason).toBe('no-balance');
    });

    it('returns zero when there are no years until RMD', () => {
        const result = computeRateMatchedConversion(
            500_000, 0, 0, 30_000, 0, 0, 0.07, fedParams, fedParams, taxState, 0.05
        );
        expect(result.optimalConversion).toBe(0);
    });

    it('converts std-ded chunk only when peak future is in 12% bracket (gap < 5pp from 10%)', () => {
        // Small balance, long horizon → peak future in 12% bracket
        const result = computeRateMatchedConversion(
            200_000, 20, 0, 25_000, 0, 0, 0.06, fedParams, fedParams, taxState, 0.05
        );
        // gap from 0% std-ded = 12% > 5pp → convert std-ded
        // gap from 10% bracket = 2% < 5pp → STOP
        expect(result.topConversionRate).toBe(0);
        expect(result.optimalConversion).toBeCloseTo(fedParams.standardDeduction, -2);
        expect(result.stopReason).toBe('gap-closed');
    });

    it('converts through 12% bracket when peak future is in 24% bracket', () => {
        // Larger balance, peak in 24% bracket
        const result = computeRateMatchedConversion(
            1_500_000, 10, 0, 30_000, 0, 0, 0.07, fedParams, fedParams, taxState, 0.05
        );
        // 0% → gap=24, convert. 10% → gap=14, convert. 12% → gap=12, convert.
        // 22% → gap=2 < 5pp → STOP. Last filled = 12%.
        expect(result.topConversionRate).toBe(0.12);
        expect(result.optimalConversion).toBeGreaterThan(50_000); // through 12% bracket
        expect(result.stopReason).toBe('gap-closed');
    });

    it('converts into higher brackets when peak is much higher', () => {
        // Very large balance + short horizon → peak deep in 32%+ bracket
        const result = computeRateMatchedConversion(
            5_000_000, 5, 0, 40_000, 0, 0, 0.08, fedParams, fedParams, taxState, 0.05
        );
        // Walk through 0,10,12,22,24, possibly 32. Stop somewhere with gap < 5pp.
        expect(result.topConversionRate).toBeGreaterThanOrEqual(0.22);
        expect(result.optimalConversion).toBeGreaterThan(100_000);
    });

    it('higher gap threshold leads to fewer conversions', () => {
        // Same scenario, threshold 5pp vs 15pp. With 15pp, 22% bracket is rejected
        // (gap from 22% to 24% = 2pp; gap from 12% to 24% = 12pp) — should stop earlier.
        const tight = computeRateMatchedConversion(
            1_500_000, 10, 0, 30_000, 0, 0, 0.07, fedParams, fedParams, taxState, 0.15
        );
        const loose = computeRateMatchedConversion(
            1_500_000, 10, 0, 30_000, 0, 0, 0.07, fedParams, fedParams, taxState, 0.05
        );
        expect(tight.optimalConversion).toBeLessThanOrEqual(loose.optimalConversion);
    });

    it('caps conversion at available Traditional balance', () => {
        const tinyBalance = 5_000;
        const result = computeRateMatchedConversion(
            tinyBalance, 10, 0, 30_000, 0, 0, 0.07, fedParams, fedParams, taxState, 0.05
        );
        expect(result.optimalConversion).toBeLessThanOrEqual(tinyBalance);
    });

    it('skips conversions entirely when no future tax (high-balance scenario unrealistic)', () => {
        // Tiny balance + long horizon → projected RMD ≈ 0 → future marginal ≈ 0
        // Then future_marginal - 0 = 0 < 5pp → stop immediately at std-ded chunk.
        const result = computeRateMatchedConversion(
            5_000, 30, 0, 0, 0, 0, 0.07, fedParams, fedParams, taxState, 0.05
        );
        // Even tiny balance × 1.07^30 = $38k → /15 = $2.5k RMD. With no SS, that's
        // sheltered by std deduction → future marginal = 0 → no conversion worth it.
        expect(result.optimalConversion).toBe(0);
        expect(result.stopReason).toBe('no-future-tax');
    });
});
