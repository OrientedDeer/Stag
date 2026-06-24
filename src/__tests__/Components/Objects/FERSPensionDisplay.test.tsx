import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';

import { FERSPensionFields as CardFERSPensionFields, getDisplayedFERSBenefit }
    from '../../../components/Objects/Income/card/FERSPensionFields';
import { FERSPensionFields as FormFERSPensionFields }
    from '../../../components/Objects/Income/FERSPensionFields';
import { getInitialFormState } from '../../../components/Objects/Income/incomeFormTypes';
import { FERSPensionIncome } from '../../../components/Objects/Income/models';

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
