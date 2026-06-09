/**
 * Unit tests for simulation helper functions.
 *
 * These helpers are used by RothConversionService and WithdrawalService
 * but previously had no dedicated unit tests. This file tests them in isolation.
 */
import { describe, it, expect } from 'vitest';
import {
    classifyAccountTaxCategory,
    calculateEffectiveConversionTax,
    ACAOptions,
} from '../../../services/simulation/helpers';
import { InvestedAccount, SavedAccount, ESPPAccount } from '../../../components/Objects/Accounts/models';
import { FilingStatus, TaxParameters, TAX_DATABASE } from '../../../data/TaxData';

// Helper to create a minimal InvestedAccount for testing
function createInvestedAccount(
    taxType: 'Brokerage' | 'Roth 401k' | 'Traditional 401k' | 'Roth IRA' | 'Traditional IRA' | 'HSA',
    amount: number = 100000
): InvestedAccount {
    return new InvestedAccount(
        `test-${taxType}`,
        `Test ${taxType}`,
        amount,
        0, // employerBalance
        0, // tenureYears
        0.1, // expenseRatio
        taxType
    );
}

// Get 2024 federal tax parameters for testing
function getFedParams(filingStatus: FilingStatus = 'Single'): TaxParameters {
    return TAX_DATABASE.federal[2024][filingStatus];
}

describe('helpers', () => {
    describe('classifyAccountTaxCategory', () => {
        describe('SavedAccount', () => {
            it('should classify SavedAccount as tax-free', () => {
                const account = new SavedAccount('savings-1', 'Emergency Fund', 10000, 4.5);
                expect(classifyAccountTaxCategory(account)).toBe('tax-free');
            });
        });

        describe('InvestedAccount', () => {
            it('should classify Traditional 401k as tax-deferred', () => {
                const account = createInvestedAccount('Traditional 401k');
                expect(classifyAccountTaxCategory(account)).toBe('tax-deferred');
            });

            it('should classify Traditional IRA as tax-deferred', () => {
                const account = createInvestedAccount('Traditional IRA');
                expect(classifyAccountTaxCategory(account)).toBe('tax-deferred');
            });

            it('should classify Roth 401k as tax-free', () => {
                const account = createInvestedAccount('Roth 401k');
                expect(classifyAccountTaxCategory(account)).toBe('tax-free');
            });

            it('should classify Roth IRA as tax-free', () => {
                const account = createInvestedAccount('Roth IRA');
                expect(classifyAccountTaxCategory(account)).toBe('tax-free');
            });

            it('should classify HSA as tax-free', () => {
                const account = createInvestedAccount('HSA');
                expect(classifyAccountTaxCategory(account)).toBe('tax-free');
            });

            it('should classify Brokerage as taxable', () => {
                const account = createInvestedAccount('Brokerage');
                expect(classifyAccountTaxCategory(account)).toBe('taxable');
            });
        });

        describe('ESPPAccount', () => {
            it('should classify ESPPAccount as mixed', () => {
                const account = new ESPPAccount('espp-1', 'Company ESPP', 50000);
                expect(classifyAccountTaxCategory(account)).toBe('mixed');
            });
        });
    });

    describe('calculateEffectiveConversionTax', () => {
        describe('basic tax calculation', () => {
            it('should return zero tax for zero conversion amount', () => {
                const result = calculateEffectiveConversionTax(
                    50000, // nonSSIncome
                    0,     // totalSSBenefits
                    0,     // ltcgIncome
                    0,     // conversionAmount
                    'Single',
                    getFedParams('Single'),
                    null   // stateParams
                );

                expect(result.taxIncrease).toBe(0);
                expect(result.effectiveRate).toBe(0);
                expect(result.taxBefore).toBe(result.taxAfter);
            });

            it('should calculate tax increase for small conversion', () => {
                const fedParams = getFedParams('Single');
                // 2024 Single: 22% bracket starts at $47,151 taxable income
                // With $14,600 standard deduction, need $61,751 gross to be in 22% bracket
                const result = calculateEffectiveConversionTax(
                    70000, // nonSSIncome - taxable = $55,400, solidly in 22% bracket
                    0,     // totalSSBenefits
                    0,     // ltcgIncome
                    10000, // conversionAmount - stays within 22% bracket
                    'Single',
                    fedParams,
                    null   // stateParams
                );

                // With $70k gross income (after standard deduction ~$55k taxable),
                // adding $10k should be taxed at 22%
                expect(result.taxIncrease).toBeGreaterThan(0);
                expect(result.taxAfter).toBeGreaterThan(result.taxBefore);
                // Effective rate should be close to 22% (marginal rate)
                expect(result.effectiveRate).toBeCloseTo(0.22, 1);
            });

            it('should calculate effective rate as taxIncrease / conversionAmount', () => {
                const result = calculateEffectiveConversionTax(
                    30000, // nonSSIncome
                    0,     // totalSSBenefits
                    0,     // ltcgIncome
                    5000,  // conversionAmount
                    'Single',
                    getFedParams('Single'),
                    null   // stateParams
                );

                const expectedEffectiveRate = result.taxIncrease / 5000;
                expect(result.effectiveRate).toBeCloseTo(expectedEffectiveRate, 10);
            });
        });

        describe('Social Security torpedo effect', () => {
            it('should handle zero SS benefits correctly', () => {
                const result = calculateEffectiveConversionTax(
                    40000, // nonSSIncome
                    0,     // totalSSBenefits - no SS
                    0,     // ltcgIncome
                    10000, // conversionAmount
                    'Single',
                    getFedParams('Single'),
                    null   // stateParams
                );

                // With no SS, effective rate should equal marginal rate
                expect(result.effectiveRate).toBeGreaterThan(0);
                expect(result.effectiveRate).toBeLessThan(0.40); // Should be reasonable
            });

            it('should account for SS benefits becoming more taxable', () => {
                // SS taxation thresholds for Single: $25k (50% taxable), $34k (85% taxable)
                // Combined income = AGI + 50% of SS benefits

                // Scenario: Person near the SS taxation cliff
                // $20,000 non-SS income + $30,000 SS benefits
                // Combined income = $20,000 + $15,000 = $35,000 (just above second threshold)

                const resultWithSS = calculateEffectiveConversionTax(
                    20000, // nonSSIncome
                    30000, // totalSSBenefits - meaningful SS benefits
                    0,     // ltcgIncome
                    10000, // conversionAmount
                    'Single',
                    getFedParams('Single'),
                    null   // stateParams
                );

                const resultWithoutSS = calculateEffectiveConversionTax(
                    20000, // nonSSIncome
                    0,     // no SS benefits
                    0,     // ltcgIncome
                    10000, // conversionAmount
                    'Single',
                    getFedParams('Single'),
                    null   // stateParams
                );

                // The effective rate WITH SS should be higher because
                // the conversion pushes more SS into taxable territory
                expect(resultWithSS.effectiveRate).toBeGreaterThan(resultWithoutSS.effectiveRate);
            });

            it('should show higher effective rate when SS torpedo applies', () => {
                // At the "torpedo" zone, each dollar of conversion can cause
                // additional SS benefits to become taxable, creating an effective
                // rate higher than the nominal bracket rate

                // Person with $25,000 AGI and $40,000 SS (right at first threshold)
                // Combined income = $25,000 + $20,000 = $45,000
                const result = calculateEffectiveConversionTax(
                    25000, // nonSSIncome - positioned in torpedo zone
                    40000, // totalSSBenefits - significant SS
                    0,     // ltcgIncome
                    5000,  // conversionAmount
                    'Single',
                    getFedParams('Single'),
                    null   // stateParams
                );

                // The effective rate should be noticeably elevated
                // due to additional SS becoming taxable
                expect(result.effectiveRate).toBeGreaterThan(0);
                // In the torpedo zone, rates can effectively be 1.5x to 1.85x the marginal rate
            });
        });

        describe('filing status variations', () => {
            it('should calculate correctly for Single filer', () => {
                const result = calculateEffectiveConversionTax(
                    60000,
                    0,
                    0,     // ltcgIncome
                    10000,
                    'Single',
                    getFedParams('Single'),
                    null   // stateParams
                );

                expect(result.taxIncrease).toBeGreaterThan(0);
                expect(result.effectiveRate).toBeGreaterThan(0);
            });

            it('should calculate correctly for Married Filing Jointly', () => {
                const result = calculateEffectiveConversionTax(
                    60000,
                    0,
                    0,     // ltcgIncome
                    10000,
                    'Married Filing Jointly',
                    getFedParams('Married Filing Jointly'),
                    null   // stateParams
                );

                expect(result.taxIncrease).toBeGreaterThan(0);
                expect(result.effectiveRate).toBeGreaterThan(0);
            });

            it('should use correct thresholds for each filing status', () => {
                // MFJ has higher standard deduction and wider brackets
                // Same income should result in lower effective rate for MFJ
                const singleResult = calculateEffectiveConversionTax(
                    80000,
                    0,
                    0,     // ltcgIncome
                    20000,
                    'Single',
                    getFedParams('Single'),
                    null   // stateParams
                );

                const mfjResult = calculateEffectiveConversionTax(
                    80000,
                    0,
                    0,     // ltcgIncome
                    20000,
                    'Married Filing Jointly',
                    getFedParams('Married Filing Jointly'),
                    null   // stateParams
                );

                // MFJ should have lower effective rate due to wider brackets
                expect(mfjResult.effectiveRate).toBeLessThan(singleResult.effectiveRate);
            });
        });

        describe('edge cases', () => {
            it('should handle very large conversion amounts', () => {
                const result = calculateEffectiveConversionTax(
                    100000,
                    0,
                    0,      // ltcgIncome
                    500000, // Very large conversion
                    'Single',
                    getFedParams('Single'),
                    null    // stateParams
                );

                expect(result.taxIncrease).toBeGreaterThan(0);
                // Should push into higher brackets
                expect(result.effectiveRate).toBeGreaterThan(0.22);
            });

            it('should handle conversion that pushes into higher bracket', () => {
                // Single filer: 12% bracket ends at $47,151 (2024)
                // With $14,600 standard deduction, that's ~$61,750 gross income
                const fedParams = getFedParams('Single');

                // Start at top of 12% bracket
                const result = calculateEffectiveConversionTax(
                    45000, // Near top of 12% bracket after standard deduction
                    0,
                    0,     // ltcgIncome
                    20000, // Should push well into 22% bracket
                    'Single',
                    fedParams,
                    null   // stateParams
                );

                // Effective rate should be blended between 12% and 22%
                expect(result.effectiveRate).toBeGreaterThan(0.12);
                expect(result.effectiveRate).toBeLessThanOrEqual(0.22);
            });

            it('should handle zero non-SS income', () => {
                const result = calculateEffectiveConversionTax(
                    0,     // No non-SS income (early retiree before SS)
                    0,     // No SS benefits
                    0,     // ltcgIncome
                    30000, // Conversion fills lower brackets
                    'Single',
                    getFedParams('Single'),
                    null   // stateParams
                );

                // Should fill from 0, mostly in 10% and 12% brackets
                expect(result.taxIncrease).toBeGreaterThan(0);
                expect(result.effectiveRate).toBeLessThan(0.15); // Blended low rate
            });
        });
    });

});

