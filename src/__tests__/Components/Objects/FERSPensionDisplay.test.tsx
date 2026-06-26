import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';

import { FERSPensionFields as CardFERSPensionFields }
    from '../../../components/Objects/Income/card/FERSPensionFields';
import { FERSPensionFields as FormFERSPensionFields }
    from '../../../components/Objects/Income/FERSPensionFields';
import {
    getDisplayedFERSBenefit,
    calculateFERSBasicBenefit,
    checkFERSEligibility,
} from '../../../data/PensionData';
import { getInitialFormState } from '../../../components/Objects/Income/incomeFormTypes';
import { FERSPensionIncome } from '../../../components/Objects/Income/models';
import { getSimResolvedPension, getDisplayAmount } from '../../../components/Objects/Income/incomeCardUtils';
import type { SimulationYear } from '../../../services/simulation/types';

// An MRA+10 retiree: born 1970 (MRA 57), retiring at 57 with 20 years of service
// and a $100k High-3. The simulation applies a 5%/yr-under-62 reduction, so the
// displayed estimate must be reduced too — not the unreduced $20,000.
const MRA_PLUS_10 = {
    yearsOfService: 20,
    high3Salary: 100_000,
    retirementAge: 57,
    birthYear: 1970,
};

describe('FERS pension display estimate (Issue 1: MRA+10 reduction)', () => {
    it('helper applies the MRA+10 reduction so it matches calculateBenefit()', () => {
        const income = new FERSPensionIncome(
            'fers-1',
            'FERS',
            MRA_PLUS_10.yearsOfService,
            MRA_PLUS_10.high3Salary,
            MRA_PLUS_10.retirementAge,
            MRA_PLUS_10.birthYear
        );

        const displayed = getDisplayedFERSBenefit(
            MRA_PLUS_10.yearsOfService,
            MRA_PLUS_10.high3Salary,
            MRA_PLUS_10.retirementAge,
            MRA_PLUS_10.birthYear
        );

        // Sim runs $20,000 basic × (1 - 25%) = $15,000. The displayed estimate must
        // match the simulated benefit, NOT the unreduced $20,000.
        expect(displayed).toBeCloseTo(income.calculateBenefit(), 6);
        expect(displayed).toBeCloseTo(15_000, 6);
        expect(displayed).not.toBeCloseTo(20_000, 6);
    });

    it('card variant renders the reduced benefit, not the unreduced one', () => {
        const income = new FERSPensionIncome(
            'fers-card',
            'FERS',
            MRA_PLUS_10.yearsOfService,
            MRA_PLUS_10.high3Salary,
            MRA_PLUS_10.retirementAge,
            MRA_PLUS_10.birthYear
        );

        const { getByText, queryByText } = render(
            <CardFERSPensionFields
                income={income}
                onFieldUpdate={() => {}}
                workIncomes={[]}
                birthYear={MRA_PLUS_10.birthYear}
            />
        );

        expect(getByText('$15,000/yr')).toBeTruthy();
        expect(queryByText('$20,000/yr')).toBeNull();
    });

    it('form variant renders the reduced benefit, not the unreduced one', () => {
        const form = {
            ...getInitialFormState(),
            pensionYearsOfService: MRA_PLUS_10.yearsOfService,
            pensionHigh3Salary: MRA_PLUS_10.high3Salary,
            pensionRetirementAge: MRA_PLUS_10.retirementAge,
            autoCalculateHigh3: false,
        };

        const { getByText, queryByText } = render(
            <FormFERSPensionFields
                form={form}
                updateForm={() => {}}
                workIncomes={[]}
                pensionBirthYear={MRA_PLUS_10.birthYear}
            />
        );

        expect(getByText('$15,000/yr')).toBeTruthy();
        expect(queryByText('$20,000/yr')).toBeNull();
    });
});

