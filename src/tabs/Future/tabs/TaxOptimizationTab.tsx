import React, { useState, useContext, useMemo } from 'react';
import { SimulationYear } from '../../../components/Objects/Assumptions/SimulationEngine';
import { useAssumptions } from '../../../components/Objects/Assumptions/AssumptionsContext';
import { TaxContext } from '../../../components/Objects/Taxes/TaxContext';
import { formatCompactCurrency, formatCurrency } from './FutureUtils';
import { Tooltip } from '../../../components/Layout/InputFields/Tooltip';
import {
    analyzeTaxSituation,
    generateRecommendations,
    generateTaxProjections,
    analyzeRothPreTaxAllocation,
    analyzeConversionPlan,
    hasTraditionalRetirementBalance,
    TaxAnalysis,
    TaxRecommendation,
    TaxProjection,
    RothPreTaxAllocation,
    ConversionPlan,
    AllocationVerdict,
} from '../../../services/TaxOptimizationService';

interface TaxOptimizationTabProps {
    simulationData: SimulationYear[];
}

/**
 * Format percentage for display
 */
const formatPercent = (value: number, decimals: number = 1): string => {
    return `${(value * 100).toFixed(decimals)}%`;
};

/**
 * Stat card component for displaying key metrics
 */
const StatCard = ({ label, value, sublabel, tooltip }: {
    label: string;
    value: string;
    sublabel?: string;
    tooltip?: string;
}) => (
    <div className="bg-surface-overlay/50 rounded-xl p-4 border border-border-default">
        <div className="flex items-center gap-1 mb-1">
            <div className="text-xs text-content-muted uppercase tracking-wide">{label}</div>
            {tooltip && <Tooltip text={tooltip} />}
        </div>
        <div className="text-2xl font-bold text-white">{value}</div>
        {sublabel && <div className="text-xs text-content-muted mt-1">{sublabel}</div>}
    </div>
);

/**
 * Recommendation card component
 */
const RecommendationCard = ({ rec }: { rec: TaxRecommendation }) => {
    const impactColors = {
        high: 'border-positive-soft bg-positive-tint/20',
        medium: 'border-warning-soft bg-warning-tint/20',
        low: 'border-border-faint bg-surface-overlay/50'
    };

    const impactLabels = {
        high: 'HIGH IMPACT',
        medium: 'MEDIUM IMPACT',
        low: 'LOW IMPACT'
    };

    const impactTextColors = {
        high: 'text-positive',
        medium: 'text-warning',
        low: 'text-content-muted'
    };

    return (
        <div className={`rounded-xl border-2 p-4 ${impactColors[rec.impact]}`}>
            <div className="flex items-start justify-between mb-2">
                <h4 className="text-white font-semibold">{rec.title}</h4>
                <span className={`text-xs font-semibold ${impactTextColors[rec.impact]}`}>
                    {impactLabels[rec.impact]}
                </span>
            </div>
            <p className="text-content-default text-sm mb-3">{rec.description}</p>
            {rec.estimatedAnnualSavings > 0 && (
                <div className="text-positive font-semibold mb-2">
                    Estimated Savings: {formatCurrency(rec.estimatedAnnualSavings)}/year
                </div>
            )}
            <ul className="space-y-1">
                {rec.actionItems.map((item, i) => (
                    <li key={i} className="text-sm text-content-muted flex items-start gap-2">
                        <span className="text-positive mt-0.5">-</span>
                        {item}
                    </li>
                ))}
            </ul>
        </div>
    );
};

/**
 * Tax projection table component
 */
