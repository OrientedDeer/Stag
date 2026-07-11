import { describe, it, expect } from 'vitest';
import {
    calculateTotalFederalTax,
    type TotalFederalTaxResult,
} from '../../components/Objects/Taxes/TaxService';
import { type TaxParameters, type FilingStatus } from '../../data/TaxData';

/**
 * Comprehensive tests for calculateTotalFederalTax function.
 *
 * Tests cover:
 * - Social Security taxability (provisional income calculation)
 * - STCG taxed as ordinary income
 * - LTCG stacking on top of ordinary income
 * - NIIT (3.8% on investment income above threshold)
 * - Standard deduction application
 * - Filing status variations
 */

// =============================================================================
// Test Parameters (2026 Tax Year)
// =============================================================================

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
        { threshold: 768700, rate: 0.37 }
    ],
    capitalGainsBrackets: [
        { threshold: 0, rate: 0.00 },
        { threshold: 99400, rate: 0.15 },
        { threshold: 616400, rate: 0.20 }
    ],
    socialSecurityTaxRate: 0.062,
    socialSecurityWageBase: 176100,
    medicareTaxRate: 0.0145
};

// Helper to call the function with defaults for simpler tests
function calcTax(
    ordinaryIncome: number,
    ss: number = 0,
    stcg: number = 0,
    ltcg: number = 0,
    preTaxDeductions: number = 0,
    filingStatus: FilingStatus = 'Single',
    params: TaxParameters = fedParams2026Single
): TotalFederalTaxResult {
    return calculateTotalFederalTax(
        ordinaryIncome,
        ss,
        stcg,
        ltcg,
        preTaxDeductions,
        filingStatus,
        params
    );
}

// Helper to validate return value invariants (Test Group 16)
function validateResult(result: TotalFederalTaxResult, ssBenefits: number): void {
    // totalTax === ordinaryTax + ltcgTax + niitTax
    expect(result.totalTax).toBeCloseTo(result.ordinaryTax + result.ltcgTax + result.niitTax, 2);

    // taxableSS >= 0
    expect(result.taxableSS).toBeGreaterThanOrEqual(0);

    // taxableSS <= 0.85 × socialSecurityBenefits
    expect(result.taxableSS).toBeLessThanOrEqual(ssBenefits * 0.85 + 0.01);

    // All tax components >= 0
    expect(result.ordinaryTax).toBeGreaterThanOrEqual(0);
    expect(result.ltcgTax).toBeGreaterThanOrEqual(0);
    expect(result.niitTax).toBeGreaterThanOrEqual(0);
    expect(result.totalTax).toBeGreaterThanOrEqual(0);
}

// =============================================================================
// Test Group 1: Ordinary Income Only (STCG=0, LTCG=0, SS=0)
// =============================================================================

