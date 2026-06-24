import { describe, it, expect } from 'vitest';

import {
    getDisplayedCSRSBenefit,
    calculateCSRSBasicBenefit,
    checkCSRSEligibility,
} from '../../../data/PensionData';
import { CSRSPensionIncome } from '../../../components/Objects/Income/models';

describe('getDisplayedCSRSBenefit === CSRSPensionIncome.calculateBenefit() (drift guard)', () => {
    // calculateBenefit() delegates to getDisplayedCSRSBenefit so the sim, the
    // Testing-tab estimates, and the IncomeProjection activation share one source
    // of truth for the CSRS basic-benefit + early-retirement reduction math. These
    // cases recompute the expected initial benefit INDEPENDENTLY from the primitive
    // helpers (basic-benefit × early-retirement reduction) so any future divergence
    // — on either the model method or the display helper — fails loudly here.
    //
    // Unlike FERS, CSRS eligibility does not depend on birth year, so there is no
    // birthYear input.
    const cases = [
        // [yearsOfService, high3, retirementAge, label]
        [30, 100_000, 55, 'age 55 with 30yr, unreduced'],
        [20, 90_000, 60, 'age 60 with 20yr, unreduced'],
        [5, 80_000, 62, 'age 62 with exactly 5yr, unreduced'],
        [25, 100_000, 50, 'early: age 50 with 25yr, 10% capped reduction (5yr×2%)'],
        [20, 100_000, 52, 'early: age 50+/20yr at 52, 6% reduction (3yr×2%)'],
        [25, 95_000, 45, 'early: any-age 25yr at 45, reduction capped at 10%'],
        [22, 120_000, 54, 'early: 22yr at 54, 2% reduction (1yr under 55)'],
        [40, 150_000, 60, '80% cap engaged, unreduced (40yr → cap)'],
        [45, 150_000, 50, '80% cap + early reduction stacked'],
        [8, 70_000, 48, 'not eligible (age 48, 8yr) — eligibility false, 0% reduction'],
    ] as const;

    it.each(cases)(
        'matches across the input matrix: yos=%d high3=%d age=%d (%s)',
        (yearsOfService, high3, retirementAge) => {
            const income = new CSRSPensionIncome(
                'csrs-matrix',
                'CSRS',
                yearsOfService,
                high3,
                retirementAge
            );

            const displayed = getDisplayedCSRSBenefit(
                yearsOfService,
                high3,
                retirementAge
            );

            // Independent reference: the exact reduction math the 4 former inline
            // sites computed — basic benefit × early-retirement reduction factor.
            const baseBenefit = calculateCSRSBasicBenefit(yearsOfService, high3);
            const { reductionPercent } = checkCSRSEligibility(retirementAge, yearsOfService);
            const expected = baseBenefit * (1 - reductionPercent / 100);

            expect(displayed).toBeCloseTo(expected, 6);
            expect(income.calculateBenefit()).toBeCloseTo(expected, 6);
            expect(income.calculateBenefit()).toBeCloseTo(displayed, 6);
        }
    );
});
