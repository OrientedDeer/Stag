import React, { useState, useContext, useMemo } from 'react';
import { SimulationYear } from '../../../components/Objects/Assumptions/SimulationEngine';
import { InvestedAccount } from '../../../components/Objects/Accounts/models';
import { useAssumptions, getRetirementAge, getLifeExpectancy, getBirthYear } from '../../../components/Objects/Assumptions/AssumptionsContext';
import { TaxContext } from '../../../components/Objects/Taxes/TaxContext';
import { formatCompactCurrency, formatCurrency } from './FutureUtils';
import { CurrencyInput } from '../../../components/Layout/InputFields/CurrencyInput';
import { Tooltip } from '../../../components/Layout/InputFields/Tooltip';
import { NumberInput } from '../../../components/Layout/InputFields/NumberInput';
import {
    analyzeTaxSituation,
    generateRecommendations,
    generateTaxProjections,
    analyzeRothVsPreTax,
    findOptimalRothAmount,
    hasTraditionalRetirementBalance,
    TaxAnalysis,
    TaxRecommendation,
    TaxProjection,
    RothAnalysis
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
 * Tax Rate Sparkline — inline SVG showing federal bracket by age
 */
const TaxRateSparkline = ({ projections, selectedAge, breakEvenRate }: {
    projections: TaxProjection[];
    selectedAge: number;
    breakEvenRate: number;
}) => {
    if (projections.length < 2) return null;

    const width = 300;
    const height = 80;
    const padding = { top: 4, bottom: 14, left: 0, right: 0 };
    const plotWidth = width - padding.left - padding.right;
    const plotHeight = height - padding.top - padding.bottom;

    const ages = projections.map(p => p.age);
    const rates = projections.map(p => p.federalBracket / 100);
    const minAge = ages[0];
    const maxAge = ages[ages.length - 1];
    const maxRate = 0.37;

    const xScale = (age: number) => padding.left + ((age - minAge) / (maxAge - minAge)) * plotWidth;
    const yScale = (rate: number) => padding.top + plotHeight - (Math.min(rate, maxRate) / maxRate) * plotHeight;

    // Build the rate polyline path
    const linePath = rates.map((r, i) =>
        `${i === 0 ? 'M' : 'L'} ${xScale(ages[i]).toFixed(1)} ${yScale(r).toFixed(1)}`
    ).join(' ');

    // Build shaded regions: green above break-even, red below
    const breakEvenY = yScale(breakEvenRate);
    const selectedIdx = ages.indexOf(selectedAge);
    const selectedRate = selectedIdx >= 0 ? rates[selectedIdx] : rates[0];

    return (
        <div className="mt-3">
            <div className="text-xs text-gray-500 mb-1">Federal Bracket by Age</div>
            <svg width={width} height={height} className="w-full max-w-sm" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
                {/* Break-even horizontal line */}
                <line
                    x1={padding.left} x2={width - padding.right}
                    y1={breakEvenY} y2={breakEvenY}
                    stroke="#6b7280" strokeDasharray="4 2" strokeWidth={1}
                />
                {/* Break-even label */}
                <text x={width - padding.right - 2} y={breakEvenY - 3} textAnchor="end" className="fill-gray-500" fontSize="8">
                    {(breakEvenRate * 100).toFixed(0)}%
                </text>

                {/* Rate line */}
                <path d={linePath} fill="none" stroke="#60a5fa" strokeWidth={1.5} />

                {/* Selected age marker */}
                {selectedIdx >= 0 && (
                    <circle
                        cx={xScale(selectedAge)}
                        cy={yScale(selectedRate)}
                        r={4}
                        className="fill-white stroke-blue-400"
                        strokeWidth={1.5}
                    />
                )}

                {/* Age labels */}
                <text x={padding.left + 2} y={height - 2} fontSize="9" className="fill-gray-500">{minAge}</text>
                <text x={width - padding.right - 2} y={height - 2} textAnchor="end" fontSize="9" className="fill-gray-500">{maxAge}</text>
            </svg>
        </div>
    );
};

/**
 * Roth vs Pre-Tax Analysis Panel
 * Supports both new contribution decisions and conversion decisions with explicit controls.
 */
const RothAnalysisPanel = ({
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
    // Guard: if milestones not loaded yet, don't render
    if (!assumptions?.milestones) {
        return null;
    }

    const [mode, setMode] = useState<'contribution' | 'conversion'>('contribution');
    const startYear = new Date().getFullYear();
    const startAge = startYear - getBirthYear(assumptions.milestones);
    const retirementAge = getRetirementAge(assumptions.milestones);
    const lifeExpectancy = getLifeExpectancy(assumptions.milestones);

    const defaultGrowthYears = useMemo(() => {
        return startAge < retirementAge
            ? retirementAge - startAge
            : Math.max(1, Math.floor((lifeExpectancy - startAge) / 2));
    }, [startAge, retirementAge, lifeExpectancy]);

    const [manualAmount, setManualAmount] = useState(10000);
    const [autoAmount, setAutoAmount] = useState(true);
    const [selectedAge, setSelectedAge] = useState(startAge);
    const [growthYears, setGrowthYears] = useState(defaultGrowthYears);

    // Update defaults when mode changes
    const handleModeChange = (newMode: 'contribution' | 'conversion') => {
        setMode(newMode);
        setAutoAmount(true);
    };

    const handleAmountChange = (val: number) => {
        setManualAmount(val);
    };

    // Recalculate default growth years when age changes
    const effectiveGrowthYears = useMemo(() => {
        if (selectedAge < retirementAge) {
            return retirementAge - selectedAge;
        }
        return Math.max(1, Math.floor((lifeExpectancy - selectedAge) / 2));
    }, [selectedAge, retirementAge, lifeExpectancy]);

    // Update growth years when age changes (unless user has explicitly overridden)
    const [userOverrodeGrowth, setUserOverrodeGrowth] = useState(false);
    const displayGrowthYears = userOverrodeGrowth ? growthYears : effectiveGrowthYears;

    const handleGrowthYearsChange = (val: number) => {
        setGrowthYears(val);
        setUserOverrodeGrowth(true);
    };

    const handleAgeChange = (newAge: number) => {
        setSelectedAge(newAge);
        setUserOverrodeGrowth(false);
    };

    // Build age options
    const ageOptions = useMemo(() => {
        return projections.map(proj => ({
            age: proj.age,
            year: proj.year,
            isLowTax: proj.isLowTaxYear,
            federalBracket: proj.federalBracket
        }));
    }, [projections]);

    // Get taxable income, SS benefits, LTCG, and search max for selected year
    const { selectedYear, taxableIncome, socialSecurityBenefits, ltcgIncome, searchMax } = useMemo(() => {
        const yearNum = startYear + (selectedAge - startAge);
        const simYear = simulation.find(s => s.year === yearNum);
        if (!simYear) {
            return { selectedYear: yearNum, taxableIncome: 0, socialSecurityBenefits: 0, ltcgIncome: 0, searchMax: 10000 };
        }
        const grossIncome = simYear.cashflow.totalIncome;
        const preTaxDeductions = (simYear.taxDetails.preTax || 0);
        // Max = disposable income + traditional balance (realistic conversion/contribution ceiling)
        const traditionalBalance = simYear.accounts
            .filter((acc): acc is InvestedAccount =>
                acc instanceof InvestedAccount &&
                (acc.taxType === 'Traditional 401k' || acc.taxType === 'Traditional IRA')
            )
            .reduce((sum, acc) => sum + acc.amount, 0);
        const disposableIncome = Math.max(0, grossIncome - simYear.cashflow.totalExpense);
        // Extract Social Security benefits from incomes
        const ssBenefits = simYear.incomes
            .filter(inc => (inc as any).className === 'SocialSecurityIncome')
            .reduce((sum, inc) => sum + (inc.getAnnualAmount?.() ?? 0), 0);
        // LTCG is typically from capital gains tax details or 0 if not available
        const ltcg = simYear.taxDetails.capitalGains || 0;
        return {
            selectedYear: yearNum,
            taxableIncome: Math.max(0, grossIncome - preTaxDeductions),
            socialSecurityBenefits: ssBenefits,
            ltcgIncome: ltcg,
            searchMax: disposableIncome + traditionalBalance
        };
    }, [selectedAge, startAge, startYear, simulation]);

    // Compute optimal amount independently (doesn't depend on user's chosen amount)
    const optimal = useMemo(() => {
        return findOptimalRothAmount(
            mode, displayGrowthYears, taxableIncome,
            socialSecurityBenefits, ltcgIncome,
            taxState, selectedYear, assumptions, simulation, searchMax,
            null  // stateParams - TODO: add state tax support
        );
    }, [mode, displayGrowthYears, taxableIncome, socialSecurityBenefits, ltcgIncome, taxState, selectedYear, assumptions, simulation, searchMax]);

    // Derive display amount: auto tracks optimal, manual uses user's value
    const displayAmount = autoAmount && optimal.optimalAmount
        ? optimal.optimalAmount
        : autoAmount
        ? (mode === 'contribution' ? 1000 : 10000)
        : manualAmount;

    // Run analysis with the display amount
    const analysis: RothAnalysis = useMemo(() => {
        return analyzeRothVsPreTax(
            displayAmount,
            mode,
            displayGrowthYears,
            taxableIncome,
            socialSecurityBenefits,
            ltcgIncome,
            taxState,
            selectedYear,
            assumptions,
            simulation,
            searchMax,
            null  // stateParams - TODO: add state tax support
        );
    }, [displayAmount, mode, displayGrowthYears, taxableIncome, socialSecurityBenefits, ltcgIncome, taxState, selectedYear, assumptions, simulation, searchMax]);

    const benefitColor = analysis.verdict === 'roth' ? 'text-green-400' : analysis.verdict === 'traditional' ? 'text-red-400' : 'text-gray-400';
    const benefitLabel = analysis.verdict === 'roth' ? 'Roth wins' : analysis.verdict === 'traditional' ? 'Pre-Tax wins' : 'Break-even';
    const heroBorderColor = analysis.verdict === 'roth' ? 'border-green-700/50' : analysis.verdict === 'traditional' ? 'border-red-700/50' : 'border-gray-700';

    // Labels based on mode
    const tradLabel = mode === 'contribution' ? 'Pre-Tax Path' : 'Keep in Pre-Tax';
    const rothLabel = mode === 'contribution' ? 'Roth Path' : 'Convert to Roth';
    const taxNowLabel = mode === 'contribution' ? 'Marginal rate' : 'Effective on conversion';

    return (
        <div className="bg-gray-800/50 rounded-xl p-4 border border-gray-700">
            {/* Header + Mode Toggle */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
                <h3 className="text-white font-semibold">Roth vs Pre-Tax Analysis</h3>
                <div className="flex bg-gray-900/50 rounded-lg p-0.5 border border-gray-700">
                    <button
                        onClick={() => handleModeChange('contribution')}
                        className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                            mode === 'contribution'
                                ? 'bg-emerald-600 text-white'
                                : 'text-gray-400 hover:text-white'
                        }`}
                    >
                        New Contribution
                    </button>
                    <button
                        onClick={() => handleModeChange('conversion')}
                        className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                            mode === 'conversion'
                                ? 'bg-emerald-600 text-white'
                                : 'text-gray-400 hover:text-white'
                        }`}
                    >
                        Conversion
                    </button>
                </div>
            </div>

            <p className="text-gray-400 text-sm mb-4">
                {mode === 'contribution'
                    ? 'Should your next savings dollars go into Roth or Pre-Tax?'
                    : 'Should you convert existing Pre-Tax money to Roth?'}
            </p>

            {/* Controls Row */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
                <div className="relative">
                    <CurrencyInput
                        label={autoAmount ? "Amount (auto)" : "Amount"}
                        value={displayAmount}
                        onChange={handleAmountChange}
                        disabled={autoAmount}
                    />
                    <button
                        onClick={() => {
                            if (autoAmount) {
                                setManualAmount(displayAmount);
                            }
                            setAutoAmount(!autoAmount);
                        }}
                        className={`absolute top-0 right-0 text-xs px-1.5 py-0.5 rounded transition-colors ${
                            autoAmount
                                ? 'text-emerald-400 hover:text-emerald-300'
                                : 'text-gray-400 hover:text-white'
                        }`}
                        title={autoAmount ? 'Unlock to set manually' : 'Lock to auto-calculate optimal'}
                    >
                        {autoAmount ? 'unlock' : 'auto'}
                    </button>
                </div>
                <div>
                    <label className="block text-xs uppercase text-gray-400 font-semibold mb-1">
                        Year / Age
                    </label>
                    <select
                        value={selectedAge}
                        onChange={(e) => handleAgeChange(Number(e.target.value))}
                        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    >
                        {ageOptions.map(opt => (
                            <option key={opt.age} value={opt.age}>
                                {opt.age} ({opt.year}) {opt.isLowTax ? '⭐' : ''} - {opt.federalBracket.toFixed(0)}%
                            </option>
                        ))}
                    </select>
                </div>
                <NumberInput
                    label="Growth Years"
                    value={displayGrowthYears}
                    onChange={handleGrowthYearsChange}
                    min={1}
                    max={80}
                    tooltip="Years until you withdraw this money"
                />
            </div>

            {/* Optimal Amount Info */}
            <div className="bg-gray-900/30 rounded-lg px-4 py-2.5 mb-4 text-sm text-gray-400">
                {optimal.optimalVerdict === 'all-roth' && (
                    <span>Roth is favorable at any amount for this year and growth period.</span>
                )}
                {optimal.optimalVerdict === 'all-traditional' && (
                    <span>Pre-Tax is better at any amount — withdrawal tax is lower than current.</span>
                )}
                {optimal.optimalVerdict === 'optimal' && optimal.optimalAmount && (
                    <span>
                        Peak Roth benefit at{' '}
                        <span className="text-white font-medium">{formatCompactCurrency(optimal.optimalAmount, { forceExact })}</span>
                        {' — beyond this, each additional dollar favors '}
                        {'Pre-Tax'}.
                    </span>
                )}
            </div>

            {/* Rate Comparison Hero */}
            <div className={`rounded-lg border ${heroBorderColor} bg-gray-900/50 p-4 mb-4`}>
                <div className="grid grid-cols-3 items-center text-center">
                    <div>
                        <div className="text-xs text-gray-400 mb-1">Tax Rate Now</div>
                        <div className="text-2xl font-bold text-white">
                            {(analysis.currentEffectiveRate * 100).toFixed(1)}%
                        </div>
                        <div className="text-xs text-gray-500 mt-0.5">{taxNowLabel}</div>
                    </div>
                    <div className="text-gray-500 text-xl">vs</div>
                    <div>
                        <div className="text-xs text-gray-400 mb-1">Tax at Withdrawal</div>
                        <div className="text-2xl font-bold text-white">
                            {(analysis.retirementMarginalRate * 100).toFixed(1)}%
                        </div>
                        <div className="text-xs text-gray-500 mt-0.5">Effective at age {selectedAge + displayGrowthYears}</div>
                    </div>
                </div>
                <div className="text-center mt-3 text-sm text-gray-400">
                    Break-even: <span className="text-white font-medium">{(analysis.breakEvenRate * 100).toFixed(1)}%</span>
                    {' — '}
                    {analysis.verdict === 'roth'
                        ? <span className="text-green-400">Roth wins if future rate stays above {(analysis.breakEvenRate * 100).toFixed(1)}%</span>
                        : analysis.verdict === 'traditional'
                        ? <span className="text-red-400">Roth only wins if future rate exceeds {(analysis.breakEvenRate * 100).toFixed(1)}%</span>
                        : <span className="text-gray-400">Future rate equals break-even</span>
                    }
                </div>
            </div>

            {/* Sparkline */}
            <TaxRateSparkline
                projections={projections}
                selectedAge={selectedAge}
                breakEvenRate={analysis.breakEvenRate}
            />

            {/* Side-by-side comparison */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4 mt-4">
                {/* Traditional / Pre-Tax Path */}
                <div className="bg-gray-900/50 rounded-lg p-4 border border-gray-700">
                    <h4 className="text-sm font-semibold text-orange-400 mb-3">{tradLabel}</h4>
                    <div className="space-y-2 text-sm">
                        <div className="flex justify-between">
                            <span className="text-gray-400">Starting Amount:</span>
                            <span className="text-white">{formatCompactCurrency(analysis.traditional.startingAmount, { forceExact })}</span>
                        </div>
                        <div className="flex justify-between items-center">
                            <span className="text-gray-400">
                                {formatCompactCurrency(analysis.traditional.startingAmount, { forceExact })} x (1+{(analysis.growthRate * 100).toFixed(1)}%)^{displayGrowthYears}
                            </span>
                            <span className="text-white">{formatCompactCurrency(analysis.traditional.valueAtWithdrawal, { forceExact })}</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-gray-400">Tax at Withdrawal ({(analysis.retirementMarginalRate * 100).toFixed(1)}%):</span>
                            <span className="text-red-400">-{formatCompactCurrency(analysis.traditional.taxAtWithdrawal, { forceExact })}</span>
                        </div>
                        <div className="flex justify-between border-t border-gray-700 pt-2 mt-2">
                            <span className="text-gray-300 font-medium">After-Tax Value:</span>
                            <span className="text-orange-400 font-bold">{formatCompactCurrency(analysis.traditional.afterTaxValue, { forceExact })}</span>
                        </div>
                    </div>
                </div>

                {/* Roth Path */}
                <div className="bg-gray-900/50 rounded-lg p-4 border border-gray-700">
                    <h4 className="text-sm font-semibold text-blue-400 mb-3">{rothLabel}</h4>
                    <div className="space-y-2 text-sm">
                        <div className="flex justify-between">
                            <span className="text-gray-400">Starting Amount:</span>
                            <span className="text-white">{formatCompactCurrency(displayAmount, { forceExact })}</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-gray-400">Tax Now ({(analysis.currentEffectiveRate * 100).toFixed(1)}%):</span>
                            <span className="text-red-400">-{formatCompactCurrency(displayAmount - analysis.roth.amountAfterTax, { forceExact })}</span>
                        </div>
                        <div className="flex justify-between items-center">
                            <span className="text-gray-400">
                                {formatCompactCurrency(analysis.roth.amountAfterTax, { forceExact })} x (1+{(analysis.growthRate * 100).toFixed(1)}%)^{displayGrowthYears}
                            </span>
                            <span className="text-white">{formatCompactCurrency(analysis.roth.valueAtWithdrawal, { forceExact })}</span>
                        </div>
                        <div className="flex justify-between border-t border-gray-700 pt-2 mt-2">
                            <span className="text-gray-300 font-medium">After-Tax Value:</span>
                            <span className="text-blue-400 font-bold">{formatCompactCurrency(analysis.roth.afterTaxValue, { forceExact })}</span>
                        </div>
                        <div className="text-xs text-gray-400 text-right">(Tax-free withdrawals)</div>
                    </div>
                </div>
            </div>

            {/* Result Summary */}
            <div className={`p-4 rounded-lg border ${analysis.verdict === 'roth' ? 'bg-green-900/20 border-green-700/30' : analysis.verdict === 'traditional' ? 'bg-red-900/20 border-red-700/30' : 'bg-gray-900/50 border-gray-700'}`}>
                <div className="flex justify-between items-center">
                    <div>
                        <div className="text-sm text-gray-400">Difference at Withdrawal</div>
                        <div className={`text-2xl font-bold ${benefitColor}`}>
                            {analysis.benefit >= 0 ? '+' : ''}{formatCompactCurrency(analysis.benefit, { forceExact })}
                        </div>
                    </div>
                    <div className={`text-lg font-semibold ${benefitColor}`}>
                        {benefitLabel}
                    </div>
                </div>
                <p className="text-sm text-gray-400 mt-2">{analysis.reason}</p>
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
        let recs = generateRecommendations(analysis, simulationData, assumptions, hasTraditional);
        if (!hsaEligible) {
            recs = recs.filter(rec => rec.id !== 'hsa-increase');
        }
        if (assumptions.investments?.autoRothConversions) {
            recs = recs.filter(rec => rec.id !== 'roth-conversion-window');
        }
        return recs;
    }, [analysis, simulationData, assumptions, hasTraditional, hsaEligible]);

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

            {/* Roth vs Pre-Tax Analysis */}
            {assumptions.display?.showExperimentalFeatures && (
                <RothAnalysisPanel
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
