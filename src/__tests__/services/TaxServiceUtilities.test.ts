/**
 * Comprehensive unit tests for TaxService utility functions:
 * - getMarginalTaxRate
 * - calculateTax
 * - getGrossIncome
 * - getPreTaxExemptions
 * - getSocialSecurityBenefits
 * - getIncomeThresholdForRate (from TaxOptimizationService)
 */

import { describe, it, expect } from 'vitest';
import {
    getMarginalTaxRate,
    calculateTax,
    getGrossIncome,
    getPreTaxExemptions,
    getSocialSecurityBenefits,
    calculateTotalFederalTax,
} from '../../components/Objects/Taxes/TaxService';
import { TaxParameters } from '../../data/TaxData';
import {
    WorkIncome,
    PassiveIncome,
    CurrentSocialSecurityIncome,
    FutureSocialSecurityIncome,
    AnyIncome
} from '../../components/Objects/Income/models';
import { getIncomeThresholdForRate, getMedianRetirementTaxRate } from '../../services/TaxOptimizationService';
import { SimulationYear } from '../../components/Objects/Assumptions/SimulationEngine';

// =============================================================================
// Test Data: 2026 Single Federal Tax Brackets
// =============================================================================

// 2026 Single brackets (from TaxData.tsx):
// 10%: $0 - $12,400
// 12%: $12,400 - $50,400
// 22%: $50,400 - $105,700
// 24%: $105,700 - $201,775
// 32%: $201,775 - $256,225
// 35%: $256,225 - $640,600
// 37%: $640,600+
// Standard deduction: $16,100

const fed2026Single: TaxParameters = {
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
    socialSecurityTaxRate: 0.062,
    socialSecurityWageBase: 176100,
    medicareTaxRate: 0.0145,
    capitalGainsBrackets: [
        { threshold: 0, rate: 0.00 },
        { threshold: 49700, rate: 0.15 },
        { threshold: 548200, rate: 0.20 }
    ]
};

// =============================================================================
// Part 1: getMarginalTaxRate
// =============================================================================

describe('getMarginalTaxRate', () => {
    describe('Income in each bracket', () => {
        it('should return 10% for income in 10% bracket ($5,000)', () => {
            const result = getMarginalTaxRate(5000, fed2026Single);
            expect(result.rate).toBe(0.10);
            expect(result.bracketStart).toBe(0);
            expect(result.bracketEnd).toBe(12400);
            expect(result.headroom).toBe(12400 - 5000);
        });

        it('should return 12% for income in 12% bracket ($30,000)', () => {
            const result = getMarginalTaxRate(30000, fed2026Single);
            expect(result.rate).toBe(0.12);
            expect(result.bracketStart).toBe(12400);
            expect(result.bracketEnd).toBe(50400);
            expect(result.headroom).toBe(50400 - 30000);
        });

        it('should return 22% for income in 22% bracket ($75,000)', () => {
            const result = getMarginalTaxRate(75000, fed2026Single);
            expect(result.rate).toBe(0.22);
            expect(result.bracketStart).toBe(50400);
            expect(result.bracketEnd).toBe(105700);
            expect(result.headroom).toBe(105700 - 75000);
        });

        it('should return 24% for income in 24% bracket ($150,000)', () => {
            const result = getMarginalTaxRate(150000, fed2026Single);
            expect(result.rate).toBe(0.24);
            expect(result.bracketStart).toBe(105700);
            expect(result.bracketEnd).toBe(201775);
            expect(result.headroom).toBe(201775 - 150000);
        });

        it('should return 32% for income in 32% bracket ($220,000)', () => {
            const result = getMarginalTaxRate(220000, fed2026Single);
            expect(result.rate).toBe(0.32);
            expect(result.bracketStart).toBe(201775);
            expect(result.bracketEnd).toBe(256225);
            expect(result.headroom).toBe(256225 - 220000);
        });

        it('should return 35% for income in 35% bracket ($400,000)', () => {
            const result = getMarginalTaxRate(400000, fed2026Single);
            expect(result.rate).toBe(0.35);
            expect(result.bracketStart).toBe(256225);
            expect(result.bracketEnd).toBe(640600);
            expect(result.headroom).toBe(640600 - 400000);
        });

        it('should return 37% for income in 37% bracket ($700,000)', () => {
            const result = getMarginalTaxRate(700000, fed2026Single);
            expect(result.rate).toBe(0.37);
            expect(result.bracketStart).toBe(640600);
            expect(result.bracketEnd).toBe(Infinity);
            expect(result.headroom).toBe(Infinity);
        });
    });

    describe('Income exactly at bracket boundaries', () => {
        it('should return 10% at threshold 0', () => {
            const result = getMarginalTaxRate(0, fed2026Single);
            expect(result.rate).toBe(0.10);
            expect(result.bracketStart).toBe(0);
        });

        it('should return 12% at threshold 12400 (exactly at 12% start)', () => {
            const result = getMarginalTaxRate(12400, fed2026Single);
            expect(result.rate).toBe(0.12);
            expect(result.bracketStart).toBe(12400);
            expect(result.bracketEnd).toBe(50400);
            expect(result.headroom).toBe(50400 - 12400);
        });

        it('should return 22% at threshold 50400 (exactly at 22% start)', () => {
            const result = getMarginalTaxRate(50400, fed2026Single);
            expect(result.rate).toBe(0.22);
            expect(result.bracketStart).toBe(50400);
            expect(result.bracketEnd).toBe(105700);
        });

        it('should return 24% at threshold 105700 (exactly at 24% start)', () => {
            const result = getMarginalTaxRate(105700, fed2026Single);
            expect(result.rate).toBe(0.24);
            expect(result.bracketStart).toBe(105700);
            expect(result.bracketEnd).toBe(201775);
        });

        it('should return 32% at threshold 201775 (exactly at 32% start)', () => {
            const result = getMarginalTaxRate(201775, fed2026Single);
            expect(result.rate).toBe(0.32);
        });

        it('should return 35% at threshold 256225 (exactly at 35% start)', () => {
            const result = getMarginalTaxRate(256225, fed2026Single);
            expect(result.rate).toBe(0.35);
        });

        it('should return 37% at threshold 640600 (exactly at 37% start)', () => {
            const result = getMarginalTaxRate(640600, fed2026Single);
            expect(result.rate).toBe(0.37);
            expect(result.bracketStart).toBe(640600);
            expect(result.bracketEnd).toBe(Infinity);
        });
    });

    describe('Edge cases', () => {
        it('should return 10% for zero income', () => {
            const result = getMarginalTaxRate(0, fed2026Single);
            expect(result.rate).toBe(0.10);
            expect(result.bracketStart).toBe(0);
            expect(result.bracketEnd).toBe(12400);
            expect(result.headroom).toBe(12400);
        });

        it('should return 10% for negative income', () => {
            const result = getMarginalTaxRate(-5000, fed2026Single);
            expect(result.rate).toBe(0.10);
            expect(result.bracketStart).toBe(0);
            expect(result.bracketEnd).toBe(12400);
            expect(result.headroom).toBe(12400);
        });
    });

    describe('Headroom calculation', () => {
        it('should calculate correct headroom near bottom of bracket', () => {
            const result = getMarginalTaxRate(12500, fed2026Single);
            expect(result.rate).toBe(0.12);
            expect(result.headroom).toBe(50400 - 12500);
        });

        it('should calculate correct headroom near top of bracket', () => {
            const result = getMarginalTaxRate(50300, fed2026Single);
            expect(result.rate).toBe(0.12);
            expect(result.headroom).toBe(50400 - 50300);
        });

        it('should calculate headroom of 1 at one dollar below bracket boundary', () => {
            const result = getMarginalTaxRate(50399, fed2026Single);
            expect(result.rate).toBe(0.12);
            expect(result.headroom).toBe(1);
        });

        it('should have infinite headroom in top bracket', () => {
            const result = getMarginalTaxRate(1000000, fed2026Single);
            expect(result.rate).toBe(0.37);
            expect(result.headroom).toBe(Infinity);
        });
    });
});

