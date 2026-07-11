/**
 * Unit tests for Medicare IRMAA data + helpers (src/data/IRMAAData.ts):
 * - tier boundary / cliff behavior
 * - MFJ x2 per-beneficiary surcharge
 * - MFS truncated schedule
 * - forward inflation indexing (and the inflationAdjusted gate)
 * - the 2-year lookback resolver and its first-Medicare-year proxy
 */

import { describe, it, expect } from 'vitest';
import {
    getIRMAAAnnualSurcharge,
    getNextIRMAAThreshold,
    resolveIrmaaLookbackMAGI,
    IRMAA_LOOKBACK_YEARS,
    MEDICARE_ELIGIBILITY_AGE,
} from '../../data/IRMAAData';
import { type AssumptionsState, defaultAssumptions } from '../../components/Objects/Assumptions/AssumptionsContext';

// Inflation OFF so the 2026 table is used verbatim (no forward indexing).
const noInflation: AssumptionsState = {
    ...defaultAssumptions,
    macro: { ...defaultAssumptions.macro, inflationAdjusted: false, inflationRate: 0 },
};

// Per-beneficiary monthly surcharge (Part B + Part D) for each 2026 tier.
const MONTHLY = {
    tier1: 81.20 + 14.50,
    tier2: 202.90 + 37.50,
    tier3: 324.60 + 60.40,
    tier4: 446.30 + 83.30,
    tier5: 487.00 + 91.00,
};

describe('getIRMAAAnnualSurcharge — Single (2026)', () => {
    it('is $0 in the standard tier (below the first floor)', () => {
        expect(getIRMAAAnnualSurcharge(50_000, 'Single', 2026, noInflation)).toBe(0);
        expect(getIRMAAAnnualSurcharge(108_999, 'Single', 2026, noInflation)).toBe(0);
        expect(getIRMAAAnnualSurcharge(0, 'Single', 2026, noInflation)).toBe(0);
    });

    it('treats the floor as the first dollar of the tier (cliff), consistent with the ACA cliff convention', () => {
        // The floor is inclusive of the surcharge tier (>=), matching getAcaCliffThreshold's
        // convention and the conversion cliff pre-check. The $1 difference from CMS's
        // "MAGI ≤ $109,000 is standard" framing is financially immaterial.
        expect(getIRMAAAnnualSurcharge(109_000, 'Single', 2026, noInflation)).toBeCloseTo(MONTHLY.tier1 * 12, 2);
        expect(getIRMAAAnnualSurcharge(109_001, 'Single', 2026, noInflation)).toBeCloseTo(MONTHLY.tier1 * 12, 2);
    });

    it('bills each tier correctly', () => {
        expect(getIRMAAAnnualSurcharge(137_001, 'Single', 2026, noInflation)).toBeCloseTo(MONTHLY.tier2 * 12, 2);
        expect(getIRMAAAnnualSurcharge(171_001, 'Single', 2026, noInflation)).toBeCloseTo(MONTHLY.tier3 * 12, 2);
        expect(getIRMAAAnnualSurcharge(205_001, 'Single', 2026, noInflation)).toBeCloseTo(MONTHLY.tier4 * 12, 2);
        expect(getIRMAAAnnualSurcharge(500_001, 'Single', 2026, noInflation)).toBeCloseTo(MONTHLY.tier5 * 12, 2);
        expect(getIRMAAAnnualSurcharge(5_000_000, 'Single', 2026, noInflation)).toBeCloseTo(MONTHLY.tier5 * 12, 2);
    });
});

describe('getIRMAAAnnualSurcharge — MFJ is per-beneficiary (x2)', () => {
    it('uses MFJ thresholds (~2x single) and doubles the surcharge', () => {
        // Below the MFJ tier-1 floor: still $0 even though it would be tier-2 for a single filer.
        expect(getIRMAAAnnualSurcharge(217_000, 'Married Filing Jointly', 2026, noInflation)).toBe(0);
        // Just over the MFJ tier-1 floor ($218k): tier 1, billed x2.
        expect(getIRMAAAnnualSurcharge(218_001, 'Married Filing Jointly', 2026, noInflation))
            .toBeCloseTo(MONTHLY.tier1 * 12 * 2, 2);
        // Top tier over $750k, x2.
        expect(getIRMAAAnnualSurcharge(800_000, 'Married Filing Jointly', 2026, noInflation))
            .toBeCloseTo(MONTHLY.tier5 * 12 * 2, 2);
    });

    it('a MFJ couple at tier 1 pays ~$2.3k/yr (matches the issue magnitude)', () => {
        const annual = getIRMAAAnnualSurcharge(218_001, 'Married Filing Jointly', 2026, noInflation);
        expect(annual).toBeGreaterThan(2_000);
        expect(annual).toBeLessThan(2_500);
    });
});

