/**
 * Finding 2 (2026-06-24 deep-review): Medicare head-year IRMAA seed under-priced
 * IRMAA for EARLY retirees who convert in the age-63/64 lookback window.
 *
 * `buildDPYearContexts` pins the ages 65-66 IRMAA surcharge to the NO-CONVERSION
 * baseline MAGI at the age-63/64 lookback year (#76 head-edge correction). For an
 * EARLY retiree, ages 63-64 are in-horizon retirement years where the DP itself
 * chooses conversions — and the real engine bills 65-66 IRMAA on the 63-64 MAGI
 * INCLUDING those conversions. The constant baseline seed hid that cost, so the
 * DP could over-convert at 63-64 (confirmed: a $3M-trad early-retiree converts
 * ~$30k more in the window when the IRMAA is mispriced, with a ~$9.5k/yr IRMAA
 * blind spot). It bites cleanly only with acaAware disabled (the ACA cliff
 * otherwise masks it pre-65).
 *
 * FIX: when the age-63/64 lookback year is post-retirement (DP-controlled),
 * attribute the surcharge to that lookback year itself — price the (year+2)
 * Medicare schedule on the year's conversion-sensitive MAGI — and pin the
 * matching 65-66 head year to 0 (billed exactly once). The pre-retirement
 * lookback case (late retiree) keeps the #76 baseline-MAGI seed.
 *
 * These tests exercise the REAL `buildDPYearContexts` path.
 */
import { describe, it, expect } from 'vitest';
import { buildDPYearContexts } from '../../../services/simulation/RothConversionDP';
import { getIRMAASchedule } from '../../../data/IRMAAData';
import {
    type AssumptionsState,
    defaultAssumptions,
    createBuiltinMilestones,
} from '../../../components/Objects/Assumptions/AssumptionsContext';
import { type TaxState } from '../../../components/Objects/Taxes/TaxContext';
import { InvestedAccount } from '../../../components/Objects/Accounts/models';
import { type SimulationYear } from '../../../services/simulation/types';

const START_YEAR = 2030;

function makeAssumptions(birthYear: number, retirementAge: number): AssumptionsState {
    return {
        ...defaultAssumptions,
        demographics: {},
        milestones: createBuiltinMilestones(birthYear, retirementAge, 92),
        macro: {
            ...defaultAssumptions.macro,
            // Inflation ON (default 2.6%) so the IRMAA schedule the test compares
            // against is the same inflated one the builder resolves.
            inflationRate: defaultAssumptions.macro.inflationRate,
            inflationAdjusted: true,
        },
        investments: {
            ...defaultAssumptions.investments,
            // acaAware DISABLED so no pre-65 ACA cliff masks the IRMAA effect.
            acaAware: false,
            returnRates: { ror: 0 },
        },
    };
}

const taxState: TaxState = {
    filingStatus: 'Single',
    stateResidency: 'Texas', // no state tax noise
    deductionMethod: 'Standard',
    fedOverride: null,
    ficaOverride: null,
    stateOverride: null,
    year: START_YEAR,
};

/**
 * Minimal retirement-only baseline. `magi` is set on every year so the head-year
 * seeding code can read the age-63/64 lookback MAGI. The MAGI is set LOW
 * ($20k) — the early retiree whose no-conversion MAGI is below the IRMAA floor
 * but whose conversion MAGI is above it.
 */
function buildBaseline(retirementYear: number, years: number, magi: number): SimulationYear[] {
    const out: SimulationYear[] = [];
    for (let i = 0; i < years; i++) {
        const year = retirementYear + i;
        const trad = new InvestedAccount(
            'trad', 'Traditional IRA', 1_000_000, 0, 10, 0.0, 'Traditional IRA', true, 0.2, 1_000_000,
        );
        out.push({
            year,
            incomes: [],
            expenses: [],
            accounts: [trad],
            magi,
            cashflow: {
                totalIncome: 0, totalExpense: 40_000, livingExpenses: 40_000, discretionary: 0,
                investedUser: 0, investedMatch: 0, totalInvested: 0, bucketAllocations: 0,
                bucketDetail: {}, withdrawals: 0, withdrawalDetail: {},
            },
            taxDetails: {
                fed: 0, state: 0, fica: 0, preTax: 0, insurance: 0, postTax: 0,
                capitalGains: 0, withdrawalOrdinaryTax: 0, niit: 0,
            },
            logs: [],
        });
    }
    return out;
}

