import React, { useContext } from 'react';
import { ScenarioComparison } from '../../../services/ScenarioTypes';
import { formatCompactCurrency } from './FutureUtils';
import { AssumptionsContext } from '../../../components/Objects/Assumptions/AssumptionsContext';

interface DifferenceSummaryProps {
    comparison: ScenarioComparison;
}

/**
 * Delta card showing a comparison metric
 */
const DeltaCard: React.FC<{
    label: string;
    baselineValue: string | number;
    comparisonValue: string | number;
    delta: string;
    isPositive: boolean | null;  // null = neutral
    sublabel?: string;
}> = ({ label, baselineValue, comparisonValue, delta, isPositive, sublabel }) => {
    const deltaColor = isPositive === null
        ? 'text-content-muted'
        : isPositive
            ? 'text-positive'
            : 'text-negative';

    const deltaIcon = isPositive === null
        ? ''
        : isPositive
            ? '\u2191'  // Up arrow
            : '\u2193'; // Down arrow

    return (
        <div className="bg-surface-overlay/50 rounded-xl border border-border-default p-4">
            <div className="text-xs text-content-muted uppercase tracking-wide mb-2">{label}</div>

            <div className="grid grid-cols-2 gap-4 mb-3">
                <div>
                    <div className="text-xs text-info mb-1">Baseline</div>
                    <div className="text-lg font-semibold text-white">{baselineValue}</div>
                </div>
                <div>
                    <div className="text-xs text-cat-orange mb-1">Comparison</div>
                    <div className="text-lg font-semibold text-white">{comparisonValue}</div>
                </div>
            </div>

            <div className={`text-xl font-bold ${deltaColor} flex items-center gap-1`}>
                {deltaIcon && <span>{deltaIcon}</span>}
                <span>{delta}</span>
            </div>
            {sublabel && <div className="text-xs text-content-muted mt-1">{sublabel}</div>}
        </div>
    );
};

/**
 * Component showing key differences between two scenarios
 */
export const DifferenceSummary: React.FC<DifferenceSummaryProps> = ({ comparison }) => {
    const { state: assumptions } = useContext(AssumptionsContext);
    const forceExact = assumptions.display?.useCompactCurrency === false;
    const { baseline, comparison: comp, differences } = comparison;

    // Format legacy value delta
    const formatLegacyDelta = () => {
        const delta = differences.legacyValueDelta;
        if (delta === 0) {
            return { delta: 'No change', isPositive: null };
        }
        const formatted = formatCompactCurrency(Math.abs(delta), { forceExact });
        const sign = delta > 0 ? '+' : '-';
        return {
            delta: `${sign}${formatted}`,
            isPositive: delta > 0
        };
    };

    const legacyDelta = formatLegacyDelta();

    // The two plans can have genuinely different life expectancies. When they do,
    // legacy value is compared at each plan's OWN final year — an age-mismatched
    // figure — so label it rather than imply an age-matched delta (#197).
    const baselineFinal = baseline.milestones.finalYear;
    const comparisonFinal = comp.milestones.finalYear;
    const horizonsDiffer = baselineFinal !== comparisonFinal;
    const legacySublabel = horizonsDiffer
        ? `At each plan's own final year (${baselineFinal} vs ${comparisonFinal})`
        : 'Net worth at end of simulation';

    // Format peak net worth delta
    const formatPeakDelta = () => {
        const delta = differences.peakNetWorthDelta;
        if (delta === 0) {
            return { delta: 'No change', isPositive: null };
        }
        const formatted = formatCompactCurrency(Math.abs(delta), { forceExact });
        const sign = delta > 0 ? '+' : '-';
        return {
            delta: `${sign}${formatted}`,
            isPositive: delta > 0
        };
    };

    const peakDelta = formatPeakDelta();

    // Calculate years of positive/negative difference. Only years BOTH plans
    // reach have a delta (null past the shorter plan's horizon) — count those,
    // and use that overlap as the denominator so "X out of N years" is honest.
    const yearAnalysis = () => {
        const netWorth = differences.netWorthByYear;
        let yearsAhead = 0;
        let yearsBehind = 0;
        let comparableYears = 0;

        netWorth.forEach(y => {
            if (y.delta === null) return;
            comparableYears++;
            if (y.delta > 0) yearsAhead++;
            else if (y.delta < 0) yearsBehind++;
        });

        return { yearsAhead, yearsBehind, comparableYears };
    };

    const { yearsAhead, yearsBehind, comparableYears } = yearAnalysis();

    return (
        <div className="flex flex-col gap-4">
            {/* Summary header */}
            <div className="bg-surface-overlay/30 rounded-xl border border-border-default p-4">
                <h3 className="text-white font-semibold mb-2">Comparison Summary</h3>
                <div className="grid grid-cols-2 gap-4">
                    <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded bg-accent-soft" />
                        <span className="text-content-default">{baseline.metadata.name}</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded bg-cat-orange-soft" />
                        <span className="text-content-default">{comp.metadata.name}</span>
                    </div>
                </div>
            </div>

            {/* Delta cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <DeltaCard
                    label="Legacy Value"
                    baselineValue={formatCompactCurrency(baseline.milestones.legacyValue, { forceExact })}
                    comparisonValue={formatCompactCurrency(comp.milestones.legacyValue, { forceExact })}
                    delta={legacyDelta.delta}
                    isPositive={legacyDelta.isPositive}
                    sublabel={legacySublabel}
                />

                <DeltaCard
                    label="Peak Net Worth"
                    baselineValue={formatCompactCurrency(baseline.milestones.peakNetWorth, { forceExact })}
                    comparisonValue={formatCompactCurrency(comp.milestones.peakNetWorth, { forceExact })}
                    delta={peakDelta.delta}
                    isPositive={peakDelta.isPositive}
                    sublabel={`Peak years: ${baseline.milestones.peakYear} vs ${comp.milestones.peakYear}`}
                />
            </div>

            {/* Additional insights */}
            <div className="bg-surface-overlay/30 rounded-xl border border-border-default p-4">
                <h4 className="text-white font-semibold mb-3">Key Insights</h4>
                <ul className="space-y-2 text-sm text-content-default">
                    {differences.legacyValueDelta !== 0 && (
                        <li className="flex items-start gap-2">
                            <span className={differences.legacyValueDelta > 0 ? 'text-positive' : 'text-negative'}>
                                {differences.legacyValueDelta > 0 ? '\u2713' : '\u2717'}
                            </span>
                            <span>
                                The comparison scenario {differences.legacyValueDelta > 0 ? 'leaves' : 'reduces'} the
                                legacy value by {formatCompactCurrency(Math.abs(differences.legacyValueDelta), { forceExact })}
                            </span>
                        </li>
                    )}

                    {yearsAhead !== yearsBehind && (
                        <li className="flex items-start gap-2">
                            <span className={yearsAhead > yearsBehind ? 'text-positive' : 'text-warning'}>
                                {'\u2022'}
                            </span>
                            <span>
                                The comparison scenario has higher net worth in {yearsAhead} out
                                of {comparableYears} years
                            </span>
                        </li>
                    )}
                </ul>
            </div>
        </div>
    );
};
