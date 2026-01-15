import React, { useState, useContext, useMemo } from 'react';
import { SimulationYear } from '../../../components/Objects/Assumptions/SimulationEngine';
import { useAssumptions } from '../../../components/Objects/Assumptions/AssumptionsContext';
import { TaxContext } from '../../../components/Objects/Taxes/TaxContext';
import { formatCompactCurrency, formatCurrency } from './FutureUtils';
import { CurrencyInput } from '../../../components/Layout/InputFields/CurrencyInput';
import { Tooltip } from '../../../components/Layout/InputFields/Tooltip';
import {
    analyzeTaxSituation,
    generateRecommendations,
    generateTaxProjections,
    calculateRothConversion,
    hasTraditionalRetirementBalance,
    TaxAnalysis,
    TaxRecommendation,
    TaxProjection,
    RothConversionResult
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
                            <th className="px-4 py-3 text-right text-gray-400">Income</th>
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
 * Roth Conversion Calculator component
 * Also useful for comparing Roth vs Traditional contributions
 */
const RothConversionCalculator = ({
    taxState,
    assumptions,
    simulation,
    projections,
    forceExact
}: {
    taxState: any;
    assumptions: any;
    simulation: SimulationYear[];
    projections: TaxProjection[];
    forceExact: boolean;
}) => {
    const [conversionAmount, setConversionAmount] = useState(10000);
    const startAge = assumptions.demographics.startAge;
    const startYear = assumptions.demographics.startYear;
    const [selectedAge, setSelectedAge] = useState(startAge);

    // Build age options from projections with low-tax year indicators
    const ageOptions = useMemo(() => {
        return projections.map(proj => ({
            age: proj.age,
            year: proj.year,
            isLowTax: proj.isLowTaxYear,
            isRetired: proj.isRetired,
            federalBracket: proj.federalBracket
        }));
    }, [projections]);

    // Get taxable income for selected year from simulation
    const { selectedYear, taxableIncome } = useMemo(() => {
        const yearNum = startYear + (selectedAge - startAge);
        const simYear = simulation.find(s => s.year === yearNum);
        if (!simYear) {
            return { selectedYear: yearNum, taxableIncome: 0 };
        }
        // Calculate taxable income from simulation data
        const grossIncome = simYear.cashflow.totalIncome;
        const preTaxDeductions = (simYear.taxDetails.preTax || 0);
        return {
            selectedYear: yearNum,
            taxableIncome: Math.max(0, grossIncome - preTaxDeductions)
        };
    }, [selectedAge, startAge, startYear, simulation]);

    const result: RothConversionResult = useMemo(() => {
        return calculateRothConversion(
            conversionAmount,
            taxableIncome,
            taxState,
            selectedYear,
            assumptions,
            simulation
        );
    }, [conversionAmount, taxableIncome, taxState, selectedYear, assumptions, simulation]);

    const benefitColor = result.benefit > 0 ? 'text-green-400' : result.benefit < 0 ? 'text-red-400' : 'text-gray-400';
    const benefitLabel = result.benefit > 0 ? 'Roth wins' : result.benefit < 0 ? 'Traditional wins' : 'Break-even';
    const selectedOption = ageOptions.find(o => o.age === selectedAge);

    return (
        <div className="bg-gray-800/50 rounded-xl p-4 border border-gray-700">
            <div className="flex items-center gap-2 mb-4">
                <h3 className="text-white font-semibold">Roth Conversion Calculator</h3>
                <Tooltip text="Also useful for comparing Roth vs Traditional contributions. The math is the same: pay tax now (Roth) vs pay tax later (Traditional)." />
            </div>
            <p className="text-gray-400 text-sm mb-4">
                Compare keeping {formatCompactCurrency(conversionAmount, { forceExact })} in a traditional account vs. converting to Roth at age {selectedAge}.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
                <CurrencyInput
                    label="Conversion Amount"
                    value={conversionAmount}
                    onChange={setConversionAmount}
                />
                <div>
                    <label className="block text-xs uppercase text-gray-400 font-semibold mb-1">
                        Conversion Age
                    </label>
                    <select
                        value={selectedAge}
                        onChange={(e) => setSelectedAge(Number(e.target.value))}
                        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    >
                        {ageOptions.map(opt => (
                            <option key={opt.age} value={opt.age}>
                                {opt.age} {opt.age === startAge ? '(Now)' : ''} {opt.isLowTax ? '⭐' : ''} - {opt.federalBracket.toFixed(0)}% bracket
                            </option>
                        ))}
                    </select>
                    {selectedOption?.isLowTax && (
                        <p className="text-xs text-green-400 mt-1">
                            ⭐ Low tax year - good for conversions
                        </p>
                    )}
                </div>
            </div>

            {/* Side-by-side comparison */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                {/* Traditional Path */}
                <div className="bg-gray-900/50 rounded-lg p-4 border border-gray-700">
                    <h4 className="text-sm font-semibold text-orange-400 mb-3">Keep in Traditional</h4>
                    <div className="space-y-2 text-sm">
                        <div className="flex justify-between">
                            <span className="text-gray-400">Starting Amount:</span>
                            <span className="text-white">{formatCompactCurrency(result.traditional.startingAmount, { forceExact })}</span>
                        </div>
                        <div className="flex justify-between items-center">
                            <span className="text-gray-400">Growth ({result.dataUsed.yearsUntilRetirement} yrs @ {(result.dataUsed.annualGrowthRate * 100).toFixed(1)}%):</span>
                            <span className="text-gray-400">↓</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-gray-400">Value at Retirement:</span>
                            <span className="text-white">{formatCompactCurrency(result.traditional.valueAtRetirement, { forceExact })}</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-gray-400">Tax at Withdrawal ({(result.dataUsed.retirementTaxRate * 100).toFixed(1)}%):</span>
                            <span className="text-red-400">-{formatCompactCurrency(result.traditional.taxAtWithdrawal, { forceExact })}</span>
                        </div>
                        <div className="flex justify-between border-t border-gray-700 pt-2 mt-2">
                            <span className="text-gray-300 font-medium">After-Tax Value:</span>
                            <span className="text-orange-400 font-bold">{formatCompactCurrency(result.traditional.afterTaxValue, { forceExact })}</span>
                        </div>
                    </div>
                </div>

                {/* Roth Path */}
                <div className="bg-gray-900/50 rounded-lg p-4 border border-gray-700">
                    <h4 className="text-sm font-semibold text-blue-400 mb-3">Convert to Roth</h4>
                    <div className="space-y-2 text-sm">
                        <div className="flex justify-between">
                            <span className="text-gray-400">Starting Amount:</span>
                            <span className="text-white">{formatCompactCurrency(conversionAmount, { forceExact })}</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-gray-400">Tax on Conversion ({(result.dataUsed.currentTaxRate * 100).toFixed(1)}%):</span>
                            <span className="text-red-400">-{formatCompactCurrency(result.immediateTaxCost, { forceExact })}</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-gray-400">After-Tax Amount:</span>
                            <span className="text-white">{formatCompactCurrency(result.roth.amountAfterConversionTax, { forceExact })}</span>
                        </div>
                        <div className="flex justify-between items-center">
                            <span className="text-gray-400">Growth ({result.dataUsed.yearsUntilRetirement} yrs @ {(result.dataUsed.annualGrowthRate * 100).toFixed(1)}%):</span>
                            <span className="text-gray-400">↓</span>
                        </div>
                        <div className="flex justify-between border-t border-gray-700 pt-2 mt-2">
                            <span className="text-gray-300 font-medium">Value at Retirement:</span>
                            <span className="text-blue-400 font-bold">{formatCompactCurrency(result.roth.valueAtRetirement, { forceExact })}</span>
                        </div>
                        <div className="text-xs text-gray-400 text-right">(Tax-free withdrawals)</div>
                    </div>
                </div>
            </div>

            {/* Result Summary */}
            <div className={`p-4 rounded-lg border ${result.benefit > 0 ? 'bg-green-900/20 border-green-700/30' : result.benefit < 0 ? 'bg-red-900/20 border-red-700/30' : 'bg-gray-900/50 border-gray-700'}`}>
                <div className="flex justify-between items-center">
                    <div>
                        <div className="text-sm text-gray-400">Difference at Retirement</div>
                        <div className={`text-2xl font-bold ${benefitColor}`}>
                            {result.benefit >= 0 ? '+' : ''}{formatCompactCurrency(result.benefit, { forceExact })}
                        </div>
                    </div>
                    <div className={`text-lg font-semibold ${benefitColor}`}>
                        {benefitLabel}
                    </div>
                </div>
                <p className="text-xs text-gray-400 mt-2">
                    {result.benefit > 0
                        ? `Converting to Roth at age ${selectedAge} gives you ${formatCompactCurrency(result.benefit, { forceExact })} more at retirement because the tax rate at conversion (${(result.dataUsed.currentTaxRate * 100).toFixed(1)}%) is lower than your projected retirement rate (${(result.dataUsed.retirementTaxRate * 100).toFixed(1)}%).`
                        : result.benefit < 0
                        ? `Keeping in traditional gives you ${formatCompactCurrency(Math.abs(result.benefit), { forceExact })} more at retirement because the tax rate at age ${selectedAge} (${(result.dataUsed.currentTaxRate * 100).toFixed(1)}%) is higher than your projected retirement rate (${(result.dataUsed.retirementTaxRate * 100).toFixed(1)}%).`
                        : 'Both options result in the same after-tax value at retirement.'}
                </p>
            </div>
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
        return generateRecommendations(analysis, simulationData, assumptions, hasTraditional);
    }, [analysis, simulationData, assumptions, hasTraditional]);

    // Generate projections
    const projections: TaxProjection[] = useMemo(() => {
        return generateTaxProjections(simulationData, assumptions, taxState);
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
            {/* Current Tax Situation */}
            <div>
                <h2 className="text-white font-semibold mb-4">
                    Current Tax Situation (Year {analysis.year})
                </h2>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
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
                        tooltip="Tax rate on the next dollar of income"
                    />
                    <StatCard
                        label="Federal Bracket"
                        value={`${analysis.federalBracket.toFixed(0)}%`}
                        sublabel={`${formatCompactCurrency(analysis.taxableIncome, { forceExact })} taxable`}
                    />
                    <StatCard
                        label="Bracket Headroom"
                        value={analysis.federalHeadroom === Infinity
                            ? 'Top Bracket'
                            : formatCompactCurrency(analysis.federalHeadroom, { forceExact })}
                        sublabel="Until next bracket"
                        tooltip="Additional income you can earn before entering the next tax bracket"
                    />
                </div>
            </div>

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
                                className="text-xs text-gray-400 hover:text-gray-400 mt-1"
                            >
                                Not eligible for HSA?
                            </button>
                        </div>
                    ) : (
                        <div className="flex items-center justify-between">
                            <span className="text-gray-400 text-sm">HSA: Not eligible</span>
                            <button
                                onClick={() => dispatch({ type: 'UPDATE_DISPLAY', payload: { hsaEligible: true } })}
                                className="text-xs text-emerald-500 hover:text-emerald-400"
                            >
                                I have an HDHP
                            </button>
                        </div>
                    )}
                </div>
            </div>

            {/* Recommendations */}
            {recommendations.length > 0 && (
                <div>
                    <h2 className="text-white font-semibold mb-4">Recommendations</h2>
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        {recommendations.map((rec) => (
                            <RecommendationCard key={rec.id} rec={rec} />
                        ))}
                    </div>
                </div>
            )}

            {/* Roth Conversion Calculator */}
            {hasTraditional && (
                <RothConversionCalculator
                    taxState={taxState}
                    assumptions={assumptions}
                    simulation={simulationData}
                    projections={projections}
                    forceExact={forceExact}
                />
            )}

            {/* Tax Projections Table */}
            <TaxProjectionTable projections={projections} forceExact={forceExact} />
        </div>
    );
});

export default TaxOptimizationTab;
