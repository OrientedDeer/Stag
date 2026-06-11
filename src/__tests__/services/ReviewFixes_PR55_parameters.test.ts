/**
 * Regression tests for PR #55 review fixes in getTaxParameters (parameters.ts):
 *  - #2: inflation branch must also inflate seniorDeduction (dollar amount)
 *  - #5: a partial assumptions object missing inflationRate must not poison
 *        results with NaN (treat non-finite inflation as 0%)
 *  - #9: nearest-year fallback (extracted findNearestYear helper) still resolves
 *        a missing-year query to the closest present year
 *
 * #6 (newer-year tie-break, `<` -> `<=` in findNearestYear) is latent: no real
 * TAX_DATABASE table has a gap that produces an exact equidistant tie, so it is
 * intentionally NOT unit-tested here (noted in the PR report).
 */

import { describe, it, expect } from 'vitest';
import { getTaxParameters } from '../../components/Objects/Taxes/taxService/parameters';
import { defaultAssumptions } from '../../components/Objects/Assumptions/AssumptionsContext';
import { max_year } from '../../data/TaxData';

describe('PR55 getTaxParameters review fixes', () => {
    describe('#2 inflation branch inflates seniorDeduction', () => {
        it('inflates Virginia seniorDeduction by the same multiplier as brackets', () => {
            const inflationRate = 2.5;
            const targetYear = 2050;
            const assumptions = {
                ...defaultAssumptions,
                macro: {
                    ...defaultAssumptions.macro,
                    inflationAdjusted: true,
                    inflationRate,
                },
            };

            const params = getTaxParameters(
                targetYear,
                'Married Filing Jointly',
                'state',
                'Virginia',
                assumptions
            );

            expect(params).toBeDefined();

            // Base year for Virginia is max_year (2026), which is present.
            const multiplier = Math.pow(
                1 + inflationRate / 100,
                targetYear - max_year
            );

            // Nominal VA senior deduction is $12,000.
            const expectedSenior = Math.round(12000 * multiplier);
            expect(params!.seniorDeduction).toBeDefined();
            // Allow $1 of rounding slack.
            expect(Math.abs(params!.seniorDeduction! - expectedSenior)).toBeLessThanOrEqual(1);

            // And a bracket threshold must be inflated by the same multiplier.
            // VA MFJ has a $17,000 (5.75%) bracket threshold.
            const inflatedBracket = params!.brackets.find(
                (b) => Math.abs(b.threshold - Math.round(17000 * multiplier)) <= 1
            );
            expect(inflatedBracket).toBeDefined();

            // seniorAge is an age, not dollars: must stay 65.
            expect(params!.seniorAge).toBe(65);
        });
    });

    describe('#5 NaN guard on missing inflationRate', () => {
        it('returns finite numbers when inflationRate is absent from a partial assumptions object', () => {
            const params = getTaxParameters(
                2030,
                'Single',
                'federal',
                undefined,
                // Partial object: inflationAdjusted set but no inflationRate.
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                { macro: { inflationAdjusted: true } } as any
            );

            expect(params).toBeDefined();
            expect(Number.isFinite(params!.standardDeduction)).toBe(true);
            for (const bracket of params!.brackets) {
                expect(Number.isFinite(bracket.threshold)).toBe(true);
            }
            expect(Number.isFinite(params!.socialSecurityWageBase)).toBe(true);
            for (const bracket of params!.capitalGainsBrackets ?? []) {
                expect(Number.isFinite(bracket.threshold)).toBe(true);
            }
        });
    });

    describe('#9 findNearestYear fallback characterization', () => {
        it('resolves California 2024 (no entry) to the nearest present year', () => {
            // California only has 2025 and 2026 entries; a 2024 query must fall
            // back to the nearest present year rather than returning undefined.
            const params = getTaxParameters(2024, 'Single', 'state', 'California');
            expect(params).toBeDefined();
            expect(Number.isFinite(params!.standardDeduction)).toBe(true);
            expect(params!.brackets.length).toBeGreaterThan(0);
        });
    });
});
