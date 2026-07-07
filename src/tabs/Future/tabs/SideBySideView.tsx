import React, { useContext } from 'react';
import { ScenarioComparison, MilestonesSummary, YearComparison } from '../../../services/ScenarioTypes';
import { formatCompactCurrency } from './FutureUtils';
import { AssumptionsContext } from '../../../components/Objects/Assumptions/AssumptionsContext';

interface SideBySideViewProps {
    comparison: ScenarioComparison;
}

/**
 * One net-worth-by-year table row. Beyond a plan's horizon its value is null
 * (#197): render an em-dash, not a fabricated $0, and don't color a missing
 * delta (null <= 0 would falsely read as a positive/tie).
 */
const YearRow: React.FC<{ year: YearComparison; forceExact: boolean; keyPrefix?: string }> = ({ year, forceExact }) => {
    const deltaKnown = year.delta !== null;
    const dash = '—';
    const baselineAhead = deltaKnown && year.delta! <= 0;
    const comparisonAhead = deltaKnown && year.delta! >= 0;
    const deltaClass = !deltaKnown
        ? 'text-content-muted'
        : year.delta! > 0 ? 'text-positive' : year.delta! < 0 ? 'text-negative' : 'text-content-muted';

    return (
        <tr>
            <td className="px-4 py-2 text-content-default">{year.year}</td>
            <td className={`px-4 py-2 text-right ${baselineAhead ? 'text-positive' : 'text-white'}`}>
                {year.baseline === null ? dash : formatCompactCurrency(year.baseline, { forceExact })}
            </td>
            <td className={`px-4 py-2 text-right ${comparisonAhead ? 'text-positive' : 'text-white'}`}>
                {year.comparison === null ? dash : formatCompactCurrency(year.comparison, { forceExact })}
            </td>
            <td className={`px-4 py-2 text-right ${deltaClass}`}>
                {!deltaKnown ? dash : `${year.delta! > 0 ? '+' : ''}${formatCompactCurrency(year.delta!, { forceExact })}`}
            </td>
        </tr>
    );
};

/**
 * Stat row for milestone comparison
 */
const StatRow: React.FC<{
    label: string;
    baselineValue: string | number;
    comparisonValue: string | number;
    highlight?: 'baseline' | 'comparison' | null;
}> = ({ label, baselineValue, comparisonValue, highlight }) => {
    const baselineClass = highlight === 'baseline' ? 'text-positive' : 'text-white';
    const comparisonClass = highlight === 'comparison' ? 'text-positive' : 'text-white';

    return (
        <div className="grid grid-cols-3 gap-4 py-2 border-b border-border-default last:border-0">
            <div className="text-content-muted text-sm">{label}</div>
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
    const borderColor = color === 'blue' ? 'border-accent-soft' : 'border-cat-orange-soft';
    const headerBg = color === 'blue' ? 'bg-info-tint/20' : 'bg-cat-orange-soft/20';
    const headerText = color === 'blue' ? 'text-info' : 'text-cat-orange';

    return (
        <div className={`rounded-xl border-2 ${borderColor} overflow-hidden`}>
            <div className={`${headerBg} px-4 py-3`}>
                <h3 className={`font-semibold ${headerText}`}>{title}</h3>
            </div>
            <div className="p-4 space-y-3">
                <div>
                    <div className="text-xs text-content-muted uppercase">Retirement</div>
                    <div className="text-xl font-bold text-white">
                        Age {milestones.retirementAge} ({milestones.retirementYear})
                    </div>
                </div>
                <div>
                    <div className="text-xs text-content-muted uppercase">Legacy Value</div>
                    <div className="text-xl font-bold text-white">
                        {formatCompactCurrency(milestones.legacyValue, { forceExact })}
                    </div>
                </div>
                <div>
                    <div className="text-xs text-content-muted uppercase">Peak Net Worth</div>
                    <div className="text-lg font-semibold text-white">
                        {formatCompactCurrency(milestones.peakNetWorth, { forceExact })}
                    </div>
                    <div className="text-xs text-content-muted">in {milestones.peakYear}</div>
                </div>
                <div>
                    <div className="text-xs text-content-muted uppercase">Simulation Period</div>
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
            <div className="bg-surface-overlay/50 rounded-xl border border-border-default overflow-hidden">
                <div className="p-4 border-b border-border-default">
                    <h3 className="text-white font-semibold">Key Metrics Comparison</h3>
                </div>

                {/* Header */}
                <div className="grid grid-cols-3 gap-4 px-4 py-3 bg-surface-raised/50">
                    <div className="text-content-muted text-sm font-medium">Metric</div>
                    <div className="text-center text-info text-sm font-medium">
                        {baseline.metadata.name}
                    </div>
                    <div className="text-center text-cat-orange text-sm font-medium">
                        {comp.metadata.name}
                    </div>
                </div>

                {/* Rows */}
                <div className="px-4">
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
            <div className="bg-surface-overlay/50 rounded-xl border border-border-default overflow-hidden">
                <div className="p-4 border-b border-border-default">
                    <h3 className="text-white font-semibold">Net Worth by Year</h3>
                    <p className="text-sm text-content-muted">Green values indicate higher net worth</p>
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="bg-surface-raised/50">
                            <tr>
                                <th className="px-4 py-2 text-left text-content-muted">Year</th>
                                <th className="px-4 py-2 text-right text-info">
                                    {baseline.metadata.name}
                                </th>
                                <th className="px-4 py-2 text-right text-cat-orange">
                                    {comp.metadata.name}
                                </th>
                                <th className="px-4 py-2 text-right text-content-muted">Difference</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border-subtle">
                            {differences.netWorthByYear.slice(0, 10).map(year => (
                                <YearRow key={year.year} year={year} forceExact={forceExact} />
                            ))}
                            {differences.netWorthByYear.length > 15 && (
                                <tr>
                                    <td colSpan={4} className="px-4 py-2 text-center text-content-muted">
                                        ... {differences.netWorthByYear.length - 15} more years ...
                                    </td>
                                </tr>
                            )}
                            {differences.netWorthByYear.slice(-5).map(year => (
                                <YearRow key={`end-${year.year}`} year={year} forceExact={forceExact} />
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};
