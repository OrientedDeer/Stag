/**
 * Regression: the FICA earned-income wage-base test must use EARNED income, not
 * total gross, in the Tax Optimization tab.
 *
 * getCombinedMarginalRate gained an `earnedIncome` parameter so the 6.2% Social
 * Security marginal component (and the 0.9% Additional Medicare surtax) key off
 * FICA-eligible WAGES — mirroring calculateFicaTax, which tests its earned
 * taxableBase, not total gross. But the parameter defaults to grossIncome, and
 * the live callers (analyzeTaxSituation, generateTaxProjections) originally
 * omitted it. So for a still-working person whose gross income (wages + SS /
 * pension / passive) exceeds the SS wage base while WAGES stay below it, the
 * marginal rate dropped the 6.2% SS component — understating the rate by ~6.2pts
 * and biasing the optimizer's convert-vs-withdraw decision.
 *
 * These tests drive the real call sites (not the function in isolation) so a
 * regression of the wiring is caught, not just the function signature.
 */

import { describe, it, expect } from 'vitest';
import {
    analyzeTaxSituation,
    generateTaxProjections,
} from '../../services/TaxOptimizationService';
import { getCombinedMarginalRate } from '../../components/Objects/Taxes/TaxService';
import { SimulationYear } from '../../services/simulation/types';
import {
    AssumptionsState,
    defaultAssumptions,
    createBuiltinMilestones,
} from '../../components/Objects/Assumptions/AssumptionsContext';
import { TaxState } from '../../components/Objects/Taxes/TaxContext';
import { WorkIncome, PassiveIncome } from '../../components/Objects/Income/models';

// --- Helpers ---

const noInflationAssumptions: AssumptionsState = {
    ...defaultAssumptions,
    // Born 1980 → still working in 2025 (age 45 < retirement 65); no inflation so
    // the 2025 SS wage base ($176,100) and surtax thresholds apply as-is.
    milestones: createBuiltinMilestones(1980, 65, 90),
    macro: {
        ...defaultAssumptions.macro,
        inflationAdjusted: false,
        inflationRate: 0,
    },
};

// Born 1955 → age 70 in 2025, retired (>= retirement 65). Same no-inflation macro
// so the 2025 SS wage base / surtax thresholds apply as-is. Used to confirm
// analyzeTaxSituation and generateTaxProjections AGREE on FICA inclusion for a
// retired year that still carries residual wages.
const retiredNoInflationAssumptions: AssumptionsState = {
    ...noInflationAssumptions,
    milestones: createBuiltinMilestones(1955, 65, 90),
};

const createTaxState = (overrides: Partial<TaxState> = {}): TaxState => ({
    filingStatus: 'Single',
    stateResidency: 'Texas', // no state income tax → isolate federal + FICA
    deductionMethod: 'Standard',
    fedOverride: null,
    ficaOverride: null,
    stateOverride: null,
    year: 2025,
    ...overrides,
});

/**
 * Working person: $100k WAGES (< $176,100 SS wage base, < $200k Single surtax
 * threshold) PLUS $120k of NON-earned passive income (earned_income: 'No').
 * Gross = $220k (above both the wage base and the surtax threshold), but the
 * FICA-eligible earned base is just the $100k wage.
 */
function mixedWageAndPassiveYear(): SimulationYear {
    const wages = new WorkIncome(
        'w1', 'Job', 100000, 'Annually',
        'Yes', // earned_income
        0, 0, 0, 0, // preTax401k, insurance, roth401k, employerMatch
        '', null, 'FIXED',
        new Date('2025-01-01'), new Date('2025-12-31'),
    );
    const passive = new PassiveIncome(
        'p1', 'Rental', 120000, 'Annually',
        'No', // NOT earned income — counts in gross but not the FICA earned base
        'Rental',
        new Date('2025-01-01'), new Date('2025-12-31'),
    );

    return {
        year: 2025,
        incomes: [wages, passive],
        expenses: [],
        accounts: [],
        cashflow: {
            totalIncome: 220000,
            totalExpense: 0,
            livingExpenses: 0,
            discretionary: 0,
            investedUser: 0,
            investedMatch: 0,
            totalInvested: 0,
            bucketAllocations: 0,
            bucketDetail: {},
            withdrawals: 0,
            withdrawalDetail: {},
        },
        taxDetails: {
            fed: 40000, state: 0, fica: 9000,
            preTax: 0, insurance: 0, postTax: 0, capitalGains: 0,
            withdrawalOrdinaryTax: 0, niit: 0,
        },
        logs: [],
    };
}

