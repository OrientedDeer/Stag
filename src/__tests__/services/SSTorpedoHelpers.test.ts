/**
 * Tests for SS Torpedo Helper Functions
 *
 * These functions calculate the additional tax burden when Traditional withdrawals
 * cause more Social Security benefits to become taxable (the "torpedo" effect).
 */

import { describe, it, expect } from 'vitest';
import {
    calculateTaxableSS,
    calculateSSTorpedoAdditionalTax
} from '../../services/TaxOptimizationService';

describe('calculateTaxableSS', () => {
    // SS taxability thresholds for Single filers
    const threshold50Single = 25000;
    const threshold85Single = 34000;

    // SS taxability thresholds for MFJ filers
    const threshold50MFJ = 32000;
    const threshold85MFJ = 44000;

    describe('Single filer thresholds', () => {
        it('should return 0 when combined income is below 50% threshold', () => {
            const ssIncome = 20000;
            const combinedIncome = 24000; // Below $25k threshold

            const result = calculateTaxableSS(ssIncome, combinedIncome, threshold50Single, threshold85Single);

            expect(result).toBe(0);
        });

        it('should return 0 when combined income equals 50% threshold exactly', () => {
            const ssIncome = 20000;
            const combinedIncome = 25000; // At threshold

            const result = calculateTaxableSS(ssIncome, combinedIncome, threshold50Single, threshold85Single);

            expect(result).toBe(0);
        });

        it('should return 50% of excess when in 50% zone', () => {
            const ssIncome = 20000;
            const combinedIncome = 30000; // $5k over 50% threshold, under 85% threshold
            // Expected: min(20000 * 0.5, 5000 * 0.5) = min(10000, 2500) = 2500

            const result = calculateTaxableSS(ssIncome, combinedIncome, threshold50Single, threshold85Single);

            expect(result).toBe(2500);
        });

        it('should cap at 50% of SS benefits in 50% zone', () => {
            const ssIncome = 5000;
            const combinedIncome = 33000; // $8k over 50% threshold
            // Expected: min(5000 * 0.5, 8000 * 0.5) = min(2500, 4000) = 2500

            const result = calculateTaxableSS(ssIncome, combinedIncome, threshold50Single, threshold85Single);

            expect(result).toBe(2500);
        });

        it('should transition to 85% zone when over 85% threshold', () => {
            const ssIncome = 30000;
            const combinedIncome = 40000; // $6k over 85% threshold
            // Base from 50% zone: (34000-25000) * 0.5 = 4500
            // Excess in 85% zone: (40000-34000) * 0.85 = 5100
            // Total: min(30000 * 0.85, 4500 + 5100) = min(25500, 9600) = 9600

            const result = calculateTaxableSS(ssIncome, combinedIncome, threshold50Single, threshold85Single);

            expect(result).toBe(9600);
        });

        it('should cap at 85% of SS benefits in 85% zone', () => {
            const ssIncome = 10000;
            const combinedIncome = 50000; // $16k over 85% threshold
            // Base: 4500 from 50% zone
            // Excess: 16000 * 0.85 = 13600
            // Total: min(10000 * 0.85, 4500 + 13600) = min(8500, 18100) = 8500

            const result = calculateTaxableSS(ssIncome, combinedIncome, threshold50Single, threshold85Single);

            expect(result).toBe(8500);
        });
    });

    describe('MFJ filer thresholds', () => {
        it('should return 0 when combined income is below 50% threshold', () => {
            const ssIncome = 30000;
            const combinedIncome = 31000; // Below $32k threshold

            const result = calculateTaxableSS(ssIncome, combinedIncome, threshold50MFJ, threshold85MFJ);

            expect(result).toBe(0);
        });

        it('should return 50% of excess when in 50% zone', () => {
            const ssIncome = 40000;
            const combinedIncome = 40000; // $8k over 50% threshold, under 85% threshold
            // Expected: min(40000 * 0.5, 8000 * 0.5) = min(20000, 4000) = 4000

            const result = calculateTaxableSS(ssIncome, combinedIncome, threshold50MFJ, threshold85MFJ);

            expect(result).toBe(4000);
        });

        it('should transition to 85% zone when over 85% threshold', () => {
            const ssIncome = 40000;
            const combinedIncome = 50000; // $6k over 85% threshold
            // Base: (44000-32000) * 0.5 = 6000
            // Excess: 6000 * 0.85 = 5100
            // Total: min(40000 * 0.85, 6000 + 5100) = min(34000, 11100) = 11100

            const result = calculateTaxableSS(ssIncome, combinedIncome, threshold50MFJ, threshold85MFJ);

            expect(result).toBe(11100);
        });
    });

    describe('Edge cases', () => {
        it('should return 0 when SS income is 0', () => {
            const result = calculateTaxableSS(0, 50000, threshold50Single, threshold85Single);

            expect(result).toBe(0);
        });

        it('should return 0 when SS income is negative', () => {
            const result = calculateTaxableSS(-1000, 50000, threshold50Single, threshold85Single);

            expect(result).toBe(0);
        });

        it('should handle very high combined income (all SS taxable at 85%)', () => {
            const ssIncome = 30000;
            const combinedIncome = 200000; // Way above 85% threshold

            const result = calculateTaxableSS(ssIncome, combinedIncome, threshold50Single, threshold85Single);

            // Should cap at 85% of SS
            expect(result).toBe(25500);
        });
    });
});

