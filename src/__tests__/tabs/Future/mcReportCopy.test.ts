import { describe, it, expect } from 'vitest';
import { describeBuyTheDip, buildBaselineVerdict } from '../../../tabs/Future/tabs/mcReportCopy';
import type { ConversionMcStats, McBaselineComparison } from '../../../services/MonteCarloTypes';

/**
 * Pure copy builders for the Monte Carlo tab's interpreted report lines
 * (#162). All numbers below are invented fixtures.
 */

const fmt = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;

function makeStats(overrides: Partial<ConversionMcStats> = {}): ConversionMcStats {
    return {
        totalConverted: { p10: 100_000, p50: 250_000, p90: 400_000 },
        fractionOfPathsConverting: 0.8,
        medianConvertedAfterDownYear: 55_000,
        medianConvertedAfterOtherYears: 50_000,
        sampleYearsAfterDown: 40,
        sampleYearsAfterOther: 200,
        ...overrides,
    };
}

describe('describeBuyTheDip', () => {
    it('hides the line (null) when either median is missing', () => {
        expect(describeBuyTheDip(makeStats({ medianConvertedAfterDownYear: null }), fmt)).toBeNull();
        expect(describeBuyTheDip(makeStats({ medianConvertedAfterOtherYears: null }), fmt)).toBeNull();
    });

    it('hides the line on a thin sample (either side under 20 years)', () => {
        expect(describeBuyTheDip(makeStats({ sampleYearsAfterDown: 19 }), fmt)).toBeNull();
        expect(describeBuyTheDip(makeStats({ sampleYearsAfterOther: 5 }), fmt)).toBeNull();
    });

    it('hides the line when the other-years median is $0 (no base for a percentage)', () => {
        expect(describeBuyTheDip(
            makeStats({ medianConvertedAfterDownYear: 30_000, medianConvertedAfterOtherYears: 0 }),
            fmt,
        )).toBeNull();
    });

    it('reads "about the same" when the difference is under 5%', () => {
        const line = describeBuyTheDip(
            makeStats({ medianConvertedAfterDownYear: 51_000, medianConvertedAfterOtherYears: 50_000 }),
            fmt,
        );
        expect(line).toMatch(/about the same/);
        expect(line).toContain('$51,000');
        expect(line).toContain('$50,000');
    });

    it('reads "N% more … buys the dip" when down-year conversions run higher', () => {
        const line = describeBuyTheDip(
            makeStats({ medianConvertedAfterDownYear: 60_000, medianConvertedAfterOtherYears: 50_000 }),
            fmt,
        );
        expect(line).toMatch(/20% more/);
        expect(line).toMatch(/buys the dip/);
    });

    it('reads "N% less" when down-year conversions run lower', () => {
        const line = describeBuyTheDip(
            makeStats({ medianConvertedAfterDownYear: 40_000, medianConvertedAfterOtherYears: 50_000 }),
            fmt,
        );
        expect(line).toMatch(/20% less/);
        expect(line).not.toMatch(/buys the dip/);
    });
});

function makeCmp(overrides: Partial<McBaselineComparison> = {}): McBaselineComparison {
    return {
        baselineSuccessRate: 90,
        deltaSuccessRate: 4.2,
        activeFailures: 3,
        baselineFailures: 10,
        medianDepletionYearActive: null,
        medianDepletionYearBaseline: null,
        fractionBehindBaseline: 0.1,
        afterTaxDelta: { p10: 40_000, p50: 120_000, p90: 300_000 },
        baselineAfterTax: { p10: 500_000, p50: 1_000_000, p90: 2_000_000 },
        ...overrides,
    };
}

describe('buildBaselineVerdict', () => {
    it('leads with the gain and the success-rate delta when the plan wins', () => {
        const { sentence, nearTie } = buildBaselineVerdict(makeCmp(), 94.2, fmt);
        expect(nearTie).toBe(false);
        expect(sentence).toContain('gained +$120,000 median after-tax per path');
        expect(sentence).toContain('+4.2 pts');
        expect(sentence).toContain('94.2% vs 90.0%');
        expect(sentence).toContain('vs. converting only within the standard deduction');
    });

    it('says "lost" with signed negatives when the plan loses', () => {
        const { sentence, nearTie } = buildBaselineVerdict(
            makeCmp({ deltaSuccessRate: -2, afterTaxDelta: { p10: -150_000, p50: -80_000, p90: 20_000 } }),
            88,
            fmt,
        );
        expect(nearTie).toBe(false);
        expect(sentence).toContain('lost -$80,000 median after-tax per path');
        expect(sentence).toContain('-2.0 pts');
    });

    it('folds the #160 near-tie tiebreak into the sentence when both deltas are tiny', () => {
        // |ΔSR| < 1 pt AND |median delta| < 2% of the baseline median → near-tie.
        const { sentence, nearTie } = buildBaselineVerdict(
            makeCmp({ deltaSuccessRate: 0.4, afterTaxDelta: { p10: 60_000, p50: 10_000, p90: -5_000 } }),
            90.4,
            fmt,
        );
        expect(nearTie).toBe(true);
        expect(sentence).toMatch(/nearly tied/);
        // The bad-market (p10) delta is offered as the tiebreak.
        expect(sentence).toContain('+$60,000');
        expect(sentence).toMatch(/tiebreak/);
    });

    it('does NOT call a near-tie when the median delta is material despite a tied success rate', () => {
        // ΔSR is tiny but the median delta is 12% of the baseline median.
        const { sentence, nearTie } = buildBaselineVerdict(
            makeCmp({ deltaSuccessRate: 0.4, afterTaxDelta: { p10: 40_000, p50: 120_000, p90: 300_000 } }),
            90.4,
            fmt,
        );
        expect(nearTie).toBe(false);
        expect(sentence).toMatch(/gained/);
    });
});