describe('Tax Optimization FICA marginal rate uses EARNED income (regression)', () => {
    it('analyzeTaxSituation keeps the 6.2% SS marginal when wages < wage base but gross > base', () => {
        const result = analyzeTaxSituation(
            mixedWageAndPassiveYear(),
            noInflationAssumptions,
            createTaxState(),
        );

        // Earned base = $100k < $176,100 wage base → SS 6.2% applies.
        // Earned base = $100k < $200k Single surtax threshold → no 0.9% surtax.
        // Expected FICA marginal = 6.2% + 1.45% = 7.65%.
        // The bug (earnedIncome defaulting to the $220k gross) dropped the 6.2% SS
        // and ADDED the surtax → 1.45% + 0.9% = 2.35%.
        expect(result.marginalRate.fica).toBeCloseTo(0.0765, 6);
    });

    it('generateTaxProjections keeps the 6.2% SS marginal in the working year', () => {
        const result = generateTaxProjections(
            [mixedWageAndPassiveYear()],
            noInflationAssumptions,
            createTaxState(),
        );

        expect(result).toHaveLength(1);
        // marginalRate here is the COMBINED rate; with no state tax it is
        // federal + fica. The combined rate must include the 6.2% SS component,
        // so it must exceed the federal bracket rate by at least ~7.65pts (and
        // certainly by more than the buggy 2.35pts).
        const federalRate = result[0].federalBracket / 100;
        expect(result[0].marginalRate - federalRate).toBeCloseTo(0.0765, 4);
    });
});

describe('getCombinedMarginalRate surtax keys off earnedIncome (consistency with calculateFicaTax)', () => {
    it('does NOT add the 0.9% surtax when earned wages are below the threshold but gross is above it', () => {
        // Gross $260k (> $200k Single surtax threshold AND > wage base), but the
        // explicit earned base is only $100k.
        const result = getCombinedMarginalRate(
            260000, // grossIncome
            0,      // preTaxDeductions
            createTaxState(),
            2025,
            noInflationAssumptions,
            true,   // includesFICA
            100000, // earnedIncome (wages)
        );

        // $100k wages < $176,100 base → SS applies; < $200k threshold → no surtax.
        expect(result.fica).toBeCloseTo(0.0765, 6);
    });

    it('still adds the 0.9% surtax when earned wages clear the threshold', () => {
        const result = getCombinedMarginalRate(
            260000,
            0,
            createTaxState(),
            2025,
            noInflationAssumptions,
            true,
            260000, // earnedIncome = all wages, above the wage base and surtax threshold
        );

        // Wages above the wage base → SS dropped; above $200k threshold → +0.9%.
        expect(result.fica).toBeCloseTo(0.0235, 6);
    });
});

describe('analyzeTaxSituation and generateTaxProjections agree on FICA inclusion by age', () => {
    // generateTaxProjections is age-aware (includesFICA = age < retirementAge).
    // analyzeTaxSituation must use the SAME age test so the two surfaces don't
    // disagree on a retired year that still carries residual wages — otherwise
    // analyzeTaxSituation would tack a ~7.65pt FICA marginal onto a retired
    // person's rate that generateTaxProjections (correctly) omits.
    it('a retired year with residual wages excludes FICA from BOTH surfaces', () => {
        const simYear = mixedWageAndPassiveYear(); // $100k residual wages in 2025

        // Born 1955 → age 70 in 2025, retired → FICA must NOT be applied.
        const analysis = analyzeTaxSituation(
            simYear,
            retiredNoInflationAssumptions,
            createTaxState(),
        );
        const projections = generateTaxProjections(
            [simYear],
            retiredNoInflationAssumptions,
            createTaxState(),
        );

        expect(projections).toHaveLength(1);

        // Retired → no FICA marginal on either surface.
        expect(analysis.marginalRate.fica).toBe(0);

        // And the combined marginal rates must agree (both fed-only, since the
        // state is Texas with no income tax and FICA is excluded for both).
        expect(analysis.marginalRate.combined).toBeCloseTo(projections[0].marginalRate, 6);
    });

    it('a working year with residual wages includes FICA in BOTH surfaces', () => {
        const simYear = mixedWageAndPassiveYear();

        // Born 1980 → age 45 in 2025, working → FICA applies on both surfaces.
        const analysis = analyzeTaxSituation(
            simYear,
            noInflationAssumptions,
            createTaxState(),
        );
        const projections = generateTaxProjections(
            [simYear],
            noInflationAssumptions,
            createTaxState(),
        );

        // Earned base $100k < wage base → 6.2% SS + 1.45% Medicare = 7.65%.
        expect(analysis.marginalRate.fica).toBeCloseTo(0.0765, 6);
        expect(analysis.marginalRate.combined).toBeCloseTo(projections[0].marginalRate, 6);
    });
});