// =============================================================================
// Part 2: calculateTax
// =============================================================================

describe('calculateTax', () => {
    describe('Various income levels across brackets', () => {
        it('should calculate tax for income entirely in 10% bracket', () => {
            // Gross 20000, std ded 16100 => taxable 3900
            // Tax = 3900 * 0.10 = 390
            const tax = calculateTax(20000, 0, fed2026Single);
            expect(tax).toBeCloseTo(390, 2);
        });

        it('should calculate tax for income spanning 10% and 12% brackets', () => {
            // Gross 40000, std ded 16100 => taxable 23900
            // Tax = 12400 * 0.10 + (23900 - 12400) * 0.12 = 1240 + 1380 = 2620
            const tax = calculateTax(40000, 0, fed2026Single);
            expect(tax).toBeCloseTo(2620, 2);
        });

        it('should calculate tax for income in 22% bracket', () => {
            // Gross 80000, std ded 16100 => taxable 63900
            // Tax = 12400 * 0.10 + (50400 - 12400) * 0.12 + (63900 - 50400) * 0.22
            // = 1240 + 4560 + 2970 = 8770
            const tax = calculateTax(80000, 0, fed2026Single);
            expect(tax).toBeCloseTo(8770, 2);
        });

        it('should calculate tax for income in 24% bracket', () => {
            // Gross 150000, std ded 16100 => taxable 133900
            // Tax = 12400*0.10 + 38000*0.12 + 55300*0.22 + (133900-105700)*0.24
            // = 1240 + 4560 + 12166 + 6768 = 24734
            const tax = calculateTax(150000, 0, fed2026Single);
            expect(tax).toBeCloseTo(24734, 2);
        });

        it('should calculate tax for high income ($500,000)', () => {
            // This tests spanning multiple brackets up to 35%
            const tax = calculateTax(500000, 0, fed2026Single);
            expect(tax).toBeGreaterThan(100000);
            expect(tax).toBeLessThan(200000);
        });
    });

    describe('With preTaxDeductions', () => {
        it('should reduce taxable income by preTaxDeductions', () => {
            // Gross 80000, preTax 20000 => effective gross 60000
            // Taxable = 60000 - 16100 = 43900
            // Tax = 12400 * 0.10 + (43900 - 12400) * 0.12 = 1240 + 3780 = 5020
            const taxWithDeductions = calculateTax(80000, 20000, fed2026Single);
            const taxWithoutDeductions = calculateTax(60000, 0, fed2026Single);
            expect(taxWithDeductions).toBeCloseTo(taxWithoutDeductions, 2);
        });

        it('should handle large preTaxDeductions reducing tax significantly', () => {
            // Gross 100000, preTax 50000 => effective gross 50000
            const tax = calculateTax(100000, 50000, fed2026Single);
            const taxDirect = calculateTax(50000, 0, fed2026Single);
            expect(tax).toBeCloseTo(taxDirect, 2);
        });
    });

    describe('Income below standard deduction', () => {
        it('should return $0 tax when income below standard deduction', () => {
            const tax = calculateTax(15000, 0, fed2026Single);
            expect(tax).toBe(0);
        });

        it('should return $0 tax when income equals standard deduction', () => {
            const tax = calculateTax(16100, 0, fed2026Single);
            expect(tax).toBe(0);
        });

        it('should return $0 tax when gross minus deductions is below std deduction', () => {
            const tax = calculateTax(30000, 20000, fed2026Single);
            // 30000 - 20000 = 10000 gross after preTax
            // 10000 - 16100 = -6100 => 0 taxable
            expect(tax).toBe(0);
        });
    });

    describe('Consistency with calculateTotalFederalTax', () => {
        it('should match calculateTotalFederalTax with SS=0, STCG=0, LTCG=0', () => {
            const testCases = [20000, 50000, 100000, 200000];

            for (const income of testCases) {
                const simpleTax = calculateTax(income, 0, fed2026Single);
                const fullResult = calculateTotalFederalTax(
                    income,
                    0,  // no SS
                    0,  // no STCG
                    0,  // no LTCG
                    0,  // no preTaxDeductions
                    'Single',
                    fed2026Single
                );
                expect(simpleTax).toBeCloseTo(fullResult.ordinaryTax, 2);
            }
        });

        it('should match with preTaxDeductions', () => {
            const income = 100000;
            const preTax = 20000;

            const simpleTax = calculateTax(income, preTax, fed2026Single);
            const fullResult = calculateTotalFederalTax(
                income,
                0,  // no SS
                0,  // no STCG
                0,  // no LTCG
                preTax,
                'Single',
                fed2026Single
            );
            expect(simpleTax).toBeCloseTo(fullResult.ordinaryTax, 2);
        });
    });
});

