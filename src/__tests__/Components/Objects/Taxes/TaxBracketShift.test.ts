/**
 * Future tax-regime bracket shift (assumptions.macro.taxBracketShiftPct).
 * Shifts every FEDERAL ordinary-income marginal rate by N percentage points
 * (clamped to [0,1]) for years on/after the start year. State tax, LTCG
 * brackets, thresholds, and years before the start are untouched.
 */
import { describe, it, expect } from 'vitest';
import { AssumptionsState, defaultAssumptions } from '../../../../components/Objects/Assumptions/AssumptionsContext';
import { getTaxParameters } from '../../../../components/Objects/Taxes/taxService/parameters';

const withShift = (pct: number, startYear: number): AssumptionsState => ({
    ...defaultAssumptions,
    macro: { ...defaultAssumptions.macro, inflationAdjusted: false, taxBracketShiftPct: pct, taxBracketShiftStartYear: startYear },
});

const noShift: AssumptionsState = {
    ...defaultAssumptions,
    macro: { ...defaultAssumptions.macro, inflationAdjusted: false, taxBracketShiftPct: 0, taxBracketShiftStartYear: 0 },
};

describe('federal bracket shift', () => {
    it('adds the % in points to every federal rate for years >= start', () => {
        const base = getTaxParameters(2024, 'Single', 'federal', undefined, noShift)!;
        const shifted = getTaxParameters(2024, 'Single', 'federal', undefined, withShift(5, 2020))!;
        expect(base.brackets.length).toBe(shifted.brackets.length);
        shifted.brackets.forEach((b, i) => {
            expect(b.rate).toBeCloseTo(base.brackets[i].rate + 0.05, 6);
            expect(b.threshold).toBe(base.brackets[i].threshold); // thresholds untouched
        });
    });

    it('does not shift years before the start year', () => {
        const base = getTaxParameters(2024, 'Single', 'federal', undefined, noShift)!;
        const gated = getTaxParameters(2024, 'Single', 'federal', undefined, withShift(5, 2030))!;
        expect(gated.brackets.map(b => b.rate)).toEqual(base.brackets.map(b => b.rate));
    });

    it('clamps a large negative shift at 0', () => {
        const shifted = getTaxParameters(2024, 'Single', 'federal', undefined, withShift(-50, 2020))!;
        shifted.brackets.forEach(b => expect(b.rate).toBeGreaterThanOrEqual(0));
        // the 10% bracket minus 50 points floors at 0
        expect(shifted.brackets[0].rate).toBe(0);
    });

    it('leaves STATE brackets unshifted', () => {
        const base = getTaxParameters(2024, 'Single', 'state', 'California', noShift);
        const shifted = getTaxParameters(2024, 'Single', 'state', 'California', withShift(5, 2020));
        if (base && shifted) {
            expect(shifted.brackets.map(b => b.rate)).toEqual(base.brackets.map(b => b.rate));
        }
    });

    it('is a no-op when pct is 0', () => {
        const a = getTaxParameters(2024, 'Single', 'federal', undefined, noShift)!;
        const b = getTaxParameters(2024, 'Single', 'federal', undefined, withShift(0, 2020))!;
        expect(b.brackets.map(x => x.rate)).toEqual(a.brackets.map(x => x.rate));
    });

    it('never shifts the current calendar year, even if configured to start now (BUG #2)', () => {
        const CY = new Date().getFullYear();
        const base = getTaxParameters(CY, 'Single', 'federal', undefined, noShift)!;
        // Configuring the shift to start in the CURRENT year must NOT shift the
        // current year — "this year's taxes stay current-law."
        const currentYearWithShift = getTaxParameters(CY, 'Single', 'federal', undefined, withShift(10, CY))!;
        expect(currentYearWithShift.brackets.map(b => b.rate)).toEqual(base.brackets.map(b => b.rate));

        // But next year IS shifted (the clamp pushes a current-year start to next year).
        const nextBase = getTaxParameters(CY + 1, 'Single', 'federal', undefined, noShift)!;
        const nextYearWithShift = getTaxParameters(CY + 1, 'Single', 'federal', undefined, withShift(10, CY))!;
        nextYearWithShift.brackets.forEach((b, i) => {
            expect(b.rate).toBeCloseTo(Math.min(1, nextBase.brackets[i].rate + 0.10), 6);
        });
    });
});
