import { type ConversionMcStats, type McBaselineComparison } from '../../../services/MonteCarloTypes';

/**
 * Pure copy builders for the Monte Carlo tab's interpreted report lines
 * (#162). Reporting-layer only — these read finished summary stats, they
 * never touch the MC engine.
 */

/**
 * Buy-the-dip line (#162): turn the after-a-down-year vs other-years median
 * conversion comparison into ONE interpreted sentence instead of two nearly
 * identical dollar figures. Returns null (line hidden) when either sample is
 * too small for its median to mean anything, or when the other-years median
 * is $0 (no base for a percentage).
 */
const DIP_MIN_SAMPLE_YEARS = 20;
const DIP_MEANINGFUL_DIFF_PCT = 5;

export function describeBuyTheDip(stats: ConversionMcStats, fmt: (n: number) => string): string | null {
    const down = stats.medianConvertedAfterDownYear;
    const other = stats.medianConvertedAfterOtherYears;
    if (down === null || other === null) return null;
    // Older persisted summaries predate the sample counts; undefined fails the
    // gate and the line simply stays hidden until the next run.
    if (!(stats.sampleYearsAfterDown >= DIP_MIN_SAMPLE_YEARS)
        || !(stats.sampleYearsAfterOther >= DIP_MIN_SAMPLE_YEARS)) return null;
    if (other <= 0) return null;
    const diffPct = (down / other - 1) * 100;
    const medians = `(median ${fmt(down)} vs ${fmt(other)})`;
    if (Math.abs(diffPct) < DIP_MEANINGFUL_DIFF_PCT) {
        return `The conversion policy converted about the same after down years as in other years ${medians} — on your inputs, market dips barely change the recommended conversions.`;
    }
    const n = Math.round(Math.abs(diffPct));
    if (diffPct > 0) {
        return `The conversion policy converted ${n}% more in the year after a market loss ${medians} — the policy buys the dip: converting after a crash moves more shares for the same tax.`;
    }
    return `The conversion policy converted ${n}% less in the year after a market loss ${medians}.`;
}

export interface BaselineVerdict {
    /** One-sentence lead for the merged conversion-behavior card. */
    sentence: string;
    /** True when success rate AND median after-tax delta are essentially tied
     *  (#160 task 3) — the sentence then points at the bad-market (p10) delta
     *  as the tiebreak instead of claiming a gain. */
    nearTie: boolean;
}

/**
 * Verdict sentence for the paired plan-vs-baseline comparison (#162 D3):
 * lead with what the conversion plan is WORTH, in one sentence, before any
 * detail rows. Folds the #160 near-tie tiebreak into the sentence itself.
 */
export function buildBaselineVerdict(
    cmp: McBaselineComparison,
    successRate: number,
    fmt: (n: number) => string,
): BaselineVerdict {
    const signedFmt = (n: number) => `${n >= 0 ? '+' : '-'}${fmt(Math.abs(n))}`;
    const medianDelta = cmp.afterTaxDelta.p50;
    const pts = `${cmp.deltaSuccessRate >= 0 ? '+' : ''}${cmp.deltaSuccessRate.toFixed(1)} pts`;

    // Near-tie (#160 task 3): when the baseline comparison ran and both the
    // success rate and the median after-tax outcome are essentially tied,
    // point at the bad-market (p10) delta as the discriminator.
    const nearTie = Math.abs(cmp.deltaSuccessRate) < 1
        && cmp.baselineAfterTax.p50 > 0
        && Math.abs(medianDelta) < 0.02 * cmp.baselineAfterTax.p50;
    if (nearTie) {
        return {
            sentence: `The conversion plan and the standard-deduction-only baseline are nearly tied `
                + `(${signedFmt(medianDelta)} median after-tax per path, ${pts} success) — `
                + `the bad-market (p10) after-tax delta of ${signedFmt(cmp.afterTaxDelta.p10)} is the tiebreak.`,
            nearTie: true,
        };
    }

    const verb = medianDelta >= 0 ? 'gained' : 'lost';
    return {
        sentence: `The conversion plan ${verb} ${signedFmt(medianDelta)} median after-tax per path `
            + `and ${pts} success (${successRate.toFixed(1)}% vs ${cmp.baselineSuccessRate.toFixed(1)}%) `
            + `vs. converting only within the standard deduction.`,
        nearTie: false,
    };
}