describe('getIRMAAAnnualSurcharge — MFS truncated schedule', () => {
    it('has no tiers 1-3: standard up to $109k, then jumps to tier 4, then tier 5', () => {
        expect(getIRMAAAnnualSurcharge(100_000, 'Married Filing Separately', 2026, noInflation)).toBe(0);
        // 109k-391k maps to the tier-4 surcharge (x1, MFS is a single beneficiary).
        expect(getIRMAAAnnualSurcharge(150_000, 'Married Filing Separately', 2026, noInflation))
            .toBeCloseTo(MONTHLY.tier4 * 12, 2);
        // >= 391k maps to tier 5.
        expect(getIRMAAAnnualSurcharge(400_000, 'Married Filing Separately', 2026, noInflation))
            .toBeCloseTo(MONTHLY.tier5 * 12, 2);
    });
});

describe('forward inflation indexing', () => {
    it('snaps to the table verbatim for table years and earlier (no deflation)', () => {
        const infl: AssumptionsState = {
            ...defaultAssumptions,
            macro: { ...defaultAssumptions.macro, inflationAdjusted: true, inflationRate: 3 },
        };
        // 2026 is the table year: same as no-inflation.
        expect(getIRMAAAnnualSurcharge(109_001, 'Single', 2026, infl))
            .toBeCloseTo(MONTHLY.tier1 * 12, 2);
    });

    it('indexes thresholds AND surcharge amounts forward by the inflation rate', () => {
        const infl: AssumptionsState = {
            ...defaultAssumptions,
            macro: { ...defaultAssumptions.macro, inflationAdjusted: true, inflationRate: 3 },
        };
        const mult = Math.pow(1.03, 4); // 2030 is 4 years past the 2026 table

        // A MAGI just over the INFLATED tier-1 floor lands in tier 1, with an INFLATED surcharge.
        const inflatedFloor = 109_000 * mult;
        const surcharge2030 = getIRMAAAnnualSurcharge(inflatedFloor + 1, 'Single', 2030, infl);
        expect(surcharge2030).toBeCloseTo(MONTHLY.tier1 * 12 * mult, 1);

        // The same nominal MAGI that tripped tier 1 in 2026 is BELOW the inflated 2030 floor → $0.
        expect(getIRMAAAnnualSurcharge(109_001, 'Single', 2030, infl)).toBe(0);
    });

    it('does not index when inflationAdjusted is off', () => {
        expect(getIRMAAAnnualSurcharge(109_001, 'Single', 2035, noInflation))
            .toBeCloseTo(MONTHLY.tier1 * 12, 2);
    });
});

describe('getNextIRMAAThreshold', () => {
    it('returns the next floor above a MAGI for Single (2026)', () => {
        expect(getNextIRMAAThreshold(50_000, 'Single', 2026, noInflation)).toBe(109_000);
        expect(getNextIRMAAThreshold(120_000, 'Single', 2026, noInflation)).toBe(137_000);
        expect(getNextIRMAAThreshold(480_000, 'Single', 2026, noInflation)).toBe(500_000);
    });

    it('returns null in the top tier', () => {
        expect(getNextIRMAAThreshold(600_000, 'Single', 2026, noInflation)).toBeNull();
    });

    it('reflects inflation indexing', () => {
        const infl: AssumptionsState = {
            ...defaultAssumptions,
            macro: { ...defaultAssumptions.macro, inflationAdjusted: true, inflationRate: 3 },
        };
        const next = getNextIRMAAThreshold(50_000, 'Single', 2030, infl);
        expect(next).toBeCloseTo(109_000 * Math.pow(1.03, 4), 0);
    });
});

describe('resolveIrmaaLookbackMAGI', () => {
    const sims = [
        { year: 2026, magi: 100_000 },
        { year: 2027, magi: 120_000 },
        { year: 2028, magi: 140_000 },
        { year: 2029, magi: 160_000 },
    ];

    it('reads year N-2 when present (the true lookback)', () => {
        // 2028 looks back to 2026.
        expect(resolveIrmaaLookbackMAGI(sims, 2028, 999)).toBe(100_000);
        // 2029 looks back to 2027.
        expect(resolveIrmaaLookbackMAGI(sims, 2029, 999)).toBe(120_000);
    });

    it('proxies from the earliest simulated year when N-2 predates the sim', () => {
        // 2027 looks back to 2025 which is before the sim → earliest (2026) MAGI.
        expect(resolveIrmaaLookbackMAGI(sims, 2027, 999)).toBe(100_000);
    });

    it('self-proxies from the supplied MAGI when there is no prior data at all', () => {
        expect(resolveIrmaaLookbackMAGI([], 2026, 88_000)).toBe(88_000);
        expect(resolveIrmaaLookbackMAGI(undefined, 2026, 88_000)).toBe(88_000);
    });

    it('uses a 2-year lookback constant', () => {
        expect(IRMAA_LOOKBACK_YEARS).toBe(2);
        expect(MEDICARE_ELIGIBILITY_AGE).toBe(65);
    });
});
