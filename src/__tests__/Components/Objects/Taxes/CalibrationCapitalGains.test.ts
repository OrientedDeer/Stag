/**
 * Future-year tax calibration must be EXACT for ALL income, not just ordinary
 * income (#61 follow-up, BUG #1).
 *
 * Total federal = ordinaryTax + ltcgTax + niitTax. The calibration scales the
 * marginal rates so that "calibrated total = factor × total". If only the
 * ordinary brackets are scaled, the LTCG and NIIT portions stay at full rate
 * and the carried-forward % silently shrinks whenever capital gains / NIIT are
 * present. These tests assert the invariant holds with LTCG + NIIT in play, and
 * that getTaxParameters scales the LTCG brackets + NIIT rate under calibration.
 */
import { describe, it, expect } from 'vitest';
import { AssumptionsState, defaultAssumptions } from '../../../../components/Objects/Assumptions/AssumptionsContext';
import { TaxState } from '../../../../components/Objects/Taxes/TaxContext';
import { WorkIncome } from '../../../../components/Objects/Income/models';
import { calculateFederalTaxFromIncomes, getTaxParameters } from '../../../../components/Objects/Taxes/TaxService';

const YEAR = 2024;

const baseAssumptions: AssumptionsState = {
    ...defaultAssumptions,
    macro: { ...defaultAssumptions.macro, inflationAdjusted: false },
};

const calAssumptions = (fed: number, state = 1): AssumptionsState => ({
    ...baseAssumptions,
    macro: { ...baseAssumptions.macro, taxCalibration: { fed, state } },
});

const taxState: TaxState = {
    filingStatus: 'Single', stateResidency: 'Texas', deductionMethod: 'Standard',
    fedOverride: null, ficaOverride: null, stateOverride: null, year: YEAR,
};

// High enough wages that, stacked with LTCG, MAGI clears the $200k Single NIIT
// threshold; LTCG large enough to land in the 15% LTCG bracket and be taxed.
const income = new WorkIncome('inc', 'Salary', 180000, 'Annually', 'No', 0, 0, 0, 0, '', null, 'FIXED', new Date(YEAR - 5, 0, 1), new Date(YEAR + 40, 11, 31));
const LTCG = 80000;

describe('calibration is exact when capital gains / NIIT are present (BUG #1)', () => {
    it('scaled total federal == factor × base total federal', () => {
        const base = calculateFederalTaxFromIncomes(taxState, [income], [], 0, YEAR, baseAssumptions, 0, LTCG);
        const scaled = calculateFederalTaxFromIncomes(taxState, [income], [], 0, YEAR, calAssumptions(1.5), 0, LTCG);

        // Sanity: the scenario must actually exercise both LTCG and NIIT, else
        // the test would pass vacuously even with the bug present.
        const params = getTaxParameters(YEAR, 'Single', 'federal', undefined, baseAssumptions)!;
        expect(params.capitalGainsBrackets).toBeDefined();

        expect(base).toBeGreaterThan(0);
        expect(scaled).toBeCloseTo(base * 1.5, 0); // within ~$1
    });

    it('getTaxParameters doubles LTCG bracket rates and NIIT rate when fed=2', () => {
        const base = getTaxParameters(YEAR, 'Single', 'federal', undefined, baseAssumptions)!;
        const scaled = getTaxParameters(YEAR, 'Single', 'federal', undefined, calAssumptions(2))!;

        expect(base.capitalGainsBrackets).toBeDefined();
        scaled.capitalGainsBrackets!.forEach((b, i) => {
            expect(b.rate).toBeCloseTo(base.capitalGainsBrackets![i].rate * 2, 6);
            expect(b.threshold).toBe(base.capitalGainsBrackets![i].threshold); // thresholds untouched
        });
        // NIIT default is 0.038; calibration scales it to 0.076.
        expect(scaled.niitRate).toBeCloseTo(0.076, 6);
    });

    it('does NOT scale LTCG brackets or NIIT for a pure shift (calFactor === 1)', () => {
        const base = getTaxParameters(YEAR, 'Single', 'federal', undefined, baseAssumptions)!;
        const shiftOnly: AssumptionsState = {
            ...baseAssumptions,
            macro: { ...baseAssumptions.macro, taxBracketShiftPct: 5, taxBracketShiftStartYear: YEAR },
        };
        const shifted = getTaxParameters(YEAR + 1, 'Single', 'federal', undefined, shiftOnly)!;
        // Ordinary brackets shifted, but LTCG brackets and niitRate untouched.
        expect(shifted.capitalGainsBrackets!.map(b => b.rate))
            .toEqual(base.capitalGainsBrackets!.map(b => b.rate));
        expect(shifted.niitRate).toBeUndefined();
    });
});