describe('Test Group 1: Ordinary Income Only', () => {
    it('all zeros returns zero tax', () => {
        const result = calcTax(0);
        expect(result.ordinaryTax).toBe(0);
        expect(result.taxableSS).toBe(0);
        expect(result.ltcgTax).toBe(0);
        expect(result.niitTax).toBe(0);
        expect(result.totalTax).toBe(0);
        validateResult(result, 0);
    });

    it('below standard deduction returns zero tax', () => {
        const result = calcTax(10000);
        expect(result.ordinaryTax).toBe(0);
        validateResult(result, 0);
    });

    it('at standard deduction exactly returns zero tax', () => {
        const result = calcTax(16100);
        expect(result.ordinaryTax).toBe(0);
        validateResult(result, 0);
    });

    it('$1 over standard deduction is $0.10', () => {
        const result = calcTax(16101);
        expect(result.ordinaryTax).toBeCloseTo(0.10, 2);
        validateResult(result, 0);
    });

    it('mid 10% bracket ($20k gross) = $390', () => {
        // Taxable = 20000 - 16100 = 3900 × 10% = 390
        const result = calcTax(20000);
        expect(result.ordinaryTax).toBeCloseTo(390, 0);
        validateResult(result, 0);
    });

    it('top of 10% bracket = $1240', () => {
        // Taxable = 28500 - 16100 = 12400 × 10% = 1240
        const result = calcTax(28500);
        expect(result.ordinaryTax).toBeCloseTo(1240, 0);
        validateResult(result, 0);
    });

    it('$1 into 12% bracket', () => {
        // Taxable = 28501 - 16100 = 12401
        // 12400 × 10% + 1 × 12% = 1240 + 0.12 = 1240.12
        const result = calcTax(28501);
        expect(result.ordinaryTax).toBeCloseTo(1240.12, 2);
        validateResult(result, 0);
    });

    it('top of 12% bracket = $5800', () => {
        // Taxable = 66500 - 16100 = 50400
        // 12400 × 10% + 38000 × 12% = 1240 + 4560 = 5800
        const result = calcTax(66500);
        expect(result.ordinaryTax).toBeCloseTo(5800, 0);
        validateResult(result, 0);
    });

    it('$1 into 22% bracket', () => {
        const result = calcTax(66501);
        expect(result.ordinaryTax).toBeCloseTo(5800.22, 2);
        validateResult(result, 0);
    });

    it('top of 22% bracket = $17966', () => {
        // Taxable = 121800 - 16100 = 105700
        // 1240 + 4560 + 55300 × 22% = 1240 + 4560 + 12166 = 17966
        const result = calcTax(121800);
        expect(result.ordinaryTax).toBeCloseTo(17966, 0);
        validateResult(result, 0);
    });

    it('$1 into 24% bracket', () => {
        const result = calcTax(121801);
        expect(result.ordinaryTax).toBeCloseTo(17966.24, 2);
        validateResult(result, 0);
    });

    it('top of 24% bracket = $41024', () => {
        // Taxable = 217875 - 16100 = 201775
        // 17966 + (201775 - 105700) × 24% = 17966 + 96075 × 24% = 17966 + 23058 = 41024
        const result = calcTax(217875);
        expect(result.ordinaryTax).toBeCloseTo(41024, 0);
        validateResult(result, 0);
    });

    it('$1 into 32% bracket', () => {
        const result = calcTax(217876);
        expect(result.ordinaryTax).toBeCloseTo(41024.32, 2);
        validateResult(result, 0);
    });

    it('top of 32% bracket = $58448', () => {
        // Taxable = 272325 - 16100 = 256225
        // 41024 + (256225 - 201775) × 32% = 41024 + 54450 × 32% = 41024 + 17424 = 58448
        const result = calcTax(272325);
        expect(result.ordinaryTax).toBeCloseTo(58448, 0);
        validateResult(result, 0);
    });

    it('$1 into 35% bracket', () => {
        const result = calcTax(272326);
        expect(result.ordinaryTax).toBeCloseTo(58448.35, 2);
        validateResult(result, 0);
    });

    it('top of 35% bracket', () => {
        // Taxable = 656700 - 16100 = 640600
        // 58448 + (640600 - 256225) × 35% = 58448 + 384375 × 35% = 58448 + 134531.25 = 192979.25
        const result = calcTax(656700);
        expect(result.ordinaryTax).toBeCloseTo(192979.25, 0);
        validateResult(result, 0);
    });

    it('$1 into 37% bracket', () => {
        const result = calcTax(656701);
        expect(result.ordinaryTax).toBeCloseTo(192979.62, 2);
        validateResult(result, 0);
    });

    it('high income $1M', () => {
        // Taxable = 1000000 - 16100 = 983900
        // 192979.25 + (983900 - 640600) × 37% = 192979.25 + 343300 × 37% = 192979.25 + 127021 = 320000.25
        const result = calcTax(1000000);
        expect(result.ordinaryTax).toBeCloseTo(320000.25, 0);
        validateResult(result, 0);
    });

    // For all tests in this group, verify other components are zero
    it('all tests have zero LTCG and NIIT', () => {
        const testCases = [0, 10000, 16100, 20000, 50000, 100000, 200000];
        for (const income of testCases) {
            const result = calcTax(income);
            expect(result.taxableSS).toBe(0);
            expect(result.ltcgTax).toBe(0);
            expect(result.niitTax).toBe(0);
            expect(result.totalTax).toBe(result.ordinaryTax);
        }
    });
});

// =============================================================================
// Test Group 2: Social Security Only (STCG=0, LTCG=0, ordinaryIncome=0)
// =============================================================================

describe('Test Group 2: Social Security Only', () => {
    // Provisional income = AGI + 50% × SS = 0 + 50% × SS

    it('SS below $25k threshold is not taxable', () => {
        // $40k SS → provisional = $20k < $25k → 0% taxable
        const result = calcTax(0, 40000);
        expect(result.taxableSS).toBe(0);
        expect(result.ordinaryTax).toBe(0);
        validateResult(result, 40000);
    });

    it('SS exactly at $25k threshold is not taxable', () => {
        // $50k SS → provisional = $25k = $25k → still 0% (< threshold)
        const result = calcTax(0, 50000);
        expect(result.taxableSS).toBe(0);
        expect(result.ordinaryTax).toBe(0);
        validateResult(result, 50000);
    });

    it('SS $1 over first threshold', () => {
        // $50002 SS → provisional = $25001 > $25k → some taxable
        // Taxable = 50% of excess = 0.5 × 1 = 0.50
        const result = calcTax(0, 50002);
        expect(result.taxableSS).toBeCloseTo(0.50, 1);
        validateResult(result, 50002);
    });

    it('SS in 50% zone ($30k provisional)', () => {
        // $60k SS → provisional = $30k
        // In 50% zone: taxable = min(50% × (30000 - 25000), 50% × 60000) = min(2500, 30000) = 2500
        const result = calcTax(0, 60000);
        expect(result.taxableSS).toBeCloseTo(2500, 0);
        validateResult(result, 60000);
    });

    it('SS exactly at $34k threshold', () => {
        // $68k SS → provisional = $34k (top of 50% zone)
        // Taxable = 50% × (34000 - 25000) = 4500
        const result = calcTax(0, 68000);
        expect(result.taxableSS).toBeCloseTo(4500, 0);
        validateResult(result, 68000);
    });

    it('SS in 85% zone ($40k provisional)', () => {
        // $80k SS → provisional = $40k > $34k
        // Tier 1 = 50% × (34000 - 25000) = 4500
        // Tier 2 = 85% × (40000 - 34000) = 5100
        // Total = 9600, capped at 85% × 80000 = 68000
        const result = calcTax(0, 80000);
        expect(result.taxableSS).toBeCloseTo(9600, 0);
        validateResult(result, 80000);
    });

    it('max SS benefit ~$55k', () => {
        // $55k SS → provisional = $27500 (in 50% zone)
        // Taxable = 50% × (27500 - 25000) = 1250
        const result = calcTax(0, 55000);
        expect(result.taxableSS).toBeCloseTo(1250, 0);
        validateResult(result, 55000);
    });

    // All tests should have zero LTCG and NIIT
    it('all SS-only tests have zero LTCG and NIIT', () => {
        const testCases = [40000, 50000, 60000, 80000];
        for (const ss of testCases) {
            const result = calcTax(0, ss);
            expect(result.ltcgTax).toBe(0);
            expect(result.niitTax).toBe(0);
        }
    });
});