describe('FERS Auto High-3 display (#133-a: read the sim-resolved benefit)', () => {
    // See the CSRS counterpart for the full rationale: with Auto High-3 the engine
    // resolves the benefit/High-3 on a SEPARATE projected FERS instance in
    // IncomeProjection, never on the live editable income — so the card reads the
    // resolved figures back out of the SimulationContext timeline (the simResolved
    // prop), NOT a hand-set calculatedBenefit.
    const RESOLVED_BENEFIT = 15_000;
    const RESOLVED_HIGH3 = 100_000;

    const liveAutoIncome = () =>
        new FERSPensionIncome(
            'fers-auto',
            'FERS',
            MRA_PLUS_10.yearsOfService,
            0, // high3 unset (auto)
            MRA_PLUS_10.retirementAge,
            MRA_PLUS_10.birthYear,
            0, // calculatedBenefit NEVER set on the live object for auto
            0,
            0,
            undefined,
            undefined,
            true, // autoCalculateHigh3
            'work-1'
        );

    const timelineWithActivation = (): SimulationYear[] => [
        {
            year: MRA_PLUS_10.birthYear + MRA_PLUS_10.retirementAge - 1,
            incomes: [liveAutoIncome()],
        } as unknown as SimulationYear,
        {
            year: MRA_PLUS_10.birthYear + MRA_PLUS_10.retirementAge,
            incomes: [
                new FERSPensionIncome(
                    'fers-auto',
                    'FERS',
                    MRA_PLUS_10.yearsOfService,
                    RESOLVED_HIGH3,
                    MRA_PLUS_10.retirementAge,
                    MRA_PLUS_10.birthYear,
                    RESOLVED_BENEFIT,
                    0,
                    0,
                    undefined,
                    undefined,
                    true,
                    'work-1'
                ),
            ],
        } as unknown as SimulationYear,
    ];

    it('getSimResolvedPension finds the first activation year benefit + High-3', () => {
        expect(getSimResolvedPension('fers-auto', timelineWithActivation()))
            .toEqual({ benefit: RESOLVED_BENEFIT, high3: RESOLVED_HIGH3 });
    });

    it('returns null with no simulation or a never-activating pension', () => {
        expect(getSimResolvedPension('fers-auto', [])).toBeNull();
        expect(getSimResolvedPension('fers-auto', undefined)).toBeNull();
        const neverActivates = [
            { year: 2030, incomes: [liveAutoIncome()] } as unknown as SimulationYear,
        ];
        expect(getSimResolvedPension('fers-auto', neverActivates)).toBeNull();
    });

    it('card shows the sim-resolved $/yr for Auto High-3 once the sim has run', () => {
        const simResolved = getSimResolvedPension('fers-auto', timelineWithActivation());
        const { getByText } = render(
            <CardFERSPensionFields
                income={liveAutoIncome()}
                onFieldUpdate={() => {}}
                workIncomes={[]}
                birthYear={MRA_PLUS_10.birthYear}
                simResolved={simResolved}
            />
        );
        // Auto-High-3 figures are sim-projected (retirement-year nominal), so the
        // card tags them "(at retirement)" to distinguish from today's-dollars manual (#133).
        expect(getByText('$15,000/yr (at retirement)')).toBeTruthy();
        expect(getByText('$100,000/yr (at retirement)')).toBeTruthy();
    });

    it('keeps "Auto Calculated" on both rows when there is no sim data (simResolved null)', () => {
        const { getAllByText, queryByText } = render(
            <CardFERSPensionFields
                income={liveAutoIncome()}
                onFieldUpdate={() => {}}
                workIncomes={[]}
                birthYear={MRA_PLUS_10.birthYear}
                simResolved={null}
            />
        );
        expect(getAllByText('Auto Calculated').length).toBe(2);
        expect(queryByText('$15,000/yr')).toBeNull();
    });

    it('collapsed header agrees: getDisplayAmount uses the sim-resolved benefit', () => {
        const simResolved = getSimResolvedPension('fers-auto', timelineWithActivation());
        expect(getDisplayAmount(liveAutoIncome(), true)).toBe('Auto-calculated');
        expect(getDisplayAmount(liveAutoIncome(), true, simResolved?.benefit)).toBe('$15,000');
    });
});