// =============================================================================
// Part 3: getGrossIncome
// =============================================================================

describe('getGrossIncome', () => {
    const year = 2026;
    // Use Jan 1 of test year to ensure full-year proration (no partial year)
    const fullYearStart = new Date(2026, 0, 1);

    describe('WorkIncome', () => {
        it('should return regular WorkIncome amount', () => {
            const income = new WorkIncome(
                'w1', 'Salary', 100000, 'Annually', 'Yes',
                10000, 0, 0, 5000, 'acc1', 'Traditional 401k',
                'FIXED', fullYearStart
            );
            const gross = getGrossIncome([income], year);
            // Traditional 401k: gross = amount only (no employer match)
            expect(gross).toBe(100000);
        });

        it('should include employerMatch for Roth 401k', () => {
            const income = new WorkIncome(
                'w1', 'Salary', 100000, 'Annually', 'Yes',
                0, 0, 10000, 5000, 'acc1', 'Roth 401k',
                'FIXED', fullYearStart
            );
            const gross = getGrossIncome([income], year);
            // Roth 401k: gross = amount + employerMatch
            expect(gross).toBe(105000);
        });

        it('should NOT include employerMatch for Traditional 401k', () => {
            const income = new WorkIncome(
                'w1', 'Salary', 100000, 'Annually', 'Yes',
                10000, 0, 0, 5000, 'acc1', 'Traditional 401k',
                'FIXED', fullYearStart
            );
            const gross = getGrossIncome([income], year);
            expect(gross).toBe(100000);
        });
    });

    describe('PassiveIncome', () => {
        it('should include Dividend income', () => {
            const income = new PassiveIncome(
                'p1', 'Dividends', 5000, 'Annually', 'No', 'Dividend',
                fullYearStart
            );
            const gross = getGrossIncome([income], year);
            expect(gross).toBe(5000);
        });

        it('should include Rental income', () => {
            const income = new PassiveIncome(
                'p1', 'Rental', 24000, 'Annually', 'No', 'Rental',
                fullYearStart
            );
            const gross = getGrossIncome([income], year);
            expect(gross).toBe(24000);
        });

        it('should include Interest income', () => {
            const income = new PassiveIncome(
                'p1', 'Interest', 1000, 'Annually', 'No', 'Interest',
                fullYearStart
            );
            const gross = getGrossIncome([income], year);
            expect(gross).toBe(1000);
        });
    });

    describe('Social Security Income', () => {
        it('should include CurrentSocialSecurityIncome', () => {
            const income = new CurrentSocialSecurityIncome(
                'ss1', 'Social Security', 24000, 'Annually', fullYearStart
            );
            const gross = getGrossIncome([income], year);
            expect(gross).toBe(24000);
        });

        it('should include FutureSocialSecurityIncome', () => {
            const income = new FutureSocialSecurityIncome(
                'ss1', 'Future SS', 67, 2000, 2025, fullYearStart
            );
            // FutureSocialSecurityIncome: amount = calculatedPIA * 12 = 2000 * 12 = 24000
            const gross = getGrossIncome([income], year);
            expect(gross).toBe(24000);
        });
    });

    describe('Multiple income sources combined', () => {
        it('should sum all income sources', () => {
            const incomes: AnyIncome[] = [
                new WorkIncome('w1', 'Salary', 80000, 'Annually', 'Yes', 10000, 0, 0, 5000, 'acc1', 'Traditional 401k', 'FIXED', fullYearStart),
                new PassiveIncome('p1', 'Dividends', 3000, 'Annually', 'No', 'Dividend', fullYearStart),
                new CurrentSocialSecurityIncome('ss1', 'SS', 18000, 'Annually', fullYearStart)
            ];
            const gross = getGrossIncome(incomes, year);
            // 80000 + 3000 + 18000 = 101000
            expect(gross).toBe(101000);
        });

        it('should handle mixed Roth and Traditional 401k', () => {
            const incomes: AnyIncome[] = [
                new WorkIncome('w1', 'Job1', 60000, 'Annually', 'Yes', 5000, 0, 0, 3000, 'acc1', 'Traditional 401k', 'FIXED', fullYearStart),
                new WorkIncome('w2', 'Job2', 40000, 'Annually', 'Yes', 0, 0, 5000, 2000, 'acc2', 'Roth 401k', 'FIXED', fullYearStart)
            ];
            const gross = getGrossIncome(incomes, year);
            // Job1: 60000 (Traditional, no match added)
            // Job2: 40000 + 2000 (Roth, match added) = 42000
            // Total: 102000
            expect(gross).toBe(102000);
        });
    });

    describe('Income with start/end dates (proration)', () => {
        it('should prorate income starting mid-year', () => {
            // Income starting July 1 (month index 6, 6 months active: Jul-Dec)
            const income = new WorkIncome(
                'w1', 'Salary', 100000, 'Annually', 'Yes',
                0, 0, 0, 0, 'acc1', null,
                'FIXED',
                new Date(2026, 6, 1)  // July 1, 2026 (month is 0-indexed)
            );
            const gross = getGrossIncome([income], year);
            // 6 months active (Jul-Dec) = 6/12 = 50%
            expect(gross).toBe(50000);
        });

        it('should prorate income ending mid-year', () => {
            // Income ending June 30 (month index 5, 6 months active: Jan-Jun)
            const income = new WorkIncome(
                'w1', 'Salary', 100000, 'Annually', 'Yes',
                0, 0, 0, 0, 'acc1', null,
                'FIXED',
                new Date(2025, 0, 1),  // Jan 1, 2025 (started before)
                new Date(2026, 5, 30)  // June 30, 2026 (month 5)
            );
            const gross = getGrossIncome([income], year);
            // 6 months active (Jan-Jun) = 6/12 = 50%
            expect(gross).toBe(50000);
        });
    });

    describe('Empty and edge cases', () => {
        it('should return 0 for empty income array', () => {
            const gross = getGrossIncome([], year);
            expect(gross).toBe(0);
        });
    });
});