// =============================================================================
// Test Group 3: SS + Ordinary Income (STCG=0, LTCG=0)
// =============================================================================

describe('Test Group 3: SS + Ordinary Income', () => {
    // Provisional income = ordinaryIncome + 50% × SS

    it('below $25k threshold', () => {
        // $10k ordinary + $20k SS → provisional = 10000 + 10000 = 20000 < 25000
        const result = calcTax(10000, 20000);
        expect(result.taxableSS).toBe(0);
        validateResult(result, 20000);
    });

    it('crosses into 50% zone', () => {
        // $15,001 ordinary + $20k SS → provisional = 15001 + 10000 = 25001
        // IRS formula: Taxable SS = min(50% × SS, 50% × (provisional - $25,000))
        // = min(50% × 20000, 50% × 1) = min(10000, 0.50) = 0.50
        const result = calcTax(15001, 20000);
        expect(result.taxableSS).toBeCloseTo(0.50, 1);
        validateResult(result, 20000);
    });

    it('deep in 50% zone', () => {
        // $20k ordinary + $20k SS → provisional = 20000 + 10000 = 30000
        // Taxable = 50% × (30000 - 25000) = 2500
        const result = calcTax(20000, 20000);
        expect(result.taxableSS).toBeCloseTo(2500, 0);
        validateResult(result, 20000);
    });

    it('crosses into 85% zone', () => {
        // $24k ordinary + $20k SS → provisional = 24000 + 10000 = 34000 → threshold of 85% zone
        const result = calcTax(24000, 20000);
        // At exactly $34k, still in 50% zone
        expect(result.taxableSS).toBeCloseTo(4500, 0);
        validateResult(result, 20000);
    });

    it('deep in 85% zone - high ordinary, low SS', () => {
        // $100k ordinary + $20k SS → provisional = 100000 + 10000 = 110000
        // Well into 85% zone, SS likely maxed at 85%
        // Tier 1: 50% × (34000 - 25000) = 4500
        // Tier 2: 85% × (110000 - 34000) = 64600
        // Total: 69100, capped at 85% × 20000 = 17000
        const result = calcTax(100000, 20000);
        expect(result.taxableSS).toBeCloseTo(17000, 0);
        validateResult(result, 20000);
    });

    it('high ordinary pushes all SS to 85% taxable', () => {
        // $40k ordinary + $30k SS → provisional = 40000 + 15000 = 55000
        // Tier 1: 50% × 9000 = 4500
        // Tier 2: 85% × 21000 = 17850
        // Total: 22350, capped at 85% × 30000 = 25500
        const result = calcTax(40000, 30000);
        expect(result.taxableSS).toBeCloseTo(22350, 0);
        validateResult(result, 30000);
    });

    it('SS torpedo: tax includes taxable SS', () => {
        // Verify ordinaryTax includes tax on taxableSS, not just ordinaryIncome
        const resultWithSS = calcTax(50000, 30000);
        const resultWithoutSS = calcTax(50000, 0);

        // With SS, there should be additional tax from the taxable SS portion
        expect(resultWithSS.ordinaryTax).toBeGreaterThan(resultWithoutSS.ordinaryTax);
    });
});

// =============================================================================
// Test Group 4: LTCG Only (STCG=0, SS=0, ordinaryIncome=0)
// =============================================================================