const TaxProjectionTable = ({ projections, forceExact }: {
    projections: TaxProjection[];
    forceExact: boolean;
}) => {
    const [expanded, setExpanded] = useState(false);
    const displayCount = expanded ? projections.length : 10;

    return (
        <div className="bg-surface-overlay/50 rounded-xl border border-border-default overflow-hidden">
            <div className="p-4 border-b border-border-default flex justify-between items-center">
                <h3 className="text-white font-semibold">Tax Rate Projections</h3>
                {projections.length > 10 && (
                    <button
                        onClick={() => setExpanded(!expanded)}
                        className="text-sm text-positive hover:text-positive-bright"
                    >
                        {expanded ? 'Show Less' : `Show All (${projections.length})`}
                    </button>
                )}
            </div>
            <div className="overflow-x-auto max-h-96 overflow-y-auto">
                <table className="w-full text-sm">
                    <thead className="sticky top-0 z-10 bg-surface-raised">
                        <tr>
                            <th className="px-4 py-3 text-left text-content-muted">Year</th>
                            <th className="px-4 py-3 text-left text-content-muted">Age</th>
                            <th className="px-4 py-3 text-right text-content-muted">
                                <span className="inline-flex items-center gap-1 justify-end">
                                    Tax Base
                                    <Tooltip text="Total taxable activity for the year: income (work, SS, pension, passive, RMDs) + Roth conversions + non-RMD Traditional withdrawals. The denominator for the effective rate." />
                                </span>
                            </th>
                            <th className="px-4 py-3 text-right text-content-muted">Effective</th>
                            <th className="px-4 py-3 text-right text-content-muted">Marginal</th>
                            <th className="px-4 py-3 text-right text-content-muted">Fed Bracket</th>
                            <th className="px-4 py-3 text-center text-content-muted">Status</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-border-subtle">
                        {projections.slice(0, displayCount).map((proj) => (
                            <tr
                                key={proj.year}
                                className={proj.isLowTaxYear ? 'bg-positive-tint/10' : ''}
                            >
                                <td className="px-4 py-3 text-content-default">{proj.year}</td>
                                <td className="px-4 py-3 text-content-default">{proj.age}</td>
                                <td className="px-4 py-3 text-right text-content-default">
                                    {formatCompactCurrency(proj.grossIncome, { forceExact })}
                                </td>
                                <td className="px-4 py-3 text-right text-content-default">
                                    {formatPercent(proj.effectiveRate)}
                                </td>
                                <td className="px-4 py-3 text-right text-content-default">
                                    {formatPercent(proj.marginalRate)}
                                </td>
                                <td className="px-4 py-3 text-right text-content-default">
                                    {proj.federalBracket.toFixed(0)}%
                                </td>
                                <td className="px-4 py-3 text-center">
                                    {proj.isRetired ? (
                                        proj.isLowTaxYear ? (
                                            <span className="px-2 py-1 bg-positive-soft/20 text-positive rounded text-xs">
                                                Low Tax
                                            </span>
                                        ) : (
                                            <span className="px-2 py-1 bg-info-tint/20 text-info rounded text-xs">
                                                Retired
                                            </span>
                                        )
                                    ) : (
                                        <span className="px-2 py-1 bg-surface-input text-content-muted rounded text-xs">
                                            Working
                                        </span>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

/**
 * Compact diagnostic for the Roth vs Traditional 401(k) split.
 * No inputs — reads the user's current contributions and gives a verdict.
 */
const RothPreTaxVerdict = ({ allocation }: { allocation: RothPreTaxAllocation }) => {
    const verdictMeta = getVerdictMeta(allocation.verdict);
    const currentPct = `${(allocation.currentRate * 100).toFixed(1)}%`;
    const futurePct = `${(allocation.futureRate * 100).toFixed(1)}%`;
    const rothPct = Math.round(allocation.rothFraction * 100);
    const withdrawalLabel = allocation.futureRateBasis === 'rmd-year'
        ? 'At first RMD'
        : 'At retirement';

    return (
        <div className={`rounded-xl p-4 border ${verdictMeta.bg}`}>
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                        <span className={`text-lg ${verdictMeta.color}`}>{verdictMeta.icon}</span>
                        <h3 className={`font-semibold ${verdictMeta.color}`}>{verdictMeta.title}</h3>
                    </div>
                    <p className="text-sm text-content-default">{verdictMeta.body(allocation)}</p>
                </div>
                <div className="text-right text-sm shrink-0">
                    <div className="text-content-muted">
                        Today <span className="text-white font-medium">{currentPct}</span>
                        <span className="text-content-subtle mx-2">vs</span>
                        {withdrawalLabel} <span className="text-white font-medium">{futurePct}</span>
                        <span className="ml-1 inline-block align-middle">
                            <Tooltip text="Federal + state marginal rate, excluding FICA. FICA is excluded because 401(k) contributions don't avoid it and RMDs aren't subject to it — only fed + state matters for the Roth vs Traditional decision. The 'Marginal Rate' card above includes FICA, which is why this number is lower." />
                        </span>
                    </div>
                    <div className="text-xs text-content-subtle mt-0.5">
                        Currently {rothPct}% Roth / {100 - rothPct}% Pre-Tax
                    </div>
                </div>
            </div>
        </div>
    );
};

const VERDICT_META: Record<AllocationVerdict, {
    title: string;
    icon: string;
    color: string;
    bg: string;
    body: (a: RothPreTaxAllocation) => string;
}> = {
    'optimal': {
        title: 'Your 401(k) split is optimal',
        icon: '✓',
        color: 'text-positive',
        bg: 'bg-positive-tint/20 border-positive-strong/40',
        body: (a) => a.rothFraction >= 0.5
            ? `Roth wins by your numbers, and you're already on Roth. Keep going.`
            : `Pre-Tax wins by your numbers, and you're already on Pre-Tax. Keep going.`
    },
    'should-be-roth': {
        title: 'Switch to Roth contributions',
        icon: '⚠',
        color: 'text-warning-bright',
        bg: 'bg-warning-tint/20 border-warning-strong/40',
        body: (a) =>
            `You're sending ${Math.round((1 - a.rothFraction) * 100)}% to Pre-Tax, but your future tax rate is higher than today's. Roth wins by ~${Math.round(a.rateGap * 100)}¢ per dollar contributed.`
    },
    'should-be-pretax': {
        title: 'Switch to Pre-Tax contributions',
        icon: '⚠',
        color: 'text-warning-bright',
        bg: 'bg-warning-tint/20 border-warning-strong/40',
        body: (a) =>
            `You're sending ${Math.round(a.rothFraction * 100)}% to Roth, but your future tax rate is lower than today's. Pre-Tax wins by ~${Math.round(-a.rateGap * 100)}¢ per dollar contributed.`
    },
    'lean-roth': {
        title: 'Mostly Roth — consider going further',
        icon: '↗',
        color: 'text-info-bright',
        bg: 'bg-info-tint/20 border-info-strong/40',
        body: () => `Roth is the right call for your rate gap. You're partly there — moving the rest of your contributions to Roth captures more of the benefit.`
    },
    'lean-pretax': {
        title: 'Mostly Pre-Tax — consider going further',
        icon: '↗',
        color: 'text-info-bright',
        bg: 'bg-info-tint/20 border-info-strong/40',
        body: () => `Pre-Tax is the right call for your rate gap. You're partly there — moving the rest of your contributions to Pre-Tax captures more of the benefit.`
    },
    'either-fine': {
        title: 'Either choice is fine',
        icon: 'ℹ',
        color: 'text-content-default',
        bg: 'bg-surface-overlay/50 border-border-default',
        body: () => `Your rate today is roughly the same as at withdrawal, so the math is a wash. Pick the bucket that fits your other goals (estate planning, RMD risk, tax-rate uncertainty).`
    }
};

const getVerdictMeta = (verdict: AllocationVerdict) => VERDICT_META[verdict];

/**
 * Conversion Plan diagnostic — shows the active schedule if auto-conversions are
 * running, otherwise a teaser estimating the lifetime opportunity.
 */
const ConversionPlanSummary = ({ plan, autoEnabled, forceExact }: {
    plan: ConversionPlan;
    autoEnabled: boolean;
    forceExact: boolean;
}) => {
    const [expanded, setExpanded] = useState(false);

    if (plan.hasActiveSchedule) {
        const displayCount = expanded ? plan.schedule.length : Math.min(5, plan.schedule.length);
        return (
            <div className="bg-surface-overlay/50 rounded-xl p-4 border border-border-default">
                <h3 className="text-white font-semibold mb-3">Your Conversion Plan</h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3 text-sm">
                    <div>
                        <div className="text-xs text-content-muted uppercase tracking-wide">Total Converted</div>
                        <div className="text-white font-semibold">
                            {formatCompactCurrency(plan.totalConverted, { forceExact })}
                        </div>
                        <div className="text-xs text-content-subtle">
                            Across {plan.schedule.length} year{plan.schedule.length === 1 ? '' : 's'}
                            {plan.firstAge !== null && plan.lastAge !== null
                                ? ` (ages ${plan.firstAge}–${plan.lastAge})`
                                : ''}
                        </div>
                    </div>
                    <div>
                        <div className="text-xs text-content-muted uppercase tracking-wide">Total Tax Cost</div>
                        <div className="text-white font-semibold">
                            {formatCompactCurrency(plan.totalTaxCost, { forceExact })}
                        </div>
                        <div className="text-xs text-content-subtle">
                            ~{plan.totalConverted > 0 ? ((plan.totalTaxCost / plan.totalConverted) * 100).toFixed(1) : '0'}% effective (fed + state)
                        </div>
                    </div>
                    <div>
                        <div className="text-xs text-content-muted uppercase tracking-wide flex items-center gap-1">
                            Strategy
                            <Tooltip text="Auto-conversions fill brackets up to your target ceiling each retirement year. Edit the target in Assumptions → Investments." />
                        </div>
                        <div className="text-white font-semibold">Auto (active)</div>
                        <div className="text-xs text-content-subtle">Adjust ceiling in Assumptions</div>
                    </div>
                </div>

                <div className="overflow-x-auto max-h-96 overflow-y-auto rounded-lg border border-border-default">
                    <table className="w-full text-sm">
                        <thead className="sticky top-0 z-10 bg-surface-raised">
                            <tr>
                                <th className="px-3 py-2 text-left text-content-muted">Year</th>
                                <th className="px-3 py-2 text-left text-content-muted">Age</th>
                                <th className="px-3 py-2 text-right text-content-muted">Converted</th>
                                <th className="px-3 py-2 text-right text-content-muted">
                                    <span className="inline-flex items-center gap-1">
                                        Tax Cost
                                        <Tooltip text="Combined federal + state tax increase from this year's conversion. FICA is excluded since conversions aren't FICA-taxed." />
                                    </span>
                                </th>
                                <th className="px-3 py-2 text-right text-content-muted">
                                    <span className="inline-flex items-center gap-1">
                                        Eff. Rate
                                        <Tooltip text="Tax cost ÷ amount converted (fed + state). Lower than Marginal because each conversion fills brackets from the standard deduction (0%) upward through 10%, 12%, etc., before reaching the top bracket." />
                                    </span>
                                </th>
                                <th className="px-3 py-2 text-right text-content-muted">
                                    <span className="inline-flex items-center gap-1">
                                        Marginal
                                        <Tooltip text="Combined fed + state bracket rate at the top of this year's conversion — the rate the last converted dollar was taxed at." />
                                    </span>
                                </th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border-subtle">
                            {plan.schedule.slice(0, displayCount).map((entry) => {
                                const effRate = entry.amount > 0 ? (entry.taxCost / entry.amount) * 100 : 0;
                                return (
                                    <tr key={entry.year}>
                                        <td className="px-3 py-2 text-content-default">{entry.year}</td>
                                        <td className="px-3 py-2 text-content-default">{entry.age}</td>
                                        <td className="px-3 py-2 text-right text-white">
                                            {formatCompactCurrency(entry.amount, { forceExact })}
                                        </td>
                                        <td className="px-3 py-2 text-right text-negative">
                                            −{formatCompactCurrency(entry.taxCost, { forceExact })}
                                        </td>
                                        <td className="px-3 py-2 text-right text-content-muted">
                                            {effRate.toFixed(1)}%
                                        </td>
                                        <td className="px-3 py-2 text-right text-content-muted">
                                            {(entry.marginalRate * 100).toFixed(0)}%
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
                {plan.schedule.length > 5 && (
                    <button
                        onClick={() => setExpanded(!expanded)}
                        className="text-sm text-positive hover:text-positive-bright mt-2"
                    >
                        {expanded ? 'Show Less' : `Show All ${plan.schedule.length} Years`}
                    </button>
                )}
            </div>
        );
    }

    // Teaser: no active schedule
    if (!plan.numLowTaxYears || plan.numLowTaxYears === 0 || !plan.estimatedLifetimeSavings || plan.estimatedLifetimeSavings <= 0) {
        return null;
    }

    return (
        <div className="bg-info-tint/20 rounded-xl p-4 border border-info-strong/50">
            <h3 className="text-info-bright font-semibold mb-2">Consider Roth Conversions</h3>
            <p className="text-sm text-content-default mb-2">
                You have {plan.numLowTaxYears} upcoming low-tax year{plan.numLowTaxYears === 1 ? '' : 's'} where converting Traditional balances to Roth could save approximately{' '}
                <span className="text-white font-semibold">
                    {formatCompactCurrency(plan.estimatedLifetimeSavings, { forceExact })}
                </span>{' '}
                in lifetime taxes.
            </p>
            <p className="text-xs text-content-muted">
                ⚠ Conversion tax is paid upfront and irreversible. If markets drop or you die early, that prepayment is wasted (sequence-of-returns risk). Auto-conversions are
                {autoEnabled ? ' enabled' : ' disabled'} in your Assumptions.
            </p>
        </div>
    );
};


/**
 * Main Tax Optimization Tab
 */
export const TaxOptimizationTab = React.memo(({ simulationData }: TaxOptimizationTabProps) => {
    const { assumptions, dispatch } = useAssumptions();
    const { state: taxState } = useContext(TaxContext);
    const hsaEligible = assumptions.display?.hsaEligible ?? true;
    const forceExact = assumptions.display?.useCompactCurrency === false;

    // Analyze current year (first year of simulation)
    const analysis: TaxAnalysis | null = useMemo(() => {
        if (simulationData.length === 0) return null;
        return analyzeTaxSituation(simulationData[0], assumptions, taxState);
    }, [simulationData, assumptions, taxState]);

    // Check if user has traditional balances for Roth conversion recommendations
    const hasTraditional = useMemo(() => {
        return hasTraditionalRetirementBalance(simulationData);
    }, [simulationData]);

    // Generate recommendations
    const recommendations: TaxRecommendation[] = useMemo(() => {
        if (!analysis) return [];
        let recs = generateRecommendations(analysis, simulationData, assumptions, hasTraditional, taxState);
        if (!hsaEligible) {
            recs = recs.filter(rec => rec.id !== 'hsa-increase');
        }
        if (assumptions.investments?.autoRothConversions) {
            recs = recs.filter(rec => rec.id !== 'roth-conversion-window');
        }
        return recs;
    }, [analysis, simulationData, assumptions, hasTraditional, hsaEligible, taxState]);

    // Generate projections
    const projections: TaxProjection[] = useMemo(() => {
        return generateTaxProjections(simulationData, assumptions, taxState);
    }, [simulationData, assumptions, taxState]);

    // Roth/Pre-Tax allocation diagnostic (current 401(k) split)
    const allocation = useMemo(() => {
        return analyzeRothPreTaxAllocation(simulationData, assumptions, taxState);
    }, [simulationData, assumptions, taxState]);

    // Conversion plan diagnostic (active schedule or teaser)
    const conversionPlan = useMemo(() => {
        return analyzeConversionPlan(simulationData, assumptions, taxState);
    }, [simulationData, assumptions, taxState]);

    if (simulationData.length === 0 || !analysis) {
        return (
            <div className="flex items-center justify-center h-64 text-content-muted">
                Run a simulation to see tax optimization recommendations.
            </div>
        );
    }

    return (
        <div className="flex flex-col w-full gap-6 p-4">
            {/* Your Tax Snapshot */}
            <div>
                <h2 className="text-white font-semibold mb-4">
                    Your Tax Snapshot ({analysis.year})
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <StatCard
                        label="Effective Rate"
                        value={formatPercent(analysis.effectiveRate)}
                        sublabel={`${formatCompactCurrency(analysis.totalTax, { forceExact })} total tax`}
                        tooltip="Total tax paid divided by gross income"
                    />
                    <StatCard
                        label="Marginal Rate"
                        value={formatPercent(analysis.marginalRate.combined)}
                        sublabel={`Fed ${formatPercent(analysis.marginalRate.federal)} + State ${formatPercent(analysis.marginalRate.state)} + FICA ${formatPercent(analysis.marginalRate.fica)}`}
                        tooltip="Tax rate on the next dollar of income — combines federal bracket, state, and FICA"
                    />
                    <StatCard
                        label="Bracket Headroom"
                        value={analysis.federalHeadroom === Infinity
                            ? 'Top Bracket'
                            : formatCompactCurrency(analysis.federalHeadroom, { forceExact })}
                        sublabel="Until next federal bracket"
                        tooltip="Additional income you can earn before entering the next federal tax bracket"
                    />
                </div>
            </div>

            {/* Recommendations — surfaced above the fold */}
            {recommendations.length > 0 && (
                <div>
                    <h2 className="text-white font-semibold mb-4">What You Should Do</h2>
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        {recommendations.map((rec) => (
                            <RecommendationCard key={rec.id} rec={rec} />
                        ))}
                    </div>
                </div>
            )}

            {/* Contribution Status */}
            <div className="bg-surface-overlay/50 rounded-xl p-4 border border-border-default">
                <h3 className="text-white font-semibold mb-3">Contribution Status</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                        <div className="flex justify-between text-sm mb-1">
                            <span className="text-content-muted">401(k) Contributions</span>
                            <span className="text-white">
                                {formatCurrency(analysis.preTaxContributions.current401k)} /
                                {formatCurrency(analysis.preTaxContributions.limit401k)}
                            </span>
                        </div>
                        <div className="h-2 bg-surface-input rounded-full overflow-hidden">
                            <div
                                className="h-full bg-positive-soft rounded-full"
                                style={{
                                    width: `${Math.min(100, (analysis.preTaxContributions.current401k / analysis.preTaxContributions.limit401k) * 100)}%`
                                }}
                            />
                        </div>
                    </div>
                    {hsaEligible ? (
                        <div>
                            <div className="flex justify-between text-sm mb-1">
                                <span className="text-content-muted">HSA Contributions</span>
                                <span className="text-white">
                                    {formatCurrency(analysis.preTaxContributions.currentHSA)} /
                                    {formatCurrency(analysis.preTaxContributions.limitHSA)}
                                </span>
                            </div>
                            <div className="h-2 bg-surface-input rounded-full overflow-hidden">
                                <div
                                    className="h-full bg-positive-soft rounded-full"
                                    style={{
                                        width: `${Math.min(100, (analysis.preTaxContributions.currentHSA / analysis.preTaxContributions.limitHSA) * 100)}%`
                                    }}
                                />
                            </div>
                            <button
                                onClick={() => dispatch({ type: 'UPDATE_DISPLAY', payload: { hsaEligible: false } })}
                                className="text-xs text-content-muted hover:text-white mt-2 px-2 py-1 border border-border-strong hover:border-border-muted rounded transition-colors"
                            >
                                Not eligible for HSA
                            </button>
                        </div>
                    ) : (
                        <div className="flex items-center justify-between">
                            <span className="text-content-muted text-sm">HSA: Not eligible</span>
                            <button
                                onClick={() => dispatch({ type: 'UPDATE_DISPLAY', payload: { hsaEligible: true } })}
                                className="text-xs text-positive-soft hover:text-positive-bright px-2 py-1 border border-positive-strong hover:border-positive-soft rounded transition-colors"
                            >
                                I have an HDHP
                            </button>
                        </div>
                    )}
                </div>
            </div>

            {/* Roth/Pre-Tax allocation diagnostic — verdict only */}
            {allocation && <RothPreTaxVerdict allocation={allocation} />}

            {/* Conversion plan — schedule or teaser */}
            {conversionPlan && (
                <ConversionPlanSummary
                    plan={conversionPlan}
                    autoEnabled={!!assumptions.investments?.autoRothConversions}
                    forceExact={forceExact}
                />
            )}

            {/* Tax Projections Table */}
            <TaxProjectionTable projections={projections} forceExact={forceExact} />
        </div>
    );
});