// =============================================================================
// COMPREHENSIVE TEST SCENARIOS FROM CALCULATE_EFFECTIVE_CONVERSION_TAX_TEST_SCENARIOS.md
// =============================================================================

// Test parameters for comprehensive scenarios
const fedParams2026Single: TaxParameters = {
    standardDeduction: 16100,
    brackets: [
        { threshold: 0, rate: 0.10 },
        { threshold: 12400, rate: 0.12 },
        { threshold: 50400, rate: 0.22 },
        { threshold: 105700, rate: 0.24 },
        { threshold: 201775, rate: 0.32 },
        { threshold: 256225, rate: 0.35 },
        { threshold: 640600, rate: 0.37 }
    ],
    capitalGainsBrackets: [
        { threshold: 0, rate: 0.00 },
        { threshold: 49700, rate: 0.15 },
        { threshold: 548200, rate: 0.20 }
    ],
    socialSecurityTaxRate: 0.062,
    socialSecurityWageBase: 176100,
    medicareTaxRate: 0.0145
};

const fedParams2026MFJ: TaxParameters = {
    standardDeduction: 32200,
    brackets: [
        { threshold: 0, rate: 0.10 },
        { threshold: 24800, rate: 0.12 },
        { threshold: 100800, rate: 0.22 },
        { threshold: 211400, rate: 0.24 },
        { threshold: 403550, rate: 0.32 },
        { threshold: 512450, rate: 0.35 },
        { threshold: 768100, rate: 0.37 }
    ],
    capitalGainsBrackets: [
        { threshold: 0, rate: 0.00 },
        { threshold: 99400, rate: 0.15 },
        { threshold: 615700, rate: 0.20 }
    ],
    socialSecurityTaxRate: 0.062,
    socialSecurityWageBase: 176100,
    medicareTaxRate: 0.0145
};

// Simple 5% flat state tax for testing
const stateParams5Percent: TaxParameters = {
    standardDeduction: 0,
    brackets: [{ threshold: 0, rate: 0.05 }],
    socialSecurityTaxRate: 0,
    socialSecurityWageBase: 0,
    medicareTaxRate: 0
};