// =============================================================================
// Part 4: getPreTaxExemptions
// =============================================================================

describe('getPreTaxExemptions', () => {
    const year = 2026;
    // Use Jan 1 of test year to ensure full-year proration (no partial year)
    const fullYearStart = new Date(2026, 0, 1);

    describe('WorkIncome contributions', () => {
        it('should include preTax401k contributions', () => {
            const income = new WorkIncome(
                'w1', 'Salary', 100000, 'Annually', 'Yes',
                15000, 0, 0, 0, 'acc1', 'Traditional 401k',
                'FIXED', fullYearStart
            );
            const exemptions = getPreTaxExemptions([income], year);
            expect(exemptions).toBe(15000);
        });

        it('should include insurance premiums', () => {
            const income = new WorkIncome(
                'w1', 'Salary', 100000, 'Annually', 'Yes',
                0, 6000, 0, 0, 'acc1', 'Traditional 401k',
                'FIXED', fullYearStart
            );
            const exemptions = getPreTaxExemptions([income], year);
            expect(exemptions).toBe(6000);
        });

        it('should include hsaContribution', () => {
            const income = new WorkIncome(
                'w1', 'Salary', 100000, 'Annually', 'Yes',
                0, 0, 0, 0, 'acc1', 'Traditional 401k',
                'FIXED', fullYearStart, undefined,
                4000  // hsaContribution
            );
            const exemptions = getPreTaxExemptions([income], year);
            expect(exemptions).toBe(4000);
        });

        it('should include all three combined', () => {
            const income = new WorkIncome(
                'w1', 'Salary', 100000, 'Annually', 'Yes',
                15000, 6000, 0, 0, 'acc1', 'Traditional 401k',
                'FIXED', fullYearStart, undefined,
                4000  // hsaContribution
            );
            const exemptions = getPreTaxExemptions([income], year);
            // 15000 + 6000 + 4000 = 25000
            expect(exemptions).toBe(25000);
        });
    });

    describe('Multiple WorkIncome sources', () => {
        it('should sum exemptions from multiple jobs', () => {
            const incomes: AnyIncome[] = [
                new WorkIncome('w1', 'Job1', 80000, 'Annually', 'Yes', 10000, 3000, 0, 0, 'acc1', 'Traditional 401k', 'FIXED', fullYearStart),
                new WorkIncome('w2', 'Job2', 40000, 'Annually', 'Yes', 5000, 2000, 0, 0, 'acc2', 'Traditional 401k', 'FIXED', fullYearStart)
            ];
            const exemptions = getPreTaxExemptions(incomes, year);
            // Job1: 10000 + 3000 = 13000
            // Job2: 5000 + 2000 = 7000
            // Total: 20000
            expect(exemptions).toBe(20000);
        });
    });

    describe('With age parameter (getEffective401k path)', () => {
        it('should use effective 401k when age is provided', () => {
            const income = new WorkIncome(
                'w1', 'Salary', 100000, 'Annually', 'Yes',
                15000, 3000, 0, 0, 'acc1', 'Traditional 401k',
                'FIXED', fullYearStart, undefined, 2000,
                'custom'  // autoMax401k = custom (uses preTax401k as-is)
            );
            const exemptionsNoAge = getPreTaxExemptions([income], year);
            const exemptionsWithAge = getPreTaxExemptions([income], year, 45);
            // With custom, both should be the same
            expect(exemptionsNoAge).toBe(exemptionsWithAge);
        });
    });

    describe('Non-WorkIncome types should be ignored', () => {
        it('should ignore PassiveIncome', () => {
            const incomes: AnyIncome[] = [
                new WorkIncome('w1', 'Salary', 80000, 'Annually', 'Yes', 10000, 0, 0, 0, 'acc1', 'Traditional 401k', 'FIXED', fullYearStart),
                new PassiveIncome('p1', 'Dividends', 5000, 'Annually', 'No', 'Dividend')
            ];
            const exemptions = getPreTaxExemptions(incomes, year);
            expect(exemptions).toBe(10000);
        });

        it('should ignore SocialSecurityIncome', () => {
            const incomes: AnyIncome[] = [
                new WorkIncome('w1', 'Salary', 80000, 'Annually', 'Yes', 10000, 0, 0, 0, 'acc1', 'Traditional 401k', 'FIXED', fullYearStart),
                new CurrentSocialSecurityIncome('ss1', 'SS', 24000, 'Annually', fullYearStart)
            ];
            const exemptions = getPreTaxExemptions(incomes, year);
            expect(exemptions).toBe(10000);
        });
    });

    describe('Empty income array', () => {
        it('should return 0 for empty array', () => {
            const exemptions = getPreTaxExemptions([], year);
            expect(exemptions).toBe(0);
        });
    });
});

