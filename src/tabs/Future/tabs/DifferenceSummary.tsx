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
        ? 'text-gray-400'
        : isPositive
            ? 'text-green-400'
            : 'text-red-400';

    const deltaIcon = isPositive === null
        ? ''
        : isPositive
            ? '\u2191'  // Up arrow
            : '\u2193'; // Down arrow

    return (
        <div className="bg-gray-800/50 rounded-xl border border-gray-700 p-4">
            <div className="text-xs text-gray-400 uppercase tracking-wide mb-2">{label}</div>

            <div className="grid grid-cols-2 gap-4 mb-3">
                <div>
                    <div className="text-xs text-blue-400 mb-1">Baseline</div>
                    <div className="text-lg font-semibold text-white">{baselineValue}</div>
                </div>
                <div>
                    <div className="text-xs text-orange-400 mb-1">Comparison</div>
                    <div className="text-lg font-semibold text-white">{comparisonValue}</div>
                </div>
            </div>

            <div className={`text-xl font-bold ${deltaColor} flex items-center gap-1`}>
                {deltaIcon && <span>{deltaIcon}</span>}
                <span>{delta}</span>
            </div>
            {sublabel && <div className="text-xs text-gray-400 mt-1">{sublabel}</div>}
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

    // Format FI year delta
    const formatFIYearDelta = () => {
        if (differences.fiYearDelta === null) {
            return { delta: 'N/A', isPositive: null };
        }
        if (differences.fiYearDelta === 0) {
            return { delta: 'Same year', isPositive: null };
        }
        const years = Math.abs(differences.fiYearDelta);
        const yearText = years === 1 ? 'year' : 'years';
        if (differences.fiYearDelta < 0) {
            return { delta: `${years} ${yearText} earlier`, isPositive: true };
        }
        return { delta: `${years} ${yearText} later`, isPositive: false };
    };

    const fiDelta = formatFIYearDelta();

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

    // Calculate years of positive/negative difference
    const yearAnalysis = () => {
        const netWorth = differences.netWorthByYear;
        let yearsAhead = 0;
        let yearsBehind = 0;

        netWorth.forEach(y => {
            if (y.delta > 0) yearsAhead++;
            else if (y.delta < 0) yearsBehind++;
        });

        return { yearsAhead, yearsBehind };
    };

    const { yearsAhead, yearsBehind } = yearAnalysis();

    return (
        <div className="flex flex-col gap-4">
            {/* Summary header */}
            <div className="bg-gray-800/30 rounded-xl border border-gray-700 p-4">
                <h3 className="text-white font-semibold mb-2">Comparison Summary</h3>
                <div className="grid grid-cols-2 gap-4">
                    <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded bg-blue-500" />
                        <span className="text-gray-300">{baseline.metadata.name}</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded bg-orange-500" />
                        <span className="text-gray-300">{comp.metadata.name}</span>
                    </div>
                </div>
            </div>

            {/* Delta cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <DeltaCard
                    label="Financial Independence"
                    baselineValue={baseline.milestones.fiYear
                        ? `Age ${baseline.milestones.fiAge}`
                        : 'Not reached'}
                    comparisonValue={comp.milestones.fiYear
                        ? `Age ${comp.milestones.fiAge}`
                        : 'Not reached'}
                    delta={fiDelta.delta}
                    isPositive={fiDelta.isPositive}
                    sublabel="Year you can stop working"
                />

                <DeltaCard
                    label="Legacy Value"
                    baselineValue={formatCompactCurrency(baseline.milestones.legacyValue, { forceExact })}
                    comparisonValue={formatCompactCurrency(comp.milestones.legacyValue, { forceExact })}
                    delta={legacyDelta.delta}
                    isPositive={legacyDelta.isPositive}
                    sublabel="Net worth at end of simulation"
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
            <div className="bg-gray-800/30 rounded-xl border border-gray-700 p-4">
                <h4 className="text-white font-semibold mb-3">Key Insights</h4>
                <ul className="space-y-2 text-sm text-gray-300">
                    {differences.fiYearDelta !== null && differences.fiYearDelta !== 0 && (
                        <li className="flex items-start gap-2">
                            <span className={differences.fiYearDelta < 0 ? 'text-green-400' : 'text-red-400'}>
                                {differences.fiYearDelta < 0 ? '\u2713' : '\u2717'}
                            </span>
                            <span>
                                The comparison scenario {differences.fiYearDelta < 0 ? 'reaches' : 'delays'} financial independence
                                by {Math.abs(differences.fiYearDelta)} year{Math.abs(differences.fiYearDelta) !== 1 ? 's' : ''}
                            </span>
                        </li>
                    )}

                    {differences.legacyValueDelta !== 0 && (
                        <li className="flex items-start gap-2">
                            <span className={differences.legacyValueDelta > 0 ? 'text-green-400' : 'text-red-400'}>
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
                            <span className={yearsAhead > yearsBehind ? 'text-green-400' : 'text-amber-400'}>
                                {'\u2022'}
                            </span>
                            <span>
                                The comparison scenario has higher net worth in {yearsAhead} out
                                of {differences.netWorthByYear.length} years
                            </span>
                        </li>
                    )}
                </ul>
            </div>
        </div>
    );
};

export default DifferenceSummary;
