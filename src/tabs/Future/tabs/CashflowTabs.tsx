import React, { useState, useContext, useCallback, useRef } from 'react';
import { AssumptionsContext, getBirthYear, getRetirementAge } from '../../../components/Objects/Assumptions/AssumptionsContext';
import { TaxContext } from '../../../components/Objects/Taxes/TaxContext';
import { RangeSlider } from '../../../components/Layout/InputFields/RangeSlider';
import { useArrowKeyAdjust } from '../../../hooks/useKeyboardShortcuts';
import { CashflowSankey, SankeyImbalance } from '../../../components/Charts/CashflowSankey';
import { calculateNetWorth, formatCompactCurrency } from './FutureUtils';

export const CashflowTab = React.memo(({ simulationData }: { simulationData: any[] }) => {
    const { state: assumptions } = useContext(AssumptionsContext);
    const { state: taxState } = useContext(TaxContext);
    const forceExact = assumptions.display?.useCompactCurrency === false;
    const formatCurrency = (value: number) => formatCompactCurrency(value || 0, { forceExact });
    const startYear = simulationData.length > 0 ? simulationData[0].year : new Date().getFullYear();
    const endYear = simulationData.length > 0 ? simulationData[simulationData.length - 1].year : startYear;
    const [selectedYear, setSelectedYear] = useState(startYear);
    const [sankeyImbalances, setSankeyImbalances] = useState<SankeyImbalance[]>([]);
    const containerRef = useRef<HTMLDivElement>(null);
    useArrowKeyAdjust(
        selectedYear,
        (v) => setSelectedYear(v as number),
        { min: startYear, max: endYear, step: 1, containerRef }
    );

    // Callback to receive Sankey balance check results
    const handleBalanceCheck = useCallback((imbalances: SankeyImbalance[]) => {
        setSankeyImbalances(imbalances);
    }, []);
	
    const selectedYearIndex = simulationData.findIndex(s => s.year === selectedYear);
    const yearData = simulationData[selectedYearIndex];

    const age = selectedYear - getBirthYear(assumptions.milestones);
    const netWorth = yearData ? calculateNetWorth(yearData.accounts) : 0;

    if (!yearData) return <div>No data</div>;

    // Check for Roth conversion in selected year
    const hasRothConversion = yearData.rothConversion && yearData.rothConversion.amount > 0;
    const conversionAmount = yearData.rothConversion?.amount || 0;
    const conversionTax = yearData.rothConversion?.taxCost || 0;

    // Check for withdrawal strategy adjustment in selected year
    const gkTriggered = yearData.strategyAdjustment?.guardrailTriggered;
    const gkActualAdjustment = yearData.strategyAdjustment?.actualAdjustment;

    // ACA cliff checks
    const acaAware = assumptions.investments.acaAware !== false;
    const acaConversionLimited = yearData.taxOptimizationTarget?.limitingFactor === 'ACA_CLIFF';
    const acaCliff = taxState.filingStatus === 'Married Filing Jointly' ? 125000 : 62500;
    const nonConversionMAGI = yearData.cashflow.totalIncome - conversionAmount;
    const retirementAge = getRetirementAge(assumptions.milestones);
    const withdrawalExceedsACA = acaAware && age >= retirementAge && age < 65 && !acaConversionLimited && nonConversionMAGI > acaCliff;

    return (
         <div ref={containerRef} className="flex flex-col gap-4">
            {/* Info banners - min-h prevents chart from shifting when banners appear/disappear */}
            <div className="min-h-[52px] flex flex-col gap-2 justify-end">
            {gkTriggered === 'capital-preservation' && (
                <div className="p-3 bg-amber-900/20 border border-amber-700/50 rounded-lg text-sm">
                    <div className="flex items-start gap-2">
                        <span className="text-amber-400 font-semibold">Capital Preservation Rule:</span>
                        <span className="text-gray-300">
                            Portfolio dropped below the guardrail threshold. Discretionary expenses were
                            <span className="text-amber-300"> reduced by ${gkActualAdjustment?.toLocaleString(undefined, { maximumFractionDigits: 0 }) ?? '?'}</span> to protect your portfolio.
                        </span>
                    </div>
                </div>
            )}
            {gkTriggered === 'prosperity' && (
                <div className="p-3 bg-green-900/20 border border-green-700/50 rounded-lg text-sm">
                    <div className="flex items-start gap-2">
                        <span className="text-green-400 font-semibold">Prosperity Rule:</span>
                        <span className="text-gray-300">
                            Portfolio exceeded the upper guardrail threshold. Discretionary expenses were
                            <span className="text-green-300"> increased by ${gkActualAdjustment?.toLocaleString(undefined, { maximumFractionDigits: 0 }) ?? '?'}</span> to enjoy your gains.
                        </span>
                    </div>
                </div>
            )}
            {gkTriggered === 'none' && yearData.strategyAdjustment && (
                <div className="p-3 bg-blue-900/20 border border-blue-700/50 rounded-lg text-sm">
                    <div className="flex items-start gap-2">
                        <span className="text-blue-400 font-semibold">Spending Cap:</span>
                        <span className="text-gray-300">
                            Your withdrawal strategy budget is less than your expenses. Discretionary spending was
                            <span className="text-blue-300"> reduced by ${gkActualAdjustment?.toLocaleString(undefined, { maximumFractionDigits: 0 }) ?? '?'}</span> to stay within budget.
                        </span>
                    </div>
                </div>
            )}

            {/* Roth Conversion Note */}
            {hasRothConversion && (
                <div className="p-3 bg-blue-900/20 border border-blue-700/50 rounded-lg text-sm">
                    <div className="flex items-start gap-2">
                        <span className="text-blue-400 font-semibold">🔄 Roth Conversion:</span>
                        <span className="text-gray-300">
                            {formatCurrency(conversionAmount)} converted from Traditional → Roth.
                            This is a <span className="text-blue-300">transfer</span>, not cash — it flows through Gross Pay to show the
                            <span className="text-amber-400"> {formatCurrency(conversionTax)} tax</span> owed.
                            The tax is paid from your withdrawal accounts.
                        </span>
                    </div>
                </div>
            )}

            {/* ACA Cliff Warning */}
            {yearData.taxOptimizationTarget?.limitingFactor === 'ACA_CLIFF' && (() => {
                const details = yearData.taxOptimizationTarget?.constraintDetails;
                const hasBrokerageWithdrawal = Object.entries(yearData.cashflow.withdrawalDetail || {}).some(
                    ([name, amt]) => (amt as number) >= 0.005 && name.toLowerCase().includes('brokerage')
                );
                const gainPct = hasBrokerageWithdrawal && details?.brokerageGainRatio != null && details.brokerageGainRatio >= 0.005
                    ? Math.round(details.brokerageGainRatio * 100) : null;
                return (
                    <div className="p-3 bg-yellow-900/30 border border-yellow-700/50 rounded-lg text-sm">
                        <div className="flex items-start gap-2">
                            <span className="text-yellow-300 font-semibold">ACA Cliff:</span>
                            <span className="text-gray-300">
                                Roth conversions limited to keep MAGI under the ACA subsidy cliff
                                ({formatCurrency(details?.acaCliffThreshold || 0)}).
                                {gainPct != null && <> Brokerage is <span className="text-yellow-200">{gainPct}% gains</span> — withdrawals add capital gains to MAGI, eating into conversion room.</>}
                                {' '}Disable <span className="text-yellow-200">ACA-Aware Conversions</span> in Advanced Settings if you have non-ACA health coverage.
                            </span>
                        </div>
                    </div>
                );
            })()}

            {/* ACA Cliff Warning — Withdrawals exceed cliff */}
            {withdrawalExceedsACA && (
                <div className="p-3 bg-yellow-900/30 border border-yellow-700/50 rounded-lg text-sm">
                    <div className="flex items-start gap-2">
                        <span className="text-yellow-300 font-semibold">ACA Cliff:</span>
                        <span className="text-gray-300">
                            Income from withdrawals alone ({formatCurrency(nonConversionMAGI)}) exceeds the ACA subsidy cliff
                            ({formatCurrency(acaCliff)}). You may lose ACA premium subsidies regardless of Roth conversion strategy.
                        </span>
                    </div>
                </div>
            )}

            {/* Sankey Imbalance Error (Development Debug Aid) */}
            {sankeyImbalances.length > 0 && (
                <div className="p-3 bg-red-900/20 border border-red-800 rounded-lg text-sm">
                    <div className="flex flex-col gap-1">
                        <span className="text-red-400 font-semibold">⚠️ Sankey Imbalance Detected:</span>
                        {sankeyImbalances.map((imbalance, idx) => (
                            <span key={idx} className="text-gray-300 ml-4">
                                <span className="text-red-300">{imbalance.nodeName}</span> has{' '}
                                <span className="text-green-400">{formatCurrency(imbalance.inflows)}</span> inflows but{' '}
                                <span className="text-amber-400">{formatCurrency(imbalance.outflows)}</span> outflows{' '}
                                (difference: <span className="text-red-400">{formatCurrency(imbalance.difference)}</span>)
                            </span>
                        ))}
                    </div>
                </div>
            )}
            </div>

            {/* 1. SANKEY CHART */}
            <div className="overflow-visible">
                <CashflowSankey
                    incomes={yearData.incomes}
                    expenses={yearData.expenses}
                    year={yearData.year}
                    taxes={yearData.taxDetails}
                    bucketAllocations={yearData.cashflow.bucketDetail || {}}
                    extraLeftPadding={50}
                    extraRightPadding={20}
                    accounts={yearData.accounts}
                    withdrawals={yearData.cashflow.withdrawalDetail || {}}
                    rothConversion={yearData.rothConversion}
                    livingExpenses={yearData.cashflow.livingExpenses}
                    cashflowDetail={yearData.cashflowDetail}
                    height={400}
                    onBalanceCheck={handleBalanceCheck}
                />
            </div>


            {/* 2. SLIDER CONTROL (Updated to use RangeSlider) */}
            <div className="p-4 bg-gray-900 rounded-xl border border-gray-800 shadow-lg">
                <h3 className="text-lg font-bold text-white mb-2">Year Details: {selectedYear}</h3>
                <RangeSlider
                    value={selectedYear}
                    min={startYear}
                    max={endYear}
                    onChange={(val) => setSelectedYear(val as number)}
                    hideHeader={true}
                />
                <div className="flex flex-wrap gap-4 text-white mt-3 text-sm">
                    <div>
                        <span className="font-bold text-gray-400">Age:</span> {age}
                    </div>
                    <div>
                        <span className="font-bold text-gray-400">Income:</span>
                        <span className="text-emerald-400"> {formatCurrency(yearData.cashflow.totalIncome)}</span>
                    </div>
                    <div>
                        <span className="font-bold text-gray-400">Taxes:</span>
                        <span className="text-red-400"> {formatCurrency((yearData.taxDetails.fed || 0) + (yearData.taxDetails.state || 0) + (yearData.taxDetails.fica || 0))}</span>
                    </div>
                    <div>
                        <span className="font-bold text-gray-400">Expenses:</span>
                        <span className="text-orange-400"> {formatCurrency(yearData.cashflow.livingExpenses)}</span>
                    </div>
                    <div>
                        <span className="font-bold text-gray-400">Net Worth:</span>
                        <span className='text-green-400'> {formatCurrency(netWorth)}</span>
                    </div>
                </div>
            </div>
        </div>
    );
});