// =============================================================================
// Part 5: getSocialSecurityBenefits
// =============================================================================

describe('getSocialSecurityBenefits', () => {
    const year = 2026;
    // Use Jan 1 of test year to ensure full-year proration (no partial year)
    const fullYearStart = new Date(2026, 0, 1);

    describe('CurrentSocialSecurityIncome only', () => {
        it('should return CurrentSocialSecurityIncome amount', () => {
            const income = new CurrentSocialSecurityIncome(
                'ss1', 'My SS', 24000, 'Annually', fullYearStart
            );
            const benefits = getSocialSecurityBenefits([income], year);
            expect(benefits).toBe(24000);
        });

        it('should handle monthly SS income', () => {
            const income = new CurrentSocialSecurityIncome(
                'ss1', 'My SS', 2000, 'Monthly', fullYearStart
            );
            const benefits = getSocialSecurityBenefits([income], year);
            expect(benefits).toBe(24000);  // 2000 * 12
        });
    });

    describe('FutureSocialSecurityIncome only', () => {
        it('should return FutureSocialSecurityIncome amount', () => {
            const income = new FutureSocialSecurityIncome(
                'ss1', 'Future SS', 67, 2500, 2025, fullYearStart  // PIA = 2500/month = 30000/year
            );
            const benefits = getSocialSecurityBenefits([income], year);
            expect(benefits).toBe(30000);
        });
    });

    describe('Both types combined', () => {
        it('should sum CurrentSS and FutureSS', () => {
            const incomes: AnyIncome[] = [
                new CurrentSocialSecurityIncome('ss1', 'My SS', 24000, 'Annually', fullYearStart),
                new FutureSocialSecurityIncome('ss2', 'Spouse SS', 67, 1500, 2025, fullYearStart)
            ];
            const benefits = getSocialSecurityBenefits(incomes, year);
            // 24000 + (1500 * 12) = 24000 + 18000 = 42000
            expect(benefits).toBe(42000);
        });
    });

    describe('Multiple SS income sources (both spouses)', () => {
        it('should sum all SS income sources', () => {
            const incomes: AnyIncome[] = [
                new CurrentSocialSecurityIncome('ss1', 'My SS', 24000, 'Annually', fullYearStart),
                new CurrentSocialSecurityIncome('ss2', 'Spouse SS', 18000, 'Annually', fullYearStart)
            ];
            const benefits = getSocialSecurityBenefits(incomes, year);
            expect(benefits).toBe(42000);
        });

        it('should sum multiple FutureSS sources', () => {
            const incomes: AnyIncome[] = [
                new FutureSocialSecurityIncome('ss1', 'My SS', 67, 2000, 2025, fullYearStart),
                new FutureSocialSecurityIncome('ss2', 'Spouse SS', 67, 1500, 2025, fullYearStart)
            ];
            const benefits = getSocialSecurityBenefits(incomes, year);
            // (2000 + 1500) * 12 = 42000
            expect(benefits).toBe(42000);
        });
    });

    describe('Non-SS income types should be ignored', () => {
        it('should ignore WorkIncome', () => {
            const incomes: AnyIncome[] = [
                new CurrentSocialSecurityIncome('ss1', 'SS', 24000, 'Annually', fullYearStart),
                new WorkIncome('w1', 'Salary', 80000, 'Annually', 'Yes', 0, 0, 0, 0, 'acc1', null)
            ];
            const benefits = getSocialSecurityBenefits(incomes, year);
            expect(benefits).toBe(24000);
        });

        it('should ignore PassiveIncome', () => {
            const incomes: AnyIncome[] = [
                new CurrentSocialSecurityIncome('ss1', 'SS', 24000, 'Annually', fullYearStart),
                new PassiveIncome('p1', 'Dividends', 5000, 'Annually', 'No', 'Dividend')
            ];
            const benefits = getSocialSecurityBenefits(incomes, year);
            expect(benefits).toBe(24000);
        });
    });

    describe('Empty income array', () => {
        it('should return 0 for empty array', () => {
            const benefits = getSocialSecurityBenefits([], year);
            expect(benefits).toBe(0);
        });
    });

    describe('SS income with proration (partial year)', () => {
        it('should prorate SS starting mid-year', () => {
            // SS starting July 1 (month index 6, 6 months active: Jul-Dec)
            const income = new CurrentSocialSecurityIncome(
                'ss1', 'SS', 24000, 'Annually',
                new Date(2026, 6, 1)  // July 1, 2026 (month is 0-indexed)
            );
            const benefits = getSocialSecurityBenefits([income], year);
            // 6 months active (Jul-Dec) = 6/12 = 50%
            expect(benefits).toBe(12000);
        });

        it('should prorate FutureSS starting mid-year', () => {
            const income = new FutureSocialSecurityIncome(
                'ss1', 'Future SS', 67, 2000, 2025,
                new Date(2026, 6, 1)  // July 1, 2026 (month is 0-indexed)
            );
            const benefits = getSocialSecurityBenefits([income], year);
            // 6 months active (Jul-Dec): 24000 * 6/12 = 12000
            expect(benefits).toBe(12000);
        });
    });
});