describe('Test Group 4: LTCG Only', () => {
    // With no ordinary income, the FULL standard deduction ($16,100) is unused and offsets
    // LTCG. IRS rule: the 0%/15%/20% brackets are measured against total taxable income
    // (LTCG minus the unused standard deduction here), so taxable LTCG = ltcg - 16100.

    it('LTCG below 0% threshold is tax-free', () => {
        // 40000 - 16100 = 23900 taxable, all at 0% rate
        const result = calcTax(0, 0, 0, 40000);
        expect(result.ltcgTax).toBe(0);
        expect(result.ordinaryTax).toBe(0);
        validateResult(result, 0);
    });

    it('LTCG exactly at $49700 threshold is tax-free', () => {
        // 49700 - 16100 = 33600 taxable < 49700 → all at 0%
        const result = calcTax(0, 0, 0, 49700);
        expect(result.ltcgTax).toBe(0);
        validateResult(result, 0);
    });

    it('LTCG below unused-deduction-adjusted threshold is tax-free', () => {
        // Unused std deduction offsets LTCG: 49701 - 16100 = 33601 taxable < 49700 → $0.
        // (Pre-fix this floored taxableOrdinary at 0 and taxed $1 @ 15% = $0.15.)
        const result = calcTax(0, 0, 0, 49701);
        expect(result.ltcgTax).toBe(0);
        validateResult(result, 0);
    });

    it('LTCG $10k over nominal threshold still tax-free after deduction', () => {
        // 59700 - 16100 = 43600 taxable < 49700 → $0.
        // (Pre-fix taxed $10000 @ 15% = $1500.)
        const result = calcTax(0, 0, 0, 59700);
        expect(result.ltcgTax).toBe(0);
        validateResult(result, 0);
    });

    it('LTCG into 20% bracket', () => {
        // Taxable LTCG = 600000 - 16100 = 583900.
        // $49700 at 0%, (548200-49700)=498500 at 15%, (583900-548200)=35700 at 20%.
        // Tax = 0 + 498500 × 0.15 + 35700 × 0.20 = 74775 + 7140 = 81915.
        // (Pre-fix ignored the unused deduction and returned 85135.)
        const result = calcTax(0, 0, 0, 600000);
        expect(result.ltcgTax).toBeCloseTo(81915, 0);
        validateResult(result, 0);
    });

    it('all LTCG tests have zero taxableSS and no NIIT below threshold', () => {
        const testCases = [40000, 49700, 59700];
        for (const ltcg of testCases) {
            const result = calcTax(0, 0, 0, ltcg);
            expect(result.taxableSS).toBe(0);
            expect(result.niitTax).toBe(0); // Below $200k threshold
        }
    });
});

// =============================================================================
// Test Group 5: LTCG + Ordinary Income (STCG=0, SS=0)
// =============================================================================

describe('Test Group 5: LTCG + Ordinary Income', () => {
    // LTCG rate based on where ordinary taxable income ends, LTCG stacks on top

    it('ordinary below threshold, LTCG at 0%', () => {
        // $30k ordinary → taxable = 30000 - 16100 = 13900
        // $20k LTCG stacks: 13900 + 20000 = 33900 < 49700 → all at 0%
        const result = calcTax(30000, 0, 0, 20000);
        expect(result.ltcgTax).toBe(0);
        validateResult(result, 0);
    });

    it('ordinary at threshold edge, LTCG starts at 0%', () => {
        // $65800 ordinary → taxable = 65800 - 16100 = 49700
        // $10k LTCG stacks: 49700 + 10000 = 59700
        // First $0 at 0%, all $10k at 15%
        const result = calcTax(65800, 0, 0, 10000);
        expect(result.ltcgTax).toBeCloseTo(1500, 0);
        validateResult(result, 0);
    });

    it('ordinary pushes LTCG to 15%', () => {
        // $70k ordinary → taxable = 70000 - 16100 = 53900 > 49700
        // $20k LTCG all at 15%
        const result = calcTax(70000, 0, 0, 20000);
        expect(result.ltcgTax).toBeCloseTo(3000, 0);
        validateResult(result, 0);
    });

    it('LTCG stacking partial 0%/15%', () => {
        // $56100 ordinary → taxable = 56100 - 16100 = 40000
        // $20k LTCG: first 9700 at 0% (to reach 49700), remaining 10300 at 15%
        // Tax = 0 + 10300 × 0.15 = 1545
        const result = calcTax(56100, 0, 0, 20000);
        expect(result.ltcgTax).toBeCloseTo(1545, 0);
        validateResult(result, 0);
    });

    it('high ordinary, all LTCG at 15%', () => {
        // $150k ordinary → taxable well above 49700
        // All $50k LTCG at 15%
        const result = calcTax(150000, 0, 0, 50000);
        expect(result.ltcgTax).toBeCloseTo(7500, 0);
        validateResult(result, 0);
    });

    it('into 20% LTCG bracket', () => {
        // $600k ordinary → taxable = 600000 - 16100 = 583900
        // $100k LTCG: some at 15%, some at 20%
        // 548200 threshold: 583900 > 548200, so all LTCG is past 15% zone start
        // 583900 + 100000 = 683900
        // At 583900, we're 35700 into 20% bracket (583900 - 548200)
        // All $100k LTCG at 20%
        const result = calcTax(600000, 0, 0, 100000);
        expect(result.ltcgTax).toBeCloseTo(20000, 0);
        validateResult(result, 0);
    });
});

// =============================================================================
// Test Group 6: Short-Term Capital Gains (SS=0, LTCG=0)
// =============================================================================

