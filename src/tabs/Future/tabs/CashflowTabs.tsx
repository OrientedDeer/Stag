import React, { useState, useContext, useCallback, useRef, lazy, Suspense } from 'react';
import { AssumptionsContext, getBirthYear, getRetirementAge } from '../../../components/Objects/Assumptions/AssumptionsContext';
import { TaxContext } from '../../../components/Objects/Taxes/TaxContext';
import { RangeSlider } from '../../../components/Layout/InputFields/RangeSlider';
import { useArrowKeyAdjust } from '../../../hooks/useKeyboardShortcuts';
import type { SankeyImbalance } from '../../../components/Charts/CashflowSankey';
import type { SimulationYear } from '../../../services/simulation/types';
import { calculateNetWorth, formatCompactCurrency } from './FutureUtils';
import { Panel } from "../../../components/Layout/Primitives";

const CashflowSankey = lazy(() =>
    import('../../../components/Charts/CashflowSankey').then(m => ({ default: m.CashflowSankey }))
);

// Stable references for empty fallbacks. Used as Sankey props so React.memo's
// shallow-equal check sees the same identity across drag-tick re-renders of
// CashflowTab — otherwise `expr || {}` would mint a fresh object each render
// and defeat the memo bailout.
const EMPTY_RECORD: Record<string, number> = Object.freeze({});