// =============================================================================
// Integration: Year parameter passed correctly to getProratedAnnual
// =============================================================================

describe('Year parameter validation', () => {
    it('should use correct year for income proration', () => {
        const income = new WorkIncome(
            'w1', 'Salary', 100000, 'Annually', 'Yes',
            0, 0, 0, 0, 'acc1', null,
            'FIXED',
            new Date(2025, 0, 1),  // Jan 1, 2025
            new Date(2027, 11, 31) // Dec 31, 2027
        );

        // 2025: full year (started Jan 1)
        const gross2025 = getGrossIncome([income], 2025);
        expect(gross2025).toBe(100000);

        // 2026: full year
        const gross2026 = getGrossIncome([income], 2026);
        expect(gross2026).toBe(100000);

        // 2028: after end date, should be 0
        const gross2028 = getGrossIncome([income], 2028);
        expect(gross2028).toBe(0);
    });

    it('should handle year before income starts', () => {
        const income = new WorkIncome(
            'w1', 'Salary', 100000, 'Annually', 'Yes',
            0, 0, 0, 0, 'acc1', null,
            'FIXED',
            new Date(2027, 0, 1)  // Jan 1, 2027
        );

        // 2026: before start date, should be 0
        const gross2026 = getGrossIncome([income], 2026);
        expect(gross2026).toBe(0);

        // 2027: income starts, should be full amount
        const gross2027 = getGrossIncome([income], 2027);
        expect(gross2027).toBe(100000);
    });
});

// =============================================================================
// Part 6: getIncomeThresholdForRate
// =============================================================================

describe('getIncomeThresholdForRate', () => {
    // 2026 Single brackets:
    // 10%: 0, 12%: 12400, 22%: 50400, 24%: 105700, 32%: 201775, 35%: 256225, 37%: 640600

    // 2026 MFJ brackets:
    // 10%: 0, 12%: 24800, 22%: 100800, 24%: 211400, 32%: 403550, 35%: 512450, 37%: 768700

    const fed2026SingleBrackets = {
        brackets: [
            { threshold: 0, rate: 0.10 },
            { threshold: 12400, rate: 0.12 },
            { threshold: 50400, rate: 0.22 },
            { threshold: 105700, rate: 0.24 },
            { threshold: 201775, rate: 0.32 },
            { threshold: 256225, rate: 0.35 },
            { threshold: 640600, rate: 0.37 }
        ]
    };

    const fed2026MFJBrackets = {
        brackets: [
            { threshold: 0, rate: 0.10 },
            { threshold: 24800, rate: 0.12 },
            { threshold: 100800, rate: 0.22 },
            { threshold: 211400, rate: 0.24 },
            { threshold: 403550, rate: 0.32 },
            { threshold: 512450, rate: 0.35 },
            { threshold: 768700, rate: 0.37 }
        ]
    };

    describe('Test Group 1: Exact bracket rate matches', () => {
        it('should return 0 for target 10%', () => {
            expect(getIncomeThresholdForRate(0.10, fed2026SingleBrackets)).toBe(0);
        });

        it('should return 12400 for target 12%', () => {
            expect(getIncomeThresholdForRate(0.12, fed2026SingleBrackets)).toBe(12400);
        });

        it('should return 50400 for target 22%', () => {
            expect(getIncomeThresholdForRate(0.22, fed2026SingleBrackets)).toBe(50400);
        });

        it('should return 105700 for target 24%', () => {
            expect(getIncomeThresholdForRate(0.24, fed2026SingleBrackets)).toBe(105700);
        });

        it('should return 201775 for target 32%', () => {
            expect(getIncomeThresholdForRate(0.32, fed2026SingleBrackets)).toBe(201775);
        });

        it('should return 256225 for target 35%', () => {
            expect(getIncomeThresholdForRate(0.35, fed2026SingleBrackets)).toBe(256225);
        });

        it('should return 640600 for target 37%', () => {
            expect(getIncomeThresholdForRate(0.37, fed2026SingleBrackets)).toBe(640600);
        });
    });

    describe('Test Group 2: Non-exact rates (finds first bracket >= target)', () => {
        it('should return 0 for target 5% (10% >= 5%)', () => {
            expect(getIncomeThresholdForRate(0.05, fed2026SingleBrackets)).toBe(0);
        });

        it('should return 12400 for target 11% (12% >= 11%)', () => {
            expect(getIncomeThresholdForRate(0.11, fed2026SingleBrackets)).toBe(12400);
        });

        it('should return 50400 for target 15% (22% >= 15%)', () => {
            expect(getIncomeThresholdForRate(0.15, fed2026SingleBrackets)).toBe(50400);
        });

        it('should return 105700 for target 23% (24% >= 23%)', () => {
            expect(getIncomeThresholdForRate(0.23, fed2026SingleBrackets)).toBe(105700);
        });

        it('should return 256225 for target 33% (35% >= 33%)', () => {
            expect(getIncomeThresholdForRate(0.33, fed2026SingleBrackets)).toBe(256225);
        });

        it('should return 640600 for target 36% (37% >= 36%)', () => {
            expect(getIncomeThresholdForRate(0.36, fed2026SingleBrackets)).toBe(640600);
        });
    });

    describe('Test Group 3: Rate exceeds all brackets', () => {
        it('should return Infinity for target 40%', () => {
            expect(getIncomeThresholdForRate(0.40, fed2026SingleBrackets)).toBe(Infinity);
        });

        it('should return Infinity for target 50%', () => {
            expect(getIncomeThresholdForRate(0.50, fed2026SingleBrackets)).toBe(Infinity);
        });

        it('should return Infinity for target 100%', () => {
            expect(getIncomeThresholdForRate(1.00, fed2026SingleBrackets)).toBe(Infinity);
        });
    });

    describe('Test Group 4: Edge cases', () => {
        it('should return 0 for target 0%', () => {
            expect(getIncomeThresholdForRate(0.00, fed2026SingleBrackets)).toBe(0);
        });

        it('should return 0 for negative target rate', () => {
            expect(getIncomeThresholdForRate(-0.10, fed2026SingleBrackets)).toBe(0);
        });
    });

    describe('Test Group 5: MFJ brackets (different thresholds)', () => {
        it('should return 24800 for target 12% (MFJ)', () => {
            expect(getIncomeThresholdForRate(0.12, fed2026MFJBrackets)).toBe(24800);
        });

        it('should return 100800 for target 22% (MFJ)', () => {
            expect(getIncomeThresholdForRate(0.22, fed2026MFJBrackets)).toBe(100800);
        });
    });
});

