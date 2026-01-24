import React, { useState, useContext } from 'react';
import { AssumptionsContext } from '../../../components/Objects/Assumptions/AssumptionsContext';
import { RangeSlider } from '../../../components/Layout/InputFields/RangeSlider';
import { CashflowSankey } from '../../../components/Charts/CashflowSankey';
import { calculateNetWorth, formatCompactCurrency } from './FutureUtils';

export const CashflowTab = React.memo(({ simulationData }: { simulationData: any[] }) => {
    const { state: assumptions } = useContext(AssumptionsContext);
    const forceExact = assumptions.display?.useCompactCurrency === false;
    const formatCurrency = (value: number) => formatCompactCurrency(value || 0, { forceExact });
    const startYear = simulationData.length > 0 ? simulationData[0].year : new Date().getFullYear();
    const endYear = simulationData.length > 0 ? simulationData[simulationData.length - 1].year : startYear;
    const [selectedYear, setSelectedYear] = useState(startYear);
	
    const selectedYearIndex = simulationData.findIndex(s => s.year === selectedYear);
    const yearData = simulationData[selectedYearIndex];
	
    const age = selectedYear - assumptions.demographics.birthYear;
    const netWorth = yearData ? calculateNetWorth(yearData.accounts) : 0;

    if (!yearData) return <div>No data</div>;

    // Check for Roth conversion in selected year
    const hasRothConversion = yearData.rothConversion && yearData.rothConversion.amount > 0;
    const conversionAmount = yearData.rothConversion?.amount || 0;
    const conversionTax = yearData.rothConversion?.taxCost || 0;

    // Check for Guyton-Klinger guardrail trigger in selected year
    const gkTriggered = yearData.strategyAdjustment?.guardrailTriggered;
    const gkAdjustmentPercent = yearData.strategyAdjustment?.adjustmentPercent;

    return (
         <div className="flex flex-col gap-4">
            {/* Info banners - min-h prevents chart from shifting when banners appear/disappear */}
            <div className="min-h-[52px] flex flex-col gap-2 justify-end">
            {gkTriggered === 'capital-preservation' && (
                <div className="p-3 bg-amber-900/20 border border-amber-700/50 rounded-lg text-sm">
                    <div className="flex items-start gap-2">
                        <span className="text-amber-400 font-semibold">Capital Preservation Rule:</span>
                        <span className="text-gray-300">
                            Portfolio dropped below the guardrail threshold. Discretionary expenses were
                            <span className="text-amber-300"> reduced by {gkAdjustmentPercent ? `${Math.abs(gkAdjustmentPercent * 100).toFixed(0)}%` : '10%'}</span> to protect your portfolio.
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
                            <span className="text-green-300"> increased by {gkAdjustmentPercent ? `${Math.abs(gkAdjustmentPercent * 100).toFixed(0)}%` : '10%'}</span> to enjoy your gains.
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
                    height={400}
                />
            </div>


            {/* 2. SLIDER CONTROL (Updated to use RangeSlider) */}
            <div className="p-4 bg-gray-900 rounded-xl border border-gray-800 shadow-lg">
                <h3 className="text-lg font-bold text-white mb-2">Year Details: {selectedYear}</h3>
                <div className='flex items-center gap-6'>
                    
                    {/* Replaced invisible <input> with <RangeSlider> */}
                    <div className="w-full">
                        <RangeSlider
                            value={selectedYear}
                            min={startYear}
                            max={endYear}
                            onChange={(val) => setSelectedYear(val as number)}
                            hideHeader={true} // Hides internal label to use your custom header above
                        />
                    </div>
                    
                    <div className="flex gap-4 text-white min-w-fit">
                        <div>
                            <span className="font-bold">Net Worth:</span>
                            <span className='text-green-400'> {formatCurrency(netWorth)}</span>
                        </div>
                        <div>
                            <span className="font-bold">Age:</span> {age}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
});