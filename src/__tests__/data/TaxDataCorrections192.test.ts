/**
 * #192 — tax/pension data corrections.
 *
 * Pins the data-level fixes that don't have a natural home in an existing file:
 *  - federal 2024 rows carry the 65+ additional standard deduction (they were
 *    the only year rows without it, so a Current-tab display at tax year 2024
 *    silently dropped a senior's deduction);
 *  - the demo data's taxSettings.year is derived, not pinned to a stale 2024;
 *  - projected FICA wage base is single-sourced from the SS benefit-side data
 *    (getWageBase) so the same statutory cap can't resolve to two different
 *    numbers in one simulated year;
 *  - CA 2025 rows are FTB's real 2025 schedule with the 1% MHST layer above
 *    $1M (verified against the 2025 FTB rate schedules).
 */
import { describe, it, expect } from 'vitest';

import { TAX_DATABASE, max_year } from '../../data/TaxData';
import { getWageBase } from '../../data/SocialSecurityData';
import { defaultData } from '../../data/defaultData';
import { getTaxParameters } from '../../components/Objects/Taxes/taxService/parameters';
import {
    AssumptionsState,
    defaultAssumptions,
} from '../../components/Objects/Assumptions/AssumptionsContext';

describe('federal 2024 senior-deduction rows (#192)', () => {
    it('2024 Single carries the $1,950 additional standard deduction at 65+', () => {
        const p = TAX_DATABASE.federal[2024].Single;
        expect(p.seniorDeduction).toBe(1950);
        expect(p.seniorAge).toBe(65);
    });

    it('2024 MFJ carries $1,550 per spouse (doubled via per-person flag)', () => {
        const p = TAX_DATABASE.federal[2024]['Married Filing Jointly'];
        expect(p.seniorDeduction).toBe(1550);
        expect(p.seniorAge).toBe(65);
        expect(p.seniorDeductionPerPerson).toBe(true);
    });

    it('2024 MFS carries $1,550 (per spouse, not doubled)', () => {
        const p = TAX_DATABASE.federal[2024]['Married Filing Separately'];
        expect(p.seniorDeduction).toBe(1550);
        expect(p.seniorAge).toBe(65);
        expect(p.seniorDeductionPerPerson).toBeUndefined();
    });

    it('2024 rows carry NO OBBBA senior bonus (it starts in 2025)', () => {
        for (const fs of ['Single', 'Married Filing Jointly', 'Married Filing Separately'] as const) {
            expect(TAX_DATABASE.federal[2024][fs].seniorBonusDeduction).toBeUndefined();
        }
    });
});

describe('demo data tax year is derived, not stale (#192)', () => {
    it('tracks the current calendar year clamped to the tax tables', () => {
        expect(defaultData.taxSettings.year).toBe(
            Math.min(new Date().getFullYear(), max_year),
        );
        // Regression guard for the literal this replaced.
        expect(defaultData.taxSettings.year).toBeGreaterThan(2024);
    });
});

describe('projected FICA wage base is single-sourced with SS benefit crediting (#192)', () => {
    const inflationAssumptions: AssumptionsState = {
        ...defaultAssumptions,
        macro: { ...defaultAssumptions.macro, inflationRate: 2.5, inflationAdjusted: true },
    };

    it('a post-2026 federal year taxes FICA to the SAME cap SS credits earnings against', () => {
        // 2028 is inside SSA's published/projected wage-base rows ($201,300) but
        // beyond the tax tables (max_year 2026). The old code CPI-inflated the
        // 2026 row (184,500 × 1.025² ≈ 193,842) while benefit crediting used the
        // SSA row — the same statutory cap resolved to two numbers in one year.
        const fed = getTaxParameters(2028, 'Single', 'federal', undefined, inflationAssumptions);
        expect(fed).toBeDefined();
        const benefitSide = getWageBase(2028, 0.025, true);
        expect(benefitSide).toBe(201300); // SSA projected row, sanity
        expect(fed!.socialSecurityWageBase).toBe(benefitSide);
    });

    it('beyond the SSA rows, both sides compound from the same base at the same rate', () => {
        const year = 2033; // past the last SSA row (2030)
        const fed = getTaxParameters(year, 'Single', 'federal', undefined, inflationAssumptions);
        expect(fed!.socialSecurityWageBase).toBe(getWageBase(year, 0.025, true));
    });

    it('state rows (wage base 0) stay 0', () => {
        const dc = getTaxParameters(2028, 'Single', 'state', 'DC', inflationAssumptions);
        expect(dc).toBeDefined();
        expect(dc!.socialSecurityWageBase).toBe(0);
    });
});

describe('CA 2025 schedule + MHST shape (#192)', () => {
    it('Single 2025: FTB standard deduction and first brackets', () => {
        const p = TAX_DATABASE.states['California'][2025].Single;
        expect(p.standardDeduction).toBe(5706);
        expect(p.brackets[1].threshold).toBe(11_079);
        expect(p.brackets[2].threshold).toBe(26_264);
    });

    it('every CA row tops out at 13.3% starting at the un-indexed $1M MHST threshold', () => {
        for (const year of [2025, 2026]) {
            for (const fs of ['Single', 'Married Filing Jointly', 'Married Filing Separately'] as const) {
                const brackets = TAX_DATABASE.states['California'][year][fs].brackets;
                const top = brackets[brackets.length - 1];
                const mhstStart = brackets.find(b => b.threshold === 1_000_000);
                expect(top.rate).toBeCloseTo(0.133, 6);
                expect(mhstStart).toBeDefined();
                // Above $1M every layer carries the +1% MHST.
                for (const b of brackets.filter(b => b.threshold >= 1_000_000)) {
                    expect(b.rate).toBeGreaterThanOrEqual(0.123);
                }
            }
        }
    });
});