describe('getDisplayedFERSBenefit === FERSPensionIncome.calculateBenefit() (drift guard)', () => {
    // calculateBenefit() delegates to getDisplayedFERSBenefit so the sim and the
    // displayed estimate share one source of truth. These cases recompute the
    // expected initial benefit INDEPENDENTLY from the primitive helpers
    // (basic-benefit × MRA+10 reduction) so any future divergence — on either the
    // model method or the display helper — fails loudly here.
    const cases = [
        // [yearsOfService, high3, retirementAge, birthYear, label]
        [20, 100_000, 57, 1970, 'MRA+10, 25% reduction (57 → 5yr under 62)'],
        [10, 80_000, 57, 1970, 'MRA+10, minimum 10yr service'],
        [30, 120_000, 57, 1970, 'MRA with 30yr, unreduced'],
        [25, 90_000, 60, 1970, 'age 60 with 20+yr, unreduced'],
        [25, 90_000, 62, 1965, 'age 62 with 20+yr, 1.1% multiplier'],
        [5, 70_000, 62, 1960, 'age 62 with exactly 5yr, 1.0% multiplier'],
        [15, 85_000, 56, 1960, 'older MRA (1960 → 56), MRA+10 reduction'],
        [12, 60_000, 56, 1955, 'older MRA (1955 → 56), reduced'],
        [22, 110_000, 64, 1955, 'past 62 with 20+yr, 1.1% multiplier'],
        [8, 75_000, 50, 1970, 'not eligible (age 50, 8yr) — eligibility false, 0% reduction'],
    ] as const;

    it.each(cases)(
        'matches across the input matrix: yos=%d high3=%d age=%d birth=%d (%s)',
        (yearsOfService, high3, retirementAge, birthYear) => {
            const income = new FERSPensionIncome(
                'fers-matrix',
                'FERS',
                yearsOfService,
                high3,
                retirementAge,
                birthYear
            );

            const displayed = getDisplayedFERSBenefit(
                yearsOfService,
                high3,
                retirementAge,
                birthYear
            );

            // Independent reference: basic benefit × MRA+10 reduction factor.
            const baseBenefit = calculateFERSBasicBenefit(yearsOfService, high3, retirementAge);
            const { reductionPercent } = checkFERSEligibility(retirementAge, yearsOfService, birthYear);
            const expected = baseBenefit * (1 - reductionPercent / 100);

            expect(displayed).toBeCloseTo(expected, 6);
            expect(income.calculateBenefit()).toBeCloseTo(expected, 6);
            expect(income.calculateBenefit()).toBeCloseTo(displayed, 6);
        }
    );
});

describe('FERS COLA tooltip (Issue 2: all three bands + age-62 gate)', () => {
    // The tooltip copy is shared verbatim across both variants. Assert it names all
    // three COLA bands getFERSCOLA actually applies plus the age-62 gate.
    const assertColaCopy = (text: string) => {
        // full CPI band (<= 2%)
        expect(text).toMatch(/full CPI/i);
        expect(text).toContain('≤ 2%');
        // diet-COLA band (2-3%) capped at 2% — the band the old copy omitted
        expect(text).toContain('2–3%');
        expect(text).toMatch(/capped at 2%/i);
        // CPI - 1% band (> 3%)
        expect(text).toContain('CPI−1%');
        expect(text).toContain('> 3%');
        // age-62 gate
        expect(text).toMatch(/before age 62/i);
    };

    it('card variant tooltip describes all three bands and the age-62 gate', () => {
        const income = new FERSPensionIncome('fers-card-2', 'FERS', 20, 100_000, 57, 1970);
        const { container } = render(
            <CardFERSPensionFields
                income={income}
                onFieldUpdate={() => {}}
                workIncomes={[]}
                birthYear={1970}
            />
        );
        assertColaCopy(container.textContent || '');
    });

    it('form variant tooltip describes all three bands and the age-62 gate', () => {
        const form = { ...getInitialFormState(), autoCalculateHigh3: false };
        const { container } = render(
            <FormFERSPensionFields
                form={form}
                updateForm={() => {}}
                workIncomes={[]}
                pensionBirthYear={1970}
            />
        );
        assertColaCopy(container.textContent || '');
    });
});
