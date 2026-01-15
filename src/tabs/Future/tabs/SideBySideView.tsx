import React, { useContext } from 'react';
import { ScenarioComparison, MilestonesSummary } from '../../../services/ScenarioTypes';
import { formatCompactCurrency } from './FutureUtils';
import { AssumptionsContext } from '../../../components/Objects/Assumptions/AssumptionsContext';

interface SideBySideViewProps {
    comparison: ScenarioComparison;
}

/**
 * Stat row for milestone comparison
 */
const StatRow: React.FC<{
    label: string;
    baselineValue: string | number;
    comparisonValue: string | number;
    highlight?: 'baseline' | 'comparison' | null;
}> = ({ label, baselineValue, comparisonValue, highlight }) => {
    const baselineClass = highlight === 'baseline' ? 'text-green-400' : 'text-white';
    const comparisonClass = highlight === 'comparison' ? 'text-green-400' : 'text-white';

    return (
        <div className="grid grid-cols-3 gap-4 py-2 border-b border-gray-700 last:border-0">
            <div className="text-gray-400 text-sm">{label}</div>
            <div className={`text-center font-medium ${baselineClass}`}>{baselineValue}</div>
            <div className={`text-center font-medium ${comparisonClass}`}>{comparisonValue}</div>
        </div>
    );
};

/**
 * Milestone summary panel for one scenario
 */
const MilestoneSummaryPanel: React.FC<{
    title: string;
    color: 'blue' | 'orange';
    milestones: MilestonesSummary;
    forceExact?: boolean;
}> = ({ title, color, milestones, forceExact = false }) => {
    const borderColor = color === 'blue' ? 'border-blue-500' : 'border-orange-500';
    const headerBg = color === 'blue' ? 'bg-blue-500/20' : 'bg-orange-500/20';
    const headerText = color === 'blue' ? 'text-blue-400' : 'text-orange-400';

    return (
        <div className={`rounded-xl border-2 ${borderColor} overflow-hidden`}>
            <div className={`${headerBg} px-4 py-3`}>
                <h3 className={`font-semibold ${headerText}`}>{title}</h3>
            </div>
            <div className="p-4 space-y-3">
                <div>
                    <div className="text-xs text-gray-400 uppercase">Financial Independence</div>
                    <div className="text-xl font-bold text-white">
                        {milestones.fiYear
                            ? `Age ${milestones.fiAge} (${milestones.fiYear})`
                            : 'Not reached'}
                    </div>
                </div>
                <div>
                    <div className="text-xs text-gray-400 uppercase">Retirement</div>
                    <div className="text-xl font-bold text-white">
                        Age {milestones.retirementAge} ({milestones.retirementYear})
                    </div>
                </div>
                <div>
                    <div className="text-xs text-gray-400 uppercase">Legacy Value</div>
                    <div className="text-xl font-bold text-white">
                        {formatCompactCurrency(milestones.legacyValue, { forceExact })}
                    </div>
                </div>
                <div>
                    <div className="text-xs text-gray-400 uppercase">Peak Net Worth</div>
                    <div className="text-lg font-semibold text-white">
                        {formatCompactCurrency(milestones.peakNetWorth, { forceExact })}
                    </div>
                    <div className="text-xs text-gray-400">in {milestones.peakYear}</div>
                </div>
                <div>
                    <div className="text-xs text-gray-400 uppercase">Simulation Period</div>
                    <div className="text-lg font-semibold text-white">
                        {milestones.yearsOfData} years
                    </div>
                </div>
            </div>
        </div>
    );
};

/**
 * Side by side comparison view
 */