describe('Test Group 6: Short-Term Capital Gains', () => {
    // STCG taxed as ordinary income

    it('STCG only in 10% bracket', () => {
        // $20k STCG → same as $20k ordinary income
        // Taxable = 20000 - 16100 = 3900 × 10% = 390
        const result = calcTax(0, 0, 20000, 0);
        expect(result.ordinaryTax).toBeCloseTo(390, 0);
        expect(result.ltcgTax).toBe(0);
        validateResult(result, 0);
    });

    it('STCG only spans brackets', () => {
        // $50k STCG → same as $50k ordinary
        // Taxable = 50000 - 16100 = 33900
        // 12400 × 10% + 21500 × 12% = 1240 + 2580 = 3820
        const result = calcTax(0, 0, 50000, 0);
        expect(result.ordinaryTax).toBeCloseTo(3820, 0);
        validateResult(result, 0);
    });

    it('ordinary + STCG combined', () => {
        // $30k ordinary + $20k STCG → combined $50k treated as ordinary
        const result = calcTax(30000, 0, 20000, 0);
        expect(result.ordinaryTax).toBeCloseTo(3820, 0);
        validateResult(result, 0);
    });

    it('STCG pushes into higher bracket', () => {
        // $60k ordinary + $20k STCG → $80k total
        // Taxable = 80000 - 16100 = 63900
        // 12400 × 10% + 38000 × 12% + 13500 × 22%
        // = 1240 + 4560 + 2970 = 8770
        const result = calcTax(60000, 0, 20000, 0);
        expect(result.ordinaryTax).toBeCloseTo(8770, 0);
        validateResult(result, 0);
    });

    it('STCG is included in ordinaryTax, not ltcgTax', () => {
        const result = calcTax(0, 0, 50000, 0);
        expect(result.ordinaryTax).toBeGreaterThan(0);
        expect(result.ltcgTax).toBe(0);
    });
});

// =============================================================================
// Test Group 7: STCG vs LTCG Comparison
// =============================================================================

describe('Test Group 7: STCG vs LTCG Comparison', () => {
    it('$50k STCG only = $3820', () => {
        const result = calcTax(0, 0, 50000, 0);
        expect(result.ordinaryTax).toBeCloseTo(3820, 0);
        expect(result.ltcgTax).toBe(0);
        expect(result.totalTax).toBeCloseTo(3820, 0);
    });

    it('$50k LTCG only = $0 after unused standard deduction', () => {
        // With $0 ordinary income the full $16,100 std deduction is unused and offsets LTCG:
        // taxable LTCG = 50000 - 16100 = 33900 < 49700 → all at the 0% rate → $0.
        // (Pre-fix the unused deduction was dropped: $49700 @ 0% + $300 @ 15% = $45.)
        const result = calcTax(0, 0, 0, 50000);
        expect(result.ordinaryTax).toBe(0);
        expect(result.ltcgTax).toBe(0);
        expect(result.totalTax).toBe(0);
    });

    it('same amount STCG costs more than LTCG', () => {
        const stcgResult = calcTax(0, 0, 50000, 0);
        const ltcgResult = calcTax(0, 0, 0, 50000);

        expect(stcgResult.totalTax).toBeGreaterThan(ltcgResult.totalTax);
        // STCG ($50k) is taxed as ordinary: 50000 - 16100 = 33900 taxable → $3,820.
        // LTCG ($50k) gets the unused std deduction: 50000 - 16100 = 33900 taxable LTCG
        // < 49700 → all at the 0% rate → $0. (Pre-fix the unused deduction was dropped
        // and LTCG was taxed $300 @ 15% = $45.)
        expect(stcgResult.totalTax).toBeCloseTo(3820, 0);
        expect(ltcgResult.totalTax).toBe(0);
    });

    it('at higher income, STCG still costs more', () => {
        const stcgResult = calcTax(100000, 0, 50000, 0);
        const ltcgResult = calcTax(100000, 0, 0, 50000);

        // Both have same ordinary tax from the $100k, but STCG adds to ordinary
        // while LTCG is taxed at preferential rates
        expect(stcgResult.totalTax).toBeGreaterThan(ltcgResult.totalTax);
    });
});

// =============================================================================
// Test Group 8: NIIT - Below Threshold (Single $200k)
// =============================================================================

describe('Test Group 8: NIIT Below Threshold', () => {
    it('well below threshold - no NIIT', () => {
        // MAGI = $100k + $20k LTCG = $120k < $200k
        const result = calcTax(100000, 0, 0, 20000);
        expect(result.niitTax).toBe(0);
        validateResult(result, 0);
    });

    it('just below threshold - no NIIT', () => {
        // MAGI = $180k + $19k LTCG = $199k < $200k
        const result = calcTax(180000, 0, 0, 19000);
        expect(result.niitTax).toBe(0);
        validateResult(result, 0);
    });

    it('at threshold exactly - no NIIT', () => {
        // MAGI = $180k + $20k LTCG = $200k = $200k (not exceeding)
        const result = calcTax(180000, 0, 0, 20000);
        expect(result.niitTax).toBe(0);
        validateResult(result, 0);
    });
});

// =============================================================================
// Test Group 9: NIIT - Above Threshold (Single $200k)
// =============================================================================