export const CashflowTab = React.memo(({ simulationData }: { simulationData: SimulationYear[] }) => {
    const { state: assumptions } = useContext(AssumptionsContext);
    const { state: taxState } = useContext(TaxContext);
    const forceExact = assumptions.display?.useCompactCurrency === false;
    const showDevTools = assumptions.display?.showDevTools ?? false;
    const formatCurrency = (value: number) => formatCompactCurrency(value || 0, { forceExact });
    const startYear = simulationData.length > 0 ? simulationData[0].year : new Date().getFullYear();
    const endYear = simulationData.length > 0 ? simulationData[simulationData.length - 1].year : startYear;
    // Two states: `selectedYear` commits on release and drives the Sankey
    // (expensive to re-render). `previewYear` updates on every drag tick and
    // drives the cheap year-detail readouts so the numbers feel responsive
    // mid-drag without re-rendering the chart.
    const [selectedYear, setSelectedYear] = useState(startYear);
    const [previewYear, setPreviewYear] = useState(startYear);
    const [sankeyImbalances, setSankeyImbalances] = useState<SankeyImbalance[]>([]);
    const containerRef = useRef<HTMLDivElement>(null);
    useArrowKeyAdjust(
        selectedYear,
        (v) => { setSelectedYear(v as number); setPreviewYear(v as number); },
        { min: startYear, max: endYear, step: 1, containerRef }
    );

    // Callback to receive Sankey balance check results
    const handleBalanceCheck = useCallback((imbalances: SankeyImbalance[]) => {
        setSankeyImbalances(imbalances);
    }, []);

    const sankeyYearIndex = simulationData.findIndex(s => s.year === selectedYear);
    const sankeyYearData = simulationData[sankeyYearIndex];
    const previewYearIndex = simulationData.findIndex(s => s.year === previewYear);
    const yearData = simulationData[previewYearIndex] ?? sankeyYearData;

    const age = previewYear - getBirthYear(assumptions.milestones);
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
            {gkTriggered === 'capital-preservation' && yearData.strategyAdjustment?.warning && (
                <div className="p-3 bg-negative-tint/20 border border-negative-strong/50 rounded-lg text-sm">
                    <div className="flex items-start gap-2">
                        <span className="text-negative font-semibold">Plan Failed (Guyton-Klinger):</span>
                        <span className="text-content-default">{yearData.strategyAdjustment.warning}</span>
                    </div>
                </div>
            )}
            {gkTriggered === 'capital-preservation' && !yearData.strategyAdjustment?.warning && (
                <div className="p-3 bg-warning-tint/20 border border-warning-strong/50 rounded-lg text-sm">
                    <div className="flex items-start gap-2">
                        <span className="text-warning font-semibold">Capital Preservation Rule:</span>
                        <span className="text-content-default">
                            Portfolio dropped below the guardrail threshold. Discretionary expenses were
                            <span className="text-warning-bright"> reduced by ${gkActualAdjustment?.toLocaleString(undefined, { maximumFractionDigits: 0 }) ?? '?'}</span> to protect your portfolio.
                        </span>
                    </div>
                </div>
            )}
            {gkTriggered === 'prosperity' && (
                <div className="p-3 bg-positive-tint/20 border border-positive-strong/50 rounded-lg text-sm">
                    <div className="flex items-start gap-2">
                        <span className="text-positive font-semibold">Prosperity Rule:</span>
                        <span className="text-content-default">
                            Portfolio exceeded the upper guardrail threshold. Discretionary expenses were
                            <span className="text-positive-bright"> increased by ${gkActualAdjustment?.toLocaleString(undefined, { maximumFractionDigits: 0 }) ?? '?'}</span> to enjoy your gains.
                        </span>
                    </div>
                </div>
            )}
            {gkTriggered === 'none' && yearData.strategyAdjustment && (
                <div className="p-3 bg-info-tint/20 border border-info-strong/50 rounded-lg text-sm">
                    <div className="flex items-start gap-2">
                        <span className="text-info font-semibold">Spending Cap:</span>
                        <span className="text-content-default">
                            Your withdrawal strategy budget is less than your expenses. Discretionary spending was
                            <span className="text-info-bright"> reduced by ${gkActualAdjustment?.toLocaleString(undefined, { maximumFractionDigits: 0 }) ?? '?'}</span> to stay within budget.
                        </span>
                    </div>
                </div>
            )}

            {/* Roth Conversion Note */}
            {hasRothConversion && (
                <div className="p-3 bg-info-tint/20 border border-info-strong/50 rounded-lg text-sm">
                    <div className="flex items-start gap-2">
                        <span className="text-info font-semibold">🔄 Roth Conversion:</span>
                        <span className="text-content-default">
                            {formatCurrency(conversionAmount)} converted from Traditional → Roth.
                            This is a <span className="text-info-bright">transfer</span>, not cash — it flows through Gross Pay to show the
                            <span className="text-warning"> {formatCurrency(conversionTax)} tax</span> owed.
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
                    <div className="p-3 bg-warning-tint/30 border border-warning-strong/50 rounded-lg text-sm">
                        <div className="flex items-start gap-2">
                            <span className="text-warning-bright font-semibold">ACA Cliff:</span>
                            <span className="text-content-default">
                                Roth conversions limited to keep MAGI under the ACA subsidy cliff
                                ({formatCurrency(details?.acaCliffThreshold || 0)}).
                                {gainPct != null && <> Brokerage is <span className="text-warning-bright">{gainPct}% gains</span> — withdrawals add capital gains to MAGI, eating into conversion room.</>}
                                {' '}Disable <span className="text-warning-bright">ACA-Aware Conversions</span> in Advanced Settings if you have non-ACA health coverage.
                            </span>
                        </div>
                    </div>
                );
            })()}

            {/* ACA Cliff Warning — Withdrawals exceed cliff */}
            {withdrawalExceedsACA && (
                <div className="p-3 bg-warning-tint/30 border border-warning-strong/50 rounded-lg text-sm">
                    <div className="flex items-start gap-2">
                        <span className="text-warning-bright font-semibold">ACA Cliff:</span>
                        <span className="text-content-default">
                            Income from withdrawals alone ({formatCurrency(nonConversionMAGI)}) exceeds the ACA subsidy cliff
                            ({formatCurrency(acaCliff)}). You may lose ACA premium subsidies regardless of Roth conversion strategy.
                        </span>
                    </div>
                </div>
            )}

            {/* Sankey Imbalance Error (Development Debug Aid) — accounting
                self-check, only shown when Developer tools is enabled. The
                balance check itself still runs (cheap; Testing tab uses it). */}
            {showDevTools && sankeyImbalances.length > 0 && (
                <div className="p-3 bg-negative-tint/20 border border-negative-strong rounded-lg text-sm">
                    <div className="flex flex-col gap-1">
                        <span className="text-negative font-semibold">⚠️ Sankey Imbalance Detected:</span>
                        {sankeyImbalances.map((imbalance, idx) => (
                            <span key={idx} className="text-content-default ml-4">
                                <span className="text-negative-bright">{imbalance.nodeName}</span> has{' '}
                                <span className="text-positive">{formatCurrency(imbalance.inflows)}</span> inflows but{' '}
                                <span className="text-warning">{formatCurrency(imbalance.outflows)}</span> outflows{' '}
                                (difference: <span className="text-negative">{formatCurrency(imbalance.difference)}</span>)
                            </span>
                        ))}
                    </div>
                </div>
            )}
            </div>

            {/* 1. SANKEY CHART — uses committed year so dragging doesn't re-render it per tick */}
            <div className="overflow-visible">
                <Suspense fallback={<div className="h-[400px] animate-pulse bg-surface-raised/50 rounded-xl" />}>
                    {sankeyYearData && (
                        <CashflowSankey
                            incomes={sankeyYearData.incomes}
                            expenses={sankeyYearData.expenses}
                            year={sankeyYearData.year}
                            taxes={sankeyYearData.taxDetails}
                            bucketAllocations={sankeyYearData.cashflow.bucketDetail || EMPTY_RECORD}
                            extraLeftPadding={50}
                            extraRightPadding={20}
                            accounts={sankeyYearData.accounts}
                            withdrawals={sankeyYearData.cashflow.withdrawalDetail || EMPTY_RECORD}
                            rothConversion={sankeyYearData.rothConversion}
                            livingExpenses={sankeyYearData.cashflow.livingExpenses}
                            cashflowDetail={sankeyYearData.cashflowDetail}
                            height={400}
                            onBalanceCheck={handleBalanceCheck}
                        />
                    )}
                </Suspense>
            </div>


            {/* 2. SLIDER CONTROL (Updated to use RangeSlider) */}
            <Panel className="shadow-lg">
                <div className="flex items-baseline gap-3 mb-2">
                    <h3 className="text-lg font-bold text-white">Year Details: {previewYear}</h3>
                    {previewYear !== selectedYear && (
                        <span className="text-xs text-warning-soft">
                            chart shows {selectedYear} — release to update
                        </span>
                    )}
                </div>
                <RangeSlider
                    value={selectedYear}
                    min={startYear}
                    max={endYear}
                    onChange={(val) => setSelectedYear(val as number)}
                    onLiveChange={(val) => setPreviewYear(val as number)}
                    hideHeader={true}
                />
                <div className="flex flex-wrap gap-4 text-white mt-3 text-sm">
                    <div>
                        <span className="font-bold text-content-muted">Age:</span> {age}
                    </div>
                    <div>
                        <span className="font-bold text-content-muted">Income:</span>
                        <span className="text-positive"> {formatCurrency(yearData.cashflow.totalIncome)}</span>
                    </div>
                    <div>
                        <span className="font-bold text-content-muted">Taxes:</span>
                        <span className="text-negative"> {formatCurrency((yearData.taxDetails.fed || 0) + (yearData.taxDetails.state || 0) + (yearData.taxDetails.fica || 0))}</span>
                    </div>
                    <div>
                        <span className="font-bold text-content-muted">Expenses:</span>
                        <span className="text-cat-orange"> {formatCurrency(yearData.cashflow.livingExpenses)}</span>
                    </div>
                    <div>
                        <span className="font-bold text-content-muted">Net Worth:</span>
                        <span className='text-positive'> {formatCurrency(netWorth)}</span>
                    </div>
                </div>
            </Panel>
        </div>
    );
});