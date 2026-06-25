import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';

import { CSRSPensionFields as CardCSRSPensionFields }
    from '../../../components/Objects/Income/card/CSRSPensionFields';
import { CSRSPensionFields as FormCSRSPensionFields }
    from '../../../components/Objects/Income/CSRSPensionFields';
import {
    getDisplayedCSRSBenefit,
    calculateCSRSBasicBenefit,
    checkCSRSEligibility,
} from '../../../data/PensionData';
import { getInitialFormState } from '../../../components/Objects/Income/incomeFormTypes';
import { CSRSPensionIncome } from '../../../components/Objects/Income/models';

// An early-retirement CSRS retiree: 25 years of service, $100k High-3, retiring at
// age 50. The basic benefit is $46,250 but CSRS applies a 2%/yr-under-55 reduction
// (capped at 10%), so the simulation runs $46,250 × 0.90 = $41,625. The displayed
// estimate must show the reduced $41,625 — NOT the unreduced $46,250.
const EARLY_RETIREMENT = {
    yearsOfService: 25,
    high3Salary: 100_000,
    retirementAge: 50,
};

describe('CSRS pension display estimate (Issue #133: early-retirement reduction)', () => {
    it('helper applies the early-retirement reduction so it matches calculateBenefit()', () => {
        const income = new CSRSPensionIncome(
            'csrs-early',
            'CSRS',
            EARLY_RETIREMENT.yearsOfService,
            EARLY_RETIREMENT.high3Salary,
            EARLY_RETIREMENT.retirementAge
        );

        const displayed = getDisplayedCSRSBenefit(
            EARLY_RETIREMENT.yearsOfService,
            EARLY_RETIREMENT.high3Salary,
            EARLY_RETIREMENT.retirementAge
        );

        // Sim runs $46,250 basic × (1 - 10%) = $41,625. The displayed estimate must
        // match the simulated benefit, NOT the unreduced $46,250.
        expect(displayed).toBeCloseTo(income.calculateBenefit(), 6);
        expect(displayed).toBeCloseTo(41_625, 6);
        expect(displayed).not.toBeCloseTo(46_250, 6);
    });

    it('card variant renders the reduced benefit, not the unreduced one', () => {
        const income = new CSRSPensionIncome(
            'csrs-card',
            'CSRS',
            EARLY_RETIREMENT.yearsOfService,
            EARLY_RETIREMENT.high3Salary,
            EARLY_RETIREMENT.retirementAge
        );

        const { getByText, queryByText } = render(
            <CardCSRSPensionFields
                income={income}
                onFieldUpdate={() => {}}
                workIncomes={[]}
                birthYear={1975}
            />
        );

        expect(getByText('$41,625/yr')).toBeTruthy();
        expect(queryByText('$46,250/yr')).toBeNull();
    });

    it('form variant renders the reduced benefit, not the unreduced one', () => {
        const form = {
            ...getInitialFormState(),
            pensionYearsOfService: EARLY_RETIREMENT.yearsOfService,
            pensionHigh3Salary: EARLY_RETIREMENT.high3Salary,
            pensionRetirementAge: EARLY_RETIREMENT.retirementAge,
            autoCalculateHigh3: false,
        };

        const { getByText, queryByText } = render(
            <FormCSRSPensionFields
                form={form}
                updateForm={() => {}}
                workIncomes={[]}
                pensionBirthYear={1975}
            />
        );

        expect(getByText('$41,625/yr')).toBeTruthy();
        expect(queryByText('$46,250/yr')).toBeNull();
    });
});

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