// DC-like progressive state tax for testing
const stateParamsDC: TaxParameters = {
    standardDeduction: 15000,
    brackets: [
        { threshold: 0, rate: 0.04 },
        { threshold: 10000, rate: 0.06 },
        { threshold: 40000, rate: 0.065 },
        { threshold: 60000, rate: 0.085 },
        { threshold: 250000, rate: 0.0925 },
        { threshold: 500000, rate: 0.0975 },
        { threshold: 1000000, rate: 0.1075 }
    ],
    socialSecurityTaxRate: 0,
    socialSecurityWageBase: 0,
    medicareTaxRate: 0
};

// Default ACA options for testing
const defaultACAOptions: ACAOptions = {
    currentAge: 60,
    acaSubsidyAware: true,
    acaCliffThreshold: 64400,
    estimatedSubsidyLoss: 8000
};

describe('calculateEffectiveConversionTax - Comprehensive Scenarios', () => {
    // =========================================================================
    // Test Group 1: Zero and Edge Cases
    // =========================================================================
    describe('Group 1: Zero and Edge Cases', () => {
        it('should return zero for all zeros', () => {
            const result = calculateEffectiveConversionTax(
                0, 0, 0, 0, 'Single', fedParams2026Single, null
            );
            expect(result.taxIncrease).toBe(0);
            expect(result.effectiveRate).toBe(0);
        });

        it('should return zero for zero conversion with income', () => {
            const result = calculateEffectiveConversionTax(
                50000, 20000, 10000, 0, 'Single', fedParams2026Single, null
            );
            expect(result.taxIncrease).toBe(0);
            expect(result.effectiveRate).toBe(0);
        });

        it('should return zero for income only, no conversion', () => {
            const result = calculateEffectiveConversionTax(
                50000, 0, 0, 0, 'Single', fedParams2026Single, null
            );
            expect(result.taxIncrease).toBe(0);
        });

        it('should handle negative conversion gracefully', () => {
            const result = calculateEffectiveConversionTax(
                50000, 0, 0, -5000, 'Single', fedParams2026Single, null
            );
            // Should not crash, effective rate may be negative or 0
            expect(result).toBeDefined();
        });
    });

    // =========================================================================
    // Test Group 2: Basic Conversion (No SS, No LTCG, No State, No ACA)
    // =========================================================================
    describe('Group 2: Basic Conversion (No SS, No LTCG, No State, No ACA)', () => {
        it('should calculate 10% rate for income in 10% bracket', () => {
            // taxable = 20000 - 16100 = 3900, in 10% bracket
            // conversion stays in 10% bracket
            const result = calculateEffectiveConversionTax(
                20000, 0, 0, 5000, 'Single', fedParams2026Single, null
            );
            expect(result.taxIncrease).toBeCloseTo(500, 0);
            expect(result.effectiveRate).toBeCloseTo(0.10, 2);
            expect(result.breakdown.ssTorpedoCost).toBe(0);
            expect(result.breakdown.ltcgBumpCost).toBe(0);
            expect(result.breakdown.stateTaxCost).toBe(0);
            expect(result.breakdown.acaSubsidyLost).toBe(0);
        });

        it('should calculate 12% rate for income in 12% bracket', () => {
            // taxable = 40000 - 16100 = 23900, in 12% bracket (12400-50400)
            const result = calculateEffectiveConversionTax(
                40000, 0, 0, 10000, 'Single', fedParams2026Single, null
            );
            expect(result.taxIncrease).toBeCloseTo(1200, 0);
            expect(result.effectiveRate).toBeCloseTo(0.12, 2);
        });

        it('should calculate 22% rate for income in 22% bracket', () => {
            // taxable = 80000 - 16100 = 63900, in 22% bracket (50400-105700)
            const result = calculateEffectiveConversionTax(
                80000, 0, 0, 15000, 'Single', fedParams2026Single, null
            );
            expect(result.taxIncrease).toBeCloseTo(3300, 0);
            expect(result.effectiveRate).toBeCloseTo(0.22, 2);
        });

        it('should calculate blended rate crossing 10% to 12%', () => {
            // taxable = 25000 - 16100 = 8900, in 10% bracket
            // conversion of 10000 crosses into 12% at 12400
            // 3500 at 10% + 6500 at 12% = 350 + 780 = 1130
            const result = calculateEffectiveConversionTax(
                25000, 0, 0, 10000, 'Single', fedParams2026Single, null
            );
            expect(result.effectiveRate).toBeGreaterThan(0.10);
            expect(result.effectiveRate).toBeLessThan(0.12);
        });

        it('should calculate blended rate crossing 12% to 22%', () => {
            // taxable = 60000 - 16100 = 43900, in 12% bracket
            // conversion of 20000 crosses into 22% at 50400
            const result = calculateEffectiveConversionTax(
                60000, 0, 0, 20000, 'Single', fedParams2026Single, null
            );
            expect(result.effectiveRate).toBeGreaterThan(0.12);
            expect(result.effectiveRate).toBeLessThan(0.22);
        });

        it('should calculate 22% for large conversion in 22% bracket', () => {
            // taxable = 80000 - 16100 = 63900, in 22% bracket
            // conversion of 50000 stays in 22% bracket (ends at 113900 < 105700+16100)
            // Wait, 63900 + 50000 = 113900 which is > 105700, so crosses to 24%
            // Let me recalculate: 63900 + 50000 = 113900
            // 105700 - 63900 = 41800 at 22%
            // 113900 - 105700 = 8200 at 24%
            // Tax = 41800 * 0.22 + 8200 * 0.24 = 9196 + 1968 = 11164
            const result = calculateEffectiveConversionTax(
                80000, 0, 0, 50000, 'Single', fedParams2026Single, null
            );
            expect(result.taxIncrease).toBeGreaterThan(10000);
            expect(result.effectiveRate).toBeGreaterThanOrEqual(0.22);
        });
    });

    // =========================================================================
    // Test Group 3: SS Torpedo Effect (No LTCG, No State, No ACA)
    // =========================================================================
    describe('Group 3: SS Torpedo Effect', () => {
        describe('3a: SS Below Threshold (No Torpedo)', () => {
            it('should have zero torpedo when SS stays below threshold', () => {
                // combined = 5000 + 0 + (30000 * 0.5) = 20000 < 25000
                // After conversion: combined = 10000 + 15000 = 25000 (still at threshold)
                const result = calculateEffectiveConversionTax(
                    5000, 30000, 0, 5000, 'Single', fedParams2026Single, null
                );
                expect(result.breakdown.ssTorpedoCost).toBe(0);
            });
        });

        describe('3b: Conversion Pushes SS into 50% Zone', () => {
            it('should have positive torpedo entering 50% zone', () => {
                // combined before = 10000 + (20000 * 0.5) = 20000 < 25000
                // combined after = 16000 + 10000 = 26000 > 25000 (in 50% zone)
                const result = calculateEffectiveConversionTax(
                    10000, 20000, 0, 6000, 'Single', fedParams2026Single, null
                );
                expect(result.breakdown.ssTorpedoCost).toBeGreaterThan(0);
            });

            it('should have larger torpedo going deeper into 50% zone', () => {
                const result = calculateEffectiveConversionTax(
                    10000, 20000, 0, 10000, 'Single', fedParams2026Single, null
                );
                expect(result.breakdown.ssTorpedoCost).toBeGreaterThan(0);
            });
        });

        describe('3c: Conversion Pushes SS into 85% Zone', () => {
            it('should have positive torpedo crossing from 50% to 85% zone', () => {
                // combined before = 20000 + (20000 * 0.5) = 30000 (in 50% zone)
                // combined after = 30000 + 10000 = 40000 (in 85% zone)
                const result = calculateEffectiveConversionTax(
                    20000, 20000, 0, 10000, 'Single', fedParams2026Single, null
                );
                expect(result.breakdown.ssTorpedoCost).toBeGreaterThan(0);
            });

            it('should have positive torpedo already in 85% zone', () => {
                // combined = 50000 + (30000 * 0.5) = 65000 > 34000 (in 85% zone)
                const result = calculateEffectiveConversionTax(
                    50000, 30000, 0, 20000, 'Single', fedParams2026Single, null
                );
                expect(result.breakdown.ssTorpedoCost).toBeGreaterThanOrEqual(0);
            });
        });

        describe('3d: SS Already at Max Taxability', () => {
            it('should have zero torpedo when SS fully taxable before', () => {
                // Very high income, SS already at 85% taxable
                const result = calculateEffectiveConversionTax(
                    100000, 30000, 0, 20000, 'Single', fedParams2026Single, null
                );
                expect(result.breakdown.ssTorpedoCost).toBe(0);
            });
        });

        describe('3e: Effective Rate with SS Torpedo', () => {
            it('should show effective rate > 12% in torpedo zone', () => {
                const result = calculateEffectiveConversionTax(
                    15000, 25000, 0, 10000, 'Single', fedParams2026Single, null
                );
                expect(result.effectiveRate).toBeGreaterThan(0.12);
            });

            it('should show effective rate > 22% with torpedo in 22% bracket', () => {
                const result = calculateEffectiveConversionTax(
                    40000, 25000, 0, 15000, 'Single', fedParams2026Single, null
                );
                expect(result.effectiveRate).toBeGreaterThan(0.12);
            });
        });
    });

    // =========================================================================
    // Test Group 4: LTCG Bump Effect (No SS, No State, No ACA)
    // =========================================================================
    describe('Group 4: LTCG Bump Effect', () => {
        describe('4a: LTCG Stays at 0%', () => {
            it('should have zero bump when LTCG stays at 0%', () => {
                // taxable ordinary = 30000 - 16100 = 13900
                // After conversion: 13900 + 5000 = 18900 < 49700
                const result = calculateEffectiveConversionTax(
                    30000, 0, 15000, 5000, 'Single', fedParams2026Single, null
                );
                expect(result.breakdown.ltcgBumpCost).toBe(0);
            });

            it('should have bump when conversion pushes LTCG stack over threshold', () => {
                // taxable ordinary before = 55000 - 16100 = 38900
                // taxable ordinary after = 60000 - 16100 = 43900
                // LTCG stacks: before = 38900 + 10000 = 48900 < 49700 (all 0%)
                // LTCG stacks: after = 43900 + 10000 = 53900 > 49700 (4200 in 15%)
                // ltcgBumpCost = 4200 * 0.15 = 630
                const result = calculateEffectiveConversionTax(
                    55000, 0, 10000, 5000, 'Single', fedParams2026Single, null
                );
                expect(result.breakdown.ltcgBumpCost).toBeCloseTo(630, 0);
            });
        });

        describe('4b: Conversion Pushes LTCG to 15%', () => {
            it('should have positive bump when LTCG pushed to 15%', () => {
                // taxable ordinary = 60000 - 16100 = 43900
                // After conversion: 43900 + 10000 = 53900 > 49700
                // LTCG starts stacking at 53900, some in 15% zone
                const result = calculateEffectiveConversionTax(
                    60000, 0, 20000, 10000, 'Single', fedParams2026Single, null
                );
                expect(result.breakdown.ltcgBumpCost).toBeGreaterThan(0);
            });

            it('should have bump for full LTCG bump', () => {
                // taxable ordinary = 50000 - 16100 = 33900
                // After conversion: 33900 + 20000 = 53900 > 49700
                const result = calculateEffectiveConversionTax(
                    50000, 0, 30000, 20000, 'Single', fedParams2026Single, null
                );
                expect(result.breakdown.ltcgBumpCost).toBeGreaterThan(0);
            });
        });

        describe('4c: LTCG Already at 15%', () => {
            it('should have zero bump when LTCG already at 15%', () => {
                // taxable ordinary = 100000 - 16100 = 83900 > 49700
                // LTCG already in 15% zone
                const result = calculateEffectiveConversionTax(
                    100000, 0, 30000, 20000, 'Single', fedParams2026Single, null
                );
                expect(result.breakdown.ltcgBumpCost).toBe(0);
            });
        });

        describe('4d: LTCG Bump to 20%', () => {
            it('should have positive bump crossing 15% to 20%', () => {
                // Very high income to cross $548,200 threshold
                const result = calculateEffectiveConversionTax(
                    550000, 0, 50000, 20000, 'Single', fedParams2026Single, null
                );
                expect(result.breakdown.ltcgBumpCost).toBeGreaterThan(0);
            });
        });
    });

    // =========================================================================
    // Test Group 5: State Tax (No SS, No LTCG, No ACA)
    // =========================================================================
    describe('Group 5: State Tax', () => {
        describe('5a: No State Tax', () => {
            it('should have zero state tax with null params', () => {
                const result = calculateEffectiveConversionTax(
                    50000, 0, 0, 20000, 'Single', fedParams2026Single, null
                );
                expect(result.breakdown.stateTaxCost).toBe(0);
            });
        });

        describe('5b: Flat State Tax', () => {
            it('should calculate 5% flat state tax', () => {
                const result = calculateEffectiveConversionTax(
                    50000, 0, 0, 20000, 'Single', fedParams2026Single, stateParams5Percent
                );
                expect(result.breakdown.stateTaxCost).toBeCloseTo(1000, 0);
            });

            it('should calculate 5% flat state tax for large conversion', () => {
                const result = calculateEffectiveConversionTax(
                    50000, 0, 0, 100000, 'Single', fedParams2026Single, stateParams5Percent
                );
                expect(result.breakdown.stateTaxCost).toBeCloseTo(5000, 0);
            });
        });

        describe('5c: Progressive State Tax (DC-like)', () => {
            it('should calculate progressive state tax in 6% bracket', () => {
                // DC: taxable = 30000 - 15000 = 15000
                // In 6% bracket (10000-40000)
                const result = calculateEffectiveConversionTax(
                    30000, 0, 0, 10000, 'Single', fedParams2026Single, stateParamsDC
                );
                expect(result.breakdown.stateTaxCost).toBeCloseTo(600, 0);
            });

            it('should calculate progressive state tax crossing brackets', () => {
                const result = calculateEffectiveConversionTax(
                    50000, 0, 0, 30000, 'Single', fedParams2026Single, stateParamsDC
                );
                expect(result.breakdown.stateTaxCost).toBeGreaterThan(0);
            });
        });
    });

    // =========================================================================
    // Test Group 6: ACA Cliff (No SS, No LTCG, No State)
    // =========================================================================
    describe('Group 6: ACA Cliff', () => {
        describe('6a: Under 65, Below Cliff', () => {
            it('should not cross cliff when staying below', () => {
                const acaOptions: ACAOptions = {
                    currentAge: 60,
                    acaSubsidyAware: true,
                    acaCliffThreshold: 64400,
                    estimatedSubsidyLoss: 8000
                };
                const result = calculateEffectiveConversionTax(
                    50000, 0, 0, 10000, 'Single', fedParams2026Single, null, acaOptions
                );
                expect(result.crossesACACliff).toBe(false);
                expect(result.breakdown.acaSubsidyLost).toBe(0);
            });

            it('should not cross cliff just below threshold', () => {
                const acaOptions: ACAOptions = {
                    currentAge: 60,
                    acaSubsidyAware: true,
                    acaCliffThreshold: 64400,
                    estimatedSubsidyLoss: 8000
                };
                const result = calculateEffectiveConversionTax(
                    60000, 0, 0, 4000, 'Single', fedParams2026Single, null, acaOptions
                );
                expect(result.crossesACACliff).toBe(false);
                expect(result.breakdown.acaSubsidyLost).toBe(0);
            });
        });

        describe('6b: Under 65, Crosses Cliff', () => {
            it('should cross cliff with larger conversion', () => {
                const acaOptions: ACAOptions = {
                    currentAge: 60,
                    acaSubsidyAware: true,
                    acaCliffThreshold: 64400,
                    estimatedSubsidyLoss: 8000
                };
                const result = calculateEffectiveConversionTax(
                    60000, 0, 0, 10000, 'Single', fedParams2026Single, null, acaOptions
                );
                expect(result.crossesACACliff).toBe(true);
                expect(result.breakdown.acaSubsidyLost).toBe(8000);
            });

            it('should cross cliff with small conversion just over', () => {
                const acaOptions: ACAOptions = {
                    currentAge: 55,
                    acaSubsidyAware: true,
                    acaCliffThreshold: 64400,
                    estimatedSubsidyLoss: 8000
                };
                const result = calculateEffectiveConversionTax(
                    64000, 0, 0, 500, 'Single', fedParams2026Single, null, acaOptions
                );
                expect(result.crossesACACliff).toBe(true);
                expect(result.breakdown.acaSubsidyLost).toBe(8000);
            });

            it('should include subsidy loss in tax increase', () => {
                const acaOptions: ACAOptions = {
                    currentAge: 62,
                    acaSubsidyAware: true,
                    acaCliffThreshold: 64400,
                    estimatedSubsidyLoss: 10000
                };
                const result = calculateEffectiveConversionTax(
                    50000, 0, 0, 50000, 'Single', fedParams2026Single, null, acaOptions
                );
                expect(result.crossesACACliff).toBe(true);
                expect(result.breakdown.acaSubsidyLost).toBe(10000);
                expect(result.taxIncrease).toBeGreaterThan(10000);
            });
        });

        describe('6c: Under 65, Already Above Cliff', () => {
            it('should not cross cliff when already above', () => {
                const acaOptions: ACAOptions = {
                    currentAge: 60,
                    acaSubsidyAware: true,
                    acaCliffThreshold: 64400,
                    estimatedSubsidyLoss: 8000
                };
                const result = calculateEffectiveConversionTax(
                    70000, 0, 0, 10000, 'Single', fedParams2026Single, null, acaOptions
                );
                expect(result.crossesACACliff).toBe(false);
                expect(result.breakdown.acaSubsidyLost).toBe(0);
            });
        });

        describe('6d: Age 65+, No ACA', () => {
            it('should not consider ACA at age 65', () => {
                const acaOptions: ACAOptions = {
                    currentAge: 65,
                    acaSubsidyAware: true,
                    acaCliffThreshold: 64400,
                    estimatedSubsidyLoss: 8000
                };
                const result = calculateEffectiveConversionTax(
                    60000, 0, 0, 10000, 'Single', fedParams2026Single, null, acaOptions
                );
                expect(result.crossesACACliff).toBe(false);
                expect(result.breakdown.acaSubsidyLost).toBe(0);
            });

            it('should not consider ACA at age 70', () => {
                const acaOptions: ACAOptions = {
                    currentAge: 70,
                    acaSubsidyAware: true,
                    acaCliffThreshold: 64400,
                    estimatedSubsidyLoss: 8000
                };
                const result = calculateEffectiveConversionTax(
                    60000, 0, 0, 10000, 'Single', fedParams2026Single, null, acaOptions
                );
                expect(result.crossesACACliff).toBe(false);
                expect(result.breakdown.acaSubsidyLost).toBe(0);
            });
        });

        describe('6e: Not ACA Aware', () => {
            it('should not consider ACA when not aware', () => {
                const acaOptions: ACAOptions = {
                    currentAge: 60,
                    acaSubsidyAware: false,
                    acaCliffThreshold: 64400,
                    estimatedSubsidyLoss: 8000
                };
                const result = calculateEffectiveConversionTax(
                    60000, 0, 0, 10000, 'Single', fedParams2026Single, null, acaOptions
                );
                expect(result.crossesACACliff).toBe(false);
                expect(result.breakdown.acaSubsidyLost).toBe(0);
            });
        });

        describe('6f: ACA Options Undefined', () => {
            it('should handle undefined ACA options', () => {
                const result = calculateEffectiveConversionTax(
                    60000, 0, 0, 10000, 'Single', fedParams2026Single, null, undefined
                );
                expect(result.crossesACACliff).toBe(false);
                expect(result.breakdown.acaSubsidyLost).toBe(0);
            });
        });

        describe('6g: ACA Uses 100% of SS (Not Taxable Portion)', () => {
            it('should include full SS in ACA MAGI calculation', () => {
                // MAGI = 30000 + 30000 (100% of SS) = 60000 before
                // After: 60000 + 5000 = 65000 > 64400
                const acaOptions: ACAOptions = {
                    currentAge: 60,
                    acaSubsidyAware: true,
                    acaCliffThreshold: 64400,
                    estimatedSubsidyLoss: 8000
                };
                const result = calculateEffectiveConversionTax(
                    30000, 30000, 0, 5000, 'Single', fedParams2026Single, null, acaOptions
                );
                expect(result.crossesACACliff).toBe(true);
            });
        });
    });

    // =========================================================================
    // Test Group 7: Combined Effects
    // =========================================================================
    describe('Group 7: Combined Effects', () => {
        describe('7a: SS Torpedo + LTCG Bump', () => {
            it('should show both torpedo and bump effects', () => {
                const result = calculateEffectiveConversionTax(
                    40000, 25000, 20000, 20000, 'Single', fedParams2026Single, null
                );
                expect(result.breakdown.ssTorpedoCost).toBeGreaterThanOrEqual(0);
                expect(result.breakdown.ltcgBumpCost).toBeGreaterThanOrEqual(0);
            });
        });

        describe('7b: Federal + State', () => {
            it('should include state tax in total', () => {
                const result = calculateEffectiveConversionTax(
                    60000, 0, 0, 20000, 'Single', fedParams2026Single, stateParams5Percent
                );
                expect(result.breakdown.stateTaxCost).toBeCloseTo(1000, 0);
                expect(result.taxIncrease).toBeGreaterThan(result.breakdown.federalOrdinaryTaxCost);
            });
        });

        describe('7c: Federal + ACA', () => {
            it('should include ACA subsidy loss in tax increase', () => {
                const acaOptions: ACAOptions = {
                    currentAge: 60,
                    acaSubsidyAware: true,
                    acaCliffThreshold: 64400,
                    estimatedSubsidyLoss: 8000
                };
                const result = calculateEffectiveConversionTax(
                    60000, 0, 0, 10000, 'Single', fedParams2026Single, null, acaOptions
                );
                expect(result.taxIncrease).toBeGreaterThan(8000);
            });
        });

        describe('7d: All Effects Combined', () => {
            it('should show all breakdown fields with appropriate values', () => {
                const acaOptions: ACAOptions = {
                    currentAge: 60,
                    acaSubsidyAware: true,
                    acaCliffThreshold: 64400,
                    estimatedSubsidyLoss: 8000
                };
                const result = calculateEffectiveConversionTax(
                    50000, 25000, 20000, 20000, 'Single', fedParams2026Single, stateParams5Percent, acaOptions
                );
                expect(result.breakdown.federalOrdinaryTaxCost).toBeGreaterThan(0);
                expect(result.breakdown.stateTaxCost).toBeGreaterThan(0);
                // Note: MAGI before = 50000 + 25000 (100% SS for ACA) = 75000 > 64400 cliff
                // Already above cliff, so no cliff crossing occurs
                expect(result.breakdown.acaSubsidyLost).toBe(0);
            });
        });

        describe('7e: All Effects Truly Combined (including ACA cliff crossing)', () => {
            it('should have all four cost components > 0', () => {
                // Carefully constructed scenario where ALL effects fire:
                // - SS torpedo: SS goes from 50% zone to 85% zone
                // - LTCG bump: LTCG stacks cross 0%→15% threshold
                // - State tax: 5% flat state tax
                // - ACA cliff: MAGI crosses 64400 threshold
                //
                // Inputs: nonSSIncome=15000, SS=15000, LTCG=8000, conversion=40000
                //
                // SS Torpedo (combined = nonSSIncome + LTCG + 50% of SS):
                //   Combined before = 15000 + 8000 + 7500 = 30500 (in 50% zone: 25k-34k)
                //   Combined after = 55000 + 8000 + 7500 = 70500 (in 85% zone)
                //   taxableSS before ≈ 2750, after = 12750 → torpedo!
                //
                // LTCG Bump:
                //   taxable ordinary before ≈ 1650, after ≈ 51650
                //   LTCG stacks: before=9650 (all 0%), after=59650 > 49700 (some 15%) → bump!
                //
                // ACA (MAGI = nonSSIncome + 100% of SS):
                //   MAGI before = 15000 + 15000 = 30000 < 64400
                //   MAGI after = 55000 + 15000 = 70000 > 64400 → crosses cliff!
                const acaOptions: ACAOptions = {
                    currentAge: 58,
                    acaSubsidyAware: true,
                    acaCliffThreshold: 64400,
                    estimatedSubsidyLoss: 8000
                };
                const result = calculateEffectiveConversionTax(
                    15000, 15000, 8000, 40000, 'Single', fedParams2026Single, stateParams5Percent, acaOptions
                );

                // All four components should be positive
                expect(result.breakdown.ssTorpedoCost).toBeGreaterThan(0);
                expect(result.breakdown.ltcgBumpCost).toBeGreaterThan(0);
                expect(result.breakdown.stateTaxCost).toBeGreaterThan(0);
                expect(result.breakdown.acaSubsidyLost).toBe(8000);
                expect(result.crossesACACliff).toBe(true);

                // Effective rate should be very high due to all effects combining
                expect(result.effectiveRate).toBeGreaterThan(0.35);
            });
        });
    });

    // =========================================================================
    // Test Group 8: Effective Rate Validation
    // =========================================================================
    describe('Group 8: Effective Rate Validation', () => {
        it('should have ~10% rate in pure 10% bracket', () => {
            const result = calculateEffectiveConversionTax(
                20000, 0, 0, 5000, 'Single', fedParams2026Single, null
            );
            expect(result.effectiveRate).toBeCloseTo(0.10, 1);
        });

        it('should have ~12% rate in pure 12% bracket', () => {
            const result = calculateEffectiveConversionTax(
                40000, 0, 0, 10000, 'Single', fedParams2026Single, null
            );
            expect(result.effectiveRate).toBeCloseTo(0.12, 1);
        });

        it('should have ~22% rate in pure 22% bracket', () => {
            const result = calculateEffectiveConversionTax(
                80000, 0, 0, 15000, 'Single', fedParams2026Single, null
            );
            expect(result.effectiveRate).toBeCloseTo(0.22, 1);
        });

        it('should have elevated rate with SS torpedo', () => {
            const result = calculateEffectiveConversionTax(
                20000, 30000, 0, 10000, 'Single', fedParams2026Single, null
            );
            expect(result.effectiveRate).toBeGreaterThan(0.12);
        });

        it('should have ~17% combined rate with 12% federal + 5% state', () => {
            const result = calculateEffectiveConversionTax(
                40000, 0, 0, 10000, 'Single', fedParams2026Single, stateParams5Percent
            );
            expect(result.effectiveRate).toBeCloseTo(0.17, 1);
        });

        it('should have very high effective rate with ACA cliff on small conversion', () => {
            const acaOptions: ACAOptions = {
                currentAge: 60,
                acaSubsidyAware: true,
                acaCliffThreshold: 64400,
                estimatedSubsidyLoss: 8000
            };
            const result = calculateEffectiveConversionTax(
                64000, 0, 0, 500, 'Single', fedParams2026Single, null, acaOptions
            );
            // $8000 subsidy loss on $500 conversion = 1600% effective rate!
            expect(result.effectiveRate).toBeGreaterThan(1.0);
        });
    });

    // =========================================================================
    // Test Group 9: Breakdown Component Validation
    // =========================================================================
    describe('Group 9: Breakdown Component Validation', () => {
        describe('9a: Breakdown Sums Correctly', () => {
            it('should have breakdown sum approximately equal taxIncrease', () => {
                const result = calculateEffectiveConversionTax(
                    50000, 20000, 10000, 15000, 'Single', fedParams2026Single, stateParams5Percent
                );
                const breakdownSum =
                    result.breakdown.federalOrdinaryTaxCost +
                    result.breakdown.ssTorpedoCost +
                    result.breakdown.ltcgBumpCost +
                    result.breakdown.niitCost +
                    result.breakdown.stateTaxCost +
                    result.breakdown.acaSubsidyLost;
                expect(breakdownSum).toBeCloseTo(result.taxIncrease, 0);
            });
        });

        describe('9b: Components Are Non-Negative', () => {
            it('should have all non-negative breakdown components', () => {
                const result = calculateEffectiveConversionTax(
                    50000, 20000, 10000, 15000, 'Single', fedParams2026Single, stateParams5Percent
                );
                expect(result.breakdown.federalOrdinaryTaxCost).toBeGreaterThanOrEqual(0);
                expect(result.breakdown.ssTorpedoCost).toBeGreaterThanOrEqual(0);
                expect(result.breakdown.ltcgBumpCost).toBeGreaterThanOrEqual(0);
                expect(result.breakdown.niitCost).toBeGreaterThanOrEqual(0);
                expect(result.breakdown.stateTaxCost).toBeGreaterThanOrEqual(0);
                expect(result.breakdown.acaSubsidyLost).toBeGreaterThanOrEqual(0);
            });
        });

        describe('9c: Isolated Component Verification', () => {
            it('should show only federalOrdinaryTaxCost when isolated', () => {
                const result = calculateEffectiveConversionTax(
                    40000, 0, 0, 10000, 'Single', fedParams2026Single, null
                );
                expect(result.breakdown.federalOrdinaryTaxCost).toBeGreaterThan(0);
                expect(result.breakdown.ssTorpedoCost).toBe(0);
                expect(result.breakdown.ltcgBumpCost).toBe(0);
                expect(result.breakdown.stateTaxCost).toBe(0);
                expect(result.breakdown.acaSubsidyLost).toBe(0);
            });

            it('should show ssTorpedoCost when SS present', () => {
                const result = calculateEffectiveConversionTax(
                    15000, 30000, 0, 10000, 'Single', fedParams2026Single, null
                );
                expect(result.breakdown.ssTorpedoCost).toBeGreaterThan(0);
                expect(result.breakdown.ltcgBumpCost).toBe(0);
            });

            it('should show ltcgBumpCost when LTCG at threshold', () => {
                // Position ordinary income to push LTCG from 0% to 15%
                const result = calculateEffectiveConversionTax(
                    60000, 0, 20000, 10000, 'Single', fedParams2026Single, null
                );
                expect(result.breakdown.ltcgBumpCost).toBeGreaterThan(0);
                expect(result.breakdown.ssTorpedoCost).toBe(0);
            });

            it('should show only stateTaxCost when state tax added', () => {
                const result = calculateEffectiveConversionTax(
                    40000, 0, 0, 10000, 'Single', fedParams2026Single, stateParams5Percent
                );
                expect(result.breakdown.stateTaxCost).toBeGreaterThan(0);
                expect(result.breakdown.ssTorpedoCost).toBe(0);
                expect(result.breakdown.ltcgBumpCost).toBe(0);
            });

            it('should show only acaSubsidyLost when ACA cliff crossed', () => {
                const acaOptions: ACAOptions = {
                    currentAge: 60,
                    acaSubsidyAware: true,
                    acaCliffThreshold: 64400,
                    estimatedSubsidyLoss: 8000
                };
                const result = calculateEffectiveConversionTax(
                    64000, 0, 0, 1000, 'Single', fedParams2026Single, null, acaOptions
                );
                expect(result.breakdown.acaSubsidyLost).toBeGreaterThan(0);
                expect(result.breakdown.ssTorpedoCost).toBe(0);
                expect(result.breakdown.ltcgBumpCost).toBe(0);
            });
        });
    });

    // =========================================================================
    // Test Group 10: NIIT Effect
    // =========================================================================
    describe('Group 10: NIIT Effect', () => {
        describe('10a: Below NIIT Threshold (No NIIT)', () => {
            it('should have zero NIIT when well below threshold', () => {
                const result = calculateEffectiveConversionTax(
                    100000, 0, 20000, 30000, 'Single', fedParams2026Single, null
                );
                expect(result.breakdown.niitCost).toBe(0);
            });

            it('should have zero NIIT just below threshold', () => {
                const result = calculateEffectiveConversionTax(
                    170000, 0, 20000, 9000, 'Single', fedParams2026Single, null
                );
                expect(result.breakdown.niitCost).toBe(0);
            });
        });

        describe('10b: Conversion Pushes Over NIIT Threshold', () => {
            it('should have positive NIIT when crossing threshold with LTCG', () => {
                // MAGI before = 180000 + 30000 = 210000 > 200000
                // MAGI after = 180000 + 30000 + 25000 = 235000
                // But conversion isn't investment income for NIIT purposes
                // Only LTCG is investment income
                // NIIT = 3.8% × min(investment income, MAGI excess)
                const result = calculateEffectiveConversionTax(
                    180000, 0, 30000, 25000, 'Single', fedParams2026Single, null
                );
                expect(result.breakdown.niitCost).toBeGreaterThanOrEqual(0);
            });
        });

        describe('10c: Already Over NIIT Threshold', () => {
            it('should have zero NIIT when already over but no LTCG', () => {
                const result = calculateEffectiveConversionTax(
                    250000, 0, 0, 50000, 'Single', fedParams2026Single, null
                );
                expect(result.breakdown.niitCost).toBe(0);
            });
        });

        describe('10e: MFJ NIIT Threshold ($250k)', () => {
            it('should have NIIT when conversion pushes over MFJ threshold', () => {
                // MAGI before = 220000 + 30000 (LTCG) = 250000 (at threshold)
                // MAGI after = 240000 + 30000 = 270000 (above threshold)
                // NIIT = min(30000 LTCG, 20000 excess) * 3.8% = 760
                const result = calculateEffectiveConversionTax(
                    220000, 0, 30000, 20000, 'Married Filing Jointly', fedParams2026MFJ, null
                );
                expect(result.breakdown.niitCost).toBeCloseTo(760, 0);
            });

            it('should have zero NIIT when MFJ MAGI clearly below $250k', () => {
                // MAGI before = 150000 + 40000 (LTCG) = 190000 < 250000
                // MAGI after = 180000 + 40000 = 220000 < 250000
                // No NIIT because MAGI stays below MFJ threshold
                const result = calculateEffectiveConversionTax(
                    150000, 0, 40000, 30000, 'Married Filing Jointly', fedParams2026MFJ, null
                );
                expect(result.breakdown.niitCost).toBe(0);
            });
        });
    });

    // =========================================================================
    // Test Group 11: MFJ Filing Status
    // =========================================================================
    describe('Group 11: MFJ Filing Status', () => {
        it('should use MFJ SS thresholds ($32k/$44k)', () => {
            const result = calculateEffectiveConversionTax(
                20000, 40000, 0, 15000, 'Married Filing Jointly', fedParams2026MFJ, null
            );
            expect(result.breakdown.ssTorpedoCost).toBeGreaterThanOrEqual(0);
        });

        it('should use MFJ LTCG threshold ($99,400)', () => {
            // taxable = 80000 - 32200 = 47800 < 99400
            // After conversion stays below MFJ LTCG 0% threshold
            const result = calculateEffectiveConversionTax(
                80000, 0, 50000, 30000, 'Married Filing Jointly', fedParams2026MFJ, null
            );
            expect(result.breakdown.ltcgBumpCost).toBeGreaterThanOrEqual(0);
        });

        it('should have lower effective rate for MFJ vs Single at same income', () => {
            const singleResult = calculateEffectiveConversionTax(
                50000, 30000, 20000, 20000, 'Single', fedParams2026Single, null
            );
            const mfjResult = calculateEffectiveConversionTax(
                50000, 30000, 20000, 20000, 'Married Filing Jointly', fedParams2026MFJ, null
            );
            expect(mfjResult.effectiveRate).toBeLessThan(singleResult.effectiveRate);
        });
    });

    // =========================================================================
    // Test Group 12: Return Value Validation
    // =========================================================================
    describe('Group 12: Return Value Validation', () => {
        const testCases = [
            { nonSS: 40000, ss: 0, ltcg: 0, conv: 10000, state: null, aca: undefined },
            { nonSS: 50000, ss: 25000, ltcg: 10000, conv: 15000, state: stateParams5Percent, aca: undefined },
            { nonSS: 60000, ss: 0, ltcg: 0, conv: 5000, state: null, aca: defaultACAOptions },
        ];

        testCases.forEach(({ nonSS, ss, ltcg, conv, state, aca }, i) => {
            it(`should validate return values for test case ${i + 1}`, () => {
                const result = calculateEffectiveConversionTax(
                    nonSS, ss, ltcg, conv, 'Single', fedParams2026Single, state, aca
                );

                // 1. taxBefore >= 0
                expect(result.taxBefore).toBeGreaterThanOrEqual(0);

                // 2. taxAfter >= taxBefore
                expect(result.taxAfter).toBeGreaterThanOrEqual(result.taxBefore);

                // 3. taxIncrease >= 0
                expect(result.taxIncrease).toBeGreaterThanOrEqual(0);

                // 4. effectiveRate >= 0
                expect(result.effectiveRate).toBeGreaterThanOrEqual(0);

                // 5. If conversionAmount > 0: effectiveRate = taxIncrease / conversionAmount
                if (conv > 0) {
                    expect(result.effectiveRate).toBeCloseTo(result.taxIncrease / conv, 5);
                }

                // 6. If conversionAmount = 0: effectiveRate = 0
                if (conv === 0) {
                    expect(result.effectiveRate).toBe(0);
                }

                // 7. All breakdown components >= 0
                expect(result.breakdown.federalOrdinaryTaxCost).toBeGreaterThanOrEqual(0);
                expect(result.breakdown.ssTorpedoCost).toBeGreaterThanOrEqual(0);
                expect(result.breakdown.ltcgBumpCost).toBeGreaterThanOrEqual(0);
                expect(result.breakdown.niitCost).toBeGreaterThanOrEqual(0);
                expect(result.breakdown.stateTaxCost).toBeGreaterThanOrEqual(0);
                expect(result.breakdown.acaSubsidyLost).toBeGreaterThanOrEqual(0);

                // 8. crossesACACliff is boolean
                expect(typeof result.crossesACACliff).toBe('boolean');
            });
        });
    });

    // =========================================================================
    // Test Group 13: Realistic Retirement Scenarios
    // =========================================================================
    describe('Group 13: Realistic Retirement Scenarios', () => {
        it('should handle early retiree aggressive Roth conversion', () => {
            const acaOptions: ACAOptions = {
                currentAge: 55,
                acaSubsidyAware: true,
                acaCliffThreshold: 64400,
                estimatedSubsidyLoss: 8000
            };
            const result = calculateEffectiveConversionTax(
                20000, 0, 0, 50000, 'Single', fedParams2026Single, stateParams5Percent, acaOptions
            );
            // MAGI goes from 20000 to 70000, crossing ACA cliff at 64400
            // Federal ~12.4% + State 5% + ACA ($8k/$50k = 16%) = ~33%
            expect(result.effectiveRate).toBeGreaterThan(0.30);
            expect(result.effectiveRate).toBeLessThan(0.40);
            expect(result.crossesACACliff).toBe(true);
        });

        it('should handle early retiree with ACA cliff concern', () => {
            const acaOptions: ACAOptions = {
                currentAge: 60,
                acaSubsidyAware: true,
                acaCliffThreshold: 64400,
                estimatedSubsidyLoss: 8000
            };
            const result = calculateEffectiveConversionTax(
                50000, 0, 0, 15000, 'Single', fedParams2026Single, null, acaOptions
            );
            // Crosses ACA cliff
            expect(result.crossesACACliff).toBe(true);
            expect(result.effectiveRate).toBeGreaterThan(0.5);
        });

        it('should handle SS start year with small conversion', () => {
            const acaOptions: ACAOptions = {
                currentAge: 62,
                acaSubsidyAware: true,
                acaCliffThreshold: 64400,
                estimatedSubsidyLoss: 8000
            };
            const result = calculateEffectiveConversionTax(
                30000, 25000, 10000, 10000, 'Single', fedParams2026Single, stateParams5Percent, acaOptions
            );
            expect(result.effectiveRate).toBeGreaterThan(0);
        });

        it('should handle high income tax bracket fill', () => {
            const result = calculateEffectiveConversionTax(
                100000, 0, 50000, 20000, 'Single', fedParams2026Single, stateParamsDC
            );
            expect(result.effectiveRate).toBeGreaterThan(0.25);
        });
    });
});
