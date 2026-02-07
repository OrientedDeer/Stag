import { describe, it, expect } from 'vitest';
import {
    getBracketProgression,
    MAX_CONVERSION_BRACKET,
} from '../../../services/simulation/TaxOptimizedWithdrawal';
import { TaxParameters } from '../../../data/TaxData';

// Helper to create tax params with specific brackets
function createTaxParams(rates: number[]): TaxParameters {
    return {
        brackets: rates.map((rate, i) => ({
            rate,
            threshold: i * 50000,
        })),
        standardDeduction: 14600,
        socialSecurityTaxRate: 0.062,
        socialSecurityWageBase: 168600,
        medicareTaxRate: 0.0145,
    };
}

describe('TaxOptimizedWithdrawal', () => {
    describe('getBracketProgression', () => {
        it('should return rates up to MAX_CONVERSION_BRACKET (0.32)', () => {
            // Standard 2024 federal brackets
            const taxParams = createTaxParams([0.10, 0.12, 0.22, 0.24, 0.32, 0.35, 0.37]);

            const result = getBracketProgression(taxParams);

            // Should include 10%, 12%, 22%, 24%, 32%
            expect(result).toEqual([0.10, 0.12, 0.22, 0.24, 0.32]);
            expect(result).not.toContain(0.35);
            expect(result).not.toContain(0.37);
        });

        it('should filter out rates greater than MAX_CONVERSION_BRACKET', () => {
            const taxParams = createTaxParams([0.10, 0.12, 0.22, 0.35, 0.37]);

            const result = getBracketProgression(taxParams);

            // Only 10%, 12%, 22% should be included
            expect(result).toEqual([0.10, 0.12, 0.22]);
        });

        it('should return empty array when no brackets exist', () => {
            const taxParams: TaxParameters = {
                brackets: [],
                standardDeduction: 14600,
                socialSecurityTaxRate: 0.062,
                socialSecurityWageBase: 168600,
                medicareTaxRate: 0.0145,
            };

            const result = getBracketProgression(taxParams);

            expect(result).toEqual([]);
        });

        it('should return empty array when all rates exceed MAX_CONVERSION_BRACKET', () => {
            const taxParams = createTaxParams([0.35, 0.37, 0.40]);

            const result = getBracketProgression(taxParams);

            expect(result).toEqual([]);
        });

        it('should include exactly 0.32 rate (boundary case)', () => {
            const taxParams = createTaxParams([0.31, 0.32, 0.33]);

            const result = getBracketProgression(taxParams);

            expect(result).toEqual([0.31, 0.32]);
            expect(result).not.toContain(0.33);
        });

        it('should preserve bracket order', () => {
            // Non-standard order (just testing preservation)
            const taxParams = createTaxParams([0.22, 0.10, 0.32, 0.12]);

            const result = getBracketProgression(taxParams);

            expect(result).toEqual([0.22, 0.10, 0.32, 0.12]);
        });
    });

    describe('MAX_CONVERSION_BRACKET', () => {
        it('should be 0.32 (32%)', () => {
            expect(MAX_CONVERSION_BRACKET).toBe(0.32);
        });
    });
});