// =============================================================================
// Part 7: getMedianRetirementTaxRate
// =============================================================================

describe('getMedianRetirementTaxRate', () => {
    const FALLBACK_RETIREMENT_TAX_RATE = 0.22;

    // Helper to create minimal SimulationYear for testing
    const createMockSimYear = (
        year: number,
        fed: number,
        state: number,
        fica: number,
        totalIncome: number,
        rothConversionTaxCost?: number
    ): SimulationYear => ({
        year,
        incomes: [],
        expenses: [],
        accounts: [],
        cashflow: {
            totalIncome,
            totalExpense: 0,
            livingExpenses: 0,
            discretionary: 0,
            investedUser: 0,
            investedMatch: 0,
            totalInvested: 0,
            bucketAllocations: 0,
            bucketDetail: {},
            withdrawals: 0,
            withdrawalDetail: {}
        },
        taxDetails: {
            fed,
            state,
            fica,
            preTax: 0,
            insurance: 0,
            postTax: 0,
            capitalGains: 0,
            niit: 0
        },
        logs: [],
        ...(rothConversionTaxCost !== undefined && {
            rothConversion: {
                amount: 0,
                taxCost: rothConversionTaxCost,
                taxAfter: 0,
                fromAccounts: {},
                toAccounts: {},
                fromAccountIds: {},
                toAccountIds: {}
            }
        })
    });

    // Helper to create year with specific effective rate
    const createYearWithRate = (year: number, rate: number, income: number = 100000): SimulationYear => {
        const totalTax = rate * income;
        return createMockSimYear(year, totalTax, 0, 0, income);
    };

    describe('Test Group 1: Empty/No Retirement Years', () => {
        it('should return fallback rate for empty simulation', () => {
            const result = getMedianRetirementTaxRate([], 2030);
            expect(result).toBe(FALLBACK_RETIREMENT_TAX_RATE);
        });

        it('should return fallback rate when no years match retirement year', () => {
            const simulation = [
                createMockSimYear(2020, 5000, 1000, 500, 50000),
                createMockSimYear(2021, 5000, 1000, 500, 50000),
                createMockSimYear(2022, 5000, 1000, 500, 50000)
            ];
            const result = getMedianRetirementTaxRate(simulation, 2030);
            expect(result).toBe(FALLBACK_RETIREMENT_TAX_RATE);
        });
    });

    describe('Test Group 2: Single Retirement Year (Odd Count)', () => {
        it('should return 0.12 for fed=10000, state=2000, fica=0, income=100000', () => {
            const simulation = [createMockSimYear(2030, 10000, 2000, 0, 100000)];
            const result = getMedianRetirementTaxRate(simulation, 2030);
            // (10000 + 2000 + 0) / 100000 = 0.12
            expect(result).toBeCloseTo(0.12, 2);
        });

        it('should return 0.13 for fed=5000, state=1000, fica=500, income=50000', () => {
            const simulation = [createMockSimYear(2030, 5000, 1000, 500, 50000)];
            const result = getMedianRetirementTaxRate(simulation, 2030);
            // (5000 + 1000 + 500) / 50000 = 0.13
            expect(result).toBeCloseTo(0.13, 2);
        });
    });

    describe('Test Group 3: Two Retirement Years (Even Count - Average)', () => {
        it('should return 0.15 for rates [0.10, 0.20]', () => {
            const simulation = [
                createYearWithRate(2030, 0.10),
                createYearWithRate(2031, 0.20)
            ];
            const result = getMedianRetirementTaxRate(simulation, 2030);
            // Average of 0.10 and 0.20 = 0.15
            expect(result).toBeCloseTo(0.15, 2);
        });

        it('should return 0.15 for rates [0.12, 0.18]', () => {
            const simulation = [
                createYearWithRate(2030, 0.12),
                createYearWithRate(2031, 0.18)
            ];
            const result = getMedianRetirementTaxRate(simulation, 2030);
            // Average of 0.12 and 0.18 = 0.15
            expect(result).toBeCloseTo(0.15, 2);
        });
    });

    describe('Test Group 4: Multiple Retirement Years (Median Selection)', () => {
        it('should return 0.15 for rates [0.10, 0.15, 0.20]', () => {
            const simulation = [
                createYearWithRate(2030, 0.10),
                createYearWithRate(2031, 0.15),
                createYearWithRate(2032, 0.20)
            ];
            const result = getMedianRetirementTaxRate(simulation, 2030);
            expect(result).toBeCloseTo(0.15, 2);
        });

        it('should return 0.15 for rates [0.05, 0.10, 0.15, 0.20, 0.25]', () => {
            const simulation = [
                createYearWithRate(2030, 0.05),
                createYearWithRate(2031, 0.10),
                createYearWithRate(2032, 0.15),
                createYearWithRate(2033, 0.20),
                createYearWithRate(2034, 0.25)
            ];
            const result = getMedianRetirementTaxRate(simulation, 2030);
            expect(result).toBeCloseTo(0.15, 2);
        });

        it('should sort and return 0.15 for unsorted rates [0.25, 0.10, 0.05, 0.20, 0.15]', () => {
            const simulation = [
                createYearWithRate(2030, 0.25),
                createYearWithRate(2031, 0.10),
                createYearWithRate(2032, 0.05),
                createYearWithRate(2033, 0.20),
                createYearWithRate(2034, 0.15)
            ];
            const result = getMedianRetirementTaxRate(simulation, 2030);
            // Sorted: [0.05, 0.10, 0.15, 0.20, 0.25] -> median = 0.15
            expect(result).toBeCloseTo(0.15, 2);
        });
    });

    describe('Test Group 5: Roth Conversion Exclusion', () => {
        it('should exclude Roth conversion tax from calculation', () => {
            // fed=15000, state=2000, fica=0, income=100000, rothConversion.taxCost=5000
            // baseTax = 15000 + 2000 + 0 - 5000 = 12000
            // rate = 12000 / 100000 = 0.12
            const simulation = [createMockSimYear(2030, 15000, 2000, 0, 100000, 5000)];
            const result = getMedianRetirementTaxRate(simulation, 2030);
            expect(result).toBeCloseTo(0.12, 2);
        });

        it('should NOT be 0.17 when conversion tax is excluded', () => {
            // Without exclusion would be (15000 + 2000) / 100000 = 0.17
            const simulation = [createMockSimYear(2030, 15000, 2000, 0, 100000, 5000)];
            const result = getMedianRetirementTaxRate(simulation, 2030);
            expect(result).not.toBeCloseTo(0.17, 2);
        });
    });

    describe('Test Group 6: Zero Income Year', () => {
        it('should return 0 effective rate for zero income year', () => {
            const simulation = [createMockSimYear(2030, 0, 0, 0, 0)];
            const result = getMedianRetirementTaxRate(simulation, 2030);
            expect(result).toBe(0);
        });
    });

    describe('Test Group 7: Negative Base Tax (After Conversion Exclusion)', () => {
        it('should return 0 effective rate when base tax is negative', () => {
            // fed=5000, state=1000, fica=0, income=50000, rothConversion.taxCost=10000
            // baseTax = 5000 + 1000 + 0 - 10000 = -4000
            // Math.max(0, -4000) = 0
            // rate = 0 / 50000 = 0
            const simulation = [createMockSimYear(2030, 5000, 1000, 0, 50000, 10000)];
            const result = getMedianRetirementTaxRate(simulation, 2030);
            expect(result).toBe(0);
        });
    });

    describe('Test Group 8: Mixed Pre-Retirement and Retirement Years', () => {
        it('should only use years >= retirementYear for median', () => {
            // Pre-retirement years (should be ignored)
            const preRetirement = [
                createYearWithRate(2025, 0.30),  // High rate, should be ignored
                createYearWithRate(2026, 0.28),
                createYearWithRate(2027, 0.25)
            ];
            // Retirement years (should be used)
            const retirement = [
                createYearWithRate(2028, 0.10),
                createYearWithRate(2029, 0.12),
                createYearWithRate(2030, 0.14)
            ];
            const simulation = [...preRetirement, ...retirement];
            const result = getMedianRetirementTaxRate(simulation, 2028);
            // Only [0.10, 0.12, 0.14] used -> median = 0.12
            expect(result).toBeCloseTo(0.12, 2);
        });
    });

    describe('Test Group 9: Verify FICA Included', () => {
        it('should include FICA in tax calculation', () => {
            // fed=8000, state=2000, fica=1000, income=100000
            // rate = (8000 + 2000 + 1000) / 100000 = 0.11
            const simulation = [createMockSimYear(2030, 8000, 2000, 1000, 100000)];
            const result = getMedianRetirementTaxRate(simulation, 2030);
            expect(result).toBeCloseTo(0.11, 2);
        });
    });
});