describe('Medicare head-year IRMAA seed — early retiree lookback attribution (Finding 2)', () => {
    it('early retiree: ages 63-64 carry the (year+2) Medicare surcharge; 65-66 pinned to 0', () => {
        const birthYear = START_YEAR - 60; // retire at 60 → ages 63-66 all in-horizon
        const retirementYear = START_YEAR;
        const assumptions = makeAssumptions(birthYear, 60);
        const baseline = buildBaseline(retirementYear, 30, 20_000);

        const contexts = buildDPYearContexts(baseline, assumptions, taxState, retirementYear, 0);

        const at = (age: number) => contexts.find(c => c.age === age)!;
        const c63 = at(63), c64 = at(64), c65 = at(65), c66 = at(66), c67 = at(67);

        // Ages 63-64 (pre-Medicare lookback) now carry a conversion-sensitive
        // surcharge priced on the MEDICARE-YEAR (year+2) schedule.
        expect(c63.irmaaSurchargeForMAGI).toBeDefined();
        expect(c64.irmaaSurchargeForMAGI).toBeDefined();

        // A conversion that pushes age-63 MAGI to $220k must price the SAME
        // surcharge the age-65 (year+2) schedule charges at $220k.
        const expected65 = getIRMAASchedule('Single', c63.year + 2, assumptions).annualSurcharge(220_000);
        expect(c63.irmaaSurchargeForMAGI!(220_000)).toBeCloseTo(expected65, 2);
        expect(expected65).toBeGreaterThan(0); // sanity: the surcharge is real
        const expected66 = getIRMAASchedule('Single', c64.year + 2, assumptions).annualSurcharge(220_000);
        expect(c64.irmaaSurchargeForMAGI!(220_000)).toBeCloseTo(expected66, 2);

        // Ages 65-66 head years are pinned to 0 (cost attributed at 63-64),
        // ignoring their MAGI argument — no double count.
        expect(c65.irmaaSurchargeForMAGI).toBeDefined();
        expect(c65.irmaaSurchargeForMAGI!(500_000)).toBe(0);
        expect(c66.irmaaSurchargeForMAGI).toBeDefined();
        expect(c66.irmaaSurchargeForMAGI!(500_000)).toBe(0);

        // Age 67 (interior Medicare year) is unaffected: conversion-sensitive
        // same-year pricing on its OWN schedule.
        const expected67 = getIRMAASchedule('Single', c67.year, assumptions).annualSurcharge(220_000);
        expect(c67.irmaaSurchargeForMAGI!(220_000)).toBeCloseTo(expected67, 2);
    });

    it('filing-status change between 63/64 and 65: surcharge prices on the MEDICARE-YEAR status', () => {
        // Early retiree (retire at 60 → ages 63-66 all in-horizon). The base
        // filing status is MFJ at ages 63-64, but a filing-status life event
        // (e.g. spouse's death) switches to Single in the age-65 year. The IRMAA
        // surcharge the engine bills at 65/66 is set by the age-63/64 MAGI but
        // billed against the MEDICARE YEAR's (Single) bracket schedule — whose
        // thresholds are ~half the MFJ ones, so the same MAGI lands in a higher
        // (often non-zero) surcharge tier. The age-63/64 lookback contexts must
        // price the (year+2) Medicare schedule on the MEDICARE-YEAR filing status,
        // not their own (MFJ) status.
        const birthYear = START_YEAR - 60; // retire at 60 → ages 63-66 all in-horizon
        const retirementYear = START_YEAR;
        const assumptions = makeAssumptions(birthYear, 60);
        const baseline = buildBaseline(retirementYear, 30, 20_000);

        // Age 65 falls in START_YEAR + 5 (born START_YEAR - 60 → age 65 in
        // START_YEAR + 5). Switch MFJ → Single starting that calendar year.
        const age65Year = birthYear + 65;
        const mfjToSingle: TaxState = {
            ...taxState,
            filingStatus: 'Married Filing Jointly',
            taxEvents: [
                { id: 'widow', kind: 'filingStatus', value: 'Single', year: age65Year },
            ],
        };

        const contexts = buildDPYearContexts(baseline, assumptions, mfjToSingle, retirementYear, 0);

        const at = (age: number) => contexts.find(c => c.age === age)!;
        const c63 = at(63), c64 = at(64);

        // The age-63 context's filing status is still MFJ (event fires at 65),
        // but the age-65 PREMIUM it sizes against must use the Single schedule.
        // Pick a MAGI that is below the MFJ surcharge floor but above the Single
        // floor (after the schedule's inflation indexing to the ~2035 Medicare
        // year) so the two schedules give DIFFERENT (and the Single one non-zero)
        // surcharges — that's exactly the bracket the bug would misprice. The
        // `single65 > 0` and `not.toBeCloseTo` guards below fail loudly if the
        // indexing ever pushes the floors past this value.
        const magi = 200_000;
        const single65 = getIRMAASchedule('Single', c63.year + 2, assumptions).annualSurcharge(magi);
        const mfj65 = getIRMAASchedule('Married Filing Jointly', c63.year + 2, assumptions).annualSurcharge(magi);
        expect(single65).toBeGreaterThan(0); // sanity: $120k is in a Single surcharge tier
        expect(single65).not.toBeCloseTo(mfj65, 2); // the two schedules really differ here

        // FIX: the lookback context prices against the Medicare-year (Single)
        // schedule, NOT its own (MFJ) status.
        expect(c63.irmaaSurchargeForMAGI!(magi)).toBeCloseTo(single65, 2);
        const single66 = getIRMAASchedule('Single', c64.year + 2, assumptions).annualSurcharge(magi);
        expect(c64.irmaaSurchargeForMAGI!(magi)).toBeCloseTo(single66, 2);
    });

    it('retire-at-65: ages 63-64 are pre-retirement → 65-66 keep the #76 baseline seed (NOT 0)', () => {
        // Retire at 65: ages 63-64 fall BEFORE retirement (no DP conversion), but
        // ages 65-66 ARE in-horizon. The head years must keep the baseline-MAGI
        // seed (#76), not the new pin-to-0 path (whose lookback is pre-retirement).
        // Baseline 63/64 MAGI is set high enough to be a non-zero surcharge so
        // "pinned to 0" vs "baseline seed" is distinguishable.
        const birthYear = START_YEAR - 65;
        const retirementYear = START_YEAR; // age 65 in START_YEAR
        const assumptions = makeAssumptions(birthYear, 65);
        // Provide a baseline that STARTS 2 years before retirement so ages 63-64
        // exist in baselineMagiByYear with a high MAGI for the seed lookup.
        const baseline = buildBaseline(retirementYear - 2, 30, 150_000);

        const contexts = buildDPYearContexts(baseline, assumptions, taxState, retirementYear, 0);

        const c65 = contexts.find(c => c.age === 65)!;
        const c66 = contexts.find(c => c.age === 66)!;
        // Baseline 63/64 MAGI = $150k → a real surcharge; the seed must reflect it
        // (NOT pinned to 0). It ignores its MAGI arg (constant seed).
        const seed65 = getIRMAASchedule('Single', c65.year, assumptions).annualSurcharge(150_000);
        expect(seed65).toBeGreaterThan(0);
        expect(c65.irmaaSurchargeForMAGI!(0)).toBeCloseTo(seed65, 2);
        expect(c65.irmaaSurchargeForMAGI!(999_999)).toBeCloseTo(seed65, 2); // constant
        const seed66 = getIRMAASchedule('Single', c66.year, assumptions).annualSurcharge(150_000);
        expect(c66.irmaaSurchargeForMAGI!(0)).toBeCloseTo(seed66, 2);
    });
});