describe('calculateSSTorpedoAdditionalTax', () => {
    describe('No SS income scenarios', () => {
        it('should return 0 when SS income is 0', () => {
            const result = calculateSSTorpedoAdditionalTax(0, 30000, 10000, 0.22, 'Single');

            expect(result).toBe(0);
        });

        it('should return 0 when SS income is negative', () => {
            const result = calculateSSTorpedoAdditionalTax(-5000, 30000, 10000, 0.22, 'Single');

            expect(result).toBe(0);
        });

        it('should return 0 when withdrawal amount is 0', () => {
            const result = calculateSSTorpedoAdditionalTax(20000, 30000, 0, 0.22, 'Single');

            expect(result).toBe(0);
        });

        it('should return 0 when withdrawal amount is negative', () => {
            const result = calculateSSTorpedoAdditionalTax(20000, 30000, -5000, 0.22, 'Single');

            expect(result).toBe(0);
        });
    });

    describe('Below 50% threshold (no torpedo)', () => {
        it('should return 0 when income stays below 50% threshold', () => {
            // Combined income before: $10k + ($20k * 0.5) = $20k (below $25k)
            // Combined income after: $20k + $3k = $23k (still below $25k)
            const result = calculateSSTorpedoAdditionalTax(20000, 10000, 3000, 0.12, 'Single');

            expect(result).toBe(0);
        });
    });

    describe('Crossing into 50% zone', () => {
        it('should calculate torpedo tax when withdrawal crosses into 50% zone', () => {
            // Combined income before: $12k + ($20k * 0.5) = $22k (below $25k)
            // Combined income after: $22k + $10k = $32k (in 50% zone, below $34k)
            // Taxable SS before: 0
            // Taxable SS after: min(20k * 0.5, (32k-25k) * 0.5) = min(10k, 3.5k) = 3500
            // Additional taxable SS: 3500 - 0 = 3500
            // Additional tax: 3500 * 0.12 = 420
            const result = calculateSSTorpedoAdditionalTax(20000, 12000, 10000, 0.12, 'Single');

            expect(result).toBe(420);
        });
    });

    describe('Within 50% zone', () => {
        it('should calculate torpedo tax for withdrawal within 50% zone', () => {
            // Combined income before: $15k + ($20k * 0.5) = $25k (at threshold)
            // Combined income after: $25k + $5k = $30k (in 50% zone)
            // Taxable SS before: 0 (at exactly threshold)
            // Taxable SS after: min(20k * 0.5, (30k-25k) * 0.5) = min(10k, 2.5k) = 2500
            // Additional tax: 2500 * 0.12 = 300
            const result = calculateSSTorpedoAdditionalTax(20000, 15000, 5000, 0.12, 'Single');

            expect(result).toBe(300);
        });
    });

    describe('Crossing into 85% zone', () => {
        it('should calculate higher torpedo tax when withdrawal crosses into 85% zone', () => {
            // Combined income before: $20k + ($30k * 0.5) = $35k (in 85% zone, just above $34k)
            // Combined income after: $35k + $10k = $45k (deeper in 85% zone)
            // Taxable SS before: base (4.5k) + (35k-34k)*0.85 = 4.5k + 0.85k = 5.35k
            // Taxable SS after: base (4.5k) + (45k-34k)*0.85 = 4.5k + 9.35k = 13.85k
            // But capped at 30k * 0.85 = 25.5k, so both are within cap
            // Additional taxable SS: 13850 - 5350 = 8500
            // Additional tax: 8500 * 0.22 = 1870
            const result = calculateSSTorpedoAdditionalTax(30000, 20000, 10000, 0.22, 'Single');

            expect(result).toBe(1870);
        });
    });

    describe('SS already at max taxability', () => {
        it('should return 0 when SS is already 85% taxable', () => {
            // Combined income before: $80k + ($30k * 0.5) = $95k (way above 85% threshold)
            // SS is already at max 85% taxable
            // Combined income after: $95k + $10k = $105k
            // Taxable SS before: 30k * 0.85 = 25.5k (capped)
            // Taxable SS after: 30k * 0.85 = 25.5k (still capped)
            // Additional taxable SS: 0
            const result = calculateSSTorpedoAdditionalTax(30000, 80000, 10000, 0.22, 'Single');

            expect(result).toBe(0);
        });
    });

    describe('MFJ filing status', () => {
        it('should use MFJ thresholds when filing status is MFJ', () => {
            // MFJ thresholds: 50% at $32k, 85% at $44k
            // Combined income before: $20k + ($40k * 0.5) = $40k (in 50% zone for MFJ)
            // Combined income after: $40k + $10k = $50k (in 85% zone for MFJ)
            // Taxable SS before: min(40k * 0.5, (40k-32k) * 0.5) = min(20k, 4k) = 4000
            // Taxable SS after: min(40k * 0.85, 6k + (50k-44k)*0.85) = min(34k, 6k+5.1k) = 11100
            // Additional taxable SS: 11100 - 4000 = 7100
            // Additional tax: 7100 * 0.22 = 1562
            const result = calculateSSTorpedoAdditionalTax(40000, 20000, 10000, 0.22, 'Married Filing Jointly');

            expect(result).toBe(1562);
        });
    });

    describe('Different marginal rates', () => {
        it('should scale torpedo tax with marginal rate', () => {
            // Same scenario with different rates
            const ssIncome = 20000;
            const otherIncome = 15000;
            const withdrawal = 5000;

            const result10 = calculateSSTorpedoAdditionalTax(ssIncome, otherIncome, withdrawal, 0.10, 'Single');
            const result22 = calculateSSTorpedoAdditionalTax(ssIncome, otherIncome, withdrawal, 0.22, 'Single');
            const result32 = calculateSSTorpedoAdditionalTax(ssIncome, otherIncome, withdrawal, 0.32, 'Single');

            // Higher marginal rate = proportionally higher torpedo tax
            expect(result22).toBeCloseTo(result10 * 2.2, 0);
            expect(result32).toBeCloseTo(result10 * 3.2, 0);
        });
    });

    describe('Large withdrawals', () => {
        it('should handle large withdrawals that max out SS taxability', () => {
            // Combined income before: $10k + ($20k * 0.5) = $20k (below threshold)
            // Combined income after: $20k + $100k = $120k (way above 85% threshold)
            // Taxable SS before: 0
            // Taxable SS after: 20k * 0.85 = 17k (capped at 85%)
            // Additional taxable SS: 17000
            // Additional tax: 17000 * 0.22 = 3740
            const result = calculateSSTorpedoAdditionalTax(20000, 10000, 100000, 0.22, 'Single');

            expect(result).toBe(3740);
        });
    });
});
