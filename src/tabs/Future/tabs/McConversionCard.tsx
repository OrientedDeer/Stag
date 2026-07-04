import { MonteCarloSummary } from '../../../services/MonteCarloTypes';
import { formatCompactCurrency } from './FutureUtils';
import { ToggleInput } from '../../../components/Layout/InputFields/ToggleInput';
import { describeBuyTheDip, buildBaselineVerdict } from './mcReportCopy';

/**
 * Merged "Roth conversion behavior" card (#162 D3): the plan-vs-baseline
 * VERDICT leads (that's the question the comparison answers — is the
 * conversion plan worth anything?), the per-path conversion audit follows
 * below a divider. Replaces the two separate "Roth Conversions Across Paths"
 * and "vs. No-Conversion Baseline" cards.
 *
 * Reporting layer only — reads a finished summary; the toggle persists via
 * the same config.compareToBaseline the settings card used to write.
 */
interface McConversionCardProps {
    summary: MonteCarloSummary | null;
    compareToBaseline: boolean;
    onToggleCompare: (enabled: boolean) => void;
    forceExact: boolean;
}

export const McConversionCard = ({ summary, compareToBaseline, onToggleCompare, forceExact }: McConversionCardProps) => {
    const fmt = (n: number) => formatCompactCurrency(n, { forceExact });
    const signed = (n: number) => `${n >= 0 ? '+' : ''}${fmt(n)}`;

    const cmp = summary?.baselineComparison;
    const verdict = cmp ? buildBaselineVerdict(cmp, summary!.successRate, fmt) : null;

    // Converted-per-path audit (fp-review F11): shown only when any path converted.
    const stats = summary?.conversionStats;
    const hasAudit = !!stats && stats.totalConverted.p90 > 0;
    const dipLine = stats ? describeBuyTheDip(stats, fmt) : null;

    const toggle = (
        <div className="sm:w-96">
            <ToggleInput
                id="mc-compare-baseline"
                label="Baseline Comparison"
                enabled={compareToBaseline}
                setEnabled={onToggleCompare}
                tooltip="Also run every path on the SAME market draws with Roth conversions limited to the standard deduction, and report the paired plan-vs-baseline difference. Roughly doubles run time."
            />
        </div>
    );

    return (
        <div className="bg-surface-overlay/50 rounded-xl p-4 border border-border-default">
            <h4 className="text-content-default font-medium mb-2">Roth Conversion Behavior</h4>

            {cmp && verdict ? (
                <>
                    <p className="text-content-default text-sm mb-2">{verdict.sentence}</p>
                    <p className="text-content-muted text-xs mb-3">
                        Every path re-run on the SAME market draws with Roth conversions limited to
                        the standard deduction. Per-path figures below are paired (causal) —
                        unlike the cross-sectional percentile bands.
                    </p>
                    <div className="text-content-muted text-sm space-y-1">
                        <div>
                            Success rate:{' '}
                            <span className="text-content-default font-medium tabular-nums">
                                {summary!.successRate.toFixed(1)}% with plan vs {cmp.baselineSuccessRate.toFixed(1)}% baseline
                                {' '}({cmp.deltaSuccessRate >= 0 ? '+' : ''}{cmp.deltaSuccessRate.toFixed(1)} pts)
                            </span>
                        </div>
                        <div>
                            Failed paths:{' '}
                            <span className="text-content-default font-medium tabular-nums">
                                {cmp.activeFailures} with plan vs {cmp.baselineFailures} baseline
                                {cmp.medianDepletionYearActive !== null
                                    && ` (median depletion ${cmp.medianDepletionYearActive}`}
                                {cmp.medianDepletionYearActive !== null
                                    && (cmp.medianDepletionYearBaseline !== null
                                        ? ` vs ${cmp.medianDepletionYearBaseline})`
                                        : ')')}
                            </span>
                        </div>
                        <div>
                            After-tax gain per path (plan − baseline):{' '}
                            <span className="text-content-default font-medium tabular-nums">
                                <span className="whitespace-nowrap">{signed(cmp.afterTaxDelta.p10)} (p10)</span>
                                {' / '}<span className="whitespace-nowrap">{signed(cmp.afterTaxDelta.p50)} (median)</span>
                                {' / '}<span className="whitespace-nowrap">{signed(cmp.afterTaxDelta.p90)} (p90)</span>
                            </span>
                        </div>
                        <div>
                            Paths ending behind the baseline:{' '}
                            <span className="text-content-default font-medium tabular-nums">
                                {(cmp.fractionBehindBaseline * 100).toFixed(0)}%
                            </span>
                        </div>
                    </div>
                    <div className="mt-3">{toggle}</div>
                </>
            ) : compareToBaseline ? (
                // Toggle on, but the current summary predates it (or none yet).
                <>
                    {toggle}
                    <p className="text-content-muted text-sm mt-2">
                        Baseline comparison is enabled — click Run Simulation to compute it.
                    </p>
                </>
            ) : (
                // Empty state: the comparison arm is opt-in (fp-review F7).
                <>
                    {toggle}
                    <p className="text-content-muted text-sm mt-2">
                        Compare the conversion plan against a baseline that converts only within
                        the standard deduction (the tax-free bracket space) on the same market
                        draws. Enable and re-run — roughly doubles run time.
                    </p>
                </>
            )}

            {hasAudit && (
                <div className="mt-4 pt-4 border-t border-border-default">
                    <p className="text-content-muted text-xs mb-2">
                        Conversions are re-decided on each path from its realized balances, so the
                        totals vary path to path.
                    </p>
                    <div className="text-content-muted text-sm space-y-1">
                        <div>
                            Total converted per path:{' '}
                            <span className="text-content-default font-medium tabular-nums">
                                <span className="whitespace-nowrap">{fmt(stats.totalConverted.p10)} (p10)</span>
                                {' / '}<span className="whitespace-nowrap">{fmt(stats.totalConverted.p50)} (median)</span>
                                {' / '}<span className="whitespace-nowrap">{fmt(stats.totalConverted.p90)} (p90)</span>
                            </span>
                        </div>
                        <div>
                            Paths converting anything:{' '}
                            <span className="text-content-default font-medium tabular-nums">
                                {(stats.fractionOfPathsConverting * 100).toFixed(0)}%
                            </span>
                        </div>
                        {dipLine && <div>{dipLine}</div>}
                    </div>
                </div>
            )}
        </div>
    );
};
