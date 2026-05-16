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
    <div className="bg-gray-800/50 rounded-xl p-4 border border-gray-700">
        <div className="flex items-center gap-1 mb-1">
            <div className="text-xs text-gray-400 uppercase tracking-wide">{label}</div>
            {tooltip && <Tooltip text={tooltip} />}
        </div>
        <div className="text-2xl font-bold text-white">{value}</div>
        {sublabel && <div className="text-xs text-gray-400 mt-1">{sublabel}</div>}
    </div>
);

/**
 * Recommendation card component
 */
const RecommendationCard = ({ rec }: { rec: TaxRecommendation }) => {
    const impactColors = {
        high: 'border-green-500 bg-green-900/20',
        medium: 'border-yellow-500 bg-yellow-900/20',
        low: 'border-gray-500 bg-gray-800/50'
    };

    const impactLabels = {
        high: 'HIGH IMPACT',
        medium: 'MEDIUM IMPACT',
        low: 'LOW IMPACT'
    };

    const impactTextColors = {
        high: 'text-green-400',
        medium: 'text-yellow-400',
        low: 'text-gray-400'
    };

    return (
        <div className={`rounded-xl border-2 p-4 ${impactColors[rec.impact]}`}>
            <div className="flex items-start justify-between mb-2">
                <h4 className="text-white font-semibold">{rec.title}</h4>
                <span className={`text-xs font-semibold ${impactTextColors[rec.impact]}`}>
                    {impactLabels[rec.impact]}
                </span>
            </div>
            <p className="text-gray-300 text-sm mb-3">{rec.description}</p>
            {rec.estimatedAnnualSavings > 0 && (
                <div className="text-green-400 font-semibold mb-2">
                    Estimated Savings: {formatCurrency(rec.estimatedAnnualSavings)}/year
                </div>
            )}
            <ul className="space-y-1">
                {rec.actionItems.map((item, i) => (
                    <li key={i} className="text-sm text-gray-400 flex items-start gap-2">
                        <span className="text-emerald-400 mt-0.5">-</span>
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
        <div className="bg-gray-800/50 rounded-xl border border-gray-700 overflow-hidden">
            <div className="p-4 border-b border-gray-700 flex justify-between items-center">
                <h3 className="text-white font-semibold">Tax Rate Projections</h3>
                {projections.length > 10 && (
                    <button
                        onClick={() => setExpanded(!expanded)}
                        className="text-sm text-emerald-400 hover:text-emerald-300"
                    >
                        {expanded ? 'Show Less' : `Show All (${projections.length})`}
                    </button>
                )}
            </div>
            <div className="overflow-x-auto">
                <table className="w-full text-sm">
                    <thead className="bg-gray-900/50">
                        <tr>
                            <th className="px-4 py-3 text-left text-gray-400">Year</th>
                            <th className="px-4 py-3 text-left text-gray-400">Age</th>
                            <th className="px-4 py-3 text-right text-gray-400">
                                <span className="inline-flex items-center gap-1 justify-end">
                                    Tax Base
                                    <Tooltip text="Total taxable activity for the year: income (work, SS, pension, passive, RMDs) + Roth conversions + non-RMD Traditional withdrawals. The denominator for the effective rate." />
                                </span>
                            </th>
                            <th className="px-4 py-3 text-right text-gray-400">Effective</th>
                            <th className="px-4 py-3 text-right text-gray-400">Marginal</th>
                            <th className="px-4 py-3 text-right text-gray-400">Fed Bracket</th>
                            <th className="px-4 py-3 text-center text-gray-400">Status</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-800">
                        {projections.slice(0, displayCount).map((proj) => (
                            <tr
                                key={proj.year}
                                className={proj.isLowTaxYear ? 'bg-green-900/10' : ''}
                            >
                                <td className="px-4 py-3 text-gray-300">{proj.year}</td>
                                <td className="px-4 py-3 text-gray-300">{proj.age}</td>
                                <td className="px-4 py-3 text-right text-gray-300">
                                    {formatCompactCurrency(proj.grossIncome, { forceExact })}
                                </td>
                                <td className="px-4 py-3 text-right text-gray-300">
                                    {formatPercent(proj.effectiveRate)}
                                </td>
                                <td className="px-4 py-3 text-right text-gray-300">
                                    {formatPercent(proj.marginalRate)}
                                </td>
                                <td className="px-4 py-3 text-right text-gray-300">
                                    {proj.federalBracket.toFixed(0)}%
                                </td>
                                <td className="px-4 py-3 text-center">
                                    {proj.isRetired ? (
                                        proj.isLowTaxYear ? (
                                            <span className="px-2 py-1 bg-green-500/20 text-green-400 rounded text-xs">
                                                Low Tax
                                            </span>
                                        ) : (
                                            <span className="px-2 py-1 bg-blue-500/20 text-blue-400 rounded text-xs">
                                                Retired
                                            </span>
                                        )
                                    ) : (
                                        <span className="px-2 py-1 bg-gray-700 text-gray-400 rounded text-xs">
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
                    <p className="text-sm text-gray-300">{verdictMeta.body(allocation)}</p>
                </div>
                <div className="text-right text-sm shrink-0">
                    <div className="text-gray-400">
                        Today <span className="text-white font-medium">{currentPct}</span>
                        <span className="text-gray-500 mx-2">vs</span>
                        {withdrawalLabel} <span className="text-white font-medium">{futurePct}</span>
                        <span className="ml-1 inline-block align-middle">
                            <Tooltip text="Federal + state marginal rate, excluding FICA. FICA is excluded because 401(k) contributions don't avoid it and RMDs aren't subject to it — only fed + state matters for the Roth vs Traditional decision. The 'Marginal Rate' card above includes FICA, which is why this number is lower." />
                        </span>
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5">
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
        color: 'text-green-400',
        bg: 'bg-green-900/20 border-green-700/40',
        body: (a) => a.rothFraction >= 0.5
            ? `Roth wins by your numbers, and you're already on Roth. Keep going.`
            : `Pre-Tax wins by your numbers, and you're already on Pre-Tax. Keep going.`
    },
    'should-be-roth': {
        title: 'Switch to Roth contributions',
        icon: '⚠',
        color: 'text-yellow-300',
        bg: 'bg-yellow-900/20 border-yellow-700/40',
        body: (a) =>
            `You're sending ${Math.round((1 - a.rothFraction) * 100)}% to Pre-Tax, but your future tax rate is higher than today's. Roth wins by ~${Math.round(a.rateGap * 100)}¢ per dollar contributed.`
    },
    'should-be-pretax': {
        title: 'Switch to Pre-Tax contributions',
        icon: '⚠',
        color: 'text-yellow-300',
        bg: 'bg-yellow-900/20 border-yellow-700/40',
        body: (a) =>
            `You're sending ${Math.round(a.rothFraction * 100)}% to Roth, but your future tax rate is lower than today's. Pre-Tax wins by ~${Math.round(-a.rateGap * 100)}¢ per dollar contributed.`
    },
    'lean-roth': {
        title: 'Mostly Roth — consider going further',
        icon: '↗',
        color: 'text-blue-300',
        bg: 'bg-blue-900/20 border-blue-700/40',
        body: () => `Roth is the right call for your rate gap. You're partly there — moving the rest of your contributions to Roth captures more of the benefit.`
    },
    'lean-pretax': {
        title: 'Mostly Pre-Tax — consider going further',
        icon: '↗',
        color: 'text-blue-300',
        bg: 'bg-blue-900/20 border-blue-700/40',
        body: () => `Pre-Tax is the right call for your rate gap. You're partly there — moving the rest of your contributions to Pre-Tax captures more of the benefit.`
    },
    'either-fine': {
        title: 'Either choice is fine',
        icon: 'ℹ',
        color: 'text-gray-300',
        bg: 'bg-gray-800/50 border-gray-700',
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
            <div className="bg-gray-800/50 rounded-xl p-4 border border-gray-700">
                <h3 className="text-white font-semibold mb-3">Your Conversion Plan</h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3 text-sm">
                    <div>
                        <div className="text-xs text-gray-400 uppercase tracking-wide">Total Converted</div>
                        <div className="text-white font-semibold">
                            {formatCompactCurrency(plan.totalConverted, { forceExact })}
                        </div>
                        <div className="text-xs text-gray-500">
                            Across {plan.schedule.length} year{plan.schedule.length === 1 ? '' : 's'}
                            {plan.firstAge !== null && plan.lastAge !== null
                                ? ` (ages ${plan.firstAge}–${plan.lastAge})`
                                : ''}
                        </div>
                    </div>
                    <div>
                        <div className="text-xs text-gray-400 uppercase tracking-wide">Total Tax Cost</div>
                        <div className="text-white font-semibold">
                            {formatCompactCurrency(plan.totalTaxCost, { forceExact })}
                        </div>
                        <div className="text-xs text-gray-500">
                            ~{plan.totalConverted > 0 ? ((plan.totalTaxCost / plan.totalConverted) * 100).toFixed(1) : '0'}% effective (fed + state)
                        </div>
                    </div>
                    <div>
                        <div className="text-xs text-gray-400 uppercase tracking-wide flex items-center gap-1">
                            Strategy
                            <Tooltip text="Auto-conversions fill brackets up to your target ceiling each retirement year. Edit the target in Assumptions → Investments." />
                        </div>
                        <div className="text-white font-semibold">Auto (active)</div>
                        <div className="text-xs text-gray-500">Adjust ceiling in Assumptions</div>
                    </div>
                </div>

                <div className="overflow-x-auto rounded-lg border border-gray-700">
                    <table className="w-full text-sm">
                        <thead className="bg-gray-900/50">
                            <tr>
                                <th className="px-3 py-2 text-left text-gray-400">Year</th>
                                <th className="px-3 py-2 text-left text-gray-400">Age</th>
                                <th className="px-3 py-2 text-right text-gray-400">Converted</th>
                                <th className="px-3 py-2 text-right text-gray-400">
                                    <span className="inline-flex items-center gap-1">
                                        Tax Cost
                                        <Tooltip text="Combined federal + state tax increase from this year's conversion. FICA is excluded since conversions aren't FICA-taxed." />
                                    </span>
                                </th>
                                <th className="px-3 py-2 text-right text-gray-400">
                                    <span className="inline-flex items-center gap-1">
                                        Eff. Rate
                                        <Tooltip text="Tax cost ÷ amount converted (fed + state). Lower than Marginal because each conversion fills brackets from the standard deduction (0%) upward through 10%, 12%, etc., before reaching the top bracket." />
                                    </span>
                                </th>
                                <th className="px-3 py-2 text-right text-gray-400">
                                    <span className="inline-flex items-center gap-1">
                                        Marginal
                                        <Tooltip text="Combined fed + state bracket rate at the top of this year's conversion — the rate the last converted dollar was taxed at." />
                                    </span>
                                </th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-800">
                            {plan.schedule.slice(0, displayCount).map((entry) => {
                                const effRate = entry.amount > 0 ? (entry.taxCost / entry.amount) * 100 : 0;
                                return (
                                    <tr key={entry.year}>
                                        <td className="px-3 py-2 text-gray-300">{entry.year}</td>
                                        <td className="px-3 py-2 text-gray-300">{entry.age}</td>
                                        <td className="px-3 py-2 text-right text-white">
                                            {formatCompactCurrency(entry.amount, { forceExact })}
                                        </td>
                                        <td className="px-3 py-2 text-right text-red-400">
                                            −{formatCompactCurrency(entry.taxCost, { forceExact })}
                                        </td>
                                        <td className="px-3 py-2 text-right text-gray-400">
                                            {effRate.toFixed(1)}%
                                        </td>
                                        <td className="px-3 py-2 text-right text-gray-400">
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
                        className="text-sm text-emerald-400 hover:text-emerald-300 mt-2"
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
        <div className="bg-blue-900/20 rounded-xl p-4 border border-blue-700/50">
            <h3 className="text-blue-300 font-semibold mb-2">Consider Roth Conversions</h3>
            <p className="text-sm text-gray-300 mb-2">
                You have {plan.numLowTaxYears} upcoming low-tax year{plan.numLowTaxYears === 1 ? '' : 's'} where converting Traditional balances to Roth could save approximately{' '}
                <span className="text-white font-semibold">
                    {formatCompactCurrency(plan.estimatedLifetimeSavings, { forceExact })}
                </span>{' '}
                in lifetime taxes.
            </p>
            <p className="text-xs text-gray-400">
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
            <div className="flex items-center justify-center h-64 text-gray-400">
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
            <div className="bg-gray-800/50 rounded-xl p-4 border border-gray-700">
                <h3 className="text-white font-semibold mb-3">Contribution Status</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                        <div className="flex justify-between text-sm mb-1">
                            <span className="text-gray-400">401(k) Contributions</span>
                            <span className="text-white">
                                {formatCurrency(analysis.preTaxContributions.current401k)} /
                                {formatCurrency(analysis.preTaxContributions.limit401k)}
                            </span>
                        </div>
                        <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
                            <div
                                className="h-full bg-emerald-500 rounded-full"
                                style={{
                                    width: `${Math.min(100, (analysis.preTaxContributions.current401k / analysis.preTaxContributions.limit401k) * 100)}%`
                                }}
                            />
                        </div>
                    </div>
                    {hsaEligible ? (
                        <div>
                            <div className="flex justify-between text-sm mb-1">
                                <span className="text-gray-400">HSA Contributions</span>
                                <span className="text-white">
                                    {formatCurrency(analysis.preTaxContributions.currentHSA)} /
                                    {formatCurrency(analysis.preTaxContributions.limitHSA)}
                                </span>
                            </div>
                            <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
                                <div
                                    className="h-full bg-emerald-500 rounded-full"
                                    style={{
                                        width: `${Math.min(100, (analysis.preTaxContributions.currentHSA / analysis.preTaxContributions.limitHSA) * 100)}%`
                                    }}
                                />
                            </div>
                            <button
                                onClick={() => dispatch({ type: 'UPDATE_DISPLAY', payload: { hsaEligible: false } })}
                                className="text-xs text-gray-400 hover:text-white mt-2 px-2 py-1 border border-gray-600 hover:border-gray-400 rounded transition-colors"
                            >
                                Not eligible for HSA
                            </button>
                        </div>
                    ) : (
                        <div className="flex items-center justify-between">
                            <span className="text-gray-400 text-sm">HSA: Not eligible</span>
                            <button
                                onClick={() => dispatch({ type: 'UPDATE_DISPLAY', payload: { hsaEligible: true } })}
                                className="text-xs text-emerald-500 hover:text-emerald-300 px-2 py-1 border border-emerald-700 hover:border-emerald-500 rounded transition-colors"
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