describe('Test Group 9: NIIT Above Threshold', () => {
    // NIIT = 3.8% × min(net investment income, MAGI - $200k)

    it('$1 over threshold', () => {
        // MAGI = 180001 + 20000 = 200001, excess = 1
        // Net inv income = 20000
        // NIIT = 3.8% × min(20000, 1) = 3.8% × 1 = 0.038
        const result = calcTax(180001, 0, 0, 20000);
        expect(result.niitTax).toBeCloseTo(0.038, 3);
        validateResult(result, 0);
    });

    it('$10k over, LTCG only', () => {
        // MAGI = 190000 + 20000 = 210000, excess = 10000
        // Net inv income = 20000
        // NIIT = 3.8% × min(20000, 10000) = 3.8% × 10000 = 380
        const result = calcTax(190000, 0, 0, 20000);
        expect(result.niitTax).toBeCloseTo(380, 0);
        validateResult(result, 0);
    });

    it('$50k over, investment income < excess', () => {
        // MAGI = 200000 + 30000 = 230000, excess = 30000
        // Net inv income = 30000
        // NIIT = 3.8% × min(30000, 30000) = 3.8% × 30000 = 1140
        const result = calcTax(200000, 0, 0, 30000);
        expect(result.niitTax).toBeCloseTo(1140, 0);
        validateResult(result, 0);
    });

    it('$100k over, investment income = excess', () => {
        // MAGI = 200000 + 100000 = 300000, excess = 100000
        // Net inv income = 100000
        // NIIT = 3.8% × min(100000, 100000) = 3.8% × 100000 = 3800
        const result = calcTax(200000, 0, 0, 100000);
        expect(result.niitTax).toBeCloseTo(3800, 0);
        validateResult(result, 0);
    });

    it('high income', () => {
        // MAGI = 400000 + 200000 = 600000, excess = 400000
        // Net inv income = 200000
        // NIIT = 3.8% × min(200000, 400000) = 3.8% × 200000 = 7600
        const result = calcTax(400000, 0, 0, 200000);
        expect(result.niitTax).toBeCloseTo(7600, 0);
        validateResult(result, 0);
    });
});

// =============================================================================
// Test Group 10: NIIT - STCG Counts as Investment Income
// =============================================================================

describe('Test Group 10: NIIT with STCG', () => {
    it('STCG only over threshold', () => {
        // MAGI = 190000 + 20000 STCG = 210000, excess = 10000
        // Net inv income = 20000 (STCG counts!)
        // NIIT = 3.8% × min(20000, 10000) = 380
        const result = calcTax(190000, 0, 20000, 0);
        expect(result.niitTax).toBeCloseTo(380, 0);
        validateResult(result, 0);
    });

    it('STCG + LTCG combined', () => {
        // MAGI = 190000 + 10000 + 10000 = 210000, excess = 10000
        // Net inv income = 10000 + 10000 = 20000
        // NIIT = 3.8% × min(20000, 10000) = 380
        const result = calcTax(190000, 0, 10000, 10000);
        expect(result.niitTax).toBeCloseTo(380, 0);
        validateResult(result, 0);
    });

    it('high STCG', () => {
        // MAGI = 250000 + 100000 + 50000 = 400000, excess = 200000
        // Net inv income = 100000 + 50000 = 150000
        // NIIT = 3.8% × min(150000, 200000) = 3.8% × 150000 = 5700
        const result = calcTax(250000, 0, 100000, 50000);
        expect(result.niitTax).toBeCloseTo(5700, 0);
        validateResult(result, 0);
    });
});

// =============================================================================
// Test Group 11: NIIT - MFJ Threshold ($250k)
// =============================================================================

describe('Test Group 11: NIIT MFJ Threshold', () => {
    it('below MFJ threshold - no NIIT', () => {
        // MAGI = 200000 + 40000 = 240000 < 250000
        const result = calcTax(200000, 0, 0, 40000, 0, 'Married Filing Jointly', fedParams2026MFJ);
        expect(result.niitTax).toBe(0);
        validateResult(result, 0);
    });

    it('above MFJ threshold', () => {
        // MAGI = 230000 + 40000 = 270000, excess = 20000
        // Net inv income = 40000
        // NIIT = 3.8% × min(40000, 20000) = 3.8% × 20000 = 760
        const result = calcTax(230000, 0, 0, 40000, 0, 'Married Filing Jointly', fedParams2026MFJ);
        expect(result.niitTax).toBeCloseTo(760, 0);
        validateResult(result, 0);
    });

    it('same income, Single pays more NIIT than MFJ', () => {
        // Single: MAGI = 270000, threshold = 200000, excess = 70000
        // MFJ: MAGI = 270000, threshold = 250000, excess = 20000
        const singleResult = calcTax(230000, 0, 0, 40000, 0, 'Single', fedParams2026Single);
        const mfjResult = calcTax(230000, 0, 0, 40000, 0, 'Married Filing Jointly', fedParams2026MFJ);

        expect(singleResult.niitTax).toBeGreaterThan(mfjResult.niitTax);
    });
});

// =============================================================================
// Test Group 12: All Components Combined
// =============================================================================