export const SideBySideView: React.FC<SideBySideViewProps> = ({ comparison }) => {
    const { state: assumptions } = useContext(AssumptionsContext);
    const forceExact = assumptions.display?.useCompactCurrency === false;
    const { baseline, comparison: comp, differences } = comparison;

    // Determine which is "better" for highlighting
    const fiHighlight = (): 'baseline' | 'comparison' | null => {
        if (differences.fiYearDelta === null || differences.fiYearDelta === 0) return null;
        return differences.fiYearDelta < 0 ? 'comparison' : 'baseline';
    };

    const legacyHighlight = (): 'baseline' | 'comparison' | null => {
        if (differences.legacyValueDelta === 0) return null;
        return differences.legacyValueDelta > 0 ? 'comparison' : 'baseline';
    };

    const peakHighlight = (): 'baseline' | 'comparison' | null => {
        if (differences.peakNetWorthDelta === 0) return null;
        return differences.peakNetWorthDelta > 0 ? 'comparison' : 'baseline';
    };

    return (
        <div className="flex flex-col gap-6">
            {/* Summary panels */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-4xl">
                <MilestoneSummaryPanel
                    title={baseline.metadata.name}
                    color="blue"
                    milestones={baseline.milestones}
                    forceExact={forceExact}
                />
                <MilestoneSummaryPanel
                    title={comp.metadata.name}
                    color="orange"
                    milestones={comp.milestones}
                    forceExact={forceExact}
                />
            </div>

            {/* Comparison table */}
            <div className="bg-gray-800/50 rounded-xl border border-gray-700 overflow-hidden">
                <div className="p-4 border-b border-gray-700">
                    <h3 className="text-white font-semibold">Key Metrics Comparison</h3>
                </div>

                {/* Header */}
                <div className="grid grid-cols-3 gap-4 px-4 py-3 bg-gray-900/50">
                    <div className="text-gray-400 text-sm font-medium">Metric</div>
                    <div className="text-center text-blue-400 text-sm font-medium">
                        {baseline.metadata.name}
                    </div>
                    <div className="text-center text-orange-400 text-sm font-medium">
                        {comp.metadata.name}
                    </div>
                </div>

                {/* Rows */}
                <div className="px-4">
                    <StatRow
                        label="FI Age"
                        baselineValue={baseline.milestones.fiAge ?? 'N/A'}
                        comparisonValue={comp.milestones.fiAge ?? 'N/A'}
                        highlight={fiHighlight()}
                    />
                    <StatRow
                        label="FI Year"
                        baselineValue={baseline.milestones.fiYear ?? 'N/A'}
                        comparisonValue={comp.milestones.fiYear ?? 'N/A'}
                        highlight={fiHighlight()}
                    />
                    <StatRow
                        label="Retirement Age"
                        baselineValue={baseline.milestones.retirementAge ?? 'N/A'}
                        comparisonValue={comp.milestones.retirementAge ?? 'N/A'}
                    />
                    <StatRow
                        label="Legacy Value"
                        baselineValue={formatCompactCurrency(baseline.milestones.legacyValue, { forceExact })}
                        comparisonValue={formatCompactCurrency(comp.milestones.legacyValue, { forceExact })}
                        highlight={legacyHighlight()}
                    />
                    <StatRow
                        label="Peak Net Worth"
                        baselineValue={formatCompactCurrency(baseline.milestones.peakNetWorth, { forceExact })}
                        comparisonValue={formatCompactCurrency(comp.milestones.peakNetWorth, { forceExact })}
                        highlight={peakHighlight()}
                    />
                    <StatRow
                        label="Peak Year"
                        baselineValue={baseline.milestones.peakYear}
                        comparisonValue={comp.milestones.peakYear}
                    />
                    <StatRow
                        label="Simulation Years"
                        baselineValue={baseline.milestones.yearsOfData}
                        comparisonValue={comp.milestones.yearsOfData}
                    />
                </div>
            </div>

            {/* Year-by-year preview (first 10 and last 5 years) */}
            <div className="bg-gray-800/50 rounded-xl border border-gray-700 overflow-hidden">
                <div className="p-4 border-b border-gray-700">
                    <h3 className="text-white font-semibold">Net Worth by Year</h3>
                    <p className="text-sm text-gray-400">Green values indicate higher net worth</p>
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="bg-gray-900/50">
                            <tr>
                                <th className="px-4 py-2 text-left text-gray-400">Year</th>
                                <th className="px-4 py-2 text-right text-blue-400">
                                    {baseline.metadata.name}
                                </th>
                                <th className="px-4 py-2 text-right text-orange-400">
                                    {comp.metadata.name}
                                </th>
                                <th className="px-4 py-2 text-right text-gray-400">Difference</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-800">
                            {differences.netWorthByYear.slice(0, 10).map(year => (
                                <tr key={year.year}>
                                    <td className="px-4 py-2 text-gray-300">{year.year}</td>
                                    <td className={`px-4 py-2 text-right ${year.delta <= 0 ? 'text-green-400' : 'text-white'}`}>
                                        {formatCompactCurrency(year.baseline, { forceExact })}
                                    </td>
                                    <td className={`px-4 py-2 text-right ${year.delta >= 0 ? 'text-green-400' : 'text-white'}`}>
                                        {formatCompactCurrency(year.comparison, { forceExact })}
                                    </td>
                                    <td className={`px-4 py-2 text-right ${
                                        year.delta > 0 ? 'text-green-400' : year.delta < 0 ? 'text-red-400' : 'text-gray-400'
                                    }`}>
                                        {year.delta > 0 ? '+' : ''}{formatCompactCurrency(year.delta, { forceExact })}
                                    </td>
                                </tr>
                            ))}
                            {differences.netWorthByYear.length > 15 && (
                                <tr>
                                    <td colSpan={4} className="px-4 py-2 text-center text-gray-400">
                                        ... {differences.netWorthByYear.length - 15} more years ...
                                    </td>
                                </tr>
                            )}
                            {differences.netWorthByYear.slice(-5).map(year => (
                                <tr key={`end-${year.year}`}>
                                    <td className="px-4 py-2 text-gray-300">{year.year}</td>
                                    <td className={`px-4 py-2 text-right ${year.delta <= 0 ? 'text-green-400' : 'text-white'}`}>
                                        {formatCompactCurrency(year.baseline, { forceExact })}
                                    </td>
                                    <td className={`px-4 py-2 text-right ${year.delta >= 0 ? 'text-green-400' : 'text-white'}`}>
                                        {formatCompactCurrency(year.comparison, { forceExact })}
                                    </td>
                                    <td className={`px-4 py-2 text-right ${
                                        year.delta > 0 ? 'text-green-400' : year.delta < 0 ? 'text-red-400' : 'text-gray-400'
                                    }`}>
                                        {year.delta > 0 ? '+' : ''}{formatCompactCurrency(year.delta, { forceExact })}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

export default SideBySideView;
