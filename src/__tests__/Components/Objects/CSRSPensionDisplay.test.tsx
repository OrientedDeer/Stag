import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';

import { CSRSPensionFields as CardCSRSPensionFields }
    from '../../../components/Objects/Income/card/CSRSPensionFields';
import { CSRSPensionFields as FormCSRSPensionFields }
    from '../../../components/Objects/Income/CSRSPensionFields';
import {
    getDisplayedCSRSBenefit,
    calculateCSRSBasicBenefit,
} from '../../../data/PensionData';
import { getInitialFormState } from '../../../components/Objects/Income/incomeFormTypes';
import { CSRSPensionIncome } from '../../../components/Objects/Income/models';
import { getSimResolvedPension, getDisplayAmount } from '../../../components/Objects/Income/incomeCardUtils';
import type { SimulationYear } from '../../../services/simulation/types';

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

    // ---- Auto High-3: read-from-sim path (#133-a) ----
    // With Auto High-3 on, the engine NEVER writes the resolved benefit/High-3 back
    // onto the editable IncomeContext object — it computes them on a SEPARATE
    // projected CSRS instance in IncomeProjection (the activation year sets
    // `calculatedBenefit` + the resolved `high3Salary`). So the live income's
    // `calculatedBenefit` stays 0; the card reads the resolved figures back out of
    // the SimulationContext timeline via getSimResolvedPension, passed in as the
    // `simResolved` prop. These tests drive that real data path with a timeline
    // fixture mirroring the engine output — NOT a hand-set calculatedBenefit.

    // The live (editable) auto pension — calculatedBenefit 0, as it always is for auto.
    const liveAutoIncome = () => {
        const income = new CSRSPensionIncome(
            'csrs-auto',
            'CSRS',
            EARLY_RETIREMENT.yearsOfService,
            0, // high3 unset on the editable income (auto)
            EARLY_RETIREMENT.retirementAge,
            0, // calculatedBenefit NEVER set on the live object for auto
            undefined,
            undefined,
            true, // autoCalculateHigh3
            'work-1'
        );
        return income;
    };

    // A timeline fixture mirroring the engine output: an early pre-activation year
    // (calculatedBenefit 0) then the FIRST activation year carrying a projected CSRS
    // instance (same id) with calculatedBenefit + the resolved high3Salary set.
    const RESOLVED_BENEFIT = 41_625;
    const RESOLVED_HIGH3 = 100_000;
    const timelineWithActivation = (): SimulationYear[] => [
        { year: 2030, incomes: [liveAutoIncome()] } as unknown as SimulationYear,
        {
            year: 2031,
            incomes: [
                new CSRSPensionIncome(
                    'csrs-auto',
                    'CSRS',
                    EARLY_RETIREMENT.yearsOfService,
                    RESOLVED_HIGH3,
                    EARLY_RETIREMENT.retirementAge,
                    RESOLVED_BENEFIT,
                    undefined,
                    undefined,
                    true,
                    'work-1'
                ),
            ],
        } as unknown as SimulationYear,
    ];

    it('getSimResolvedPension finds the first activation year benefit + High-3', () => {
        expect(getSimResolvedPension('csrs-auto', timelineWithActivation()))
            .toEqual({ benefit: RESOLVED_BENEFIT, high3: RESOLVED_HIGH3 });
    });

    it('returns null with no simulation (empty timeline) or a never-activating pension', () => {
        expect(getSimResolvedPension('csrs-auto', [])).toBeNull();
        expect(getSimResolvedPension('csrs-auto', undefined)).toBeNull();
        const neverActivates = [
            { year: 2030, incomes: [liveAutoIncome()] } as unknown as SimulationYear,
        ];
        expect(getSimResolvedPension('csrs-auto', neverActivates)).toBeNull();
    });

    it('card shows the sim-resolved $/yr for Auto High-3 once the sim has run', () => {
        const simResolved = getSimResolvedPension('csrs-auto', timelineWithActivation());
        const { getByText } = render(
            <CardCSRSPensionFields
                income={liveAutoIncome()}
                onFieldUpdate={() => {}}
                workIncomes={[]}
                birthYear={1981}
                simResolved={simResolved}
            />
        );
        // Auto-High-3 figures are sim-projected (retirement-year nominal), so the card
        // tags them "(at retirement)" to distinguish from today's-dollars manual (#133).
        expect(getByText('$41,625/yr (at retirement)')).toBeTruthy();
        // The High-3 row shows the resolved figure (from the sim), not a half-resolved
        // "Auto Calculated" next to the computed benefit.
        expect(getByText('$100,000/yr (at retirement)')).toBeTruthy();
    });

    it('keeps "Auto Calculated" on both rows when there is no sim data (simResolved null)', () => {
        const { getAllByText, queryByText } = render(
            <CardCSRSPensionFields
                income={liveAutoIncome()}
                onFieldUpdate={() => {}}
                workIncomes={[]}
                birthYear={1981}
                simResolved={null}
            />
        );
        expect(getAllByText('Auto Calculated').length).toBe(2);
        expect(queryByText('$41,625/yr')).toBeNull();
    });

    it('collapsed header agrees: getDisplayAmount uses the sim-resolved benefit', () => {
        const simResolved = getSimResolvedPension('csrs-auto', timelineWithActivation());
        // Without the override the header reads "Auto-calculated" (live field is 0);
        // with the sim-resolved benefit it shows the figure — same source as the card.
        expect(getDisplayAmount(liveAutoIncome(), true)).toBe('Auto-calculated');
        expect(getDisplayAmount(liveAutoIncome(), true, simResolved?.benefit)).toBe('$41,625');
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
    // of truth for the CSRS basic-benefit + early-retirement reduction math.
    //
    // The expected values below are HARDCODED LITERALS, computed by hand from the
    // published CSRS math (NOT recomputed from calculateCSRSBasicBenefit /
    // checkCSRSEligibility). That independence is the whole point: if a regression
    // lands in either primitive — a wrong tier breakpoint, a wrong reduction cap,
    // a broken 80% cap — the production helper shifts but these literals don't, so
    // the assertion fails loudly. (A reference recomputed from the same primitives
    // would shift in lockstep and never bite.)
    //
    // expectedReduced = expectedBasic × (1 − reduction%). The basic-benefit tiers:
    // first 5yr ×1.5%, yrs 6–10 ×1.75%, yrs 11+ ×2.0%, capped at 80% of High-3. The
    // early-retirement reduction is 2%/yr under age 55, capped at 10%, and only when
    // eligible. Unlike FERS, CSRS eligibility does not depend on birth year.
    const cases = [
        // [yearsOfService, high3, retirementAge, expectedBasic, expectedReduced, label]
        [30, 100_000, 55, 56_250, 56_250, 'age 55 with 30yr, unreduced'],
        [20, 90_000, 60, 32_625, 32_625, 'age 60 with 20yr, unreduced'],
        [5, 80_000, 62, 6_000, 6_000, 'age 62 with exactly 5yr, unreduced'],
        [25, 100_000, 50, 46_250, 41_625, 'early: age 50 with 25yr, 10% capped reduction (5yr×2%)'],
        [20, 100_000, 52, 36_250, 34_075, 'early: age 50+/20yr at 52, 6% reduction (3yr×2%)'],
        [25, 95_000, 45, 43_937.5, 39_543.75, 'early: any-age 25yr at 45, reduction capped at 10%'],
        [22, 120_000, 54, 48_300, 47_334, 'early: 22yr at 54, 2% reduction (1yr under 55)'],
        [40, 150_000, 60, 114_375, 114_375, '40yr below the 80% cap, unreduced'],
        [45, 150_000, 50, 120_000, 108_000, '80% cap engaged + 10% early reduction stacked'],
        [8, 70_000, 48, 8_925, 8_925, 'not eligible (age 48, 8yr) — eligibility false, 0% reduction'],
    ] as const;

    it.each(cases)(
        'matches the hardcoded reference: yos=%d high3=%d age=%d (%s)',
        (yearsOfService, high3, retirementAge, expectedBasic, expectedReduced) => {
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

            // The displayed/simulated benefit equals the hardcoded reduced figure.
            expect(displayed).toBeCloseTo(expectedReduced, 6);
            expect(income.calculateBenefit()).toBeCloseTo(expectedReduced, 6);
            expect(income.calculateBenefit()).toBeCloseTo(displayed, 6);

            // The basic-benefit primitive equals the hardcoded unreduced figure, and
            // the displayed estimate never exceeds it (reduction only ever cuts).
            expect(calculateCSRSBasicBenefit(yearsOfService, high3)).toBeCloseTo(
                expectedBasic,
                6
            );
            expect(displayed).toBeLessThanOrEqual(expectedBasic + 1e-6);
        }
    );
});