describe('Test Group 12: All Components Combined', () => {
    it('low all, no effects', () => {
        // Below all thresholds
        const result = calcTax(20000, 20000, 5000, 10000);
        // Provisional = 20000 + 5000 + 10000 + 10000 = 45000 > 34000, SS taxable
        // But with low income, effects are minimal
        expect(result.taxableSS).toBeGreaterThan(0);
        expect(result.ltcgTax).toBe(0); // Low ordinary income, LTCG at 0%
        expect(result.niitTax).toBe(0); // Below $200k
        validateResult(result, 20000);
    });

    it('SS torpedo only', () => {
        // $30k ordinary + $30k SS, no capital gains
        const result = calcTax(30000, 30000, 0, 0);
        expect(result.taxableSS).toBeGreaterThan(0);
        expect(result.ltcgTax).toBe(0);
        expect(result.niitTax).toBe(0);
        validateResult(result, 30000);
    });

    it('LTCG bump only', () => {
        // $60k ordinary (pushes LTCG to 15%), no SS
        const result = calcTax(60000, 0, 0, 30000);
        // Taxable ordinary = 60000 - 16100 = 43900
        // LTCG: $5800 at 0% (to 49700), $24200 at 15%
        expect(result.ltcgTax).toBeGreaterThan(0);
        expect(result.niitTax).toBe(0);
        validateResult(result, 0);
    });

    it('NIIT only', () => {
        // $250k ordinary + $50k LTCG, over NIIT threshold
        const result = calcTax(250000, 0, 0, 50000);
        expect(result.taxableSS).toBe(0);
        expect(result.niitTax).toBeGreaterThan(0);
        validateResult(result, 0);
    });

    it('SS torpedo + LTCG bump', () => {
        // $50k ordinary + $30k SS + $30k LTCG
        const result = calcTax(50000, 30000, 0, 30000);
        expect(result.taxableSS).toBeGreaterThan(0);
        expect(result.ltcgTax).toBeGreaterThan(0);
        expect(result.niitTax).toBe(0); // Below $200k
        validateResult(result, 30000);
    });

    it('all three effects (SS taxable, LTCG at 15%, NIIT applies)', () => {
        // $250k ordinary + $30k SS + $20k STCG + $50k LTCG
        const result = calcTax(250000, 30000, 20000, 50000);

        // SS should be largely taxable (high income)
        expect(result.taxableSS).toBeGreaterThan(20000);

        // LTCG should be taxed at 15% (high ordinary income)
        expect(result.ltcgTax).toBeGreaterThan(0);

        // NIIT should apply (MAGI > $200k)
        expect(result.niitTax).toBeGreaterThan(0);

        validateResult(result, 30000);
    });
});

// =============================================================================
// Test Group 13: Filing Status Comparison
// =============================================================================

describe('Test Group 13: Filing Status Comparison', () => {
    it('$100k ordinary only: MFJ pays less than Single', () => {
        const singleResult = calcTax(100000, 0, 0, 0, 0, 'Single', fedParams2026Single);
        const mfjResult = calcTax(100000, 0, 0, 0, 0, 'Married Filing Jointly', fedParams2026MFJ);

        expect(mfjResult.totalTax).toBeLessThan(singleResult.totalTax);
    });

    it('same SS, different taxability thresholds', () => {
        // Single threshold: $25k/$34k
        // MFJ threshold: $32k/$44k
        const singleResult = calcTax(20000, 40000, 0, 0, 0, 'Single', fedParams2026Single);
        const mfjResult = calcTax(20000, 40000, 0, 0, 0, 'Married Filing Jointly', fedParams2026MFJ);

        // With $20k ordinary + $40k SS:
        // Single provisional = 20000 + 20000 = 40000 (in 85% zone)
        // MFJ provisional = 20000 + 20000 = 40000 (in 50% zone, below 44k)
        expect(singleResult.taxableSS).toBeGreaterThan(mfjResult.taxableSS);
    });

    it('same LTCG, different 0% thresholds', () => {
        // Single 0% threshold: $49,700
        // MFJ 0% threshold: $99,400
        const singleResult = calcTax(50000, 0, 0, 60000, 0, 'Single', fedParams2026Single);
        const mfjResult = calcTax(50000, 0, 0, 60000, 0, 'Married Filing Jointly', fedParams2026MFJ);

        // Single: taxable = 33900, LTCG starts at 33900, partially in 15%
        // MFJ: taxable = 17800, LTCG starts at 17800, all in 0% zone
        expect(singleResult.ltcgTax).toBeGreaterThan(mfjResult.ltcgTax);
    });

    it('NIIT threshold difference: Single over, MFJ under', () => {
        // Single threshold: $200k, MFJ threshold: $250k
        const singleResult = calcTax(230000, 0, 0, 50000, 0, 'Single', fedParams2026Single);
        const mfjResult = calcTax(230000, 0, 0, 50000, 0, 'Married Filing Jointly', fedParams2026MFJ);

        // Single: MAGI = 280000, over $200k
        // MFJ: MAGI = 280000, over $250k
        expect(singleResult.niitTax).toBeGreaterThan(0);
        expect(mfjResult.niitTax).toBeGreaterThan(0);
        // Single pays more due to lower threshold
        expect(singleResult.niitTax).toBeGreaterThan(mfjResult.niitTax);
    });
});

// =============================================================================
// Test Group 14: Pre-Tax Deductions
// =============================================================================

