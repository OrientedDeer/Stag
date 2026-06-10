import { describe, it, expect } from 'vitest';
import { calculateTotalFederalTax } from '../../../../components/Objects/Taxes/taxService/bracketTax';
import { TaxParameters } from '../../../../data/TaxData';

/**
 * Regression tests for the "unused standard deduction offsets LTCG" bug.
 *
 * IRS rule: the 0%/15%/20% long-term capital gains brackets are measured against
 * TOTAL taxable income (ordinary + LTCG, AFTER the standard deduction). When ordinary
 * income is below the standard deduction, the leftover (unused) portion of the deduction
 * still offsets LTCG. Previously the code floored taxable ordinary income at 0 and stacked
 * LTCG from there, throwing away the unused deduction and over-taxing LTCG.
 */

// Single / 2024 federal parameters (standard deduction $14,600).
const single2024: TaxParameters = {
    standardDeduction: 14600,
    brackets: [
        { threshold: 0, rate: 0.10 },
        { threshold: 11600, rate: 0.12 },
        { threshold: 47151, rate: 0.22 },
        { threshold: 100526, rate: 0.24 },
        { threshold: 191951, rate: 0.32 },
        { threshold: 243726, rate: 0.35 },
        { threshold: 609350, rate: 0.37 },
    ],
    capitalGainsBrackets: [
        { threshold: 0, rate: 0.00 },
        { threshold: 47025, rate: 0.15 },
        { threshold: 518900, rate: 0.20 },
    ],
    socialSecurityTaxRate: 0.062,
    socialSecurityWageBase: 168600,
    medicareTaxRate: 0.0145,
};

function calc(ordinary: number, ltcg: number) {
    return calculateTotalFederalTax(ordinary, 0, 0, ltcg, 0, 'Single', single2024);
}

describe('Unused standard deduction offsets LTCG (Single/2024)', () => {
    it('ordinary $10k + LTCG $50k → ltcgTax $0 (unused $4,600 deduction offsets LTCG)', () => {
        // Taxable income = 10000 + 50000 - 14600 = 45400 < 47025 (0% bracket top) → $0.
        // Pre-fix code floored taxableOrdinary at 0 and stacked $50k LTCG from $0,
        // taxing 50000 - 47025 = 2975 @ 15% ≈ $446.
        const result = calc(10000, 50000);
        expect(result.ltcgTax).toBe(0);
    });

    it('ordinary fully above the deduction → LTCG stacks from taxable ordinary (unchanged)', () => {
        // ordinary $70k → taxable ordinary = 70000 - 14600 = 55400 > 47025.
        // No unused deduction; all $30k LTCG taxed at 15% = $4,500.
        const result = calc(70000, 30000);
        expect(result.ltcgTax).toBeCloseTo(4500, 2);
    });

    it('ordinary partially below the deduction → partial offset of LTCG', () => {
        // ordinary $10k → unused deduction = 14600 - 10000 = 4600.
        // taxable LTCG = 60000 - 4600 = 55400, stacked from $0:
        //   47025 @ 0% + (55400 - 47025)=8375 @ 15% = $1,256.25.
        const result = calc(10000, 60000);
        expect(result.ltcgTax).toBeCloseTo(1256.25, 2);
    });

    it('LTCG fully below the unused deduction → ltcgTax $0', () => {
        // ordinary $0 → unused deduction = 14600. taxable LTCG = 3000 - 14600 < 0 → $0.
        const result = calc(0, 3000);
        expect(result.ltcgTax).toBe(0);
    });
});
