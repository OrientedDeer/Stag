/**
 * Characterization tests for `withEffectiveDeduction` — the shared #191/#198
 * "effective-deduction chokepoint" wrapper that YearSolver (retirement +
 * working paths) and RothConversionDP all funnel through. Its sole job is to
 * return a COPY of `fedParams` whose `standardDeduction` is replaced by
 * `getEffectiveDeduction(...)`, leaving every other field untouched and the
 * input un-mutated.
 *
 * These lock the wrapper mechanic so a future edit to one call site can't
 * silently diverge from the others (the engine-vs-DP pricing asymmetry the
 * #191/#198 fixes exist to close).
 */

import { describe, it, expect } from 'vitest';
import {
    withEffectiveDeduction,
    getEffectiveDeduction,
} from '../../components/Objects/Taxes/TaxService';
import { TaxParameters } from '../../data/TaxData';
import { DeductionMethod } from '../../components/Objects/Taxes/TaxContext';

const fed2026Single: TaxParameters = {
    standardDeduction: 16100,
    brackets: [
        { threshold: 0, rate: 0.10 },
        { threshold: 12400, rate: 0.12 },
        { threshold: 50400, rate: 0.22 },
        { threshold: 105700, rate: 0.24 },
        { threshold: 201775, rate: 0.32 },
        { threshold: 256225, rate: 0.35 },
        { threshold: 640600, rate: 0.37 },
    ],
    socialSecurityTaxRate: 0.062,
    socialSecurityWageBase: 176100,
    medicareTaxRate: 0.0145,
    capitalGainsBrackets: [
        { threshold: 0, rate: 0.00 },
        { threshold: 49700, rate: 0.15 },
        { threshold: 548200, rate: 0.20 },
    ],
};

// Cover the axes that make the three call sites differ: senior vs non-senior
// age, itemized-total present/absent, and each deduction method.
const cases: Array<{
    label: string;
    age: number | undefined;
    year: number;
    magiProxy: number;
    itemizedTotal: number;
    method: DeductionMethod;
}> = [
    { label: 'non-senior / standard / no itemized', age: 40, year: 2030, magiProxy: 80000, itemizedTotal: 0, method: 'Standard' },
    { label: 'non-senior / auto / large itemized', age: 40, year: 2030, magiProxy: 80000, itemizedTotal: 42000, method: 'Auto' },
    { label: 'senior / standard (bonus window)', age: 70, year: 2027, magiProxy: 60000, itemizedTotal: 0, method: 'Standard' },
    { label: 'senior / itemized', age: 70, year: 2027, magiProxy: 60000, itemizedTotal: 30000, method: 'Itemized' },
    { label: 'senior / auto (post-bonus year)', age: 70, year: 2035, magiProxy: 200000, itemizedTotal: 25000, method: 'Auto' },
    { label: 'undefined age', age: undefined, year: 2030, magiProxy: 50000, itemizedTotal: 0, method: 'Auto' },
];

describe('withEffectiveDeduction', () => {
    it.each(cases)('sets standardDeduction to getEffectiveDeduction(...) — $label', (c) => {
        const result = withEffectiveDeduction(
            fed2026Single, 'Single', c.age, c.year, c.magiProxy, c.itemizedTotal, c.method,
        );
        const expected = getEffectiveDeduction(
            fed2026Single, 'Single', c.age, c.year, c.magiProxy, c.itemizedTotal, c.method,
        );
        expect(result.standardDeduction).toBe(expected);
    });

    it('preserves every other TaxParameters field verbatim', () => {
        const result = withEffectiveDeduction(
            fed2026Single, 'Single', 70, 2027, 60000, 30000, 'Auto',
        );
        // Everything but standardDeduction is identical to the input.
        expect({ ...result, standardDeduction: fed2026Single.standardDeduction })
            .toEqual(fed2026Single);
    });

    it('does not mutate the input params', () => {
        const snapshot = structuredClone(fed2026Single);
        withEffectiveDeduction(fed2026Single, 'Single', 70, 2027, 60000, 30000, 'Auto');
        expect(fed2026Single).toEqual(snapshot);
    });
});