describe('Test Group 14: Pre-Tax Deductions', () => {
    it('deduction drops ordinary bracket', () => {
        const withoutDeduction = calcTax(50000, 0, 0, 0, 0);
        const withDeduction = calcTax(50000, 0, 0, 0, 10000);

        expect(withDeduction.ordinaryTax).toBeLessThan(withoutDeduction.ordinaryTax);
    });

    it('deduction to zero taxable', () => {
        // $20k income - $10k deduction = $10k < $16100 standard deduction
        const result = calcTax(20000, 0, 0, 0, 10000);
        expect(result.ordinaryTax).toBe(0);
        validateResult(result, 0);
    });

    it('deduction affects LTCG rate', () => {
        // $70k ordinary - $20k deduction = $50k
        // Taxable = 50k - 16.1k = 33.9k < 49.7k threshold
        // So LTCG stays in 0% bracket longer
        const withDeduction = calcTax(70000, 0, 0, 30000, 20000);
        const withoutDeduction = calcTax(70000, 0, 0, 30000, 0);

        expect(withDeduction.ltcgTax).toBeLessThan(withoutDeduction.ltcgTax);
    });

    it('401k max deduction ($23500)', () => {
        // $100k - $23500 = $76500
        const result = calcTax(100000, 0, 0, 0, 23500);
        // Taxable = 76500 - 16100 = 60400
        // Tax should be less than without deduction
        const withoutDeduction = calcTax(100000);
        expect(result.ordinaryTax).toBeLessThan(withoutDeduction.ordinaryTax);
        validateResult(result, 0);
    });

    it('deduction exceeds income floors at 0', () => {
        // $20k income - $30k deduction = -$10k → floors to 0
        const result = calcTax(20000, 0, 0, 0, 30000);
        expect(result.ordinaryTax).toBe(0);
        expect(result.totalTax).toBe(0);
        validateResult(result, 0);
    });
});

// =============================================================================
// Test Group 15: Edge Cases
// =============================================================================

describe('Test Group 15: Edge Cases', () => {
    it('all zeros', () => {
        const result = calcTax(0, 0, 0, 0, 0);
        expect(result.taxableSS).toBe(0);
        expect(result.ordinaryTax).toBe(0);
        expect(result.ltcgTax).toBe(0);
        expect(result.niitTax).toBe(0);
        expect(result.totalTax).toBe(0);
    });

    it('negative ordinary income floors to 0', () => {
        const result = calcTax(-10000, 0, 0, 0, 0);
        expect(result.ordinaryTax).toBe(0);
        expect(result.totalTax).toBe(0);
        validateResult(result, 0);
    });

    it('$1 in each category', () => {
        const result = calcTax(1, 1, 1, 1, 0);
        // Minimal amounts, all below thresholds
        expect(result.taxableSS).toBe(0); // Provisional = 1.5 < 25000
        expect(result.ordinaryTax).toBe(0); // Below standard deduction
        expect(result.ltcgTax).toBe(0); // Below 0% threshold
        expect(result.niitTax).toBe(0); // Below $200k
        validateResult(result, 1);
    });

    it('$1M in each category (high income)', () => {
        // This tests the upper bounds
        const result = calcTax(1000000, 55000, 500000, 500000, 0);

        // SS should be 85% taxable (max)
        expect(result.taxableSS).toBeCloseTo(55000 * 0.85, 0);

        // Should have significant ordinary tax
        expect(result.ordinaryTax).toBeGreaterThan(400000);

        // Should have LTCG tax at 20% rate
        expect(result.ltcgTax).toBeGreaterThan(90000);

        // Should have max NIIT
        // Net inv income = 1M, MAGI well over threshold
        expect(result.niitTax).toBeGreaterThan(30000);

        validateResult(result, 55000);
    });

    it('only deductions (no income) does not produce negative tax', () => {
        const result = calcTax(0, 0, 0, 0, 10000);
        expect(result.ordinaryTax).toBe(0);
        expect(result.totalTax).toBe(0);
        validateResult(result, 0);
    });
});

// =============================================================================
// Test Group 16: Return Value Validation
// =============================================================================

describe('Test Group 16: Return Value Validation', () => {
    const testCases = [
        { ordinary: 0, ss: 0, stcg: 0, ltcg: 0 },
        { ordinary: 50000, ss: 0, stcg: 0, ltcg: 0 },
        { ordinary: 50000, ss: 30000, stcg: 0, ltcg: 0 },
        { ordinary: 50000, ss: 30000, stcg: 10000, ltcg: 20000 },
        { ordinary: 300000, ss: 40000, stcg: 50000, ltcg: 100000 },
        { ordinary: 0, ss: 50000, stcg: 0, ltcg: 0 },
        { ordinary: 0, ss: 0, stcg: 50000, ltcg: 0 },
        { ordinary: 0, ss: 0, stcg: 0, ltcg: 50000 },
    ];

    testCases.forEach(({ ordinary, ss, stcg, ltcg }) => {
        it(`validates result for ordinary=${ordinary}, ss=${ss}, stcg=${stcg}, ltcg=${ltcg}`, () => {
            const result = calcTax(ordinary, ss, stcg, ltcg);
            validateResult(result, ss);
        });
    });

    it('totalTax equals sum of components across various scenarios', () => {
        const scenarios = [
            calcTax(100000, 30000, 20000, 40000),
            calcTax(250000, 0, 50000, 100000),
            calcTax(50000, 50000, 0, 0),
            calcTax(0, 0, 100000, 100000),
        ];

        for (const result of scenarios) {
            expect(result.totalTax).toBeCloseTo(
                result.ordinaryTax + result.ltcgTax + result.niitTax,
                2
            );
        }
    });
});
