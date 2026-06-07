/**
 * Tests for extractIncomeForRMDEstimate
 *
 * This function extracts Social Security and pension income from the income context
 * for use in RMD planning calculations. It handles various income configurations:
 * - Current SS (already claiming)
 * - Future SS (not yet claiming, with PIA projection)
 * - Pension income (FERS, CSRS, or other)
 * - Inflation-adjusted COLA settings
 *
 * Tests use plain mock objects (not class instances) to match what the function
 * actually receives in production (deserialized localStorage data with className).
 */

import { describe, it, expect } from 'vitest';
import { extractIncomeForRMDEstimate } from '../../../services/simulation/helpers';
import {
    FutureSocialSecurityIncome,
    SocialSecurityIncome,
    PassiveIncome,
    FERSPensionIncome,
    CSRSPensionIncome,
    CurrentSocialSecurityIncome,
    WorkIncome,
    reconstituteIncome,
} from '../../../components/Objects/Income/models';

describe('extractIncomeForRMDEstimate', () => {

    describe('empty or missing income sources', () => {
        it('returns all zeros with default ssClaimingAge when no income sources', () => {
            const result = extractIncomeForRMDEstimate([], 2026, true);

            expect(result.socialSecurityBenefits).toBe(0);
            expect(result.futureSS_PIA).toBe(0);
            expect(result.ssClaimingAge).toBe(67); // Default claiming age
            expect(result.pensionIncome).toBe(0);
            expect(result.passiveIncome).toBe(0);
            expect(result.ssCola).toBe(0.02);      // inflationAdjusted=true
            expect(result.pensionCola).toBe(0.02);
        });

        it('ignores income without className property', () => {
            const incomes = [
                { name: 'Random Income', amount: 50000, getAnnualAmount: () => 50000 }, // No className
            ];

            const result = extractIncomeForRMDEstimate(incomes, 2026, true);

            expect(result.socialSecurityBenefits).toBe(0);
            expect(result.futureSS_PIA).toBe(0);
            expect(result.pensionIncome).toBe(0);
            expect(result.passiveIncome).toBe(0);
        });
    });

    describe('Social Security income extraction', () => {
        it('extracts current SocialSecurityIncome (already claiming)', () => {
            const ss = {
                className: 'SocialSecurityIncome',
                name: 'Current SS',
                amount: 30000,
                getAnnualAmount: () => 30000,
            };

            const result = extractIncomeForRMDEstimate([ss], 2026, true);

            expect(result.socialSecurityBenefits).toBe(30000);
            expect(result.futureSS_PIA).toBe(0);  // No future SS
            expect(result.ssClaimingAge).toBe(67); // Default (no FutureSS)
        });

        it('extracts FutureSocialSecurityIncome with projectedPIA', () => {
            // Person not yet claiming, projectedPIA = $2,500/month
            const futureSS = {
                className: 'FutureSocialSecurityIncome',
                projectedPIA: 2500,
                calculatedPIA: 2000,  // historical
                claimingAge: 70,
                getAnnualAmount: () => 0,  // Not claiming yet
            };

            const result = extractIncomeForRMDEstimate([futureSS], 2026, true);

            expect(result.socialSecurityBenefits).toBe(0);  // Not claiming yet
            expect(result.futureSS_PIA).toBe(2500);         // projectedPIA
            expect(result.ssClaimingAge).toBe(70);
        });

        it('falls back to calculatedPIA when projectedPIA is undefined', () => {
            const futureSS = {
                className: 'FutureSocialSecurityIncome',
                // projectedPIA: undefined (not set)
                calculatedPIA: 2200,
                claimingAge: 67,
                getAnnualAmount: () => 0,
            };

            const result = extractIncomeForRMDEstimate([futureSS], 2026, true);

            expect(result.futureSS_PIA).toBe(2200);  // Falls back to calculatedPIA
            expect(result.ssClaimingAge).toBe(67);
        });

        it('converts annual amount to monthly PIA when neither projectedPIA nor calculatedPIA available', () => {
            // Edge case: FutureSS with only amount field (annual)
            const futureSS = {
                className: 'FutureSocialSecurityIncome',
                amount: 36000,  // Annual (should convert to $3,000/month)
                claimingAge: 67,
                getAnnualAmount: () => 36000,
            };

            const result = extractIncomeForRMDEstimate([futureSS], 2026, true);

            expect(result.futureSS_PIA).toBe(3000);  // 36000 / 12
            expect(result.ssClaimingAge).toBe(67);
        });

        it('extracts CurrentSocialSecurityIncome (disability/survivor benefits)', () => {
            const currentSS = {
                className: 'CurrentSocialSecurityIncome',
                name: 'SSDI',
                amount: 18000,
                getAnnualAmount: () => 18000,
            };

            const result = extractIncomeForRMDEstimate([currentSS], 2026, true);

            expect(result.socialSecurityBenefits).toBe(18000);
            expect(result.futureSS_PIA).toBe(0);  // No future SS
        });

        it('sums SocialSecurityIncome and CurrentSocialSecurityIncome together', () => {
            const ss = {
                className: 'SocialSecurityIncome',
                getAnnualAmount: () => 25000,
            };
            const currentSS = {
                className: 'CurrentSocialSecurityIncome',
                getAnnualAmount: () => 12000,
            };

            const result = extractIncomeForRMDEstimate([ss, currentSS], 2026, true);

            expect(result.socialSecurityBenefits).toBe(37000);  // 25k + 12k
        });

        it('handles multiple SocialSecurityIncome objects (sums them)', () => {
            const ss1 = {
                className: 'SocialSecurityIncome',
                getAnnualAmount: () => 20000,
            };
            const ss2 = {
                className: 'SocialSecurityIncome',
                getAnnualAmount: () => 15000,
            };

            const result = extractIncomeForRMDEstimate([ss1, ss2], 2026, true);

            expect(result.socialSecurityBenefits).toBe(35000);  // 20k + 15k
        });

        it('prefers FutureSS even when multiple exist (uses first match)', () => {
            const futureSS1 = {
                className: 'FutureSocialSecurityIncome',
                projectedPIA: 3000,
                claimingAge: 70,
                getAnnualAmount: () => 0,
            };
            const futureSS2 = {
                className: 'FutureSocialSecurityIncome',
                projectedPIA: 2800,
                claimingAge: 67,
                getAnnualAmount: () => 0,
            };

            const result = extractIncomeForRMDEstimate([futureSS1, futureSS2], 2026, true);

            // Should use first match
            expect(result.futureSS_PIA).toBe(3000);  // futureSS1.projectedPIA
            expect(result.ssClaimingAge).toBe(70);    // futureSS1.claimingAge
        });
    });

    describe('pension income extraction', () => {
        it('extracts FERS pension income', () => {
            const fersPension = {
                className: 'FERSPensionIncome',
                getAnnualAmount: () => 24000,  // 30 years × $80,000 × 1%
            };

            const result = extractIncomeForRMDEstimate([fersPension], 2026, true);

            expect(result.pensionIncome).toBe(24000);
            expect(result.pensionCola).toBe(0.02);
        });

        it('extracts CSRS pension income', () => {
            const csrsPension = {
                className: 'CSRSPensionIncome',
                getAnnualAmount: () => 59625,  // Complex CSRS formula result
            };

            const result = extractIncomeForRMDEstimate([csrsPension], 2026, true);

            expect(result.pensionIncome).toBe(59625);
        });

        it('sums multiple pension incomes', () => {
            const fersPension = {
                className: 'FERSPensionIncome',
                getAnnualAmount: () => 14000,
            };
            const csrsPension = {
                className: 'CSRSPensionIncome',
                getAnnualAmount: () => 15750,
            };

            const result = extractIncomeForRMDEstimate([fersPension, csrsPension], 2026, true);

            expect(result.pensionIncome).toBe(14000 + 15750);
        });

        it('handles zero pension income', () => {
            const result = extractIncomeForRMDEstimate([], 2026, true);

            expect(result.pensionIncome).toBe(0);
        });

        it('filters by className containing "Pension"', () => {
            const fersPension = {
                className: 'FERSPensionIncome',
                getAnnualAmount: () => 14000,
            };
            const otherIncome = {
                className: 'WorkIncome',
                name: 'Salary',
                amount: 100000,
                getAnnualAmount: () => 100000,
            };

            const result = extractIncomeForRMDEstimate([fersPension, otherIncome], 2026, true);

            expect(result.pensionIncome).toBe(14000);  // Only FERS, not WorkIncome
        });
    });

    describe('passive income extraction', () => {
        it('extracts PassiveIncome (rental income)', () => {
            const passiveIncome = {
                className: 'PassiveIncome',
                name: 'Rental Income',
                getAnnualAmount: () => 40000,
            };

            const result = extractIncomeForRMDEstimate([passiveIncome], 2026, true);

            expect(result.passiveIncome).toBe(40000);
            expect(result.pensionIncome).toBe(0);  // Not pension
            expect(result.socialSecurityBenefits).toBe(0);
        });

        it('sums multiple PassiveIncome sources', () => {
            const rental = {
                className: 'PassiveIncome',
                name: 'Rental Income',
                getAnnualAmount: () => 40000,
            };
            const dividends = {
                className: 'PassiveIncome',
                name: 'Dividend Income',
                getAnnualAmount: () => 15000,
            };

            const result = extractIncomeForRMDEstimate([rental, dividends], 2026, true);

            expect(result.passiveIncome).toBe(55000);  // 40k + 15k
        });

        it('handles zero passive income', () => {
            const result = extractIncomeForRMDEstimate([], 2026, true);

            expect(result.passiveIncome).toBe(0);
        });

        it('filters by className "PassiveIncome" (not other income types)', () => {
            const passiveIncome = {
                className: 'PassiveIncome',
                getAnnualAmount: () => 30000,
            };
            const workIncome = {
                className: 'WorkIncome',
                name: 'Salary',
                getAnnualAmount: () => 100000,
            };

            const result = extractIncomeForRMDEstimate([passiveIncome, workIncome], 2026, true);

            expect(result.passiveIncome).toBe(30000);  // Only passive, not work
        });
    });

    describe('COLA rate extraction based on inflation settings', () => {
        it('sets COLA to 2% when inflationAdjusted is true', () => {
            const result = extractIncomeForRMDEstimate([], 2026, true);

            expect(result.ssCola).toBe(0.02);
            expect(result.pensionCola).toBe(0.02);
        });

        it('sets COLA to 0% when inflationAdjusted is false', () => {
            const result = extractIncomeForRMDEstimate([], 2026, false);

            expect(result.ssCola).toBe(0);
            expect(result.pensionCola).toBe(0);
        });
    });

    describe('combined income scenarios', () => {
        it('extracts both current SS and pension income', () => {
            const ss = {
                className: 'SocialSecurityIncome',
                getAnnualAmount: () => 32000,
            };
            const fersPension = {
                className: 'FERSPensionIncome',
                getAnnualAmount: () => 18750,
            };

            const result = extractIncomeForRMDEstimate([ss, fersPension], 2026, true);

            expect(result.socialSecurityBenefits).toBe(32000);
            expect(result.futureSS_PIA).toBe(0);  // Already claiming
            expect(result.pensionIncome).toBe(18750);
            expect(result.passiveIncome).toBe(0);
            expect(result.ssCola).toBe(0.02);
            expect(result.pensionCola).toBe(0.02);
        });

        it('extracts future SS and pension income', () => {
            const futureSS = {
                className: 'FutureSocialSecurityIncome',
                projectedPIA: 2800,
                claimingAge: 70,
                getAnnualAmount: () => 0,
            };
            const csrsPension = {
                className: 'CSRSPensionIncome',
                getAnnualAmount: () => 47812.50,
            };

            const result = extractIncomeForRMDEstimate([futureSS, csrsPension], 2026, true);

            expect(result.socialSecurityBenefits).toBe(0);  // Not claiming yet
            expect(result.futureSS_PIA).toBe(2800);
            expect(result.ssClaimingAge).toBe(70);
            expect(result.pensionIncome).toBe(47812.50);
            expect(result.passiveIncome).toBe(0);
        });

        it('handles all income types together', () => {
            const currentSS = {
                className: 'SocialSecurityIncome',
                getAnnualAmount: () => 28000,
            };
            const futureSS = {
                className: 'FutureSocialSecurityIncome',
                projectedPIA: 3000,
                claimingAge: 70,
                getAnnualAmount: () => 0,
            };
            const fersPension = {
                className: 'FERSPensionIncome',
                getAnnualAmount: () => 24000,
            };
            const csrsPension = {
                className: 'CSRSPensionIncome',
                getAnnualAmount: () => 25375,
            };

            const result = extractIncomeForRMDEstimate([currentSS, futureSS, fersPension, csrsPension], 2026, false);

            expect(result.socialSecurityBenefits).toBe(28000);
            expect(result.futureSS_PIA).toBe(3000);  // Uses first FutureSS
            expect(result.ssClaimingAge).toBe(70);
            expect(result.pensionIncome).toBe(24000 + 25375);
            expect(result.passiveIncome).toBe(0);
            expect(result.ssCola).toBe(0);        // inflationAdjusted=false
            expect(result.pensionCola).toBe(0);
        });

        it('handles all income types including passive income', () => {
            const currentSS = {
                className: 'SocialSecurityIncome',
                getAnnualAmount: () => 32000,
            };
            const futureSS = {
                className: 'FutureSocialSecurityIncome',
                projectedPIA: 2800,
                claimingAge: 67,
                getAnnualAmount: () => 0,
            };
            const fersPension = {
                className: 'FERSPensionIncome',
                getAnnualAmount: () => 28000,
            };
            const passiveIncome = {
                className: 'PassiveIncome',
                name: 'Rental Income',
                getAnnualAmount: () => 40000,
            };

            const result = extractIncomeForRMDEstimate([currentSS, futureSS, fersPension, passiveIncome], 2026, true);

            expect(result.socialSecurityBenefits).toBe(32000);
            expect(result.futureSS_PIA).toBe(2800);
            expect(result.ssClaimingAge).toBe(67);
            expect(result.pensionIncome).toBe(28000);
            expect(result.passiveIncome).toBe(40000);  // Rental income
            expect(result.ssCola).toBe(0.02);
            expect(result.pensionCola).toBe(0.02);
        });
    });

    describe('edge cases and fallback behavior', () => {
        it('handles FutureSS with missing optional fields gracefully', () => {
            const futureSS = {
                className: 'FutureSocialSecurityIncome',
                // No projectedPIA, calculatedPIA, or amount
                claimingAge: 68,
                getAnnualAmount: () => 0,
            };

            const result = extractIncomeForRMDEstimate([futureSS], 2026, true);

            expect(result.futureSS_PIA).toBe(0);  // No PIA available
            expect(result.ssClaimingAge).toBe(68);
        });

        it('handles FutureSS without claimingAge (uses default 67)', () => {
            const futureSS = {
                className: 'FutureSocialSecurityIncome',
                projectedPIA: 2500,
                // No claimingAge
                getAnnualAmount: () => 0,
            };

            const result = extractIncomeForRMDEstimate([futureSS], 2026, true);

            expect(result.futureSS_PIA).toBe(2500);
            expect(result.ssClaimingAge).toBe(67);  // Default
        });

        it('correctly prioritizes projectedPIA over amount over calculatedPIA', () => {
            const futureSS = {
                className: 'FutureSocialSecurityIncome',
                projectedPIA: 3000,
                amount: 36000,      // Would be $3,000/month
                calculatedPIA: 2500,
                claimingAge: 67,
                getAnnualAmount: () => 36000,
            };

            const result = extractIncomeForRMDEstimate([futureSS], 2026, true);

            // Priority: projectedPIA > amount/12 > calculatedPIA
            expect(result.futureSS_PIA).toBe(3000);  // projectedPIA wins
        });

        it('uses amount/12 when projectedPIA is undefined but amount exists', () => {
            const futureSS = {
                className: 'FutureSocialSecurityIncome',
                // projectedPIA: undefined (not set)
                amount: 42000,      // $3,500/month
                calculatedPIA: 2800,
                claimingAge: 67,
                getAnnualAmount: () => 42000,
            };

            const result = extractIncomeForRMDEstimate([futureSS], 2026, true);

            expect(result.futureSS_PIA).toBe(3500);  // 42000 / 12
        });

        it('handles incomes with undefined className gracefully', () => {
            const incomes = [
                { name: 'Income 1', getAnnualAmount: () => 0 },  // No className
                { className: undefined, name: 'Income 2', getAnnualAmount: () => 0 },
                { className: null, name: 'Income 3', getAnnualAmount: () => 0 },
            ];

            const result = extractIncomeForRMDEstimate(incomes, 2026, true);

            expect(result.socialSecurityBenefits).toBe(0);
            expect(result.futureSS_PIA).toBe(0);
            expect(result.pensionIncome).toBe(0);
            expect(result.passiveIncome).toBe(0);
        });
    });

    describe('integration with estimateFixedIncomeAtRMD', () => {
        it('produces correct output format for feeding into estimateFixedIncomeAtRMD', () => {
            const futureSS = {
                className: 'FutureSocialSecurityIncome',
                projectedPIA: 2500,
                claimingAge: 70,
                getAnnualAmount: () => 0,
            };
            const fersPension = {
                className: 'FERSPensionIncome',
                getAnnualAmount: () => 18750,
            };

            const result = extractIncomeForRMDEstimate([futureSS, fersPension], 2026, true);

            // Verify all required fields are present and correctly typed
            expect(typeof result.socialSecurityBenefits).toBe('number');
            expect(typeof result.futureSS_PIA).toBe('number');
            expect(typeof result.ssClaimingAge).toBe('number');
            expect(typeof result.pensionIncome).toBe('number');
            expect(typeof result.passiveIncome).toBe('number');
            expect(typeof result.ssCola).toBe('number');
            expect(typeof result.pensionCola).toBe('number');

            // Verify values are sensible
            expect(result.socialSecurityBenefits).toBe(0);  // Not claiming yet
            expect(result.futureSS_PIA).toBe(2500);
            expect(result.ssClaimingAge).toBe(70);
            expect(result.pensionIncome).toBe(18750);
            expect(result.passiveIncome).toBe(0);
            expect(result.ssCola).toBe(0.02);
            expect(result.pensionCola).toBe(0.02);
        });
    });

    // =========================================================================
    // CLASS INSTANCE TESTS
    // =========================================================================
    // These tests verify that extractIncomeForRMDEstimate works with actual
    // class instances (not just plain mock objects). This is the scenario that
    // caused the SS=$0 bug: reconstituted class instances from IncomeContext
    // must have className as an own property for the 'className' in i check.
    // =========================================================================

    describe('with real class instances (regression for className bug)', () => {

        it('extracts FutureSocialSecurityIncome class instance with projectedPIA', () => {
            const futureSS = new FutureSocialSecurityIncome(
                'ss-1', 'Social Security (Age 67)',
                67,     // claimingAge
                0,      // calculatedPIA (not yet calculated)
                2026,   // calculationYear
                new Date('2068-01-01'),  // startDate
                new Date('2091-12-31'),  // end_date
                undefined,               // startMilestoneId
                undefined,               // endMilestoneId
                2500                     // projectedPIA ($2,500/month)
            );

            const result = extractIncomeForRMDEstimate([futureSS], 2026, true);

            expect(result.futureSS_PIA).toBe(2500);
            expect(result.ssClaimingAge).toBe(67);
            expect(result.socialSecurityBenefits).toBe(0);  // Not yet claiming
        });

        it('extracts FutureSocialSecurityIncome with calculatedPIA (projectedPIA=0)', () => {
            // When projectedPIA=0, the extraction falls back to amount/12.
            // Since amount = calculatedPIA * 12 (set in constructor), this returns calculatedPIA.
            // This is correct: when the engine hasn't projected PIA yet, use the
            // user-entered calculatedPIA as the best available estimate.
            const futureSS = new FutureSocialSecurityIncome(
                'ss-2', 'Social Security',
                70,     // claimingAge
                2200,   // calculatedPIA ($2,200/month)
                2026,   // calculationYear
                new Date('2071-01-01'),
                new Date('2091-12-31'),
                undefined, undefined,
                0       // projectedPIA = 0 (class default)
            );

            const result = extractIncomeForRMDEstimate([futureSS], 2026, true);

            // projectedPIA=0 is falsy, so falls to amount/12 = calculatedPIA = 2200
            expect(result.futureSS_PIA).toBe(2200);
            expect(result.ssClaimingAge).toBe(70);
        });

        it('extracts FutureSocialSecurityIncome with non-zero calculatedPIA and projectedPIA', () => {
            // After the engine calculates PIA, both are set to real values
            const futureSS = new FutureSocialSecurityIncome(
                'ss-2b', 'Social Security',
                67,     // claimingAge
                2200,   // calculatedPIA
                2026,   // calculationYear
                new Date('2067-01-01'),
                new Date('2091-12-31'),
                undefined, undefined,
                2800    // projectedPIA (engine-calculated, higher than calculatedPIA)
            );

            const result = extractIncomeForRMDEstimate([futureSS], 2026, true);

            expect(result.futureSS_PIA).toBe(2800);  // projectedPIA wins
            expect(result.ssClaimingAge).toBe(67);
        });

        it('extracts SocialSecurityIncome class instance (already claiming)', () => {
            const ss = new SocialSecurityIncome(
                'ss-3', 'My SS',
                2500,        // amount ($2,500/month)
                'Monthly',   // frequency
                67,          // claimingAge
                undefined,   // fullRetirementAgeBenefit
                new Date('2025-01-01'),
                undefined
            );

            const result = extractIncomeForRMDEstimate([ss], 2026, true);

            // SocialSecurityIncome with Monthly frequency: $2,500 * 12 = $30,000/year
            // But getAnnualAmount with year applies active multiplier
            expect(result.socialSecurityBenefits).toBe(30000);
            expect(result.futureSS_PIA).toBe(0);  // No future SS
        });

        it('extracts CurrentSocialSecurityIncome class instance (disability/survivor)', () => {
            const currentSS = new CurrentSocialSecurityIncome(
                'css-1', 'SSDI Benefits',
                1800,        // amount ($1,800/month)
                'Monthly',   // frequency
                new Date('2024-01-01'),
                undefined
            );

            const result = extractIncomeForRMDEstimate([currentSS], 2026, true);

            // CurrentSocialSecurityIncome now included in SS filter (previously missed)
            expect(result.socialSecurityBenefits).toBe(21600);  // $1,800 * 12
            expect(result.futureSS_PIA).toBe(0);
        });

        it('sums SocialSecurityIncome and CurrentSocialSecurityIncome together', () => {
            const legacySS = new SocialSecurityIncome(
                'ss-legacy', 'Retirement SS',
                2000, 'Monthly', 67,
                undefined, new Date('2025-01-01')
            );
            const currentSS = new CurrentSocialSecurityIncome(
                'css-1', 'Survivor Benefits',
                800, 'Monthly',
                new Date('2024-01-01')
            );

            const result = extractIncomeForRMDEstimate([legacySS, currentSS], 2026, true);

            // Both SS types should be summed
            expect(result.socialSecurityBenefits).toBe(33600);  // (2000 + 800) * 12
        });

        it('extracts FERSPensionIncome class instance', () => {
            // Start date must be <= currentYear for getAnnualAmount(2026) to return non-zero
            const fers = new FERSPensionIncome(
                'fers-1', 'FERS Pension',
                30,      // yearsOfService
                100000,  // high3Salary
                62,      // retirementAge
                1970,    // birthYear
                24000,   // calculatedBenefit (annual)
                0, 0,    // fersSupplement, estimatedSSAt62
                new Date('2025-01-01'),  // Already receiving pension
                undefined
            );

            const result = extractIncomeForRMDEstimate([fers], 2026, true);

            expect(result.pensionIncome).toBe(24000);
            expect(result.pensionCola).toBe(0.02);
        });

        it('extracts CSRSPensionIncome class instance', () => {
            const csrs = new CSRSPensionIncome(
                'csrs-1', 'CSRS Pension',
                25,      // yearsOfService
                90000,   // high3Salary
                55,      // retirementAge
                40000,   // calculatedBenefit (annual)
                new Date('2025-01-01'),
                undefined
            );

            const result = extractIncomeForRMDEstimate([csrs], 2026, true);

            expect(result.pensionIncome).toBe(40000);
        });

        it('extracts PassiveIncome class instance', () => {
            const rental = new PassiveIncome(
                'passive-1', 'Rental Income',
                3000,      // amount
                'Monthly', // frequency
                'No',      // earned_income
                'Rental',  // sourceType
                new Date('2025-01-01'),
                undefined
            );

            const result = extractIncomeForRMDEstimate([rental], 2026, true);

            expect(result.passiveIncome).toBe(36000);  // $3,000 * 12
        });

        it('correctly ignores WorkIncome class instances', () => {
            const work = new WorkIncome(
                'work-1', 'Day Job',
                100000,      // amount
                'Annually',  // frequency
                'Yes',       // earned_income
                10000,       // preTax401k
                200,         // insurance
                0,           // roth401k
                5000,        // employerMatch
                'acc-1',     // matchAccountId
                'Traditional 401k',
                'FIXED',
                new Date('2025-01-01'),
                undefined
            );

            const result = extractIncomeForRMDEstimate([work], 2026, true);

            expect(result.socialSecurityBenefits).toBe(0);
            expect(result.futureSS_PIA).toBe(0);
            expect(result.pensionIncome).toBe(0);
            expect(result.passiveIncome).toBe(0);
        });

        it('handles mixed class instances (reconstituted-scenario pattern)', () => {
            // Mimics a reconstituted scenario: work income + future SS + passive
            const salary = new WorkIncome(
                'inc-1', 'Salary', 120000, 'Annually', 'Yes',
                10000, 17, 0, 4000, 'acc-1', 'Traditional 401k', 'GROW_WITH_SALARY',
                new Date('2026-01-01'), undefined
            );

            const futureSS = new FutureSocialSecurityIncome(
                'inc-2', 'Social Security (Age 67)',
                67,                        // claimingAge
                0,                         // calculatedPIA (not yet calculated)
                2026,                      // calculationYear
                new Date('2068-01-01'),    // startDate
                new Date('2091-12-31'),    // end_date
                undefined, undefined,
                3000                    // projectedPIA
            );

            const result = extractIncomeForRMDEstimate([salary, futureSS], 2026, true);

            expect(result.socialSecurityBenefits).toBe(0);   // Not yet claiming
            expect(result.futureSS_PIA).toBe(3000);       // projectedPIA from engine
            expect(result.ssClaimingAge).toBe(67);
            expect(result.pensionIncome).toBe(0);
            expect(result.passiveIncome).toBe(0);
            expect(result.ssCola).toBe(0.02);
        });

        it('handles all income class types together', () => {
            const ss = new SocialSecurityIncome(
                'ss-1', 'Spouse SS', 2000, 'Monthly', 65,
                undefined, new Date('2025-01-01')
            );
            const futureSS = new FutureSocialSecurityIncome(
                'ss-2', 'My SS', 70, 0, 2026,
                new Date('2071-01-01'), new Date('2091-12-31'),
                undefined, undefined, 3000
            );
            const fers = new FERSPensionIncome(
                'fers-1', 'FERS', 25, 85000, 62, 1970, 18000,
                0, 0, new Date('2025-01-01')  // Already receiving pension
            );
            const rental = new PassiveIncome(
                'passive-1', 'Rental', 2500, 'Monthly', 'No', 'Rental',
                new Date('2025-01-01')
            );
            const work = new WorkIncome(
                'work-1', 'Salary', 120000, 'Annually', 'Yes',
                10000, 200, 0, 5000, 'acc-1', 'Traditional 401k', 'FIXED',
                new Date('2025-01-01')
            );

            const result = extractIncomeForRMDEstimate(
                [ss, futureSS, fers, rental, work], 2026, true
            );

            expect(result.socialSecurityBenefits).toBe(24000);  // $2,000 * 12
            expect(result.futureSS_PIA).toBe(3000);
            expect(result.ssClaimingAge).toBe(70);
            expect(result.pensionIncome).toBe(18000);
            expect(result.passiveIncome).toBe(30000);           // $2,500 * 12
        });
    });

    // =========================================================================
    // RECONSTITUTED OBJECT TESTS (localStorage round-trip)
    // =========================================================================
    // These tests simulate the full path: JSON -> reconstituteIncome() -> class
    // instance -> extractIncomeForRMDEstimate(). This is the actual production
    // path where data comes from localStorage/import.
    // =========================================================================

    describe('with reconstituted objects (localStorage round-trip)', () => {

        it('reconstituted FutureSocialSecurityIncome has className and works with extraction', () => {
            const json = {
                className: 'FutureSocialSecurityIncome',
                id: 'ss-recon-1',
                name: 'Social Security (Age 67)',
                amount: 0,
                frequency: 'Annually',
                claimingAge: 67,
                calculatedPIA: 0,
                calculationYear: 2026,
                projectedPIA: 2800,
                startDate: '2068-01-01',
                end_date: '2091-12-31',
            };

            const reconstituted = reconstituteIncome(json);
            expect(reconstituted).not.toBeNull();
            expect(reconstituted!.className).toBe('FutureSocialSecurityIncome');

            const result = extractIncomeForRMDEstimate([reconstituted!], 2026, true);

            expect(result.futureSS_PIA).toBe(2800);
            expect(result.ssClaimingAge).toBe(67);
            expect(result.socialSecurityBenefits).toBe(0);
        });

        it('reconstituted SocialSecurityIncome works with extraction', () => {
            const json = {
                className: 'SocialSecurityIncome',
                id: 'ss-recon-2',
                name: 'Current SS',
                amount: 30000,
                frequency: 'Annually',
                claimingAge: 67,
                startDate: '2025-01-01',
            };

            const reconstituted = reconstituteIncome(json);
            expect(reconstituted).not.toBeNull();
            expect(reconstituted!.className).toBe('SocialSecurityIncome');

            const result = extractIncomeForRMDEstimate([reconstituted!], 2026, true);

            expect(result.socialSecurityBenefits).toBe(30000);
        });

        it('reconstituted CurrentSocialSecurityIncome works with extraction', () => {
            const json = {
                className: 'CurrentSocialSecurityIncome',
                id: 'css-recon-1',
                name: 'SSDI Benefits',
                amount: 1800,
                frequency: 'Monthly',
                startDate: '2024-01-01',
            };

            const reconstituted = reconstituteIncome(json);
            expect(reconstituted).not.toBeNull();
            expect(reconstituted!.className).toBe('CurrentSocialSecurityIncome');

            const result = extractIncomeForRMDEstimate([reconstituted!], 2026, true);

            expect(result.socialSecurityBenefits).toBe(21600);  // $1,800 * 12
        });

        it('reconstituted FERSPensionIncome works with extraction', () => {
            const json = {
                className: 'FERSPensionIncome',
                id: 'fers-recon-1',
                name: 'FERS Pension',
                amount: 24000,
                frequency: 'Annually',
                yearsOfService: 30,
                high3Salary: 100000,
                retirementAge: 62,
                birthYear: 1970,
                calculatedBenefit: 24000,
                startDate: '2025-01-01',  // Already receiving pension
            };

            const reconstituted = reconstituteIncome(json);
            expect(reconstituted).not.toBeNull();
            expect(reconstituted!.className).toBe('FERSPensionIncome');

            const result = extractIncomeForRMDEstimate([reconstituted!], 2026, true);

            expect(result.pensionIncome).toBe(24000);
        });

        it('reconstituted PassiveIncome works with extraction', () => {
            const json = {
                className: 'PassiveIncome',
                id: 'passive-recon-1',
                name: 'Rental Income',
                amount: 3000,
                frequency: 'Monthly',
                earned_income: 'No',
                sourceType: 'Rental',
                startDate: '2025-01-01',
            };

            const reconstituted = reconstituteIncome(json);
            expect(reconstituted).not.toBeNull();
            expect(reconstituted!.className).toBe('PassiveIncome');

            const result = extractIncomeForRMDEstimate([reconstituted!], 2026, true);

            expect(result.passiveIncome).toBe(36000);  // $3,000 * 12
        });

        it('full reconstituted scenario (reconstituted-scenario pattern)', () => {
            const workJson = {
                className: 'WorkIncome',
                id: 'inc-1',
                name: 'Salary',
                amount: 120000,
                frequency: 'Annually',
                earned_income: 'Yes',
                preTax401k: 10000,
                insurance: 17,
                roth401k: 0,
                employerMatch: 4000,
                matchAccountId: 'acc-1',
                taxType: 'Traditional 401k',
                contributionGrowthStrategy: 'GROW_WITH_SALARY',
                startDate: '2026-01-01',
                autoMax401k: 'traditional',
            };
            const ssJson = {
                className: 'FutureSocialSecurityIncome',
                id: 'inc-2',
                name: 'Social Security (Age 67)',
                amount: 0,
                frequency: 'Annually',
                claimingAge: 67,
                calculatedPIA: 0,
                calculationYear: 2026,
                projectedPIA: 3000,
                startDate: '2068-01-01',
                end_date: '2091-12-31',
            };

            const reconWork = reconstituteIncome(workJson)!;
            const reconSS = reconstituteIncome(ssJson)!;
            expect(reconWork).not.toBeNull();
            expect(reconSS).not.toBeNull();

            const result = extractIncomeForRMDEstimate([reconWork, reconSS], 2026, true);

            expect(result.socialSecurityBenefits).toBe(0);     // Not yet claiming
            expect(result.futureSS_PIA).toBe(3000);         // projectedPIA preserved
            expect(result.ssClaimingAge).toBe(67);
            expect(result.pensionIncome).toBe(0);
            expect(result.passiveIncome).toBe(0);
            expect(result.ssCola).toBe(0.02);
            expect(result.pensionCola).toBe(0.02);
        });

        it('reconstituted FutureSS with calculatedPIA but no projectedPIA falls back to amount/12', () => {
            // When projectedPIA is not in the JSON, reconstituteIncome sets it to 0.
            // Since 0 is falsy, the extraction falls back to amount/12 = 26400/12 = 2200.
            // This is correct: calculatedPIA is the best available estimate before
            // the engine projects PIA from earnings history.
            const json = {
                className: 'FutureSocialSecurityIncome',
                id: 'ss-fallback',
                name: 'SS Fallback',
                amount: 26400,          // calculatedPIA * 12
                frequency: 'Annually',
                claimingAge: 67,
                calculatedPIA: 2200,
                calculationYear: 2025,
                // projectedPIA not set -> reconstituteIncome defaults to 0
                startDate: '2067-01-01',
            };

            const reconstituted = reconstituteIncome(json);
            expect(reconstituted).not.toBeNull();

            const result = extractIncomeForRMDEstimate([reconstituted!], 2026, true);

            // projectedPIA=0 (falsy), falls back to amount/12 = 26400/12 = 2200
            expect(result.futureSS_PIA).toBe(2200);
            expect(result.ssClaimingAge).toBe(67);
        });

        it('reconstituted FutureSS with non-zero projectedPIA extracts correctly', () => {
            const json = {
                className: 'FutureSocialSecurityIncome',
                id: 'ss-projected',
                name: 'SS With Projection',
                amount: 0,
                frequency: 'Annually',
                claimingAge: 70,
                calculatedPIA: 0,
                calculationYear: 2026,
                projectedPIA: 3200,     // Engine-calculated projection
                startDate: '2071-01-01',
                end_date: '2091-12-31',
            };

            const reconstituted = reconstituteIncome(json);
            expect(reconstituted).not.toBeNull();

            const result = extractIncomeForRMDEstimate([reconstituted!], 2026, true);

            expect(result.futureSS_PIA).toBe(3200);
            expect(result.ssClaimingAge).toBe(70);
        });
    });

    // =========================================================================
    // className PROPERTY VERIFICATION
    // =========================================================================

    describe('className property exists on all income class instances', () => {
        it('FutureSocialSecurityIncome has className as own property', () => {
            const inst = new FutureSocialSecurityIncome('id', 'name', 67);
            expect(inst.className).toBe('FutureSocialSecurityIncome');
            expect('className' in inst).toBe(true);
        });

        it('SocialSecurityIncome has className as own property', () => {
            const inst = new SocialSecurityIncome('id', 'name', 2000, 'Monthly', 67);
            expect(inst.className).toBe('SocialSecurityIncome');
            expect('className' in inst).toBe(true);
        });

        it('CurrentSocialSecurityIncome has className as own property', () => {
            const inst = new CurrentSocialSecurityIncome('id', 'name', 2000, 'Monthly');
            expect(inst.className).toBe('CurrentSocialSecurityIncome');
            expect('className' in inst).toBe(true);
        });

        it('PassiveIncome has className as own property', () => {
            const inst = new PassiveIncome('id', 'name', 3000, 'Monthly', 'No', 'Rental');
            expect(inst.className).toBe('PassiveIncome');
            expect('className' in inst).toBe(true);
        });

        it('FERSPensionIncome has className as own property', () => {
            const inst = new FERSPensionIncome('id', 'name', 20, 80000, 62, 1970);
            expect(inst.className).toBe('FERSPensionIncome');
            expect('className' in inst).toBe(true);
        });

        it('CSRSPensionIncome has className as own property', () => {
            const inst = new CSRSPensionIncome('id', 'name', 25, 90000, 55);
            expect(inst.className).toBe('CSRSPensionIncome');
            expect('className' in inst).toBe(true);
        });

        it('WorkIncome has className as own property', () => {
            const inst = new WorkIncome(
                'id', 'name', 100000, 'Annually', 'Yes',
                0, 0, 0, 0, 'acc-1'
            );
            expect(inst.className).toBe('WorkIncome');
            expect('className' in inst).toBe(true);
        });
    });
});
